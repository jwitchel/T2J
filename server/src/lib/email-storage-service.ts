/**
 * EmailStorageService
 * Central service for storing emails to Qdrant vector database
 * Handles both incoming and sent emails with complete metadata
 * Used by inbox processing and tone training
 */

import { VectorStore, SENT_COLLECTION, RECEIVED_COLLECTION } from './vector/qdrant-client';
import { EmbeddingService } from './vector/embedding-service';
import { EmailProcessor } from './email-processor';
import { RelationshipDetector } from './relationships/relationship-detector';
import { nameRedactor } from './name-redactor';
import { extractEmailFeatures } from './pipeline/types';
import { simpleParser } from 'mailparser';
import { EmailMessageWithRaw } from './imap-operations';
import { pool } from '../server';

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
  };
}

export interface SaveEmailResult {
  success: boolean;
  skipped: boolean;
  saved?: number;  // Number of entries saved (sent emails can have multiple)
  error?: string;
}

export class EmailStorageService {
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService;
  private emailProcessor: EmailProcessor;
  private relationshipDetector: RelationshipDetector;

  constructor() {
    this.vectorStore = new VectorStore();
    this.embeddingService = new EmbeddingService();
    this.emailProcessor = new EmailProcessor(pool);
    this.relationshipDetector = new RelationshipDetector();
  }

  async initialize(): Promise<void> {
    await this.vectorStore.initialize();
    await this.embeddingService.initialize();
  }

  /**
   * Save an email to Qdrant with complete metadata
   * For sent emails: Creates one entry per recipient (TO/CC/BCC)
   * For incoming emails: Creates one entry with sender
   */
  async saveEmail(params: SaveEmailParams): Promise<SaveEmailResult> {
    const { userId, emailAccountId, emailData, emailType, folderName, llmResponse } = params;

    try {
      // Validate message ID
      if (!emailData.messageId) {
        return {
          success: false,
          skipped: false,
          error: 'Missing message-id'
        };
      }

      // Parse raw message with mailparser
      const parsedEmail = await simpleParser(emailData.rawMessage);

      // Build bodystructure from mailparser attachments
      const bodystructure = {
        contentType: parsedEmail.html ? 'text/html' : 'text/plain',
        hasAttachments: (parsedEmail.attachments?.length || 0) > 0,
        attachmentCount: parsedEmail.attachments?.length || 0,
        attachments: parsedEmail.attachments?.map(att => ({
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
          contentId: att.contentId
        })) || []
      };

      // Process email to extract user content (remove signatures, quotes)
      const processedContent = await this.emailProcessor.processEmail(parsedEmail, {
        userId,
        emailAccountId
      });

      // Validate that we have content to store
      if (!processedContent.userReply || processedContent.userReply.trim() === '') {
        return {
          success: true,
          skipped: true
        };
      }

      // Redact names from user reply
      const redactionResult = nameRedactor.redactNames(processedContent.userReply);
      const redactedUserReply = redactionResult.text;

      // Extract features from redacted text
      const features = extractEmailFeatures(redactedUserReply, {
        email: emailData.from || '',
        name: ''
      });

      // Generate embedding from redacted user reply
      const { vector } = await this.embeddingService.embedText(redactedUserReply);

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
            processedContent,
            redactedUserReply,
            redactionResult,
            features,
            vector,
            emailType,
            folderName,
            bodystructure,
            otherPartyEmail: recipient.address,
            otherPartyName: recipient.name,
            llmResponse
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
          processedContent,
          redactedUserReply,
          redactionResult,
          features,
          vector,
          emailType,
          folderName,
          bodystructure,
          otherPartyEmail: senderEmail,
          otherPartyName: senderName,
          llmResponse
        });

