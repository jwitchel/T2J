import { pipeline } from '@xenova/transformers';

// Note: Xenova transformers configuration can be set via environment variables
// or during pipeline initialization

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dimensions: number;
}

export interface BatchEmbeddingResult {
  embeddings: EmbeddingResult[];
  errors: Array<{ index: number; error: string }>;
  totalTime: number;
}

export class EmbeddingService {
  private pipeline: any = null;
  private modelName = 'Xenova/all-MiniLM-L6-v2';
  private dimensions = 384;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    await this.initPromise;
  }

  private async _initialize(): Promise<void> {
    try {
      this.pipeline = await pipeline('feature-extraction', this.modelName);
      
      this.isInitialized = true;
    } catch (error: unknown) {
      this.initPromise = null;
      throw new Error(`Failed to initialize embedding model: ${error}`);
    }
  }

  async embedText(text: string): Promise<EmbeddingResult> {
    await this.initialize();
    
    if (!text || text.trim().length === 0) {
      throw new Error('Cannot embed empty text');
    }

    try {
      // Truncate text if too long (model has token limits)
      const maxLength = 512;
      const truncatedText = text.length > maxLength 
        ? text.substring(0, maxLength) + '...' 
        : text;

      // Generate embeddings
      const output = await this.pipeline(truncatedText, {
        pooling: 'mean',
        normalize: true
      });

      // Convert tensor to array
      const vector = Array.from(output.data) as number[];

      return {
        vector,
        model: this.modelName,
        dimensions: this.dimensions
      };
    } catch (error: unknown) {
      throw new Error(`Embedding generation failed: ${error}`);
    }
  }

  async embedBatch(
    texts: string[], 
    options: {
      batchSize?: number;
      onProgress?: (processed: number, total: number) => void;
    } = {}
  ): Promise<BatchEmbeddingResult> {
    await this.initialize();

    const batchSize = options.batchSize || parseInt(process.env.EMBEDDING_BATCH_SIZE || '32');
    const embeddings: EmbeddingResult[] = [];
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
          errors.push({ 
            index: globalIndex, 
            error: error instanceof Error ? error.message : String(error) 
          });
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      // Add successful embeddings in order
      batchResults.forEach(res => {
        if (res && res.result) {
          embeddings[res.index] = res.result;
        }
      });

      // Report progress
      if (options.onProgress) {
        options.onProgress(Math.min(i + batchSize, texts.length), texts.length);
      }
    }

    return {
      embeddings: embeddings.filter(e => e !== undefined),
      errors,
      totalTime: Date.now() - startTime
    };
  }

  async compareTexts(text1: string, text2: string): Promise<number> {
    const [embedding1, embedding2] = await Promise.all([
      this.embedText(text1),
      this.embedText(text2)
    ]);

    return this.cosineSimilarity(embedding1.vector, embedding2.vector);
  }

  /**
   * Calculate cosine similarity between two vectors
   * @returns similarity score between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
   */
  cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same dimensions');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (norm1 * norm2);
  }

  // Utility method to reduce embedding dimensions if needed
  reduceDimensions(vector: number[], targetDimensions: number): number[] {
    if (vector.length <= targetDimensions) {
      return vector;
    }

    // Simple averaging approach for dimension reduction
    const ratio = vector.length / targetDimensions;
    const reduced: number[] = [];

    for (let i = 0; i < targetDimensions; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.floor((i + 1) * ratio);
      let sum = 0;
      
      for (let j = start; j < end && j < vector.length; j++) {
        sum += vector[j];
      }
      
      reduced.push(sum / (end - start));
    }

    return reduced;
  }

  getModelInfo() {
    return {
      model: this.modelName,
      dimensions: this.dimensions,
      initialized: this.isInitialized
    };
  }
}

// Singleton instance
export const embeddingService = new EmbeddingService();