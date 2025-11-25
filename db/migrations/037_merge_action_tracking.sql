-- Migration: Merge email_action_tracking into email_received
-- This adds action tracking columns to email_received, eliminating the need
-- for a separate email_action_tracking table

-- Add new columns to email_received
ALTER TABLE email_received
  ADD COLUMN IF NOT EXISTS action_taken VARCHAR(50) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS destination_folder TEXT,
  ADD COLUMN IF NOT EXISTS uid INTEGER;

-- Create indexes for action queries
CREATE INDEX IF NOT EXISTS idx_email_received_action
  ON email_received (action_taken);

CREATE INDEX IF NOT EXISTS idx_email_received_user_action
  ON email_received (user_id, action_taken);

CREATE INDEX IF NOT EXISTS idx_email_received_account_email
  ON email_received (email_account_id, email_id);

CREATE INDEX IF NOT EXISTS idx_email_received_updated_at
  ON email_received (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_received_user_updated
  ON email_received (user_id, updated_at DESC);
