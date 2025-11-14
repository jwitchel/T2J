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
import { simpleParser, ParsedMail } from 'mailparser';
import { EmailMessageWithRaw } from './imap-operations';
import { pool } from './db';
import { EmailRepository } from './repositories/email-repository';

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
      detectionMethod: string;
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

      // Parse raw message with mailparser
      const parsedEmail = await simpleParser(emailData.fullMessage);

      // Validate required parsed fields (fail fast)
      if (!parsedEmail.text || parsedEmail.text.trim() === '') {
        return {
          success: false,
          skipped: false,
          error: 'Email has no text content'
        };
      }

      if (!parsedEmail.subject || parsedEmail.subject.trim() === '') {
        return {
          success: false,
          skipped: false,
          error: 'Email has no subject'
        };
      }

      // Process email to extract user content (remove signatures, quotes)
      const processedContent = await this.emailProcessor.processEmail(parsedEmail, {
        userId,
        emailAccountId
      });

      // Check if we have user content to generate vectors
      const hasUserContent = processedContent.userReply && processedContent.userReply.trim() !== '';

      let redactedUserReply = '';
      let features: EmailFeatures | null = null;
      let semanticVector: number[] = [];
      let styleVector: number[] = [];

      if (hasUserContent) {
        // Redact names from user reply
        const redactionResult = nameRedactor.redactNames(processedContent.userReply);
        redactedUserReply = redactionResult.text;

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
        // No user content - use zero vectors but still save the email
        // This allows viewing emails in history even if they have no extractable content
        redactedUserReply = parsedEmail.text?.trim() || '';
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
                  relationship: params.llmResponse.relationship,
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
      redactedUserReply,
      features,
      semanticVector,
      styleVector,
      emailType,
      otherPartyEmail,
      otherPartyName
    } = params;

    try {
      // Generate unique email_id (the email's message-id)
      const messageId = emailData.messageId!;

      // Validate that we have the raw message (required for proper storage)
      validateRawMessage(emailData.fullMessage, `EmailStorage - ${messageId}`);

      // Check if already exists (deduplication) using repository
      const exists = emailType === 'sent'
        ? await this.emailRepository.sentEmailExists(messageId, userId, otherPartyEmail)
        : await this.emailRepository.receivedEmailExists(messageId, userId, emailAccountId);

      if (exists) {
        return false;
      }

      // Detect relationship (fail fast - throws on error)
      // Use default values if features are not available (emails without user content)
      const relationshipDetection = await this.relationshipDetector.detectRelationship({
        userId,
        recipientEmail: otherPartyEmail,
        subject: parsedEmail.subject,
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
      });

      // Store to PostgreSQL
      if (emailType === 'sent') {
        await this.emailRepository.insertSentEmail({
          emailId: messageId,
          userId,
          emailAccountId,
          userReply: redactedUserReply,
          rawText: parsedEmail.text!,  // Validated above at line 103
          subject: parsedEmail.subject!,  // Validated above at line 111
          recipientEmail: otherPartyEmail,
          relationshipType: relationshipDetection.relationship,
          wordCount: features?.stats.wordCount || 0,
          sentDate: emailData.date!,  // Validated above at line 89
          semanticVector,
          styleVector,
          fullMessage: emailData.fullMessage  // Validated at entry point
        });
      } else {
        // Incoming email - use email address as fallback if sender name is missing
        const finalSenderName = (otherPartyName && otherPartyName.trim() !== '')
          ? otherPartyName
          : otherPartyEmail;

        await this.emailRepository.insertReceivedEmail({
          emailId: messageId,
          userId,
          emailAccountId,
          rawText: parsedEmail.text!,  // Validated above at line 103
          subject: parsedEmail.subject!,  // Validated above at line 111
          senderEmail: otherPartyEmail,
          senderName: finalSenderName,  // Use email as fallback if name missing
          wordCount: features?.stats.wordCount || 0,
          receivedDate: emailData.date!,  // Validated above at line 89
          semanticVector,
          styleVector,
          fullMessage: emailData.fullMessage  // Validated at entry point
        });
      }

      return true;

    } catch (error: any) {
      // Handle duplicate key constraint silently (expected when re-loading emails)
      if (error?.code === '23505' && error?.constraint?.includes('email_id_key')) {
        // Duplicate email_id - this is expected, skip silently
        return false;
      }

      // Log other unexpected errors
      console.error('[EmailStorage] Error saving email entry:', error);
      return false;
    }
  }

}

// Singleton instance
export const emailStorageService = new EmailStorageService();
