/**
 * EmailRepository
 * Centralized database operations for email storage
 * Eliminates duplicate INSERT logic across the codebase
 */

import { Pool, PoolClient } from 'pg';
import { EmailActionType } from '../../types/email-action-tracking';

/**
 * Database query executor - uses transaction client if provided, otherwise uses pool
 */
type QueryExecutor = Pool | PoolClient;

/**
 * Normalize email message ID by removing angle brackets
 * Ensures consistency with email_action_tracking table
 * @param emailId - Raw message ID (may have angle brackets)
 * @returns Normalized message ID without angle brackets
 */
function normalizeEmailId(emailId: string): string {
  if (!emailId) return emailId;
  return emailId
    .trim()
    .replace(/^</, '')  // Remove leading angle bracket
    .replace(/>$/, ''); // Remove trailing angle bracket
}

/**
 * Parameters for inserting a sent email record
 * Uses FK to person_emails for referential integrity
 */
export interface SentEmailInsertParams {
  emailId: string;
  userId: string;
  emailAccountId: string;
  userReply: string;
  subject: string;
  recipientPersonEmailId: string;  // FK to person_emails(id)
  wordCount: number;
  sentDate: Date;
  semanticVector: number[];
  styleVector: number[];
  fullMessage: string;
}

/**
 * Parameters for inserting a received email record
 * Uses FK to person_emails for referential integrity
 */
export interface ReceivedEmailInsertParams {
  emailId: string;
  userId: string;
  emailAccountId: string;
  rawText: string;
  subject: string;
  senderPersonEmailId: string;  // FK to person_emails(id)
  wordCount: number;
  receivedDate: Date;
  semanticVector: number[];
  styleVector: number[];
  fullMessage: string;
  actionTaken: EmailActionType;
  destinationFolder: string | null;
  uid: number;
}

export class EmailRepository {
  constructor(private pool: Pool) {}

  /**
   * Insert sent email record
   * @param params - Email data to insert
   * @param client - Optional transaction client. If provided, operation is part of transaction.
   */
  async insertSentEmail(params: SentEmailInsertParams, client?: PoolClient): Promise<string> {
    const db: QueryExecutor = client || this.pool;
    const normalizedEmailId = normalizeEmailId(params.emailId);

    const result = await db.query(`
      INSERT INTO email_sent (
        email_id, user_id, email_account_id, user_reply,
        subject, recipient_person_email_id, word_count, sent_date,
        semantic_vector, style_vector, full_message,
        vector_generated_at, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING id
    `, [
      normalizedEmailId,
      params.userId,
      params.emailAccountId,
      params.userReply,
      params.subject,
      params.recipientPersonEmailId,
      params.wordCount,
      params.sentDate,
      params.semanticVector,
      params.styleVector,
      params.fullMessage
    ]);
    return result.rows[0].id;
  }

  /**
   * Insert received email record
   * @param params - Email data to insert
   * @param client - Optional transaction client. If provided, operation is part of transaction.
   */
  async insertReceivedEmail(params: ReceivedEmailInsertParams, client?: PoolClient): Promise<void> {
    const db: QueryExecutor = client || this.pool;
    const normalizedEmailId = normalizeEmailId(params.emailId);

    await db.query(`
      INSERT INTO email_received (
        email_id, user_id, email_account_id, raw_text, subject,
        sender_person_email_id, word_count, received_date,
        semantic_vector, style_vector, full_message,
        action_taken, destination_folder, uid,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
    `, [
      normalizedEmailId,
      params.userId,
      params.emailAccountId,
      params.rawText,
      params.subject,
      params.senderPersonEmailId,
      params.wordCount,
      params.receivedDate,
      params.semanticVector,
      params.styleVector,
      params.fullMessage,
      params.actionTaken,
      params.destinationFolder,
      params.uid
    ]);
  }

  async sentEmailExists(emailId: string, userId: string, recipientPersonEmailId: string, client?: PoolClient): Promise<boolean> {
    const normalizedEmailId = normalizeEmailId(emailId);
    const db: QueryExecutor = client || this.pool;
    const result = await db.query(
      'SELECT 1 FROM email_sent WHERE email_id = $1 AND user_id = $2 AND recipient_person_email_id = $3',
      [normalizedEmailId, userId, recipientPersonEmailId]
    );
    return result.rows.length > 0;
  }

  async receivedEmailExists(emailId: string, userId: string, emailAccountId: string, client?: PoolClient): Promise<boolean> {
    const normalizedEmailId = normalizeEmailId(emailId);
    const db: QueryExecutor = client || this.pool;
    const result = await db.query(
      'SELECT 1 FROM email_received WHERE email_id = $1 AND user_id = $2 AND email_account_id = $3',
      [normalizedEmailId, userId, emailAccountId]
    );
    return result.rows.length > 0;
  }

