/**
 * Queue Event Listener
 * Listens to BullMQ events and broadcasts them via WebSocket
 */

import { QueueEvents } from 'bullmq';
import { sharedConnection } from './redis-connection';
import { getUnifiedWebSocketServer } from '../websocket/unified-websocket';
import { inboxQueue, trainingQueue } from './queue';

// Create queue event listeners using shared Redis connection
const inboxQueueEvents = new QueueEvents('inbox', {
  connection: sharedConnection
});

const trainingQueueEvents = new QueueEvents('training', {
  connection: sharedConnection
});

// Helper to broadcast job events via WebSocket
async function broadcastJobEvent(eventType: string, jobId: string, queueName: string, additionalData: any = {}) {
  const wsServer = getUnifiedWebSocketServer();
  if (!wsServer) {
    return; // WebSocket not available, skip silently
  }

  // Get job data to find userId
  const queue = queueName === 'inbox' ? inboxQueue : trainingQueue;
  const job = await queue.getJob(jobId);

  if (job?.data?.userId) {
    // Get email address from accountId if available
    let emailAddress: string | undefined;
    if (job.data?.accountId) {
      try {
        const { pool } = await import('../server');
        const result = await pool.query(
          'SELECT email_address FROM email_accounts WHERE id = $1',
          [job.data.accountId]
        );
        emailAddress = result.rows[0]?.email_address;
      } catch (err) {
        console.error('Error fetching email address for job event:', err);
      }
    }

    wsServer.broadcastJobEvent({
      type: eventType,
      jobId,
      queueName,
      userId: job.data.userId,
      jobType: job.name,
      emailAddress,
      timestamp: new Date().toISOString(),
      ...additionalData
    });
  }
  // If job or userId not found, skip silently - this is just for UI updates
}

// Queue configuration for consistent event listener setup
const queueConfigs = [
  {
    queueEvents: inboxQueueEvents,
    queueName: 'inbox'
  },
  {
    queueEvents: trainingQueueEvents,
    queueName: 'training'
  }
];

// Generic event handler setup function
function setupQueueEventListeners(queueEvents: QueueEvents, queueName: string) {
  queueEvents.on('added', async ({ jobId }) => {
    await broadcastJobEvent('JOB_QUEUED', jobId, queueName);
  });

  queueEvents.on('active', ({ jobId }) => {
    broadcastJobEvent('JOB_ACTIVE', jobId, queueName);
  });

  queueEvents.on('progress', ({ jobId, data }) => {
    broadcastJobEvent('JOB_PROGRESS', jobId, queueName, { progress: data });
  });

  queueEvents.on('completed', ({ jobId, returnvalue }) => {
    broadcastJobEvent('JOB_COMPLETED', jobId, queueName, { result: returnvalue });
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    broadcastJobEvent('JOB_FAILED', jobId, queueName, { error: failedReason });
  });
}

// Set up event listeners for all queues consistently
queueConfigs.forEach(({ queueEvents, queueName }) => {
  setupQueueEventListeners(queueEvents, queueName);
});

// Export for cleanup
export function cleanupQueueEvents() {
  queueConfigs.forEach(({ queueEvents }) => {
    queueEvents.close();
  });
}