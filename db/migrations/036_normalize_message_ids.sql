-- Normalize message IDs in draft_tracking table
-- Remove angle brackets to match email_received format

UPDATE draft_tracking
SET original_message_id = TRIM(BOTH '<>' FROM original_message_id)
WHERE original_message_id LIKE '<%>' OR original_message_id LIKE '%>';

UPDATE draft_tracking
SET draft_message_id = TRIM(BOTH '<>' FROM draft_message_id)
WHERE draft_message_id IS NOT NULL
  AND (draft_message_id LIKE '<%>' OR draft_message_id LIKE '%>');
