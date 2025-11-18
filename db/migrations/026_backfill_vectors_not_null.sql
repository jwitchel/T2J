-- Migration: Backfill null vectors with zeros and add NOT NULL constraints
-- Date: 2025-11-13
-- Purpose: Ensure all emails have vector embeddings (zero-filled if content unavailable)

-- Step 1: Backfill null semantic_vector with zeros (384 dimensions)
-- Semantic embeddings use Xenova/all-MiniLM-L6-v2 model
UPDATE email_received
SET semantic_vector = (
  SELECT array_agg(0::real)
  FROM generate_series(1, 384)
)
WHERE semantic_vector IS NULL;

UPDATE email_sent
SET semantic_vector = (
  SELECT array_agg(0::real)
  FROM generate_series(1, 384)
)
WHERE semantic_vector IS NULL;

-- Step 2: Backfill null style_vector with zeros (768 dimensions)
-- Style embeddings use AnnaWegmann/Style-Embedding model
UPDATE email_received
SET style_vector = (
  SELECT array_agg(0::real)
  FROM generate_series(1, 768)
)
WHERE style_vector IS NULL;

UPDATE email_sent
SET style_vector = (
  SELECT array_agg(0::real)
  FROM generate_series(1, 768)
)
WHERE style_vector IS NULL;

-- Step 3: Add NOT NULL constraints (now that all rows have values)
ALTER TABLE email_received
  ALTER COLUMN semantic_vector SET NOT NULL,
  ALTER COLUMN style_vector SET NOT NULL;

ALTER TABLE email_sent
  ALTER COLUMN semantic_vector SET NOT NULL,
  ALTER COLUMN style_vector SET NOT NULL;

-- Note: PostgreSQL doesn't support DEFAULT for array columns in ALTER TABLE
-- The application code (EmailRepository) ensures vectors are always provided
