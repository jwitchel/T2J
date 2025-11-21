-- Migration: Drop denormalized email/name columns
-- Description: Remove recipient_email, recipient_name, sender_email, sender_name
--              since we now use FKs to person_emails table

-- Drop columns from email_sent
ALTER TABLE email_sent DROP COLUMN IF EXISTS recipient_email;
ALTER TABLE email_sent DROP COLUMN IF EXISTS recipient_name;
ALTER TABLE email_sent DROP COLUMN IF EXISTS relationship_type;  -- Also stored in person_relationships

-- Drop columns from email_received
ALTER TABLE email_received DROP COLUMN IF EXISTS sender_email;
ALTER TABLE email_received DROP COLUMN IF EXISTS sender_name;

-- Drop indexes on old columns
DROP INDEX IF EXISTS idx_email_sent_recipient;
DROP INDEX IF EXISTS idx_email_received_sender;
DROP INDEX IF EXISTS idx_email_sent_relationship;

-- Note: Email and name are now retrieved via JOIN to person_emails table
-- Relationship is retrieved via JOIN to person_relationships table
