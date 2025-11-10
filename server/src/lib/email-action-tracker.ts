import { pool } from './db';
import { EmailActionType } from '../types/email-action-tracking';

/**
 * Centralized service for tracking email actions
 * This ensures consistency and prevents duplicate tracking
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
    try {
      await pool.query(
        `INSERT INTO email_action_tracking (user_id, email_account_id, message_id, action_taken, subject, destination_folder, uid, sender_email, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (email_account_id, message_id)
         DO UPDATE SET action_taken = $4, subject = $5, destination_folder = $6, uid = $7, sender_email = $8, updated_at = NOW()`,
        [userId, emailAccountId, messageId, actionTaken, subject, destinationFolder, uid, senderEmail]
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
   * Reset the action tracking for an email (mark as 'none')
   * @param emailAccountId - The email account ID
   * @param messageId - The message ID of the email
   * @returns Promise<void>
   */
  static async resetAction(
    emailAccountId: string,
    messageId: string
  ): Promise<void> {
    await pool.query(
      `DELETE FROM email_action_tracking 
       WHERE email_account_id = $1 AND message_id = $2`,
      [emailAccountId, messageId]
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

    const result = await pool.query(
      `SELECT message_id, action_taken, updated_at
       FROM email_action_tracking
       WHERE email_account_id = $1 AND message_id = ANY($2)`,
      [emailAccountId, messageIds]
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