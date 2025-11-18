-- Add signature_patterns field to user table
ALTER TABLE "user" 
ADD COLUMN signature_patterns TEXT[] DEFAULT '{}';

-- Add comment explaining the field
COMMENT ON COLUMN "user".signature_patterns IS 'Array of regex patterns to match and remove email signatures';

-- Example patterns that would match common signatures:
-- '^--+\s*$' matches lines like "---" or "-- "
-- '^—+\s*$' matches em-dash lines
-- '^(Best|Regards|Thanks|Sincerely|Cheers).*$' matches common closings
-- 'Cell:\s*[\d\-\(\)\s]+' matches phone numbers