/**
 * Example Selector
 *
 * Purpose: Select relevant examples for email draft generation using dual vector search
 * Uses two-phase selection: direct correspondence + relationship category
 *
 * Updated to use VectorSearchService (PostgreSQL + Vectra) instead of Qdrant
 * Now uses dual embeddings (semantic + style) for better tone matching
 *
 * Following patterns:
 * - Two-phase initialization
 * - Private helper methods
 * - Well-defined types
 */

import { vectorSearchService } from '../vector';
import { RelationshipDetector } from '../relationships/relationship-detector';
import { RelationshipDetectorResult } from './types';
import { SearchMatch } from '../vector/types';

/**
 * Selected example for draft generation
 *
 * Purpose: Standardized format for examples passed to LLM prompt
 */
export interface SelectedExample {
  id: string;
  text: string;
  metadata: any;
  scores: {
    semantic: number;
    style: number;
    combined: number;
  };
}

/**
 * Result from example selection
 *
 * Purpose: Complete selection result with examples and statistics
 * Following pattern: Well-defined result type
 */
export interface ExampleSelectionResult {
  relationship: string;
  examples: SelectedExample[];
  stats: {
    totalCandidates: number;
    relationshipMatch: number;
    directCorrespondence: number;
    avgSemanticScore: number;   // NEW: Separate semantic score
    avgStyleScore: number;       // NEW: Separate style score
    avgCombinedScore: number;    // NEW: Combined score
    avgAge: number;
  };
}

export class ExampleSelector {
  private initialized = false;
  private readonly exampleCount: number;
  private readonly directEmailMaxPct: number;
  private readonly scoreThreshold: number;

  constructor(
    private relationshipDetector: RelationshipDetector
  ) {
    // Load configuration from environment with defaults
    this.exampleCount = parseInt(process.env.EXAMPLE_COUNT || '5');
    this.directEmailMaxPct = parseFloat(process.env.DIRECT_EMAIL_MAX_PERCENTAGE || '0.4');
    this.scoreThreshold = parseFloat(process.env.VECTOR_SCORE_THRESHOLD || '0.5');
  }

  /**
   * Initialize the example selector
   *
   * Purpose: Lazy initialization of vector search service
   * Following pattern: Two-phase init
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await vectorSearchService.initialize();
    this.initialized = true;
  }

  /**
   * Select examples for email draft generation
   *
   * Purpose: Implements two-phase selection strategy:
   * 1. Direct correspondence (up to 40% of examples)
   * 2. Same relationship category (remaining slots)
   *
   * Uses dual vector search (semantic + style) with temporal weighting
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
      const desiredCount = params.desiredCount ?? this.exampleCount;
      const maxDirectCount = Math.floor(desiredCount * this.directEmailMaxPct);

      // Step 1: Detect relationship
      const relationship = await this._detectRelationship(params.userId, params.recipientEmail);

      // Step 2: Phase 1 - Search direct correspondence
      const directResults = await this._searchDirectEmails(
        params.userId,
        params.recipientEmail,
        params.incomingEmail,
        maxDirectCount
      );

      // Step 3: Phase 2 - Search relationship category
      const remainingCount = desiredCount - directResults.length;
      const categoryResults = await this._searchCategoryEmails(
        params.userId,
        relationship.relationship,
        params.incomingEmail,
        remainingCount,
        directResults.map(r => r.id)
      );

      // Step 4: Combine and format results
      const examples = this._convertToSelectedExamples([...directResults, ...categoryResults], desiredCount);

      // Step 5: Calculate statistics
      const stats = this._calculateStats(
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

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Example selection failed: ${errorMessage}`);
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Detect relationship for recipient
   * @private
   */
  private async _detectRelationship(
    userId: string,
    recipientEmail: string
  ): Promise<RelationshipDetectorResult> {
    return await this.relationshipDetector.detectRelationship({
      userId,
      recipientEmail
    });
  }

