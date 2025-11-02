#!/usr/bin/env node
import { VectorStore } from '../../lib/vector/qdrant-client';
import { EmbeddingService } from '../../lib/vector/embedding-service';
import { RelationshipDetector } from '../../lib/relationships/relationship-detector';
import { RelationshipService } from '../../lib/relationships/relationship-service';
import { ExampleSelector } from '../../lib/pipeline/example-selector';
import { EmailIngestPipeline } from '../../lib/pipeline/email-ingest-pipeline';
import { ProcessedEmail } from '../../lib/pipeline/types';
import { StyleAggregationService } from '../../lib/style/style-aggregation-service';

async function testPipeline() {
  console.log('🚀 Testing Pipeline Components\n');

  // Initialize services
  const vectorStore = new VectorStore();
  const embeddingService = new EmbeddingService();
  const relationshipDetector = new RelationshipDetector();
  const relationshipService = new RelationshipService();

  try {
    // Initialize all services
    console.log('1️⃣ Initializing services...');
    await Promise.all([
      vectorStore.initialize(),
      embeddingService.initialize(),
      relationshipDetector.initialize(),
      relationshipService.initialize()
    ]);
    console.log('✅ Services initialized\n');

    // Test 1: Email Ingestion Pipeline
    console.log('2️⃣ Testing Email Ingestion Pipeline...');
    const ingestPipeline = new EmailIngestPipeline(
      vectorStore,
      embeddingService,
      relationshipDetector,
      new StyleAggregationService(vectorStore),
      {
        batchSize: 5,
        parallelism: 2,
        errorThreshold: 0.2
      }
    );

    // Create sample emails
    const sampleEmails: ProcessedEmail[] = [
      {
        uid: 'test-uid-1',
        messageId: 'test-1',
        inReplyTo: null,
        date: new Date(),
        from: [{ address: 'john@example.com', name: 'John' }],
        to: [{ address: 'wife@gmail.com', name: 'Sarah' }],
        cc: [],
        bcc: [],
        subject: 'Re: Dinner tonight?',
        textContent: "Hey honey! I'll be home by 7pm. Love you!",
        htmlContent: null,
        userReply: "Hey honey! I'll be home by 7pm. Love you!",
        respondedTo: '',
        rawMessage: '' // Test mock
      },
      {
        uid: 'test-uid-2',
        messageId: 'test-2',
        inReplyTo: null,
        date: new Date(),
        from: [{ address: 'john@example.com', name: 'John' }],
        to: [{ address: 'mike@techcorp.com', name: 'Mike Johnson' }],
        cc: [],
        bcc: [],
        subject: 'Re: Project update',
        textContent: "Hi Mike, I've reviewed the proposal and it looks good. Let's schedule a meeting to discuss next steps.",
        htmlContent: null,
        userReply: "Hi Mike, I've reviewed the proposal and it looks good. Let's schedule a meeting to discuss next steps.",
        respondedTo: '',
        rawMessage: '' // Test mock
      },
      {
        uid: 'test-uid-3',
        messageId: 'test-3',
        inReplyTo: null,
        date: new Date(),
        from: [{ address: 'john@example.com', name: 'John' }],
        to: [{ address: 'alex@gmail.com', name: 'Alex' }],
        cc: [],
        bcc: [],
        subject: 'Re: Weekend plans',
        textContent: "Hey dude! Yeah, I'm totally up for hiking on Saturday. What time works for you?",
        htmlContent: null,
        userReply: "Hey dude! Yeah, I'm totally up for hiking on Saturday. What time works for you?",
        respondedTo: '',
        rawMessage: '' // Test mock
      }
    ];

    // Process the emails
    const result = await ingestPipeline.processHistoricalEmails('test-user', 'test-account', sampleEmails);
    console.log('✅ Ingestion complete:', result);
    console.log(`   - Processed: ${result.processed} emails`);
    console.log(`   - Errors: ${result.errors}`);
    console.log(`   - Relationships:`, result.relationshipDistribution);
    console.log('');

    // Test 2: Example Selection
    console.log('3️⃣ Testing Example Selection...');
    const exampleSelector = new ExampleSelector(
      vectorStore,
      embeddingService,
      relationshipService,
      relationshipDetector
    );

    // Test selecting examples for a new email
    const incomingEmail = "When are you coming home tonight?";
    const recipientEmail = "wife@gmail.com";

    console.log(`   Incoming: "${incomingEmail}"`);
    console.log(`   To: ${recipientEmail}`);

    const examples = await exampleSelector.selectExamples({
      userId: 'test-user',
      incomingEmail,
      recipientEmail,
      desiredCount: 10
    });

    console.log('✅ Example selection complete:');
    console.log(`   - Detected relationship: ${examples.relationship}`);
    console.log(`   - Total candidates: ${examples.stats.totalCandidates}`);
    console.log(`   - Relationship matches: ${examples.stats.relationshipMatch}`);
    console.log(`   - Direct correspondence: ${examples.stats.directCorrespondence}`);
    console.log(`   - Selected ${examples.examples.length} examples:`);
    
    examples.examples.forEach((ex, i) => {
      console.log(`     ${i + 1}. "${ex.text.substring(0, 50)}..." (score: ${ex.score.toFixed(3)})`);
    });

    console.log('\n✅ All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testPipeline().catch(console.error);
}

export { testPipeline };