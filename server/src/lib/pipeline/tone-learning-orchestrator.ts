import { VectorStore } from '../vector/qdrant-client';
import { EmbeddingService } from '../vector/embedding-service';
import { ExampleSelector } from './example-selector';
import { PromptFormatterV2 } from './prompt-formatter-v2';
import { EmailIngestPipeline } from './email-ingest-pipeline';
import { ProcessedEmail, LLMDraftResult } from './types';
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

export interface DraftGenerationRequest {
  incomingEmail: ProcessedEmail;
  recipientEmail: string;
  config?: Partial<ToneLearningConfig>;
}

export class ToneLearningOrchestrator {
  private vectorStore: VectorStore;
  private embeddingService: EmbeddingService;
  private relationshipService: RelationshipService;
  private relationshipDetector: RelationshipDetector;
  private styleAggregationService: StyleAggregationService;
  private patternAnalyzer: WritingPatternAnalyzer;
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
   * Generate a draft reply using learned tone
   * Now uses a two-step process:
   * 1. Action analysis to determine what to do
   * 2. Response generation (if needed) with tone/style
   */
  async generateDraft(request: DraftGenerationRequest): Promise<LLMDraftResult> {
    const {
      incomingEmail,
      recipientEmail,
      config = {}
    } = request;
    
    const {
      userId,
      maxExamples = parseInt(process.env.EXAMPLE_COUNT || '25'),
      verbose = false,
      userNames
    } = config;
    
    if (!userId) {
      throw new Error('userId is required in config');
    }
    
    if (verbose) {
      console.log(chalk.bold('\n🤖 Generating Draft Reply\n'));
      console.log(chalk.gray('Incoming email:'));
      console.log(chalk.gray(`  From: ${incomingEmail.from[0]?.address}`));
      console.log(chalk.gray(`  Subject: ${incomingEmail.subject}`));
      console.log(chalk.gray(`  Text: ${incomingEmail.userReply.substring(0, 100)}...`));
    }
    
    // Step 1: Select relevant examples
    if (verbose) {
      console.log(chalk.blue('\n1️⃣ Selecting examples...'));
    }
    
    const exampleSelection = await this.exampleSelector.selectExamples({
      userId,
      incomingEmail: incomingEmail.userReply,
      recipientEmail,
      desiredCount: maxExamples
    });
    
    // Get the detected relationship
    const detectedRelationship = await this.relationshipDetector.detectRelationship({
      userId,
      recipientEmail
    });
    
    if (verbose) {
      console.log(chalk.gray(`  Found ${exampleSelection.examples.length} relevant examples`));
      console.log(chalk.gray(`  Primary relationship: ${exampleSelection.relationship}`));
      console.log(chalk.gray(`  Confidence: ${(detectedRelationship.confidence * 100).toFixed(1)}%`));
    }
    
    // Get enhanced profile with aggregated style
    const enhancedProfile = await this.relationshipService.getEnhancedProfile(
      userId,
      recipientEmail
    );
    
    // Step 2: Analyze writing patterns
    if (verbose) {
      console.log(chalk.blue('\n2️⃣ Analyzing writing patterns...'));
    }
    
    // Load existing patterns or analyze from user's sent emails
    let writingPatterns = await this.patternAnalyzer.loadPatterns(
      userId,
      exampleSelection.relationship
    );
    
    // If no patterns exist, analyze from available examples
    if (!writingPatterns && exampleSelection.examples.length > 0) {
      // Convert selected examples to ProcessedEmail format for analysis
      const emailsForAnalysis: ProcessedEmail[] = exampleSelection.examples.map(ex => ({
        uid: ex.id,
        messageId: ex.id,
        inReplyTo: null,
        date: new Date(ex.metadata.sentAt || Date.now()),
        from: [{ address: ex.metadata.senderEmail || '', name: '' }],
        to: [{ address: ex.metadata.recipientEmail || recipientEmail, name: '' }],
        cc: [],
        bcc: [],
        subject: ex.metadata.subject || '',
        textContent: ex.text,
        htmlContent: null,
        userReply: ex.text,
        respondedTo: ''
      }));
      
      writingPatterns = await this.patternAnalyzer.analyzeWritingPatterns(
        userId,
        emailsForAnalysis,
        exampleSelection.relationship
      );
      
      // Save patterns for future use
      await this.patternAnalyzer.savePatterns(
        userId,
        writingPatterns,
        exampleSelection.relationship,
        emailsForAnalysis.length
      );
    }
    
    if (verbose && writingPatterns) {
      console.log(chalk.gray(`  Patterns analyzed from ${exampleSelection.examples.length} emails`));
      console.log(chalk.gray(`  Sentence avg length: ${writingPatterns.sentencePatterns.avgLength.toFixed(1)} words`));
      console.log(chalk.gray(`  Unique expressions: ${writingPatterns.uniqueExpressions.length}`));
    }
    
    // Declare prompts at wider scope
    let metaContextPrompt = '';
    let actionPrompt = '';
    let responsePrompt = '';
    
    // Retry logic configuration
    const maxRetries = parseInt(process.env.LLM_ACTION_RETRIES || '1');
    let retryCount = 0;

    // Step 3: Meta-Context Analysis (First LLM Call)
    if (verbose) {
      console.log(chalk.blue('\n3️⃣ Analyzing email meta-context...'));
    }
    
    // Format prompt for meta-context analysis
    metaContextPrompt = await this.promptFormatter.formatMetaContextAnalysis({
      incomingEmail: incomingEmail.userReply,
      recipientEmail,
      userNames,
      incomingEmailMetadata: {
        from: incomingEmail.from,
        to: incomingEmail.to,
        cc: incomingEmail.cc,
        subject: incomingEmail.subject,
        date: incomingEmail.date
      }
    });
    
    // Use the pattern analyzer's LLM client
    if (!this.patternAnalyzer['llmClient']) {
      throw new Error('LLM client not initialized. Please configure an LLM provider.');
    }
    
    // Perform meta-context analysis with retry logic
    let metaContextAnalysis;
    retryCount = 0;
    
    while (retryCount <= maxRetries) {
      try {
        metaContextAnalysis = await this.patternAnalyzer['llmClient'].generateMetaContextAnalysis(metaContextPrompt);
        break; // Success, exit loop
      } catch (error: any) {
        if (error.message?.includes('JSON') && retryCount < maxRetries) {
          retryCount++;
          console.log(`[ToneLearning] Meta-context analysis failed, retrying (attempt ${retryCount + 1}/${maxRetries + 1})...`);
          continue;
        }
        throw error;
      }
    }
    
    if (!metaContextAnalysis) {
      throw new Error('Failed to analyze email meta-context after retries');
    }
    
    if (verbose) {
      console.log(chalk.green('  ✓ Meta-context analysis complete'));
      console.log(chalk.gray(`  Addressed to: ${metaContextAnalysis.meta.inboundMsgAddressedTo}`));
      console.log(chalk.gray(`  Urgency level: ${metaContextAnalysis.meta.urgencyLevel}`));
      console.log(chalk.gray(`  Request type: ${metaContextAnalysis.meta.inboundMsgIsRequesting}`));
      console.log(chalk.gray(`  Is threaded: ${metaContextAnalysis.meta.contextFlags.isThreaded}`));
    }
    
    // Step 4: Action Analysis (Second LLM Call)
    if (verbose) {
      console.log(chalk.blue('\n4️⃣ Determining email action...'));
    }
    
    // Format prompt for action analysis
    actionPrompt = await this.promptFormatter.formatActionAnalysis({
      incomingEmail: incomingEmail.userReply,
      recipientEmail,
      userNames,
      incomingEmailMetadata: {
        from: incomingEmail.from,
        to: incomingEmail.to,
        cc: incomingEmail.cc,
        subject: incomingEmail.subject,
        date: incomingEmail.date
      }
    });
    
    // Perform action analysis with retry logic
    let actionAnalysis;
    retryCount = 0;
    
    while (retryCount <= maxRetries) {
      try {
        actionAnalysis = await this.patternAnalyzer['llmClient'].generateActionAnalysis(actionPrompt);
        break; // Success, exit loop
      } catch (error: any) {
        if (error.message?.includes('JSON') && retryCount < maxRetries) {
          retryCount++;
          console.log(`[ToneLearning] Action analysis failed, retrying (attempt ${retryCount + 1}/${maxRetries + 1})...`);
          continue;
        }
        throw error;
      }
    }
    
    if (!actionAnalysis) {
      throw new Error('Failed to analyze email action after retries');
    }
    
    if (verbose) {
      console.log(chalk.green('  ✓ Action analysis complete'));
      console.log(chalk.gray(`  Recommended action: ${actionAnalysis.meta.recommendedAction}`));
      console.log(chalk.gray(`  Key considerations: ${actionAnalysis.meta.keyConsiderations.length} items`));
    }
    
    // Combine meta-context and action into full metadata (for backward compatibility)
    const combinedMeta = {
      ...metaContextAnalysis.meta,
      ...actionAnalysis.meta
    };
    
    // Check if we need to generate a response
    const ignoreActions = ['silent-fyi-only', 'silent-large-list', 'silent-unsubscribe', 'silent-spam'];
    const needsResponse = !ignoreActions.includes(combinedMeta.recommendedAction);
    
    let responseMessage = '';
    
    if (needsResponse) {
      // Step 5: Response Generation (Third LLM Call)
      if (verbose) {
        console.log(chalk.blue('\n5️⃣ Generating response with tone and style...'));
        if (enhancedProfile?.aggregatedStyle) {
          console.log(chalk.gray(`  Using aggregated style from ${enhancedProfile.aggregatedStyle.emailCount} emails`));
        }
      }
      
      // Format prompt for response generation
      responsePrompt = await this.promptFormatter.formatResponseGeneration({
        incomingEmail: incomingEmail.userReply,
        recipientEmail,
        examples: exampleSelection.examples,
        relationship: exampleSelection.relationship,
        relationshipProfile: enhancedProfile,
        writingPatterns,
        userNames,
        incomingEmailMetadata: {
          from: incomingEmail.from,
          to: incomingEmail.to,
          cc: incomingEmail.cc,
          subject: incomingEmail.subject,
          date: incomingEmail.date
        },
        actionMeta: combinedMeta
      });
      
      // Generate response with retry logic
      retryCount = 0;
      
      while (retryCount <= maxRetries) {
        try {
          responseMessage = await this.patternAnalyzer['llmClient'].generateResponseMessage(responsePrompt);
          break; // Success, exit loop
        } catch (error: any) {
          if (error.message?.includes('JSON') && retryCount < maxRetries) {
            retryCount++;
            console.log(`[ToneLearning] Response generation failed, retrying (attempt ${retryCount + 1}/${maxRetries + 1})...`);
            continue;
          }
          throw error;
        }
      }
      
      if (responseMessage === undefined) {
        throw new Error('Failed to generate response after retries');
      }
      
      if (verbose) {
        console.log(chalk.green('  ✓ Response generated successfully'));
        console.log(chalk.gray(`  Message length: ${responseMessage.length} characters`));
      }
    } else {
      if (verbose) {
        console.log(chalk.yellow('\n⏭️  Skipping response generation (silent action)'));
      }
    }
    
    // Combine the results
    const structuredResponse = {
      meta: combinedMeta,
      message: responseMessage
    };
    
    // Override relationship to 'external' for spam emails
    let finalRelationship = {
      type: exampleSelection.relationship,
      confidence: detectedRelationship.confidence,
      detectionMethod: detectedRelationship.method
    };
    
    if (combinedMeta.recommendedAction === 'silent-spam') {
      finalRelationship = {
        type: 'external',
        confidence: 0.9,
        detectionMethod: 'spam-override'
      };
    }
    
    const draft: LLMDraftResult = {
      id: `draft-${Date.now()}`,
      userId,
      incomingEmailId: incomingEmail.uid,
      recipientEmail,
      subject: `Re: ${incomingEmail.subject}`,
      body: structuredResponse.message,
      meta: structuredResponse.meta,
      relationship: finalRelationship,
      examplesUsed: exampleSelection.examples.map(e => e.id),
      metadata: {
        exampleCount: exampleSelection.examples.length,
        directCorrespondence: exampleSelection.stats.directCorrespondence,
        timestamp: new Date().toISOString()
      },
      createdAt: new Date()
    };
    
      console.log(chalk.green('\n✅ Draft generated successfully!\n'));    
    return draft;
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