-- Make action_label NOT NULL (all alerts should have an action)
-- First set any null values to a default
UPDATE user_alerts SET action_label = 'View' WHERE action_label IS NULL;

-- Then add NOT NULL constraint
ALTER TABLE user_alerts ALTER COLUMN action_label SET NOT NULL;
