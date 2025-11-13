/**
 * Worker Manager
 * Centralized management of BullMQ workers with pause/resume functionality
 */

import { Worker } from 'bullmq';
import { sharedConnection } from './redis-connection';
import inboxWorker from './workers/inbox-worker';
import trainingWorker from './workers/training-worker';
import { inboxQueue, trainingQueue } from './queue';

// Redis keys for storing worker state
const WORKER_STATE_KEY = 'worker:manager:paused';
const QUEUE_STATE_KEY = 'queue:manager:paused';

export class WorkerManager {
  private static instance: WorkerManager;
  private workers: Map<string, Worker> = new Map();
  private queues: Map<string, any> = new Map();
  private redis = sharedConnection;
  private isPaused: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {

    // Register workers - log for debugging
    console.log('[WorkerManager] Registering workers:', {
      inboxWorker: inboxWorker ? 'defined' : 'undefined',
      trainingWorker: trainingWorker ? 'defined' : 'undefined'
    });

    this.workers.set('inbox', inboxWorker);
    this.workers.set('training', trainingWorker);

    // Register queues
    this.queues.set('inbox', inboxQueue);
    this.queues.set('training', trainingQueue);
  }

  static getInstance(): WorkerManager {
    if (!WorkerManager.instance) {
      WorkerManager.instance = new WorkerManager();
    }
    return WorkerManager.instance;
  }

  /**
   * Initialize the worker manager and restore state
   * CLEAN START: Environment variables are the source of truth on startup
   */
  async initialize(): Promise<void> {
    try {
      // Clean up stale jobs from any previous crashed workers
      await this.cleanupStaleJobs();

      // CLEAN START: Always use ENV variables as source of truth on startup
      // This ensures consistent behavior and allows env changes to take effect
      this.isPaused = process.env.WORKERS_START_PAUSED === 'true';

      // Clear and reinitialize Redis state from env
      await this.redis.set(WORKER_STATE_KEY, String(this.isPaused));
      await this.redis.set(QUEUE_STATE_KEY, 'false'); // Always start with queues unpaused

      console.log(`[WorkerManager] Clean start initialized from ENV: isPaused=${this.isPaused}`);

      // Apply initial state to all workers
      if (this.isPaused) {
        await this.pauseAllWorkers(true); // true = don't wait for active jobs on startup
      } else {
        // If not paused, start all workers (since they have autorun: false)
        await this.resumeAllWorkers();
      }

      // Start periodic cleanup to handle runtime stalls (OS sleep/wake scenarios)
      this.startPeriodicCleanup();
    } catch (error: unknown) {
      console.error('[WorkerManager] Error during initialization:', error);
      // Default to paused state on error for safety
      this.isPaused = true;
      await this.pauseAllWorkers(true); // true = don't wait on startup
    }
  }

  /**
   * Clean up stale jobs and locks from previous worker crashes
   * This prevents "could not renew lock" errors on startup
   */
  private async cleanupStaleJobs(): Promise<void> {
    console.log('[WorkerManager] Cleaning up stale jobs from previous runs...');

    try {
      let totalCleaned = 0;

      // Clean up stale jobs in each queue
      for (const [name, queue] of this.queues.entries()) {
        // Clean up jobs with stale locks (active jobs that haven't been touched in 30 seconds)
        // This is the key fix for "could not renew lock" errors
        try {
          const staleLocks = await queue.clean(30000, 1000, 'active');
          if (staleLocks && staleLocks.length > 0) {
            console.log(`[WorkerManager] Cleaned ${staleLocks.length} jobs with stale locks from ${name} queue`);
            totalCleaned += staleLocks.length;
          }
        } catch (err) {
          console.warn(`[WorkerManager] Could not clean stale active jobs in ${name}:`, err);
        }

        // ALSO clean delayed jobs that are stale (repeatable job scheduling artifacts)
        try {
          const staleDelayed = await queue.clean(60000, 1000, 'delayed');
          if (staleDelayed && staleDelayed.length > 0) {
            console.log(`[WorkerManager] Cleaned ${staleDelayed.length} stale delayed jobs from ${name} queue`);
            totalCleaned += staleDelayed.length;
          }
        } catch (err) {
          console.warn(`[WorkerManager] Could not clean stale delayed jobs in ${name}:`, err);
        }

        // Clean failed jobs older than 1 hour (3600000ms)
        const failedCleaned = await queue.clean(3600000, 1000, 'failed');

        // Clean completed jobs older than 1 hour
        const completedCleaned = await queue.clean(3600000, 1000, 'completed');

        const queueTotal = (failedCleaned?.length || 0) + (completedCleaned?.length || 0);
        totalCleaned += queueTotal;

        if (queueTotal > 0) {
          console.log(`[WorkerManager] Cleaned ${queueTotal} old jobs from ${name} queue`);
        }
      }

      if (totalCleaned > 0) {
        console.log(`[WorkerManager] Total stale jobs cleaned: ${totalCleaned}`);
      } else {
        console.log('[WorkerManager] No stale jobs found');
      }
    } catch (error: unknown) {
      console.error('[WorkerManager] Error cleaning up stale jobs:', error);
      // Don't throw - we want initialization to continue even if cleanup fails
    }
  }

