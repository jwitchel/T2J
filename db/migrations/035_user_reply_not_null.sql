-- Migration: Make user_reply NOT NULL in email_sent
-- Date: 2025-11-22
-- Purpose: Enforce that user_reply always has a value (empty string if no content)

-- First, update any NULL values to empty string (safety, should be none)
UPDATE email_sent
SET user_reply = ''
WHERE user_reply IS NULL;

-- Add NOT NULL constraint with default empty string
ALTER TABLE email_sent
ALTER COLUMN user_reply SET DEFAULT '',
ALTER COLUMN user_reply SET NOT NULL;

-- Verify constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_sent'
      AND column_name = 'user_reply'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Migration failed: user_reply is still nullable';
  END IF;
END $$;
