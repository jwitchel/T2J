-- Migration: Create LLM providers table
-- Description: Store user's LLM provider configurations with encrypted API keys

-- Drop table if it exists (for development)
DROP TABLE IF EXISTS llm_providers CASCADE;

CREATE TABLE IF NOT EXISTS llm_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    provider_name VARCHAR(255) NOT NULL,
    provider_type VARCHAR(50) NOT NULL CHECK (provider_type IN ('openai', 'anthropic', 'google', 'local')),
    api_key_encrypted TEXT NOT NULL,
    api_endpoint TEXT, -- For custom/local endpoints
    model_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_llm_providers_user_id ON llm_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_providers_active ON llm_providers(user_id, is_active) WHERE is_active = true;

-- Create unique partial index to ensure only one default provider per user
CREATE UNIQUE INDEX idx_unique_default_provider ON llm_providers(user_id) WHERE is_default = true;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_llm_providers_updated_at BEFORE UPDATE
    ON llm_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();