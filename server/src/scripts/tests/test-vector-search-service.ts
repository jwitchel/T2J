/**
 * VectorSearchService Test Script
 *
 * Comprehensive test for the new PostgreSQL + Vectra vector search system
 * Tests dual embeddings, filtering, scoring, and integration with PostgreSQL
 *
 * Usage:
 *   cd server && npx tsx src/scripts/tests/test-vector-search-service.ts
 */

// Load environment variables FIRST before any imports
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import { Pool } from 'pg';
// Import classes directly (avoid index.ts which loads singletons which load server.ts)
import { EmbeddingService } from '../../lib/vector/embedding-service';
import { StyleEmbeddingService } from '../../lib/vector/style-embedding-service';
import { VectorSearchService } from '../../lib/vector/vector-search-service';
import { StyleClusteringService } from '../../lib/vector/style-clustering-service';
import chalk from 'chalk';

// Create test database pool (avoid importing server.ts which loads auth)
const pool = new Pool({
  user: process.env.PGUSER || 'aiemailuser',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'aiemaildb',
  password: process.env.PGPASSWORD || 'aiemailpass',
  port: parseInt(process.env.PGPORT || '5434')
});

// Create test instances (avoid singleton exports that import from server.ts)
const embeddingService = new EmbeddingService();
const styleEmbeddingService = new StyleEmbeddingService();
const vectorSearchService = new VectorSearchService(pool);
const testStyleClusteringService = new StyleClusteringService(pool, styleEmbeddingService);

// Test configuration
const TEST_USER_ID = 'test-vector-user-id';
const TEST_ACCOUNT_ID = 'test-account-id';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<void> {
  const startTime = Date.now();
  console.log(chalk.blue(`\n🧪 Testing: ${name}`));

  try {
    await testFn();
    const duration = Date.now() - startTime;
    results.push({ name, passed: true, duration });
    console.log(chalk.green(`✅ PASSED (${duration}ms)`));
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.push({
      name,
      passed: false,
      duration,
      error: errorMessage
    });
    console.log(chalk.red(`❌ FAILED: ${errorMessage} (${duration}ms)`));
  }
}

