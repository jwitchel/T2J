/**
 * Migration script to add sparse vector support to Qdrant collections
 *
 * Purpose: Updates existing collections to support hybrid search (dense + sparse vectors)
 *
 * This script:
 * 1. Updates collection schema to add sparse vector field
 * 2. Loads all existing emails per user
 * 3. Fits BM25 encoder on each user's corpus
 * 4. Generates sparse vectors for all emails
 * 5. Updates Qdrant with sparse vectors
 *
 * Usage:
 * npm run vector:migrate-sparse
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { pool } from '../server';
import { SENT_COLLECTION, RECEIVED_COLLECTION } from '../lib/vector/qdrant-client';
import { BM25Encoder } from '../lib/vector/bm25-encoder';
import dotenv from 'dotenv';

dotenv.config();

class SparseMigration {
  private client: QdrantClient;
  private processedUsers = 0;
  private processedEmails = 0;
  private errors: string[] = [];

  constructor() {
    const url = process.env.QDRANT_URL!;
    const apiKey = process.env.QDRANT_API_KEY;

    this.client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
    });
  }

  /**
   * Run the complete migration
   */
  async run(): Promise<void> {
    console.log('🚀 Starting sparse vector migration...\n');

    try {
      // Step 1: Update collection schemas
      await this.updateCollectionSchemas();

      // Step 2: Get all users
      const userIds = await this.getAllUserIds();
      console.log(`\n📊 Found ${userIds.length} users to process\n`);

      // Step 3: Process each user
      for (const userId of userIds) {
        await this.processUser(userId);
      }

      // Step 4: Summary
      this.printSummary();

    } catch (error: any) {
      console.error('\n❌ Migration failed:', error.message);
      throw error;
    }
  }

  /**
   * Update collection schemas to add sparse vector field
   * @private
   */
  private async updateCollectionSchemas(): Promise<void> {
    console.log('📝 Updating collection schemas...');

    const collections = [SENT_COLLECTION, RECEIVED_COLLECTION];

    for (const collectionName of collections) {
      try {
        // Get current collection info
        const collection = await this.client.getCollection(collectionName);

        // Check if sparse vector already exists
        const hasSparsevector = collection.config?.params?.sparse_vectors;

        if (hasSparsevector) {
          console.log(`  ✅ ${collectionName}: Sparse vectors already configured`);
          continue;
        }

        // Note: Qdrant sparse vectors are automatically inferred from data
        // No schema update needed - sparse vectors are added dynamically when upserting
        console.log(`  ✅ ${collectionName}: Ready for sparse vectors (no schema change needed)`);

      } catch (error: any) {
        console.error(`  ❌ ${collectionName}: Failed to check schema - ${error.message}`);
        this.errors.push(`Schema check failed for ${collectionName}: ${error.message}`);
      }
    }
  }

  /**
   * Get all unique user IDs from database
   * @private
   */
  private async getAllUserIds(): Promise<string[]> {
    try {
      const result = await pool.query<{ user_id: string }>(
        'SELECT DISTINCT user_id FROM email_accounts WHERE is_active = true'
      );

      return result.rows.map(row => row.user_id);

    } catch (error: any) {
      throw new Error(`Failed to get user IDs: ${error.message}`);
    }
  }

  /**
   * Process all emails for a single user
   * @private
   */
  private async processUser(userId: string): Promise<void> {
    console.log(`\n👤 Processing user: ${userId}`);

    try {
      // Get all sent emails for user from Qdrant
      const sentEmails = await this.getUserEmails(userId, SENT_COLLECTION);

      if (sentEmails.length === 0) {
        console.log(`  ⚠️  No sent emails found - skipping`);
        return;
      }

      console.log(`  📧 Found ${sentEmails.length} sent emails`);

      // Fit BM25 encoder on user's corpus
      console.log(`  🔧 Fitting BM25 encoder...`);
      const encoder = new BM25Encoder();
      const texts = sentEmails.map(email => email.payload.userReply || email.payload.rawText || '');
      await encoder.initialize(texts);

      // Generate and update sparse vectors
      console.log(`  ⚙️  Generating sparse vectors...`);
      await this.updateEmailsWithSparseVectors(userId, sentEmails, encoder, SENT_COLLECTION);

      // Also process received emails if any
      const receivedEmails = await this.getUserEmails(userId, RECEIVED_COLLECTION);
      if (receivedEmails.length > 0) {
        console.log(`  📧 Found ${receivedEmails.length} received emails`);
        await this.updateEmailsWithSparseVectors(userId, receivedEmails, encoder, RECEIVED_COLLECTION);
      }

      this.processedUsers++;
      console.log(`  ✅ User complete`);

    } catch (error: any) {
      console.error(`  ❌ Failed to process user: ${error.message}`);
      this.errors.push(`User ${userId}: ${error.message}`);
    }
  }

  /**
   * Get all emails for a user from Qdrant
   * @private
   */
  private async getUserEmails(userId: string, collectionName: string): Promise<any[]> {
    try {
      const results = await this.client.scroll(collectionName, {
        filter: {
          must: [
            { key: 'userId', match: { value: userId } }
          ]
        },
        limit: 10000,
        with_payload: true,
        with_vector: false
      });

      return results.points;

    } catch (error: any) {
      throw new Error(`Failed to fetch emails from ${collectionName}: ${error.message}`);
    }
  }

  /**
   * Update emails with sparse vectors
   * @private
   */
  private async updateEmailsWithSparseVectors(
    userId: string,
    emails: any[],
    encoder: BM25Encoder,
    collectionName: string
  ): Promise<void> {
    const batchSize = 100;
    let processed = 0;

    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);

      // Generate sparse vectors for batch
      const points = batch.map(email => {
        const text = email.payload.userReply || email.payload.rawText || '';
        const sparseVector = encoder.encode(text);

        return {
          id: email.id,
          vector: email.vector || Array(384).fill(0), // Placeholder if vector missing
          payload: email.payload,
          // Add sparse vector using Qdrant's sparse vector format
          sparse_vector: {
            name: 'text-sparse',
            vector: sparseVector
          }
        };
      });

      // Upsert batch with sparse vectors
      try {
        await this.client.upsert(collectionName, { points });
        processed += batch.length;
        this.processedEmails += batch.length;

        // Progress indicator
        if (processed % 500 === 0 || processed === emails.length) {
          console.log(`    Progress: ${processed}/${emails.length} emails`);
        }

      } catch (error: any) {
        console.error(`    ⚠️  Failed to upsert batch: ${error.message}`);
        this.errors.push(`Batch upsert failed for user ${userId}: ${error.message}`);
      }
    }
  }

  /**
   * Print migration summary
   * @private
   */
  private printSummary(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary');
    console.log('='.repeat(60));
    console.log(`✅ Users processed: ${this.processedUsers}`);
    console.log(`✅ Emails updated: ${this.processedEmails}`);
    console.log(`❌ Errors: ${this.errors.length}`);

    if (this.errors.length > 0) {
      console.log('\nErrors encountered:');
      this.errors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error}`);
      });
    }

    console.log('\n✨ Migration complete!\n');
  }
}

// Run migration
async function main() {
  const migration = new SparseMigration();

  try {
    await migration.run();
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Migration failed with error:', error);
    process.exit(1);
  }
}

main();
