# Highland.js Pipeline

Used in sent-email-pipeline.ts for batch processing historical sent emails.

Inbox processing uses async/await (see inbox-processor.ts).

## Overview

Highland.js provides:
- Stream-based processing with backpressure handling
- Configurable concurrency (single-stream by default)
- Batch processing for efficiency
- Error resilience with graceful recovery

## Configuration

### Environment Variables

- `EMAIL_PIPELINE_CONCURRENCY`: Number of emails to process in parallel (default: 1)
  - Set to 1 for easier debugging (single-stream)
  - Increase for better throughput in production

## Usage

### Basic Pipeline Creation

```typescript
import { SentEmailPipeline } from './sent-email-pipeline';
import { ParsedMail } from 'mailparser';
import _ from 'highland';

const pipeline = new SentEmailPipeline({
  userId: 'user-123',
  emailAccountId: 'account-456',
  batchSize: 10,
  onBatchComplete: (batch) => {
    console.log(`Processed ${batch.length} emails`);
  }
});

// Create stream from emails
const emailStream = _(emails);
const processedStream = pipeline.createPipeline(emailStream);

// Process results
processedStream
  .collect()
  .toCallback((err) => {
    if (err) console.error('Pipeline error:', err);
    const metrics = pipeline.complete();
    console.log('Pipeline metrics:', metrics);
  });
```

### Batch Processing Helper

```typescript
import { processEmailBatch } from './sent-email-pipeline';

const { results, metrics } = await processEmailBatch(emails, {
  userId: 'user-123',
  emailAccountId: 'account-456',
  batchSize: 20
});

console.log(`Processed ${results.length} emails`);
console.log(`Success rate: ${(results.length / emails.length * 100).toFixed(2)}%`);
```

## Features

### 1. Stream Processing
- Lazy evaluation - processes emails as they arrive
- Memory efficient - doesn't load all emails at once
- Backpressure handling - prevents overwhelming the system

### 2. Error Handling
- Errors are logged but don't stop the pipeline
- Failed emails are skipped gracefully
- Error count tracked in metrics

### 3. Batch Processing
- Groups results into configurable batch sizes
- Calls `onBatchComplete` callback for each batch
- Useful for database operations or progress updates

### 4. Rate Limiting
- Built-in rate limiting (1 batch per 100ms)
- Prevents system overload
- Ensures smooth processing

### 5. Real-time Logging
- Integrates with WebSocket logging system
- Logs pipeline events:
  - PIPELINE_START
  - PIPELINE_EMAIL_IN
  - PIPELINE_ERROR
  - PIPELINE_BATCH_COMPLETE
  - PIPELINE_COMPLETE

## Metrics

The pipeline tracks and reports:
- `processedCount`: Total emails successfully processed
- `errorCount`: Total emails that failed processing
- `startTime`: When pipeline started
- `endTime`: When pipeline completed
- `memoryUsage`: Memory usage at completion

## Demo

Run the Highland.js pipeline demo:

```bash
npm run demo:pipeline

# With increased concurrency:
EMAIL_PIPELINE_CONCURRENCY=5 npm run demo:pipeline
```

## Performance Considerations

1. **Concurrency**: Start with 1 for debugging, increase for production
2. **Batch Size**: Larger batches are more efficient but use more memory
3. **Rate Limiting**: Adjust the rate limit based on system capacity
4. **Memory**: Monitor memory usage for large email volumes

## Error Scenarios

The pipeline handles:
- Malformed emails (missing text/html)
- Processing failures
- Memory constraints
- Network issues (for future IMAP integration)

## Future Enhancements

1. Dynamic concurrency adjustment based on system load
2. Persistent checkpointing for resume capability
3. Priority queue for important emails
4. Metrics export to monitoring systems