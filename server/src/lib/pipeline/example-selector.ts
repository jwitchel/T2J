import { VectorStore, SENT_COLLECTION } from '../vector/qdrant-client';
import { EmbeddingService } from '../vector/embedding-service';
import { RelationshipService } from '../relationships/relationship-service';
import { RelationshipDetector } from '../relationships/relationship-detector';
import { withRetry } from './retry-utils';
import { SparseVector } from '../vector/types';
import { BM25Encoder } from '../vector/bm25-encoder';
import { RelationshipDetectorResult } from './types';

export interface SelectedExample {
  id: string;
  text: string;
  metadata: any;
  score: number;
}

export interface EmailVector {
  id: string;
  score?: number;
  metadata: any;
}

export interface ExampleSelectionResult {
  relationship: string;
  examples: SelectedExample[];
  stats: {
    totalCandidates: number;
    relationshipMatch: number;
    directCorrespondence: number;  // Tracks emails to the specific recipient
    avgSimilarity: number;  // Average similarity score
    avgAge: number;  // Average age in days
  };
}

export class ExampleSelector {
  private bm25Encoder: BM25Encoder;
  private initialized = false;
  private readonly exampleCount: number;
  private readonly directEmailMaxPct: number;
  private readonly scoreThreshold: number;

  constructor(
    private vectorStore: VectorStore,
    private embeddingService: EmbeddingService,
    // @ts-ignore - Kept for future use
    private _relationshipService: RelationshipService,
    private relationshipDetector: RelationshipDetector
  ) {
    this.bm25Encoder = new BM25Encoder();

    // Load configuration from environment with defaults
    this.exampleCount = parseInt(process.env.EXAMPLE_COUNT || '5');
    this.directEmailMaxPct = parseFloat(process.env.DIRECT_EMAIL_MAX_PERCENTAGE || '0.4');
    this.scoreThreshold = parseFloat(process.env.VECTOR_SCORE_THRESHOLD || '0.5');
  }

  /**
   * Initialize the example selector
   *
   * Purpose: Lazy initialization of BM25 encoder if needed
   * Currently a placeholder for future initialization needs
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // BM25 encoder will be fitted on user's corpus when first used
    // No initialization needed here
    this.initialized = true;
  }
  
  /**
   * Select examples for email draft generation
   *
   * Purpose: Implements two-phase selection strategy with hybrid search:
   * 1. Direct correspondence (up to 40% of examples)
   * 2. Same relationship category (remaining slots)
   *
   * Uses hybrid search (semantic + keyword) with temporal weighting for better relevance.
   *
   * @param params - Selection parameters including userId, incoming email, recipient
   * @returns Selected examples with metadata and statistics
   */
  async selectExamples(params: {
    userId: string;
    incomingEmail: string;
    recipientEmail: string;
    desiredCount?: number;
  }): Promise<ExampleSelectionResult> {
    await this.initialize();

    try {
      // Step 1: Detect relationship if not provided
      const relationship = await this.detectRelationship(params.userId, params.recipientEmail);

      // Step 2: Generate embeddings (dense + sparse) for incoming email
      const { denseVector, sparseVector } = await this.generateEmbeddings(params.incomingEmail);

      // Step 3: Calculate phase limits
      const desiredCount = params.desiredCount ?? this.exampleCount;
      const maxDirectCount = Math.floor(desiredCount * this.directEmailMaxPct);

      // Step 4: Phase 1 - Search direct correspondence
      const directResults = await this.searchDirectEmails(
        params.userId,
        params.recipientEmail,
        denseVector,
        sparseVector,
        maxDirectCount
      );

      // Step 5: Phase 2 - Search relationship category
      const remainingCount = desiredCount - directResults.length;
      const categoryResults = await this.searchCategoryEmails(
        params.userId,
        relationship.relationship,
        denseVector,
        sparseVector,
        remainingCount,
        directResults.map(r => r.id)
      );

      // Step 6: Combine results
      const combinedResults = this.combineResults(directResults, categoryResults);

      // Step 7: Convert to SelectedExample format
      const examples = this.convertToSelectedExamples(combinedResults, desiredCount);

      // Step 8: Calculate statistics
      const stats = this.calculateStats(
        directResults,
        categoryResults,
        examples,
        params.recipientEmail,
        relationship.relationship
      );

      return {
        relationship: relationship.relationship,
        examples,
        stats
      };

    } catch (error: any) {
      throw new Error(`Example selection failed: ${error.message}`);
    }
  }
  
  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Detect relationship for recipient
   * @private
   */
  private async detectRelationship(
    userId: string,
    recipientEmail: string
  ): Promise<RelationshipDetectorResult> {
    return await this.relationshipDetector.detectRelationship({
      userId,
      recipientEmail
    });
  }