  /**
   * CRITICAL: Periodic cleanup to handle jobs that stall during runtime
   * This catches the OS sleep scenario where jobs get stuck with expired locks
   * Uses queue-specific thresholds to account for different lock durations
   */
  private startPeriodicCleanup(): void {
    const cleanupInterval = parseInt(process.env.BULLMQ_CLEANUP_INTERVAL!);
    const inboxStaleAge = parseInt(process.env.BULLMQ_INBOX_CLEANUP_STALE_AGE!);
    const trainingStaleAge = parseInt(process.env.BULLMQ_TRAINING_CLEANUP_STALE_AGE!);

    console.log(`[WorkerManager] Starting periodic cleanup (interval: ${cleanupInterval}ms)`);
    console.log(`[WorkerManager] Inbox cleanup threshold: ${inboxStaleAge}ms, Training cleanup threshold: ${trainingStaleAge}ms`);

    this.cleanupInterval = setInterval(async () => {
      try {
        // Clean inbox queue with shorter threshold (2 min lock + 1 min buffer = 3 min)
        const inboxQueue = this.queues.get('inbox');
        if (inboxQueue) {
          const inboxCleaned = await inboxQueue.clean(inboxStaleAge, 100, 'active');
          if (inboxCleaned && inboxCleaned.length > 0) {
            console.log(`[WorkerManager] Runtime cleanup: Removed ${inboxCleaned.length} stale active jobs from inbox queue`);
          }
        }

        // Clean training queue with longer threshold (10 min lock + 1 min buffer = 11 min)
        const trainingQueue = this.queues.get('training');
        if (trainingQueue) {
          const trainingCleaned = await trainingQueue.clean(trainingStaleAge, 100, 'active');
          if (trainingCleaned && trainingCleaned.length > 0) {
            console.log(`[WorkerManager] Runtime cleanup: Removed ${trainingCleaned.length} stale active jobs from training queue`);
          }
        }
      } catch (error: unknown) {
        console.error('[WorkerManager] Error in periodic cleanup:', error);
      }
    }, cleanupInterval);
  }

  /**
   * Pause all workers
   * @param doNotWaitActive - If true, pause immediately without waiting for active jobs to complete
   */
  async pauseAllWorkers(doNotWaitActive: boolean = false): Promise<void> {
    console.log(`[WorkerManager] Pausing all workers (wait for active: ${!doNotWaitActive})`);

    const pausePromises = Array.from(this.workers.values())
      .filter(worker => worker !== undefined)
      .map(worker => worker.pause(doNotWaitActive));

    if (pausePromises.length === 0) {
      console.warn('[WorkerManager] No workers to pause - workers may not be initialized yet');
    }

    await Promise.all(pausePromises);
    this.isPaused = true;
    await this.redis.set(WORKER_STATE_KEY, 'true');

    console.log('[WorkerManager] All workers paused');
  }

