/**
 * Email Action Types (Unified)
 * Single source of truth for all email action types, labels, and colors
 * Used by both frontend and backend
 */

/**
 * Email direction - whether email is incoming or outgoing
 */
export enum EmailDirection {
  INCOMING = 'incoming',
  SENT = 'sent'
}

/**
 * All possible email action types
 */
export enum EmailActionType {
  PENDING = 'pending',                          // Email logged, not yet processed
  REPLY = 'reply',                              // Draft reply generated
  REPLY_ALL = 'reply-all',                      // Draft reply-all generated
  FORWARD = 'forward',                          // Draft forward generated
  FORWARD_WITH_COMMENT = 'forward-with-comment', // Forward with comment draft
  SILENT_FYI_ONLY = 'silent-fyi-only',          // FYI only, no action needed
  SILENT_SPAM = 'silent-spam',                  // Spam, move to spam folder
  SILENT_LARGE_LIST = 'silent-large-list',      // Large distribution list
  SILENT_UNSUBSCRIBE = 'silent-unsubscribe',    // Unsubscribe candidate
  SILENT_TODO = 'silent-todo',                  // Requires action, move to todo
  KEEP_IN_INBOX = 'keep-in-inbox',              // Unclear intent, stay in inbox
  TRAINING = 'training',                        // Imported for training
  MANUALLY_HANDLED = 'manually_handled'         // User handled manually
}

/**
 * Namespace for EmailActionType utility functions and constants
 */
export namespace EmailActionType {
  /**
   * Display labels for action types
   */
  export const LABELS: Record<string, string> = {
    [EmailActionType.PENDING]: 'Pending',
    [EmailActionType.REPLY]: 'Reply',
    [EmailActionType.REPLY_ALL]: 'Reply All',
    [EmailActionType.FORWARD]: 'Forward',
    [EmailActionType.FORWARD_WITH_COMMENT]: 'Forward with Comment',
    [EmailActionType.SILENT_FYI_ONLY]: 'FYI Only',
    [EmailActionType.SILENT_SPAM]: 'Spam',
    [EmailActionType.SILENT_LARGE_LIST]: 'Large List',
    [EmailActionType.SILENT_UNSUBSCRIBE]: 'Unsubscribe',
    [EmailActionType.SILENT_TODO]: 'Todo',
    [EmailActionType.KEEP_IN_INBOX]: 'Keep in Inbox',
    [EmailActionType.TRAINING]: 'Training',
    [EmailActionType.MANUALLY_HANDLED]: 'Manually Handled'
  };

  /**
   * Colors for action badges/pills in the UI
   * Tailwind CSS compatible color values
   */
  export const COLORS: Record<string, string> = {
    [EmailActionType.PENDING]: '#a1a1aa',       // zinc-400
    [EmailActionType.REPLY]: '#3b82f6',         // blue-500
    [EmailActionType.REPLY_ALL]: '#6366f1',     // indigo-500
    [EmailActionType.FORWARD]: '#8b5cf6',       // violet-500
    [EmailActionType.FORWARD_WITH_COMMENT]: '#a855f7', // purple-500
    [EmailActionType.SILENT_FYI_ONLY]: '#71717a', // zinc-500
    [EmailActionType.SILENT_SPAM]: '#ef4444',   // red-500
    [EmailActionType.SILENT_LARGE_LIST]: '#78716c', // stone-500
    [EmailActionType.SILENT_UNSUBSCRIBE]: '#737373', // neutral-500
    [EmailActionType.SILENT_TODO]: '#f59e0b',   // amber-500
    [EmailActionType.KEEP_IN_INBOX]: '#eab308', // yellow-500
    [EmailActionType.TRAINING]: '#06b6d4',      // cyan-500
    [EmailActionType.MANUALLY_HANDLED]: '#22c55e' // green-500
  };

