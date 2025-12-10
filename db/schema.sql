-- Note: The "user" table is created by better-auth-schema.sql
-- We reference it with TEXT user_id columns

CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  email_address VARCHAR(255) NOT NULL,
  imap_host VARCHAR(255) NOT NULL,
  imap_port INTEGER NOT NULL,
  imap_username VARCHAR(255) NOT NULL,
  imap_password_encrypted TEXT NOT NULL,
  last_sync TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS draft_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  email_account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
  original_message_id VARCHAR(255) NOT NULL,
  draft_message_id VARCHAR(255) NOT NULL,
  generated_content TEXT NOT NULL,
  relationship_type VARCHAR(50),
  context_data JSONB,
  user_sent_content TEXT,
  edit_analysis JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  sent_at TIMESTAMP
);
