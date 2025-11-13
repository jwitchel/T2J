/**
 * Style Embedding Service
 *
 * Purpose: Generates style-aware embeddings for dual-vector architecture
 *
 * IMPLEMENTATION: AnnaWegmann/Style-Embedding (768d, style-specific model)
 * - Paper: https://aclanthology.org/2022.repl4nlp-1.26/
 * - Trained specifically for capturing writing style features
 * - Content-independent style analysis
 * - Converted to ONNX format and stored locally in ./models/AnnaWegmann/Style-Embedding
 *
 * Key Features:
 * - Focuses on stylistic patterns independent of content
 * - Captures tone, formality, sentence structure, vocabulary choice
 * - 768-dimensional embeddings
 * - Complementary to semantic embeddings (all-MiniLM-L6-v2)
 *
 * Dual-Vector Architecture:
 * - Semantic Vector (384d): Content/topic similarity
 * - Style Vector (768d): Writing style/tone similarity
 * - Combined score: 40% semantic + 60% style
 *
 * Model Conversion:
 * - Original PyTorch model converted to ONNX using Optimum
 * - Stored locally to avoid runtime conversion overhead
 * - See server/scripts/convert-style-model.sh for conversion process
 *
 * Following pattern: EmbeddingService structure
 * - Two-phase initialization with initPromise
 * - Private _initialize method
 * - Public embedText and embedBatch methods
 * - Singleton export
 */

import * as ort from 'onnxruntime-node';
import { StyleEmbeddingResult, BatchEmbeddingResult, EmbeddingError } from './types';
import path from 'path';
import { BPETokenizer } from './bpe-tokenizer';

