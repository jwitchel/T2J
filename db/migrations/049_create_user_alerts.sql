-- Generic user alerts table for any provider errors
-- Supports email accounts, LLM providers, and future integrations

CREATE TABLE user_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,

  -- Alert classification
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL,

  -- Source identification (polymorphic)
  source_type VARCHAR(50) NOT NULL,
  source_id TEXT NOT NULL,
  source_name VARCHAR(255) NOT NULL,

  -- Alert content
  message TEXT NOT NULL,
  action_url VARCHAR(255),
  action_label VARCHAR(50),

  -- Error tracking (for repeated failures)
  error_count INT NOT NULL DEFAULT 1,
  last_occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Partial unique index: only one active alert per source/type combination
CREATE UNIQUE INDEX idx_user_alerts_unique_active
  ON user_alerts(user_id, source_type, source_id, alert_type)
  WHERE resolved_at IS NULL;

-- Index for efficient active alert queries
CREATE INDEX idx_user_alerts_active
  ON user_alerts(user_id, resolved_at)
  WHERE resolved_at IS NULL;

-- Index for source lookups (used by resolveAlertsForSource)
CREATE INDEX idx_user_alerts_source
  ON user_alerts(source_type, source_id);

-- Index for notification job (find alerts needing email notification)
CREATE INDEX idx_user_alerts_needs_notify
  ON user_alerts(error_count, notified_at)
  WHERE resolved_at IS NULL AND notified_at IS NULL;
