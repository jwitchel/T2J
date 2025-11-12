/**
 * Integration test for BullMQ queue system
 * This tests that jobs can be queued and would be processed by workers
 */

import {
  emailProcessingQueue,
  toneProfileQueue,
  addEmailJob,
  addToneProfileJob,
  JobType,
  JobPriority
} from '../queue';

// Increase timeout for Redis operations
jest.setTimeout(30000);

describe('Queue Integration Tests', () => {
  afterAll(async () => {
    // Clean up all jobs
    try {
      // BullMQ requires queues to be paused before obliteration
      await emailProcessingQueue.pause();
      await toneProfileQueue.pause();
      await emailProcessingQueue.obliterate({ force: true });
      await toneProfileQueue.obliterate({ force: true });
    } catch (error: unknown) {
      // Ignore obliterate errors
    }
    
    // Close connections
    await emailProcessingQueue.close();
    await toneProfileQueue.close();
    
    // Give a moment for connections to close
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  it('should queue and retrieve jobs correctly', async () => {
    // Add a process inbox job
    const emailJob = await addEmailJob(
      JobType.PROCESS_INBOX,
      {
        userId: 'integration-test-user',
        accountId: 'integration-test-account',
        folderName: 'INBOX'
      },
      JobPriority.HIGH
    );

    expect(emailJob).toBeDefined();
    expect(emailJob.id).toBeDefined();

    // Retrieve the job
    const retrievedJob = await emailProcessingQueue.getJob(emailJob.id!);
    expect(retrievedJob).toBeDefined();
    expect(retrievedJob?.data.userId).toBe('integration-test-user');
    
    // Check job state
    const state = await emailJob.getState();
    expect(state).toBeDefined();
    expect(['waiting', 'prioritized', 'delayed', 'active', 'completed', 'failed']).toContain(state);
  });

  it('should queue tone profile jobs correctly', async () => {
    // Add a tone profile job
    const toneJob = await addToneProfileJob(
      {
        userId: 'integration-test-user',
        accountId: 'integration-test-account',
        historyDays: 30
      },
      JobPriority.NORMAL
    );

    expect(toneJob).toBeDefined();
    expect(toneJob.id).toBeDefined();

    // Retrieve the job
    const retrievedJob = await toneProfileQueue.getJob(toneJob.id!);
    expect(retrievedJob).toBeDefined();
    expect(retrievedJob?.data.historyDays).toBe(30);
    
    // Check job state
    const state = await toneJob.getState();
    expect(state).toBeDefined();
    expect(['waiting', 'prioritized', 'delayed', 'active', 'completed', 'failed']).toContain(state);
  });

  it('should handle different job priorities', async () => {
    // Add jobs with different priorities
    const criticalJob = await addEmailJob(
      JobType.PROCESS_INBOX,
      {
        userId: 'test',
        accountId: 'test',
        folderName: 'INBOX'
      },
      JobPriority.CRITICAL
    );

    const lowJob = await addEmailJob(
      JobType.PROCESS_INBOX,
      {
        userId: 'test',
        accountId: 'test',
        folderName: 'INBOX'
      },
      JobPriority.LOW
    );

    expect(criticalJob.opts.priority).toBe(JobPriority.CRITICAL);
    expect(lowJob.opts.priority).toBe(JobPriority.LOW);
  });

  it('should get queue statistics', async () => {
    // Get job counts from queues
    const emailCounts = await emailProcessingQueue.getJobCounts();
    const toneCounts = await toneProfileQueue.getJobCounts();

    expect(emailCounts).toBeDefined();
    expect(emailCounts).toHaveProperty('waiting');
    expect(emailCounts).toHaveProperty('active');
    expect(emailCounts).toHaveProperty('completed');
    expect(emailCounts).toHaveProperty('failed');

    expect(toneCounts).toBeDefined();
    expect(toneCounts).toHaveProperty('waiting');
  });

  it('should check queue health', async () => {
    // Ensure queues are resumed before checking (in case previous test paused them)
    await emailProcessingQueue.resume();
    await toneProfileQueue.resume();
    
    // Check if queues are paused
    const emailPaused = await emailProcessingQueue.isPaused();
    const tonePaused = await toneProfileQueue.isPaused();

    expect(typeof emailPaused).toBe('boolean');
    expect(typeof tonePaused).toBe('boolean');
    expect(emailPaused).toBe(false); // Should not be paused
    expect(tonePaused).toBe(false); // Should not be paused
  });

  it('should handle job with no retry', async () => {
    // Add a job
    const job = await addEmailJob(
      JobType.LEARN_FROM_EDIT,
      {
        userId: 'test',
        originalDraft: 'original',
        editedDraft: 'edited'
      },
      JobPriority.NORMAL
    );

    // Check retry configuration (we removed retries)
    expect(job.opts.attempts).toBe(1); // No retries
  });

  it('should handle tone profile job configuration', async () => {
    const job = await addToneProfileJob(
      {
        userId: 'test',
        accountId: 'test',
        historyDays: 90
      },
      JobPriority.HIGH
    );

    // Check configuration
    expect(job.name).toBe(JobType.BUILD_TONE_PROFILE);
    expect(job.opts.attempts).toBe(1); // No retries in simplified system
    expect(job.data.historyDays).toBe(90);
  });

  it('should handle job types correctly', async () => {
    // Test process inbox job
    const processJob = await addEmailJob(
      JobType.PROCESS_INBOX,
      {
        userId: 'test',
        accountId: 'test',
        folderName: 'INBOX'
      },
      JobPriority.NORMAL
    );
    expect(processJob.name).toBe(JobType.PROCESS_INBOX);

    // Test learn from edit job
    const learnJob = await addEmailJob(
      JobType.LEARN_FROM_EDIT,
      {
        userId: 'test',
        originalDraft: 'original',
        editedDraft: 'edited'
      },
      JobPriority.NORMAL
    );
    expect(learnJob.name).toBe(JobType.LEARN_FROM_EDIT);
  });

  it('should clean jobs from queue', async () => {
    // Add some test jobs
    await addEmailJob(
      JobType.PROCESS_INBOX,
      { userId: 'test', accountId: 'test', folderName: 'INBOX' },
      JobPriority.NORMAL
    );

    // Pause then clean the queue (required by BullMQ)
    await emailProcessingQueue.pause();
    
    // Wait a moment to ensure pause is effective
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Verify the queue is actually paused
    const isPaused = await emailProcessingQueue.isPaused();
    if (!isPaused) {
      console.warn('Queue not paused, attempting pause again');
      await emailProcessingQueue.pause();
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    await emailProcessingQueue.obliterate({ force: true });

    // Resume the queue after obliteration
    await emailProcessingQueue.resume();

    // Check that queue is empty
    const counts = await emailProcessingQueue.getJobCounts();
    expect(counts.waiting).toBe(0);
  });
});
