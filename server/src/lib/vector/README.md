# Vector Services

This directory contains the vector storage and embedding services for the AI Email Assistant's tone learning system.

## Components

### 1. Embedding Service (`embedding-service.ts`)
- Uses Xenova/all-MiniLM-L6-v2 model for 384-dimensional embeddings
- Supports single text and batch embedding generation
- Includes text similarity comparison using cosine similarity
- Handles text truncation for model token limits

### 2. Qdrant Client (`qdrant-client.ts`)
- Manages vector storage in Qdrant database
- **Hybrid search**: Combines semantic (dense) and keyword (sparse) matching
- **Temporal weighting**: Prioritizes recent emails to reflect current writing style
- **Quality filtering**: Rejects low-similarity results below configured threshold
- **Relationship-aware search**: Primary filtering by relationship type
- Supports near-duplicate detection
- Tracks usage statistics and effectiveness scores
- Handles numeric ID conversion for Qdrant compatibility

### 3. BM25 Encoder (`bm25-encoder.ts`)
- Implements BM25 algorithm for sparse vector generation
- Converts text to keyword-based sparse vectors
- Fitted on user's email corpus for personalized vocabulary
- Used for keyword matching in hybrid search
- Configurable k1 (term frequency saturation) and b (length normalization) parameters

### 4. Usage Tracker (`usage-tracker.ts`)
- Tracks which examples were used in draft generation
- Processes user feedback (edits, acceptance, ratings)
- Calculates effectiveness scores based on user behavior
- Supports pruning ineffective examples

### 5. Type Definitions (`types.ts`)
- Shared type definitions for vector operations
- Search parameter interfaces (Dense, Sparse, Hybrid)
- Result types (VectorSearchResult, RRFScoredResult)
- Configuration types (TemporalWeightConfig, BM25Config, RRFConfig)
- Custom error classes (VectorStoreError, BM25EncoderError)

## Setup

1. Ensure Qdrant is running:
   ```bash
   npm run qdrant:up
   ```

2. Test the services:
   ```bash
   npm run test:vector
   ```

## Key Features

### Hybrid Search (Semantic + Keyword)
Combines two complementary search approaches:
- **Dense vectors** (384-dim): Semantic understanding via neural embeddings
- **Sparse vectors** (BM25): Keyword matching for exact terms and names
- **Reciprocal Rank Fusion**: Intelligently merges results from both methods
- Configurable weights (default: 70% semantic, 30% keyword)

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

### Continuous Learning
- Tracks example usage in draft generation
- Updates effectiveness scores based on user edits
- Improves selection algorithm over time

### Performance Optimizations
- Batch processing for embeddings
- Configurable search limits and thresholds
- Automatic indexing in Qdrant
- Parallel dense + sparse search execution

## Environment Variables

See `.env.example` for all vector-related configuration options:

### Core Configuration
- `QDRANT_URL`: Qdrant server URL (default: http://localhost:6333)
- `EXAMPLE_COUNT`: Number of examples to use (default: 5)
- `DIRECT_EMAIL_MAX_PERCENTAGE`: Max % from direct emails (default: 0.4 = 40%)

### Search Configuration
- `VECTOR_SEARCH_LIMIT`: Maximum search results (default: 50)
- `VECTOR_SCORE_THRESHOLD`: Minimum similarity score (default: 0.5)
- `NEAR_DUPLICATE_THRESHOLD`: Threshold for duplicate detection (default: 0.98)
- `EMBEDDING_BATCH_SIZE`: Batch size for embedding generation (default: 32)

### Temporal Weighting
- `TEMPORAL_WEIGHT_0_3M`: Weight for 0-3 month old emails (default: 1.0)
- `TEMPORAL_WEIGHT_3_6M`: Weight for 3-6 month old emails (default: 0.85)
- `TEMPORAL_WEIGHT_6_12M`: Weight for 6-12 month old emails (default: 0.7)
- `TEMPORAL_WEIGHT_12M_PLUS`: Weight for 12+ month old emails (default: 0.5)

### Hybrid Search
- `HYBRID_DENSE_WEIGHT`: Weight for semantic search (default: 0.7)
- `HYBRID_SPARSE_WEIGHT`: Weight for keyword search (default: 0.3)
- `RRF_K`: Reciprocal rank fusion smoothing parameter (default: 60)

### BM25 Configuration
- `BM25_K1`: Term frequency saturation (default: 1.5, range: 1.2-2.0)
- `BM25_B`: Document length normalization (default: 0.75, range: 0-1)

## Usage Example

```typescript
import { embeddingService, vectorStore } from './vector';
import { BM25Encoder } from './bm25-encoder';

// Generate dense embedding
const result = await embeddingService.embedText('Hello world');

// Generate sparse vector (BM25)
const bm25Encoder = new BM25Encoder();
await bm25Encoder.initialize(userSentEmails); // Fit on user's corpus
const sparseVector = bm25Encoder.encode('Hello world');

// Store in Qdrant with both dense and sparse vectors
await vectorStore.upsertEmail({
  id: 'email-123',
  userId: 'user-456',
  vector: result.vector,
  sparseVector: sparseVector,  // Optional: for hybrid search
  metadata: {
    // ... email metadata including relationship info
  }
});

// Hybrid search (semantic + keyword)
const similar = await vectorStore.hybridSearch({
  userId: 'user-456',
  denseVector: queryEmbedding,
  sparseVector: querySparseVector,
  filters: {
    relationship: 'colleagues'
  },
  limit: 5,
  scoreThreshold: 0.5
});

// Or use traditional semantic-only search
const semanticOnly = await vectorStore.searchSimilar({
  userId: 'user-456',
  queryVector: queryEmbedding,
  relationship: 'colleagues',
  limit: 5
});
```

## Migrating to Sparse Vectors

To enable hybrid search, run the migration script to add sparse vectors to existing emails:

```bash
# Run migration (adds sparse vectors to all existing emails)
npm run vector:migrate-sparse
```

This will:
1. Fit BM25 encoder on each user's email corpus
2. Generate sparse vectors for all existing emails
3. Update Qdrant with sparse vector data

**Note**: Hybrid search will fall back to dense-only search if sparse vectors are not available.

## Migration Status

- ✅ Dense vectors (semantic): Fully implemented
- ✅ Temporal weighting: Fully implemented
- ✅ Quality filtering: Fully implemented
- ⏳ Sparse vectors (keyword): Implementation complete, requires migration
- ⏳ Hybrid search: Implementation complete, active after migration