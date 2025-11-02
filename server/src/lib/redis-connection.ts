/**
 * Shared Redis Connection
 * Single Redis connection shared across all BullMQ queues and workers
 * This follows BullMQ best practices and avoids connection pool exhaustion
 */

import Redis from 'ioredis';

// Shared Redis connection for BullMQ queues and workers
export const sharedConnection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  // Reconnection strategy for OS sleep/wake scenarios
  retryStrategy: (times) => {
    const minDelay = parseInt(process.env.BULLMQ_REDIS_RETRY_DELAY_MIN!);
    const maxDelay = parseInt(process.env.BULLMQ_REDIS_RETRY_DELAY_MAX!);
    const delay = Math.min(times * minDelay, maxDelay);
    return delay;
  },
  reconnectOnError: (err) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      return true; // Reconnect on READONLY errors
    }
    return false;
  },
  enableReadyCheck: true,
  enableOfflineQueue: true
});

// Connection event handlers for monitoring
sharedConnection.on('error', (err) => {
  console.error('[BullMQ Redis] Connection error:', err.message);
});

sharedConnection.on('reconnecting', () => {
  console.log('[BullMQ Redis] Reconnecting...');
});

sharedConnection.on('connect', () => {
  console.log('[BullMQ Redis] Connected');
});

sharedConnection.on('close', () => {
  console.warn('[BullMQ Redis] Connection closed');
});
