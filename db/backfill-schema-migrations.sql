-- ONE-TIME SCRIPT: Run this on production BEFORE deploying new migrate.js
-- This backfills the schema_migrations table to prevent re-running old migrations
--
-- Run with: psql $DATABASE_URL -f db/backfill-schema-migrations.sql

-- Create the tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mark base schemas as applied
INSERT INTO schema_migrations (name) VALUES
  ('better-auth-schema'),
  ('base-schema'),
  ('relationship-schema')
ON CONFLICT (name) DO NOTHING;

-- Mark all existing migration files as applied
INSERT INTO schema_migrations (name) VALUES
  ('003_llm_providers.sql'),
  ('004_drop_avg_response_time.sql'),
  ('005_consolidate_tone_preferences.sql'),
  ('006_refactor_relationship_foreign_keys.sql'),
  ('008_drop_old_relationship_columns.sql'),
  ('009_add_oauth_to_email_accounts.sql'),
  ('010_add_updated_at_to_verification.sql'),
  ('011_add_image_to_user.sql'),
  ('011_create_oauth_sessions.sql'),
  ('012_add_user_preferences.sql'),
  ('012_drop_monitoring_settings.sql'),
  ('012_make_imap_password_nullable.sql'),
  ('013_add_action_taken_to_emails.sql'),
  ('014_remove_action_taken_at.sql'),
  ('015_add_action_tracking_indexes.sql'),
  ('016_add_subject_destination_to_action_tracking.sql'),
  ('017_add_sender_to_action_tracking.sql'),
  ('018_add_signature_patterns.sql'),
  ('019_add_uid_to_email_action_tracking.sql'),
  ('020_create_sender_response_stats.sql'),
  ('021_create_email_vector_tables.sql'),
  ('022_remove_unused_vector_columns.sql'),
  ('023_restore_style_vector_columns.sql'),
  ('024_add_vector_search_index.sql'),
  ('025_drop_sender_response_stats.sql'),
  ('026_backfill_vectors_not_null.sql'),
  ('027_fix_draft_tracking_nullable.sql'),
  ('028_normalize_email_ids.sql'),
  ('029_add_monitoring_enabled.sql'),
  ('030_drop_raw_text_column.sql'),
  ('031_remove_email_account_is_active.sql'),
  ('032_add_person_email_foreign_keys.sql'),
  ('033_add_spam_relationship.sql'),
  ('034_drop_denormalized_email_columns.sql'),
  ('035_user_reply_not_null.sql'),
  ('036_normalize_message_ids.sql'),
  ('037_merge_action_tracking.sql'),
  ('038_wipe_email_data.sql'),
  ('039_drop_action_tracking.sql'),
  ('040_simplify_draft_tracking.sql'),
  ('041_simplify_email_sent.sql'),
  ('042_simplify_tone_preferences.sql'),
  ('043_convert_timestamps_to_timestamptz.sql'),
  ('044_simplify_relationships.sql'),
  ('045_backfill_user_preferences.sql'),
  ('046_add_sent_folder_to_email_accounts.sql')
ON CONFLICT (name) DO NOTHING;

-- Verify
SELECT COUNT(*) as migrations_recorded FROM schema_migrations;
