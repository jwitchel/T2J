-- Migration: Add unique constraint for relationship rules
-- Purpose: Prevent duplicate relationship rules per user

CREATE UNIQUE INDEX idx_user_action_rules_relationship_unique
    ON user_action_rules(user_id, condition_value)
    WHERE condition_type = 'relationship';
