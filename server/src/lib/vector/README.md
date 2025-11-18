# Vector Services

This directory contains the vector storage and embedding services for the AI Email Assistant's tone learning system using **PostgreSQL storage + Vectra in-memory search** with **dual embeddings** (semantic + style).

## Architecture Overview

The vector system uses:
- **Storage**: PostgreSQL tables (`email_sent`, `email_received`) with vector columns
- **Search**: Vectra in-memory index for fast cosine similarity search
- **Embeddings**: Dual vectors (semantic 384d + style 768d) for content and tone matching

## Components

See the following files for implementation details:

- **EmbeddingService** (`embedding-service.ts`) - Semantic embeddings (384d) using Xenova/all-MiniLM-L6-v2
- **StyleEmbeddingService** (`style-embedding-service.ts`) - Style embeddings (768d) using AnnaWegmann/Style-Embedding
- **VectorSearchService** (`vector-search-service.ts`) - PostgreSQL + Vectra dual vector search
- **StyleClusteringService** (`style-clustering-service.ts`) - K-means clustering for style patterns
- **Type Definitions** (`types.ts`) - All vector-related types and interfaces

## Database Schema

See `../../../migrations/*.sql` for vector-related table definitions (email_sent, email_received, style_clusters, email_style_mapping).

## Key Features

### Dual Embeddings (Semantic + Style)

See `embedding-service.ts` and `style-embedding-service.ts` for model implementations and vector generation logic.

### Temporal Weighting

See `vector-search-service.ts` for temporal weighting implementation. Configurable via `TEMPORAL_WEIGHT_*` environment variables.

### Quality Filtering

See `vector-search-service.ts` for threshold filtering. Configurable via `VECTOR_SCORE_THRESHOLD` environment variable.

### Relationship-Based Search

See `../pipeline/example-selector.ts` for two-phase relationship-based example selection logic.

### Style Clustering

See `style-clustering-service.ts` for K-means clustering implementation.

## Configuration

See `.env.example` for all vector-related environment variables.

## Usage Examples

### Basic Vector Search

```typescript
import { vectorSearchService } from './vector';

// Search using query text (generates both embeddings automatically)
const result = await vectorSearchService.search({
  userId: 'user-456',
  queryText: 'Let me know if you need anything',
  filters: {
    relationship: 'colleague',
    recipientEmail: 'john@example.com'  // Optional: direct correspondence
  },
  limit: 5,
  scoreThreshold: 0.5
});

// Result includes dual scores
for (const match of result.documents) {
  console.log({
    emailId: match.emailId,
    semanticScore: match.scores.semantic,    // Topic similarity
    styleScore: match.scores.style,          // Tone similarity
    combinedScore: match.scores.combined,    // Weighted combination
    temporalScore: match.scores.temporal     // After temporal weighting
  });
}

// Statistics
console.log({
  totalCandidates: result.stats.totalCandidates,
  avgSemanticScore: result.stats.avgSemanticScore,
  avgStyleScore: result.stats.avgStyleScore,
  avgCombinedScore: result.stats.avgCombinedScore,
  searchTimeMs: result.stats.searchTimeMs
});
```

### Advanced Search with Pre-computed Vectors

```typescript
import {
  embeddingService,
  styleEmbeddingService,
  vectorSearchService
} from './vector';

// Generate embeddings separately
const semanticResult = await embeddingService.embedText(queryText);
const styleResult = await styleEmbeddingService.embedText(queryText);

// Search with pre-computed vectors
const result = await vectorSearchService.dualVectorSearch({
  userId: 'user-456',
  semanticVector: semanticResult.vector,
  styleVector: styleResult.vector,
  filters: {
    relationship: 'friend',
    dateRange: {
      start: new Date('2024-01-01'),
      end: new Date('2024-12-31')
    },
    excludeIds: ['email-123', 'email-456']
  },
  semanticWeight: 0.3,  // Custom weights
  styleWeight: 0.7,
  limit: 10,
  scoreThreshold: 0.6
});
```

### Style Clustering

```typescript
import { styleClusteringService } from './vector';

// Fetch emails from PostgreSQL
const emails = await pool.query(`
  SELECT id, style_vector, sent_date, subject
  FROM email_sent
  WHERE user_id = $1 AND relationship_type = $2
    AND style_vector IS NOT NULL
  ORDER BY sent_date DESC
  LIMIT 500
`, [userId, 'colleague']);

// Cluster by writing style
const clusterResult = await styleClusteringService.clusterEmails({
  userId,
  relationship: 'colleague',
  emails: emails.rows.map(row => ({
    id: row.id,
    styleVector: row.style_vector,
    metadata: {
      sentDate: row.sent_date,
      subject: row.subject
    }
  })),
  clusterCount: 3  // formal, neutral, casual
});

// Use clusters in pattern analysis
for (const cluster of clusterResult.clusters) {
  console.log({
    name: cluster.name,              // 'formal', 'neutral', 'casual'
    emailCount: cluster.emailIds.length,
    avgScore: cluster.avgScore       // Cohesion score
  });
}
```

## Performance

See `vector-search-service.ts` for query optimization and PostgreSQL index usage. Vectra index rebuilds per query for freshness.

## Testing

```bash
# Test vector services
npm run vector:test
```
