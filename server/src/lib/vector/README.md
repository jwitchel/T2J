# Vector Services

This directory contains the vector storage and embedding services for the AI Email Assistant's tone learning system using **PostgreSQL storage + Vectra in-memory search** with **dual embeddings** (semantic + style).

## Architecture Overview

The vector system uses a hybrid approach:
- **Storage**: PostgreSQL tables (`sent_emails`, `received_emails`) with vector columns
- **Search**: Vectra in-memory index for fast cosine similarity search
- **Embeddings**: Dual vectors (semantic 384d + style 768d) for content and tone matching

This replaces the previous Qdrant-based system, providing:
- ✅ No external vector database required
- ✅ Simpler deployment and maintenance
- ✅ Better tone matching with style-specific embeddings
- ✅ Faster search performance (11-22ms avg)
- ✅ Integrated with existing PostgreSQL infrastructure

## Components

### 1. Embedding Service (`embedding-service.ts`)
- Uses `Xenova/all-MiniLM-L6-v2` model for **semantic embeddings** (384 dimensions)
- Captures content/topic similarity
- Supports single text and batch embedding generation
- Includes cosine similarity calculation
- Handles text truncation for model token limits

### 2. Style Embedding Service (`style-embedding-service.ts`)
- Uses `AnnaWegmann/Style-Embedding` model for **style embeddings** (768 dimensions)
- Captures writing tone, formality, and stylistic patterns
- Specialized for tone/style matching
- Normalized vectors for accurate similarity measurement
- Separate from semantic embeddings for better control

### 3. Vector Search Service (`vector-search-service.ts`)
**Core service replacing Qdrant** - PostgreSQL storage + Vectra in-memory search

**Features:**
- Two-phase search: PostgreSQL candidates + Vectra in-memory search
- Dual vector scoring (semantic + style) with configurable weights
- Temporal weighting (recent emails prioritized)
- Relationship-based filtering
- Date range filtering
- Exclude list support
- Detailed search statistics

**Search Flow:**
1. Fetch candidates from PostgreSQL (filtered by user, relationship, date)
2. Build in-memory Vectra index from candidates (~100-500 emails)
3. Search using combined semantic + style vectors
4. Calculate individual scores (semantic, style, combined)
5. Apply temporal weighting
6. Return top matches with detailed scores

**Performance:**
- PostgreSQL fetch: ~2-5ms (indexed queries)
- Vectra indexing: ~3-7ms (100-500 emails)
- Vector search: ~5-10ms
- Total: ~11-22ms average (faster than Qdrant!)

### 4. Style Clustering Service (`style-clustering-service.ts`)
**K-means clustering for writing style patterns**

- Groups emails by writing style (formal, neutral, casual)
- Uses K-means++ initialization for better convergence
- Stores cluster centroids in `style_clusters` table
- Maps emails to clusters via `email_style_mapping` table
- Supports filtering examples by style cluster

### 5. Type Definitions (`types.ts`)
**Comprehensive type system following EmailMover/SpamDetector patterns**

- No anonymous return types
- Well-defined interfaces for all operations
- Custom error hierarchy (VectorSearchError → specific errors)
- Search parameter types (VectorSearchParams, DualVectorSearchParams)
- Result types (VectorSearchResult, SearchMatch)
- Filter types (VectorSearchFilters)
- Configuration types (VectorSearchConfig, StyleClusterParams)

### 6. Legacy Services (Deprecated)

**Note**: The following services are kept for backward compatibility but should not be used in new code:

- `qdrant-client.ts` - Legacy Qdrant storage (replaced by VectorSearchService)
- `usage-tracker.ts` - Example usage tracking (to be refactored)

## Database Schema

### Vector Storage Tables

```sql
-- Sent emails with dual vectors
ALTER TABLE sent_emails
ADD COLUMN semantic_vector real[],      -- 384d semantic embedding
ADD COLUMN style_vector real[],          -- 768d style embedding
ADD COLUMN vector_generated_at timestamp;

-- Received emails with dual vectors
ALTER TABLE received_emails
ADD COLUMN semantic_vector real[],
ADD COLUMN style_vector real[],
ADD COLUMN vector_generated_at timestamp;

-- Style clusters for pattern grouping
CREATE TABLE style_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  cluster_name text NOT NULL,              -- 'formal', 'neutral', 'casual'
  centroid_vector real[],                  -- 768d cluster centroid
  email_count integer DEFAULT 0,
  UNIQUE(user_id, relationship_type, cluster_name)
);

-- Email to cluster mapping
CREATE TABLE email_style_mapping (
  email_id uuid NOT NULL,
  email_type text NOT NULL,                -- 'sent' or 'received'
  style_cluster_id uuid NOT NULL REFERENCES style_clusters(id),
  style_score real,                        -- Similarity to cluster centroid
  PRIMARY KEY (email_id, email_type)
);
```

## Key Features

### Dual Embeddings (Semantic + Style)
**Two specialized vectors for better tone matching:**

- **Semantic Vector (384d)**: Topic/content similarity
  - Model: `Xenova/all-MiniLM-L6-v2`
  - Use: Find emails about similar topics
  - Weight: 40% (configurable via `SEMANTIC_WEIGHT`)

