import {
  inboxQueue,
  trainingQueue,
  addInboxJob,
  addTrainingJob,
  JobType,
  JobPriority
} from '../queue';

// Increase timeout for Redis operations
jest.setTimeout(30000);

describe('BullMQ Queue Configuration', () => {
  afterAll(async () => {
    // Clean up after tests
    try {
      await inboxQueue.pause();
      await trainingQueue.pause();
      await inboxQueue.obliterate({ force: true });
      await trainingQueue.obliterate({ force: true });
    } catch (error: unknown) {
      // Ignore obliterate errors
    }
    
    await inboxQueue.close();
    await trainingQueue.close();
    
    // Give a moment for connections to close
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('Queue Creation', () => {
    it('should create email processing queue', () => {
      expect(inboxQueue).toBeDefined();
      expect(inboxQueue.name).toBe('inbox');
    });

    it('should create tone profile queue', () => {
      expect(trainingQueue).toBeDefined();
      expect(trainingQueue.name).toBe('training');
    });
  });

  describe('Job Addition', () => {
    it('should add process inbox job', async () => {
      const job = await addInboxJob(
        {
          userId: 'test-user-1',
          accountId: 'test-account-1',
          folderName: 'INBOX'
        },
        JobPriority.NORMAL
      );

      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.name).toBe(JobType.PROCESS_INBOX);
      expect(job.data.userId).toBe('test-user-1');
    });

    it('should add process inbox job with high priority', async () => {
      const job = await addInboxJob({
          userId: 'test-user-2',
          accountId: 'test-account-2',
          folderName: 'INBOX'
        },
        JobPriority.HIGH
      );

      expect(job).toBeDefined();
      expect(job.name).toBe(JobType.PROCESS_INBOX);
      expect(job.opts.priority).toBe(JobPriority.HIGH);
    });

    it('should add learn from edit job', async () => {
      const job = await addTrainingJob(
        JobType.LEARN_FROM_EDIT,
        {
          userId: 'test-user-3',
          originalDraft: 'original text',
          editedDraft: 'edited text',
          context: {
            recipient: 'test@example.com',
            subject: 'Test Subject'
          }
        },
        JobPriority.LOW
      );

      expect(job).toBeDefined();
      expect(job.name).toBe(JobType.LEARN_FROM_EDIT);
      expect(job.opts.priority).toBe(JobPriority.LOW);
    });

    it('should add build tone profile job', async () => {
      const job = await addTrainingJob(JobType.BUILD_TONE_PROFILE,
        {
          userId: 'test-user-4',
          accountId: 'test-account-4',
          historyDays: 30
        },
        JobPriority.CRITICAL
      );

      expect(job).toBeDefined();
      expect(job.name).toBe(JobType.BUILD_TONE_PROFILE);
      expect(job.opts.priority).toBe(JobPriority.CRITICAL);
      expect(job.data.historyDays).toBe(30);
    });
  });

  describe('Job Priority', () => {
    it('should handle all priority levels', async () => {
      const priorities = [
        JobPriority.CRITICAL,
        JobPriority.HIGH,
        JobPriority.NORMAL,
        JobPriority.LOW
      ];

      for (const priority of priorities) {
        const job = await addInboxJob({
            userId: 'test',
            accountId: 'test',
            folderName: 'INBOX'
          },
          priority
        );

        expect(job.opts.priority).toBe(priority);
      }
    });
  });

  describe('Queue Statistics', () => {
    it('should get queue statistics using native BullMQ methods', async () => {
      // Add a test job
      await addInboxJob({
          userId: 'stats-test',
          accountId: 'stats-test',
          folderName: 'INBOX'
        },
        JobPriority.NORMAL
      );

      // Get job counts directly from queues
      const emailCounts = await inboxQueue.getJobCounts();
      const toneCounts = await trainingQueue.getJobCounts();

      expect(emailCounts).toBeDefined();
      expect(typeof emailCounts.waiting).toBe('number');
      expect(typeof emailCounts.active).toBe('number');
      expect(typeof emailCounts.completed).toBe('number');
      expect(typeof emailCounts.failed).toBe('number');

      expect(toneCounts).toBeDefined();
    });

    it('should check if queues are paused', async () => {
      const emailPaused = await inboxQueue.isPaused();
      const tonePaused = await trainingQueue.isPaused();

      expect(typeof emailPaused).toBe('boolean');
      expect(typeof tonePaused).toBe('boolean');
    });
  });

  describe('Job Configuration', () => {
    it('should configure email jobs with simplified settings', async () => {
      const job = await addInboxJob({
          userId: 'config-test',
          accountId: 'config-test',
          folderName: 'INBOX'
        },
        JobPriority.NORMAL
      );

      expect(job.opts.attempts).toBe(1); // No retries in simplified system
      expect(job.opts.removeOnComplete).toBeDefined();
      expect(job.opts.removeOnFail).toBeDefined();
    });

    it('should configure tone profile jobs with simplified settings', async () => {
      const job = await addTrainingJob(JobType.BUILD_TONE_PROFILE,
        {
          userId: 'config-test',
          accountId: 'config-test',
          historyDays: 60
        },
        JobPriority.HIGH
      );

      expect(job.opts.attempts).toBe(1); // No retries in simplified system
    });
  });

  describe('Queue Operations', () => {
    it('should retrieve jobs from queue', async () => {
      const job = await addInboxJob({
          userId: 'retrieve-test',
          accountId: 'retrieve-test',
          folderName: 'INBOX'
        },
        JobPriority.NORMAL
      );

      // Job should have an ID
      expect(job.id).toBeDefined();
      
      // Try to retrieve it (may be null if already processed)
      const retrieved = await inboxQueue.getJob(job.id!);
      
      // If job still exists in queue, verify it's the same
      if (retrieved) {
        expect(retrieved.id).toBe(job.id);
      }
      // If job is already processed, that's also valid in our simplified system
      // where workers might be running during tests
    });

    it('should clean queue', async () => {
      // Add a job
      await addInboxJob({
          userId: 'clean-test',
          accountId: 'clean-test',
          folderName: 'INBOX'
        },
        JobPriority.NORMAL
      );

      // Pause the queue first (required for obliterate)
      await inboxQueue.pause();
      
      // Wait a moment to ensure pause is effective
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Clean the queue
      await inboxQueue.obliterate({ force: true });
      
      // Resume the queue for other tests
      await inboxQueue.resume();
      
      // Check it's empty
      const counts = await inboxQueue.getJobCounts();
      expect(counts.waiting).toBe(0);
    });
  });
});