  /**
   * Search for direct correspondence examples
   *
   * Purpose: Find emails sent to this specific recipient (Phase 1)
   * @private
   */
  private async _searchDirectEmails(
    userId: string,
    recipientEmail: string,
    queryText: string,
    maxCount: number
  ): Promise<SearchMatch[]> {
    if (maxCount === 0) return [];

    try {
      // Use env variable for direct email fetch limit
      const DIRECT_EMAIL_FETCH_LIMIT = parseInt(process.env.DIRECT_EMAIL_FETCH_LIMIT || '');
      if (!DIRECT_EMAIL_FETCH_LIMIT) {
        throw new Error('DIRECT_EMAIL_FETCH_LIMIT environment variable is required');
      }

      const result = await vectorSearchService.search({
        userId,
        queryText,
        filters: {
          recipientEmail
        },
        limit: Math.max(DIRECT_EMAIL_FETCH_LIMIT, maxCount * 2),
        scoreThreshold: this.scoreThreshold
      });

      return result.documents.slice(0, maxCount);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ExampleSelector] Direct email search failed: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Search for relationship category examples
   *
   * Purpose: Find emails to others in same relationship type (Phase 2)
   * @private
   */
  private async _searchCategoryEmails(
    userId: string,
    relationship: string,
    queryText: string,
    maxCount: number,
    excludeIds: string[]
  ): Promise<SearchMatch[]> {
    if (maxCount === 0) return [];

    try {
      // Use env variable for category email fetch limit
      const CATEGORY_EMAIL_FETCH_LIMIT = parseInt(process.env.CATEGORY_EMAIL_FETCH_LIMIT || '');
      if (!CATEGORY_EMAIL_FETCH_LIMIT) {
        throw new Error('CATEGORY_EMAIL_FETCH_LIMIT environment variable is required');
      }

      const result = await vectorSearchService.search({
        userId,
        queryText,
        filters: {
          relationship,
          excludeIds
        },
        limit: Math.max(CATEGORY_EMAIL_FETCH_LIMIT, maxCount * 2),
        scoreThreshold: this.scoreThreshold
      });

      return result.documents.slice(0, maxCount);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ExampleSelector] Category email search failed: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Convert SearchMatch results to SelectedExample format
   *
   * Purpose: Standardizes result format for upstream consumers (prompt templates)
   * @private
   */
  private _convertToSelectedExamples(matches: SearchMatch[], maxCount: number): SelectedExample[] {
    return matches.slice(0, maxCount).map(match => ({
      id: match.id,
      text: match.text || '',
      metadata: match.metadata,
      scores: {
        semantic: match.scores.semantic,
        style: match.scores.style,
        combined: match.scores.combined
      }
    }));
  }

  /**
   * Calculate selection statistics
   *
   * Purpose: Provides metadata about example selection for debugging and monitoring
   * @private
   */
  private _calculateStats(
    directResults: SearchMatch[],
    categoryResults: SearchMatch[],
    selectedExamples: SelectedExample[],
    recipientEmail: string,
    relationship: string
  ): ExampleSelectionResult['stats'] {
    const totalCandidates = directResults.length + categoryResults.length;

    // Count examples matching relationship
    const relationshipMatch = selectedExamples.filter(e =>
      e.metadata.relationship === relationship
    ).length;

    // Count examples from direct correspondence
    const directCorrespondence = selectedExamples.filter(e =>
      e.metadata.recipientEmail === recipientEmail
    ).length;

    // Calculate average scores
    const avgSemanticScore = selectedExamples.length > 0
      ? selectedExamples.reduce((sum, e) => sum + e.scores.semantic, 0) / selectedExamples.length
      : 0;

    const avgStyleScore = selectedExamples.length > 0
      ? selectedExamples.reduce((sum, e) => sum + e.scores.style, 0) / selectedExamples.length
      : 0;

    const avgCombinedScore = selectedExamples.length > 0
      ? selectedExamples.reduce((sum, e) => sum + e.scores.combined, 0) / selectedExamples.length
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
      avgSemanticScore,
      avgStyleScore,
      avgCombinedScore,
      avgAge
    };
  }
}
