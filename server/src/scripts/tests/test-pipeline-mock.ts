#!/usr/bin/env node
import { EmailIngestPipeline } from '../../lib/pipeline/email-ingest-pipeline';
import { ExampleSelector } from '../../lib/pipeline/example-selector';
import { PromptFormatterV2 } from '../../lib/pipeline/prompt-formatter-v2';
import { extractEmailFeatures, ProcessedEmail } from '../../lib/pipeline/types';

// Mock implementations for testing without dependencies
class MockVectorStore {
  private storage: Map<string, any> = new Map();

  async initialize() {
    console.log('   MockVectorStore initialized');
  }

  async upsertEmail(params: any) {
    this.storage.set(params.id, params);
    return { success: true };
  }

  async searchSimilar(params: any) {
    // Return some mock results
    const mockResults = [
      {
        id: 'mock-1',
        score: 0.95,
        metadata: {
          userReply: "I'll be home by 7pm tonight!",
          relationship: { type: params.relationship },
          features: {
            stats: { formalityScore: 0.2 },
            sentiment: { dominant: 'positive' },
            urgency: { level: 'low' }
          },
          wordCount: 6
        }
      },
      {
        id: 'mock-2',
        score: 0.85,
        metadata: {
          userReply: "Running late, be there around 8",
          relationship: { type: params.relationship },
          features: {
            stats: { formalityScore: 0.1 },
            sentiment: { dominant: 'neutral' },
            urgency: { level: 'medium' }
          },
          wordCount: 7
        }
      }
    ];
    return mockResults;
  }
}

class MockEmbeddingService {
  async initialize() {
    console.log('   MockEmbeddingService initialized');
  }

  async embedText(text: string) {
    // Return a mock embedding
    return {
      vector: Array(384).fill(0).map(() => Math.random()),
      text
    };
  }
}

