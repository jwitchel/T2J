-- Migration: 044_simplify_relationships.sql
-- Description: Simplify relationship model - move relationship directly onto people table
--              Drop person_relationships and user_relationships tables entirely

-- Step 1: Add relationship columns to people table (temporarily nullable for migration)
ALTER TABLE people
ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS relationship_user_set BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS relationship_confidence FLOAT;

-- Step 2: Migrate data from person_relationships (keep primary/best relationship per person)
UPDATE people p
SET
  relationship_type = subq.relationship_type,
  relationship_user_set = subq.user_set,
  relationship_confidence = subq.confidence
FROM (
  SELECT DISTINCT ON (pr.person_id)
    pr.person_id,
    ur.relationship_type,
    pr.user_set,
    pr.confidence
  FROM person_relationships pr
  JOIN user_relationships ur ON pr.user_relationship_id = ur.id
  ORDER BY pr.person_id, pr.is_primary DESC, pr.user_set DESC, pr.confidence DESC
) subq
WHERE p.id = subq.person_id;

-- Step 3: Remove FK constraint from relationship_tone_preferences
ALTER TABLE relationship_tone_preferences
DROP CONSTRAINT IF EXISTS relationship_tone_preferences_user_id_relationship_type_fkey;

-- Step 3b: Remove FK constraint and column from tone_preferences (references user_relationships)
ALTER TABLE tone_preferences
DROP CONSTRAINT IF EXISTS fk_tone_preferences_user_relationship;
DROP INDEX IF EXISTS idx_tone_preferences_user_relationship;
ALTER TABLE tone_preferences
DROP COLUMN IF EXISTS user_relationship_id;

-- Step 4: Drop person_relationships table (and its triggers)
DROP TRIGGER IF EXISTS update_person_relationships_updated_at ON person_relationships;
DROP TABLE IF EXISTS person_relationships;

-- Step 5: Drop user_relationships table (and its triggers)
DROP TRIGGER IF EXISTS update_user_relationships_updated_at ON user_relationships;
DROP TABLE IF EXISTS user_relationships;

-- Step 6: Drop orphaned indexes
DROP INDEX IF EXISTS idx_one_primary_per_person;
DROP INDEX IF EXISTS idx_person_relationships_user_person;

-- Step 7: Add NOT NULL constraints (all existing data should have values from migration)
ALTER TABLE people ALTER COLUMN relationship_type SET NOT NULL;
ALTER TABLE people ALTER COLUMN relationship_user_set SET NOT NULL;
ALTER TABLE people ALTER COLUMN relationship_confidence SET NOT NULL;
ALTER TABLE people ALTER COLUMN relationship_confidence DROP DEFAULT;
