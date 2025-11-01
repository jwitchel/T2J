import { VectorStore } from '../vector/qdrant-client';
import { EmbeddingService } from '../vector/embedding-service';
import { ExampleSelector } from './example-selector';
import { PromptFormatterV2 } from './prompt-formatter-v2';
import { EmailIngestPipeline } from './email-ingest-pipeline';
import { ProcessedEmail } from './types';
import { RelationshipService } from '../relationships/relationship-service';
import { RelationshipDetector } from '../relationships/relationship-detector';
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
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService;
  private relationshipService: RelationshipService;
  private relationshipDetector: RelationshipDetector;
  private styleAggregationService: StyleAggregationService;
  private patternAnalyzer: WritingPatternAnalyzer;
  // @ts-ignore - Used via bracket notation in DraftGenerator
  private exampleSelector: ExampleSelector;
  private promptFormatter: PromptFormatterV2;
  private ingestionPipeline: EmailIngestPipeline;
  
  constructor() {
    this.vectorStore = new VectorStore();
    this.embeddingService = new EmbeddingService();
    this.relationshipService = new RelationshipService();
    this.relationshipDetector = new RelationshipDetector();
    this.styleAggregationService = new StyleAggregationService(this.vectorStore);
    this.patternAnalyzer = new WritingPatternAnalyzer();
    this.exampleSelector = new ExampleSelector(
      this.vectorStore, 
      this.embeddingService,
      this.relationshipService,
      this.relationshipDetector
    );
    this.promptFormatter = new PromptFormatterV2();
    this.ingestionPipeline = new EmailIngestPipeline(
      this.vectorStore,
      this.embeddingService,
      this.relationshipDetector,
      this.styleAggregationService,
      { 
        batchSize: parseInt(process.env.PIPELINE_BATCH_SIZE || '100'),
        parallelism: parseInt(process.env.PIPELINE_PARALLELISM || '5'),
        errorThreshold: parseFloat(process.env.PIPELINE_ERROR_THRESHOLD || '0.1')
      }
    );
  }
  
  async initialize(): Promise<void> {
    await this.vectorStore.initialize();
    await this.embeddingService.initialize();
    await this.promptFormatter.initialize();
    await this.patternAnalyzer.initialize();
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
    _emailAccountId: string,
    email: ProcessedEmail
  ): Promise<{ processed: number; errors: number }> {
    try {
      // Process the email directly without batching
      await this.ingestionPipeline.processEmail(userId, email);
      return { processed: 1, errors: 0 };
    } catch (error) {
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
    const relationshipTypes = ['friend', 'colleague', 'acquaintance', 'client', 'customer', 'vendor'];
    
    for (const relationshipType of relationshipTypes) {
      try {
        const aggregated = await this.styleAggregationService.aggregateStyleForUser(userId, relationshipType);
        if (aggregated.emailCount > 0) {
          await this.styleAggregationService.updateStylePreferences(userId, relationshipType, aggregated);
          console.log(`Updated style for ${relationshipType}: ${aggregated.emailCount} emails`);
        }
      } catch (error: any) {
        if (error.code !== '23503') { // PostgreSQL foreign key violation
          console.error(`Style aggregation failed for ${relationshipType}:`, error);
        }
      }
    }
  }
  
  /**
   * Process feedback on a generated draft
   */
  async processDraftFeedback(
    _draftId: string,
    _feedback: {
      edited: boolean;
      editDistance?: number;
      accepted: boolean;
      userRating?: number;
    }
  ): Promise<void> {
    // TODO: Implement feedback processing
    // This would update the usage statistics in the vector store
    console.log(chalk.yellow('📝 Feedback processing not yet implemented'));
  }
  
  /**
   * Load test data (John's emails)
   * @deprecated Use seed-demo.ts instead
   */
  async loadTestData(_userId: string = 'john-test-user'): Promise<void> {
    console.log('loadTestData is deprecated. Use npm run seed instead.');
  }
  
  /**
   * Clear all data for a user
   */
  async clearUserData(userId: string): Promise<void> {
    await this.vectorStore.deleteUserData(userId);
  }
  
  /**
   * Get statistics about learned tone
   */
  async getToneStatistics(userId: string): Promise<{
    totalEmails: number;
    relationships: Record<string, number>;
    exampleUsage: Map<string, { used: number; rating: number }>;
  }> {
    const relationshipStats = await this.vectorStore.getRelationshipStats(userId);
    const totalEmails = Object.values(relationshipStats).reduce((a, b) => a + b, 0);
    
    // TODO: Get example usage statistics from usage tracker
    const exampleUsage = new Map();
    
    return {
      totalEmails,
      relationships: relationshipStats,
      exampleUsage
    };
  }
}