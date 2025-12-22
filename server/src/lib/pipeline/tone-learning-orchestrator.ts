import { vectorSearchService } from '../vector';
import { EmbeddingService } from '../vector/embedding-service';
import { StyleEmbeddingService } from '../vector/style-embedding-service';
import { ExampleSelector, ExampleSelectionResult } from './example-selector';
import { PromptFormatterV2 } from './prompt-formatter-v2';
import { EmailIngestPipeline } from './email-ingest-pipeline';
import { ProcessedEmail } from './types';
// import { RelationshipService } from '../relationships/relationship-service'; // No longer needed
import { RelationshipDetector, RelationshipType } from '../relationships/relationship-detector';
import { StyleAggregationService } from '../style/style-aggregation-service';
import { WritingPatternAnalyzer } from './writing-pattern-analyzer';
import chalk from 'chalk';

export interface ToneLearningConfig {
  userId: string;
  maxExamples?: number;
  verbose?: boolean;
  userNames?: {
    name: string;
    nicknames?: string;
  };
}

export class ToneLearningOrchestrator {
  private embeddingService: EmbeddingService;
  private styleEmbeddingService: StyleEmbeddingService;
  private relationshipDetector: RelationshipDetector;
  private styleAggregationService: StyleAggregationService;
  private patternAnalyzer: WritingPatternAnalyzer;
  private promptFormatter: PromptFormatterV2;
  private ingestionPipeline: EmailIngestPipeline;
  private exampleSelector: ExampleSelector;

  constructor(
    embeddingService?: EmbeddingService,
    styleEmbeddingService?: StyleEmbeddingService,
    relationshipDetector?: RelationshipDetector,
    styleAggregationService?: StyleAggregationService,
    patternAnalyzer?: WritingPatternAnalyzer,
    promptFormatter?: PromptFormatterV2,
    ingestionPipeline?: EmailIngestPipeline,
    exampleSelector?: ExampleSelector
  ) {
    this.embeddingService = embeddingService || new EmbeddingService();
    this.styleEmbeddingService = styleEmbeddingService || new StyleEmbeddingService();
    this.relationshipDetector = relationshipDetector || new RelationshipDetector();
    this.styleAggregationService = styleAggregationService || new StyleAggregationService();
    this.patternAnalyzer = patternAnalyzer || new WritingPatternAnalyzer();
    this.promptFormatter = promptFormatter || new PromptFormatterV2();
    this.exampleSelector = exampleSelector || new ExampleSelector(this.relationshipDetector);
    this.ingestionPipeline = ingestionPipeline || new EmailIngestPipeline(
      this.embeddingService,
      this.styleEmbeddingService,
      this.relationshipDetector,
      this.styleAggregationService,
      {
        batchSize: parseInt(process.env.PIPELINE_BATCH_SIZE || '100'),
        parallelism: parseInt(process.env.PIPELINE_PARALLELISM || '5'),
        errorThreshold: parseFloat(process.env.PIPELINE_ERROR_THRESHOLD || '0.1')
      }
    );
  }

  async initialize(userId: string): Promise<void> {
    await vectorSearchService.initialize();
    await this.embeddingService.initialize();
    await this.styleEmbeddingService.initialize();
    await this.promptFormatter.initialize();
    await this.patternAnalyzer.initialize(userId);
    await this.exampleSelector.initialize();
  }

  /**
   * Select examples for email draft generation
   */
  async selectExamples(params: {
    userId: string;
    incomingEmail: string;
    recipientEmail: string;
    desiredCount?: number;
  }): Promise<ExampleSelectionResult> {
    return this.exampleSelector.selectExamples(params);
  }

