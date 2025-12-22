// Core embedding and vector search services (PostgreSQL + Vectra)
export { EmbeddingService, embeddingService, type EmbeddingResult, type BatchEmbeddingResult } from './embedding-service';
export { StyleEmbeddingService, styleEmbeddingService } from './style-embedding-service';
export { VectorSearchService } from './vector-search-service';
export { StyleClusteringService } from './style-clustering-service';

// Create singletons (requires pool from server.ts)
import { pool } from '../db';
import { VectorSearchService } from './vector-search-service';
import { StyleClusteringService } from './style-clustering-service';

export const vectorSearchService = new VectorSearchService(pool);
export const styleClusteringService = new StyleClusteringService(pool);

// Export all types from types.ts
export * from './types';