async function testPipelineWithMocks() {
  console.log('🧪 Testing Pipeline Components (with mocks)\n');

  // Create mock services
  const mockVectorStore = new MockVectorStore() as any;
  const mockEmbeddingService = new MockEmbeddingService() as any;
  const mockRelationshipDetector = {
    initialize: async () => console.log('   MockRelationshipDetector initialized'),
    detectRelationship: async (params: any) => ({
      relationship: params.recipientEmail.includes('gmail') ? 'friends' : 'colleagues',
      confidence: 0.85,
      method: 'mock'
    })
  } as any;
  const mockRelationshipService = {
    initialize: async () => console.log('   MockRelationshipService initialized'),
    getRelationshipProfile: async () => null
  } as any;
  
  const mockStyleAggregationService = {
    aggregateStyleForUser: async () => ({
      greetings: [],
      closings: [],
      emojis: [],
      contractions: { uses: false, frequency: 0, examples: [] },
      sentimentProfile: { primaryTone: 'neutral', averageWarmth: 0.5, averageFormality: 0.5 },
      vocabularyProfile: { complexityLevel: 'moderate', technicalTerms: [], commonPhrases: [] },
      structuralPatterns: { averageEmailLength: 100, averageSentenceLength: 15, paragraphingStyle: 'single' },
      emailCount: 0,
      lastUpdated: new Date().toISOString(),
      confidenceScore: 0
    }),
    updateStylePreferences: async () => console.log('   Mock style preferences updated')
  } as any;

  try {
    // Initialize
    console.log('1️⃣ Initializing mock services...');
    await mockVectorStore.initialize();
    await mockEmbeddingService.initialize();
    await mockRelationshipDetector.initialize();
    await mockRelationshipService.initialize();
    console.log('✅ Mock services initialized\n');

    // Test 1: Email Processing
    console.log('2️⃣ Testing individual email processing...');
    const ingestPipeline = new EmailIngestPipeline(
      mockEmbeddingService,
      mockRelationshipDetector,
      mockStyleAggregationService,
      {
        batchSize: 2,
        parallelism: 1,
        errorThreshold: 0.5
      }
    );

    const testEmailAccountId = 'test-account-id';

    const testEmail: ProcessedEmail = {
      uid: 'test-uid-1',
      messageId: 'test-email-1',
      inReplyTo: null,
      date: new Date(),
      from: [{ address: 'user@example.com', name: 'Test User' }],
      to: [{ address: 'friend@gmail.com', name: 'John Doe' }],
      cc: [],
      bcc: [],
      subject: 'Re: Lunch tomorrow?',
      textContent: "Sounds great! Let's meet at noon at our usual spot.",
      htmlContent: null,
      userReply: "Sounds great! Let's meet at noon at our usual spot.",
      respondedTo: '',
      fullMessage: '' // Test mock
    };

    // Process single email
    const result = await ingestPipeline.processEmail('test-user', testEmailAccountId, testEmail);
    console.log('✅ Email processed:', result);

    // Test feature extraction
    const features = extractEmailFeatures(testEmail.userReply);
    console.log('   Features extracted:', {
      wordCount: features.stats.wordCount,
      formality: features.stats.formalityScore,
      sentiment: features.sentiment.dominant
    });
    console.log('');

    // Test 2: Batch Processing
    console.log('3️⃣ Testing batch processing...');
    const batchEmails: ProcessedEmail[] = [
      {
        uid: 'batch-uid-1',
        messageId: 'batch-1',
        inReplyTo: null,
        date: new Date(),
        from: [{ address: 'user@example.com', name: 'Test User' }],
        to: [{ address: 'spouse@gmail.com', name: 'Spouse' }],
        cc: [],
        bcc: [],
        subject: 'Re: Groceries',
        textContent: "I'll pick up milk on my way home. Love you!",
        htmlContent: null,
        userReply: "I'll pick up milk on my way home. Love you!",
        respondedTo: '',
        fullMessage: '' // Test mock
      },
      {
        uid: 'batch-uid-2',
        messageId: 'batch-2',
        inReplyTo: null,
        date: new Date(),
        from: [{ address: 'user@example.com', name: 'Test User' }],
        to: [{ address: 'boss@company.com', name: 'Boss' }],
        cc: [],
        bcc: [],
        subject: 'Re: Q3 Report',
        textContent: "I've completed the analysis. The report is attached for your review.",
        htmlContent: null,
        userReply: "I've completed the analysis. The report is attached for your review.",
        respondedTo: '',
        fullMessage: '' // Test mock
      }
    ];

    const batchResult = await ingestPipeline.processHistoricalEmails('test-user', 'account-1', batchEmails);
    console.log('✅ Batch processing complete:', batchResult);
    console.log('');

    // Test 3: Example Selection
    console.log('4️⃣ Testing example selection...');
    // ExampleSelector now uses VectorSearchService internally
    const exampleSelector = new ExampleSelector(mockRelationshipDetector);

    const selectionResult = await exampleSelector.selectExamples({
      userId: 'test-user',
      incomingEmail: 'What time will you be home?',
      recipientEmail: 'spouse@gmail.com',
      desiredCount: 5
    });

    console.log('✅ Example selection complete:');
    console.log(`   - Relationship: ${selectionResult.relationship}`);
    console.log(`   - Examples found: ${selectionResult.examples.length}`);
    console.log(`   - Stats:`, selectionResult.stats);
    console.log('');

    // Test 4: Prompt Formatting
    console.log('5️⃣ Testing prompt formatting...');
    const promptFormatter = new PromptFormatterV2();
    await promptFormatter.initialize();
    
    const formattedPrompt = await promptFormatter.formatWithExamplesStructured({
      incomingEmail: 'What time will you be home?',
      recipientEmail: 'spouse@gmail.com',
      relationship: selectionResult.relationship,
      examples: selectionResult.examples,
      relationshipProfile: {
        typicalFormality: 'very casual',
        commonGreetings: ['Hey', 'Hi honey'],
        commonClosings: ['Love you', 'xoxo'],
        useEmojis: true,
        useHumor: true
      }
    });

    console.log('✅ Prompt formatted:');
    console.log(`   - Example count: ${formattedPrompt.metadata.exampleCount}`);
    console.log(`   - Relationship examples: ${formattedPrompt.metadata.relationshipExampleCount}`);
    console.log(`   - Has profile: ${formattedPrompt.metadata.hasRelationshipProfile}`);
    console.log(`   - Prompt length: ${formattedPrompt.prompt.length} chars`);
    
    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testPipelineWithMocks().catch(console.error);
}

export { testPipelineWithMocks };