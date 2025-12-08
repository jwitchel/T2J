import { extractEmailFeatures, ProcessedEmail } from './types';
import { EmbeddingService } from '../vector/embedding-service';
import { StyleEmbeddingService } from '../vector/style-embedding-service';
import { RelationshipDetector } from '../relationships/relationship-detector';
import { withRetry } from './retry-utils';
import { StyleAggregationService } from '../style/style-aggregation-service';
import { nameRedactor } from '../name-redactor';
import { pool } from '../db';
import { EmailRepository } from '../repositories/email-repository';
import { validateRawMessage } from '../email-storage-service';
import { NameExtractor } from '../utils/name-extractor';
import { withTransaction } from '../db/transaction-utils';

export interface BatchResult {
  success: number;
  errors: number;
  relationships: string[];
}

export class EmailIngestPipeline {
  private emailRepository: EmailRepository;

  constructor(
    private embeddingService: EmbeddingService,
    private styleEmbeddingService: StyleEmbeddingService,
    private relationshipDetector: RelationshipDetector,
    private styleAggregation: StyleAggregationService,
    private config: {
      batchSize: number;
      parallelism: number;
      errorThreshold: number;
    }
  ) {
    this.emailRepository = new EmailRepository(pool);
  }
  
  async processHistoricalEmails(userId: string, emailAccountId: string, emails?: ProcessedEmail[]) {
    const startTime = Date.now();
    let processed = 0;
    let errors = 0;
    const relationshipStats: Record<string, number> = {};

    // For now, we'll process emails passed in directly
    // In the future, this will stream from IMAP
    if (!emails || emails.length === 0) {
      console.log('No emails provided for processing');
      return {
        processed: 0,
        errors: 0,
        duration: Date.now() - startTime,
        relationshipDistribution: {}
      };
    }

    for await (const batch of this._batchStream(this._asyncIterableFromArray(emails), this.config.batchSize)) {
      const results = await this._processBatch(userId, emailAccountId, batch);

      processed += results.success;
      errors += results.errors;

      results.relationships.forEach(rel => {
        relationshipStats[rel] = (relationshipStats[rel] || 0) + 1;
      });

      if (processed > 0 && errors / processed > this.config.errorThreshold) {
        throw new Error(`Error rate exceeded threshold: ${errors}/${processed}`);
      }

      if (processed % 100 === 0) {
        console.log(`Processed ${processed} emails. Relationships: ${JSON.stringify(relationshipStats)}`);
      }
    }

    console.log(`Historical processing complete. Total: ${processed}, Errors: ${errors}`);
    console.log('Relationship distribution:', relationshipStats);

    // Aggregate styles for each relationship type after all emails are processed
    console.log('Aggregating styles for each relationship type...');
    for (const [relationshipType, count] of Object.entries(relationshipStats)) {
      if (count > 0) {
        try {
          const aggregated = await this.styleAggregation.aggregateStyleForUser(userId, relationshipType);
          await this.styleAggregation.updateStylePreferences(userId, relationshipType, aggregated);
          console.log(`Updated style for ${userId} -> ${relationshipType}: ${aggregated.emailCount} emails`);
        } catch (error: unknown) {
          console.error(`Style aggregation failed for ${relationshipType}:`, error);
        }
      }
    }

    return {
      processed,
      errors,
      duration: Date.now() - startTime,
      relationshipDistribution: relationshipStats
    };
  }

