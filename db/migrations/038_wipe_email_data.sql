-- Migration: Wipe email data for clean start
-- This is needed because the schema has changed significantly
-- (action tracking merged into email_received)

TRUNCATE TABLE draft_tracking CASCADE;
TRUNCATE TABLE email_received CASCADE;
TRUNCATE TABLE email_sent CASCADE;
