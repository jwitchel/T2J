import { pool } from './db';
import { EmailActionType } from '../types/email-action-tracking';

/**
 * Normalize an email ID to ensure consistent formatting
 * Removes angle brackets and trims whitespace
 *
 * @private
 */
function normalizeEmailId(emailId: string): string {
  if (!emailId) return emailId;

  return emailId
    .trim()
    .replace(/^</, '')  // Remove leading angle bracket
    .replace(/>$/, ''); // Remove trailing angle bracket
}

/**
 * Centralized service for tracking email actions
 * This ensures consistency and prevents duplicate tracking
 *
 * Database constraint: UNIQUE(email_account_id, message_id)
 * This provides a second layer of defense against duplicate processing
 * after BullMQ's job ID deduplication.
 */
export class EmailActionTracker {
  /**
   * Record that an action was taken on an email
   * @param userId - The user who took the action
   * @param emailAccountId - The email account ID
   * @param messageId - The message ID of the email
   * @param actionTaken - The type of action taken
   * @param subject - Optional email subject
   * @param destinationFolder - Optional destination folder
   * @param uid - Optional IMAP UID for fetching the email from the server
   * @param senderEmail - Optional sender email address
   * @returns Promise<void>
   */
  static async recordAction(
    userId: string,
    emailAccountId: string,
    messageId: string,
    actionTaken: EmailActionType,
    subject?: string,
    destinationFolder?: string,
    uid?: number,
    senderEmail?: string
  ): Promise<void> {
    const normalizedMessageId = normalizeEmailId(messageId);

    try {
      await pool.query(
        `INSERT INTO email_action_tracking (user_id, email_account_id, message_id, action_taken, subject, destination_folder, uid, sender_email, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (email_account_id, message_id)
         DO UPDATE SET action_taken = $4, subject = $5, destination_folder = $6, uid = $7, sender_email = $8, updated_at = NOW()`,
        [userId, emailAccountId, normalizedMessageId, actionTaken, subject, destinationFolder, uid, senderEmail]
      );
    } catch (error: unknown) {
      // Log error but don't fail the request
      console.error('Failed to record email action tracking:', error);
      // Re-throw if it's a critical database error (not a constraint violation)
      if (error instanceof Error && !error.message.includes('duplicate key')) {
        throw error;
      }
    }
  }

  /**
   * Check if an email has been processed (has any action other than 'none')
   * This provides deduplication defense after BullMQ's job ID deduplication
   *
   * @param userId - The user ID
   * @param emailAccountId - The email account ID
   * @param messageId - The message ID of the email
   * @returns Promise<boolean> - true if email has been processed
   */
  static async hasEmailBeenProcessed(
    userId: string,
    emailAccountId: string,
    messageId: string
  ): Promise<boolean> {
    const normalizedMessageId = normalizeEmailId(messageId);

    const result = await pool.query(
      `SELECT action_taken
       FROM email_action_tracking
       WHERE user_id = $1 AND email_account_id = $2 AND message_id = $3`,
      [userId, emailAccountId, normalizedMessageId]
    );

    if (result.rows.length === 0) {
      return false; // No tracking record = not processed
    }

    const actionTaken = result.rows[0].action_taken as EmailActionType;
    return actionTaken !== 'none'; // Processed if action is not 'none'
  }

  /**
   * Upsert email action tracking with explicit conflict handling
   * This is the safe insert method that leverages the unique constraint
   *
   * @param userId - The user ID
   * @param emailAccountId - The email account ID
   * @param messageId - The message ID
   * @param actionTaken - The action taken
   * @returns Promise<boolean> - true if inserted, false if already existed
   */
  static async upsertEmailAction(
    userId: string,
    emailAccountId: string,
    messageId: string,
    actionTaken: EmailActionType
  ): Promise<boolean> {
    const normalizedMessageId = normalizeEmailId(messageId);

    const result = await pool.query(
      `INSERT INTO email_action_tracking (user_id, email_account_id, message_id, action_taken, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (email_account_id, message_id) DO NOTHING
       RETURNING id`,
      [userId, emailAccountId, normalizedMessageId, actionTaken]
    );

    return result.rows.length > 0; // true if inserted, false if conflict
  }

  /**
   * Reset the action tracking for an email (mark as 'none')
   * @param emailAccountId - The email account ID
   * @param messageId - The message ID of the email
   * @returns Promise<void>
   */
  static async resetAction(
    emailAccountId: string,
    messageId: string
  ): Promise<void> {
    const normalizedMessageId = normalizeEmailId(messageId);

    await pool.query(
      `DELETE FROM email_action_tracking
       WHERE email_account_id = $1 AND message_id = $2`,
      [emailAccountId, normalizedMessageId]
    );
  }

  /**
   * Get action tracking data for multiple messages
   * @param emailAccountId - The email account ID
   * @param messageIds - Array of message IDs
   * @returns Promise<Record<string, { actionTaken: EmailActionType, updatedAt: Date }>>
   */
  static async getActionsForMessages(
    emailAccountId: string,
    messageIds: string[]
  ): Promise<Record<string, { actionTaken: EmailActionType; updatedAt: Date }>> {
    if (messageIds.length === 0) {
      return {};
    }

    // Normalize all message IDs
    const normalizedMessageIds = messageIds.map(id => normalizeEmailId(id));

    const result = await pool.query(
      `SELECT message_id, action_taken, updated_at
       FROM email_action_tracking
       WHERE email_account_id = $1 AND message_id = ANY($2)`,
      [emailAccountId, normalizedMessageIds]
    );

    return result.rows.reduce((acc, row) => {
      acc[row.message_id] = {
        actionTaken: row.action_taken,
        updatedAt: row.updated_at
      };
      return acc;
    }, {} as Record<string, { actionTaken: EmailActionType; updatedAt: Date }>);
  }
}

// Export the normalize function for use in other modules if needed
export { normalizeEmailId };