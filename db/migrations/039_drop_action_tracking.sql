-- Migration: Drop the old email_action_tracking table
-- All action tracking is now done in email_received

DROP TABLE IF EXISTS email_action_tracking;