  /**
   * Descriptions for each action type
   */
  export const DESCRIPTIONS: Record<string, string> = {
    [EmailActionType.PENDING]: 'Email logged, awaiting processing',
    [EmailActionType.REPLY]: 'Reply to sender',
    [EmailActionType.REPLY_ALL]: 'Reply to all recipients',
    [EmailActionType.FORWARD]: 'Forward to someone',
    [EmailActionType.FORWARD_WITH_COMMENT]: 'Forward with your comments',
    [EmailActionType.SILENT_FYI_ONLY]: 'FYI only - no action needed',
    [EmailActionType.SILENT_SPAM]: 'Spam - move to spam folder',
    [EmailActionType.SILENT_LARGE_LIST]: 'Large distribution list - silent',
    [EmailActionType.SILENT_UNSUBSCRIBE]: 'Unsubscribe candidate',
    [EmailActionType.SILENT_TODO]: 'Requires action - moved to todo folder',
    [EmailActionType.KEEP_IN_INBOX]: 'Unclear intent - stays in inbox for manual review',
    [EmailActionType.TRAINING]: 'Imported for training purposes',
    [EmailActionType.MANUALLY_HANDLED]: 'User handled manually'
  };

  /**
   * Actions that require draft generation
   */
  export const DRAFT_ACTIONS: readonly EmailActionType[] = [
    EmailActionType.REPLY,
    EmailActionType.REPLY_ALL,
    EmailActionType.FORWARD,
    EmailActionType.FORWARD_WITH_COMMENT,
  ] as const;

  /**
   * Actions that are silent (no draft generation, moved to folder)
   */
  export const SILENT_ACTIONS: readonly EmailActionType[] = [
    EmailActionType.SILENT_FYI_ONLY,
    EmailActionType.SILENT_SPAM,
    EmailActionType.SILENT_LARGE_LIST,
    EmailActionType.SILENT_UNSUBSCRIBE,
    EmailActionType.SILENT_TODO,
  ] as const;

  /**
   * Check if action requires draft generation
   */
  export function isDraftAction(action: EmailActionType | string): boolean {
    return DRAFT_ACTIONS.includes(action as EmailActionType);
  }

  /**
   * Check if action is silent (no draft needed)
   */
  export function isSilentAction(action: EmailActionType | string): boolean {
    return SILENT_ACTIONS.includes(action as EmailActionType);
  }

  /**
   * Check if action is spam
   */
  export function isSpamAction(action: EmailActionType | string): boolean {
    return action === EmailActionType.SILENT_SPAM;
  }

  /**
   * Check if action is reply-all (for determining recipients)
   */
  export function isReplyAll(action: EmailActionType | string): boolean {
    return action === EmailActionType.REPLY_ALL;
  }

  /**
   * Check if action keeps email in inbox
   */
  export function isKeepInInbox(action: EmailActionType | string): boolean {
    return action === EmailActionType.KEEP_IN_INBOX;
  }

  /**
   * Check if action requires todo folder
   */
  export function isTodoAction(action: EmailActionType | string): boolean {
    return action === EmailActionType.SILENT_TODO;
  }

  /**
   * Check if action moves email to a folder (silent but not spam)
   */
  export function isMovedAction(action: EmailActionType | string): boolean {
    return isSilentAction(action) && !isSpamAction(action);
  }

  /**
   * Check if action is system-only (not a valid LLM recommendation)
   */
  export function isSystemOnly(action: EmailActionType | string): boolean {
    return action === EmailActionType.PENDING ||
           action === EmailActionType.TRAINING ||
           action === EmailActionType.MANUALLY_HANDLED;
  }

  /**
   * Get action category
   */
  export function getCategory(action: EmailActionType | string): 'draft' | 'silent' | 'other' {
    if (isDraftAction(action)) return 'draft';
    if (isSilentAction(action)) return 'silent';
    return 'other';
  }
}

/**
 * Type alias for RecommendedAction (backwards compatibility)
 * This is what the LLM returns as its recommendation
 */
export type RecommendedAction = EmailActionType;

/**
 * Extended email message with action tracking
 */
export interface EmailMessageWithAction {
  uid: number;
  messageId?: string;
  from?: string;
  to?: string[];
  subject?: string;
  date?: Date;
  flags: string[];
  size?: number;
  preview?: string;
  fullMessage?: string;
  // Action tracking fields
  actionTaken?: EmailActionType;
  updatedAt?: Date;  // When the action was taken
}
