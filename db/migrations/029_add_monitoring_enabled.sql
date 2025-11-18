-- Migration: Add monitoring_enabled column to email_accounts
-- Purpose: Track whether IMAP monitoring is enabled for each account
-- Date: 2025-11-18
-- Note: Defaults to false since IMAP IDLE is opt-in only

ALTER TABLE email_accounts
ADD COLUMN IF NOT EXISTS monitoring_enabled BOOLEAN DEFAULT false NOT NULL;

-- Add index for faster queries on monitoring status
CREATE INDEX IF NOT EXISTS idx_email_accounts_monitoring
ON email_accounts(user_id, monitoring_enabled)
WHERE monitoring_enabled = true;
