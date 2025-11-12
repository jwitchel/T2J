/**
 * Type definitions for vector storage and retrieval
 *
 * This file contains shared type definitions for the new vector search system
 * using PostgreSQL storage + Vectra in-memory search with dual embeddings (semantic + style).
 *
 * Following patterns from EmailMover and SpamDetector:
 * - Well-defined parameter and result types
 * - No anonymous return objects
 * - Custom error hierarchy
 * - Structured configuration types
 */

// ============================================================================
// Core Metadata Types
// ============================================================================

/**
 * Email metadata stored with vectors
 *
 * Purpose: Standard structure for email metadata across the system
 */
export interface EmailMetadata {
  userId: string;
  emailAccountId: string;
  recipientEmail?: string;
  relationship?: string;
  subject?: string;
  sentDate: Date;
  wordCount?: number;
  [key: string]: any;  // Allow additional metadata
}

// ============================================================================
// Search Parameter Types
// ============================================================================

/**
 * Filters for vector search
 *
 * Purpose: Narrow search scope using metadata filters before vector search
 */
export interface VectorSearchFilters {
  /** Relationship type filter (e.g., 'colleagues', 'friends', 'family') */
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
 * Parameters for basic vector search using text query
 *
 * Purpose: High-level search interface that generates vectors internally
 * Following pattern: Structured params with no optional complexity
 */
export interface VectorSearchParams {
  userId: string;
  queryText: string;
  filters?: VectorSearchFilters;
  limit?: number;
  scoreThreshold?: number;
}

/**
 * Parameters for dual vector search (semantic + style)
 *
 * Purpose: Low-level search interface with pre-computed vectors
 * Used internally by VectorSearchService
 */
export interface DualVectorSearchParams {
  userId: string;
  semanticVector: number[];
  styleVector: number[];
  filters?: VectorSearchFilters;
  limit?: number;
  scoreThreshold?: number;
  semanticWeight?: number;  // Default: 0.4
  styleWeight?: number;     // Default: 0.6
}

// ============================================================================
// Search Result Types
// ============================================================================

/**
 * Individual search match result
 *
 * Purpose: Standard structure for a single search result
 * Following pattern: Well-defined result object with all metadata
 */
export interface SearchMatch {
  id: string;
  emailId: string;
  text: string;
  metadata: EmailMetadata;
  scores: {
    semantic: number;     // Semantic similarity score (0-1)
    style: number;        // Style similarity score (0-1)
    combined: number;     // Weighted combination of semantic + style
    temporal: number;     // After temporal weighting applied
  };
}

/**
 * Complete vector search result
 *
 * Purpose: Comprehensive search result with documents and statistics
 * Following pattern: success/error structure with detailed stats
 */
export interface VectorSearchResult {
  success: boolean;
  documents: SearchMatch[];
  stats: {
    totalCandidates: number;
    filteredCount: number;
    avgSemanticScore: number;
    avgStyleScore: number;
    avgCombinedScore: number;
    searchTimeMs: number;
  };
  error?: string;
}

// ============================================================================
// Index/Storage Parameter Types
// ============================================================================

/**
 * Parameters for indexing a single document
 *
 * Purpose: Structure for adding/updating email vectors in PostgreSQL
 * Following pattern: Explicit params for each operation
 */
export interface IndexDocumentParams {
  userId: string;
  emailId: string;
  text: string;
  metadata: EmailMetadata;
  emailType: 'sent' | 'received';
}

/**
 * Result from indexing a single document
 *
 * Purpose: Confirmation of successful indexing with vector dimensions
 * Following pattern: success + metadata result structure
 */
export interface IndexDocumentResult {
  success: boolean;
  documentId: string;
  semanticVectorDim: number;
  styleVectorDim: number;
  error?: string;
}

/**
 * Parameters for batch indexing
 *
 * Purpose: Efficiently index multiple documents at once
 */
export interface BatchIndexParams {
  documents: IndexDocumentParams[];
  batchSize?: number;  // Default: 100
}

/**
 * Result from batch indexing operation
 *
 * Purpose: Summary of batch operation with error details
 * Following pattern: Success/failure counts with error list
 */
export interface BatchIndexResult {
  success: boolean;
  indexed: number;
  failed: number;
  errors: Array<{
    documentId: string;
    error: string;
  }>;
  totalTimeMs: number;
}

// ============================================================================
// Style Cluster Types
// ============================================================================

/**
 * Parameters for style clustering
 *
 * Purpose: Group emails by writing style for pattern analysis
 */
export interface StyleClusterParams {
  userId: string;
  relationship: string;
  emails: Array<{
    id: string;
    styleVector: number[];
    metadata: EmailMetadata;
  }>;
  clusterCount?: number;  // Default: 3 (formal, neutral, casual)
}

/**
 * Individual style cluster
 *
 * Purpose: Represents a group of emails with similar style
 */
export interface StyleCluster {
  id: string;
  name: string;              // e.g., 'formal', 'neutral', 'casual'
  centroid: number[];        // Style vector centroid for cluster
  emailIds: string[];        // Email IDs in this cluster
  avgScore: number;          // Average similarity to centroid
}

/**
 * Result from style clustering operation
 *
 * Purpose: Complete clustering result with all clusters
 * Following pattern: success/error with data
 */
export interface StyleClusterResult {
  success: boolean;
  clusters: StyleCluster[];
  error?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for vector search service
 *
 * Purpose: Centralized configuration with defaults from environment
 * Following pattern: Config object with sensible defaults
 */
export interface VectorSearchConfig {
  semanticDimension: number;        // Semantic embedding size (default: 384)
  styleDimension: number;           // Style embedding size (default: 768)
  defaultLimit: number;             // Default search limit (default: 50)
  scoreThreshold: number;           // Minimum similarity score (default: 0.5)
  semanticWeight: number;           // Weight for semantic score (default: 0.4)
  styleWeight: number;              // Weight for style score (default: 0.6)
  temporalWeights: TemporalWeightConfig;
}

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
// Embedding Service Types
// ============================================================================

/**
 * Result from semantic embedding generation
 *
 * Purpose: Standard structure for embedding service results
 */
export interface SemanticEmbeddingResult {
  vector: number[];
  dimension: number;
  processingTime: number;
}

/**
 * Result from style embedding generation
 *
 * Purpose: Standard structure for style embedding results
 */
export interface StyleEmbeddingResult {
  vector: number[];
  dimension: number;
  processingTime: number;
}

/**
 * Batch embedding result
 *
 * Purpose: Results from batch embedding operation
 */
export interface BatchEmbeddingResult {
  embeddings: SemanticEmbeddingResult[];
  errors: Array<{
    index: number;
    error: string;
  }>;
  totalTimeMs: number;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for vector search operations
 *
 * Purpose: Provides specific error codes for different failure scenarios
 * Following pattern: Custom error hierarchy from PersonService
 */
export class VectorSearchError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'VectorSearchError';
  }
}

/**
 * Error for invalid vector dimensions or format
 */
export class InvalidVectorError extends VectorSearchError {
  constructor(message: string = 'Invalid vector dimensions or format') {
    super(message, 'INVALID_VECTOR');
    this.name = 'InvalidVectorError';
  }
}

/**
 * Error for search query failures
 */
export class SearchQueryError extends VectorSearchError {
  constructor(message: string) {
    super(message, 'QUERY_ERROR');
    this.name = 'SearchQueryError';
  }
}

/**
 * Error for indexing failures
 */
export class IndexError extends VectorSearchError {
  constructor(message: string) {
    super(message, 'INDEX_ERROR');
    this.name = 'IndexError';
  }
}

/**
 * Error for embedding generation failures
 */
export class EmbeddingError extends VectorSearchError {
  constructor(message: string) {
    super(message, 'EMBEDDING_ERROR');
    this.name = 'EmbeddingError';
  }
}

/**
 * Error for style clustering failures
 */
export class ClusteringError extends VectorSearchError {
  constructor(message: string) {
    super(message, 'CLUSTERING_ERROR');
    this.name = 'ClusteringError';
  }
}

// ============================================================================
// Legacy Types (Deprecated - For Backwards Compatibility During Migration)
// ============================================================================

/**
 * @deprecated Use DualVectorSearchParams instead
 * Kept for backwards compatibility during migration
 */
export interface HybridSearchParams {
  userId: string;
  denseVector: number[];
  sparseVector: { indices: number[]; values: number[] };
  filters?: VectorSearchFilters;
  limit?: number;
  scoreThreshold?: number;
  collectionName?: string;
  denseWeight?: number;
  sparseWeight?: number;
}

/**
 * @deprecated No longer used with Vectra in-memory search
 * Kept for backwards compatibility during migration
 */
export interface SparseVector {
  indices: number[];
  values: number[];
}

/**
 * @deprecated Legacy EmailMetadata for Qdrant-based system
 * Use EmailMetadata for new code
 */
export interface LegacyEmailMetadata {
  emailId: string;
  userId: string;
  emailAccountId?: string;
  rawText?: string;
  userReply?: string;
  respondedTo?: string;
  redactedNames?: string[];
  redactedEmails?: string[];
  recipientEmail: string;
  subject: string;
  sentDate: string;
  features: any;
  relationship: {
    type: string;
    confidence: number;
    detectionMethod: string;
  };
  frequencyScore?: number;
  wordCount?: number;
  responseTimeMinutes?: number;
  eml_file?: string;
  emailType?: 'incoming' | 'sent';
  senderEmail?: string;
  senderName?: string;
  uid?: number;
  bodystructure?: any;
  flags?: string[];
  size?: number;
  folderName?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  llmResponse?: {
    meta: any;
    generatedAt: string;
    providerId: string;
    modelName: string;
    draftId: string;
    relationship: {
      type: string;
      confidence: number;
      detectionMethod: string;
    };
  };
}

/**
 * @deprecated Use VectorSearchResult instead
 * Kept for backwards compatibility during migration
 */
export interface LegacyVectorSearchResult {
  id: string;
  score: number;
  metadata: LegacyEmailMetadata;
  vector?: number[];
}
// ============================================================================
// Legacy Types for Qdrant Client (Deprecated)
// ============================================================================
// These types are kept for backward compatibility with qdrant-client.ts
// which is deprecated but still used by some services during migration

/**
 * @deprecated Legacy error type for VectorStore operations
 */
export class VectorStoreError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'VectorStoreError';
  }
}

