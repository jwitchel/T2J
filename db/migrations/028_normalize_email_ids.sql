-- Migration: Normalize message IDs across all email tables
-- Date: 2025-11-13
-- Purpose: Remove angle brackets from email_id columns to match email_action_tracking format

-- Normalize message IDs in email_received table
-- Before: <message@example.com>
-- After: message@example.com
UPDATE email_received
SET email_id = TRIM(BOTH '<>' FROM email_id)
WHERE email_id LIKE '<%>';

-- Normalize message IDs in email_sent table
UPDATE email_sent
SET email_id = TRIM(BOTH '<>' FROM email_id)
WHERE email_id LIKE '<%>';

-- Normalize message IDs in draft_tracking table (original_message_id)
UPDATE draft_tracking
SET original_message_id = TRIM(BOTH '<>' FROM original_message_id)
WHERE original_message_id LIKE '<%>';

-- Note: email_action_tracking already stores normalized IDs (via normalizeEmailId function)
-- This migration ensures all tables use the same normalized format
