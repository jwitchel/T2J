-- Drop sender_response_stats table - no longer needed
-- Spam detection now queries email_sent table directly for response counts
-- This table was denormalizing data unnecessarily

DROP TABLE IF EXISTS sender_response_stats;
