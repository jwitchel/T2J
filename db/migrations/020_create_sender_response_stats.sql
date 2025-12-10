-- Create sender_response_stats table for tracking user replies to senders
-- Used by spam detection to whitelist senders user has engaged with

-- Drop existing table if present (consolidating previous migrations)
DROP TABLE IF EXISTS sender_response_stats;

CREATE TABLE IF NOT EXISTS sender_response_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  email_account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  sender_email TEXT NOT NULL,
  response_count INTEGER DEFAULT 0 NOT NULL,
  first_response_at TIMESTAMPTZ,
  last_response_at TIMESTAMPTZ,
  last_updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, email_account_id, sender_email)
);

-- Index for fast lookups during spam detection
CREATE INDEX IF NOT EXISTS idx_sender_stats_lookup
ON sender_response_stats(user_id, email_account_id, sender_email);

-- Comments for documentation
COMMENT ON TABLE sender_response_stats IS 'Tracks how many times user has replied to each sender for spam detection';
COMMENT ON COLUMN sender_response_stats.response_count IS 'Number of times user has replied to this sender (all replies count as engagement)';
COMMENT ON COLUMN sender_response_stats.first_response_at IS 'When user first replied to this sender';
COMMENT ON COLUMN sender_response_stats.last_response_at IS 'When user most recently replied to this sender';
