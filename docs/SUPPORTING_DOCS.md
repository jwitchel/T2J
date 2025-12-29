# Supporting Documentation

This document provides links to all markdown documentation files located in subdirectories throughout the codebase.

## Server Documentation

### IMAP Implementation
- **[server/src/lib/imap/README.md](../server/src/lib/imap/README.md)**
  - Comprehensive documentation for the IMAP implementation including connection pooling, error handling, real-time logging, and usage examples. Covers architecture, configuration, testing, and troubleshooting.

### Dependency Injection
- **[server/src/lib/DEPENDENCY_INJECTION.md](../server/src/lib/DEPENDENCY_INJECTION.md)**
  - Documents the hybrid dependency injection pattern used in the codebase, balancing testability with production convenience. Includes examples, best practices, and migration paths.

### Vector Services
- **[server/src/lib/vector/README.md](../server/src/lib/vector/README.md)**
  - Documentation for vector storage and embedding services using PostgreSQL and Vectra. Covers dual embeddings (semantic + style), temporal weighting, relationship-based search, and style clustering.

### Email Processing
- **[server/src/lib/email-processing/README.md](../server/src/lib/email-processing/README.md)**
  - Overview of the email processing system including duplicate prevention, processing flow, configuration, error handling, and user experience considerations.

### Pipeline Components
- **[server/src/lib/pipeline/README.md](../server/src/lib/pipeline/README.md)**
  - Testing guide for pipeline components including example selector and email ingestion pipeline. Provides instructions for quick tests, integration tests, and manual testing.

- **[server/src/lib/pipeline/TONE_LEARNING_E2E.md](../server/src/lib/pipeline/TONE_LEARNING_E2E.md)**
  - End-to-end documentation for the tone learning system. Covers architecture, components, testing, and configuration for learning writing style from historical emails.

- **[server/src/lib/PIPELINE.md](../server/src/lib/PIPELINE.md)**
  - Documentation for the Highland.js pipeline used for batch processing historical sent emails. Includes stream processing, error handling, batch processing, rate limiting, and performance considerations.

### Scripts
- **[server/src/scripts/README.md](../server/src/scripts/README.md)**
  - Directory structure and documentation for test utilities, tools, and demo data seeding scripts. Includes information about demo scripts, test scripts, pipeline scripts, and prerequisites.

### WebSocket

Real-time log streaming at `ws://localhost:3001/ws`. Requires session auth.

**Channel filtering**: `ws://localhost:3001/ws?channel=training`

Channels: `training`, `jobs`, `imap`, `system` (omit for all)

**Frontend**: `MuiLogViewer` component (`src/components/mui-log-viewer.tsx`)

**Backend**: `RealTimeLogger` emits logs → `UnifiedWebSocket` broadcasts to user's connections

### Service Token Authentication

Background workers (e.g., training-worker) use `SERVICE_TOKEN` to call protected API endpoints without a user session. The token is passed via `Authorization: Bearer <token>` header, and `userId` must be included in the request body.

```typescript
import { makeServiceRequest } from '../middleware/service-auth';

await makeServiceRequest('/api/training/analyze-patterns', 'POST', { force: true }, userId);
```

Set `SERVICE_TOKEN` in `.env` (generate with `openssl rand -base64 32`).
