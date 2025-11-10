-- Migration: Restore style_vector and vector_generated_at columns
-- Date: 2025-11-10
-- Changes:
--   1. Restore style_vector to email_sent and email_received
--   2. Restore vector_generated_at to email_sent and email_received
--
-- Rationale:
--   - These columns are part of the dual-path analysis architecture (semantic + style)
--   - Semantic vectors (384d) capture content/meaning similarity
--   - Style vectors (768d) capture writing style similarity
--   - Draft generation uses both: 40% semantic + 60% style for higher quality
--   - Style vectors are generated during training/analysis phase via batchIndex()
--   - vector_generated_at tracks when both vectors were last updated

BEGIN;

-- Restore style_vector to email_sent
ALTER TABLE email_sent
  ADD COLUMN IF NOT EXISTS style_vector real[];

-- Restore vector_generated_at to email_sent
ALTER TABLE email_sent
  ADD COLUMN IF NOT EXISTS vector_generated_at timestamp;

-- Restore style_vector to email_received
ALTER TABLE email_received
  ADD COLUMN IF NOT EXISTS style_vector real[];

-- Restore vector_generated_at to email_received
ALTER TABLE email_received
  ADD COLUMN IF NOT EXISTS vector_generated_at timestamp;

COMMIT;
