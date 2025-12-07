-- Drop unused updated_at from email_sent (immutable table)
-- email_sent records are never updated after insertion

ALTER TABLE email_sent DROP COLUMN IF EXISTS updated_at;
