# Email Processing System

## Overview

The email processing system handles automated draft generation for incoming emails with distributed locking to prevent duplicates and optimistic action tracking for crash recovery.

## Architecture

### Core Services

#### `inbox-processor.ts` - Central Processing Engine
- **Purpose**: Orchestrates single email and batch email processing
- **Key Features**:
  - Distributed locking via `email-lock-manager` prevents concurrent processing
  - AbortSignal integration detects lock expiry during long operations
  - Optimistic action tracking prevents duplicates on crash
  - IMAP context management for connection reuse

**Processing Flow**:
1. Acquire distributed lock on email (by Message-ID)
2. Generate draft with LLM (timeout: 20s)
3. **Check AbortSignal** (prevents stale operations if lock expired)
4. **Record action tracking** (optimistic - prevents retry on crash)
5. **Check AbortSignal again** (before IMAP operations)
6. Upload draft OR move email (based on action type)
7. Save email to database
8. Release lock automatically

#### `email-lock-manager.ts` - Distributed Locking
- **Purpose**: Prevents duplicate draft creation when UI and scheduler process same email concurrently
- **Implementation**: Redlock algorithm using Redis
- **Configuration**:
  - Lock TTL: `EMAIL_PROCESSING_LOCK_TTL` (default: 30000ms)
  - Lock key format: `lock:email:{accountId}:{messageId}`
  - Fail-fast behavior (no retries on lock contention)

**Features**:
- Automatic lock acquisition and release using Redlock's `using()` pattern
- AbortSignal integration for graceful cancellation
- Returns `{ acquired: false }` when lock held by another process

#### `draft-generator.ts` - LLM Draft Creation
- **Purpose**: Generate personalized email replies using LLM
- **Timeout**: `EMAIL_PROCESSING_LLM_TIMEOUT` (default: 20000ms)
- **Features**:
  - Promise.race() pattern for timeout protection
  - Tone profile retrieval and application
  - Email parsing and analysis

#### `email-mover.ts` - IMAP Operations
- **Purpose**: Move emails and upload drafts to IMAP folders
- **Key Methods**:
  - `uploadDraft()`: Creates draft in Drafts folder (original stays in INBOX)
  - `moveEmail()`: Moves email to target folder based on action type

**Silent Actions** (auto-move):
- `silent-fyi-only` → "t2j-no-action" folder
- `silent-large-list` → "t2j-no-action" folder
- `silent-unsubscribe` → "t2j-no-action" folder
- `silent-spam` → "t2j-spam" folder

**Draft Actions** (upload draft only):
- `reply` → Draft created, original stays in INBOX

## Race Condition Protection

### Problem: Duplicate Drafts
When the same email is processed concurrently by multiple sources (UI button click, scheduler batch), the system could create duplicate drafts with different Message-IDs, causing Gmail issues.

### Solution: Three-Layer Protection

#### 1. Distributed Locking (Prevents Concurrent Processing)
```typescript
const lockResult = await emailLockManager.processWithLock(
  emailId,
  accountId,
  (signal) => this._executeProcessing(params, signal)
);

if (!lockResult.acquired) {
  return { success: false, action: 'skipped' };  // 409 Conflict
}
```

**Effect**: Only one process can work on a specific email at a time.

#### 2. AbortSignal Checks (Prevents Stale Operations)
```typescript
// After LLM generation
if (signal.aborted) {
  throw new Error('Lock expired during draft generation');
}

// Before IMAP operations
if (signal.aborted) {
  throw new Error('Lock expired before IMAP operations');
}
```

**Effect**: If lock expires during slow LLM call (>30s), process aborts before creating draft.

#### 3. Optimistic Action Tracking (Prevents Retry Duplicates)
```typescript
// Record action BEFORE IMAP operations
await EmailActionTracker.recordAction(userId, accountId, messageId, 'draft_created');

try {
  await emailMover.uploadDraft(...);
} catch (error) {
  // Rollback on failure
  await EmailActionTracker.resetAction(accountId, messageId);
  throw error;
}
```

**Effect**: If process crashes after IMAP but before tracking, email won't be reprocessed.

## User Experience

### Single Email Processing (UI)
**User Action**: Clicks "Create Draft" button

**Result**:
- ✅ Draft appears in Drafts folder
- ✅ Original email stays in INBOX (user can reference while editing)
- ✅ No duplicates even on double-click (lock prevents concurrent processing)
- ✅ Email won't be reprocessed by scheduler (action tracking)

### Batch Processing (Scheduler)
**System Action**: Processes N emails per minute (configured by `INBOX_BATCH_SIZE`)

