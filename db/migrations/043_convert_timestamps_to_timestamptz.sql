-- Migration: Convert all 'timestamp without time zone' columns to 'timestamp with time zone'
--
-- Why: PostgreSQL's 'timestamp without time zone' doesn't store timezone info, causing
-- the pg driver to interpret values as local server time. Our values are actually UTC,
-- so we convert to 'timestamptz' which explicitly stores UTC and handles conversions correctly.
--
-- The 'AT TIME ZONE 'UTC'' tells PostgreSQL that existing values are already UTC.

-- account table (better-auth managed)
ALTER TABLE account
  ALTER COLUMN "accessTokenExpiresAt" TYPE timestamptz USING "accessTokenExpiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "refreshTokenExpiresAt" TYPE timestamptz USING "refreshTokenExpiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- draft_tracking table
ALTER TABLE draft_tracking
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN sent_at TYPE timestamptz USING sent_at AT TIME ZONE 'UTC';

-- email_accounts table
ALTER TABLE email_accounts
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_sync TYPE timestamptz USING last_sync AT TIME ZONE 'UTC',
  ALTER COLUMN oauth_token_expires_at TYPE timestamptz USING oauth_token_expires_at AT TIME ZONE 'UTC';

-- email_received table
ALTER TABLE email_received
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN received_date TYPE timestamptz USING received_date AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN vector_generated_at TYPE timestamptz USING vector_generated_at AT TIME ZONE 'UTC';

-- email_sent table
ALTER TABLE email_sent
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN sent_date TYPE timestamptz USING sent_date AT TIME ZONE 'UTC',
  ALTER COLUMN vector_generated_at TYPE timestamptz USING vector_generated_at AT TIME ZONE 'UTC';

-- email_style_mapping table
ALTER TABLE email_style_mapping
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- oauth_sessions table
ALTER TABLE oauth_sessions
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- people table
ALTER TABLE people
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- person_emails table
ALTER TABLE person_emails
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- person_relationships table
ALTER TABLE person_relationships
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- session table (better-auth managed)
ALTER TABLE session
  ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "expiresAt" TYPE timestamptz USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- style_clusters table
ALTER TABLE style_clusters
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- tone_preferences table
ALTER TABLE tone_preferences
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- user table (better-auth managed)
ALTER TABLE "user"
  ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';

-- user_relationships table
ALTER TABLE user_relationships
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- verification table (better-auth managed)
ALTER TABLE verification
  ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "expiresAt" TYPE timestamptz USING "expiresAt" AT TIME ZONE 'UTC',
  ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC';
