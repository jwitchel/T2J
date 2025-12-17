/**
 * Action Rules Types
 *
 * Types for user-defined rules that override automatic action classifications.
 * Rules are checked before LLM processing: sender rules first, then relationship rules.
 */

import { EmailActionType } from './email-action-tracking';

/**
 * Condition types for rules
 */
export enum ActionRuleConditionType {
  RELATIONSHIP = 'relationship',
  SENDER = 'sender'
}

/**
 * Subset of EmailActionType available for user rules
 * Labels already exist in EmailActionType.LABELS
 */
export const USER_ACTION_VALUES = [
  EmailActionType.REPLY,
  EmailActionType.SILENT_FYI_ONLY,
  EmailActionType.SILENT_SPAM,
  EmailActionType.SILENT_TODO,
  EmailActionType.KEEP_IN_INBOX,
] as const;

export type UserActionType = typeof USER_ACTION_VALUES[number];

/**
 * Check if an action type is a valid user action
 */
export function isValidUserAction(action: string): action is UserActionType {
  return USER_ACTION_VALUES.includes(action as UserActionType);
}

/**
 * User action rule as stored in database
 */
export interface UserActionRule {
  id: string;
  userId: string;
  conditionType: ActionRuleConditionType;
  conditionValue: string;
  targetAction: UserActionType;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Parameters for creating a new action rule
 */
export interface CreateActionRuleParams {
  userId: string;
  conditionType: ActionRuleConditionType;
  conditionValue: string;
  targetAction: UserActionType;
}

/**
 * Result of checking rules against an email
 */
export interface ActionRuleMatchResult {
  matched: boolean;
  rule?: UserActionRule;
  action?: UserActionType;
}

/**
 * Error thrown when trying to create a duplicate sender rule
 */
export class DuplicateSenderRuleError extends Error {
  constructor(email: string) {
    super(`Sender rule already exists for ${email}`);
    this.name = 'DuplicateSenderRuleError';
  }
}

/**
 * Error thrown when trying to create a duplicate relationship rule
 */
export class DuplicateRelationshipRuleError extends Error {
  constructor(relationship: string) {
    super(`Relationship rule already exists for ${relationship}`);
    this.name = 'DuplicateRelationshipRuleError';
  }
}
