-- Drop redundant last_updated from tone_preferences
-- The updated_at column with auto-update trigger handles this already

ALTER TABLE tone_preferences DROP COLUMN IF EXISTS last_updated;
