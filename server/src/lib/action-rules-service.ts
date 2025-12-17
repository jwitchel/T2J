/**
 * Action Rules Service
 *
 * Manages user-defined rules that override automatic action classifications.
 * Rules are checked in order: sender rules first, then relationship rules.
 */

import { pool } from './db';
import {
  UserActionRule,
  CreateActionRuleParams,
  ActionRuleMatchResult,
  ActionRuleConditionType,
  UserActionType,
  DuplicateSenderRuleError,
  DuplicateRelationshipRuleError,
} from '../types/action-rules';

export class ActionRulesService {
  // ==================== READ OPERATIONS ====================

  /**
   * Get all rules for a user, ordered by condition type (sender first) and priority
   */
  async getRulesForUser(userId: string): Promise<UserActionRule[]> {
    const result = await pool.query(`
      SELECT id, user_id, condition_type, condition_value, target_action, priority, is_active, created_at, updated_at
      FROM user_action_rules
      WHERE user_id = $1 AND is_active = TRUE
      ORDER BY
        CASE condition_type WHEN 'sender' THEN 0 ELSE 1 END,
        priority ASC
    `, [userId]);

    return result.rows.map(this._mapRowToRule);
  }

  /**
   * Get sender rules for a user, ordered by priority
   */
  async getSenderRulesForUser(userId: string): Promise<UserActionRule[]> {
    const result = await pool.query(`
      SELECT id, user_id, condition_type, condition_value, target_action, priority, is_active, created_at, updated_at
      FROM user_action_rules
      WHERE user_id = $1 AND condition_type = 'sender' AND is_active = TRUE
      ORDER BY priority ASC
    `, [userId]);

    return result.rows.map(this._mapRowToRule);
  }

  /**
   * Get relationship rules for a user, ordered by priority
   */
  async getRelationshipRulesForUser(userId: string): Promise<UserActionRule[]> {
    const result = await pool.query(`
      SELECT id, user_id, condition_type, condition_value, target_action, priority, is_active, created_at, updated_at
      FROM user_action_rules
      WHERE user_id = $1 AND condition_type = 'relationship' AND is_active = TRUE
      ORDER BY priority ASC
    `, [userId]);

    return result.rows.map(this._mapRowToRule);
  }

  /**
   * Check rules for an email, returning the first matching rule.
   * Order: sender rules first, then relationship rules.
   */
  async checkRules(
    userId: string,
    senderEmail: string,
    relationshipType: string | null
  ): Promise<ActionRuleMatchResult> {
    // 1. Check sender rules first
    const senderRules = await this.getSenderRulesForUser(userId);
    const normalizedSender = senderEmail.toLowerCase();

    for (const rule of senderRules) {
      if (rule.conditionValue === normalizedSender) {
        return { matched: true, rule, action: rule.targetAction };
      }
    }

    // 2. Then check relationship rules
    if (relationshipType) {
      const relationshipRules = await this.getRelationshipRulesForUser(userId);

      for (const rule of relationshipRules) {
        if (rule.conditionValue === relationshipType) {
          return { matched: true, rule, action: rule.targetAction };
        }
      }
    }

    return { matched: false };
  }

  // ==================== WRITE OPERATIONS ====================

  /**
   * Create a new action rule.
   * Throws DuplicateSenderRuleError if a sender rule already exists for the email.
   */
  async createRule(params: CreateActionRuleParams): Promise<UserActionRule> {
    // Normalize sender email
    const conditionValue = params.conditionType === ActionRuleConditionType.SENDER
      ? params.conditionValue.toLowerCase()
      : params.conditionValue;

    // Get next priority for this condition type
    const priority = await this._getNextPriority(params.userId, params.conditionType);

    try {
      const result = await pool.query(`
        INSERT INTO user_action_rules (user_id, condition_type, condition_value, target_action, priority)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, user_id, condition_type, condition_value, target_action, priority, is_active, created_at, updated_at
      `, [params.userId, params.conditionType, conditionValue, params.targetAction, priority]);

      return this._mapRowToRule(result.rows[0]);
    } catch (error: unknown) {
      // Check for unique constraint violations
      if (error instanceof Error) {
        if (error.message.includes('idx_user_action_rules_sender_unique')) {
          throw new DuplicateSenderRuleError(conditionValue);
        }
        if (error.message.includes('idx_user_action_rules_relationship_unique')) {
          throw new DuplicateRelationshipRuleError(conditionValue);
        }
      }
      throw error;
    }
  }

  /**
   * Delete a rule by ID
   */
  async deleteRule(ruleId: string, userId: string): Promise<boolean> {
    const result = await pool.query(`
      DELETE FROM user_action_rules
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `, [ruleId, userId]);

    return result.rowCount! > 0;
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Get next priority number for a condition type
   */
  private async _getNextPriority(userId: string, conditionType: ActionRuleConditionType): Promise<number> {
    const result = await pool.query(`
      SELECT COALESCE(MAX(priority), 0) + 1 as next_priority
      FROM user_action_rules
      WHERE user_id = $1 AND condition_type = $2
    `, [userId, conditionType]);

    return result.rows[0].next_priority;
  }

  /**
   * Map database row to UserActionRule interface
   */
  private _mapRowToRule(row: Record<string, unknown>): UserActionRule {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      conditionType: row.condition_type as ActionRuleConditionType,
      conditionValue: row.condition_value as string,
      targetAction: row.target_action as UserActionType,
      priority: row.priority as number,
      isActive: row.is_active as boolean,
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }
}

export const actionRulesService = new ActionRulesService();
