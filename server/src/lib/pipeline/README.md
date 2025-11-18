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

### Quick Test (No Dependencies)
Run the mock test to verify basic functionality:

```bash
npm run test:pipeline:mock
```

This test uses mock implementations and doesn't require any services to be running.

### Template Tests
To run only the template manager unit tests:

```bash
npm test -- server/src/lib/pipeline/__tests__/template-manager.test.ts
```

These tests don't require any external services.

### Full Integration Test
To test with real services:

1. Start PostgreSQL:
   ```bash
   docker compose up -d postgres
   ```

2. Run the integration test:
   ```bash
   npm run test:pipeline
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

## Expected Output

When running `npm run test:pipeline:mock`, you should see:

- ✅ Mock services initialized
- ✅ Individual email processing with relationship detection
- ✅ Batch processing with relationship distribution
- ✅ Example selection with diversity scoring

## Troubleshooting

### TypeScript Errors
If you see import errors, make sure:
1. The stub implementations exist in `/relationships` and `/pipeline/types.ts`
2. Run `npm run server:build` to check for compilation errors

### Missing Dependencies
The pipeline depends on:
- Task 3.2: NLP Feature Extraction (currently using stub)
- Task 3.3: Relationship Detection (currently using stub)
- Task 3.4: Vector Storage (implemented)

## Next Steps

After the dependent tasks are implemented:
1. Remove stub implementations
2. Update imports to use real modules
3. Run full integration tests with `npm run test:pipeline`