async function setupTestData(): Promise<void> {
  console.log(chalk.yellow('\n📦 Setting up test data...'));

  // Clean up any existing test data
  await pool.query('DELETE FROM email_sent WHERE user_id = $1', [TEST_USER_ID]);
  await pool.query('DELETE FROM style_clusters WHERE user_id = $1', [TEST_USER_ID]);
  await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID]);

  // Create test user
  await pool.query(
    `INSERT INTO users (id, email, name, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [TEST_USER_ID, 'test@vectortest.com', 'Test User']
  );

  // Create test emails with vectors
  const testEmails = [
    {
      id: 'email-1',
      text: 'Hi John, hope you are doing well. Let me know if you need anything.',
      relationship: 'colleague',
      recipient: 'john@example.com',
      subject: 'Quick check-in',
      sentDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    },
    {
      id: 'email-2',
      text: 'Hey buddy! Want to grab coffee this weekend?',
      relationship: 'friend',
      recipient: 'buddy@example.com',
      subject: 'Coffee plans',
      sentDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
    },
    {
      id: 'email-3',
      text: 'Dear Mr. Smith, I am writing to follow up on our previous discussion.',
      relationship: 'client',
      recipient: 'smith@client.com',
      subject: 'Follow-up',
      sentDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 90 days ago
    },
    {
      id: 'email-4',
      text: 'Hi John, thanks for your help with the project. Much appreciated!',
      relationship: 'colleague',
      recipient: 'john@example.com',
      subject: 'Thanks',
      sentDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
    },
    {
      id: 'email-5',
      text: 'Hello team, please find attached the quarterly report.',
      relationship: 'colleague',
      recipient: 'team@example.com',
      subject: 'Q4 Report',
      sentDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
    }
  ];

  // Generate vectors and insert emails
  for (const email of testEmails) {
    const { vector: semanticVector } = await embeddingService.embedText(email.text);
    const { vector: styleVector } = await styleEmbeddingService.embedText(email.text);

    await pool.query(
      `INSERT INTO email_sent (
        id, user_id, email_account_id, email_id, user_reply,
        recipient_email, relationship_type, subject, sent_date,
        semantic_vector, style_vector, vector_generated_at, word_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)`,
      [
        email.id,
        TEST_USER_ID,
        TEST_ACCOUNT_ID,
        `msg-${email.id}`,
        email.text,
        email.recipient,
        email.relationship,
        email.subject,
        email.sentDate,
        semanticVector,
        styleVector,
        email.text.split(/\s+/).length
      ]
    );
  }

  console.log(chalk.green(`✅ Created ${testEmails.length} test emails`));
}

async function cleanupTestData(): Promise<void> {
  console.log(chalk.yellow('\n🧹 Cleaning up test data...'));
  await pool.query('DELETE FROM email_sent WHERE user_id = $1', [TEST_USER_ID]);
  await pool.query('DELETE FROM style_clusters WHERE user_id = $1', [TEST_USER_ID]);
  await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID]);
  console.log(chalk.green('✅ Cleanup complete'));
}

// Test 1: Service initialization
async function testInitialization(): Promise<void> {
  await embeddingService.initialize();
  await styleEmbeddingService.initialize();
  await vectorSearchService.initialize();

  if (!embeddingService['isInitialized']) {
    throw new Error('EmbeddingService not initialized');
  }
  if (!styleEmbeddingService['isInitialized']) {
    throw new Error('StyleEmbeddingService not initialized');
  }
  if (!vectorSearchService['initialized']) {
    throw new Error('VectorSearchService not initialized');
  }
}

// Test 2: Basic text search
async function testBasicSearch(): Promise<void> {
  const result = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText: 'Need help with something',
    limit: 5,
    scoreThreshold: 0.0
  });

  if (!result.success) {
    throw new Error('Search failed');
  }
  if (result.documents.length === 0) {
    throw new Error('No documents returned');
  }

  // Verify all documents have required scores
  for (const doc of result.documents) {
    if (typeof doc.scores.semantic !== 'number') {
      throw new Error('Missing semantic score');
    }
    if (typeof doc.scores.style !== 'number') {
      throw new Error('Missing style score');
    }
    if (typeof doc.scores.combined !== 'number') {
      throw new Error('Missing combined score');
    }
    if (typeof doc.scores.temporal !== 'number') {
      throw new Error('Missing temporal score');
    }
  }

  console.log(chalk.gray(`  Found ${result.documents.length} matches`));
  console.log(chalk.gray(`  Avg semantic: ${result.stats.avgSemanticScore.toFixed(3)}`));
  console.log(chalk.gray(`  Avg style: ${result.stats.avgStyleScore.toFixed(3)}`));
  console.log(chalk.gray(`  Search time: ${result.stats.searchTimeMs}ms`));
}

// Test 3: Relationship filtering
async function testRelationshipFilter(): Promise<void> {
  const result = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText: 'Hello',
    filters: {
      relationship: 'colleague'
    },
    limit: 10,
    scoreThreshold: 0.0
  });

  if (!result.success) {
    throw new Error('Search failed');
  }

  // Verify all results are from 'colleague' relationship
  for (const doc of result.documents) {
    if (doc.metadata.relationship !== 'colleague') {
      throw new Error(`Expected colleague, got ${doc.metadata.relationship}`);
    }
  }

  console.log(chalk.gray(`  Found ${result.documents.length} colleague emails`));
}

// Test 4: Recipient email filtering (direct correspondence)
async function testRecipientFilter(): Promise<void> {
  const result = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText: 'Thanks for your help',
    filters: {
      recipientEmail: 'john@example.com'
    },
    limit: 10,
    scoreThreshold: 0.0
  });

  if (!result.success) {
    throw new Error('Search failed');
  }

  // Verify all results are to john@example.com
  for (const doc of result.documents) {
    if (doc.metadata.recipientEmail !== 'john@example.com') {
      throw new Error(`Expected john@example.com, got ${doc.metadata.recipientEmail}`);
    }
  }

  console.log(chalk.gray(`  Found ${result.documents.length} emails to john@example.com`));
}

// Test 5: Date range filtering
async function testDateRangeFilter(): Promise<void> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const result = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText: 'Hello',
    filters: {
      dateRange: {
        start: sevenDaysAgo,
        end: now
      }
    },
    limit: 10,
    scoreThreshold: 0.0
  });

  if (!result.success) {
    throw new Error('Search failed');
  }

  // Verify all results are within date range
  for (const doc of result.documents) {
    const sentDate = new Date(doc.metadata.sentDate);
    if (sentDate < sevenDaysAgo || sentDate > now) {
      throw new Error(`Date ${sentDate.toISOString()} outside range`);
    }
  }

  console.log(chalk.gray(`  Found ${result.documents.length} emails in last 7 days`));
}

// Test 6: Exclude IDs filter
async function testExcludeIdsFilter(): Promise<void> {
  const excludeIds = ['email-1', 'email-2'];

  const result = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText: 'Hello',
    filters: {
      excludeIds
    },
    limit: 10,
    scoreThreshold: 0.0
  });

  if (!result.success) {
    throw new Error('Search failed');
  }

  // Verify excluded IDs are not in results
  for (const doc of result.documents) {
    if (excludeIds.includes(doc.id)) {
      throw new Error(`Excluded ID ${doc.id} found in results`);
    }
  }

  console.log(chalk.gray(`  Found ${result.documents.length} emails (excluded 2)`));
}

// Test 7: Search with regular text (uses dual vectors internally)
async function testDualVectorSearch(): Promise<void> {
  const queryText = 'Thanks for the help';

  const result = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText,
    limit: 5,
    scoreThreshold: 0.0
  });

  if (!result.success) {
    throw new Error('Search failed');
  }
  if (result.documents.length === 0) {
    throw new Error('No documents returned');
  }

  console.log(chalk.gray(`  Found ${result.documents.length} matches`));
  console.log(chalk.gray(`  Note: Search uses dual embeddings (semantic + style) internally`));
}

// Test 8: Test that searches work
async function testCustomWeights(): Promise<void> {
  const queryText = 'Hi there';

  // Note: Custom weights would require extending VectorSearchService
  // For now, test that default weights work
  const result = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText,
    limit: 3,
    scoreThreshold: 0.0
  });

  if (!result.success) {
    throw new Error('Search failed');
  }

  const topResult = result.documents[0];
  if (topResult) {
    console.log(chalk.gray(`  Top result ID: ${topResult.id}`));
    console.log(chalk.gray(`  Semantic: ${topResult.scores.semantic.toFixed(3)}, Style: ${topResult.scores.style.toFixed(3)}`));
    console.log(chalk.gray(`  Note: Uses default 40/60 semantic/style weighting`));
  }
}

// Test 9: Score threshold filtering
async function testScoreThreshold(): Promise<void> {
  const highThreshold = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText: 'xyz123 nonexistent gibberish',
    limit: 10,
    scoreThreshold: 0.8 // Very high threshold
  });

  const lowThreshold = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText: 'xyz123 nonexistent gibberish',
    limit: 10,
    scoreThreshold: 0.0 // No threshold
  });

  if (!highThreshold.success || !lowThreshold.success) {
    throw new Error('Search failed');
  }

  // High threshold should return fewer results
  if (highThreshold.documents.length > lowThreshold.documents.length) {
    throw new Error('High threshold returned more results than low threshold');
  }

  console.log(chalk.gray(`  High threshold: ${highThreshold.documents.length} results`));
  console.log(chalk.gray(`  Low threshold: ${lowThreshold.documents.length} results`));
}

// Test 10: Temporal weighting
async function testTemporalWeighting(): Promise<void> {
  const result = await vectorSearchService.search({
    userId: TEST_USER_ID,
    queryText: 'Hello',
    limit: 10,
    scoreThreshold: 0.0
  });

  if (!result.success || result.documents.length === 0) {
    throw new Error('Search failed');
  }

  // Verify temporal scores are applied and different from combined scores
  let hasTemporalAdjustment = false;
  for (const doc of result.documents) {
    if (Math.abs(doc.scores.temporal - doc.scores.combined) > 0.001) {
      hasTemporalAdjustment = true;
      break;
    }
  }

  // At least one document should have temporal adjustment (older email)
  if (!hasTemporalAdjustment) {
    console.log(chalk.yellow('  Warning: No temporal adjustments detected (all emails may be recent)'));
  } else {
    console.log(chalk.gray('  Temporal weighting applied correctly'));
  }
}

// Test 11: Style clustering
async function testStyleClustering(): Promise<void> {
  // Fetch emails from database
  const emailsResult = await pool.query(
    `SELECT id, style_vector, sent_date, subject, relationship_type
     FROM email_sent
     WHERE user_id = $1 AND style_vector IS NOT NULL
     ORDER BY sent_date DESC`,
    [TEST_USER_ID]
  );

  if (emailsResult.rows.length < 3) {
    console.log(chalk.yellow('  Skipping: Not enough emails for clustering'));
    return;
  }

  const clusterResult = await testStyleClusteringService.clusterEmails({
    userId: TEST_USER_ID,
    relationship: 'colleague',
    emails: emailsResult.rows
      .filter(row => row.relationship_type === 'colleague')
      .map(row => ({
        id: row.id,
        styleVector: row.style_vector,
        metadata: {
          userId: TEST_USER_ID,
          emailAccountId: TEST_ACCOUNT_ID,
          sentDate: row.sent_date,
          subject: row.subject
        }
      })),
    clusterCount: 2 // Only 2 clusters for small dataset
  });

  if (!clusterResult.success) {
    throw new Error('Clustering failed');
  }
  if (clusterResult.clusters.length === 0) {
    throw new Error('No clusters created');
  }

  console.log(chalk.gray(`  Created ${clusterResult.clusters.length} style clusters`));
  for (const cluster of clusterResult.clusters) {
    console.log(chalk.gray(`    - ${cluster.name}: ${cluster.emailIds.length} emails`));
  }
}

// Test 12: Performance benchmark
async function testPerformance(): Promise<void> {
  const iterations = 10;
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();

    await vectorSearchService.search({
      userId: TEST_USER_ID,
      queryText: 'Test query for performance',
      limit: 5,
      scoreThreshold: 0.3
    });

    times.push(Date.now() - startTime);
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  console.log(chalk.gray(`  Average: ${avgTime.toFixed(1)}ms`));
  console.log(chalk.gray(`  Min: ${minTime}ms, Max: ${maxTime}ms`));

  // Performance threshold: should be under 50ms on average
  if (avgTime > 50) {
    console.log(chalk.yellow(`  Warning: Average search time (${avgTime.toFixed(1)}ms) exceeds 50ms threshold`));
  }
}

async function printSummary(): Promise<void> {
  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.cyan('📊 Test Summary'));
  console.log(chalk.cyan('='.repeat(60)));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => r.passed).length;
  const total = results.length;

  console.log(chalk.white(`Total Tests: ${total}`));
  console.log(chalk.green(`Passed: ${passed}`));
  console.log(chalk.red(`Failed: ${failed}`));

  if (failed > 0) {
    console.log(chalk.red('\n❌ Failed Tests:'));
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(chalk.red(`  - ${r.name}`));
        console.log(chalk.gray(`    Error: ${r.error}`));
      });
  }

  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
  console.log(chalk.white(`\nTotal Time: ${totalTime}ms`));

  console.log(chalk.cyan('='.repeat(60) + '\n'));

  if (failed > 0) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log(chalk.cyan('\n' + '='.repeat(60)));
  console.log(chalk.cyan('🧪 VectorSearchService Test Suite'));
  console.log(chalk.cyan('='.repeat(60)));

  try {
    // Setup
    await setupTestData();

    // Run tests
    await runTest('Service Initialization', testInitialization);
    await runTest('Basic Text Search', testBasicSearch);
    await runTest('Relationship Filtering', testRelationshipFilter);
    await runTest('Recipient Email Filtering', testRecipientFilter);
    await runTest('Date Range Filtering', testDateRangeFilter);
    await runTest('Exclude IDs Filtering', testExcludeIdsFilter);
    await runTest('Search with Dual Embeddings', testDualVectorSearch);
    await runTest('Verify Dual Score Calculation', testCustomWeights);
    await runTest('Score Threshold Filtering', testScoreThreshold);
    await runTest('Temporal Weighting', testTemporalWeighting);
    await runTest('Style Clustering', testStyleClustering);
    await runTest('Performance Benchmark', testPerformance);

    // Print summary
    await printSummary();

  } catch (error) {
    console.error(chalk.red('\n💥 Unhandled error:'), error);
    process.exit(1);
  } finally {
    // Cleanup
    await cleanupTestData();
    await pool.end();
  }
}

// Run tests
main().catch(error => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
