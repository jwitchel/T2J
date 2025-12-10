-- Migration: 006_refactor_relationship_foreign_keys.sql
-- Description: Refactor to use user_relationships.id as foreign key instead of relationship_type strings
-- Date: 2025-07-29

-- Step 1: Add new columns
ALTER TABLE person_relationships 
ADD COLUMN user_relationship_id UUID;

ALTER TABLE tone_preferences 
ADD COLUMN user_relationship_id UUID;

-- Step 2: Populate the new columns with the correct IDs
UPDATE person_relationships pr
SET user_relationship_id = ur.id
FROM user_relationships ur
WHERE pr.user_id = ur.user_id 
  AND pr.relationship_type = ur.relationship_type;

UPDATE tone_preferences tp
SET user_relationship_id = ur.id
FROM user_relationships ur
WHERE tp.user_id = ur.user_id 
  AND tp.preference_type = 'category'
  AND tp.target_identifier = ur.relationship_type;

-- Step 3: Add foreign key constraints
ALTER TABLE person_relationships
ADD CONSTRAINT fk_person_relationships_user_relationship
FOREIGN KEY (user_relationship_id) 
REFERENCES user_relationships(id) ON DELETE CASCADE;

ALTER TABLE tone_preferences
ADD CONSTRAINT fk_tone_preferences_user_relationship
FOREIGN KEY (user_relationship_id) 
REFERENCES user_relationships(id) ON DELETE CASCADE;

-- Step 4: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_person_relationships_user_relationship 
ON person_relationships(user_relationship_id);

CREATE INDEX IF NOT EXISTS idx_tone_preferences_user_relationship 
ON tone_preferences(user_relationship_id);

-- Step 5: Make user_relationship_id NOT NULL for person_relationships
-- (We'll keep relationship_type for now as a backup)
ALTER TABLE person_relationships
ALTER COLUMN user_relationship_id SET NOT NULL;

-- Note: We keep the old columns for now to ensure a safe migration
-- They can be dropped in a future migration after verifying everything works