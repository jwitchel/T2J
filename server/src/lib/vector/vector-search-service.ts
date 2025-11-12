/**
 * Vector Search Service
 *
 * Purpose: PostgreSQL + in-memory vector search with dual embeddings (semantic + style)
 * Optimized for small-to-medium scale (500-2000 emails)
 *
 * Architecture:
 * - Storage: PostgreSQL (semantic_vector, style_vector columns)
 * - Search: Vectra in-memory index built from PostgreSQL query results
 * - Embeddings: Dual vectors (semantic 384d + style 768d = 1152d total)
 *
 * Following patterns from EmailMover and SpamDetector:
 * - Two-phase initialization
 * - Private helper methods with underscore prefix
 * - Well-defined parameter/result types
 * - Custom error hierarchy
 * - Singleton export
 */

import { Pool } from 'pg';
import { LocalIndex } from 'vectra';
import { embeddingService } from './embedding-service';
import { styleEmbeddingService } from './style-embedding-service';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  VectorSearchParams,
  DualVectorSearchParams,
  VectorSearchResult,
  IndexDocumentParams,
  IndexDocumentResult,
  BatchIndexParams,
  BatchIndexResult,
  SearchMatch,
  VectorSearchConfig,
  // VectorSearchError, // Unused
  InvalidVectorError,
  SearchQueryError,
  IndexError
  // EmailMetadata // Unused
} from './types';

interface CachedIndex {
  index: LocalIndex;
  expiresAt: number;
  candidateIds: string;
}