export class StyleEmbeddingService {
  private tokenizer: BPETokenizer | null = null;
  private session: ort.InferenceSession | null = null;
  // Using locally-converted AnnaWegmann/Style-Embedding model
  // This is a style-specific model trained for content-independent style analysis
  private modelPath = path.join(__dirname, '../../../models/AnnaWegmann/Style-Embedding');
  private onnxPath = path.join(__dirname, '../../../models/AnnaWegmann/Style-Embedding/onnx/model.onnx');
  private dimensions = 768;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the style embedding model
   *
   * Purpose: Lazy loading with promise caching to prevent duplicate initialization
   * Following pattern: Same as EmbeddingService
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    await this.initPromise;
  }

  /**
   * Private initialization method
   * @private
   */
  private async _initialize(): Promise<void> {
    try {
      console.log(`[StyleEmbedding] Loading AnnaWegmann/Style-Embedding model...`);
      console.log(`[StyleEmbedding] Model path: ${this.modelPath}`);

      // Initialize BPE tokenizer
      console.log(`[StyleEmbedding] Loading BPE tokenizer...`);
      const vocabPath = path.join(this.modelPath, 'vocab.json');
      const mergesPath = path.join(this.modelPath, 'merges.txt');
      this.tokenizer = new BPETokenizer(vocabPath, mergesPath);
      console.log(`[StyleEmbedding] BPE tokenizer loaded: ${this.tokenizer.getVocabSize()} tokens`);

      // Load ONNX model directly with onnxruntime-node
      console.log(`[StyleEmbedding] Loading ONNX model...`);
      this.session = await ort.InferenceSession.create(this.onnxPath);

      this.isInitialized = true;
      console.log(`[StyleEmbedding] Model loaded successfully (${this.dimensions}d)`);
      console.log(`[StyleEmbedding] Using content-independent style analysis with BPE tokenization`);
      console.log(`[StyleEmbedding] Model inputs: ${this.session.inputNames.join(', ')}`);
      console.log(`[StyleEmbedding] Model outputs: ${this.session.outputNames.join(', ')}`);
    } catch (error: unknown) {
      this.initPromise = null;
      throw new EmbeddingError(`Failed to initialize style embedding model: ${error}`);
    }
  }


  /**
   * Generate style embedding for text
   *
   * Purpose: Creates a 768-dimensional style vector focusing on writing style
   * @param text Input text to embed
   * @returns Style embedding result with vector and metadata
   */
  async embedText(text: string): Promise<StyleEmbeddingResult> {
    await this.initialize();

    if (!text || text.trim().length === 0) {
      throw new EmbeddingError('Cannot embed empty text');
    }

    if (!this.session || !this.tokenizer) {
      throw new EmbeddingError('Model not initialized');
    }

    try {
      const startTime = Date.now();

      // Tokenize using BPE
      const { inputIds, attentionMask } = this.tokenizer.encode(text, 128);

      // Convert to BigInt64Array for ONNX Runtime
      const inputIdsBigInt = new BigInt64Array(inputIds.map(x => BigInt(x)));
      const attentionMaskBigInt = new BigInt64Array(attentionMask.map(x => BigInt(x)));

      // Create ONNX tensors
      const inputIdsTensor = new ort.Tensor('int64', inputIdsBigInt, [1, 128]);
      const attentionMaskTensor = new ort.Tensor('int64', attentionMaskBigInt, [1, 128]);

      // Run inference
      const results = await this.session.run({
        input_ids: inputIdsTensor,
        attention_mask: attentionMaskTensor
      });

      // Get sentence embedding (should be pre-pooled by the model)
      const sentenceEmbedding = results['sentence_embedding'];

      if (!sentenceEmbedding) {
        // Fallback to manual pooling if sentence_embedding not available
        const tokenEmbeddings = results['token_embeddings'];
        if (!tokenEmbeddings) {
          throw new EmbeddingError('No embeddings found in model output');
        }

        // Manual mean pooling over token dimension
        const [, seqLen, hiddenDim] = tokenEmbeddings.dims as number[];
        const vector = new Array(hiddenDim).fill(0);
        const data = tokenEmbeddings.data as Float32Array;

        for (let i = 0; i < seqLen; i++) {
          for (let j = 0; j < hiddenDim; j++) {
            vector[j] += data[i * hiddenDim + j];
          }
        }

        // Normalize by sequence length
        for (let j = 0; j < hiddenDim; j++) {
          vector[j] /= seqLen;
        }

        // L2 normalization
        const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        for (let j = 0; j < hiddenDim; j++) {
          vector[j] /= norm;
        }

        return {
          vector,
          dimension: this.dimensions,
          processingTime: Date.now() - startTime
        };
      }

      // Use pre-pooled sentence embedding
      const vector = Array.from(sentenceEmbedding.data as Float32Array);

      return {
        vector,
        dimension: this.dimensions,
        processingTime: Date.now() - startTime
      };
    } catch (error: unknown) {
      throw new EmbeddingError(`Style embedding generation failed: ${error}`);
    }
  }

  /**
   * Generate style embeddings for multiple texts
   *
   * Purpose: Batch processing with error handling per item
   * Following pattern: Same as EmbeddingService.embedBatch
   *
   * @param texts Array of texts to embed
   * @param options Batch processing options
   * @returns Batch embedding result with successes and errors
   */
  async embedBatch(
    texts: string[],
    options: {
      batchSize?: number;
      onProgress?: (processed: number, total: number) => void;
    } = {}
  ): Promise<BatchEmbeddingResult> {
    await this.initialize();

    const batchSize = options.batchSize || parseInt(process.env.EMBEDDING_BATCH_SIZE || '32');
    const embeddings: StyleEmbeddingResult[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    const startTime = Date.now();

    // Process in batches to avoid memory issues
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchPromises = batch.map(async (text, batchIndex) => {
        const globalIndex = i + batchIndex;
        try {
          const result = await this.embedText(text);
          return { index: globalIndex, result };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            index: globalIndex,
            error: errorMessage
          });
          return { index: globalIndex, result: null };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      // Collect successful results
      batchResults.forEach(({ result }) => {
        if (result) {
          embeddings.push(result);
        }
      });

      // Progress callback
      if (options.onProgress) {
        options.onProgress(Math.min(i + batchSize, texts.length), texts.length);
      }
    }

    return {
      embeddings,
      errors,
      totalTimeMs: Date.now() - startTime
    };
  }

  /**
   * Compare two style vectors using cosine similarity
   *
   * Purpose: Utility method for style similarity comparison
   * @param vectorA First style vector
   * @param vectorB Second style vector
   * @returns Cosine similarity score (0-1)
   */
  cosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
      throw new EmbeddingError('Vectors must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get model information
   *
   * Purpose: Returns model metadata for logging and debugging
   * @returns Model information
   */
  getModelInfo(): { name: string; dimensions: number; initialized: boolean } {
    return {
      name: 'AnnaWegmann/Style-Embedding',
      dimensions: this.dimensions,
      initialized: this.isInitialized
    };
  }
}

// Singleton export
export const styleEmbeddingService = new StyleEmbeddingService();
