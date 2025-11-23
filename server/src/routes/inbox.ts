import express from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../lib/db';
import { inboxProcessor } from '../lib/email-processing/inbox-processor';
import { ImapOperations } from '../lib/imap-operations';
import PostalMime from 'postal-mime';

const router = express.Router();

// Process a single inbox email (used by UI to upload draft/file email)
router.post('/process-single', requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).user.id;
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
      // Email processing failed (including skipped due to lock)
      const statusCode = result.action === 'skipped' ? 409 : 500;  // 409 Conflict for lock contention
      res.status(statusCode).json({
        error: result.action === 'skipped' ? 'Email is being processed by another request' : 'Failed to process email',
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
  try {
    const userId = (req as any).user.id;
    const { accountId, messageId } = req.params;

    // Validate account belongs to user
    const accountCheck = await pool.query(
      'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    if (accountCheck.rows.length === 0) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    // Fetch email from PostgreSQL with action tracking and draft context
    // JOIN through person_emails to get sender info
    const emailResult = await pool.query(`
      SELECT
        er.email_id as "emailId",
        er.subject,
        pe.email_address as "senderEmail",
        p.name as "senderName",
        er.received_date as "receivedDate",
        er.full_message as "fullMessage",
        er.word_count as "wordCount",
        eat.action_taken as "actionTaken",
        dt.id as "draftId",
        dt.context_data as "contextData",
        dt.created_at as "draftCreatedAt",
        dt.generated_content as "draftBody",
        ur.relationship_type as "relationshipType",
        pr.confidence as "relationshipConfidence"
      FROM email_received er
      INNER JOIN person_emails pe ON er.sender_person_email_id = pe.id
      INNER JOIN people p ON pe.person_id = p.id
      LEFT JOIN person_relationships pr ON pr.person_id = p.id AND pr.user_id = er.user_id AND pr.is_primary = true
      LEFT JOIN user_relationships ur ON pr.user_relationship_id = ur.id
      LEFT JOIN email_action_tracking eat
        ON eat.message_id = TRIM(BOTH '<>' FROM er.email_id)
        AND eat.email_account_id = er.email_account_id
      LEFT JOIN draft_tracking dt
        ON dt.original_message_id = er.email_id
        AND dt.user_id = er.user_id
      WHERE er.user_id = $1 AND er.email_account_id = $2 AND er.email_id = $3
      LIMIT 1
    `, [userId, accountId, messageId]);

    let email = emailResult.rows.length > 0 ? emailResult.rows[0] : null;

    // Validate that actionTaken exists (must exist if email was processed)
    if (email && !email.actionTaken) {
      console.error('[inbox-get-email] Email exists but actionTaken is missing:', {
        emailId: email.emailId,
        accountId,
        userId,
        draftId: email.draftId,
        hasContextData: !!email.contextData
      });
      res.status(500).json({
        error: 'Data integrity error',
        message: `Email exists but action tracking is missing. Email ID: ${email.emailId.substring(0, 20)}...`
      });
      return;
    }

    // If not found in PostgreSQL, check if it exists in action tracking and has a UID we can use
    if (!email) {
      // Check if this email exists in the action tracking table with a UID
      const actionRecord = await pool.query(
        `SELECT eat.message_id, eat.uid, eat.subject, eat.created_at, eat.action_taken, eat.destination_folder
         FROM email_action_tracking eat
         WHERE eat.email_account_id = $1 AND eat.message_id = TRIM(BOTH '<>' FROM $2)
         LIMIT 1`,
        [accountId, messageId]
      );

      if (actionRecord.rows.length > 0 && actionRecord.rows[0].uid) {
        const uid = actionRecord.rows[0].uid;
        const folder = actionRecord.rows[0].destination_folder || 'INBOX';

        // Fetch from IMAP using the UID (check destination folder first, fallback to INBOX)
        try {
          const imapOps = await ImapOperations.fromAccountId(accountId, userId);
          let messages = await imapOps.getMessagesRaw(folder, [uid]);

          // If not found in destination folder, try INBOX as fallback
          if (messages.length === 0 && folder !== 'INBOX') {
            messages = await imapOps.getMessagesRaw('INBOX', [uid]);
          }

          if (messages.length > 0) {
            const msg = messages[0];

            // Try to fetch LLM response from draft_tracking and get relationship from person_relationships
            let llmResponse = undefined;
            const draftResult = await pool.query(
              `SELECT dt.id, dt.context_data, dt.created_at, dt.generated_content,
                      ur.relationship_type, pr.confidence
               FROM draft_tracking dt
               LEFT JOIN person_emails pe ON pe.email_address = $3 AND pe.person_id IN (
                 SELECT person_id FROM person_emails WHERE email_address = $3
               )
               LEFT JOIN person_relationships pr ON pr.person_id = pe.person_id AND pr.user_id = $1 AND pr.is_primary = true
               LEFT JOIN user_relationships ur ON pr.user_relationship_id = ur.id
               WHERE dt.user_id = $1 AND dt.original_message_id = $2
               LIMIT 1`,
              [userId, messageId, msg.from]
            );

            if (draftResult.rows.length > 0) {
              const draft = draftResult.rows[0];
              const contextData = draft.context_data;
              llmResponse = {
                meta: contextData.meta || {},
                generatedAt: draft.created_at?.toISOString() || new Date().toISOString(),
                providerId: contextData.providerId || 'unknown',
                modelName: contextData.modelName || 'unknown',
                draftId: draft.id || '',
                relationship: {
                  type: draft.relationship_type || 'unknown',
                  confidence: draft.confidence || 0
                },  // From database person_relationships, not JSON
                spamAnalysis: contextData.spamAnalysis || { isSpam: false, indicators: [], senderResponseCount: 0 },
                body: draft.generated_content || ''  // Can be null for silent actions
              };
            }

            // Return the email in the same format as PostgreSQL would
            res.json({
              success: true,
              email: {
                messageId: msg.messageId || messageId,
                subject: msg.subject || actionRecord.rows[0].subject || '(No subject)',
                from: msg.from || 'Unknown',
                fromName: undefined,
                to: msg.to || [],
                cc: [], // CC not available from IMAP basic fetch
                date: msg.date?.toISOString() || actionRecord.rows[0].created_at,
                rawMessage: msg.fullMessage || '',
                uid: msg.uid,
                flags: msg.flags || [],
                size: msg.size || 0,
                actionTaken: actionRecord.rows[0].action_taken,
                llmResponse,
                relationship: llmResponse?.relationship
              }
            });
            return;
          }
        } catch (imapError) {
          console.error('[inbox-get-email] Failed to fetch from IMAP:', imapError);
        }
      }

      res.status(404).json({
        error: 'Email not available',
        message: 'This email was processed before the history feature was implemented. Only newly processed emails can be viewed from history. Please process new emails to see them here.'
      });
      return;
    }

    // Build llmResponse - either from full draft context or minimal data for older emails
    let llmResponse = undefined;
    if (email.contextData) {
      // Full draft tracking data available
      const contextData = email.contextData;
      llmResponse = {
        meta: contextData.meta || {},
        generatedAt: email.draftCreatedAt?.toISOString() || new Date().toISOString(),
        providerId: contextData.providerId || 'unknown',
        modelName: contextData.modelName || 'unknown',
        draftId: email.draftId || '',
        relationship: {
          type: email.relationshipType || 'unknown',
          confidence: email.relationshipConfidence || 0
        },
        spamAnalysis: contextData.spamAnalysis || { isSpam: false, indicators: [], senderResponseCount: 0 },
        body: email.draftBody || ''
      };
    } else if (email.actionTaken && email.actionTaken !== 'none') {
      // No draft context but email was processed - create minimal response showing action
      llmResponse = {
        meta: {
          recommendedAction: email.actionTaken,
          keyConsiderations: ['Email processed before analysis tracking was implemented'],
          contextFlags: {
            isThreaded: false,
            hasAttachments: false,
            isGroupEmail: false,
            inboundMsgAddressedTo: 'you',
            urgencyLevel: 'low'
          }
        },
        generatedAt: new Date().toISOString(),
        providerId: 'unknown',
        modelName: 'unknown',
        draftId: '',
        relationship: {
          type: email.relationshipType || 'unknown',
          confidence: email.relationshipConfidence || 0
        },
        spamAnalysis: { isSpam: false, indicators: [], senderResponseCount: 0 },
        body: ''
      };
    }

    // Parse email to extract To/CC from raw message
    let toAddresses: string[] = [];
    let ccAddresses: string[] = [];

    try {
      const parser = new PostalMime();
      const parsed = await parser.parse(email.fullMessage);

      // Extract To addresses
      if (parsed.to && Array.isArray(parsed.to)) {
        toAddresses = parsed.to
          .map(addr => addr.address)
          .filter((addr): addr is string => typeof addr === 'string' && addr.length > 0);
      }

      // Extract CC addresses
      if (parsed.cc && Array.isArray(parsed.cc)) {
        ccAddresses = parsed.cc
          .map(addr => addr.address)
          .filter((addr): addr is string => typeof addr === 'string' && addr.length > 0);
      }
    } catch (parseError) {
      console.error('[Inbox] Error parsing email for To/CC:', parseError);
      // Continue with empty arrays if parsing fails
    }

    // Return email data
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
        uid: undefined,  // UID not stored in email_received
        flags: [],
        size: email.wordCount || 0,
        actionTaken: email.actionTaken,  // Validated above - must exist
        llmResponse,  // From draft_tracking if available
        relationship: llmResponse?.relationship
      }
    });

  } catch (error) {
    console.error('Error fetching email by messageId:', error);
    res.status(500).json({
      error: 'Failed to fetch email',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
