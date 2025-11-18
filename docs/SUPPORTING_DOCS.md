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
- **[server/src/websocket/README.md](../server/src/websocket/README.md)**
  - Documentation for the WebSocket IMAP logs server providing real-time streaming of IMAP operation logs. Covers endpoint, authentication, client/server message types, and usage examples.

- **[server/src/websocket/INTEGRATION.md](../server/src/websocket/INTEGRATION.md)**
  - Guide for WebSocket integration with email processing. Describes how real-time logging is integrated with the email processing pipeline, including components, log types, testing, and security considerations.

### Middleware
- **[server/src/middleware/SERVICE_AUTH_USAGE.md](../server/src/middleware/SERVICE_AUTH_USAGE.md)**
  - Usage guide for service token authentication allowing background workers and scheduled jobs to call protected API endpoints without a user session. Includes configuration, usage examples, and security considerations.

