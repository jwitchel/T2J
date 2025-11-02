import { VectorStore, SENT_COLLECTION } from '../vector/qdrant-client';
import { EmbeddingService } from '../vector/embedding-service';
import { RelationshipService } from '../relationships/relationship-service';
import { RelationshipDetector } from '../relationships/relationship-detector';
import { withRetry } from './retry-utils';

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
  };
}

export class ExampleSelector {
  constructor(
    private vectorStore: VectorStore,
    private embeddingService: EmbeddingService,
    private relationshipService: RelationshipService,
    private relationshipDetector: RelationshipDetector
  ) {
    // Two-phase selection ensures good results without diversity weighting
  }
  
  async selectExamples(params: {
    userId: string;
    incomingEmail: string;
    recipientEmail: string;
    desiredCount?: number;
  }): Promise<ExampleSelectionResult> {
    // Step 1: Detect relationship for recipient
    const relationship = await this.relationshipDetector.detectRelationship({
      userId: params.userId,
      recipientEmail: params.recipientEmail
    });
    

    // Debug: Check what's in the vector store for this user
    await this.vectorStore.debugUserEmails(params.userId, 5, SENT_COLLECTION);
    
    // Step 2: Get relationship profile (for future use)
    await this.relationshipService.getRelationshipProfile(
      params.userId,
      relationship.relationship
    );

    // Step 3: Embed incoming email with retry
    // Defensive check: ensure incoming email is not empty
    const incomingEmailText = params.incomingEmail?.trim() || '';
    if (incomingEmailText.length === 0) {
      throw new Error('Cannot select examples: incoming email content is empty after all processing steps');
    }

    const { vector } = await withRetry(
      () => this.embeddingService.embedText(incomingEmailText)
    );
    
    // Step 4: Two-phase selection
    const desiredCount = params.desiredCount || parseInt(process.env.EXAMPLE_COUNT || '25');
    const maxDirectPercentage = parseFloat(process.env.DIRECT_EMAIL_MAX_PERCENTAGE || '0.6');
    const maxDirectEmails = Math.floor(desiredCount * maxDirectPercentage);
    
    // Phase 1: Search for direct correspondence with this specific recipient
    // These emails show how the writer specifically communicates with this person
    const directEmails = await withRetry(
      () => this.vectorStore.searchSimilar({
        userId: params.userId,
        queryVector: vector,
        recipientEmail: params.recipientEmail,  // Filter to this specific recipient
        limit: 50,  // Get more than we need to allow for selection
        scoreThreshold: 0,  // Get all results, sorted by similarity
        collectionName: SENT_COLLECTION  // Only search sent emails for tone training
      })
    );
    
    // Calculate how many direct emails to use (up to the maximum percentage)
    const directEmailsToUse = Math.min(directEmails.length, maxDirectEmails);
    const remainingSlots = desiredCount - directEmailsToUse;

    // Removed verbose logging - summary now in InboxProcessor

    // Phase 2: Search for same relationship category to fill remaining slots
    // These show the writer's general pattern for this type of relationship
    let categoryEmails: EmailVector[] = [];
    if (remainingSlots > 0) {
      categoryEmails = await withRetry(
        () => this.vectorStore.searchSimilar({
          userId: params.userId,
          queryVector: vector,
          relationship: relationship.relationship,  // Same relationship type
          limit: 100,  // Get plenty for selection
          scoreThreshold: 0,  // Get all results, sorted by similarity
          collectionName: SENT_COLLECTION  // Only search sent emails for tone training
        })
      );
      
      // Filter out any emails we already have from direct correspondence
      const directEmailIds = new Set(directEmails.map(e => e.id));
      categoryEmails = categoryEmails.filter(e => !directEmailIds.has(e.id));
      
    }
    
    // Combine the two sets, preserving similarity order within each phase
    const examples = [
      ...directEmails.slice(0, directEmailsToUse),
      ...categoryEmails.slice(0, remainingSlots)
    ];
    
    // Step 5: Use similarity-based selection
    // The two-phase approach already ensures we get relevant examples
    const selected = this.selectBySimilarity(examples, desiredCount);
    
    return {
      relationship: relationship.relationship,
      examples: selected,
      stats: {
        totalCandidates: directEmails.length + categoryEmails.length,
        relationshipMatch: selected.filter(e => 
          e.metadata.relationship?.type === relationship.relationship
        ).length,
        directCorrespondence: selected.filter(e => 
          e.metadata.recipientEmail === params.recipientEmail
        ).length
      }
    };
  }
  
  private selectBySimilarity(candidates: EmailVector[], count: number): SelectedExample[] {
    // Simple selection by similarity score
    // The vector search already orders by semantic similarity
    return candidates.slice(0, count).map(c => ({
      id: c.id,
      text: c.metadata.userReply,
      metadata: c.metadata,
      score: c.score || 0
    }));
  }
}