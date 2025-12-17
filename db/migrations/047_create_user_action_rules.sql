-- Migration: Create user_action_rules table
-- Purpose: Allow users to override automatic action classifications with rules

CREATE TABLE user_action_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    condition_type VARCHAR(20) NOT NULL,  -- 'relationship' or 'sender'
    condition_value TEXT NOT NULL,        -- relationship type or email address
    target_action VARCHAR(50) NOT NULL,   -- EmailActionType value
    priority INTEGER NOT NULL,            -- ordering within condition_type
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One sender rule per email address per user
CREATE UNIQUE INDEX idx_user_action_rules_sender_unique
    ON user_action_rules(user_id, condition_value)
    WHERE condition_type = 'sender';

-- For efficient rule lookup
CREATE INDEX idx_user_action_rules_user_active
    ON user_action_rules(user_id, condition_type, priority)
    WHERE is_active = TRUE;