  private async *_asyncIterableFromArray<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) {
      yield item;
    }
  }
  
  private async _processBatch(userId: string, emailAccountId: string, emails: ProcessedEmail[]): Promise<BatchResult> {
    const tasks = emails.map(email => this.processEmail(userId, emailAccountId, email));
    const results = await Promise.allSettled(tasks);
    
    const successful = results.filter(r => r.status === 'fulfilled');
    const relationships = successful.map(r => 
      (r as PromiseFulfilledResult<any>).value.relationship
    );
    
    return {
      success: successful.length,
      errors: results.filter(r => r.status === 'rejected').length,
      relationships
    };
  }
  
  async processEmail(userId: string, emailAccountId: string, email: ProcessedEmail) {
    // Validate that we have the raw message
    validateRawMessage(email.fullMessage, `Email Ingestion - ${email.messageId}`);

    // Handle emails without userReply - set placeholder for forwarded emails
    let userReplyToProcess = email.userReply;
    if (!userReplyToProcess) {
      userReplyToProcess = '[ForwardedWithoutComment]';
    }

    // Redact names from the user's reply text only
    const redactionResult = nameRedactor.redactNames(userReplyToProcess);
    const redactedUserReply = redactionResult.text;

    // Get all unique recipients (TO, CC, and BCC)
    const allRecipients = [
      ...email.to,
      ...email.cc,
      ...email.bcc
    ];

    // Remove duplicates based on email address
    const uniqueRecipients = Array.from(
      new Map(allRecipients.map(r => [r.address.toLowerCase(), r])).values()
    );

    if (uniqueRecipients.length === 0) {
      throw new Error(`[Email Ingestion] No recipients found for email ${email.messageId}`);
    }

    // Process the email for each unique recipient
    const results = await Promise.allSettled(
      uniqueRecipients.map(recipient =>
        this._processEmailForRecipient(userId, emailAccountId, email, recipient, redactedUserReply, redactionResult)
      )
    );
    
    // Collect successful relationships
    const relationships = results
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<any>).value.relationship);
    
    // Log any failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`[Email Ingestion] Failed to process ${failures.length}/${uniqueRecipients.length} recipients for email ${email.messageId}`);
    }
    
    // Return the first relationship for backward compatibility
    // In the future, we might want to return all relationships
    return { relationship: relationships[0] || 'professional' };
  }
  
  private async _processEmailForRecipient(
    userId: string,
    emailAccountId: string,
    email: ProcessedEmail,
    recipient: { address: string; name?: string },
    redactedUserReply: string,
    _redactionResult: any
  ) {

    // Extract NLP features from the redacted user reply ONLY
    // We ONLY analyze what the user actually wrote, not quoted content
    const features = extractEmailFeatures(redactedUserReply, {
      email: recipient.address,
      name: recipient.name
    });

    // Generate semantic embedding with retry - use the redacted user reply ONLY
    // We embed only what the user wrote, not any quoted content
    const { vector: semanticVector } = await withRetry(
      () => this.embeddingService.embedText(redactedUserReply),
      {
        onRetry: (error, attempt) => {
          console.warn(`Semantic embedding generation failed (attempt ${attempt}):`, error.message);
        }
      }
    );

    // Generate style embedding with retry - use the redacted user reply ONLY
    const { vector: styleVector } = await withRetry(
      () => this.styleEmbeddingService.embedText(redactedUserReply),
      {
        onRetry: (error, attempt) => {
          console.warn(`Style embedding generation failed (attempt ${attempt}):`, error.message);
        }
      }
    );

    // Use transaction to ensure person creation and email insertion are atomic
    return await withTransaction(pool, async (client) => {
      // Detect relationship (creates/finds person and returns personEmailId)
      // Use existing relationship if provided (e.g., from test data) for performance
      let relationship: { relationship: string; confidence: number; personEmailId: string };

      if (email.relationship?.type) {
        // Relationship already provided - find/create person with this relationship
        // This is an optimization for bulk ingestion or testing scenarios
        const { personService } = await import('../relationships/person-service');
        const person = await personService.findOrCreatePerson({
          userId,
          name: NameExtractor.extractName(recipient.address, recipient.name),
          emailAddress: recipient.address,
          relationshipType: email.relationship.type,
          confidence: email.relationship.confidence
        }, client);

        const primaryEmail = person.emails.find((e: any) => e.is_primary) || person.emails[0];
        if (!primaryEmail) {
          throw new Error(`Person ${person.id} has no email addresses`);
        }

        relationship = {
          relationship: email.relationship.type,
          confidence: email.relationship.confidence,
          personEmailId: primaryEmail.id
        };
      } else {
        // Detect relationship from email content and context
        relationship = await this.relationshipDetector.detectRelationship({
          userId,
          recipientEmail: recipient.address,
          recipientName: recipient.name,
          subject: email.subject,
          historicalContext: {
            familiarityLevel: features.relationshipHints.familiarityLevel,
            hasIntimacyMarkers: features.relationshipHints.intimacyMarkers.length > 0,
            hasProfessionalMarkers: features.relationshipHints.professionalMarkers.length > 0,
            formalityScore: features.stats.formalityScore
          }
        }, client);
      }

      // Check if email already exists for this recipient - use transaction client
      const exists = await this.emailRepository.sentEmailExists(
        email.messageId,
        userId,
        relationship.personEmailId,
        client
      );

      if (exists) {
        // Email already exists - commit handled by wrapper
        return { relationship: relationship.relationship };
      }

      // Insert new email with actual email_account_id
      await this.emailRepository.insertSentEmail({
        emailId: email.messageId,
        userId,
        emailAccountId,
        userReply: redactedUserReply,
        subject: email.subject,
        recipientPersonEmailId: relationship.personEmailId,  // FK to person_emails
        wordCount: features.stats.wordCount,
        sentDate: email.date,
        semanticVector,
        styleVector,
        fullMessage: email.fullMessage  // Validated above - cannot be empty
      }, client);

      return { relationship: relationship.relationship };
    }).catch((error: unknown) => {
      const emailPreview = email.textContent ? email.textContent.split(/\s+/).slice(0, 50).join(' ') : 'No content';
      const errorContext = `
Email Details:
- Message ID: ${email.messageId}
- From: ${email.from.map(f => f.address).join(', ')}
- To: ${email.to.map(t => t.address).join(', ')}
- CC: ${email.cc.map(c => c.address).join(', ') || 'none'}
- BCC: ${email.bcc.map(b => b.address).join(', ') || 'none'}
- Current Recipient: ${recipient.address}
- Subject: ${email.subject}
- Preview (first 50 words): ${emailPreview}...
      `.trim();

      console.error(`[Email Ingestion] Failed to process email for ${recipient.address}\n${errorContext}`);
      throw new Error(`${error instanceof Error ? error.message : 'Failed to process email'}\n${errorContext}`);
    });
  }

  private async *_batchStream<T>(
    stream: AsyncIterable<T>,
    batchSize: number
  ): AsyncGenerator<T[], void, unknown> {
    let batch: T[] = [];
    
    for await (const item of stream) {
      batch.push(item);
      
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    
    if (batch.length > 0) {
      yield batch;
    }
  }
}