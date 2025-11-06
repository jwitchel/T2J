/**
 * Backfill Script: Populate sender_response_stats from existing email_action_tracking data
 *
 * This script analyzes historical reply actions and populates the sender_response_stats table.
 * Run once after deploying the sender response tracking feature.
 *
 * Usage:
 *   npx ts-node server/src/scripts/backfill-sender-stats.ts
 */

import { pool } from '../server';

interface DraftAction {
  user_id: string;
  email_account_id: string;
  sender_email: string;
  created_at: Date;
}

async function backfillSenderResponseStats() {
  console.log('🚀 Starting sender response stats backfill...\n');

  try {
    // Step 1: Query all draft actions (user engagement) from email_action_tracking
    console.log('Step 1: Querying draft actions from email_action_tracking...');
    const draftActionsResult = await pool.query<DraftAction>(`
      SELECT
        user_id,
        email_account_id,
        sender_email,
        created_at
      FROM email_action_tracking
      WHERE action_taken IN ('reply', 'reply-all', 'forward', 'forward-with-comment')
        AND sender_email IS NOT NULL
        AND sender_email != ''
      ORDER BY user_id, email_account_id, sender_email, created_at ASC
    `);

    const draftActions = draftActionsResult.rows;
    console.log(`✓ Found ${draftActions.length} draft actions\n`);

    if (draftActions.length === 0) {
      console.log('No draft actions found. Nothing to backfill.');
      return;
    }

    // Step 2: Group by (user_id, email_account_id, sender_email)
    console.log('Step 2: Grouping by sender...');
    const senderStatsMap = new Map<string, {
      userId: string;
      emailAccountId: string;
      senderEmail: string;
      responseCount: number;
      firstResponseAt: Date;
      lastResponseAt: Date;
    }>();

    for (const action of draftActions) {
      const key = `${action.user_id}|${action.email_account_id}|${action.sender_email.toLowerCase()}`;

      if (!senderStatsMap.has(key)) {
        senderStatsMap.set(key, {
          userId: action.user_id,
          emailAccountId: action.email_account_id,
          senderEmail: action.sender_email.toLowerCase(),
          responseCount: 0,
          firstResponseAt: action.created_at,
          lastResponseAt: action.created_at
        });
      }

      const stats = senderStatsMap.get(key)!;
      stats.responseCount++;

      if (action.created_at < stats.firstResponseAt) {
        stats.firstResponseAt = action.created_at;
      }
      if (action.created_at > stats.lastResponseAt) {
        stats.lastResponseAt = action.created_at;
      }
    }

    console.log(`✓ Grouped into ${senderStatsMap.size} unique sender relationships\n`);

    // Step 3: Bulk insert into sender_response_stats
    console.log('Step 3: Inserting into sender_response_stats...');
    let inserted = 0;
    let updated = 0;
    let errors = 0;

    for (const stats of senderStatsMap.values()) {
      try {
        const result = await pool.query(`
          INSERT INTO sender_response_stats (
            user_id,
            email_account_id,
            sender_email,
            response_count,
            first_response_at,
            last_response_at,
            last_updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (user_id, email_account_id, sender_email)
          DO UPDATE SET
            response_count = EXCLUDED.response_count,
            first_response_at = EXCLUDED.first_response_at,
            last_response_at = EXCLUDED.last_response_at,
            last_updated_at = NOW()
          RETURNING (xmax = 0) AS inserted
        `, [
          stats.userId,
          stats.emailAccountId,
          stats.senderEmail,
          stats.responseCount,
          stats.firstResponseAt,
          stats.lastResponseAt
        ]);

        if (result.rows[0].inserted) {
          inserted++;
        } else {
          updated++;
        }

        // Progress indicator
        if ((inserted + updated) % 100 === 0) {
          process.stdout.write(`  Processed: ${inserted + updated} records...\r`);
        }
      } catch (error) {
        errors++;
        console.error(`\n❌ Error processing ${stats.senderEmail}:`, error);
      }
    }

    console.log(`\n✓ Backfill complete!\n`);
    console.log(`Summary:`);
    console.log(`  - Inserted: ${inserted} new records`);
    console.log(`  - Updated: ${updated} existing records`);
    console.log(`  - Errors: ${errors}`);
    console.log(`  - Total: ${inserted + updated} records processed\n`);

    // Step 4: Show sample data
    console.log('Sample of backfilled data:');
    const sampleResult = await pool.query(`
      SELECT
        sender_email,
        response_count,
        first_response_at,
        last_response_at
      FROM sender_response_stats
      ORDER BY response_count DESC
      LIMIT 5
    `);

    console.table(sampleResult.rows);

  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  }
}

// Run the backfill
backfillSenderResponseStats()
  .then(() => {
    console.log('✅ Backfill completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  });
