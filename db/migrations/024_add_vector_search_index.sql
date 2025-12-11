-- Add composite index for optimized vector search queries
-- This index speeds up filtered queries that search by user_id and sort by sent_date
-- with the additional WHERE clause for non-null semantic_vector

-- Create index for optimized vector search queries
CREATE INDEX IF NOT EXISTS idx_email_sent_user_vectors_date
ON email_sent (user_id, sent_date DESC)
WHERE semantic_vector IS NOT NULL;

-- This index optimizes the common query pattern:
-- SELECT * FROM email_sent
-- WHERE user_id = ? AND semantic_vector IS NOT NULL
-- ORDER BY sent_date DESC
-- LIMIT ?
