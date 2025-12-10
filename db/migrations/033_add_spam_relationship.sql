-- Migration: Add spam as system default relationship type
-- Description: Insert 'spam' relationship for all users as a system default

-- Add spam relationship for all users
-- Use INSERT ... ON CONFLICT to make this migration idempotent
INSERT INTO user_relationships (
    id,
    user_id,
    relationship_type,
    display_name,
    is_active,
    is_system_default,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    u.id,
    'spam',
    'Spam',
    true,
    true,
    NOW(),
    NOW()
FROM "user" u
ON CONFLICT (user_id, relationship_type) DO NOTHING;

-- Note: This migration adds spam as a system default for all existing users
-- New users will get this relationship automatically via the user creation flow
