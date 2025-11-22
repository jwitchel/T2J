/**
 * EmailStorageService
 * Central service for storing emails to PostgreSQL with vector embeddings
 * Handles both incoming and sent emails with complete metadata
 * Used by inbox processing and tone training
 */

import { vectorSearchService } from './vector';
import { EmbeddingService } from './vector/embedding-service';
import { StyleEmbeddingService } from './vector/style-embedding-service';
import { EmailProcessor } from './email-processor';
import { RelationshipDetector } from './relationships/relationship-detector';
import { nameRedactor } from './name-redactor';
import { extractEmailFeatures, EmailFeatures } from './pipeline/types';
import { ParsedMail } from 'mailparser';
import { EmailMessageWithRaw } from './imap-operations';
import { pool } from './db';
import { EmailRepository } from './repositories/email-repository';
import { EmailMarkers, hasActualUserContent } from './email-markers';
import { withTransaction } from './db/transaction-utils';

/**
 * Validates that a raw RFC 5322 email message exists and is non-empty
 *
 * @param fullMessage - The raw email message to validate
 * @param context - Context string for error messages (e.g., "Email Ingestion")
 * @returns The validated raw message (trimmed)
 * @throws Error if raw message is missing or empty
 */
export function validateRawMessage(
  fullMessage: string | null | undefined,
  context: string
): string {
  if (!fullMessage || fullMessage.trim() === '') {
    throw new Error(
      `[${context}] Missing raw RFC 5322 message. This is required for proper email storage.`
    );
  }
  return fullMessage;
}

export interface SaveEmailParams {
  userId: string;
  emailAccountId: string;
  emailData: EmailMessageWithRaw;
  emailType: 'incoming' | 'sent';
  folderName: string;
  llmResponse?: {  // AI evaluation metadata from draft generation
    meta: any;
    generatedAt: string;
    providerId: string;
    modelName: string;
    draftId: string;
    relationship: {
      type: string;
      confidence: number;
    };
    spamAnalysis: any;
    generatedContent: string;
  };
}

export interface SaveEmailResult {
  success: boolean;
  skipped: boolean;
  saved?: number;  // Number of entries saved (sent emails can have multiple)
  error?: string;
}

export class EmailStorageService {
  private embeddingService: EmbeddingService;
  private styleEmbeddingService: StyleEmbeddingService;
  private emailProcessor: EmailProcessor;
  private relationshipDetector: RelationshipDetector;
  private emailRepository: EmailRepository;

  constructor(
    embeddingService?: EmbeddingService,
    styleEmbeddingService?: StyleEmbeddingService,
    emailProcessor?: EmailProcessor,
    relationshipDetector?: RelationshipDetector,
    emailRepository?: EmailRepository
  ) {
    this.embeddingService = embeddingService || new EmbeddingService();
    this.styleEmbeddingService = styleEmbeddingService || new StyleEmbeddingService();
    this.emailProcessor = emailProcessor || new EmailProcessor(pool);
    this.relationshipDetector = relationshipDetector || new RelationshipDetector();
    this.emailRepository = emailRepository || new EmailRepository(pool);
  }

  public async initialize(): Promise<void> {
    await this.embeddingService.initialize();
    await this.styleEmbeddingService.initialize();
    await vectorSearchService.initialize();
  }

  /**
   * Process user reply and determine if email should be saved
   * Returns null if email should be skipped, otherwise returns the processed reply
   *
   * @param processedContent - Content from email processor
   * @param parsedEmail - Parsed email for attachment checking
   * @returns Processed user reply or null if should skip
   */
  private _processUserReply(
    processedContent: { userReply: string },
    parsedEmail: ParsedMail
  ): string | null {
    const hasUserContent = hasActualUserContent(processedContent.userReply);

    if (hasUserContent) {
      // Redact names and trim
      const redactionResult = nameRedactor.redactNames(processedContent.userReply);
      const redactedUserReply = redactionResult.text.trim();

      // If after trimming we have only whitespace, skip this email
      if (redactedUserReply === '') {
        return null;
      }

      return redactedUserReply;
    } else {
      // No user content - check if this is an attachment-only email
      const hasAttachments = parsedEmail.attachments && parsedEmail.attachments.length > 0;

      if (hasAttachments) {
        // Email has attachments but no body text - mark as attachment-only
        return EmailMarkers.ATTACHMENT_ONLY;
      } else {
        // No content and no attachments - skip this email
        return null;
      }
    }
  }

