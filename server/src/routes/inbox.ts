import express from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../lib/db';
import { inboxProcessor } from '../lib/email-processing/inbox-processor';
import PostalMime from 'postal-mime';

const router = express.Router();

// Process a single inbox email (used by UI to upload draft/file email)
router.post('/process-single', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const {
    emailAccountId,
    messageUid,
    messageId,
    messageSubject,
    messageFrom,
    fullMessage,
    providerId,
    generatedDraft
  } = req.body;

  // Validate required fields
  if (!emailAccountId || !fullMessage || !providerId || !messageUid) {
    res.status(400).json({
      error: 'Missing required fields: emailAccountId, fullMessage, providerId, messageUid'
    });
    return;
  }

  try {
    // Use InboxProcessor to handle single email
    const result = await inboxProcessor.processEmail({
      message: {
        uid: messageUid,
        messageId,
        subject: messageSubject,
        from: messageFrom,
        fullMessage
      },
      accountId: emailAccountId,
      userId,
      providerId,
      generatedDraft
    });

    if (result.success) {
      // Email was successfully processed
      res.json({
        success: true,
        folder: result.destination,
        message: result.actionDescription,
        action: result.action,
        draftId: result.draftId
      });
    } else {
      // Email processing failed
      let statusCode = 500;
      let errorMessage = 'Failed to process email';
      if (result.action === 'malformed') {
        statusCode = 400;
        errorMessage = 'Malformed email';
      }
      res.status(statusCode).json({
        error: errorMessage,
        message: result.error || result.actionDescription
      });
    }
  } catch (error) {
    console.error('[inbox-process-single] Error:', error);
    res.status(500).json({
      error: 'Failed to process email',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get a specific email by messageId from database
router.get('/email/:accountId/:messageId', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const { accountId, messageId } = req.params;

  const emailResult = await pool.query(`
    SELECT
      er.email_id as "emailId",
      er.subject,
      pe.email_address as "senderEmail",
      p.name as "senderName",
      er.received_date as "receivedDate",
      er.full_message as "fullMessage",
      er.word_count as "wordCount",
      er.action_taken as "actionTaken",
      dt.context_data as "contextData",
      dt.created_at as "draftCreatedAt",
      dt.generated_content as "draftBody",
      p.relationship_type as "relationshipType",
      p.relationship_confidence as "relationshipConfidence"
    FROM email_received er
    INNER JOIN person_emails pe ON er.sender_person_email_id = pe.id
    INNER JOIN people p ON pe.person_id = p.id
    LEFT JOIN draft_tracking dt
      ON dt.original_message_id = er.email_id
      AND dt.user_id = er.user_id
    WHERE er.user_id = $1 AND er.email_account_id = $2 AND er.email_id = $3
  `, [userId, accountId, messageId]);

  if (emailResult.rows.length === 0) {
    res.status(404).json({ error: 'Email not found' });
    return;
  }

  const email = emailResult.rows[0];

  const parser = new PostalMime();
  const parsed = await parser.parse(email.fullMessage);

  // RFC 5322: To and Cc are optional headers in valid emails
  const toAddresses = (parsed.to ?? [])
    .map(addr => addr.address!)
    .filter(addr => addr.length > 0);

  const ccAddresses = (parsed.cc ?? [])
    .map(addr => addr.address!)
    .filter(addr => addr.length > 0);

  const llmResponse = email.contextData ? {
    meta: email.contextData.meta,
    generatedAt: email.draftCreatedAt.toISOString(),
    providerId: email.contextData.providerId,
    modelName: email.contextData.modelName,
    draftId: email.contextData.draftId,
    relationship: {
      type: email.relationshipType,
      confidence: email.relationshipConfidence
    },
    spamAnalysis: email.contextData.spamAnalysis,
    body: email.draftBody
  } : undefined;

  res.json({
    success: true,
    email: {
      messageId: email.emailId,
      subject: email.subject,
      from: email.senderEmail,
      fromName: email.senderName,
      to: toAddresses,
      cc: ccAddresses,
      date: email.receivedDate,
      rawMessage: email.fullMessage,
      uid: undefined,
      flags: [],
      size: email.wordCount,
      actionTaken: email.actionTaken,
      llmResponse,
      relationship: llmResponse?.relationship
    }
  });
});

export default router;
