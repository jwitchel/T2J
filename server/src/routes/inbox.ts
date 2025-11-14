import express from 'express';
import { requireAuth } from '../middleware/auth';
import { withImapJson } from '../lib/http/imap-utils';
import { pool } from '../lib/db';
import { EmailActionTracker } from '../lib/email-action-tracker';
import { inboxProcessor } from '../lib/email-processing/inbox-processor';
import { ImapOperations } from '../lib/imap-operations';
import PostalMime from 'postal-mime';

const router = express.Router();

// Process a single inbox email (used by UI)
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

// Get inbox emails for a specific account
router.get('/emails/:accountId', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { accountId } = req.params;
    const { offset = 0, limit = 1, showAll = 'false' } = req.query;

    await withImapJson(res, accountId, userId, async () => {
      // Account validation happens in ImapOperations.fromAccountId()
      const imapOps = await ImapOperations.fromAccountId(accountId, userId);

      const targetOffset = Number(offset);
      const targetLimit = Number(limit);
      const BATCH_SIZE = parseInt(process.env.NEXT_PUBLIC_INBOX_BATCH_SIZE || '10', 10);
      let totalCount = -1;
      const messages = await imapOps.getMessages('INBOX', {
        offset: 0,
        limit: BATCH_SIZE,
        descending: true
      });

      // Get full message details for all messages in batch
      let fullMessages: any[] = [];
      if (messages.length > 0) {
        const uids = messages.map(msg => msg.uid);
        const batched = await imapOps.getMessagesRaw('INBOX', uids);
        fullMessages = batched.map(msg => ({
          uid: msg.uid,
          messageId: msg.messageId || `${msg.uid}@${accountId}`,
          from: msg.from || 'Unknown',
          to: msg.to || [],
          subject: msg.subject || '(No subject)',
          date: msg.date || new Date(),
          flags: msg.flags || [],
          size: msg.size || 0,
          fullMessage: msg.fullMessage || ''
        }));
      }

      // Get action tracking data for ALL messages in one query
      const messageIds = fullMessages.map(msg => msg.messageId).filter(id => id);
      const actionTrackingMap = await EmailActionTracker.getActionsForMessages(accountId, messageIds);

      // Enrich all messages with action tracking data
      const enrichedMessages = fullMessages.map(msg => ({
        ...msg,
        actionTaken: actionTrackingMap[msg.messageId]?.actionTaken || 'none',
        updatedAt: actionTrackingMap[msg.messageId]?.updatedAt
      }));

      // Get total count on first request
      if (Number(offset) === 0) {
        try {
          const folderInfo = await imapOps.getFolderMessageCount('INBOX');
          totalCount = folderInfo.total;
        } catch (err) {
          console.error('Failed to get total count:', err);
          totalCount = -1;
        }
      }

      // Now apply filtering and pagination on the enriched dataset
      let resultMessages: any[] = [];

      if (showAll === 'false') {
        // Filter out messages that have been acted upon
        const unprocessedMessages = enrichedMessages.filter(msg =>
          msg.actionTaken === 'none' || !msg.actionTaken
        );

        // For filtered mode, skip to the target offset in the filtered list
        // and take the requested limit
        resultMessages = unprocessedMessages.slice(targetOffset, targetOffset + targetLimit);
      } else {
        // For show-all mode, pagination is straightforward
        resultMessages = enrichedMessages.slice(0, targetLimit);
      }

      return {
        messages: resultMessages,
        total: totalCount,
        offset: Number(offset),
        limit: Number(limit)
      };
    }, 'Failed to fetch inbox');

  } catch (error: any) {
    console.error('[inbox] Error fetching inbox:', error);
    // Map OAuth refresh failures to 401 so client can prompt re-auth
    if (error?.code === 'AUTH_REFRESH_FAILED') {
      res.status(401).json({
        error: 'OAUTH_REAUTH_REQUIRED',
        message: 'Email provider session expired or revoked. Please reconnect your account.'
      });
    } else {
      res.status(500).json({
        error: 'Failed to fetch inbox',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Reset action taken for an email (force evaluation)
router.post('/emails/:accountId/reset-action', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { accountId } = req.params;
    const { messageId } = req.body;

    if (!messageId) {
      res.status(400).json({ error: 'Message ID is required' });
      return;
    }

    // Validate account belongs to user (required since EmailActionTracker doesn't validate ownership)
    const accountCheck = await pool.query(
      'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    if (accountCheck.rows.length === 0) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    await EmailActionTracker.resetAction(accountId, messageId);

    res.json({
      success: true,
      message: 'Email action reset successfully'
    });
  } catch (error: any) {
    console.error('Failed to reset email action:', error);
    res.status(500).json({
      error: 'Failed to reset email action',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get user's email accounts
router.get('/accounts', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;

    const result = await pool.query(
      'SELECT id, email_address, imap_host FROM email_accounts WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    res.json({
      accounts: result.rows.map(row => ({
        id: row.id,
        email: row.email_address,
        host: row.imap_host
      }))
    });

  } catch (error) {
    console.error('Error fetching email accounts:', error);
    res.status(500).json({
      error: 'Failed to fetch email accounts',
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
    const emailResult = await pool.query(`
      SELECT
        er.email_id as "emailId",
        er.subject,
        er.sender_email as "senderEmail",
        er.sender_name as "senderName",
        er.received_date as "receivedDate",
        er.full_message as "fullMessage",
        er.word_count as "wordCount",
        eat.action_taken as "actionTaken",
        dt.id as "draftId",
        dt.context_data as "contextData",
        dt.created_at as "draftCreatedAt",
        dt.generated_content as "draftBody"
      FROM email_received er
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

            // Try to fetch LLM response from draft_tracking
            let llmResponse = undefined;
            const draftResult = await pool.query(
              `SELECT id, context_data, created_at, generated_content
               FROM draft_tracking
               WHERE user_id = $1 AND original_message_id = $2
               LIMIT 1`,
              [userId, messageId]
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
                relationship: contextData.relationship || { type: 'unknown', confidence: 0, detectionMethod: 'none' },
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

    // Build llmResponse if draft context exists (draftId can be null for silent actions)
    let llmResponse = undefined;
    if (email.contextData) {
      const contextData = email.contextData;
      llmResponse = {
        meta: contextData.meta || {},
        generatedAt: email.draftCreatedAt?.toISOString() || new Date().toISOString(),
        providerId: contextData.providerId || 'unknown',
        modelName: contextData.modelName || 'unknown',
        draftId: email.draftId || '',  // Can be empty for silent actions
        relationship: contextData.relationship || { type: 'unknown', confidence: 0, detectionMethod: 'none' },
        spamAnalysis: contextData.spamAnalysis || { isSpam: false, indicators: [], senderResponseCount: 0 },
        body: email.draftBody || ''  // Can be empty for silent actions
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