/**
 * Inbox Worker
 * Processes inbox emails using InboxProcessor service
 */

import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { JobType, ProcessInboxJobData } from '../queue';
import { realTimeLogger } from '../real-time-logger';
import { inboxProcessor } from '../email-processing/inbox-processor';
import { pool } from '../../server';

const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null
});

async function processInboxJob(job: Job<ProcessInboxJobData>): Promise<any> {
  const { userId, accountId, fanOut, folderName, since } = job.data;

  // Check if this is a fan-out job (parent job that spawns child jobs)
  if (fanOut || !accountId) {
    console.log(`[InboxWorker] Processing fan-out job ${job.id}: Checking all monitored accounts`);

    try {
      // Get all monitored email accounts for this user
      const result = await pool.query(
        'SELECT id, email_address FROM email_accounts WHERE user_id = $1 AND monitoring_enabled = true',
        [userId]
      );

      console.log(`[InboxWorker] Fan-out job ${job.id}: Found ${result.rows.length} monitored accounts`);

      // Create child jobs for each monitored account
      const { addInboxJob } = await import('../queue');
      const { JobPriority } = await import('../queue');

      const childJobs = [];
      for (const row of result.rows) {
        const childJob = await addInboxJob(
          {
            userId,
            accountId: row.id,
            folderName: folderName || 'INBOX',
            since: since ? new Date(since) : undefined  // Convert ISO string to Date
          },
          JobPriority.HIGH
        );
        childJobs.push(childJob.id);
        console.log(`[InboxWorker] Created child job ${childJob.id} for ${row.email_address}`);
      }

      return {
        success: true,
        fanOut: true,
        accountsProcessed: result.rows.length,
        childJobs
      };
    } catch (error) {
      console.error(`[InboxWorker] Fan-out job ${job.id} failed:`, error);
      throw error;
    }
  }

  // Regular single-account inbox processing
  // Get email account info for logging
  const accountResult = await pool.query(
    'SELECT email_address FROM email_accounts WHERE id = $1',
    [accountId]
  );
  const emailAddress = accountResult.rows[0]?.email_address || 'unknown';

  // Log start
  realTimeLogger.log(userId, {
    userId,
    emailAccountId: accountId,
    level: 'info',
    command: 'WORKER_INBOX_START',
    data: {
      raw: `Starting inbox processing for ${emailAddress}`,
      parsed: { accountId, emailAddress }
    }
  });

  // Get user's default LLM provider
  const providerResult = await pool.query(
    'SELECT id FROM llm_providers WHERE user_id = $1 AND is_default = true AND is_active = true LIMIT 1',
    [userId]
  );

  if (providerResult.rows.length === 0) {
    throw new Error('No default LLM provider configured. Please set a default provider in settings.');
  }

  const providerId = providerResult.rows[0].id;
  const batchSize = parseInt(process.env.NEXT_PUBLIC_INBOX_BATCH_SIZE || '10', 10);

  // Process batch
  const result = await inboxProcessor.processBatch({
    accountId: accountId!,
    userId,
    providerId,
    batchSize,
    offset: 0,
    force: false,
    since: since ? new Date(since) : undefined  // Convert ISO string to Date
  });

  // Log completion
  realTimeLogger.log(userId, {
    userId,
    emailAccountId: accountId,
    level: 'info',
    command: 'WORKER_INBOX_COMPLETE',
    data: {
      raw: `Processed ${result.processed} emails for ${emailAddress} in ${result.elapsed}ms`,
      parsed: {
        accountId,
        emailAddress,
        processed: result.processed,
        elapsed: result.elapsed,
        results: result.results
      }
    }
  });

  // Return summary
  return {
    success: true,
    processed: result.processed,
    draftsGenerated: result.results.filter(r => !r.error && r.action && !r.action.startsWith('silent')).length,
    silentActions: result.results.filter(r => !r.error && r.action && r.action.startsWith('silent')).length,
    errors: result.results.filter(r => r.error).length,
    elapsed: result.elapsed
  };
}

const inboxWorker = new Worker(
  'inbox',
  async (job: Job) => {
    const { userId } = job.data;

    try {
      if (job.name !== JobType.PROCESS_INBOX) {
        throw new Error(`Unknown job type: ${job.name}`);
      }

      return await processInboxJob(job as Job<ProcessInboxJobData>);

    } catch (error) {
      // Log error once
      realTimeLogger.log(userId, {
        userId,
        emailAccountId: (job.data as ProcessInboxJobData).accountId || 'unknown',
        level: 'error',
        command: 'worker.error',
        data: {
          raw: `Job ${job.id} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          parsed: { jobId: job.id, jobName: job.name }
        }
      });

      throw error;
    }
  },
  {
    connection,
    concurrency: 5,
    autorun: false,
    // Increase lock duration for long-running email processing jobs
    // Each email can take 30-60s (spam check + 3 LLM calls + vector search + IMAP operations)
    lockDuration: 120000, // 2 minutes - max time a job can run
    lockRenewTime: 30000  // Renew lock every 30 seconds
  }
);

inboxWorker.on('completed', (job) => {
  const shortId = typeof job.id === 'string' && job.id.includes(':')
    ? job.id.split(':').slice(-1)[0]
    : job.id;
  console.log(`[InboxWorker] Job ${shortId} completed`);
});

inboxWorker.on('failed', (job, err) => {
  const shortId = job?.id && typeof job.id === 'string' && job.id.includes(':')
    ? job.id.split(':').slice(-1)[0]
    : job?.id;
  console.error(`[InboxWorker] Job ${shortId} failed:`, err);
});

export default inboxWorker;
