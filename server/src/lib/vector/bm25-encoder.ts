/**
 * BM25 Encoder for Sparse Vector Generation
 *
 * Purpose: Converts text to sparse vectors using BM25 (Best Matching 25) algorithm
 * for keyword-based similarity search.
 *
 * BM25 is a probabilistic ranking function that scores documents based on term
 * frequency and inverse document frequency. It's particularly effective for:
 * - Exact keyword matching
 * - Technical terminology
 * - Proper nouns and names
 * - Domain-specific language
 *
 * Usage:
 * ```typescript
 * const encoder = new BM25Encoder();
 * await encoder.initialize(userSentEmails);
 * const sparseVector = encoder.encode(incomingEmail);
 * ```
 */

import {
  BM25Config,
  BM25EncoderState,
  SparseVector,
  BM25EncoderError
} from './types';

export class BM25Encoder {
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private docCount: number = 0;
  private avgDocLength: number = 0;
  private config: Required<BM25Config>;
  private initialized = false;

  constructor(config?: BM25Config) {
    // Load config with defaults following LLMClient pattern
    this.config = {
      k1: config?.k1 ?? parseFloat(process.env.BM25_K1 || '1.5'),
      b: config?.b ?? parseFloat(process.env.BM25_B || '0.75'),
      avgDocLength: config?.avgDocLength ?? 0
    };
  }

  /**
   * Initialize BM25 encoder by fitting on document corpus
   *
   * Purpose: Builds vocabulary and calculates IDF scores from training documents
   *
   * @param documents - Array of text documents (user's sent emails)
   * @throws {BM25EncoderError} If documents array is empty or invalid
   */
  async initialize(documents: string[]): Promise<void> {
    if (this.initialized) return;

    try {
      if (!documents || documents.length === 0) {
        throw new BM25EncoderError(
          'Cannot initialize BM25 encoder with empty documents array',
          'INVALID_INPUT'
        );
      }

      // Tokenize all documents
      const tokenizedDocs = documents.map(doc => this.tokenize(doc));

      // Build vocabulary and calculate stats
      this.buildVocabulary(tokenizedDocs);

      // Calculate IDF for each term
      this.calculateIDFs(tokenizedDocs);

      // Calculate average document length
      this.avgDocLength = this.calculateAvgDocLength(tokenizedDocs);
      this.config.avgDocLength = this.avgDocLength;

      this.docCount = documents.length;
      this.initialized = true;

    } catch (error: any) {
      if (error instanceof BM25EncoderError) {
        throw error;
      }
      throw this.handleError(error, 'initialization');
    }
  }

  /**
   * Encode text to sparse vector using BM25
   *
   * Purpose: Converts text to sparse vector representation for keyword matching
   *
   * @param text - Input text to encode
   * @returns Sparse vector with indices and values
   * @throws {BM25EncoderError} If encoder not initialized or text is invalid
   */
  encode(text: string): SparseVector {
    if (!this.initialized) {
      throw new BM25EncoderError(
        'BM25 encoder must be initialized before encoding',
        'NOT_INITIALIZED'
      );
    }

    try {
      const tokens = this.tokenize(text);
      const indices: number[] = [];
      const values: number[] = [];

      // Calculate BM25 score for each term in vocabulary
      tokens.forEach(token => {
        const idx = this.vocabulary.get(token);
        if (idx !== undefined) {
          const score = this.calculateBM25Score(token, tokens);
          if (score > 0) {
            indices.push(idx);
            values.push(score);
          }
        }
      });

      // Sort by indices for consistency
      const sorted = this.sortSparseVector(indices, values);

      return {
        indices: sorted.indices,
        values: sorted.values
      };

    } catch (error: any) {
      if (error instanceof BM25EncoderError) {
        throw error;
      }
      throw this.handleError(error, 'encoding');
    }
  }

  /**
   * Get encoder state for persistence
   *
   * Purpose: Allows saving encoder state to disk for reuse
   */
  getState(): BM25EncoderState {
    if (!this.initialized) {
      throw new BM25EncoderError(
        'Cannot get state of uninitialized encoder',
        'NOT_INITIALIZED'
      );
    }

    return {
      vocabulary: this.vocabulary,
      idf: this.idf,
      docCount: this.docCount,
      avgDocLength: this.avgDocLength
    };
  }

