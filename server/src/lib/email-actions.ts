/**
 * Email Actions System (Shared)
 * Single source of truth for all email action types and related helpers
 * Shared between frontend and backend - do not duplicate!
 */

/**
 * Email action constants
 * Use these instead of string literals throughout the codebase
 */
export const EmailActions = {
  REPLY: 'reply',
  REPLY_ALL: 'reply-all',
  FORWARD: 'forward',
  FORWARD_WITH_COMMENT: 'forward-with-comment',
  SILENT_FYI_ONLY: 'silent-fyi-only',
  SILENT_LARGE_LIST: 'silent-large-list',
  SILENT_UNSUBSCRIBE: 'silent-unsubscribe',
  SILENT_SPAM: 'silent-spam',
  SILENT_TODO: 'silent-todo',
  SILENT_AMBIGUOUS: 'silent-ambiguous',
  UNKNOWN: 'unknown',
} as const;

/**
 * Type for recommended actions
 * Derived from EmailActions constants for type safety
 */
export type RecommendedAction = typeof EmailActions[keyof typeof EmailActions];

/**
 * Actions that require draft generation
 */
const DRAFT_ACTIONS: readonly RecommendedAction[] = [
  EmailActions.REPLY,
  EmailActions.REPLY_ALL,
  EmailActions.FORWARD,
  EmailActions.FORWARD_WITH_COMMENT,
] as const;

/**
 * Actions that are silent (no draft generation)
 * Note: SILENT_AMBIGUOUS is NOT included here as it stays in inbox
 */
const SILENT_ACTIONS: readonly RecommendedAction[] = [
  EmailActions.SILENT_FYI_ONLY,
  EmailActions.SILENT_LARGE_LIST,
  EmailActions.SILENT_UNSUBSCRIBE,
  EmailActions.SILENT_SPAM,
  EmailActions.SILENT_TODO,
] as const;

/**
 * Helper methods for working with email actions
 */
export const ActionHelpers = {
  /**
   * Array of actions that require draft generation
   */
  DRAFT_ACTIONS,

  /**
   * Array of actions that are silent (no draft needed)
   */
  SILENT_ACTIONS,

  /**
   * Check if action requires draft generation
   */
  isDraftAction(action: RecommendedAction): boolean {
    return DRAFT_ACTIONS.includes(action);
  },

  /**
   * Check if action is silent (no draft needed)
   */
  isSilentAction(action: RecommendedAction): boolean {
    return SILENT_ACTIONS.includes(action);
  },

  /**
   * Check if action is spam
   */
  isSpamAction(action: RecommendedAction): boolean {
    return action === EmailActions.SILENT_SPAM;
  },

  /**
   * Check if action is reply-all (for determining recipients)
   */
  isReplyAll(action: RecommendedAction): boolean {
    return action === EmailActions.REPLY_ALL;
  },

  /**
   * Check if action is ambiguous (stays in inbox for manual review)
   */
  isAmbiguousAction(action: RecommendedAction): boolean {
    return action === EmailActions.SILENT_AMBIGUOUS;
  },

  /**
   * Check if action requires todo folder
   */
  isTodoAction(action: RecommendedAction): boolean {
    return action === EmailActions.SILENT_TODO;
  },

  /**
   * Get human-readable description of action
   */
  getDescription(action: RecommendedAction): string {
    switch (action) {
      case EmailActions.REPLY:
        return 'Reply to sender';
      case EmailActions.REPLY_ALL:
        return 'Reply to all recipients';
      case EmailActions.FORWARD:
        return 'Forward to someone';
      case EmailActions.FORWARD_WITH_COMMENT:
        return 'Forward with your comments';
      case EmailActions.SILENT_FYI_ONLY:
        return 'FYI only - no action needed';
      case EmailActions.SILENT_LARGE_LIST:
        return 'Large distribution list - silent';
      case EmailActions.SILENT_UNSUBSCRIBE:
        return 'Unsubscribe candidate';
      case EmailActions.SILENT_SPAM:
        return 'Spam - move to spam folder';
      case EmailActions.SILENT_TODO:
        return 'Requires action - moved to todo folder';
      case EmailActions.SILENT_AMBIGUOUS:
        return 'Unclear intent - stays in inbox for manual review';
      case EmailActions.UNKNOWN:
        return 'Unknown action';
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  },

  /**
   * Get action category
   */
  getCategory(action: RecommendedAction): 'draft' | 'silent' | 'unknown' {
    if (this.isDraftAction(action)) return 'draft';
    if (this.isSilentAction(action)) return 'silent';
    return 'unknown';
  },
};
