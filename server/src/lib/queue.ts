import { Queue, Job } from 'bullmq';
import { sharedConnection as connection } from './redis-connection';

// Simple job options - no retry logic as requested
const defaultJobOptions = {
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

// Helper functions to add jobs
export async function addInboxJob(
  data: ProcessInboxJobData,
  priority: JobPriority = JobPriority.NORMAL
): Promise<Job> {
  return inboxQueue.add(JobType.PROCESS_INBOX, data, { priority });
}

export async function addTrainingJob(
  type: JobType.BUILD_TONE_PROFILE | JobType.LEARN_FROM_EDIT,
  data: BuildToneProfileJobData | LearnFromEditJobData,
  priority: JobPriority = JobPriority.NORMAL
): Promise<Job> {
  return trainingQueue.add(type, data, { priority });
}