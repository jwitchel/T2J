-- Migration: Create email tables with vector support
-- Purpose: Create email_sent and email_received tables for vector search
-- Date: 2025-11-10

-- Create email_sent table
CREATE TABLE IF NOT EXISTS email_sent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id text UNIQUE NOT NULL,  -- Original message ID from email
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    email_account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,

    -- Email content
    user_reply text,  -- What the user wrote (excluding quotes/signatures)
    raw_text text,    -- Full email text
    subject text NOT NULL,  -- Subject is required
    full_message text NOT NULL,  -- Complete raw email (headers + body)

    -- Recipient information
    recipient_email text NOT NULL,  -- Recipient email is required
    recipient_name text,

    -- Relationship and metadata
    relationship_type text,
    word_count integer,
    sent_date timestamp NOT NULL,

    -- Vector columns (added by migration)
    semantic_vector real[],
    style_vector real[],
    vector_generated_at timestamp,

    -- Timestamps
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW()
);

-- Create email_received table
CREATE TABLE IF NOT EXISTS email_received (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id text UNIQUE NOT NULL,  -- Original message ID from email
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    email_account_id uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,

    -- Email content
    raw_text text,
    subject text NOT NULL,  -- Subject is required
    full_message text NOT NULL,  -- Complete raw email (headers + body)

    -- Sender information
    sender_email text NOT NULL,  -- Sender email is required
    sender_name text,

    -- Metadata
    word_count integer,
    received_date timestamp NOT NULL,

    -- Vector columns (added by migration)
    semantic_vector real[],
    style_vector real[],
    vector_generated_at timestamp,

    -- Timestamps
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW()
);

-- Create indexes for faster retrieval
CREATE INDEX IF NOT EXISTS idx_email_sent_user_date
ON email_sent(user_id, sent_date DESC);

CREATE INDEX IF NOT EXISTS idx_email_sent_relationship
ON email_sent(user_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_email_sent_recipient
ON email_sent(recipient_email);

CREATE INDEX IF NOT EXISTS idx_email_received_user_date
ON email_received(user_id, received_date DESC);

CREATE INDEX IF NOT EXISTS idx_email_received_sender
ON email_received(sender_email);

-- Create style_clusters table
CREATE TABLE IF NOT EXISTS style_clusters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    relationship_type text NOT NULL,
    cluster_name text NOT NULL,
    centroid_vector real[],
    email_count integer DEFAULT 0,
    created_at timestamp DEFAULT NOW(),
    updated_at timestamp DEFAULT NOW(),
    UNIQUE(user_id, relationship_type, cluster_name)
);

-- Create email_style_mapping table
CREATE TABLE IF NOT EXISTS email_style_mapping (
    email_id uuid NOT NULL,
    email_type text NOT NULL,  -- 'sent' or 'received'
    style_cluster_id uuid NOT NULL REFERENCES style_clusters(id) ON DELETE CASCADE,
    style_score real,
    created_at timestamp DEFAULT NOW(),
    PRIMARY KEY (email_id, email_type)
);

-- Create index for style lookups
CREATE INDEX IF NOT EXISTS idx_style_clusters_user_relationship
ON style_clusters(user_id, relationship_type);

CREATE INDEX IF NOT EXISTS idx_email_style_mapping_cluster
ON email_style_mapping(style_cluster_id);
