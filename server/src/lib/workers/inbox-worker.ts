/**
 * Inbox Worker
 * Processes inbox emails using InboxProcessor service
 */

import { Worker, Job } from 'bullmq';
import { JobType, ProcessInboxJobData } from '../queue';
import { realTimeLogger } from '../real-time-logger';
import { inboxProcessor } from '../email-processing/inbox-processor';
import { pool } from '../db';
import { sharedConnection as connection } from '../redis-connection';

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
          JobPriority.HIGH,
          { isFanOut: false }  // Child jobs are specific account jobs, not fan-outs
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
    } catch (error: unknown) {
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
  const batchSize = parseInt(process.env.NEXT_PUBLIC_INBOX_BATCH_SIZE!, 10);

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

    } catch (error: unknown) {
      // Check if this is a permanent failure (account not found, user deleted account, etc.)
      // Permanent failures should not retry - they're configuration issues
      const isPermanent = error instanceof Error && (error as any).permanent === true;

      // Log error once
      realTimeLogger.log(userId, {
        userId,
        emailAccountId: (job.data as ProcessInboxJobData).accountId || 'unknown',
        level: 'error',
        command: 'worker.error',
        data: {
          raw: `Job ${job.id} failed${isPermanent ? ' (permanent)' : ''}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          parsed: { jobId: job.id, jobName: job.name, permanent: isPermanent }
        }
      });

      // For permanent failures, don't retry - just mark as failed
      if (isPermanent) {
        // BullMQ will not retry if we don't throw
        console.log(`[InboxWorker] Job ${job.id} marked as permanent failure - will not retry`);
        return {
          success: false,
          permanent: true,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }

      // For retryable errors (LLM timeout, network issues), throw to trigger retry
      throw error;
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.BULLMQ_INBOX_CONCURRENCY!),
    autorun: false,
    // Lock configuration from environment
    lockDuration: parseInt(process.env.BULLMQ_INBOX_LOCK_DURATION!),
    lockRenewTime: parseInt(process.env.BULLMQ_INBOX_LOCK_RENEW_TIME!),
    // Stalled job handling - critical for OS sleep/wake recovery
    stalledInterval: parseInt(process.env.BULLMQ_INBOX_STALLED_INTERVAL!),
    maxStalledCount: parseInt(process.env.BULLMQ_INBOX_MAX_STALLED_COUNT!),
    // Ensure stalled checks and lock renewal are enabled
    skipStalledCheck: false,
    skipLockRenewal: false
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

// Handle lock renewal errors (OS sleep/wake scenario)
inboxWorker.on('error', (err) => {
  if (err.message.includes('could not renew lock')) {
    // Extract job ID from error message if available (format: "Could not renew lock for job <id>")
    const jobIdMatch = err.message.match(/job\s+(\S+)/i);
    const jobId = jobIdMatch ? jobIdMatch[1] : 'unknown';
    console.warn(`[InboxWorker] Lock renewal failed for job ${jobId} - will be marked as stalled`);
  } else {
    console.error('[InboxWorker] Worker error:', err);
  }
});

// Handle stalled jobs
inboxWorker.on('stalled', (jobId) => {
  console.warn(`[InboxWorker] Job ${jobId} stalled - will be retried or failed based on maxStalledCount`);
});

export default inboxWorker;
