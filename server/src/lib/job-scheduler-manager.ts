/**
 * JobScheduler Manager
 * Manages BullMQ JobSchedulers for automated background tasks
 */

import { sharedConnection } from './redis-connection';
import {
  inboxQueue,
  trainingQueue,
  JobType,
  JobPriority,
  ProcessInboxJobData,
  BuildToneProfileJobData
} from './queue';
import { Queue } from 'bullmq';

// Redis keys for storing scheduler state
const SCHEDULER_STATE_PREFIX = 'scheduler:';

// Scheduler IDs
export enum SchedulerId {
  CHECK_MAIL = 'check-mail',
  UPDATE_TONE = 'update-tone'
}

// Scheduler configuration
interface SchedulerConfig {
  id: SchedulerId;
  queue: Queue;
  interval: number;
  jobType: JobType;
  jobData: (userId: string, accountId: string) => Promise<ProcessInboxJobData | BuildToneProfileJobData>;
  jobOpts: { priority: JobPriority };
  description: string;
}

export class JobSchedulerManager {
  private static instance: JobSchedulerManager;
  private redis = sharedConnection;
  private schedulerConfigs: Map<string, SchedulerConfig> = new Map();

  private constructor() {

    // Initialize scheduler configurations
    this._initializeSchedulerConfigs();
  }

  static getInstance(): JobSchedulerManager {
    if (!JobSchedulerManager.instance) {
      JobSchedulerManager.instance = new JobSchedulerManager();
    }
    return JobSchedulerManager.instance;
  }

  private _initializeSchedulerConfigs(): void {
    // Check Mail scheduler configuration
    this.schedulerConfigs.set(SchedulerId.CHECK_MAIL, {
      id: SchedulerId.CHECK_MAIL,
      queue: inboxQueue,
      interval: parseInt(process.env.CHECK_MAIL_INTERVAL!),
      jobType: JobType.PROCESS_INBOX,
      jobData: async (userId: string, accountId: string) => ({
        userId,
        accountId,
        folderName: 'INBOX'
      }),
      jobOpts: { priority: JobPriority.NORMAL },
      description: 'Check for new emails'
    });

    // Update Tone scheduler configuration
    this.schedulerConfigs.set(SchedulerId.UPDATE_TONE, {
      id: SchedulerId.UPDATE_TONE,
      queue: trainingQueue,
      interval: parseInt(process.env.UPDATE_TONE_INTERVAL!),
      jobType: JobType.BUILD_TONE_PROFILE,
      jobData: async (userId: string, accountId: string) => ({
        userId,
        accountId,
        historyDays: 30
      }),
      jobOpts: { priority: JobPriority.LOW },
      description: 'Update tone profile'
    });
  }

  /**
   * Enable a scheduler for a specific user and account
   */
  async enableScheduler(schedulerId: string, userId: string, accountId: string): Promise<void> {
    // Trust caller - let fail naturally if schedulerId is invalid
    const config = this.schedulerConfigs.get(schedulerId)!;

    // Create or update the JobScheduler using BullMQ's native functionality
    // Note: JobScheduler ID includes userId AND accountId to make it unique per account
    const jobSchedulerId = `${schedulerId}-${accountId}`;

    await config.queue.upsertJobScheduler(
      jobSchedulerId,
      {
        every: config.interval, // Repeat interval in milliseconds
        immediately: false // Don't run immediately, wait for first interval
      },
      {
        name: config.jobType,
        data: await config.jobData(userId, accountId),
        opts: {
          ...config.jobOpts,
          // Let BullMQ's JobScheduler generate unique IDs automatically
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 }
        }
      }
    );

