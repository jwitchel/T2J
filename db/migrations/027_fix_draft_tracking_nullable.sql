-- Migration: Make generated_content nullable in draft_tracking
-- Date: 2025-11-13
-- Purpose: Allow draft_tracking entries for emails without generated content (silent actions)

-- Step 1: Make generated_content nullable
ALTER TABLE draft_tracking
  ALTER COLUMN generated_content DROP NOT NULL;

-- Step 2: Make draft_message_id nullable (not all emails generate drafts)
ALTER TABLE draft_tracking
  ALTER COLUMN draft_message_id DROP NOT NULL;

-- Note: This allows draft_tracking to record ALL email processing,
-- not just emails that generate draft responses
