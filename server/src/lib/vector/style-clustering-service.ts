/**
 * Style Clustering Service
 *
 * Purpose: Group emails by writing style (formal, neutral, casual) for pattern analysis
 * Uses k-means clustering on style vectors to identify distinct writing styles
 *
 * Following patterns from PersonService:
 * - Two-phase initialization
 * - Private helper methods with underscore prefix
 * - Well-defined parameter/result types
 * - Custom error hierarchy
 * - Transaction support for database operations
 */

import { Pool } from 'pg';
import { withTransaction } from '../db/transaction-utils';
import { styleEmbeddingService } from './style-embedding-service';
import {
  StyleClusterParams,
  StyleCluster,
  StyleClusterResult,
  ClusteringError
} from './types';

export class StyleClusteringService {
  private initialized = false;
  private readonly defaultClusterCount = 3;  // formal, neutral, casual
  private readonly defaultClusterNames = ['formal', 'neutral', 'casual'];

  constructor(private pool: Pool) {}

  // ============================================================================
  // Public API Methods
  // ============================================================================

  /**
   * Initialize the style clustering service
   *
   * Purpose: Lazy initialization of style embedding service
   * Following pattern: Two-phase init
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await styleEmbeddingService.initialize();
    this.initialized = true;
  }

  /**
   * Cluster emails by writing style
   *
   * Purpose: Group emails into style-based clusters for pattern analysis
   * Following pattern: Params/Result structure
   *
   * @param params Clustering parameters
   * @returns Clustering result with clusters and metadata
   */
  async clusterEmails(params: StyleClusterParams): Promise<StyleClusterResult> {
    await this.initialize();

    try {
      if (params.emails.length === 0) {
        return {
          success: true,
          clusters: []
        };
      }

      // Use k-means clustering on style vectors
      const clusterCount = params.clusterCount || this.defaultClusterCount;
      const clusters = this._kMeansClustering(params.emails, clusterCount);

      // Save clusters to database
      await this._saveClusters(params.userId, params.relationship, clusters);

      return {
        success: true,
        clusters
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        clusters: [],
        error: errorMessage
      };
    }
  }

