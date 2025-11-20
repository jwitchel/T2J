-- Migration: Add foreign keys from email tables to person_emails
-- This establishes referential integrity between emails and contacts
-- Note: Requires data wipe before applying (no existing email data to migrate)

-- ============================================================================
-- PART 1: Add spam relationship type as system default
-- ============================================================================

-- Verify unique constraint exists on user_relationships to prevent duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_relationships_user_id_relationship_type_key'
      AND conrelid = 'user_relationships'::regclass
  ) THEN
    RAISE EXCEPTION 'Required unique constraint (user_id, relationship_type) missing on user_relationships table';
  END IF;
END
$$;

-- Add spam as a system default relationship for all existing users
INSERT INTO user_relationships (user_id, relationship_type, display_name, is_system_default)
SELECT
  id as user_id,
  'spam' as relationship_type,
  'Spam' as display_name,
  true as is_system_default
FROM "user"
ON CONFLICT (user_id, relationship_type) DO NOTHING;

-- ============================================================================
-- PART 2: Modify email_sent table
-- ============================================================================

-- Add new FK column for recipient person email
ALTER TABLE email_sent
ADD COLUMN recipient_person_email_id UUID;

-- Add foreign key constraint with RESTRICT delete
-- Prevent deletion of person_emails if emails reference it (data protection)
-- Application layer must handle person merging/deletion properly
ALTER TABLE email_sent
ADD CONSTRAINT fk_email_sent_recipient_person_email
  FOREIGN KEY (recipient_person_email_id)
  REFERENCES person_emails(id)
  ON DELETE RESTRICT;

-- Add index for query performance (JOIN operations)
CREATE INDEX idx_email_sent_recipient_person_email
ON email_sent(recipient_person_email_id);

-- Make the FK column NOT NULL (required after data population)
-- Since we're starting with clean slate, can do this immediately
ALTER TABLE email_sent
ALTER COLUMN recipient_person_email_id SET NOT NULL;

-- Drop old plain text columns (no longer needed with FK)
ALTER TABLE email_sent
DROP COLUMN IF EXISTS recipient_email;

ALTER TABLE email_sent
DROP COLUMN IF EXISTS recipient_name;

ALTER TABLE email_sent
DROP COLUMN IF EXISTS relationship_type;

-- ============================================================================
-- PART 3: Modify email_received table
-- ============================================================================

-- Add new FK column for sender person email
ALTER TABLE email_received
ADD COLUMN sender_person_email_id UUID;

-- Add foreign key constraint with RESTRICT delete
-- Prevent deletion of person_emails if emails reference it (data protection)
ALTER TABLE email_received
ADD CONSTRAINT fk_email_received_sender_person_email
  FOREIGN KEY (sender_person_email_id)
  REFERENCES person_emails(id)
  ON DELETE RESTRICT;

-- Add index for query performance
CREATE INDEX idx_email_received_sender_person_email
ON email_received(sender_person_email_id);

-- Make the FK column NOT NULL
ALTER TABLE email_received
ALTER COLUMN sender_person_email_id SET NOT NULL;

-- Drop old plain text columns
ALTER TABLE email_received
DROP COLUMN IF EXISTS sender_email;

ALTER TABLE email_received
DROP COLUMN IF EXISTS sender_name;

-- ============================================================================
-- VERIFICATION QUERIES (for manual testing after migration)
-- ============================================================================

-- Verify spam relationship exists for all users
-- SELECT COUNT(*) FROM user_relationships WHERE relationship_type = 'spam';

-- Verify email_sent schema
-- \d email_sent

-- Verify email_received schema
-- \d email_received

-- Test query: Get sender info through person_emails FK
-- SELECT
--   er.id,
--   er.subject,
--   pe.email_address as sender_email,
--   p.name as sender_name
-- FROM email_received er
-- INNER JOIN person_emails pe ON er.sender_person_email_id = pe.id
-- INNER JOIN people p ON pe.person_id = p.id
-- LIMIT 5;
