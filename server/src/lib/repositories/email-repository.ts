/**
 * EmailRepository
 * Centralized database operations for email storage
 * Eliminates duplicate INSERT logic across the codebase
 */

import { Pool } from 'pg';

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

export interface SentEmailInsertParams {
  emailId: string;
  userId: string;
  emailAccountId: string;
  userReply: string;
  rawText: string;
  subject: string;
  recipientEmail: string;
  relationshipType: string;
  wordCount: number;
  sentDate: Date;
  semanticVector: number[];
  styleVector: number[];
  fullMessage: string;
}

export interface ReceivedEmailInsertParams {
  emailId: string;
  userId: string;
  emailAccountId: string;
  rawText: string;
  subject: string;
  senderEmail: string;
  senderName: string;
  wordCount: number;
  receivedDate: Date;
  semanticVector: number[];
  styleVector: number[];
  fullMessage: string;
}

export class EmailRepository {
  constructor(private pool: Pool) {}

  async insertSentEmail(params: SentEmailInsertParams): Promise<string> {
    // Normalize email ID to match email_action_tracking format
    const normalizedEmailId = normalizeEmailId(params.emailId);

    const result = await this.pool.query(`
      INSERT INTO email_sent (
        email_id, user_id, email_account_id, user_reply, raw_text,
        subject, recipient_email, relationship_type, word_count, sent_date,
        semantic_vector, style_vector, full_message,
        vector_generated_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), NOW())
      RETURNING id
    `, [
      normalizedEmailId,
      params.userId,
      params.emailAccountId,
      params.userReply,
      params.rawText,
      params.subject,
      params.recipientEmail,
      params.relationshipType,
      params.wordCount,
      params.sentDate,
      params.semanticVector,
      params.styleVector,
      params.fullMessage
    ]);
    return result.rows[0].id;
  }

  async insertReceivedEmail(params: ReceivedEmailInsertParams): Promise<void> {
    // Normalize email ID to match email_action_tracking format
    const normalizedEmailId = normalizeEmailId(params.emailId);

    await this.pool.query(`
      INSERT INTO email_received (
        email_id, user_id, email_account_id, raw_text, subject,
        sender_email, sender_name, word_count, received_date,
        semantic_vector, style_vector, full_message, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
    `, [
      normalizedEmailId,
      params.userId,
      params.emailAccountId,
      params.rawText,
      params.subject,
      params.senderEmail,
      params.senderName,
      params.wordCount,
      params.receivedDate,
      params.semanticVector,
      params.styleVector,
      params.fullMessage
    ]);
  }

  async sentEmailExists(emailId: string, userId: string, recipientEmail: string): Promise<boolean> {
    const normalizedEmailId = normalizeEmailId(emailId);
    const result = await this.pool.query(
      'SELECT 1 FROM email_sent WHERE email_id = $1 AND user_id = $2 AND recipient_email = $3',
      [normalizedEmailId, userId, recipientEmail]
    );
    return result.rows.length > 0;
  }

  async receivedEmailExists(emailId: string, userId: string, emailAccountId: string): Promise<boolean> {
    const normalizedEmailId = normalizeEmailId(emailId);
    const result = await this.pool.query(
      'SELECT 1 FROM email_received WHERE email_id = $1 AND user_id = $2 AND email_account_id = $3',
      [normalizedEmailId, userId, emailAccountId]
    );
    return result.rows.length > 0;
  }
}
