/**
 * EmailRepository
 * Centralized database operations for email storage
 * Eliminates duplicate INSERT logic across the codebase
 */

import { Pool } from 'pg';

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
  fullMessage: string;
}

export class EmailRepository {
  constructor(private pool: Pool) {}

  async insertSentEmail(params: SentEmailInsertParams): Promise<void> {
    await this.pool.query(`
      INSERT INTO email_sent (
        email_id, user_id, email_account_id, user_reply, raw_text,
        subject, recipient_email, relationship_type, word_count, sent_date,
        semantic_vector, full_message, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
    `, [
      params.emailId,
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
      params.fullMessage
    ]);
  }

  async insertReceivedEmail(params: ReceivedEmailInsertParams): Promise<void> {
    await this.pool.query(`
      INSERT INTO email_received (
        email_id, user_id, email_account_id, raw_text, subject,
        sender_email, sender_name, word_count, received_date,
        semantic_vector, full_message, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    `, [
      params.emailId,
      params.userId,
      params.emailAccountId,
      params.rawText,
      params.subject,
      params.senderEmail,
      params.senderName,
      params.wordCount,
      params.receivedDate,
      params.semanticVector,
      params.fullMessage
    ]);
  }

  async sentEmailExists(emailId: string, userId: string, recipientEmail: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM email_sent WHERE email_id = $1 AND user_id = $2 AND recipient_email = $3',
      [emailId, userId, recipientEmail]
    );
    return result.rows.length > 0;
  }

  async receivedEmailExists(emailId: string, userId: string, emailAccountId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM email_received WHERE email_id = $1 AND user_id = $2 AND email_account_id = $3',
      [emailId, userId, emailAccountId]
    );
    return result.rows.length > 0;
  }
}
