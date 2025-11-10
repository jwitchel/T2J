/**
 * Email Lock Manager
 * Provides distributed locking for email processing using Redlock algorithm
 * Prevents duplicate draft creation when multiple processes access same email
 */

import Redis from 'ioredis';
import Redlock from 'redlock';
import { sharedConnection } from './redis-connection';

export interface LockResult<T> {
  acquired: boolean;
  result?: T;
  reason?: string;
}

export class EmailLockManager {
  private redlock: InstanceType<typeof Redlock>;

  constructor(redis: Redis = sharedConnection) {
    // Initialize Redlock with no retries - fail fast if lock is held or Redis unavailable
    this.redlock = new Redlock([redis], {
      retryCount: 0,  // No retries - lock held means skip email immediately
      driftFactor: 0.01,
      automaticExtensionThreshold: 500
    });

    // Log Redlock errors for monitoring
    this.redlock.on('error', (error: Error) => {
      // Don't log ExecutionError (failed to acquire lock) - these are expected
      if (error.name !== 'ExecutionError') {
        console.error('[EmailLockManager] Redlock error:', error);
      }
    });
  }

  /**
   * Process an email with distributed lock protection
   * Automatically acquires and releases lock using Redlock's "using" pattern
   *
   * @param emailId - Unique identifier for the email (messageId)
   * @param accountId - Email account ID for lock namespacing
   * @param fn - Async function to execute while holding the lock
   * @returns LockResult with acquired status and result or reason
   */
  async processWithLock<T>(
    emailId: string,
    accountId: string,
    fn: (signal: AbortSignal) => Promise<T>
  ): Promise<LockResult<T>> {
    const lockKey = `lock:email:${accountId}:${emailId}`;
    const lockTTL = parseInt(process.env.EMAIL_PROCESSING_LOCK_TTL || '30000');

    try {
      // Use Redlock's "using" pattern for automatic acquire/release
      const result = await this.redlock.using([lockKey], lockTTL, async (signal: AbortSignal) => {
        return await fn(signal);
      });

      return {
        acquired: true,
        result
      };

    } catch (error: unknown) {
      // ExecutionError or ResourceLockedError means lock is already held by another process
      const errorName = error instanceof Error ? error.name : '';
      if (errorName === 'ExecutionError' || errorName === 'ResourceLockedError') {
        return {
          acquired: false,
          reason: 'Lock already held by another process'
        };
      }

      // Other errors should be thrown (Redis connection failures, etc.)
      console.error(`[EmailLockManager] Unexpected error for lock ${lockKey}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  async quit(): Promise<void> {
    await this.redlock.quit();
  }
}

// Export singleton instance (same pattern as inboxProcessor, emailMover, etc.)
export const emailLockManager = new EmailLockManager();
