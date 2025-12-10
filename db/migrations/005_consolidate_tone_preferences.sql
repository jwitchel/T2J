-- Migration: 005_consolidate_tone_preferences.sql
-- Description: Consolidate tone_profiles and relationship_tone_preferences into a single table
-- Date: 2025-07-29

-- Drop the old tables
DROP TABLE IF EXISTS tone_profiles CASCADE;
DROP TABLE IF EXISTS relationship_tone_preferences CASCADE;

-- Create unified tone preferences table
CREATE TABLE IF NOT EXISTS tone_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  preference_type VARCHAR(20) NOT NULL CHECK (preference_type IN ('aggregate', 'category', 'individual')),
  target_identifier VARCHAR(100) NOT NULL,
  profile_data JSONB NOT NULL DEFAULT '{}',
  emails_analyzed INTEGER DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, preference_type, target_identifier)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tone_preferences_user ON tone_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_tone_preferences_lookup ON tone_preferences(user_id, preference_type, target_identifier);

-- Add updated_at trigger
DROP TRIGGER IF EXISTS update_tone_preferences_updated_at ON tone_preferences;
CREATE TRIGGER update_tone_preferences_updated_at BEFORE UPDATE ON tone_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();