  /**
   * Batch insert sent emails
   * Uses UNNEST for efficient bulk insertion
   * @param emails - Array of email parameters to insert
   * @param client - Optional transaction client
   * @returns Number of emails inserted
   */
  async batchInsertSentEmails(emails: SentEmailInsertParams[], client?: PoolClient): Promise<number> {
    if (emails.length === 0) return 0;

    const db: QueryExecutor = client || this.pool;

    // Prepare arrays for UNNEST
    const emailIds = emails.map(e => normalizeEmailId(e.emailId));
    const userIds = emails.map(e => e.userId);
    const emailAccountIds = emails.map(e => e.emailAccountId);
    const userReplies = emails.map(e => e.userReply);
    const subjects = emails.map(e => e.subject);
    const recipientPersonEmailIds = emails.map(e => e.recipientPersonEmailId);
    const wordCounts = emails.map(e => e.wordCount);
    const sentDates = emails.map(e => e.sentDate);
    const semanticVectors = emails.map(e => e.semanticVector);
    const styleVectors = emails.map(e => e.styleVector);
    const fullMessages = emails.map(e => e.fullMessage);

    const result = await db.query(`
      INSERT INTO email_sent (
        email_id, user_id, email_account_id, user_reply,
        subject, recipient_person_email_id, word_count, sent_date,
        semantic_vector, style_vector, full_message,
        vector_generated_at, created_at
      )
      SELECT * FROM UNNEST(
        $1::text[], $2::text[], $3::uuid[], $4::text[],
        $5::text[], $6::uuid[], $7::integer[], $8::timestamp[],
        $9::real[][], $10::real[][], $11::text[]
      ) AS t(
        email_id, user_id, email_account_id, user_reply,
        subject, recipient_person_email_id, word_count, sent_date,
        semantic_vector, style_vector, full_message
      )
      WHERE NOT EXISTS (
        SELECT 1 FROM email_sent es
        WHERE es.email_id = t.email_id
          AND es.user_id = t.user_id
          AND es.recipient_person_email_id = t.recipient_person_email_id
      )
    `, [
      emailIds,
      userIds,
      emailAccountIds,
      userReplies,
      subjects,
      recipientPersonEmailIds,
      wordCounts,
      sentDates,
      semanticVectors,
      styleVectors,
      fullMessages
    ]);

    return result.rowCount || 0;
  }

  /**
   * Update the action taken for a received email
   * @param emailId - The message ID of the email
   * @param accountId - The email account ID
   * @param action - The action taken
   * @param destination - Optional destination folder
   * @param client - Optional transaction client
   */
  async updateReceivedEmailAction(
    emailId: string,
    accountId: string,
    action: EmailActionType,
    destination?: string,
    client?: PoolClient
  ): Promise<void> {
    const db: QueryExecutor = client || this.pool;
    const normalizedEmailId = normalizeEmailId(emailId);

    await db.query(`
      UPDATE email_received
      SET action_taken = $1,
          destination_folder = $2,
          updated_at = NOW()
      WHERE email_id = $3 AND email_account_id = $4
    `, [action, destination || null, normalizedEmailId, accountId]);
  }

  /**
   * Check if an email has been processed (action != 'pending')
   * @param userId - The user ID
   * @param accountId - The email account ID
   * @param emailId - The message ID of the email
   * @param client - Optional transaction client
   * @returns true if the email has been processed
   */
  async isReceivedEmailProcessed(
    userId: string,
    accountId: string,
    emailId: string,
    client?: PoolClient
  ): Promise<boolean> {
    const db: QueryExecutor = client || this.pool;
    const normalizedEmailId = normalizeEmailId(emailId);

    const result = await db.query(`
      SELECT 1 FROM email_received
      WHERE user_id = $1
        AND email_account_id = $2
        AND email_id = $3
        AND action_taken != $4
    `, [userId, accountId, normalizedEmailId, EmailActionType.PENDING]);

    return result.rows.length > 0;
  }

  /**
   * Get action information for multiple emails
   * @param accountId - The email account ID
   * @param emailIds - Array of message IDs
   * @param client - Optional transaction client
   * @returns Map of emailId to action info
   */
  async getReceivedEmailActions(
    accountId: string,
    emailIds: string[],
    client?: PoolClient
  ): Promise<Map<string, { action: EmailActionType; destination?: string }>> {
    const db: QueryExecutor = client || this.pool;
    const normalizedIds = emailIds.map(normalizeEmailId);

    const result = await db.query(`
      SELECT email_id, action_taken, destination_folder
      FROM email_received
      WHERE email_account_id = $1
        AND email_id = ANY($2)
    `, [accountId, normalizedIds]);

    const map = new Map<string, { action: EmailActionType; destination?: string }>();
    for (const row of result.rows) {
      map.set(row.email_id, {
        action: row.action_taken as EmailActionType,
        destination: row.destination_folder || undefined
      });
    }
    return map;
  }

  /**
   * Reset an email's action to 'pending' (for reprocessing)
   * @param accountId - The email account ID
   * @param emailId - The message ID of the email
   * @param client - Optional transaction client
   */
  async resetReceivedEmailAction(
    accountId: string,
    emailId: string,
    client?: PoolClient
  ): Promise<void> {
    const db: QueryExecutor = client || this.pool;
    const normalizedEmailId = normalizeEmailId(emailId);

    await db.query(`
      UPDATE email_received
      SET action_taken = $1,
          destination_folder = NULL,
          updated_at = NOW()
      WHERE email_id = $2 AND email_account_id = $3
    `, [EmailActionType.PENDING, normalizedEmailId, accountId]);
  }
}
