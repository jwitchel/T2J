-- Drop unused columns from draft_tracking
-- relationship_type: Never read (queries use FK path), only written at insert, no audit need
-- user_sent_content: Zero usages - never read, never written (dead column)

ALTER TABLE draft_tracking DROP COLUMN IF EXISTS relationship_type;
ALTER TABLE draft_tracking DROP COLUMN IF EXISTS user_sent_content;