  /**
   * Ingest a batch of historical emails
   */
  async ingestHistoricalEmails(
    userId: string,
    emailAccountId: string,
    emails: ProcessedEmail[]
  ): Promise<{ processed: number; errors: number; duration: number; relationshipDistribution: Record<string, number> }> {
    if (process.env.NODE_ENV !== 'test') {
      console.log(chalk.blue(`📥 Ingesting ${emails.length} historical emails...`));
    }
    
    const result = await this.ingestionPipeline.processHistoricalEmails(
      userId,
      emailAccountId,
      emails
    );
    
    if (process.env.NODE_ENV !== 'test') {
      console.log(chalk.green('✅ Historical emails ingested'));
    }
    
    return result;
  }
  
  /**
   * Ingest a single email sequentially - bypasses batching
   */
  async ingestSingleEmail(
    userId: string,
    emailAccountId: string,
    email: ProcessedEmail
  ): Promise<{ processed: number; errors: number }> {
    try {
      // Process the email directly without batching
      await this.ingestionPipeline.processEmail(userId, emailAccountId, email);
      return { processed: 1, errors: 0 };
    } catch (error: unknown) {
      // Include email details in error message
      const emailPreview = email.textContent ? email.textContent.split(/\s+/).slice(0, 50).join(' ') : 'No content';
      const errorContext = `
Email Details:
- Message ID: ${email.messageId}
- From: ${email.from.map(f => f.address).join(', ')}
- To: ${email.to.map(t => t.address).join(', ')}
- Subject: ${email.subject}
- Preview (first 50 words): ${emailPreview}...
      `.trim();
      
      console.error(`Error processing single email:\n${errorContext}\n`, error);
      return { processed: 0, errors: 1 };
    }
  }
  
  /**
   * Aggregate styles for all relationship types for a user
   */
  async aggregateStyles(userId: string): Promise<void> {
    // Get all relationship types that have emails
    // Filter to only enum values (not namespace properties like PRIORITY, COLORS, etc.)
    const relationshipTypes = Object.values(RelationshipType).filter(
      (v): v is RelationshipType => typeof v === 'string'
    );
    
    for (const relationshipType of relationshipTypes) {
      try {
        const aggregated = await this.styleAggregationService.aggregateStyleForUser(userId, relationshipType);
        if (aggregated.emailCount > 0) {
          await this.styleAggregationService.updateStylePreferences(userId, relationshipType, aggregated);
          console.log(`Updated style for ${relationshipType}: ${aggregated.emailCount} emails`);
        }
      } catch (error: unknown) {
        console.error(`Style aggregation failed for ${relationshipType}:`, error);
      }
    }
  }
  
  /**
   * Clear all data for a user
   */
  async clearUserData(userId: string): Promise<void> {
    // Future: Delete from email_sent, email_received, tone_preferences, user_relationships
    console.warn(`[ToneLearning] User data deletion not yet implemented for user ${userId}`);
  }

  /**
   * Get statistics about learned tone
   */
  async getToneStatistics(userId: string): Promise<{
    totalEmails: number;
    relationships: Record<string, number>;
    exampleUsage: Map<string, { used: number; rating: number }>;
  }> {
    // Query PostgreSQL for email statistics
    const { pool } = await import('../db');

    // Get total emails count
    const totalResult = await pool.query(
      'SELECT COUNT(*) as count FROM email_sent WHERE user_id = $1',
      [userId]
    );
    // COUNT(*) always returns exactly one row
    const totalEmails = parseInt(totalResult.rows[0].count);

    // Get relationship breakdown
    const relationshipsResult = await pool.query(
      `SELECT relationship_type, COUNT(*) as count
       FROM email_sent
       WHERE user_id = $1
       GROUP BY relationship_type`,
      [userId]
    );

    const relationships: Record<string, number> = {};
    relationshipsResult.rows.forEach(row => {
      relationships[row.relationship_type] = parseInt(row.count);
    });

    // exampleUsage is not tracked in current system
    // Would require separate usage tracking table
    const exampleUsage = new Map<string, { used: number; rating: number }>();

    return {
      totalEmails,
      relationships,
      exampleUsage
    };
  }
}