/**
 * @deprecated RRF (Reciprocal Rank Fusion) configuration
 * Used by hybrid search in qdrant-client.ts
 */
export interface RRFConfig {
  k: number;  // Smoothing parameter (default: 60)
  denseWeight?: number;  // Weight for dense search
  sparseWeight?: number;  // Weight for sparse search
}

/**
 * @deprecated RRF scored result
 * Used by hybrid search result merging
 */
export interface RRFScoredResult {
  id: string;
  score: number;
  rrfScore?: number;  // Computed RRF score
  denseScore?: number;  // Original dense search score
  sparseScore?: number;  // Original sparse search score
  metadata: any;
}

/**
 * @deprecated Dense (semantic) search parameters for Qdrant
 */
export interface DenseSearchParams {
  userId: string;
  queryVector: number[];
  relationship?: string;
  filters?: any;  // Legacy filter format
  limit?: number;
  scoreThreshold?: number;
  collectionName?: string;
}

/**
 * @deprecated Sparse (BM25) search parameters for Qdrant
 */
export interface SparseSearchParams {
  userId: string;
  querySparseVector: { indices: number[]; values: number[] };
  sparseVector?: { indices: number[]; values: number[] };  // Legacy alias
  relationship?: string;
  filters?: any;  // Legacy filter format
  limit?: number;
  scoreThreshold?: number;
  collectionName?: string;
}
