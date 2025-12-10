-- Add OAuth support to email_accounts table
ALTER TABLE email_accounts
ADD COLUMN oauth_provider VARCHAR(50),
ADD COLUMN oauth_refresh_token TEXT,
ADD COLUMN oauth_access_token TEXT,
ADD COLUMN oauth_token_expires_at TIMESTAMP,
ADD COLUMN oauth_user_id VARCHAR(255);

-- Add index for OAuth provider lookup
CREATE INDEX IF NOT EXISTS idx_email_accounts_oauth_provider ON email_accounts(oauth_provider, oauth_user_id);

-- Update comments
COMMENT ON COLUMN email_accounts.oauth_provider IS 'OAuth provider (google, microsoft, etc)';
COMMENT ON COLUMN email_accounts.oauth_refresh_token IS 'Encrypted OAuth refresh token';
COMMENT ON COLUMN email_accounts.oauth_access_token IS 'Encrypted OAuth access token';
COMMENT ON COLUMN email_accounts.oauth_token_expires_at IS 'When the access token expires';
COMMENT ON COLUMN email_accounts.oauth_user_id IS 'OAuth provider user ID';