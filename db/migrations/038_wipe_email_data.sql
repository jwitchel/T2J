-- Migration: Wipe email data for clean start (ONE-TIME ONLY)
-- This was needed because the schema changed significantly
-- (action tracking merged into email_received)
--
-- WARNING: This migration is tracked in schema_migrations and should
-- NEVER run again. If you see this running, something is wrong with
-- migration tracking.

-- Guard: Only run if schema_migrations doesn't exist (first-time setup)
-- After migrate.js update, this will never execute because it's tracked
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations') THEN
    RAISE NOTICE 'schema_migrations exists - this migration should be tracked and skipped';
    RETURN;
  END IF;

  -- Only execute TRUNCATE if we somehow got here without tracking
  TRUNCATE TABLE draft_tracking CASCADE;
  TRUNCATE TABLE email_received CASCADE;
  TRUNCATE TABLE email_sent CASCADE;
END $$;
