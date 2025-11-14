/**
 * Job ID Generator
 *
 * Generates deterministic, namespaced job IDs for BullMQ deduplication.
 * Same input components always produce the same job ID, preventing duplicate jobs.
 *
 * Job ID Patterns:
 * - Inbox (specific account): inbox:{userId}:{accountId}:{folderName}
 * - Inbox (fan-out parent): inbox:fanout:{userId}:{timestamp}
 * - Training BUILD_TONE_PROFILE: training:tone:{userId}:{accountId}
 * - Training LEARN_FROM_EDIT: training:edit:{userId}:{timestamp}
 * - Training (fan-out parent): training:fanout:tone:{userId}:{timestamp}
 */

import { JobType } from '../queue';

/**
 * Components used to generate a job ID
 */
export interface JobIdComponents {
  jobType: JobType;
  userId: string;
  accountId?: string;
  folderName?: string;
  messageId?: string;  // For future per-message jobs
  timestamp?: number;  // For fan-out jobs (prevent duplicate fan-outs)
  isFanOut?: boolean;  // Flag indicating fan-out job
}

/**
 * Sanitize a string for use in job IDs
 * Removes/replaces special characters that could cause issues
 *
 * @private
 */
function sanitizeForJobId(str: string | undefined): string {
  if (!str) return 'none';

  return str
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')  // Replace special chars with dash
    .replace(/-+/g, '-')            // Collapse multiple dashes
    .replace(/^-|-$/g, '');         // Remove leading/trailing dashes
}

/**
 * Generate job ID for PROCESS_INBOX jobs
 *
 * Specific account: inbox:{userId}:{accountId}:{folderName}
 * Fan-out parent: inbox:fanout:{userId}:{timestamp}
 */
function generateInboxJobId(components: JobIdComponents): string {
  const { userId, accountId, folderName, timestamp, isFanOut } = components;

  // Fan-out jobs get unique IDs with timestamp to prevent duplicate fan-outs
  if (isFanOut || !accountId) {
    const ts = timestamp || Date.now();
    return `inbox:fanout:${sanitizeForJobId(userId)}:${ts}`;
  }

  // Specific account jobs are deduplicated by user + account + folder
  const folder = sanitizeForJobId(folderName || 'inbox');
  return `inbox:${sanitizeForJobId(userId)}:${sanitizeForJobId(accountId)}:${folder}`;
}

/**
 * Generate job ID for training jobs (BUILD_TONE_PROFILE or LEARN_FROM_EDIT)
 *
 * BUILD_TONE_PROFILE (specific): training:tone:{userId}:{accountId}
 * BUILD_TONE_PROFILE (fan-out): training:fanout:tone:{userId}:{timestamp}
 * LEARN_FROM_EDIT: training:edit:{userId}:{timestamp}
 */
function generateTrainingJobId(components: JobIdComponents): string {
  const { jobType, userId, accountId, timestamp, isFanOut } = components;

  if (jobType === JobType.BUILD_TONE_PROFILE) {
    // Fan-out parent jobs
    if (isFanOut || !accountId) {
      const ts = timestamp || Date.now();
      return `training:fanout:tone:${sanitizeForJobId(userId)}:${ts}`;
    }

    // Specific account jobs are deduplicated by user + account
    return `training:tone:${sanitizeForJobId(userId)}:${sanitizeForJobId(accountId)}`;
  }

  if (jobType === JobType.LEARN_FROM_EDIT) {
    // Edit learning jobs are unique per occurrence (use timestamp)
    const ts = timestamp || Date.now();
    return `training:edit:${sanitizeForJobId(userId)}:${ts}`;
  }

  throw new Error(`Unknown training job type: ${jobType}`);
}

/**
 * Generate a deterministic job ID based on job type and components
 *
 * @param components - Job identification components
 * @returns Deterministic job ID string
 */
export function generateJobId(components: JobIdComponents): string {
  const { jobType } = components;

  switch (jobType) {
    case JobType.PROCESS_INBOX:
      return generateInboxJobId(components);

    case JobType.BUILD_TONE_PROFILE:
    case JobType.LEARN_FROM_EDIT:
      return generateTrainingJobId(components);

    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
}

/**
 * Parse a job ID back into its components (for debugging/logging)
 * Best effort - may not work for all ID formats
 *
 * @param jobId - Job ID string
 * @returns Partial components extracted from ID
 */
export function parseJobId(jobId: string): Partial<JobIdComponents> {
  const parts = jobId.split(':');

  if (parts[0] === 'inbox') {
    if (parts[1] === 'fanout') {
      return {
        jobType: JobType.PROCESS_INBOX,
        isFanOut: true,
        userId: parts[2],
        timestamp: parts[3] ? parseInt(parts[3]) : undefined
      };
    }

    return {
      jobType: JobType.PROCESS_INBOX,
      userId: parts[1],
      accountId: parts[2] === 'none' ? undefined : parts[2],
      folderName: parts[3] === 'none' ? undefined : parts[3]
    };
  }

  if (parts[0] === 'training') {
    if (parts[1] === 'fanout') {
      return {
        jobType: JobType.BUILD_TONE_PROFILE,
        isFanOut: true,
        userId: parts[3],
        timestamp: parts[4] ? parseInt(parts[4]) : undefined
      };
    }

    if (parts[1] === 'tone') {
      return {
        jobType: JobType.BUILD_TONE_PROFILE,
        userId: parts[2],
        accountId: parts[3] === 'none' ? undefined : parts[3]
      };
    }

    if (parts[1] === 'edit') {
      return {
        jobType: JobType.LEARN_FROM_EDIT,
        userId: parts[2],
        timestamp: parts[3] ? parseInt(parts[3]) : undefined
      };
    }
  }

  // Unknown format
  return {};
}