**Result**:
- ✅ Only unprocessed emails are selected (action tracking filter)
- ✅ Each email gets its own lock (prevents UI collision)
- ✅ Drafts appear in Drafts folder
- ✅ Silent actions moved to appropriate folders
- ✅ Reply actions stay in INBOX

## Configuration

### Environment Variables
```bash
# Lock timeout in milliseconds (default: 30000 = 30 seconds)
EMAIL_PROCESSING_LOCK_TTL=30000

# LLM generation timeout in milliseconds (default: 20000 = 20 seconds)
EMAIL_PROCESSING_LLM_TIMEOUT=20000

# Batch size for scheduler processing (default: 3)
INBOX_BATCH_SIZE=3
```

### Redis Connection
- Uses `REDIS_URL` environment variable (default: redis://localhost:6380)
- Redlock automatically handles connection pooling

## Error Handling

### Lock Contention (409 Conflict)
- **Cause**: Email is being processed by another request
- **Response**: HTTP 409 with message "Email is being processed by another request"
- **User Impact**: Prevents duplicate, shows clear feedback

### LLM Timeout (500 Error)
- **Cause**: Draft generation exceeds `EMAIL_PROCESSING_LLM_TIMEOUT`
- **Response**: HTTP 500 with timeout error
- **User Impact**: Can retry manually, email stays unprocessed

### Lock Expiry During Processing
- **Cause**: Lock expired during long LLM call or IMAP operations
- **Response**: AbortSignal throws error, no draft created
- **User Impact**: Email stays unprocessed, can be retried

### IMAP Failure
- **Cause**: Network error, folder not found, etc.
- **Action**: Rollback action tracking
- **User Impact**: Email stays unprocessed, error logged

## Logging

**Production Logging** (errors only):
- All errors logged with `console.error()`
- No verbose operational logs in production
- Silent success for normal operations

**Monitoring**:
- Track 409 Conflict responses (indicates concurrent processing attempts)
- Monitor lock acquisition failures (may indicate Redis issues)
- Watch for timeout errors (may need LLM timeout adjustment)

## Testing

### Manual Testing Scenarios
1. **Single Email**: Click "Create Draft" → verify draft created, original in INBOX
2. **Double-Click**: Rapidly click "Create Draft" twice → verify only one draft
3. **UI + Scheduler Race**: Click button while scheduler runs → verify only one draft
4. **LLM Timeout**: Process email with very long context → verify clean timeout handling
5. **Silent Actions**: Process spam → verify auto-moved to spam folder

### Load Testing
- Process multiple emails concurrently via scheduler
- Verify no duplicates created
- Check Redis lock cleanup (all locks should release)

## Troubleshooting

### Issue: Duplicate Drafts Still Appearing
**Diagnosis**:
1. Check Redis is running and accessible
2. Verify `EMAIL_PROCESSING_LOCK_TTL` is not too short
3. Check logs for "Lock already held" messages
4. Verify action tracking database is working

**Solution**: Usually indicates Redis connection issue or action tracking database problem.

### Issue: Emails Not Being Processed
**Diagnosis**:
1. Check for lock acquisition failures in logs
2. Verify action tracking shows `actionTaken = 'none'` for unprocessed emails
3. Check scheduler is running (`npm run dev:all`)

**Solution**: Force flag can override action tracking for manual reprocessing.

### Issue: Lock Timeouts Frequent
**Diagnosis**: LLM calls taking >30s regularly

**Solution**: Increase `EMAIL_PROCESSING_LOCK_TTL` or optimize LLM prompt/context size.

## Architecture Decisions

### Why Original Email Stays in INBOX?
- User can reference original while editing draft
- Consistent behavior across all draft creation methods
- Manual email management preferred over automatic archiving

### Why Optimistic Action Tracking?
- Prevents duplicates if process crashes after IMAP but before tracking
- More reliable than pessimistic (track after IMAP)
- Rollback mechanism handles failure cases

### Why AbortSignal Checks?
- Detects lock expiry during long operations
- Prevents stale processes from creating drafts after lock expires
- Graceful degradation vs. letting operation complete

### Why No Lock Retries?
- Fail-fast behavior provides clear user feedback
- Retries could mask underlying race conditions
- User can manually retry if needed

## Future Enhancements

### Potential Improvements
1. **UI Indicator**: Show which emails have drafts created
2. **Draft Regeneration**: Add "Regenerate Draft" button with force flag
3. **Lock Monitoring**: Dashboard showing active locks and contention metrics
4. **Adaptive Timeouts**: Dynamically adjust based on LLM response times
5. **Batch Lock Optimization**: Pre-acquire locks for batch processing
