# WebSocket Integration with Email Processing

This document describes how the WebSocket real-time logging is integrated with the email processing pipeline.

## Overview

The WebSocket integration provides real-time visibility into email processing operations through the Tone Analysis page at `http://localhost:3001/tone` (Training tab).

## Key Components

### 1. Real-Time Logger (`lib/real-time-logger.ts`)
- Centralized logging service for all IMAP and email processing operations
- Emits events that are broadcast via WebSocket to connected clients
- Maintains a circular buffer of logs per user (default: 1000 logs)
- Sanitizes sensitive data (passwords, email content) before logging

### 2. WebSocket Server (`websocket/unified-websocket.ts`)
- Authenticated WebSocket endpoint at `ws://localhost:3002/ws`
- Uses better-auth for session validation
- Broadcasts logs and job events only to the authenticated user
- Supports channel-based subscriptions
- Supports heartbeat/ping-pong for connection health

### 3. Email Processor Integration (`lib/email-processor.ts`)
- Enhanced with `ProcessingContext` to include user and account information
- Logs start and completion of email processing
- Tracks metrics like processing time and text reduction percentage

### 4. Frontend Components
- **ImapLogViewer** (`src/components/imap-log-viewer.tsx`): Real-time log display
- **Tone Analysis Page** (`src/app/tone/page.tsx`): Training tab with TrainingPanel and real-time logs

## Log Types

The system logs various operations:

- `EMAIL_PARSE_START`: Beginning of email parsing
- `EMAIL_PARSE_COMPLETE`: Completion with metrics
- `EMAIL_PROCESS_DEMO`: Demo of full processing pipeline
- `CONNECT`, `LOGIN`, `SELECT`, `FETCH`: Standard IMAP operations

## Testing the Integration

### 1. Using the Demo Script
```bash
npm run demo:websocket
```

This runs a standalone demo showing how email processing generates WebSocket logs.

### 2. Using the Web Interface
1. Start the servers: `npm run dev:all`
2. Sign in at `http://localhost:3001`
3. Visit `http://localhost:3001/tone` and click the "Training" tab
4. Use the Training Panel to load and process emails
5. Click "Load Emails" to see email extraction in action

### 3. Programmatic Testing
```typescript
import { emailProcessor, ProcessingContext } from './lib/email-processor';
import { realTimeLogger } from './lib/real-time-logger';

const context: ProcessingContext = {
  userId: 'user-123',
  emailAccountId: 'account-456'
};

// Process an email with logging
const result = await emailProcessor.processRawEmail(rawEmail, context);

// Logs are automatically sent via WebSocket to connected clients
```

## Security Considerations

1. **Authentication**: All WebSocket connections require valid session cookies
2. **Data Isolation**: Users only see their own logs
3. **Sanitization**: Passwords and email content are redacted in logs
4. **Connection Management**: Automatic cleanup on disconnection

## Performance

- Logs are stored in memory (not persisted to database)
- Circular buffer prevents memory growth
- WebSocket broadcasting is efficient for real-time updates
- Processing metrics help identify performance bottlenecks

## Future Enhancements

1. Persist important logs to database for audit trail
2. Add log filtering and search capabilities
3. Export logs for debugging
4. Add more granular log levels
5. Include tone analysis and relationship detection logs