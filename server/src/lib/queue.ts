import { Queue, Job, JobsOptions } from 'bullmq';
import { sharedConnection as connection } from './redis-connection';
import { generateJobId } from './queue/job-id-generator';

/**
 * BullMQ job options with well-defined types
 * Extends BullMQ's JobsOptions for type safety
 */
export interface BullMQJobOptions extends JobsOptions {
  jobId?: string;
  priority?: JobPriority;
  removeOnComplete?: boolean | { age?: number; count?: number };
  removeOnFail?: boolean | { age?: number; count?: number };
  attempts?: number;
  backoff?: number | { type: string; delay: number };
}

/**
 * Default job options for standard processing
 * No retry logic - jobs fail after first attempt
 */
export const DEFAULT_JOB_OPTIONS: BullMQJobOptions = {
  removeOnComplete: {
    count: 100,  // Keep last 100 completed jobs
    age: 3600    // Remove completed jobs older than 1 hour
  },
  removeOnFail: {
    count: 50,   // Keep last 50 failed jobs
    age: 7200    // Remove failed jobs older than 2 hours
  },
  attempts: 1    // No retries
};

/**
 * Job options for fan-out parent jobs
 * Completed fan-out jobs are removed immediately to reduce clutter
 */
export const FAN_OUT_JOB_OPTIONS: BullMQJobOptions = {
  removeOnComplete: true,  // Remove immediately after completion
  removeOnFail: {
    count: 10,   // Keep fewer failed fan-out jobs
    age: 3600    // Remove after 1 hour
  },
  attempts: 1
};

/**
 * Job options for real-time IMAP monitoring jobs
 * High priority with immediate removal on completion
 */
export const REAL_TIME_JOB_OPTIONS: BullMQJobOptions = {
  removeOnComplete: true,  // Remove immediately
  removeOnFail: {
    count: 20,
    age: 7200
  },
  attempts: 1
};

/**
 * Job options for scheduled recurring jobs
 * Standard priority with standard cleanup
 */
export const SCHEDULED_JOB_OPTIONS: BullMQJobOptions = {
  ...DEFAULT_JOB_OPTIONS
};

// Legacy export for backward compatibility
const defaultJobOptions = DEFAULT_JOB_OPTIONS;

// Job types enum
export enum JobType {
  // Inbox jobs
  PROCESS_INBOX = 'process-inbox',
  // Training jobs
  BUILD_TONE_PROFILE = 'build-tone-profile',
  LEARN_FROM_EDIT = 'learn-from-edit'
}

// Job priority levels
export enum JobPriority {
  LOW = 10,
  NORMAL = 5,
  HIGH = 3,
  CRITICAL = 1
}

// Type definitions for job data
export interface BuildToneProfileJobData {
  userId: string;
  accountId?: string;  // Optional for fan-out jobs
  historyDays?: number;
  fanOut?: boolean;    // Flag to indicate parent fan-out job
}

export interface ProcessInboxJobData {
  userId: string;
  accountId?: string;  // Optional for fan-out jobs
  folderName?: string; // Default to INBOX
  since?: Date; // Optional: only process emails after this date
  fanOut?: boolean;    // Flag to indicate parent fan-out job
}

export interface LearnFromEditJobData {
  userId: string;
  originalDraft: string;
  editedDraft: string;
  context?: {
    recipient?: string;
    subject?: string;
  };
}

// Create queues
export const inboxQueue = new Queue('inbox', {
  connection,
  defaultJobOptions
});

export const trainingQueue = new Queue('training', {
  connection,
  defaultJobOptions
});

/**
 * Remove a job if it exists in the queue
 * Used for force processing - removes old job before creating new one
 *
 * @private
 */
async function removeJobIfExists(queue: Queue, jobId: string): Promise<void> {
  try {
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`[Queue] Removed existing job: ${jobId}`);
    }
  } catch (error) {
    // Job doesn't exist or already removed - this is fine
    if (error instanceof Error && !error.message.includes('Missing key')) {
      console.warn(`[Queue] Failed to remove job ${jobId}:`, error.message);
    }
  }
}

