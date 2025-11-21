-- Migration 005: Remove is_active column from email_accounts table
-- This column was an artifact from earlier design and was always set to true
-- The monitoring_enabled column serves the actual purpose of enabling/disabling accounts

-- Drop the is_active column
ALTER TABLE email_accounts DROP COLUMN IF EXISTS is_active;