        if (saved) savedCount++;
      }

      return {
        success: true,
        skipped: false,
        saved: savedCount
      };

    } catch (error) {
      console.error('[EmailStorage] Error saving email:', error);
      return {
        success: false,
        skipped: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Save a single email entry to Qdrant
   * (For sent emails with multiple recipients, this is called once per recipient)
   */
  private async saveEmailEntry(params: {
    userId: string;
    emailAccountId: string;
    emailData: EmailMessageWithRaw;
    parsedEmail: any;
    processedContent: any;
    redactedUserReply: string;
    redactionResult: any;
    features: any;
    vector: number[];
    emailType: 'incoming' | 'sent';
    folderName: string;
    bodystructure: any;
    otherPartyEmail: string;
    otherPartyName?: string;
    llmResponse?: {
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
    };
  }): Promise<boolean> {
    const {
      userId,
      emailAccountId,
      emailData,
      parsedEmail,
      processedContent,
      redactedUserReply,
      redactionResult,
      features,
      vector,
      emailType,
      folderName,
      bodystructure,
      otherPartyEmail,
      otherPartyName,
      llmResponse
    } = params;

    try {
      // Generate unique ID (includes emailAccountId to prevent cross-account collisions)
      const emailId = this.generateEmailId(userId, emailAccountId, emailData.messageId!, otherPartyEmail);

      // Determine which collection to use based on email type
      const collectionName = emailType === 'sent' ? SENT_COLLECTION : RECEIVED_COLLECTION;

      // Check if already exists (deduplication)
      const exists = await this.vectorStore.pointExists(emailId, collectionName);
      if (exists) {
        return false;
      }

      // Detect relationship
      let relationship;
      try {
        relationship = await this.relationshipDetector.detectRelationship({
          userId,
          recipientEmail: otherPartyEmail,
          subject: parsedEmail.subject,
          historicalContext: {
            familiarityLevel: features.relationshipHints.familiarityLevel,
            hasIntimacyMarkers: features.relationshipHints.intimacyMarkers.length > 0,
            hasProfessionalMarkers: features.relationshipHints.professionalMarkers.length > 0,
            formalityScore: features.stats.formalityScore
          }
        });
      } catch (error) {
        console.error(`[EmailStorage] Relationship detection failed for ${otherPartyEmail}:`, error);
        // Default relationship if detection fails
        relationship = {
          relationship: 'professional',
          confidence: 0.5,
          method: 'default'
        };
      }

      // Build complete metadata
      const metadata = {
        emailId: emailData.messageId!,
        userId,
        emailAccountId,
        emailType,

        // Recipient/sender info
        recipientEmail: emailType === 'sent' ? otherPartyEmail : emailData.from || '',
        senderEmail: emailType === 'incoming' ? otherPartyEmail : undefined,
        senderName: emailType === 'incoming' ? otherPartyName : undefined,

        // Content
        subject: parsedEmail.subject || '',
        rawText: parsedEmail.text || '',
        userReply: redactedUserReply,
        respondedTo: processedContent.respondedTo || '',
        redactedNames: redactionResult.namesFound || [],
        redactedEmails: redactionResult.emailsFound || [],
        eml_file: emailData.rawMessage,

        // Envelope data
        from: emailData.from || '',
        to: emailData.to || [],
        cc: parsedEmail.cc ? (Array.isArray(parsedEmail.cc) ? parsedEmail.cc.value.map((r: any) => r.address) : [parsedEmail.cc.value?.address]) : undefined,
        bcc: parsedEmail.bcc ? (Array.isArray(parsedEmail.bcc) ? parsedEmail.bcc.value.map((r: any) => r.address) : [parsedEmail.bcc.value?.address]) : undefined,

        // IMAP metadata
        uid: emailData.uid,
        bodystructure,
        flags: emailData.flags,
        size: emailData.size,
        folderName,

        // Analysis
        features,
        relationship: {
          type: relationship.relationship,
          confidence: relationship.confidence,
          detectionMethod: relationship.method
        },
        wordCount: features.stats.wordCount,

        // LLM Response (AI evaluation metadata)
        llmResponse,

        // Timestamps
        sentDate: (emailData.date || new Date()).toISOString()
      };

      // Store to Qdrant
      await this.vectorStore.upsertEmail({
        id: emailId,
        userId,
        vector,
        metadata,
        collectionName
      });

      return true;

    } catch (error) {
      console.error('[EmailStorage] Error saving email entry:', error);
      return false;
    }
  }

  /**
   * Generate unique Qdrant point ID
   * Format: ${userId}-${emailAccountId}-${messageId}-${otherPartyEmail}
   * - For sent emails: otherPartyEmail = recipient
   * - For incoming emails: otherPartyEmail = sender
   * - emailAccountId ensures uniqueness when same user has multiple accounts
   */
  private generateEmailId(
    userId: string,
    emailAccountId: string,
    messageId: string,
    otherPartyEmail: string
  ): string {
    // Normalize email to lowercase for consistency
    const normalizedEmail = otherPartyEmail.toLowerCase();

    // Create unique ID including emailAccountId to prevent cross-account collisions
    return `${userId}-${emailAccountId}-${messageId}-${normalizedEmail}`;
  }
}

// Singleton instance
export const emailStorageService = new EmailStorageService();
