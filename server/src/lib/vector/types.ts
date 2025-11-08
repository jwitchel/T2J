/**
 * Type definitions for vector storage and retrieval
 *
 * This file contains shared type definitions for the vector storage system,
 * including search parameters, results, and configuration types.
 */

import { EmailMetadata } from './qdrant-client';

// ============================================================================
// Search Parameter Types
// ============================================================================

/**
 * Filters for vector search
 *
 * Purpose: Narrow search scope using metadata filters before vector search
 */
export interface VectorSearchFilters {
  /** Relationship type filter (e.g., 'colleague', 'friend', 'spouse') */
  relationship?: string;

  /** Filter by specific recipient email for direct correspondence */
  recipientEmail?: string;

  /** Filter by date range */
  dateRange?: {
    start: Date;
    end: Date;
  };

  /** Exclude specific email IDs from results */
  excludeIds?: string[];
}

/**
 * Parameters for dense (semantic) vector search
 */
export interface DenseSearchParams {
  userId: string;
  queryVector: number[];
  filters?: VectorSearchFilters;
  limit?: number;
  scoreThreshold?: number;
  collectionName?: string;
}

/**
 * Parameters for sparse (keyword) vector search
 */
export interface SparseSearchParams {
  userId: string;
  sparseVector: SparseVector;
  filters?: VectorSearchFilters;
  limit?: number;
  scoreThreshold?: number;
  collectionName?: string;
}

/**
 * Parameters for hybrid search (dense + sparse)
 *
 * Purpose: Combine semantic similarity (dense) with keyword matching (sparse)
 * for improved relevance.
 */
export interface HybridSearchParams {
  userId: string;
  denseVector: number[];
  sparseVector: SparseVector;
  filters?: VectorSearchFilters;
  limit?: number;
  scoreThreshold?: number;
  collectionName?: string;
  denseWeight?: number;   // Weight for dense vector results (default: 0.7)
  sparseWeight?: number;  // Weight for sparse vector results (default: 0.3)
}

// ============================================================================
// Search Result Types
// ============================================================================

/**
 * Result from vector search
 *
 * Purpose: Standard structure for search results across all search methods
 */
export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: EmailMetadata;
  vector?: number[];  // Optional, usually omitted to save memory
}

// ============================================================================
// Sparse Vector Types
// ============================================================================

/**
 * Sparse vector representation for BM25 keyword matching
 *
 * Purpose: Efficient storage of keyword-based vectors where most values are zero.
 * Only non-zero indices and values are stored.
 *
 * Example:
 * Dense: [0, 0, 0.5, 0, 0, 2.3, 0, ...]
 * Sparse: { indices: [2, 5], values: [0.5, 2.3] }
 */
export interface SparseVector {
  /** Array of indices where values are non-zero */
  indices: number[];

  /** Array of non-zero values corresponding to indices */
  values: number[];
}

// ============================================================================
// Temporal Weighting Types
// ============================================================================

/**
 * Configuration for temporal decay weighting
 *
 * Purpose: Defines how email age affects search ranking.
 * More recent emails get higher weights to reflect current writing style.
 */
export interface TemporalWeightConfig {
  /** Weight for emails 0-3 months old (default: 1.0) */
  recent: number;

  /** Weight for emails 3-6 months old (default: 0.85) */
  medium: number;

  /** Weight for emails 6-12 months old (default: 0.7) */
  old: number;

  /** Weight for emails 12+ months old (default: 0.5) */
  veryOld: number;
}

// ============================================================================
// BM25 Encoder Types
// ============================================================================

/**
 * Configuration for BM25 algorithm
 *
 * Purpose: Controls BM25 term weighting behavior
 *
 * Fields:
 * - k1: Controls term frequency saturation (default: 1.5, range: 1.2-2.0)
 * - b: Controls document length normalization (default: 0.75, range: 0-1)
 * - avgDocLength: Average document length in corpus (calculated during fit)
 */
export interface BM25Config {
  k1?: number;
  b?: number;
  avgDocLength?: number;
}

/**
 * Internal state of BM25 encoder
 *
 * Purpose: Stores fitted BM25 model parameters
 * Used by: BM25Encoder for encoding text to sparse vectors
 */
export interface BM25EncoderState {
  /** Mapping of terms to vocabulary indices */
  vocabulary: Map<string, number>;

  /** Inverse document frequency for each term */
  idf: Map<string, number>;

  /** Total number of documents in corpus */
  docCount: number;

  /** Average document length across corpus */
  avgDocLength: number;
}

// ============================================================================
// RRF (Reciprocal Rank Fusion) Types
// ============================================================================

/**
 * Configuration for Reciprocal Rank Fusion
 *
 * Purpose: Controls how dense and sparse search results are merged
 *
 * RRF formula: score = sum(weight / (k + rank))
 * where rank is the result's position in the ranked list
 */
export interface RRFConfig {
  /** K parameter for rank smoothing (default: 60) */
  k?: number;

  /** Weight for dense vector results (default: 0.7) */
  denseWeight?: number;

  /** Weight for sparse vector results (default: 0.3) */
  sparseWeight?: number;
}

/**
 * Intermediate result with RRF scores
 *
 * Purpose: Tracks both dense and sparse scores during merge process
 */
export interface RRFScoredResult extends VectorSearchResult {
  denseScore?: number;
  sparseScore?: number;
  rrfScore: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Custom error class for vector store operations
 *
 * Purpose: Provides specific error codes for different failure scenarios
 * Follows pattern from LLMProviderError
 */
export class VectorStoreError extends Error {
  constructor(
    message: string,
    public code:
      | 'CONNECTION_FAILED'
      | 'COLLECTION_NOT_FOUND'
      | 'INVALID_VECTOR'
      | 'SEARCH_FAILED'
      | 'INITIALIZATION_FAILED'
      | 'UPSERT_FAILED'
      | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'VectorStoreError';
  }
}

/**
 * Custom error class for BM25 encoder operations
 */
export class BM25EncoderError extends Error {
  constructor(
    message: string,
    public code:
      | 'NOT_INITIALIZED'
      | 'INVALID_INPUT'
      | 'TOKENIZATION_FAILED'
      | 'ENCODING_FAILED'
      | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'BM25EncoderError';
  }
}

// ============================================================================
// Collection Configuration Types
// ============================================================================

/**
 * Configuration for Qdrant collection with sparse vector support
 */
export interface CollectionConfigWithSparse {
  vectors: {
    size: number;
    distance: 'Cosine' | 'Dot' | 'Euclid';
  };
  sparse_vectors?: {
    [key: string]: {
      // No size specified - inferred from data
    };
  };
  optimizers_config?: {
    indexing_threshold?: number;
  };
}

// ============================================================================
// Upsert Types
// ============================================================================

/**
 * Email data for upserting to vector store
 *
 * Purpose: Standard structure for adding emails to Qdrant
 */
export interface EmailUpsertData {
  id: string;
  userId: string;
  vector: number[];
  sparseVector?: SparseVector;
  metadata: EmailMetadata;
  collectionName?: string;
}

// ============================================================================
// Export Re-exports for Convenience
// ============================================================================

// Re-export EmailMetadata from qdrant-client for convenience
export type { EmailMetadata };