export class VectorSearchService {
  private initialized = false;
  private config: VectorSearchConfig;
  private indexCache: Map<string, CachedIndex> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private pool: Pool,
    config?: Partial<VectorSearchConfig>
  ) {
    this.config = {
      semanticDimension: config?.semanticDimension || 384,
      styleDimension: config?.styleDimension || 768,
      defaultLimit: config?.defaultLimit || 50,
      scoreThreshold: config?.scoreThreshold || parseFloat(process.env.VECTOR_SCORE_THRESHOLD || '0.5'),
      semanticWeight: config?.semanticWeight || parseFloat(process.env.SEMANTIC_WEIGHT || '0.4'),
      styleWeight: config?.styleWeight || parseFloat(process.env.STYLE_WEIGHT || '0.6'),
      temporalWeights: config?.temporalWeights || {
        recent: parseFloat(process.env.TEMPORAL_WEIGHT_0_3M || '1.0'),
        medium: parseFloat(process.env.TEMPORAL_WEIGHT_3_6M || '0.85'),
        old: parseFloat(process.env.TEMPORAL_WEIGHT_6_12M || '0.7'),
        veryOld: parseFloat(process.env.TEMPORAL_WEIGHT_12M_PLUS || '0.5')
      }
    };
  }

  // ============================================================================
  // Public API Methods
  // ============================================================================

  /**
   * Initialize the vector search service
   *
   * Purpose: Lazy initialization of embedding services
   * Following pattern: Two-phase init from EmailMover/SpamDetector
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await embeddingService.initialize();

    // Try to initialize style embedding (optional - may fail if model unavailable)
    try {
      await styleEmbeddingService.initialize();
    } catch (error: unknown) {
      console.warn('[VectorSearch] Style embedding unavailable (will use semantic only):',
        error instanceof Error ? error.message : 'Unknown error');
    }

    this.initialized = true;

    console.log('[VectorSearch] Service initialized');
  }

  /**
   * Search for similar emails using text query
   *
   * Purpose: High-level search API that generates vectors internally
   * Following pattern: Params/Result structure from PersonService
   *
   * @param params Search parameters
   * @returns Search result with matches and statistics
   */
  async search(params: VectorSearchParams): Promise<VectorSearchResult> {
    await this.initialize();

    try {
      const startTime = Date.now();

      // Generate query vectors
      const semanticResult = await embeddingService.embedText(params.queryText);

      // Try to get style vector (fallback to zeros if unavailable)
      let styleVector: number[];
      try {
        const styleResult = await styleEmbeddingService.embedText(params.queryText);
        styleVector = styleResult.vector;
      } catch (error: unknown) {
        // Style embedding unavailable - use zero vector (semantic-only search)
        styleVector = new Array(this.config.styleDimension).fill(0);
      }

      // Fetch candidate emails from PostgreSQL
      const candidates = await this._fetchCandidates(params);

      if (candidates.length === 0) {
        return {
          success: true,
          documents: [],
          stats: {
            totalCandidates: 0,
            filteredCount: 0,
            avgSemanticScore: 0,
            avgStyleScore: 0,
            avgCombinedScore: 0,
            searchTimeMs: Date.now() - startTime
          }
        };
      }

      // Try to get cached index or build new one
      const cacheKey = this._getCacheKey(params.userId, params.filters);
      const candidateIds = candidates.map(c => String(c.id)).sort().join(',');
      const index = await this._getOrBuildIndex(cacheKey, candidateIds, candidates);

      // Perform dual vector search
      const matches = await this._dualVectorSearch(
        {
          userId: params.userId,
          semanticVector: semanticResult.vector,
          styleVector: styleVector,
          filters: params.filters,
          limit: params.limit,
          scoreThreshold: params.scoreThreshold
        },
        index,
        candidates
      );

      // Apply temporal weighting
      const weightedMatches = this._applyTemporalWeighting(matches);

      // Calculate stats
      const stats = this._calculateStats(weightedMatches, Date.now() - startTime);

      return {
        success: true,
        documents: weightedMatches,
        stats
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new SearchQueryError(`Search failed: ${errorMessage}`);
    }
  }

  /**
   * Index a single email document
   *
   * Purpose: Generate and store dual vectors in PostgreSQL
   * Following pattern: Params/Result structure
   *
   * @param params Document indexing parameters
   * @returns Index result with confirmation
   */
  async indexDocument(params: IndexDocumentParams): Promise<IndexDocumentResult> {
    await this.initialize();

    try {
      // Generate semantic vector
      const semanticResult = await embeddingService.embedText(params.text);

      // Try to generate style vector (fallback to zeros if unavailable)
      let styleVector: number[];
      let styleDimension: number;
      try {
        const styleResult = await styleEmbeddingService.embedText(params.text);
        styleVector = styleResult.vector;
        styleDimension = styleResult.dimension;
      } catch (error: unknown) {
        // Style embedding unavailable - use zero vector
        styleVector = new Array(this.config.styleDimension).fill(0);
        styleDimension = this.config.styleDimension;
      }

      // Validate dimensions
      this._validateVector(semanticResult.vector, this.config.semanticDimension, 'semantic');
      this._validateVector(styleVector, this.config.styleDimension, 'style');

      // Store in PostgreSQL
      const tableName = params.emailType === 'sent' ? 'email_sent' : 'email_received';

      await this.pool.query(`
        UPDATE ${tableName}
        SET
          semantic_vector = $1,
          style_vector = $2,
          vector_generated_at = NOW()
        WHERE id = $3
      `, [semanticResult.vector, styleVector, params.emailId]);

      return {
        success: true,
        documentId: params.emailId,
        semanticVectorDim: semanticResult.dimensions,
        styleVectorDim: styleDimension
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new IndexError(`Failed to index document: ${errorMessage}`);
    }
  }

  /**
   * Index multiple documents in batch
   *
   * Purpose: Efficiently index many documents with progress tracking
   * Following pattern: Batch processing from EmbeddingService
   *
   * @param params Batch indexing parameters
   * @returns Batch result with success/failure counts
   */
  async batchIndex(params: BatchIndexParams): Promise<BatchIndexResult> {
    const startTime = Date.now();
    const batchSize = params.batchSize || 100;
    let indexed = 0;
    let failed = 0;
    const errors: Array<{ documentId: string; error: string }> = [];

    for (let i = 0; i < params.documents.length; i += batchSize) {
      const batch = params.documents.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(doc => this.indexDocument(doc))
      );

      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          indexed++;
        } else {
          failed++;
          errors.push({
            documentId: batch[idx].emailId,
            error: result.reason.message
          });
        }
      });

      // Log progress
      if ((i + batchSize) % 500 === 0 || i + batchSize >= params.documents.length) {
        console.log(`[VectorSearch] Indexed ${indexed}/${params.documents.length} documents`);
      }
    }

    return {
      success: failed === 0,
      indexed,
      failed,
      errors,
      totalTimeMs: Date.now() - startTime
    };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Fetch candidate emails from PostgreSQL
   *
   * Purpose: Query database with filters before vector search
   * @private
   */
  private async _fetchCandidates(params: VectorSearchParams): Promise<any[]> {
    const limit = params.limit || this.config.defaultLimit;

    // Use env variable for fetch limit
    const VECTOR_FETCH_LIMIT = parseInt(process.env.VECTOR_FETCH_LIMIT || '');
    if (!VECTOR_FETCH_LIMIT) {
      throw new Error('VECTOR_FETCH_LIMIT environment variable is required');
    }
    const fetchLimit = Math.max(VECTOR_FETCH_LIMIT, limit * 3);

    let whereClause = 'WHERE user_id = $1';
    const queryParams: any[] = [params.userId];
    let paramCount = 1;

    if (params.filters?.relationship) {
      paramCount++;
      whereClause += ` AND relationship_type = $${paramCount}`;
      queryParams.push(params.filters.relationship);
    }

    if (params.filters?.recipientEmail) {
      paramCount++;
      whereClause += ` AND recipient_email = $${paramCount}`;
      queryParams.push(params.filters.recipientEmail);
    }

    if (params.filters?.dateRange) {
      paramCount++;
      whereClause += ` AND sent_date >= $${paramCount}`;
      queryParams.push(params.filters.dateRange.start);

      paramCount++;
      whereClause += ` AND sent_date <= $${paramCount}`;
      queryParams.push(params.filters.dateRange.end);
    }

    if (params.filters?.excludeIds && params.filters.excludeIds.length > 0) {
      paramCount++;
      whereClause += ` AND id != ALL($${paramCount})`;
      queryParams.push(params.filters.excludeIds);
    }

    // Only require semantic vector (style vector is optional for semantic-only search)
    whereClause += ' AND semantic_vector IS NOT NULL';

    const query = `
      SELECT
        id, email_id, user_reply as text, semantic_vector, style_vector,
        user_id, email_account_id, recipient_email, relationship_type,
        subject, sent_date, word_count
      FROM email_sent
      ${whereClause}
      ORDER BY sent_date DESC
      LIMIT $${paramCount + 1}
    `;

    queryParams.push(fetchLimit);

    const result = await this.pool.query(query, queryParams);
    return result.rows;
  }

  /**
   * Build in-memory Vectra index from candidates
   *
   * Purpose: Create temporary vector index for fast similarity search
   * @private
   */
  private async _buildInMemoryIndex(candidates: any[]): Promise<LocalIndex> {
    // Create temporary path for in-memory index
    const tempPath = join(tmpdir(), `vectra-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    const index = new LocalIndex(tempPath);

    // Initialize the index (dimensions inferred from first item)
    await index.createIndex({ version: 1, deleteIfExists: true });

    for (const candidate of candidates) {
      // Combine semantic and style vectors (handle NULL style vectors)
      const styleVector = candidate.style_vector && candidate.style_vector.length > 0
        ? candidate.style_vector
        : new Array(this.config.styleDimension).fill(0);

      const combinedVector = [
        ...candidate.semantic_vector,
        ...styleVector
      ];

      await index.insertItem({
        id: String(candidate.id),
        vector: combinedVector,
        metadata: {
          emailId: String(candidate.email_id || ''),
          text: String(candidate.text || ''),
          userId: String(candidate.user_id),
          emailAccountId: String(candidate.email_account_id || ''),
          recipientEmail: String(candidate.recipient_email || ''),
          relationship: String(candidate.relationship_type || ''),
          subject: String(candidate.subject || ''),
          sentDate: candidate.sent_date?.toISOString() || new Date().toISOString(),
          wordCount: Number(candidate.word_count || 0)
        }
      });
    }

    return index;
  }

  /**
   * Generate cache key for index caching
   * @private
   */
  private _getCacheKey(userId: string, filters?: VectorSearchParams['filters']): string {
    const parts = [userId];
    if (filters?.relationship) parts.push(`rel:${filters.relationship}`);
    if (filters?.recipientEmail) parts.push(`recip:${filters.recipientEmail}`);
    return parts.join('|');
  }

  /**
   * Get cached index or build new one
   * @private
   */
  private async _getOrBuildIndex(
    cacheKey: string,
    candidateIds: string,
    candidates: any[]
  ): Promise<LocalIndex> {
    const now = Date.now();
    const cached = this.indexCache.get(cacheKey);

    // Check if cache is valid and candidates haven't changed
    if (cached && cached.expiresAt > now && cached.candidateIds === candidateIds) {
      return cached.index;
    }

    // Build new index
    const index = await this._buildInMemoryIndex(candidates);

    // Store in cache
    this.indexCache.set(cacheKey, {
      index,
      expiresAt: now + this.CACHE_TTL_MS,
      candidateIds
    });

    // Clean up expired entries
    this._cleanExpiredCache();

    return index;
  }

  /**
   * Clean up expired cache entries
   * @private
   */
  private _cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, cached] of this.indexCache.entries()) {
      if (cached.expiresAt <= now) {
        this.indexCache.delete(key);
      }
    }
  }

  /**
   * Perform dual vector search with weighted scoring
   *
   * Purpose: Search using combined semantic + style vectors
   * @private
   */
  private async _dualVectorSearch(
    params: DualVectorSearchParams,
    index: LocalIndex,
    candidates: any[]
  ): Promise<SearchMatch[]> {
    const semanticWeight = params.semanticWeight || this.config.semanticWeight;
    const styleWeight = params.styleWeight || this.config.styleWeight;

    // Create weighted combined vector for Vectra search
    // Note: Vectra uses the combined vector for initial ranking
    const combinedVector = [
      ...params.semanticVector.map(v => v * Math.sqrt(semanticWeight)),
      ...params.styleVector.map(v => v * Math.sqrt(styleWeight))
    ];

    // Search using Vectra
    // API: queryItems(vector, filter?, count?, minScore?, maxScore?)
    const limit = params.limit !== undefined ? params.limit : this.config.defaultLimit;
    // Fetch slightly more than needed for post-filtering, but keep it reasonable
    const vectraLimit = Math.min(limit * 3, 50);
    const results = await index.queryItems(combinedVector, '', vectraLimit);

    // Map to SearchMatch format with detailed score breakdown
    const matches: SearchMatch[] = [];

    for (const result of results) {
      // Find original candidate to get individual vectors
      const candidate = candidates.find(c => c.id === result.item.id);
      if (!candidate) continue;

      // Calculate individual scores
      const semanticScore = this._cosineSimilarity(params.semanticVector, candidate.semantic_vector);

      // Handle missing/null style vectors
      const hasStyleVector = candidate.style_vector && candidate.style_vector.length > 0;
      const hasQueryStyleVector = params.styleVector && params.styleVector.some((v: number) => v !== 0);
      const styleScore = hasStyleVector && hasQueryStyleVector
        ? this._cosineSimilarity(params.styleVector, candidate.style_vector)
        : 0;

      // Use semantic-only scoring if style vectors are unavailable
      const combinedScore = hasStyleVector && hasQueryStyleVector
        ? (semanticScore * semanticWeight) + (styleScore * styleWeight)
        : semanticScore;  // Fallback to semantic-only

      // Apply score threshold (explicitly check for undefined to allow 0)
      const threshold = params.scoreThreshold !== undefined
        ? params.scoreThreshold
        : this.config.scoreThreshold;
      if (combinedScore < threshold) {
        continue;
      }

      matches.push({
        id: result.item.id,
        emailId: String(result.item.metadata.emailId || ''),
        text: String(result.item.metadata.text || ''),
        metadata: {
          userId: String(result.item.metadata.userId),
          emailAccountId: String(result.item.metadata.emailAccountId || ''),
          recipientEmail: String(result.item.metadata.recipientEmail || ''),
          relationship: String(result.item.metadata.relationship || ''),
          subject: String(result.item.metadata.subject || ''),
          sentDate: new Date(String(result.item.metadata.sentDate || new Date().toISOString())),
          wordCount: Number(result.item.metadata.wordCount || 0)
        },
        scores: {
          semantic: semanticScore,
          style: styleScore,
          combined: combinedScore,
          temporal: combinedScore  // Will be updated by temporal weighting
        }
      });
    }

    // Sort by combined score and limit
    return matches
      .sort((a, b) => b.scores.combined - a.scores.combined)
      .slice(0, limit);
  }

  /**
   * Apply temporal weighting to search results
   *
   * Purpose: Prioritize recent emails to reflect current writing style
   * @private
   */
  private _applyTemporalWeighting(matches: SearchMatch[]): SearchMatch[] {
    const now = new Date();

    return matches.map(match => {
      const ageWeight = this._calculateAgeWeight(match.metadata.sentDate, now);
      return {
        ...match,
        scores: {
          ...match.scores,
          temporal: match.scores.combined * ageWeight
        }
      };
    }).sort((a, b) => b.scores.temporal - a.scores.temporal);
  }

  /**
   * Calculate age-based weight for email
   *
   * Purpose: Implements exponential decay based on email age
   * @private
   */
  private _calculateAgeWeight(sentDate: Date, now: Date): number {
    const ageMonths = (now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24 * 30);

    if (ageMonths <= 3) return this.config.temporalWeights.recent;
    if (ageMonths <= 6) return this.config.temporalWeights.medium;
    if (ageMonths <= 12) return this.config.temporalWeights.old;
    return this.config.temporalWeights.veryOld;
  }

  /**
   * Calculate cosine similarity between two vectors
   *
   * Purpose: Standard similarity metric for vector comparison
   * @private
   */
  private _cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);

    // Handle zero vectors (avoid NaN)
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * Validate vector dimensions
   *
   * Purpose: Ensure vectors match expected dimensions before storage
   * @private
   */
  private _validateVector(vector: number[], expectedDim: number, type: string): void {
    if (!Array.isArray(vector) || vector.length !== expectedDim) {
      throw new InvalidVectorError(
        `${type} vector must be ${expectedDim} dimensions, got ${vector?.length}`
      );
    }
  }

  /**
   * Calculate search statistics
   *
   * Purpose: Provide metadata about search results for debugging
   * @private
   */
  private _calculateStats(matches: SearchMatch[], searchTimeMs: number) {
    if (matches.length === 0) {
      return {
        totalCandidates: 0,
        filteredCount: 0,
        avgSemanticScore: 0,
        avgStyleScore: 0,
        avgCombinedScore: 0,
        searchTimeMs
      };
    }

    return {
      totalCandidates: matches.length,
      filteredCount: matches.length,
      avgSemanticScore: matches.reduce((sum, m) => sum + m.scores.semantic, 0) / matches.length,
      avgStyleScore: matches.reduce((sum, m) => sum + m.scores.style, 0) / matches.length,
      avgCombinedScore: matches.reduce((sum, m) => sum + m.scores.combined, 0) / matches.length,
      searchTimeMs
    };
  }

  /**
   * Get default configuration
   *
   * Purpose: Static method to get default config from environment
   * Following pattern: getDefaultConfig from EmailActionRouter
   */
  static getDefaultConfig(): VectorSearchConfig {
    return {
      semanticDimension: 384,
      styleDimension: 768,
      defaultLimit: 50,
      scoreThreshold: parseFloat(process.env.VECTOR_SCORE_THRESHOLD || '0.5'),
      semanticWeight: parseFloat(process.env.SEMANTIC_WEIGHT || '0.4'),
      styleWeight: parseFloat(process.env.STYLE_WEIGHT || '0.6'),
      temporalWeights: {
        recent: parseFloat(process.env.TEMPORAL_WEIGHT_0_3M || '1.0'),
        medium: parseFloat(process.env.TEMPORAL_WEIGHT_3_6M || '0.85'),
        old: parseFloat(process.env.TEMPORAL_WEIGHT_6_12M || '0.7'),
        veryOld: parseFloat(process.env.TEMPORAL_WEIGHT_12M_PLUS || '0.5')
      }
    };
  }
}

// Singleton export moved to index.ts to avoid circular dependencies in tests