  /**
   * Get existing clusters for user and relationship
   *
   * Purpose: Load previously computed clusters from database
   *
   * @param userId User ID
   * @param relationship Relationship type
   * @returns Existing clusters or empty array
   */
  async getClusters(userId: string, relationship: string): Promise<StyleCluster[]> {
    try {
      const result = await this.pool.query(`
        SELECT id, cluster_name, centroid_vector, email_count
        FROM style_clusters
        WHERE user_id = $1 AND relationship_type = $2
        ORDER BY cluster_name
      `, [userId, relationship]);

      if (result.rows.length === 0) {
        return [];
      }

      // Fetch email IDs for each cluster
      const clusters: StyleCluster[] = [];
      for (const row of result.rows) {
        const emailIdsResult = await this.pool.query(`
          SELECT email_id, style_score
          FROM email_style_mapping
          WHERE style_cluster_id = $1 AND email_type = 'sent'
        `, [row.id]);

        clusters.push({
          id: row.id,
          name: row.cluster_name,
          centroid: row.centroid_vector,
          emailIds: emailIdsResult.rows.map(r => r.email_id),
          avgScore: emailIdsResult.rows.length > 0
            ? emailIdsResult.rows.reduce((sum: number, r: any) => sum + r.style_score, 0) / emailIdsResult.rows.length
            : 0
        });
      }

      return clusters;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to get clusters: ${errorMessage}`);
      return [];
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * K-means clustering on style vectors
   *
   * Purpose: Group emails into k clusters based on style similarity
   * @private
   */
  private _kMeansClustering(
    emails: Array<{ id: string; styleVector: number[]; metadata: any }>,
    k: number
  ): StyleCluster[] {
    // Simple k-means implementation
    // 1. Initialize centroids using k-means++
    const centroids = this._initializeCentroids(emails.map(e => e.styleVector), k);

    // 2. Iterate until convergence
    let assignments = new Array(emails.length).fill(0);
    let changed = true;
    let iterations = 0;
    const maxIterations = 100;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      // Assign each email to nearest centroid
      for (let i = 0; i < emails.length; i++) {
        const newAssignment = this._findNearestCentroid(emails[i].styleVector, centroids);
        if (newAssignment !== assignments[i]) {
          assignments[i] = newAssignment;
          changed = true;
        }
      }

      // Update centroids
      for (let c = 0; c < k; c++) {
        const clusterVectors = emails
          .filter((_, idx) => assignments[idx] === c)
          .map(e => e.styleVector);

        if (clusterVectors.length > 0) {
          centroids[c] = this._calculateCentroid(clusterVectors);
        }
      }
    }

    // Build cluster results
    const clusters: StyleCluster[] = centroids.map((centroid, idx) => {
      const clusterEmails = emails.filter((_, i) => assignments[i] === idx);
      const avgScore = clusterEmails.length > 0
        ? clusterEmails.reduce((sum, email) => {
            return sum + styleEmbeddingService.cosineSimilarity(email.styleVector, centroid);
          }, 0) / clusterEmails.length
        : 0;

      return {
        id: `cluster-${idx}`,
        name: this.defaultClusterNames[idx] || `cluster-${idx}`,
        centroid,
        emailIds: clusterEmails.map(e => e.id),
        avgScore
      };
    });

    // Sort by size (largest cluster first = most common style)
    return clusters.sort((a, b) => b.emailIds.length - a.emailIds.length);
  }

  /**
   * Initialize centroids using k-means++ algorithm
   *
   * Purpose: Smart initialization to avoid poor local minima
   * @private
   */
  private _initializeCentroids(vectors: number[][], k: number): number[][] {
    if (vectors.length === 0) {
      throw new ClusteringError('Cannot initialize centroids: empty vector list');
    }

    const centroids: number[][] = [];

    // First centroid: random
    centroids.push(vectors[Math.floor(Math.random() * vectors.length)]);

    // Remaining centroids: weighted by distance to existing centroids
    for (let i = 1; i < k; i++) {
      const distances = vectors.map(v => {
        return Math.min(...centroids.map(c =>
          1 - styleEmbeddingService.cosineSimilarity(v, c)
        ));
      });

      const sum = distances.reduce((a, b) => a + b, 0);
      let random = Math.random() * sum;

      for (let j = 0; j < distances.length; j++) {
        random -= distances[j];
        if (random <= 0) {
          centroids.push(vectors[j]);
          break;
        }
      }
    }

    return centroids;
  }

  /**
   * Find nearest centroid for vector
   *
   * Purpose: Assign vector to closest cluster
   * @private
   */
  private _findNearestCentroid(vector: number[], centroids: number[][]): number {
    let maxSim = -1;
    let nearest = 0;

    centroids.forEach((centroid, idx) => {
      const sim = styleEmbeddingService.cosineSimilarity(vector, centroid);
      if (sim > maxSim) {
        maxSim = sim;
        nearest = idx;
      }
    });

    return nearest;
  }

  /**
   * Calculate centroid of vectors
   *
   * Purpose: Compute mean vector for cluster
   * @private
   */
  private _calculateCentroid(vectors: number[][]): number[] {
    if (vectors.length === 0) {
      throw new ClusteringError('Cannot calculate centroid: empty vector list');
    }

    const dim = vectors[0].length;
    const centroid = new Array(dim).fill(0);

    vectors.forEach(v => {
      v.forEach((val, i) => {
        centroid[i] += val;
      });
    });

    return centroid.map(val => val / vectors.length);
  }

  /**
   * Save clusters to database
   *
   * Purpose: Persist cluster assignments with transaction support
   * Following pattern: Using withTransaction utility
   * @private
   */
  private async _saveClusters(
    userId: string,
    relationship: string,
    clusters: StyleCluster[]
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      // Delete existing clusters for this user/relationship
      await client.query(
        'DELETE FROM style_clusters WHERE user_id = $1 AND relationship_type = $2',
        [userId, relationship]
      );

      // Insert new clusters
      for (const cluster of clusters) {
        const result = await client.query(`
          INSERT INTO style_clusters (user_id, relationship_type, cluster_name, centroid_vector, email_count)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `, [userId, relationship, cluster.name, cluster.centroid, cluster.emailIds.length]);

        const clusterId = result.rows[0].id;

        // Map emails to clusters
        if (cluster.emailIds.length > 0) {
          const values: string[] = [];
          const params: unknown[] = [];
          let paramCount = 0;

          cluster.emailIds.forEach((emailId) => {
            paramCount++;
            params.push(emailId);
            paramCount++;
            params.push(clusterId);
            paramCount++;
            params.push(cluster.avgScore);

            values.push(`($${paramCount - 2}, 'sent', $${paramCount - 1}, $${paramCount})`);
          });

          await client.query(`
            INSERT INTO email_style_mapping (email_id, email_type, style_cluster_id, style_score)
            VALUES ${values.join(', ')}
            ON CONFLICT (email_id, email_type)
            DO UPDATE SET style_cluster_id = EXCLUDED.style_cluster_id, style_score = EXCLUDED.style_score
          `, params);
        }
      }

      console.log(`[StyleClustering] Saved ${clusters.length} clusters for ${userId}/${relationship}`);
    });
  }
}

// Singleton export moved to index.ts to avoid circular dependencies in tests
