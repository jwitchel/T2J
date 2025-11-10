-- Migration: Remove unused vector columns
-- Date: 2025-11-10
-- Changes:
--   1. Drop style_vector from email_sent and email_received (never populated)
--   2. Drop vector_generated_at from email_sent and email_received (never populated)
--
-- Rationale:
--   - style_vector was intended for style-based vector search but indexDocument()/batchIndex() are never called
--   - vector_generated_at only tracks when style_vector is updated, so no value without style_vector
--   - semantic_vector is the only vector field actually used and populated
--   - Removing these saves storage space and simplifies schema

BEGIN;

-- Drop style_vector from email_sent
ALTER TABLE email_sent
  DROP COLUMN IF EXISTS style_vector;

-- Drop vector_generated_at from email_sent
ALTER TABLE email_sent
  DROP COLUMN IF EXISTS vector_generated_at;

-- Drop style_vector from email_received
ALTER TABLE email_received
  DROP COLUMN IF EXISTS style_vector;

-- Drop vector_generated_at from email_received
ALTER TABLE email_received
  DROP COLUMN IF EXISTS vector_generated_at;

COMMIT;
