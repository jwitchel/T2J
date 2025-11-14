import express from 'express';
import { requireAuth } from '../middleware/auth';
import {
  inboxQueue,
  trainingQueue,
  JobType,
  JobPriority,
  addInboxJob,
  addTrainingJob
} from '../lib/queue';
import { pool } from '../lib/db';

const router = express.Router();

// Queue a new job
router.post('/queue', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { type, data, priority = 'normal', force = false } = req.body;

    if (!type || !data) {
      res.status(400).json({ error: 'Type and data are required' });
      return;
    }

    // Map priority string to enum
    const priorityMap: Record<string, JobPriority> = {
      'critical': JobPriority.CRITICAL,
      'high': JobPriority.HIGH,
      'normal': JobPriority.NORMAL,
      'low': JobPriority.LOW
    };

    const jobPriority = priorityMap[priority.toLowerCase()] || JobPriority.NORMAL;

    let job;

    // Queue the job based on type
    switch (type) {
      case JobType.PROCESS_INBOX:
        job = await addInboxJob(
          { ...data, userId },
          jobPriority,
          { force }
        );
        break;

      case JobType.BUILD_TONE_PROFILE:
      case JobType.LEARN_FROM_EDIT:
        job = await addTrainingJob(
          type as JobType.BUILD_TONE_PROFILE | JobType.LEARN_FROM_EDIT,
          { ...data, userId },
          jobPriority,
          { force }
        );
        break;

      default:
        res.status(400).json({ error: 'Invalid job type' });
        return;
    }

    // Determine which queue the job was added to
    const queueName = type === JobType.BUILD_TONE_PROFILE ? 'tone-profile' : 'email-processing';

    res.json({
      jobId: job.id,
      queueName,
      type,
      status: await job.getState(),
      priority,
      forced: force,
      createdAt: new Date(job.timestamp).toISOString()
    });
  } catch (error) {
    console.error('Error queuing job:', error);
    res.status(500).json({
      error: 'Failed to queue job',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get job status from specific queue
router.get('/:queueName/:jobId/status', requireAuth, async (req, res): Promise<void> => {
  try {
    const { queueName, jobId } = req.params;

    // Get the appropriate queue
    let queue;
    if (queueName === 'email-processing') {
      queue = inboxQueue;
    } else if (queueName === 'tone-profile') {
      queue = trainingQueue;
    } else {
      res.status(400).json({ error: 'Invalid queue name. Must be "email-processing" or "tone-profile"' });
      return;
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const state = await job.getState();
    
    res.json({
      jobId: job.id,
      queueName,
      type: job.name,
      status: state,
      progress: job.progress,
      data: job.data,
      result: job.returnvalue,
      error: job.failedReason,
      createdAt: new Date(job.timestamp).toISOString(),
      processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      completedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({
      error: 'Failed to get job status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// List jobs directly from BullMQ
router.get('/list', requireAuth, async (req, res): Promise<void> => {
  try {
    const { status = 'all', limit = 20, offset = 0 } = req.query;

    // Get jobs from both queues - include 'prioritized' state
    const jobStates = status === 'all' 
      ? ['waiting', 'prioritized', 'active', 'completed', 'failed', 'delayed', 'paused'] 
      : [status as any];
    
    const emailJobs = await inboxQueue.getJobs(
      jobStates,
      Number(offset),
      Number(offset) + Number(limit) - 1
    );

    const toneJobs = await trainingQueue.getJobs(
      jobStates,
      Number(offset),
      Number(offset) + Number(limit) - 1
    );

    // Combine and sort by timestamp
    const allJobs = [...emailJobs, ...toneJobs]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, Number(limit));

    // Format jobs for response - include queue information and job data
    const formattedJobs = await Promise.all(allJobs.map(async (job) => {
      // Determine queue name based on which queue the job came from
      const isEmailJob = emailJobs.includes(job);
      const queueName = isEmailJob ? 'email-processing' : 'tone-profile';

      // Get email address from accountId if available
      let emailAddress: string | undefined;
      if (job.data?.accountId) {
        try {
          const result = await pool.query(
            'SELECT email_address FROM email_accounts WHERE id = $1',
            [job.data.accountId]
          );
          emailAddress = result.rows[0]?.email_address;
        } catch (err) {
          console.error('Error fetching email address for job:', err);
        }
      }

      return {
        jobId: job.id,
        queueName,
        type: job.name,
        status: await job.getState(),
        progress: job.progress,
        result: job.returnvalue,
        error: job.failedReason,
        createdAt: new Date(job.timestamp).toISOString(),
        processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        completedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        duration: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
        emailAddress // Add email address to response
      };
    }));

    res.json({
      jobs: formattedJobs,
      total: formattedJobs.length,
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (error) {
    console.error('Error listing jobs:', error);
    res.status(500).json({
      error: 'Failed to list jobs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Cancel a job from specific queue
router.delete('/:queueName/:jobId', requireAuth, async (req, res): Promise<void> => {
  try {
    const { queueName, jobId } = req.params;

    // Get the appropriate queue
    let queue;
    if (queueName === 'email-processing') {
      queue = inboxQueue;
    } else if (queueName === 'tone-profile') {
      queue = trainingQueue;
    } else {
      res.status(400).json({ error: 'Invalid queue name. Must be "email-processing" or "tone-profile"' });
      return;
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    await job.remove();

    res.json({
      jobId,
      queueName,
      status: 'cancelled',
      removed: true
    });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({
      error: 'Failed to cancel job',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Retry a failed job from specific queue
router.post('/:queueName/:jobId/retry', requireAuth, async (req, res): Promise<void> => {
  try {
    const { queueName, jobId } = req.params;

    // Get the appropriate queue
    let queue;
    if (queueName === 'email-processing') {
      queue = inboxQueue;
    } else if (queueName === 'tone-profile') {
      queue = trainingQueue;
    } else {
      res.status(400).json({ error: 'Invalid queue name. Must be "email-processing" or "tone-profile"' });
      return;
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const state = await job.getState();
    if (state !== 'failed') {
      res.status(400).json({ error: 'Job is not in failed state and cannot be retried' });
      return;
    }

    // Create a new job with the same data and type
    // Use force: true to ensure old failed job is removed and new one created
    let newJob;
    // Check if it's an inbox job (PROCESS_INBOX)
    if (job.name === JobType.PROCESS_INBOX) {
      newJob = await addInboxJob(
        job.data,
        JobPriority.NORMAL,
        { force: true }
      );
    } else {
      // It's a training job (BUILD_TONE_PROFILE or LEARN_FROM_EDIT)
      newJob = await addTrainingJob(
        job.name as JobType.BUILD_TONE_PROFILE | JobType.LEARN_FROM_EDIT,
        job.data,
        JobPriority.NORMAL,
        { force: true }
      );
    }

    res.json({
      originalJobId: jobId,
      newJobId: newJob.id,
      queueName,
      type: newJob.name,
      status: await newJob.getState(),
      createdAt: new Date(newJob.timestamp).toISOString()
    });
  } catch (error) {
    console.error('Error retrying job:', error);
    res.status(500).json({
      error: 'Failed to retry job',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get job statistics directly from BullMQ
router.get('/stats', requireAuth, async (_req, res): Promise<void> => {
  try {
    // Get counts from both queues
    const emailCounts = await inboxQueue.getJobCounts();
    const toneCounts = await trainingQueue.getJobCounts();

    // Get queue pause status
    const emailPaused = await inboxQueue.isPaused();
    const tonePaused = await trainingQueue.isPaused();

    // Combined stats for backward compatibility
    // Include both 'waiting' and 'prioritized' jobs in the queued count
    const stats = {
      active: emailCounts.active + toneCounts.active,
      queued: (emailCounts.waiting || 0) + (toneCounts.waiting || 0) + 
              (emailCounts.prioritized || 0) + (toneCounts.prioritized || 0),
      completed: emailCounts.completed + toneCounts.completed,
      failed: emailCounts.failed + toneCounts.failed,
      delayed: emailCounts.delayed + toneCounts.delayed,
      paused: emailCounts.paused + toneCounts.paused,
      // Per-queue stats
      queues: {
        // Keep old names for backward compatibility in frontend
        emailProcessing: {
          ...emailCounts,
          isPaused: emailPaused,
          name: 'Inbox Processing'
        },
        toneProfile: {
          ...toneCounts,
          isPaused: tonePaused,
          name: 'Training & Learning'
        }
      }
    };

    res.json(stats);
  } catch (error) {
    console.error('Error getting job stats:', error);
    res.status(500).json({
      error: 'Failed to get stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clear pending jobs (queued/prioritized) from all queues
router.post('/clear-pending-jobs', requireAuth, async (_req, res): Promise<void> => {
  try {
    console.log('Clearing pending jobs from all queues...');
    
    // Job states to clear (jobs that haven't started processing)
    const statesToClear = ['waiting', 'prioritized', 'delayed'];
    
    let totalCleared = 0;
    
    // Clear pending jobs from email processing queue
    for (const state of statesToClear) {
      const emailJobs = await inboxQueue.getJobs([state as any]);
      for (const job of emailJobs) {
        try {
          await job.remove();
          totalCleared++;
          console.log(`Removed ${state} email job ${job.id}`);
        } catch (e) {
          console.log(`Could not remove email job ${job.id}:`, e);
        }
      }
    }
    
    // Clear pending jobs from tone profile queue
    for (const state of statesToClear) {
      const toneJobs = await trainingQueue.getJobs([state as any]);
      for (const job of toneJobs) {
        try {
          await job.remove();
          totalCleared++;
          console.log(`Removed ${state} tone job ${job.id}`);
        } catch (e) {
          console.log(`Could not remove tone job ${job.id}:`, e);
        }
      }
    }
    
    // Broadcast queue cleared event to update UI
    const { getUnifiedWebSocketServer } = await import('../websocket/unified-websocket');
    const wsServer = getUnifiedWebSocketServer();
    if (wsServer) {
      wsServer.broadcastJobEvent({
        type: 'QUEUE_CLEARED',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`Cleared ${totalCleared} pending jobs`);
    
    res.json({
      success: true,
      message: `Cleared ${totalCleared} pending jobs (queued/prioritized)`,
      cleared: totalCleared,
      statesCleared: statesToClear
    });
  } catch (error) {
    console.error('Error clearing pending jobs:', error);
    res.status(500).json({
      error: 'Failed to clear pending jobs',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clear all jobs from all queues - complete unconditional cleanup
router.post('/clear-all-queues', requireAuth, async (_req, res): Promise<void> => {
  try {
    console.log('Starting complete queue obliteration...');
    
    // Get counts before clearing
    const emailCounts = await inboxQueue.getJobCounts();
    const toneCounts = await trainingQueue.getJobCounts();
    
    const totalBefore = 
      emailCounts.waiting + emailCounts.active + emailCounts.completed + emailCounts.failed + 
      emailCounts.delayed + emailCounts.paused + emailCounts.prioritized +
      toneCounts.waiting + toneCounts.active + toneCounts.completed + toneCounts.failed + 
      toneCounts.delayed + toneCounts.paused + toneCounts.prioritized;
    
    // Clean both queues using BullMQ's obliterate (removes ALL jobs and data unconditionally)
    console.log('Obliterating all queues (lock renewal errors after this are expected and harmless)...');
    await inboxQueue.obliterate({ force: true });
    await trainingQueue.obliterate({ force: true });
    console.log('Queues obliterated successfully');
    
    // Note: Workers may log "could not renew lock" errors after obliteration
    // This is expected and harmless - workers are trying to renew locks on jobs that no longer exist
    console.log('Note: Any subsequent lock renewal errors are expected and can be ignored');
    
    // Broadcast queue cleared event to update UI
    const { getUnifiedWebSocketServer } = await import('../websocket/unified-websocket');
    const wsServer = getUnifiedWebSocketServer();
    if (wsServer) {
      wsServer.broadcastJobEvent({
        type: 'QUEUE_CLEARED',
        timestamp: new Date().toISOString()
      });
    }
    
    // Verify cleanup
    const emailCountsAfter = await inboxQueue.getJobCounts();
    const toneCountsAfter = await trainingQueue.getJobCounts();
    
    const totalAfter = 
      emailCountsAfter.waiting + emailCountsAfter.active + emailCountsAfter.completed + 
      emailCountsAfter.failed + emailCountsAfter.delayed + emailCountsAfter.paused + emailCountsAfter.prioritized +
      toneCountsAfter.waiting + toneCountsAfter.active + toneCountsAfter.completed + 
      toneCountsAfter.failed + toneCountsAfter.delayed + toneCountsAfter.paused + toneCountsAfter.prioritized;
    
    console.log(`Queue cleanup complete. Removed ${totalBefore} jobs. Remaining: ${totalAfter}`);
    
    res.json({
      success: true,
      message: 'All jobs cleared from all queues (complete unconditional cleanup)',
      cleared: totalBefore,
      remaining: totalAfter,
      queuesCleared: ['email-processing', 'tone-profile']
    });
  } catch (error) {
    console.error('Error clearing all queues:', error);
    res.status(500).json({
      error: 'Failed to clear all queues',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Keep old endpoint for backward compatibility (calls the new one)
router.post('/clear-queue', requireAuth, async (_req, res): Promise<void> => {
  try {
    console.log('Legacy /clear-queue endpoint called, redirecting to /clear-all-queues');
    
    // Get counts before clearing
    const emailCounts = await inboxQueue.getJobCounts();
    const toneCounts = await trainingQueue.getJobCounts();
    
    const totalBefore = 
      emailCounts.waiting + emailCounts.active + emailCounts.completed + emailCounts.failed + 
      emailCounts.delayed + emailCounts.paused + emailCounts.prioritized +
      toneCounts.waiting + toneCounts.active + toneCounts.completed + toneCounts.failed + 
      toneCounts.delayed + toneCounts.paused + toneCounts.prioritized;
    
    // Clean both queues using BullMQ's obliterate
    await inboxQueue.obliterate({ force: true });
    await trainingQueue.obliterate({ force: true });
    
    // Broadcast queue cleared event to update UI
    const { getUnifiedWebSocketServer } = await import('../websocket/unified-websocket');
    const wsServer = getUnifiedWebSocketServer();
    if (wsServer) {
      wsServer.broadcastJobEvent({
        type: 'QUEUE_CLEARED',
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      message: 'All jobs cleared from all queues',
      cleared: totalBefore,
      queuesCleared: ['email-processing', 'tone-profile']
    });
  } catch (error) {
    console.error('Error clearing all queues:', error);
    res.status(500).json({
      error: 'Failed to clear all queues',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;