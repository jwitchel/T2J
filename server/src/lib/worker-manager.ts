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

      // No periodic cleanup - BullMQ's stalledInterval handles runtime stalls automatically
    } catch (error: unknown) {
      console.error('[WorkerManager] Error during initialization:', error);
      // Default to paused state on error for safety
      this.isPaused = true;
      await this.pauseAllWorkers(true); // true = don't wait on startup
    }
  }

  /**
   * Clean up stale jobs ONLY from previous crashes/kills
   * This runs ONCE at startup, not periodically
   * Grace periods are longer than lock durations to only catch truly abandoned jobs
   */
  private async cleanupStaleJobs(): Promise<void> {
    console.log('[WorkerManager] Cleaning up stale jobs from previous runs...');

    try {
      let totalCleaned = 0;

      // Clean up stale jobs in each queue with queue-specific thresholds
      for (const [name, queue] of this.queues.entries()) {
        // Grace period significantly longer than lock duration
        // Only catches jobs abandoned by crashes, not jobs actively processing
        const gracePeriod = name === 'inbox' ? 300000 : 900000; // 5min inbox, 15min training

        try {
          const staleLocks = await queue.clean(gracePeriod, 1000, 'active');
          if (staleLocks && staleLocks.length > 0) {
            console.log(`[WorkerManager] Cleaned ${staleLocks.length} abandoned jobs from ${name} queue`);
            totalCleaned += staleLocks.length;
          }
        } catch (err) {
          console.warn(`[WorkerManager] Could not clean abandoned jobs in ${name}:`, err);
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