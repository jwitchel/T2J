# Email Processing System

## Duplicate Prevention

**BullMQ Job IDs**: Deterministic job IDs prevent duplicate processing. Format: `inbox:{userId}:{accountId}:{folder}`. BullMQ automatically rejects jobs with duplicate IDs.

**Database Action Tracking**: `EmailActionTracker.hasEmailBeenProcessed()` queries the `email_action_tracking` table before processing. Returns true if email already has an action recorded.

## Processing Flow

See `inbox-processor.ts` for the main email processing pipeline.

Supporting services:
- **SpamDetector** (`../spam-detector.ts`) - Spam detection logic
- **DraftGenerator** (`../draft-generator.ts`) - Draft generation with tone learning
- **EmailActionRouter** (`../email-action-router.ts`) - Action determination logic
- **EmailMover** (`email-mover.ts`) - IMAP folder operations
- **EmailActionTracker** (`../email-action-tracker.ts`) - Duplicate detection via database
- **EmailActions** (`../email-actions.ts`) - Action type constants and helpers

## Configuration
See .env and env.example for all configurations

## Error Handling

**IMAP Failure**: Logs error, email stays unprocessed for retry.

**Duplicate Request**: If job ID already exists in BullMQ queue, request is silently ignored.

## User Experience

**Single Email (UI)**:
- Click "Create Draft" button
- Draft appears in Drafts folder
- Original stays in INBOX

**Batch Processing (Scheduler)**:
- Runs every 60 seconds
- Processes up to `INBOX_BATCH_SIZE` emails
- Skips already-processed emails (via action tracking)
- Creates drafts or moves to folders based on action type

## Testing

See `inbox-processor.test.ts` for unit tests.

Manual testing:
1. Click "Create Draft" → verify draft created, original in INBOX
2. Process spam email → verify moved to t2j-spam folder
3. Check action_tracking table → verify action recorded