    // Store enabled state in Redis
    await this.redis.set(`${SCHEDULER_STATE_PREFIX}${jobSchedulerId}:enabled`, 'true');
    await this.redis.set(`${SCHEDULER_STATE_PREFIX}${jobSchedulerId}:userId`, userId);
    await this.redis.set(`${SCHEDULER_STATE_PREFIX}${jobSchedulerId}:accountId`, accountId);
  }

  /**
   * Disable a scheduler for a specific account
   * @param userId - Included for signature consistency with enableScheduler (not used internally)
   */
  async disableScheduler(schedulerId: string, _userId: string, accountId: string): Promise<void> {
    // Trust caller - let fail naturally if schedulerId is invalid
    const config = this.schedulerConfigs.get(schedulerId)!;

    // Remove the JobScheduler
    const jobSchedulerId = `${schedulerId}-${accountId}`;
    await config.queue.removeJobScheduler(jobSchedulerId);

    // Clean up state in Redis
    await this.redis.del(`${SCHEDULER_STATE_PREFIX}${jobSchedulerId}:enabled`);
    await this.redis.del(`${SCHEDULER_STATE_PREFIX}${jobSchedulerId}:userId`);
    await this.redis.del(`${SCHEDULER_STATE_PREFIX}${jobSchedulerId}:accountId`);
  }

  /**
   * Get the status of a specific scheduler for an account
   */
  async getSchedulerStatus(schedulerId: string, accountId: string): Promise<{
    id: string;
    enabled: boolean;
    interval: number;
    description: string;
    accountId: string;
    nextRun?: Date;
  } | null> {
    // Trust caller - let fail naturally if schedulerId is invalid
    const config = this.schedulerConfigs.get(schedulerId)!;

    const jobSchedulerId = `${schedulerId}-${accountId}`;

    // Get enabled state from Redis
    const enabledStr = await this.redis.get(`${SCHEDULER_STATE_PREFIX}${jobSchedulerId}:enabled`);
    const enabled = enabledStr === 'true';

    // Get scheduler details from BullMQ if enabled
    let nextRun: Date | undefined;
    if (enabled) {
      try {
        const schedulers = await config.queue.getJobSchedulers();
        const scheduler = schedulers.find(s => s.id === jobSchedulerId);
        if (scheduler && scheduler.next) {
          nextRun = new Date(scheduler.next);
        }
      } catch (error: unknown) {
        console.error(`Error getting scheduler details for ${jobSchedulerId}:`, error);
      }
    }

    return {
      id: schedulerId,
      enabled,
      interval: config.interval,
      description: config.description,
      accountId,
      nextRun
    };
  }

  /**
   * Get status of all schedulers for a user (across all their accounts)
   * Returns ALL possible schedulers (enabled and disabled) for all active accounts
   */
  async getAllSchedulerStatuses(userId: string): Promise<Array<{
    id: string;
    enabled: boolean;
    interval: number;
    description: string;
    accountId: string;
    nextRun?: Date;
  }>> {
    const statuses = [];

    // Import pool here to avoid circular dependencies
    const { pool } = await import('./db');

    // Get all email accounts for this user
    const result = await pool.query(
      'SELECT id FROM email_accounts WHERE user_id = $1',
      [userId]
    );

    // For each account, get status of all scheduler types
    for (const row of result.rows) {
      const accountId = row.id;

      // Get status for each scheduler type
      for (const schedulerId of this.schedulerConfigs.keys()) {
        try {
          const status = await this.getSchedulerStatus(schedulerId, accountId);
          if (status) {
            statuses.push(status);
          }
        } catch (error: unknown) {
          console.error(`Error getting status for scheduler ${schedulerId} account ${accountId}:`, error);
        }
      }
    }

    return statuses;
  }

  /**
   * Get global scheduler summary for a user
   * Returns aggregate information for each scheduler type
   */
  async getSchedulerSummary(userId: string): Promise<Array<{
    id: string;
    enabled: boolean;
    monitoredAccounts: number;
    interval: number;
    description: string;
    nextRun?: Date;
  }>> {
    const summary = [];

    // Import pool here to avoid circular dependencies
    const { pool } = await import('./db');

    // Get all monitored accounts for this user
    const result = await pool.query(
      'SELECT id FROM email_accounts WHERE user_id = $1 AND monitoring_enabled = true',
      [userId]
    );
    const monitoredAccountIds = result.rows.map(r => r.id);

    // For each scheduler type, get aggregate status
    for (const [schedulerId, config] of this.schedulerConfigs.entries()) {
      let enabled = false;
      let earliestNextRun: Date | undefined;

      // Check if ANY monitored account has this scheduler enabled
      for (const accountId of monitoredAccountIds) {
        const status = await this.getSchedulerStatus(schedulerId, accountId);
        if (status && status.enabled) {
          enabled = true;
          if (status.nextRun) {
            if (!earliestNextRun || status.nextRun < earliestNextRun) {
              earliestNextRun = status.nextRun;
            }
          }
        }
      }

      summary.push({
        id: schedulerId,
        enabled,
        monitoredAccounts: enabled ? monitoredAccountIds.length : 0,
        interval: config.interval,
        description: config.description,
        nextRun: earliestNextRun
      });
    }

    return summary;
  }

  /**
   * Enable a scheduler globally for all monitored accounts
   */
  async enableSchedulerGlobally(schedulerId: string, userId: string): Promise<number> {
    // Import pool here to avoid circular dependencies
    const { pool } = await import('./db');

    // Get all monitored accounts
    const result = await pool.query(
      'SELECT id, email_address FROM email_accounts WHERE user_id = $1 AND monitoring_enabled = true',
      [userId]
    );

    console.log(`[JobSchedulerManager] Enabling ${schedulerId} globally for ${result.rows.length} monitored accounts`);

    // Enable scheduler for each monitored account
    for (const row of result.rows) {
      try {
        await this.enableScheduler(schedulerId, userId, row.id);
      } catch (error: unknown) {
        console.error(`[JobSchedulerManager] Failed to enable ${schedulerId} for ${row.email_address}:`, error);
      }
    }

    return result.rows.length;
  }

  /**
   * Disable a scheduler globally for all accounts
   */
  async disableSchedulerGlobally(schedulerId: string, userId: string): Promise<number> {
    // Import pool here to avoid circular dependencies
    const { pool } = await import('./db');

    // Get all accounts (not just monitored - we want to disable any that have it enabled)
    const result = await pool.query(
      'SELECT id, email_address FROM email_accounts WHERE user_id = $1',
      [userId]
    );

    console.log(`[JobSchedulerManager] Disabling ${schedulerId} globally for ${result.rows.length} accounts`);

    let disabledCount = 0;
    // Disable scheduler for each account
    for (const row of result.rows) {
      try {
        // Check if scheduler exists before trying to disable
        const status = await this.getSchedulerStatus(schedulerId, row.id);
        if (status && status.enabled) {
          await this.disableScheduler(schedulerId, userId, row.id);
          disabledCount++;
        }
      } catch (error: unknown) {
        console.error(`[JobSchedulerManager] Failed to disable ${schedulerId} for ${row.email_address}:`, error);
      }
    }

    return disabledCount;
  }

  /**
   * Initialize schedulers for a user based on email_accounts.monitoring_enabled
   * This syncs the schedulers with the database state by:
   * 1. Enabling schedulers for accounts with monitoring_enabled = true
   * 2. Disabling schedulers for accounts with monitoring_enabled = false
   */
  async initializeUserSchedulers(userId: string): Promise<void> {
    // Import pool here to avoid circular dependencies
    const { pool } = await import('./db');

    // Get user's name for logging (user exists - validated by auth)
    const userResult = await pool.query('SELECT name FROM "user" WHERE id = $1', [userId]);
    const userName = userResult.rows[0].name;

    // Query ALL accounts for this user with email addresses
    const result = await pool.query(
      'SELECT id, email_address, monitoring_enabled FROM email_accounts WHERE user_id = $1',
      [userId]
    );

    const enabledEmails: string[] = [];

    // Sync each account's scheduler with its monitoring_enabled state
    for (const row of result.rows) {
      const accountId = row.id;
      const emailAddress = row.email_address;
      const monitoringEnabled = row.monitoring_enabled;

      try {
        if (monitoringEnabled) {
          await this.enableScheduler(SchedulerId.CHECK_MAIL, userId, accountId);
          enabledEmails.push(emailAddress);
        } else {
          // Disable if currently enabled
          const status = await this.getSchedulerStatus(SchedulerId.CHECK_MAIL, accountId);
          if (status) {
            await this.disableScheduler(SchedulerId.CHECK_MAIL, userId, accountId);
          }
        }
      } catch (error: unknown) {
        console.error(`[JobSchedulerManager] Failed to sync scheduler for ${emailAddress}:`, error);
      }
    }

    // Print consolidated summary
    if (enabledEmails.length > 0) {
      console.log(`[JobSchedulerManager] Initialized ${enabledEmails.length} scheduler${enabledEmails.length === 1 ? '' : 's'} for ${userName} (${enabledEmails.join(', ')})`);
    }
  }

  /**
   * Clean up all schedulers for a user
   */
  async cleanupUserSchedulers(userId: string): Promise<void> {
    console.log(`[JobSchedulerManager] Cleaning up schedulers for user: ${userId}`);

    // Get all scheduler keys for this user
    const keys = await this.redis.keys(`${SCHEDULER_STATE_PREFIX}*:userId`);

    for (const key of keys) {
      const storedUserId = await this.redis.get(key);
      if (storedUserId !== userId) continue;

      // Extract accountId from key pattern: scheduler:check-mail-ACCOUNT_ID:userId
      // The accountId is a UUID (8-4-4-4-12 hex format)
      const match = key.match(/scheduler:(.+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):userId/i);
      if (!match) continue;

      const schedulerId = match[1];
      const accountId = match[2];

      try {
        await this.disableScheduler(schedulerId, userId, accountId);
      } catch (error: unknown) {
        console.error(`[JobSchedulerManager] Error disabling scheduler ${schedulerId} for account ${accountId}:`, error);
      }
    }
  }

  /**
   * Close connections (for graceful shutdown)
   */
  async shutdown(): Promise<void> {
    console.log('[JobSchedulerManager] Shutting down...');
    await this.redis.quit();
    console.log('[JobSchedulerManager] Shutdown complete');
  }
}

// Export singleton instance
export const jobSchedulerManager = JobSchedulerManager.getInstance();