- **Style Vector (768d)**: Tone/formality similarity
  - Model: `AnnaWegmann/Style-Embedding`
  - Use: Find emails with similar writing style
  - Weight: 60% (configurable via `STYLE_WEIGHT`)

**Combined Score:**
```typescript
combinedScore = (semanticScore * 0.4) + (styleScore * 0.6)
```

This ensures drafts match both the topic AND the writing tone of past emails.

### Temporal Weighting
Prioritizes recent emails to reflect evolving writing style:
- 0-3 months: 1.0x weight (full priority)
- 3-6 months: 0.85x weight
- 6-12 months: 0.7x weight
- 12+ months: 0.5x weight
- Applied after search, before final selection

### Quality Filtering
Ensures only relevant examples are used:
- Configurable similarity threshold (default: 0.5)
- Rejects low-quality matches below threshold
- Prevents irrelevant emails from polluting prompts

### Relationship-Based Search
The system prioritizes relationship context when searching for similar emails:
- Searches first within the same relationship type
- Two-phase selection: direct correspondence + relationship category
- Falls back to adjacent relationships if needed
- Maintains relationship-specific tone profiles

### Optimized Example Count
Research-backed few-shot learning approach:
- Reduced from 25 to 5 examples (3-5 is optimal for LLMs)
- Higher quality signal with less noise
- Faster draft generation
- Better tone matching

### Style Clustering
Groups emails by writing style for pattern analysis:
- K-means clustering on style vectors
- Default 3 clusters: formal, neutral, casual
- Supports filtering examples by style
- Used by WritingPatternAnalyzer for style-specific patterns

## Environment Variables

See `.env.example` for all vector-related configuration options:

### Core Configuration
```bash
# Vector Search Settings
VECTOR_SCORE_THRESHOLD=0.5              # Minimum similarity score
EXAMPLE_COUNT=5                          # Number of examples to use
DIRECT_EMAIL_MAX_PERCENTAGE=0.4         # Max 40% from direct emails

# Vector Performance Settings
EMBEDDING_BATCH_SIZE=32                  # Batch size for embeddings
```

### Dual Embedding Configuration
```bash
# Weight for semantic (topic) similarity (0-1, default: 0.4 = 40%)
SEMANTIC_WEIGHT=0.4

# Weight for style (tone) similarity (0-1, default: 0.6 = 60%)
STYLE_WEIGHT=0.6
```

### Temporal Weighting
```bash
TEMPORAL_WEIGHT_0_3M=1.0                # 0-3 months old
TEMPORAL_WEIGHT_3_6M=0.85               # 3-6 months old
TEMPORAL_WEIGHT_6_12M=0.7               # 6-12 months old
TEMPORAL_WEIGHT_12M_PLUS=0.5            # 12+ months old
```

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
  FROM sent_emails
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

## Migration from Qdrant

To migrate existing data from Qdrant to PostgreSQL:

```bash
# Run migration script
cd server && npx tsx src/scripts/migrate-remove-qdrant.ts
```

This will:
1. Add vector columns to `sent_emails` and `received_emails` tables
2. Create `style_clusters` and `email_style_mapping` tables
3. Fetch all emails from Qdrant
4. Generate semantic + style vectors for each email
5. Update PostgreSQL with both vectors
6. Create initial style clusters for each relationship
7. Verify data integrity

**Note**: After successful migration, Qdrant can be stopped and removed:
```bash
docker compose down qdrant
rm -rf qdrant_storage
```

## Performance Optimization

### Query Performance
- **PostgreSQL**: Indexed queries on `user_id`, `relationship_type`, `sent_date`
- **Vectra**: In-memory index rebuilt per query (~3-7ms for 500 emails)
- **Total latency**: 11-22ms average (vs 30-50ms with Qdrant)

### Memory Usage
- Vectra index: ~5-10MB per 500 emails (rebuilds per query, no persistent memory)
- Style vectors: ~3KB per email (768 floats × 4 bytes)
- Semantic vectors: ~1.5KB per email (384 floats × 4 bytes)

### Scaling Considerations
- In-memory indexing works well up to ~1000 emails per query
- For larger datasets, consider:
  - Stricter PostgreSQL filtering (date ranges, relationships)
  - Lower `limit` parameter to reduce candidates
  - Persistent Vectra index (trade memory for speed)

## Testing

```bash
# Test vector services
npm run vector:test

# Test migration script (dry run)
cd server && npx tsx src/scripts/migrate-remove-qdrant.ts --dry-run
```

## Migration Status

- ✅ PostgreSQL storage with vector columns
- ✅ Dual embeddings (semantic + style)
- ✅ VectorSearchService (PostgreSQL + Vectra)
- ✅ Style clustering
- ✅ Temporal weighting
- ✅ Quality filtering
- ✅ Relationship-based filtering
- ✅ Migration script from Qdrant
- ⏳ Refactor EmailStorageService to use PostgreSQL (pending)
- ⏳ Refactor InboxProcessor to save vectors directly (pending)
