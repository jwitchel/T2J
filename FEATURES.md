# Feature Reference

## Authentication

### Email/Password
- Sign up, sign in, sign out via better-auth

### OAuth
- Google OAuth for Gmail accounts
- Automatic token refresh
- Encrypted token storage (ENCRYPTION_KEY)

### API
See server/src/routes/auth.ts for authentication endpoints.

---

## Email Processing

### Spam Detection
- SpamDetector service (server/src/lib/spam-detector.ts)
- Auto-whitelist: 2+ replies to sender = not spam
- LLM analysis for unknown senders

### Draft Generation
- DraftGenerator service (server/src/lib/draft-generator.ts)
- Tone learning via vector search
- Multi-provider LLM support (OpenAI, Anthropic, Google, Ollama)
- Basic timeout protection (40s default)

### Action Routing
See `EmailActions` and `ActionHelpers` in server/src/lib/email-actions.ts for action types and routing logic.

### Duplicate Prevention
- BullMQ deterministic job IDs
- Database action tracking (email_action_tracking table)

### API
See server/src/routes/inbox.ts for email processing endpoints.

---

## Vector Tone Learning

### Storage
- PostgreSQL with vector columns
- Dual embeddings: semantic (384d) + style (768d)
- Tables: email_sent, email_received

### Search
- Vectra in-memory search
- Temporal weighting (recent emails prioritized)
- Relationship-based filtering
- VectorSearchService (server/src/lib/vector/vector-search-service.ts)

### Embeddings
- Semantic: Xenova/all-MiniLM-L6-v2
- Style: AnnaWegmann/Style-Embedding
- Services: EmbeddingService, StyleEmbeddingService

### Style Clustering
- K-means clustering (formal, neutral, casual)
- StyleClusteringService (server/src/lib/vector/style-clustering-service.ts)

### Configuration
```bash
EXAMPLE_COUNT=10
SEMANTIC_WEIGHT=0.4
STYLE_WEIGHT=0.6
VECTOR_SCORE_THRESHOLD=0.5
```

---

## Background Jobs

### Queues
- Inbox queue: Process incoming emails
- Training queue: Build tone profiles

### Worker Management
- Deterministic job IDs prevent duplicates
- Pause/resume functionality
- Stalled job cleanup on startup
- WorkerManager (server/src/lib/worker-manager.ts)

### Configuration
```bash
BULLMQ_INBOX_CONCURRENCY=5
BULLMQ_INBOX_LOCK_DURATION=120000
BULLMQ_TRAINING_CONCURRENCY=2
BULLMQ_TRAINING_LOCK_DURATION=600000
CHECK_MAIL_INTERVAL=60000
```

### API
See server/src/routes/workers.ts for worker management endpoints.

---

## IMAP Integration

### Features
- Connection pooling with reuse
- OAuth token refresh
- Encrypted password storage
- Polling-based monitoring (60s interval)

### Operations
See ImapOperations class in server/src/lib/imap-operations.ts for available IMAP operations.

### Services
- ImapOperations (server/src/lib/imap-operations.ts)
- ImapConnectionPool (server/src/lib/imap-pool.ts)
- EmailMover (server/src/lib/email-processing/email-mover.ts)

### API
See server/src/routes/imap.ts for IMAP endpoints.

---

## LLM Integration

### Providers
See LLMClient in server/src/lib/llm-client.ts for supported providers and models.

### Features
- Timeout protection (AbortController)
- Retry logic (3 attempts default)
- Token estimation and truncation
- Provider failover

### Service
- LLMClient (server/src/lib/llm-client.ts)

### Configuration
```bash
EMAIL_PROCESSING_LLM_TIMEOUT=40000
LLM_ACTION_RETRIES=3
```

### API
See server/src/routes/llm-providers.ts for LLM provider management endpoints.

---

## Relationships

### Types
See `RelationshipType` enum in server/src/lib/relationships/relationship-detector.ts for relationship types.

### Detection
- Email domain analysis
- Historical interaction patterns
- RelationshipDetector (server/src/lib/relationships/relationship-detector.ts)

### Management
- Person entities with email mappings
- User-to-person relationships
- Category-based grouping

### Services
- RelationshipService (server/src/lib/relationships/relationship-service.ts)
- PersonService (server/src/lib/relationships/person-service.ts)

---

## Real-time Logging

### WebSocket
- Endpoint: ws://localhost:3002/ws/imap-logs
- Authenticated connections
- Per-user log isolation

### Log Types
See `RealTimeLogEntry` interface in server/src/lib/real-time-logger.ts for log entry structure.

### Service
- RealTimeLogger (server/src/lib/real-time-logger.ts)

### API
See server/src/websocket/imap-logs-handler.ts for WebSocket message types and handlers.

---

## Database Schema

See server/migrations/*.sql for complete database schema and table definitions.

---

## Environment Variables

See .env.example for full list. Key variables:

---

## Development

### Quick Start
```bash
npm install
docker compose up -d
npm run db:migrate
npm run seed
npm run dev:all
```

### Testing
```bash
npm test              # All tests
npm run test:unit     # Unit tests only
npm run test:integration  # Integration tests
```

### Builds
```bash
npm run build         # Frontend
npm run server:build  # Backend
npm run lint          # ESLint
```

---

## Deployment Considerations

### Docker Services
- PostgreSQL: Required for data + vectors
- Redis: Required for sessions + queues
- No external vector database needed

### Scaling
- Worker concurrency adjustable via env vars
- IMAP connection pooling handles load
- Vectra in-memory search scales to ~1000 emails/query

### Security
- All secrets in environment variables
- Encrypted OAuth tokens
- httpOnly session cookies
- Input validation on all endpoints
