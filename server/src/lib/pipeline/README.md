# Pipeline Components Testing Guide

This directory contains the orchestration layer for the vector-based tone learning pipeline.

## Components

### 1. Example Selector (`example-selector.ts`)
Implements two-phase selection to prioritize relevant examples:
- **Phase 1**: Direct correspondence with the specific recipient (up to 60%)
- **Phase 2**: Same relationship category emails to fill remaining slots

Configuration (via environment variables):
- `EXAMPLE_COUNT`: Total examples to select (default: 10)
- `DIRECT_EMAIL_MAX_PERCENTAGE`: Max percentage from direct emails (default: 0.4)

### 2. Email Ingestion Pipeline (`email-ingest-pipeline.ts`)
Processes historical emails and stores them in the vector database.

## Testing

### Template Tests
Run template manager unit tests (no external services required):

```bash
npm test -- server/src/lib/pipeline/__tests__/template-manager.test.ts
```

### Manual Testing

You can also test individual components:

```typescript
import { ExampleSelector } from './example-selector';
import { EmailIngestPipeline } from './email-ingest-pipeline';

// Create instances with your services
const selector = new ExampleSelector(
  vectorStore,
  embeddingService,
  relationshipService,
  relationshipDetector
);

// Select examples for a new email
const result = await selector.selectExamples({
  userId: 'test-user',
  incomingEmail: 'When will you be home?',
  recipientEmail: 'spouse@gmail.com'
});
```

## Troubleshooting

### TypeScript Errors
If you see import errors, run `npm run server:build` to check for compilation errors.