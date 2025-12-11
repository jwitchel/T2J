-- Add sent_folder column to email_accounts table
-- This allows per-account sent folder configuration instead of user-level preference

-- Step 1: Add column as nullable first
ALTER TABLE email_accounts
ADD COLUMN IF NOT EXISTS sent_folder VARCHAR(255);

-- Step 2: Backfill existing accounts based on IMAP host
UPDATE email_accounts
SET sent_folder = CASE
  WHEN imap_host = 'imap.gmail.com' THEN '[Gmail]/Sent Mail'
  WHEN imap_host IN ('outlook.office365.com', 'imap-mail.outlook.com') THEN 'Sent Items'
  ELSE 'Sent'
END;

-- Step 3: Add NOT NULL constraint now that all rows have values
ALTER TABLE email_accounts
ALTER COLUMN sent_folder SET NOT NULL;