  /**
   * Save multiple emails in batch with optimized embedding generation
   * Batches embedding generation to reduce overhead and improve performance
   *
   * @param emailBatch - Array of email save parameters
   * @returns Array of save results
   */
  public async saveEmailBatch(emailBatch: SaveEmailParams[]): Promise<SaveEmailResult[]> {
    if (emailBatch.length === 0) {
      return [];
    }

    const startTime = Date.now();
    console.log(`\n[EmailStorage] ========================================`);
    console.log(`[EmailStorage] Starting batch processing of ${emailBatch.length} emails`);
    console.log(`[EmailStorage] ========================================\n`);

    // Step 1: Process all emails and extract text content
    const step1Start = Date.now();
    const processedEmails: Array<{
      params: SaveEmailParams;
      parsedEmail: ParsedMail;
      subject: string;
      redactedUserReply: string;
      features: EmailFeatures | null;
      hasUserContent: boolean;
    }> = [];

    for (const params of emailBatch) {
      const { emailData } = params;

      // Basic validation - skip invalid emails
      if (!emailData.messageId || !emailData.date) {
        continue;
      }

      const parsedEmail = emailData.parsed;
      if (!parsedEmail.text || parsedEmail.text.trim() === '') {
        continue;
      }

      const subject = parsedEmail.subject?.trim() || '';
      const processedContent = await this.emailProcessor.processEmail(parsedEmail, {
        userId: params.userId,
        emailAccountId: params.emailAccountId
      });

      // Process and validate user reply
      const redactedUserReply = this._processUserReply(processedContent, parsedEmail);
      if (redactedUserReply === null) {
        // Skip this email - no content
        continue;
      }

      const hasUserContent = hasActualUserContent(processedContent.userReply);
      const features = hasUserContent ? extractEmailFeatures(redactedUserReply, {
        email: emailData.from || '',
        name: ''
      }) : null;

      processedEmails.push({
        params,
        parsedEmail,
        subject,
        redactedUserReply,
        features,
        hasUserContent
      });
    }

    const step1Duration = Date.now() - step1Start;
    console.log(`[EmailStorage] Step 1 (Processing): ${step1Duration}ms - Processed ${processedEmails.length}/${emailBatch.length} valid emails`);

    // Step 2: Batch generate semantic embeddings for all emails with content
    const step2Start = Date.now();
    const textsForSemanticEmbedding = processedEmails
      .filter(e => e.hasUserContent)
      .map(e => e.redactedUserReply);

    let semanticEmbeddings: number[][] = [];
    let step2Duration = 0;
    if (textsForSemanticEmbedding.length > 0) {
      console.log(`[EmailStorage] Step 2: Generating semantic embeddings for ${textsForSemanticEmbedding.length} emails (batches of 50)...`);
      const result = await this.embeddingService.embedBatch(textsForSemanticEmbedding, { batchSize: 50 });
      semanticEmbeddings = result.embeddings.map(e => e.vector);
      step2Duration = Date.now() - step2Start;
      console.log(`[EmailStorage] Step 2 (Semantic Embeddings): ${step2Duration}ms - Generated ${semanticEmbeddings.length} embeddings`);
    } else {
      console.log(`[EmailStorage] Step 2: Skipped (no emails with user content)`);
    }

    // Step 3: Batch generate style embeddings for sent emails with content
    const step3Start = Date.now();
    const sentEmailsWithContent = processedEmails.filter(e => e.hasUserContent && e.params.emailType === 'sent');
    const textsForStyleEmbedding = sentEmailsWithContent.map(e => e.redactedUserReply);

    let styleEmbeddings: number[][] = [];
    let step3Duration = 0;
    if (textsForStyleEmbedding.length > 0) {
      console.log(`[EmailStorage] Step 3: Generating style embeddings for ${textsForStyleEmbedding.length} sent emails (batches of 50)...`);
      const result = await this.styleEmbeddingService.embedBatch(textsForStyleEmbedding, { batchSize: 50 });
      styleEmbeddings = result.embeddings.map(e => e.vector);
      step3Duration = Date.now() - step3Start;
      console.log(`[EmailStorage] Step 3 (Style Embeddings): ${step3Duration}ms - Generated ${styleEmbeddings.length} embeddings`);
    } else {
      console.log(`[EmailStorage] Step 3: Skipped (no sent emails with user content)`);
    }

    // Step 4: Map embeddings back to emails and save
    const step4Start = Date.now();
    console.log(`[EmailStorage] Step 4: Saving ${processedEmails.length} emails to database...`);

    const results: SaveEmailResult[] = [];
    let semanticIdx = 0;
    let styleIdx = 0;

    for (const processed of processedEmails) {
      const { params, parsedEmail, subject, redactedUserReply, features, hasUserContent } = processed;

      // Determine vectors for this email
      let semanticVector: number[];
      let styleVector: number[];

      if (hasUserContent) {
        semanticVector = semanticEmbeddings[semanticIdx++];
        styleVector = params.emailType === 'sent' ? styleEmbeddings[styleIdx++] : new Array(768).fill(0);
      } else {
        semanticVector = new Array(384).fill(0);
        styleVector = new Array(768).fill(0);
      }

      // Save email using the same logic as saveEmail but with pre-computed vectors
      const result = await this._saveWithPrecomputedVectors(
        params,
        parsedEmail,
        subject,
        redactedUserReply,
        features,
        semanticVector,
        styleVector
      );

      results.push(result);
    }

    const step4Duration = Date.now() - step4Start;
    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => r.success && !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const errorCount = results.filter(r => !r.success).length;

    console.log(`[EmailStorage] Step 4 (Database Save): ${step4Duration}ms - Saved ${successCount}, Skipped ${skippedCount}, Errors ${errorCount}`);
    console.log(`\n[EmailStorage] ========================================`);
    console.log(`[EmailStorage] BATCH COMPLETE: ${totalDuration}ms total`);
    console.log(`[EmailStorage]   - Step 1 (Processing):         ${step1Duration}ms`);
    console.log(`[EmailStorage]   - Step 2 (Semantic Embeddings): ${step2Duration}ms`);
    console.log(`[EmailStorage]   - Step 3 (Style Embeddings):    ${step3Duration}ms`);
    console.log(`[EmailStorage]   - Step 4 (Database):           ${step4Duration}ms`);
    console.log(`[EmailStorage]   - Success: ${successCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
    console.log(`[EmailStorage] ========================================\n`);

    return results;
  }

  /**
   * Internal helper to save email with pre-computed vectors
   * Used by saveEmailBatch to avoid re-generating embeddings
   */
  private async _saveWithPrecomputedVectors(
    params: SaveEmailParams,
    parsedEmail: ParsedMail,
    subject: string,
    redactedUserReply: string,
    features: EmailFeatures | null,
    semanticVector: number[],
    styleVector: number[]
  ): Promise<SaveEmailResult> {
    const { userId, emailAccountId, emailData, emailType } = params;

    try {
      // Determine recipients/senders based on email type
      let savedCount = 0;

      if (emailType === 'sent') {
        // For sent emails: Create one entry per recipient
        const getAddresses = (field: any) => {
          if (!field) return [];
          if (Array.isArray(field)) {
            return field.flatMap(f => f.value || []);
          }
          return field.value || [];
        };

        const allRecipients = [
          ...getAddresses(parsedEmail.to),
          ...getAddresses(parsedEmail.cc),
          ...getAddresses(parsedEmail.bcc)
        ];

        const uniqueRecipients = Array.from(
          new Map(allRecipients.map(r => [r.address?.toLowerCase(), r])).values()
        );

        if (uniqueRecipients.length === 0) {
          return {
            success: false,
            skipped: false,
            error: 'No recipients found for sent email'
          };
        }

        // Save one entry per recipient
        for (const recipient of uniqueRecipients) {
          if (!recipient.address) continue;

          const saved = await this.saveEmailEntry({
            userId,
            emailAccountId,
            emailData,
            parsedEmail,
            subject,
            redactedUserReply,
            features,
            semanticVector,
            styleVector,
            emailType,
            otherPartyEmail: recipient.address,
            otherPartyName: recipient.name
          });

          if (saved) savedCount++;
        }

      } else {
        // For incoming emails: Create one entry with sender
        const senderEmail = parsedEmail.from?.value[0]?.address;
        const senderName = parsedEmail.from?.value[0]?.name;

        if (!senderEmail) {
          return {
            success: false,
            skipped: false,
            error: 'No sender email found for incoming email'
          };
        }

        const saved = await this.saveEmailEntry({
          userId,
          emailAccountId,
          emailData,
          parsedEmail,
          subject,
          redactedUserReply,
          features,
          semanticVector,
          styleVector,
          emailType,
          otherPartyEmail: senderEmail,
          otherPartyName: senderName
        });

        if (saved) savedCount++;
      }

      return {
        success: true,
        skipped: false,
        saved: savedCount
      };

    } catch (error: unknown) {
      console.error('[EmailStorage] Error saving email:', error);
      return {
        success: false,
        skipped: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Save an email to PostgreSQL with complete metadata and vector embeddings
   * For sent emails: Creates one entry per recipient (TO/CC/BCC)
   * For incoming emails: Creates one entry with sender
   */
  public async saveEmail(params: SaveEmailParams): Promise<SaveEmailResult> {
    const { userId, emailAccountId, emailData, emailType } = params;

    try {
      // Validate message ID
      if (!emailData.messageId) {
        return {
          success: false,
          skipped: false,
          error: 'Missing message-id'
        };
      }

      // Validate email date (required for proper storage)
      if (!emailData.date) {
        return {
          success: false,
          skipped: false,
          error: 'Missing email date'
        };
      }

      // Use pre-parsed email from IMAP layer (avoids duplicate parsing)
      const parsedEmail = emailData.parsed;

      // Validate required parsed fields (fail fast)
      if (!parsedEmail.text || parsedEmail.text.trim() === '') {
        return {
          success: false,
          skipped: false,
          error: 'Email has no text content'
        };
      }

      // Subject is allowed to be empty - store as empty string
      const subject = parsedEmail.subject?.trim() || '';

      // Process email to extract user content (remove signatures, quotes)
      const processedContent = await this.emailProcessor.processEmail(parsedEmail, {
        userId,
        emailAccountId
      });

      // Process and validate user reply
      const redactedUserReply = this._processUserReply(processedContent, parsedEmail);
      if (redactedUserReply === null) {
        // Skip this email - no content
        return {
          success: true,
          skipped: true,
          error: 'Email has no content'
        };
      }

      // Check if we have user content to generate vectors
      const hasUserContent = hasActualUserContent(processedContent.userReply);
      let features: EmailFeatures | null = null;
      let semanticVector: number[] = [];
      let styleVector: number[] = [];

      if (hasUserContent) {
        // Extract features from redacted text
        features = extractEmailFeatures(redactedUserReply, {
          email: emailData.from || '',
          name: ''
        });

        // Generate semantic embedding from redacted user reply
        const embeddingResult = await this.embeddingService.embedText(redactedUserReply);
        semanticVector = embeddingResult.vector;

        // Generate style embedding (only for sent emails)
        styleVector = emailType === 'sent'
          ? (await this.styleEmbeddingService.embedText(redactedUserReply)).vector
          : new Array(768).fill(0);  // Incoming emails don't need style vectors
      } else {
        // Attachment-only email (already validated by _processUserReply)
        features = null;
        semanticVector = new Array(384).fill(0);  // Semantic embedding dimension
        styleVector = new Array(768).fill(0);     // Style embedding dimension
      }

      // Determine recipients/senders based on email type
      let savedCount = 0;

      if (emailType === 'sent') {
        // For sent emails: Create one entry per recipient
        // parsedEmail.to/cc/bcc can be AddressObject or AddressObject[]
        const getAddresses = (field: any) => {
          if (!field) return [];
          if (Array.isArray(field)) {
            return field.flatMap(f => f.value || []);
          }
          return field.value || [];
        };

        const allRecipients = [
          ...getAddresses(parsedEmail.to),
          ...getAddresses(parsedEmail.cc),
          ...getAddresses(parsedEmail.bcc)
        ];

        // Remove duplicates
        const uniqueRecipients = Array.from(
          new Map(allRecipients.map(r => [r.address?.toLowerCase(), r])).values()
        );

        if (uniqueRecipients.length === 0) {
          return {
            success: false,
            skipped: false,
            error: 'No recipients found for sent email'
          };
        }

        // Save one entry per recipient
        for (const recipient of uniqueRecipients) {
          if (!recipient.address) continue;

          const saved = await this.saveEmailEntry({
            userId,
            emailAccountId,
            emailData,
            parsedEmail,
            subject,
            redactedUserReply,
            features,
            semanticVector,
            styleVector,
            emailType,
            otherPartyEmail: recipient.address,
            otherPartyName: recipient.name
          });

          if (saved) savedCount++;
        }

      } else {
        // For incoming emails: Create one entry with sender
        const senderEmail = parsedEmail.from?.value[0]?.address;
        const senderName = parsedEmail.from?.value[0]?.name;

        if (!senderEmail) {
          return {
            success: false,
            skipped: false,
            error: 'No sender email found for incoming email'
          };
        }

        const saved = await this.saveEmailEntry({
          userId,
          emailAccountId,
          emailData,
          parsedEmail,
          subject,
          redactedUserReply,
          features,
          semanticVector,
          styleVector,
          emailType,
          otherPartyEmail: senderEmail,
          otherPartyName: senderName
        });

        if (saved) {
          savedCount++;

          // Save draft tracking data if LLM analysis was performed
          if (params.llmResponse) {
            try {
              await pool.query(`
                INSERT INTO draft_tracking (
                  user_id, email_account_id, original_message_id,
                  draft_message_id, generated_content, relationship_type,
                  context_data, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
              `, [
                userId,
                emailAccountId,
                emailData.messageId,
                params.llmResponse.draftId || null,  // Allow null for silent actions
                params.llmResponse.generatedContent || null,  // Allow null for silent actions
                params.llmResponse.relationship.type,
                JSON.stringify({
                  meta: params.llmResponse.meta,
                  providerId: params.llmResponse.providerId,
                  modelName: params.llmResponse.modelName,
                  spamAnalysis: params.llmResponse.spamAnalysis  // Include spam analysis
                })
              ]);
            } catch (draftError) {
              // Log but don't fail - draft tracking is supplementary data
              console.error('[EmailStorage] Failed to save draft tracking:', draftError);
              console.error('[EmailStorage] llmResponse data:', JSON.stringify(params.llmResponse, null, 2));
            }
          }
        }
      }

      return {
        success: true,
        skipped: false,
        saved: savedCount
      };

    } catch (error: unknown) {
      console.error('[EmailStorage] Error saving email:', error);
      return {
        success: false,
        skipped: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Save a single email entry to PostgreSQL with vector embeddings
   * (For sent emails with multiple recipients, this is called once per recipient)
   */
  private async saveEmailEntry(params: {
    userId: string;
    emailAccountId: string;
    emailData: EmailMessageWithRaw;
    parsedEmail: ParsedMail;
    subject: string;
    redactedUserReply: string;
    features: EmailFeatures | null;
    semanticVector: number[];
    styleVector: number[];
    emailType: 'incoming' | 'sent';
    otherPartyEmail: string;
    otherPartyName?: string;
  }): Promise<boolean> {
    const {
      userId,
      emailAccountId,
      emailData,
      parsedEmail,
      subject,
      redactedUserReply,
      features,
      semanticVector,
      styleVector,
      emailType,
      otherPartyEmail,
      otherPartyName
    } = params;

    // Use a database transaction to ensure person creation and email insertion are atomic
    return await withTransaction(pool, async (client) => {
      // Generate unique email_id (the email's message-id)
      const messageId = emailData.messageId!;

      // Validate that we have the raw message (required for proper storage)
      validateRawMessage(emailData.fullMessage, `EmailStorage - ${messageId}`);

      // Detect relationship (fail fast - throws on error)
      // Use default values if features are not available (emails without user content)
      // This creates/finds the person record and returns the person_email_id
      // Pass client to ensure person creation is part of the transaction
      const relationshipDetection = await this.relationshipDetector.detectRelationship({
        userId,
        recipientEmail: otherPartyEmail,
        recipientName: otherPartyName,
        subject,
        historicalContext: features ? {
          familiarityLevel: features.relationshipHints.familiarityLevel,
          hasIntimacyMarkers: features.relationshipHints.intimacyMarkers.length > 0,
          hasProfessionalMarkers: features.relationshipHints.professionalMarkers.length > 0,
          formalityScore: features.stats.formalityScore
        } : {
          familiarityLevel: 'unknown',
          hasIntimacyMarkers: false,
          hasProfessionalMarkers: false,
          formalityScore: 0.5
        }
      }, client);

      // Check if already exists (deduplication) using repository - use transaction client
      const exists = emailType === 'sent'
        ? await this.emailRepository.sentEmailExists(messageId, userId, relationshipDetection.personEmailId, client)
        : await this.emailRepository.receivedEmailExists(messageId, userId, emailAccountId, client);

      if (exists) {
        // Email already exists - commit person creation (if any) and skip
        // Note: commitAndRelease will be handled by withTransaction wrapper
        return false;
      }

      // Store to PostgreSQL - pass client to ensure it's part of the transaction
      if (emailType === 'sent') {
        await this.emailRepository.insertSentEmail({
          emailId: messageId,
          userId,
          emailAccountId,
          userReply: redactedUserReply,
          subject,  // Empty string if no subject
          recipientPersonEmailId: relationshipDetection.personEmailId,  // FK to person_emails
          wordCount: features?.stats.wordCount || 0,
          sentDate: emailData.date!,  // Validated above at line 115
          semanticVector,
          styleVector,
          fullMessage: emailData.fullMessage  // Validated at entry point
        }, client);
      } else {
        await this.emailRepository.insertReceivedEmail({
          emailId: messageId,
          userId,
          emailAccountId,
          rawText: parsedEmail.text!,  // Validated above at line 127
          subject,  // Empty string if no subject
          senderPersonEmailId: relationshipDetection.personEmailId,  // FK to person_emails
          wordCount: features?.stats.wordCount || 0,
          receivedDate: emailData.date!,  // Validated above at line 115
          semanticVector,
          styleVector,
          fullMessage: emailData.fullMessage  // Validated at entry point
        }, client);
      }

      return true;
    }).catch((error: any) => {
      // Handle duplicate key constraint - race condition where another transaction inserted first
      if (error?.code === '23505' && error?.constraint?.includes('email_id_key')) {
        // Another transaction beat us to it - our person creation was rolled back
        // (the other transaction already created person, so no data loss)
        return false;
      }
      // All other errors re-throw
      throw error;
    });
  }

}

// Singleton instance
export const emailStorageService = new EmailStorageService();
