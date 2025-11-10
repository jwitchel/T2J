-- Migration: Rename email tables and columns
-- Date: 2025-11-10
-- Changes:
--   1. Rename raw_message → full_message in both tables
--   2. Add NOT NULL constraints to required columns
--   3. Rename tables: sent_emails → email_sent, received_emails → email_received
--   4. Rename indexes

BEGIN;

-- Step 1: Rename columns in sent_emails
ALTER TABLE sent_emails
  RENAME COLUMN raw_message TO full_message;

-- Step 2: Add NOT NULL constraints to sent_emails
-- (All existing data has these values, verified before migration)
ALTER TABLE sent_emails
  ALTER COLUMN subject SET NOT NULL,
  ALTER COLUMN recipient_email SET NOT NULL,
  ALTER COLUMN full_message SET NOT NULL;

-- Step 3: Rename columns in received_emails
ALTER TABLE received_emails
  RENAME COLUMN raw_message TO full_message;

-- Step 4: Add NOT NULL constraints to received_emails
ALTER TABLE received_emails
  ALTER COLUMN subject SET NOT NULL,
  ALTER COLUMN sender_email SET NOT NULL,
  ALTER COLUMN full_message SET NOT NULL;

-- Step 5: Rename sent_emails table to email_sent
ALTER TABLE sent_emails RENAME TO email_sent;

-- Step 6: Rename received_emails table to email_received
ALTER TABLE received_emails RENAME TO email_received;

-- Step 7: Rename indexes for email_sent
ALTER INDEX sent_emails_pkey RENAME TO email_sent_pkey;
ALTER INDEX sent_emails_email_id_key RENAME TO email_sent_email_id_key;
ALTER INDEX idx_sent_emails_user_date RENAME TO idx_email_sent_user_date;
ALTER INDEX idx_sent_emails_relationship RENAME TO idx_email_sent_relationship;
ALTER INDEX idx_sent_emails_recipient RENAME TO idx_email_sent_recipient;

-- Step 8: Rename constraints for email_sent
ALTER TABLE email_sent RENAME CONSTRAINT sent_emails_user_id_fkey TO email_sent_user_id_fkey;
ALTER TABLE email_sent RENAME CONSTRAINT sent_emails_email_account_id_fkey TO email_sent_email_account_id_fkey;

-- Step 9: Rename indexes for email_received
ALTER INDEX received_emails_pkey RENAME TO email_received_pkey;
ALTER INDEX received_emails_email_id_key RENAME TO email_received_email_id_key;
ALTER INDEX idx_received_emails_user_date RENAME TO idx_email_received_user_date;
ALTER INDEX idx_received_emails_sender RENAME TO idx_email_received_sender;

-- Step 10: Rename constraints for email_received
ALTER TABLE email_received RENAME CONSTRAINT received_emails_user_id_fkey TO email_received_user_id_fkey;
ALTER TABLE email_received RENAME CONSTRAINT received_emails_email_account_id_fkey TO email_received_email_account_id_fkey;

COMMIT;