  /**
   * Load encoder state from persistence
   *
   * Purpose: Restores encoder from saved state
   */
  loadState(state: BM25EncoderState): void {
    this.vocabulary = state.vocabulary;
    this.idf = state.idf;
    this.docCount = state.docCount;
    this.avgDocLength = state.avgDocLength;
    this.config.avgDocLength = state.avgDocLength;
    this.initialized = true;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Tokenize text into terms
   * @private
   */
  private tokenize(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }

    try {
      // Convert to lowercase and split on word boundaries
      const tokens = text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
        .split(/\s+/)              // Split on whitespace
        .filter(token => token.length > 0); // Remove empty strings

      return tokens;

    } catch (error: any) {
      throw new BM25EncoderError(
        `Tokenization failed: ${error.message}`,
        'TOKENIZATION_FAILED'
      );
    }
  }

  /**
   * Build vocabulary from tokenized documents
   * @private
   */
  private buildVocabulary(tokenizedDocs: string[][]): void {
    let vocabIndex = 0;

    tokenizedDocs.forEach(tokens => {
      // Use Set to get unique tokens per document
      const uniqueTokens = new Set(tokens);

      uniqueTokens.forEach(token => {
        if (!this.vocabulary.has(token)) {
          this.vocabulary.set(token, vocabIndex);
          vocabIndex++;
        }
      });
    });
  }

  /**
   * Calculate IDF (Inverse Document Frequency) for all terms
   * @private
   */
  private calculateIDFs(tokenizedDocs: string[][]): void {
    const N = tokenizedDocs.length;

    // Count document frequency for each term
    const df = new Map<string, number>();

    tokenizedDocs.forEach(tokens => {
      const uniqueTokens = new Set(tokens);
      uniqueTokens.forEach(token => {
        df.set(token, (df.get(token) || 0) + 1);
      });
    });

    // Calculate IDF for each term
    // IDF(term) = log((N - df + 0.5) / (df + 0.5) + 1)
    df.forEach((docFreq, term) => {
      const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
      this.idf.set(term, idf);
    });
  }

  /**
   * Calculate average document length
   * @private
   */
  private calculateAvgDocLength(tokenizedDocs: string[][]): number {
    if (tokenizedDocs.length === 0) return 0;

    const totalLength = tokenizedDocs.reduce((sum, tokens) => sum + tokens.length, 0);
    return totalLength / tokenizedDocs.length;
  }

  /**
   * Calculate term frequency in document
   * @private
   */
  private calculateTermFrequency(term: string, docTokens: string[]): number {
    return docTokens.filter(t => t === term).length;
  }

  /**
   * Calculate BM25 score for a term in document
   *
   * BM25 formula:
   * score = IDF(term) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)))
   *
   * where:
   * - IDF = inverse document frequency
   * - tf = term frequency in document
   * - k1 = term frequency saturation parameter (default: 1.5)
   * - b = document length normalization parameter (default: 0.75)
   * - docLen = current document length
   * - avgDocLen = average document length in corpus
   *
   * @private
   */
  private calculateBM25Score(term: string, docTokens: string[]): number {
    const idf = this.idf.get(term);
    if (idf === undefined) return 0;

    const tf = this.calculateTermFrequency(term, docTokens);
    if (tf === 0) return 0;

    const docLen = docTokens.length;
    const { k1, b, avgDocLength } = this.config;

    // BM25 formula
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLen / avgDocLength));
    const score = idf * (numerator / denominator);

    return score;
  }

  /**
   * Sort sparse vector by indices
   *
   * Purpose: Ensures consistent ordering for efficient storage and comparison
   * @private
   */
  private sortSparseVector(
    indices: number[],
    values: number[]
  ): { indices: number[]; values: number[] } {
    // Create array of [index, value] pairs
    const pairs = indices.map((idx, i) => ({ idx, val: values[i] }));

    // Sort by index
    pairs.sort((a, b) => a.idx - b.idx);

    // Extract sorted indices and values
    return {
      indices: pairs.map(p => p.idx),
      values: pairs.map(p => p.val)
    };
  }

  /**
   * Handle errors consistently
   * @private
   */
  private handleError(error: any, context: string): never {
    const message = error.message || String(error);
    throw new BM25EncoderError(
      `BM25 encoder ${context} failed: ${message}`,
      'UNKNOWN'
    );
  }
}
