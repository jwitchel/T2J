-- Migration: Drop raw_text column from email_sent table
-- Rationale: raw_text is only used by deprecated endpoints
--            full_message contains the complete RFC 5322 email for any future reprocessing needs
--            user_reply is the primary field used by all active features

-- Drop raw_text column from email_sent
ALTER TABLE email_sent DROP COLUMN IF EXISTS raw_text;

-- Note: email_received.raw_text is kept as it serves a different purpose
-- (incoming emails are not processed the same way as sent emails)
