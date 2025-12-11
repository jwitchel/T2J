-- Backfill default preferences for existing users who don't have them initialized
-- This ensures users created before the databaseHooks change have valid preferences

UPDATE "user"
SET preferences = jsonb_set(
  jsonb_set(
    COALESCE(preferences, '{}'),
    '{folderPreferences}',
    '{"rootFolder": "", "draftsFolderPath": "Drafts", "noActionFolder": "NoAction", "spamFolder": "Spam", "todoFolder": "Todo"}'::jsonb
  ),
  '{actionPreferences}',
  '{"spamDetection": true, "silentActions": {"silent-fyi-only": true, "silent-large-list": true, "silent-unsubscribe": true, "silent-todo": true}, "draftGeneration": true}'::jsonb
)
WHERE preferences IS NULL
   OR preferences->'folderPreferences' IS NULL
   OR preferences->'actionPreferences' IS NULL;
