import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import {
  VectorSearchResult,
  VectorStoreError,
  TemporalWeightConfig,
  HybridSearchParams,
  RRFConfig,
  RRFScoredResult,
  DenseSearchParams,
  SparseSearchParams
} from './types';

dotenv.config();

export interface EmailMetadata {
  emailId: string;
  userId: string;
  emailAccountId?: string;    // Which email account this belongs to
  rawText?: string;           // Original email with signature (optional for backward compat)
  userReply?: string;         // Just what the user wrote (no quotes, no signatures)
  respondedTo?: string;       // The quoted content the user was responding to
  redactedNames?: string[];   // Names that were redacted from the email
  redactedEmails?: string[];  // Email addresses that were redacted
  recipientEmail: string;
  subject: string;
  sentDate: string;
  features: any; // NLP features from feature extraction
  relationship: {
    type: string;
    confidence: number;
    detectionMethod: string;
  };
  frequencyScore?: number;
  wordCount?: number;
  responseTimeMinutes?: number;
  eml_file?: string;          // Raw RFC 5322 message format
  emailType?: 'incoming' | 'sent';  // Type of email
  senderEmail?: string;       // For incoming emails
  senderName?: string;        // For incoming emails
  // IMAP metadata
  uid?: number;               // IMAP UID
  bodystructure?: any;        // MIME structure tree with attachment metadata
  flags?: string[];           // IMAP flags (['\\Seen', '\\Flagged', etc])
  size?: number;              // Message size in bytes
  folderName?: string;        // IMAP folder name ('INBOX', 'Sent', etc)
  // Complete envelope data
  from?: string;              // Envelope from (single address)
  to?: string[];              // Envelope to (all addresses)
  cc?: string[];              // Envelope cc (all addresses)
  bcc?: string[];             // Envelope bcc (all addresses)
  llmResponse?: {             // LLM metadata for generated responses
    meta: any;                // LLMMetadata object
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

export interface EmailVector {
  id: string;
  vector: number[];
  metadata: EmailMetadata;
  score?: number;
}

export interface VectorSearchParams {
  userId: string;
  queryVector: number[];
  relationship?: string;
  recipientEmail?: string;  // Filter by specific recipient for direct correspondence
  limit?: number;
  scoreThreshold?: number;
  excludeIds?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  collectionName?: string;  // Which collection to search (sent-emails or received-emails)
}

export interface UsageUpdate {
  vectorId: string;
  wasUsed: boolean;
  wasEdited: boolean;
  editDistance?: number;
  userRating?: number;
}

// Collection names for sent and received emails
export const SENT_COLLECTION = 'sent-emails';
export const RECEIVED_COLLECTION = 'received-emails';

export class VectorStore {
  private client: QdrantClient;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private temporalWeights: TemporalWeightConfig;
  private hybridWeights: { dense: number; sparse: number };
  private rrfConfig: Required<RRFConfig>;
  private readonly scoreThreshold: number;

  constructor() {
    const url = process.env.QDRANT_URL!;
    const apiKey = process.env.QDRANT_API_KEY;

    this.client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
    });

    // Load temporal weighting config from environment
    this.temporalWeights = {
      recent: parseFloat(process.env.TEMPORAL_WEIGHT_0_3M || '1.0'),
      medium: parseFloat(process.env.TEMPORAL_WEIGHT_3_6M || '0.85'),
      old: parseFloat(process.env.TEMPORAL_WEIGHT_6_12M || '0.7'),
      veryOld: parseFloat(process.env.TEMPORAL_WEIGHT_12M_PLUS || '0.5')
    };

    // Load hybrid search weights from environment
    this.hybridWeights = {
      dense: parseFloat(process.env.HYBRID_DENSE_WEIGHT || '0.7'),
      sparse: parseFloat(process.env.HYBRID_SPARSE_WEIGHT || '0.3')
    };

    // Load RRF config from environment
    this.rrfConfig = {
      k: parseInt(process.env.RRF_K || '60'),
      denseWeight: parseFloat(process.env.HYBRID_DENSE_WEIGHT || '0.7'),
      sparseWeight: parseFloat(process.env.HYBRID_SPARSE_WEIGHT || '0.3')
    };

    // Load score threshold from environment
    this.scoreThreshold = parseFloat(process.env.VECTOR_SCORE_THRESHOLD || '0.5');
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    await this.initPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      // Check which collections exist
      const collections = await this.client.getCollections();
      if (!collections || !collections.collections) {
        throw new Error('Failed to get collections from Qdrant');
      }

      const collectionConfig = {
        vectors: {
          size: 384,
          distance: 'Cosine' as const
        },
        optimizers_config: {
          indexing_threshold: 0,  // Index immediately for testing
        }
      };

      // Create sent-emails collection if it doesn't exist
      const sentExists = collections.collections.some(c => c.name === SENT_COLLECTION);
      if (!sentExists) {
        console.log(`Creating collection: ${SENT_COLLECTION}`);
        await this.client.createCollection(SENT_COLLECTION, collectionConfig);
        console.log(`Collection ${SENT_COLLECTION} created with automatic indexing`);
      }

      // Create received-emails collection if it doesn't exist
      const receivedExists = collections.collections.some(c => c.name === RECEIVED_COLLECTION);
      if (!receivedExists) {
        console.log(`Creating collection: ${RECEIVED_COLLECTION}`);
        await this.client.createCollection(RECEIVED_COLLECTION, collectionConfig);
        console.log(`Collection ${RECEIVED_COLLECTION} created with automatic indexing`);
      }

      this.initialized = true;
    } catch (error) {
      this.initPromise = null;
      throw new Error(`Failed to initialize Qdrant: ${error}`);
    }
  }

  async upsertEmail(email: {
    id: string;
    userId: string;
    vector: number[];
    metadata: EmailMetadata;
    collectionName?: string;
  }): Promise<void> {
    await this.initialize();

    const collection = email.collectionName || SENT_COLLECTION;

    try {
      // Generate a numeric ID from string ID using hash
      const numericId = this.stringToNumericId(email.id);

      await this.client.upsert(collection, {
        points: [{
          id: numericId,
          vector: email.vector,
          payload: {
            ...email.metadata,
            userId: email.userId,
            indexedAt: new Date().toISOString(),
            originalId: email.id // Store original string ID
          }
        }]
      });
    } catch (error) {
      throw new Error(`Failed to upsert email vector: ${error}`);
    }
  }

  private stringToNumericId(str: string): number {
    // Simple hash function to convert string to number
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  async upsertBatch(emails: Array<{
    id: string;
    userId: string;
    vector: number[];
    metadata: EmailMetadata;
    collectionName?: string;
  }>): Promise<void> {
    await this.initialize();

    if (emails.length === 0) return;

    // Group by collection
    const byCollection = new Map<string, typeof emails>();
    for (const email of emails) {
      const collection = email.collectionName || SENT_COLLECTION;
      if (!byCollection.has(collection)) {
        byCollection.set(collection, []);
      }
      byCollection.get(collection)!.push(email);
    }

    try {
      // Upsert each collection separately
      for (const [collection, collectionEmails] of byCollection.entries()) {
        const points = collectionEmails.map(email => ({
          id: this.stringToNumericId(email.id),
          vector: email.vector,
          payload: {
            ...email.metadata,
            userId: email.userId,
            indexedAt: new Date().toISOString(),
            originalId: email.id
          }
        }));

        // Upsert in batches of 100
        const batchSize = 100;
        for (let i = 0; i < points.length; i += batchSize) {
          const batch = points.slice(i, i + batchSize);
          await this.client.upsert(collection, { points: batch });
        }

        console.log(`Upserted ${collectionEmails.length} email vectors to ${collection}`);
      }
    } catch (error) {
      throw new Error(`Failed to upsert batch: ${error}`);
    }
  }

  /**
   * Hybrid search using both dense (semantic) and sparse (keyword) vectors
   *
   * Purpose: Combines semantic similarity with keyword matching for improved relevance.
   * Uses Reciprocal Rank Fusion to merge results from both search methods.
   *
   * @param params - Hybrid search parameters including dense and sparse vectors
   * @returns Array of search results sorted by RRF score, with temporal weighting applied
   */
  async hybridSearch(params: HybridSearchParams): Promise<EmailVector[]> {
    await this.initialize();

    try {
      const denseWeight = params.denseWeight ?? this.hybridWeights.dense;
      const sparseWeight = params.sparseWeight ?? this.hybridWeights.sparse;
      const limit = params.limit || parseInt(process.env.VECTOR_SEARCH_LIMIT || '50');

      // Execute dense and sparse searches in parallel
      const [denseResults, sparseResults] = await Promise.all([
        this.searchDense({
          userId: params.userId,
          queryVector: params.denseVector,
          filters: params.filters,
          limit,
          scoreThreshold: params.scoreThreshold,
          collectionName: params.collectionName
        }),
        this.searchSparse({
          userId: params.userId,
          sparseVector: params.sparseVector,
          filters: params.filters,
          limit,
          scoreThreshold: params.scoreThreshold,
          collectionName: params.collectionName
        })
      ]);

      // Merge results using RRF
      const merged = this.mergeResults(denseResults, sparseResults, denseWeight, sparseWeight);

      // Apply temporal weighting
      const weighted = this.applyTemporalWeighting(merged);

      // Take top results and convert to EmailVector format
      return weighted.slice(0, limit).map(result => ({
        id: result.id,
        vector: [],
        metadata: result.metadata,
        score: result.score
      }));

    } catch (error: any) {
      throw this.handleError(error, 'hybrid search');
    }
  }

  /**
   * Search using dense (semantic) vectors only
   * @private (used by hybridSearch, but can be public if needed)
   */
  private async searchDense(params: DenseSearchParams): Promise<VectorSearchResult[]> {
    await this.initialize();

    const collection = params.collectionName || SENT_COLLECTION;
    const limit = params.limit || 50;
    const scoreThreshold = params.scoreThreshold ?? 0; // No threshold for intermediate results

    // Build filter conditions
    const must = this.buildFilterConditions(params.userId, params.filters);

    try {
      const searchParams: any = {
        vector: params.queryVector,
        limit,
        score_threshold: scoreThreshold,
        with_payload: true,
        with_vector: false
      };

      if (must.length > 0) {
        searchParams.filter = { must };
      }

      const results = await this.client.search(collection, searchParams);
      return results.map(this.convertToVectorSearchResult.bind(this));

    } catch (error: any) {
      throw this.handleError(error, 'dense search');
    }
  }

  /**
   * Search using sparse (keyword) vectors only
   * @private (used by hybridSearch, but can be public if needed)
   */
  private async searchSparse(_params: SparseSearchParams): Promise<VectorSearchResult[]> {
    await this.initialize();

    // NOTE: Sparse vector search requires collection to have sparse vector field configured
    // For now, return empty results if sparse vectors not configured
    // This will be updated after migration script adds sparse vector support

    // TODO: Implement sparse vector search once collection schema supports it
    // Uncomment the code below once sparse vectors are migrated:
    //
    // const collection = params.collectionName || SENT_COLLECTION;
    // const limit = params.limit || 50;
    // const scoreThreshold = params.scoreThreshold ?? 0;
    // const must = this.buildFilterConditions(params.userId, params.filters);
    //
    // const searchParams: any = {
    //   vector: {
    //     name: 'sparse',
    //     vector: params.sparseVector
    //   },
    //   limit,
    //   score_threshold: scoreThreshold,
    //   with_payload: true,
    //   with_vector: false,
    //   filter: must.length > 0 ? { must } : undefined
    // };
    //
    // const results = await this.client.search(collection, searchParams);
    // return results.map(this.convertToVectorSearchResult.bind(this));

    // For now, return empty array (will be filled in after migration)
    return [];
  }

  /**
   * Build filter conditions for search queries
   * @private
   */
  private buildFilterConditions(userId: string, filters?: {
    relationship?: string;
    recipientEmail?: string;
    dateRange?: { start: Date; end: Date };
    excludeIds?: string[];
  }): any[] {
    const must: any[] = [
      { key: 'userId', match: { value: userId } }
    ];

    if (filters?.relationship) {
      must.push({
        key: 'relationship.type',
        match: { value: filters.relationship }
      });
    }

    if (filters?.recipientEmail) {
      must.push({
        key: 'recipientEmail',
        match: { value: filters.recipientEmail }
      });
    }

    if (filters?.excludeIds && filters.excludeIds.length > 0) {
      must.push({
        key: 'emailId',
        match: {
          except: filters.excludeIds
        }
      });
    }

    if (filters?.dateRange) {
      must.push({
        key: 'sentDate',
        range: {
          gte: filters.dateRange.start.toISOString(),
          lte: filters.dateRange.end.toISOString()
        }
      });
    }

    return must;
  }

  async searchSimilar(params: VectorSearchParams): Promise<EmailVector[]> {
    await this.initialize();

    const collection = params.collectionName || SENT_COLLECTION;
    const limit = params.limit || parseInt(process.env.VECTOR_SEARCH_LIMIT || '50');
    const scoreThreshold = params.scoreThreshold ?? this.scoreThreshold;

    // Build filter conditions
    const must: any[] = [
      { key: 'userId', match: { value: params.userId } }
    ];

    // CRITICAL: Relationship filter is PRIMARY
    if (params.relationship) {
      must.push({
        key: 'relationship.type',
        match: { value: params.relationship }
      });
    }

    // Filter by specific recipient email for direct correspondence
    if (params.recipientEmail) {
      must.push({
        key: 'recipientEmail',
        match: { value: params.recipientEmail }
      });
    }

    if (params.excludeIds && params.excludeIds.length > 0) {
      must.push({
        key: 'emailId',
        match: {
          except: params.excludeIds
        }
      });
    }

    if (params.dateRange) {
      must.push({
        key: 'sentDate',
        range: {
          gte: params.dateRange.start.toISOString(),
          lte: params.dateRange.end.toISOString()
        }
      });
    }

    try {
      const searchParams: any = {
        vector: params.queryVector,
        limit,
        score_threshold: scoreThreshold,
        with_payload: true,
        with_vector: false
      };

      if (must.length > 0) {
        searchParams.filter = { must };
      }

      const results = await this.client.search(collection, searchParams);

      // Convert to VectorSearchResult format
      const vectorResults: VectorSearchResult[] = results.map(this.convertToVectorSearchResult.bind(this));

      // Apply temporal weighting
      const weighted = this.applyTemporalWeighting(vectorResults);

      // Convert back to EmailVector format for backward compatibility
      return weighted.map(result => ({
        id: result.id,
        vector: [], // Not returning vectors to save memory
        metadata: result.metadata,
        score: result.score
      }));
    } catch (error: any) {
      throw this.handleError(error, 'search');
    }
  }

  async findNearDuplicates(
    userId: string, 
    vector: number[], 
    threshold?: number
  ): Promise<EmailVector[]> {
    const nearDuplicateThreshold = threshold || parseFloat(process.env.NEAR_DUPLICATE_THRESHOLD || '0.98');
    
    return this.searchSimilar({
      userId,
      queryVector: vector,
      limit: 10,
      scoreThreshold: nearDuplicateThreshold
    });
  }

  async getByRelationship(
    userId: string,
    relationship: string,
    limit?: number,
    collectionName?: string
  ): Promise<EmailVector[]> {
    await this.initialize();

    const collection = collectionName || SENT_COLLECTION;
    const searchLimit = limit || 100;

    try {
      // For aggregate, get ALL emails for the user (no relationship filter)
      const filter = relationship === 'aggregate'
        ? {
            must: [
              { key: 'userId', match: { value: userId } }
            ]
          }
        : {
            must: [
              { key: 'userId', match: { value: userId } },
              { key: 'relationship.type', match: { value: relationship } }
            ]
          };

      const results = await this.client.scroll(collection, {
        filter,
        limit: searchLimit,
        with_payload: true,
        with_vector: false
      });

      return results.points.map(point => ({
        id: (point.payload as any).originalId || String(point.id),
        vector: [],
        metadata: point.payload as unknown as EmailMetadata
      }));
    } catch (error) {
      throw new Error(`Failed to get emails by relationship: ${error}`);
    }
  }

  async debugUserEmails(_userId: string, _limit: number = 5, _collectionName?: string): Promise<void> {
    await this.initialize();
    // Removed verbose logging - summary now in InboxProcessor
    // Debug function no longer needed - kept for API compatibility
  }

  async getRelationshipStats(userId: string, collectionName?: string): Promise<Record<string, number>> {
    await this.initialize();

    const collection = collectionName || SENT_COLLECTION;

    try {
      // Get all emails for user
      const results = await this.client.scroll(collection, {
        filter: {
          must: [
            { key: 'userId', match: { value: userId } }
          ]
        },
        limit: 10000,
        with_payload: ['relationship.type'],
        with_vector: false
      });

      // Count by relationship
      const stats: Record<string, number> = {};
      results.points.forEach(point => {
        const relationship = (point.payload as any)?.relationship?.type;
        if (relationship) {
          stats[relationship] = (stats[relationship] || 0) + 1;
        }
      });

      return stats;
    } catch (error) {
      throw new Error(`Failed to get relationship stats: ${error}`);
    }
  }

  async updateUsageStats(updates: UsageUpdate[], collectionName?: string): Promise<void> {
    await this.initialize();

    const collection = collectionName || SENT_COLLECTION;

    try {
      for (const update of updates) {
        // Get current point
        const numericId = this.stringToNumericId(update.vectorId);
        const points = await this.client.retrieve(collection, {
          ids: [numericId],
          with_payload: true
        });

        if (points.length === 0) continue;

        const currentPayload = points[0].payload as any;

        // Update frequency and usage stats
        const newPayload = {
          ...currentPayload,
          frequencyScore: (currentPayload.frequencyScore || 1) + (update.wasUsed ? 1 : 0),
          lastUsedAt: update.wasUsed ? new Date().toISOString() : currentPayload.lastUsedAt,
          editCount: (currentPayload.editCount || 0) + (update.wasEdited ? 1 : 0),
          averageEditDistance: update.editDistance
            ? ((currentPayload.averageEditDistance || 0) * (currentPayload.editCount || 0) + update.editDistance) / ((currentPayload.editCount || 0) + 1)
            : currentPayload.averageEditDistance,
          userRating: update.userRating || currentPayload.userRating
        };

        await this.client.setPayload(collection, {
          points: [numericId],
          payload: newPayload
        });
      }
    } catch (error) {
      throw new Error(`Failed to update usage stats: ${error}`);
    }
  }

  async deleteUserData(userId: string): Promise<void> {
    await this.initialize();

    const collections = [SENT_COLLECTION, RECEIVED_COLLECTION];

    try {
      for (const collection of collections) {
        // First, count how many records we're about to delete
        const scrollResult = await this.client.scroll(collection, {
          filter: {
            must: [
              { key: 'userId', match: { value: userId } }
            ]
          },
          limit: 1,
          with_payload: false,
          with_vector: false
        });

        console.log(`[VectorStore] Found ${scrollResult.points.length} records for user ${userId} to delete from ${collection}`);

        // Delete using the filter
        await this.client.delete(collection, {
          filter: {
            must: [
              { key: 'userId', match: { value: userId } }
            ]
          },
          wait: true // Wait for the operation to complete
        });

        console.log(`[VectorStore] Delete operation completed for user ${userId} from ${collection}`);

        // Verify deletion
        const verifyResult = await this.client.scroll(collection, {
          filter: {
            must: [
              { key: 'userId', match: { value: userId } }
            ]
          },
          limit: 1,
          with_payload: false,
          with_vector: false
        });

        if (verifyResult.points.length > 0) {
          console.warn(`[VectorStore] Warning: ${verifyResult.points.length} records still remain for user ${userId} in ${collection}`);
        }
      }

    } catch (error) {
      throw new Error(`Failed to delete user data: ${error}`);
    }
  }

  async getCollectionInfo(collectionName?: string) {
    await this.initialize();

    try {
      // If specific collection requested, return just that one
      if (collectionName) {
        const info = await this.client.getCollection(collectionName);
        return {
          name: collectionName,
          vectorCount: info.points_count || 0,
          indexedVectorsCount: info.indexed_vectors_count || 0,
          status: info.status,
          config: info.config,
          vectorsCount: info.vectors_count,
          pointsCount: info.points_count
        };
      }

      // Otherwise return info for both collections
      const sentInfo = await this.client.getCollection(SENT_COLLECTION);
      const receivedInfo = await this.client.getCollection(RECEIVED_COLLECTION);

      return {
        sent: {
          name: SENT_COLLECTION,
          vectorCount: sentInfo.points_count || 0,
          indexedVectorsCount: sentInfo.indexed_vectors_count || 0,
          status: sentInfo.status,
          config: sentInfo.config,
          vectorsCount: sentInfo.vectors_count,
          pointsCount: sentInfo.points_count
        },
        received: {
          name: RECEIVED_COLLECTION,
          vectorCount: receivedInfo.points_count || 0,
          indexedVectorsCount: receivedInfo.indexed_vectors_count || 0,
          status: receivedInfo.status,
          config: receivedInfo.config,
          vectorsCount: receivedInfo.vectors_count,
          pointsCount: receivedInfo.points_count
        }
      };
    } catch (error) {
      throw new Error(`Failed to get collection info: ${error}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a point with the given ID exists in the collection
   * @param pointId - The string ID to check (will be hashed to numeric ID)
   * @param collectionName - Which collection to check (defaults to sent-emails)
   * @returns Promise<boolean> - true if exists, false otherwise
   */
  async pointExists(pointId: string, collectionName?: string): Promise<boolean> {
    await this.initialize();

    const collection = collectionName || SENT_COLLECTION;

    try {
      const numericId = this.stringToNumericId(pointId);
      const points = await this.client.retrieve(collection, {
        ids: [numericId],
        with_payload: false,
        with_vector: false
      });

      return points.length > 0;
    } catch (error) {
      // If retrieval fails, assume point doesn't exist
      return false;
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Apply temporal decay weighting to search results
   *
   * Purpose: Prioritize recent emails over older ones to reflect current writing style.
   * Multiplies search scores by age-based weight and re-sorts by adjusted score.
   *
   * @private
   */
  private applyTemporalWeighting(results: VectorSearchResult[]): VectorSearchResult[] {
    const now = new Date();

    return results
      .map(result => {
        const ageWeight = this.calculateAgeWeight(result.metadata.sentDate, now);
        return {
          ...result,
          score: result.score * ageWeight
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate age weight for an email based on sent date
   *
   * Purpose: Returns weight multiplier based on email age in months.
   * Uses exponential decay defined in temporalWeights config.
   *
   * @private
   */
  private calculateAgeWeight(sentDate: string, now: Date): number {
    const emailDate = new Date(sentDate);
    const ageMonths = (now.getTime() - emailDate.getTime()) / (1000 * 60 * 60 * 24 * 30);

    if (ageMonths <= 3) return this.temporalWeights.recent;
    if (ageMonths <= 6) return this.temporalWeights.medium;
    if (ageMonths <= 12) return this.temporalWeights.old;
    return this.temporalWeights.veryOld;
  }

  /**
   * Filter results by score threshold
   *
   * Purpose: Remove low-quality results that don't meet minimum similarity score.
   * Quality gate to ensure only relevant examples are used.
   *
   * Note: Currently using Qdrant's built-in score_threshold. This method is kept
   * for future use if post-search filtering is needed.
   *
   * @private
   */
  // @ts-ignore - Kept for future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private filterByThreshold(
    results: VectorSearchResult[],
    threshold: number
  ): VectorSearchResult[] {
    return results.filter(result => result.score >= threshold);
  }

  /**
   * Merge dense and sparse search results using Reciprocal Rank Fusion (RRF)
   *
   * Purpose: Combines results from semantic (dense) and keyword (sparse) search.
   * RRF formula: score = sum(weight / (k + rank))
   *
   * @private
   */
  private mergeResults(
    denseResults: VectorSearchResult[],
    sparseResults: VectorSearchResult[],
    denseWeight: number,
    sparseWeight: number
  ): VectorSearchResult[] {
    // Create maps for quick lookup by ID
    const denseMap = new Map<string, { rank: number; score: number }>();
    const sparseMap = new Map<string, { rank: number; score: number }>();
    const allIds = new Set<string>();

    // Index dense results
    denseResults.forEach((result, rank) => {
      denseMap.set(result.id, { rank, score: result.score });
      allIds.add(result.id);
    });

    // Index sparse results
    sparseResults.forEach((result, rank) => {
      sparseMap.set(result.id, { rank, score: result.score });
      allIds.add(result.id);
    });

    // Calculate RRF scores for all unique IDs
    const rrfResults: RRFScoredResult[] = [];

    allIds.forEach(id => {
      const dense = denseMap.get(id);
      const sparse = sparseMap.get(id);

      // Calculate RRF score
      const denseRRF = dense
        ? this.calculateRRFScore(dense.rank, denseWeight, this.rrfConfig.k)
        : 0;
      const sparseRRF = sparse
        ? this.calculateRRFScore(sparse.rank, sparseWeight, this.rrfConfig.k)
        : 0;

      const rrfScore = denseRRF + sparseRRF;

      // Get metadata from whichever result exists (prefer dense)
      const sourceResult = dense
        ? denseResults.find(r => r.id === id)!
        : sparseResults.find(r => r.id === id)!;

      rrfResults.push({
        ...sourceResult,
        denseScore: dense?.score,
        sparseScore: sparse?.score,
        rrfScore,
        score: rrfScore // Use RRF score as final score
      });
    });

    // Sort by RRF score descending
    return rrfResults.sort((a, b) => b.rrfScore - a.rrfScore);
  }

  /**
   * Calculate RRF score for a single result at given rank
   *
   * Purpose: Implements RRF formula: weight / (k + rank)
   * where k is a smoothing parameter (default: 60)
   *
   * @private
   */
  private calculateRRFScore(rank: number, weight: number, k: number = 60): number {
    return weight / (k + rank);
  }

  /**
   * Convert Qdrant search result to VectorSearchResult format
   *
   * Purpose: Standardizes result format across all search methods
   *
   * @private
   */
  private convertToVectorSearchResult(qdrantResult: any): VectorSearchResult {
    return {
      id: (qdrantResult.payload as any).originalId || String(qdrantResult.id),
      score: qdrantResult.score,
      metadata: qdrantResult.payload as unknown as EmailMetadata,
      vector: qdrantResult.vector || undefined
    };
  }

  /**
   * Handle errors from Qdrant client consistently
   *
   * Purpose: Provides specific error codes and consistent error messages
   *
   * @private
   */
  private handleError(error: any, context: string): never {
    const message = error.message || String(error);

    // Determine error code based on context and message
    let code: VectorStoreError['code'] = 'UNKNOWN';

    if (message.includes('connection') || message.includes('ECONNREFUSED')) {
      code = 'CONNECTION_FAILED';
    } else if (message.includes('collection') && message.includes('not found')) {
      code = 'COLLECTION_NOT_FOUND';
    } else if (message.includes('vector') && message.includes('invalid')) {
      code = 'INVALID_VECTOR';
    } else if (context.includes('search')) {
      code = 'SEARCH_FAILED';
    } else if (context.includes('upsert')) {
      code = 'UPSERT_FAILED';
    } else if (context.includes('initialize')) {
      code = 'INITIALIZATION_FAILED';
    }

    throw new VectorStoreError(
      `Vector store ${context} failed: ${message}`,
      code
    );
  }

  /**
   * Get an email by messageId (emailId in metadata)
   * @param userId - The user ID (for security)
   * @param emailAccountId - The email account ID (for security and filtering)
   * @param messageId - The message ID (corresponds to emailId in metadata)
   * @param collectionName - Which collection to search (defaults to received-emails)
   * @returns Promise<EmailVector | null> - The email or null if not found
   */
  async getByMessageId(
    userId: string,
    emailAccountId: string,
    messageId: string,
    collectionName?: string
  ): Promise<EmailVector | null> {
    await this.initialize();

    const collection = collectionName || RECEIVED_COLLECTION;

    try {
      // Search for email by emailId, userId, and emailAccountId
      const results = await this.client.scroll(collection, {
        filter: {
          must: [
            { key: 'userId', match: { value: userId } },
            { key: 'emailAccountId', match: { value: emailAccountId } },
            { key: 'emailId', match: { value: messageId } }
          ]
        },
        limit: 1,
        with_payload: true,
        with_vector: false
      });

      if (results.points.length === 0) {
        return null;
      }

      const point = results.points[0];
      return {
        id: (point.payload as any).originalId || String(point.id),
        vector: [],
        metadata: point.payload as unknown as EmailMetadata
      };
    } catch (error) {
      throw new Error(`Failed to get email by messageId: ${error}`);
    }
  }
}

// Singleton instance
export const vectorStore = new VectorStore();