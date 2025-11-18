-- Add UID column to email_action_tracking table
-- This allows us to fetch emails from IMAP even if they're not in Qdrant yet

ALTER TABLE email_action_tracking 
ADD COLUMN IF NOT EXISTS uid INTEGER;

-- Add index for faster lookups by message_id and email_account_id
CREATE INDEX IF NOT EXISTS idx_email_action_tracking_lookup 
ON email_action_tracking(email_account_id, message_id);

COMMENT ON COLUMN email_action_tracking.uid IS 'IMAP UID for fetching the email directly from the mail server';
