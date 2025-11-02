import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';

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

  constructor() {
    const url = process.env.QDRANT_URL!;
    const apiKey = process.env.QDRANT_API_KEY;

    this.client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
    });
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

  async searchSimilar(params: VectorSearchParams): Promise<EmailVector[]> {
    await this.initialize();

    const collection = params.collectionName || SENT_COLLECTION;
    const limit = params.limit || parseInt(process.env.VECTOR_SEARCH_LIMIT || '50');
    const scoreThreshold = params.scoreThreshold || parseFloat(process.env.VECTOR_SCORE_THRESHOLD || '0.3');

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

      return results.map(result => ({
        id: (result.payload as any).originalId || String(result.id),
        vector: [], // Not returning vectors to save memory
        metadata: result.payload as unknown as EmailMetadata,
        score: result.score
      }));
    } catch (error) {
      throw new Error(`Vector search failed: ${error}`);
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