  /**
   * Generate both dense and sparse embeddings for incoming email
   *
   * Purpose: Creates semantic (dense) and keyword (sparse) vectors for hybrid search
   * @private
   */
  private async generateEmbeddings(
    incomingEmail: string
  ): Promise<{ denseVector: number[]; sparseVector: SparseVector }> {
    // Defensive check: ensure incoming email is not empty
    const emailText = incomingEmail?.trim() || '';
    if (emailText.length === 0) {
      throw new Error('Cannot select examples: incoming email content is empty');
    }

    // Generate dense vector (semantic embedding) with retry
    const { vector: denseVector } = await withRetry(
      () => this.embeddingService.embedText(emailText)
    );

    // Generate sparse vector (BM25 keyword matching)
    // Note: BM25 encoder will be fitted on user's corpus on first use
    const sparseVector = this.bm25Encoder.encode(emailText);

    return { denseVector, sparseVector };
  }

  /**
   * Search for direct correspondence examples
   *
   * Purpose: Find emails sent to this specific recipient (Phase 1)
   * @private
   */
  private async searchDirectEmails(
    userId: string,
    recipientEmail: string,
    denseVector: number[],
    sparseVector: SparseVector,
    maxCount: number
  ): Promise<EmailVector[]> {
    if (maxCount === 0) return [];

    try {
      // Use hybrid search (currently falls back to dense-only until sparse vectors are added)
      const results = await withRetry(
        () => this.vectorStore.hybridSearch({
          userId,
          denseVector,
          sparseVector,
          filters: {
            recipientEmail  // Filter to this specific recipient
          },
          limit: Math.max(50, maxCount * 2),  // Get more than needed for filtering
          scoreThreshold: this.scoreThreshold,
          collectionName: SENT_COLLECTION
        })
      );

      // Return up to maxCount results
      return results.slice(0, maxCount);

    } catch (error: any) {
      console.error(`Direct email search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Search for relationship category examples
   *
   * Purpose: Find emails to others in same relationship type (Phase 2)
   * @private
   */
  private async searchCategoryEmails(
    userId: string,
    relationship: string,
    denseVector: number[],
    sparseVector: SparseVector,
    maxCount: number,
    excludeIds: string[]
  ): Promise<EmailVector[]> {
    if (maxCount === 0) return [];

    try {
      // Use hybrid search with relationship filter
      const results = await withRetry(
        () => this.vectorStore.hybridSearch({
          userId,
          denseVector,
          sparseVector,
          filters: {
            relationship,  // Same relationship type
            excludeIds  // Don't include direct emails again
          },
          limit: Math.max(100, maxCount * 2),  // Get more than needed for filtering
          scoreThreshold: this.scoreThreshold,
          collectionName: SENT_COLLECTION
        })
      );

      // Return up to maxCount results
      return results.slice(0, maxCount);

    } catch (error: any) {
      console.error(`Category email search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Combine direct and category results
   *
   * Purpose: Merge Phase 1 and Phase 2 results, preserving order
   * @private
   */
  private combineResults(
    directResults: EmailVector[],
    categoryResults: EmailVector[]
  ): EmailVector[] {
    return [...directResults, ...categoryResults];
  }

  /**
   * Convert EmailVector results to SelectedExample format
   *
   * Purpose: Standardizes result format for upstream consumers
   * @private
   */
  private convertToSelectedExamples(
    results: EmailVector[],
    maxCount: number
  ): SelectedExample[] {
    return results.slice(0, maxCount).map(result => ({
      id: result.id,
      text: result.metadata.userReply || result.metadata.rawText || '',
      metadata: result.metadata,
      score: result.score || 0
    }));
  }

  /**
   * Calculate selection statistics
   *
   * Purpose: Provides metadata about example selection for debugging and monitoring
   * @private
   */
  private calculateStats(
    directResults: EmailVector[],
    categoryResults: EmailVector[],
    selectedExamples: SelectedExample[],
    recipientEmail: string,
    relationship: string
  ): ExampleSelectionResult['stats'] {
    const totalCandidates = directResults.length + categoryResults.length;

    // Count examples matching relationship
    const relationshipMatch = selectedExamples.filter(e =>
      e.metadata.relationship?.type === relationship
    ).length;

    // Count examples from direct correspondence
    const directCorrespondence = selectedExamples.filter(e =>
      e.metadata.recipientEmail === recipientEmail
    ).length;

    // Calculate average similarity score
    const avgSimilarity = selectedExamples.length > 0
      ? selectedExamples.reduce((sum, e) => sum + e.score, 0) / selectedExamples.length
      : 0;

    // Calculate average age in days
    const now = new Date();
    const avgAge = selectedExamples.length > 0
      ? selectedExamples.reduce((sum, e) => {
          const sentDate = new Date(e.metadata.sentDate);
          const ageDays = (now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24);
          return sum + ageDays;
        }, 0) / selectedExamples.length
      : 0;

    return {
      totalCandidates,
      relationshipMatch,
      directCorrespondence,
      avgSimilarity,
      avgAge
    };
  }
}