  /**
   * Resume all workers
   */
  async resumeAllWorkers(): Promise<void> {
    console.log('[WorkerManager] Resuming all workers');

    const resumePromises = Array.from(this.workers.entries())
      .filter(([_, worker]) => worker !== undefined)
      .map(async ([name, worker]) => {
        console.log(`[WorkerManager] Processing worker: ${name}, isRunning before: ${worker.isRunning()}, isPaused: ${worker.isPaused()}`);

        // First resume the worker (if it was paused)
        await worker.resume();

        // Then ensure it's running (in case autorun was false)
        if (!worker.isRunning()) {
          console.log(`[WorkerManager] Starting worker: ${name}`);
          await worker.run();
        }

        console.log(`[WorkerManager] Worker ${name} state after resume: isRunning=${worker.isRunning()}, isPaused=${worker.isPaused()}`);
      });

    if (resumePromises.length === 0) {
      console.warn('[WorkerManager] No workers to resume - workers may not be initialized yet');
    }

    await Promise.all(resumePromises);
    this.isPaused = false;
    await this.redis.set(WORKER_STATE_KEY, 'false');

    console.log('[WorkerManager] All workers resumed');
  }

  /**
   * Toggle worker state
   */
  async toggleWorkers(): Promise<boolean> {
    if (this.isPaused) {
      await this.resumeAllWorkers();
    } else {
      await this.pauseAllWorkers(true); // Wait for active jobs to complete
    }
    return !this.isPaused;
  }

  /**
   * Emergency pause all queues (not just workers)
   * This immediately stops all processing
   */
  async emergencyPauseQueues(): Promise<void> {
    console.log('[WorkerManager] EMERGENCY: Pausing all queues');
    
    const pausePromises = Array.from(this.queues.values()).map(queue =>
      queue.pause()
    );
    
    await Promise.all(pausePromises);
    await this.redis.set(QUEUE_STATE_KEY, 'true');
    
    console.log('[WorkerManager] All queues paused (emergency)');
  }

  /**
   * Resume all queues after emergency pause
   */
  async resumeQueues(): Promise<void> {
    console.log('[WorkerManager] Resuming all queues');
    
    const resumePromises = Array.from(this.queues.values()).map(queue =>
      queue.resume()
    );
    
    await Promise.all(resumePromises);
    await this.redis.set(QUEUE_STATE_KEY, 'false');
    
    console.log('[WorkerManager] All queues resumed');
  }

  /**
   * Check if queues are emergency paused
   */
  async areQueuesPaused(): Promise<boolean> {
    const state = await this.redis.get(QUEUE_STATE_KEY);
    return state === 'true';
  }

  /**
   * Get current worker status
   */
  async getStatus(): Promise<{
    workersPaused: boolean;
    queuesPaused: boolean;
    workers: Array<{ name: string; isPaused: boolean; isRunning: boolean }>;
    queues: Array<{ name: string; isPaused: boolean }>;
  }> {
    // Read actual worker paused state from Redis
    const storedState = await this.redis.get(WORKER_STATE_KEY);
    const actualWorkersPaused = storedState === 'true';

    const queuesPaused = await this.areQueuesPaused();

    const workerStatuses = await Promise.all(
      Array.from(this.workers.entries())
        .filter(([_, worker]) => worker !== undefined) // Filter out undefined workers
        .map(async ([name, worker]) => ({
          name,
          isPaused: worker.isPaused(),
          isRunning: worker.isRunning()
        }))
    );

    const queueStatuses = await Promise.all(
      Array.from(this.queues.entries()).map(async ([name, queue]) => ({
        name,
        isPaused: await queue.isPaused()
      }))
    );

    return {
      workersPaused: actualWorkersPaused,
      queuesPaused,
      workers: workerStatuses,
      queues: queueStatuses
    };
  }

  /**
   * Close all connections (for graceful shutdown)
   */
  async shutdown(): Promise<void> {
    console.log('[WorkerManager] Shutting down...');

    // Stop periodic cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[WorkerManager] Stopped periodic cleanup');
    }

    // Pause all workers first
    await this.pauseAllWorkers(false);

    // Close all workers
    const closePromises = Array.from(this.workers.values()).map(worker =>
      worker.close()
    );

    // Close all queues
    const queueClosePromises = Array.from(this.queues.values()).map(queue =>
      queue.close()
    );

    await Promise.all([...closePromises, ...queueClosePromises]);

    // Close Redis connection
    await this.redis.quit();

    console.log('[WorkerManager] Shutdown complete');
  }
}

// Export singleton instance
export const workerManager = WorkerManager.getInstance();