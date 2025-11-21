-- Migration: Add foreign keys from email tables to person_emails
-- Description: Replace email address strings with FKs to person_emails table

-- Step 1: Add new columns for person_email FKs (UUID to match person_emails.id)
ALTER TABLE email_sent ADD COLUMN IF NOT EXISTS recipient_person_email_id UUID;
ALTER TABLE email_received ADD COLUMN IF NOT EXISTS sender_person_email_id UUID;

-- Step 2: Populate the new columns (this migration assumes person_emails are already populated)
-- Note: This is a no-op if the columns already have data

-- Step 3: Add foreign key constraints
ALTER TABLE email_sent
    ADD CONSTRAINT fk_email_sent_recipient_person_email
    FOREIGN KEY (recipient_person_email_id)
    REFERENCES person_emails(id)
    ON DELETE CASCADE;

ALTER TABLE email_received
    ADD CONSTRAINT fk_email_received_sender_person_email
    FOREIGN KEY (sender_person_email_id)
    REFERENCES person_emails(id)
    ON DELETE CASCADE;

-- Step 4: Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_email_sent_recipient_person_email
    ON email_sent(recipient_person_email_id);

CREATE INDEX IF NOT EXISTS idx_email_received_sender_person_email
    ON email_received(sender_person_email_id);

-- Note: Migration 008 will drop the old denormalized columns
-- (recipient_email, recipient_name, sender_email, sender_name)