/**
 * Add options for job creation
 */
export interface AddJobOptions {
  force?: boolean;      // If true, remove existing job and create new one
  isFanOut?: boolean;   // If true, this is a fan-out parent job
}

/**
 * Add an inbox processing job with job ID-based deduplication
 *
 * @param data - Job data
 * @param priority - Job priority (default: NORMAL)
 * @param options - Additional options (force, isFanOut)
 * @returns Promise<Job> - The created or existing job
 */
export async function addInboxJob(
  data: ProcessInboxJobData,
  priority: JobPriority = JobPriority.NORMAL,
  options: AddJobOptions = {}
): Promise<Job> {
  const { force = false, isFanOut = false } = options;

  // Determine if this is a fan-out job (no accountId or explicit flag)
  const effectiveIsFanOut = isFanOut || !data.accountId;

  // Generate deterministic job ID
  const jobId = generateJobId({
    jobType: JobType.PROCESS_INBOX,
    userId: data.userId,
    accountId: data.accountId,
    folderName: data.folderName,
    timestamp: effectiveIsFanOut ? Date.now() : undefined,
    isFanOut: effectiveIsFanOut
  });

  // If force is true, remove existing job first
  if (force) {
    await removeJobIfExists(inboxQueue, jobId);
  }

  // Select appropriate job options based on job type
  const baseOptions = effectiveIsFanOut ? FAN_OUT_JOB_OPTIONS : DEFAULT_JOB_OPTIONS;

  // Check if job already exists
  const existingJob = await inboxQueue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    console.log(`[Queue] Job already exists: ${jobId} (state: ${state})`);
    return existingJob;
  }

  // Create new job with custom ID
  const job = await inboxQueue.add(
    JobType.PROCESS_INBOX,
    data,
    {
      ...baseOptions,
      jobId,
      priority
    }
  );

  console.log(`[Queue] Created inbox job: ${jobId}`);
  return job;
}

/**
 * Add a training job with job ID-based deduplication
 *
 * @param type - Job type (BUILD_TONE_PROFILE or LEARN_FROM_EDIT)
 * @param data - Job data
 * @param priority - Job priority (default: NORMAL)
 * @param options - Additional options (force, isFanOut)
 * @returns Promise<Job> - The created or existing job
 */
export async function addTrainingJob(
  type: JobType.BUILD_TONE_PROFILE | JobType.LEARN_FROM_EDIT,
  data: BuildToneProfileJobData | LearnFromEditJobData,
  priority: JobPriority = JobPriority.NORMAL,
  options: AddJobOptions = {}
): Promise<Job> {
  const { force = false, isFanOut = false } = options;

  // Determine if this is a fan-out job
  let effectiveIsFanOut = isFanOut;
  let accountId: string | undefined;

  if (type === JobType.BUILD_TONE_PROFILE) {
    const toneData = data as BuildToneProfileJobData;
    accountId = toneData.accountId;
    effectiveIsFanOut = isFanOut || !accountId;
  } else {
    // LEARN_FROM_EDIT jobs are always unique (use timestamp)
    effectiveIsFanOut = false;
  }

  // Generate deterministic job ID
  const jobId = generateJobId({
    jobType: type,
    userId: data.userId,
    accountId,
    timestamp: effectiveIsFanOut || type === JobType.LEARN_FROM_EDIT ? Date.now() : undefined,
    isFanOut: effectiveIsFanOut
  });

  // If force is true, remove existing job first
  if (force) {
    await removeJobIfExists(trainingQueue, jobId);
  }

  // Select appropriate job options based on job type
  const baseOptions = effectiveIsFanOut ? FAN_OUT_JOB_OPTIONS : DEFAULT_JOB_OPTIONS;

  // Check if job already exists
  const existingJob = await trainingQueue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    console.log(`[Queue] Job already exists: ${jobId} (state: ${state})`);
    return existingJob;
  }

  // Create new job with custom ID
  const job = await trainingQueue.add(
    type,
    data,
    {
      ...baseOptions,
      jobId,
      priority
    }
  );

  console.log(`[Queue] Created training job: ${jobId}`);
  return job;
}