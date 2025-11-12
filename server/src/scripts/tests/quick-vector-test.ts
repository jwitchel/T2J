#!/usr/bin/env tsx
/**
 * Quick Vector Search Test
 * Tests that VectorSearchService can search migrated data from PostgreSQL
 */

import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../../.env') });

import { Pool } from 'pg';
import { EmbeddingService } from '../../lib/vector/embedding-service';
import { VectorSearchService } from '../../lib/vector/vector-search-service';

const pool = new Pool({
  user: process.env.PGUSER || 'aiemailuser',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'aiemaildb',
  password: process.env.PGPASSWORD || 'aiemailpass',
  port: parseInt(process.env.PGPORT || '5434')
});

const embeddingService = new EmbeddingService();
const vectorSearchService = new VectorSearchService(pool);

async function runTest() {
  try {
    console.log('🧪 Quick Vector Search Test\n');

    // Initialize services
    console.log('1️⃣  Initializing services...');
    await embeddingService.initialize();
    await vectorSearchService.initialize();
    console.log('   ✅ Services initialized\n');

    // Get a user ID from the database
    console.log('2️⃣  Finding user with emails...');
    const userResult = await pool.query(`
      SELECT DISTINCT user_id
      FROM email_sent
      WHERE semantic_vector IS NOT NULL
      LIMIT 1
    `);

    if (userResult.rows.length === 0) {
      console.log('   ❌ No users with emails found');
      process.exit(1);
    }

    const userId = userResult.rows[0].user_id;
    console.log(`   ✅ Found user: ${userId}\n`);

    // Count their emails
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM email_sent WHERE user_id = $1',
      [userId]
    );
    console.log(`   📧 User has ${countResult.rows[0].count} sent emails\n`);

    // Test search
    console.log('3️⃣  Testing vector search...');
    const queryText = 'collaboration and project discussion';
    console.log(`   Query: "${queryText}"\n`);

    const searchResult = await vectorSearchService.search({
      userId,
      queryText,
      limit: 5,
      scoreThreshold: 0.0  // Accept all for testing
    });

    if (!searchResult.success) {
      console.log(`   ❌ Search failed: ${searchResult.error}`);
      process.exit(1);
    }

    console.log('   ✅ Search Results:\n');
    console.log(`   Found ${searchResult.documents.length} matches`);
    console.log(`   Stats:
      - Total candidates: ${searchResult.stats.totalCandidates}
      - Filtered count: ${searchResult.stats.filteredCount}
      - Avg semantic score: ${searchResult.stats.avgSemanticScore.toFixed(3)}
      - Search time: ${searchResult.stats.searchTimeMs}ms\n`);

    console.log('   Top matches:');
    searchResult.documents.slice(0, 3).forEach((doc, i) => {
      console.log(`\n   ${i + 1}. Score: ${doc.scores.combined.toFixed(3)}`);
      console.log(`      Subject: ${doc.metadata.subject || 'N/A'}`);
      console.log(`      To: ${doc.metadata.recipientEmail || 'N/A'}`);
      console.log(`      Date: ${doc.metadata.sentDate.toISOString().split('T')[0]}`);
      console.log(`      Preview: ${doc.text.substring(0, 100)}...`);
    });

    console.log('\n\n✅ All tests passed! Vector search is working with PostgreSQL data.\n');

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await pool.end();
    process.exit(1);
  }
}

runTest();
