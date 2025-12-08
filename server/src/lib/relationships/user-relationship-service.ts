import { Pool } from 'pg';
import { pool } from '../db';
import { personService, PersonServiceError, PersonWithDetails } from './person-service';
import { RelationshipDetector } from './relationship-detector';

export interface UserRelationship {
  id: string;
  user_id: string;
  relationship_type: string;
  display_name: string;
  is_active: boolean;
  is_system_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRelationshipParams {
  relationshipType: string;
  displayName: string;
}

export interface UpdateRelationshipParams {
  displayName?: string;
  isActive?: boolean;
}

export interface AssignRelationshipParams {
  personId: string;
  relationshipType: string;
  isPrimary?: boolean;
  userSet?: boolean;
  confidence?: number;
}

export class UserRelationshipService {
  public pool: Pool;
  private relationshipDetector: RelationshipDetector;

  constructor(customPool?: Pool) {
    this.pool = customPool || pool;
    this.relationshipDetector = new RelationshipDetector();
  }

  async initialize(): Promise<void> {
    await this.relationshipDetector.initialize();
  }

  async getUserRelationships(userId: string): Promise<UserRelationship[]> {
    const result = await this.pool.query(
      `SELECT id, user_id, relationship_type, display_name, is_active, is_system_default, created_at, updated_at
       FROM user_relationships
       WHERE user_id = $1
       ORDER BY display_name ASC`,
      [userId]
    );
    
    return result.rows;
  }
  
  async createRelationship(userId: string, params: CreateRelationshipParams): Promise<UserRelationship> {
    // Validate inputs
    if (!params.relationshipType || !params.displayName) {
      throw new PersonServiceError('Relationship type and display name are required', 'VALIDATION_ERROR');
    }
    
    // Check if relationship type already exists
    const existing = await this.pool.query(
      `SELECT id FROM user_relationships WHERE user_id = $1 AND relationship_type = $2`,
      [userId, params.relationshipType]
    );
    
    if (existing.rows.length > 0) {
      throw new PersonServiceError(`Relationship type ${params.relationshipType} already exists`, 'DUPLICATE_RELATIONSHIP');
    }
    
    const result = await this.pool.query(
      `INSERT INTO user_relationships (user_id, relationship_type, display_name, is_active, is_system_default, created_at, updated_at)
       VALUES ($1, $2, $3, true, false, NOW(), NOW())
       RETURNING *`,
      [userId, params.relationshipType, params.displayName]
    );
    
    return result.rows[0];
  }
  
  async updateRelationship(userId: string, relationshipType: string, updates: UpdateRelationshipParams): Promise<UserRelationship> {
    const setClauses: string[] = [];
    const values: any[] = [userId, relationshipType];
    let paramCount = 2;
    
    if (updates.displayName !== undefined) {
      paramCount++;
      setClauses.push(`display_name = $${paramCount}`);
      values.push(updates.displayName);
    }
    
    if (updates.isActive !== undefined) {
      paramCount++;
      setClauses.push(`is_active = $${paramCount}`);
      values.push(updates.isActive);
    }
    
    if (setClauses.length === 0) {
      throw new PersonServiceError('No updates provided', 'VALIDATION_ERROR');
    }
    
    setClauses.push('updated_at = NOW()');
    
    const result = await this.pool.query(
      `UPDATE user_relationships 
       SET ${setClauses.join(', ')}
       WHERE user_id = $1 AND relationship_type = $2 AND is_system_default = false
       RETURNING *`,
      values
    );
    
    if (result.rows.length === 0) {
      throw new PersonServiceError('Relationship not found or is a system default', 'NOT_FOUND');
    }
    
    return result.rows[0];
  }
  
  async deleteRelationship(userId: string, relationshipType: string): Promise<void> {
    // Check if it's a system default
    const check = await this.pool.query(
      `SELECT is_system_default FROM user_relationships WHERE user_id = $1 AND relationship_type = $2`,
      [userId, relationshipType]
    );
    
    if (check.rows.length === 0) {
      throw new PersonServiceError('Relationship not found', 'NOT_FOUND');
    }
    
    if (check.rows[0].is_system_default) {
      throw new PersonServiceError('Cannot delete system default relationships', 'FORBIDDEN');
    }
    
    // Delete the relationship (will cascade to person_relationships)
    await this.pool.query(
      `DELETE FROM user_relationships WHERE user_id = $1 AND relationship_type = $2`,
      [userId, relationshipType]
    );
  }
  
  async assignPersonToRelationship(userId: string, params: AssignRelationshipParams): Promise<PersonWithDetails> {
    // Verify person exists and belongs to user
    const person = await personService.getPersonById(params.personId, userId);
    if (!person) {
      throw new PersonServiceError('Person not found', 'NOT_FOUND');
    }
    
    // Verify relationship type exists
    const relCheck = await this.pool.query(
      `SELECT relationship_type FROM user_relationships 
       WHERE user_id = $1 AND relationship_type = $2 AND is_active = true`,
      [userId, params.relationshipType]
    );
    
    if (relCheck.rows.length === 0) {
      throw new PersonServiceError(`Invalid relationship type: ${params.relationshipType}`, 'INVALID_RELATIONSHIP');
    }
    
    // If setting as primary, unset other primary relationships
    if (params.isPrimary) {
      await this.pool.query(
        `UPDATE person_relationships 
         SET is_primary = false 
         WHERE person_id = $1 AND user_id = $2`,
        [params.personId, userId]
      );
    }
    
    // Insert or update the relationship
    await this.pool.query(
      `INSERT INTO person_relationships 
       (user_id, person_id, relationship_type, is_primary, user_set, confidence, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (user_id, person_id, relationship_type)
       DO UPDATE SET
         is_primary = EXCLUDED.is_primary,
         user_set = EXCLUDED.user_set,
         confidence = EXCLUDED.confidence,
         updated_at = NOW()`,
      [
        userId, 
        params.personId, 
        params.relationshipType, 
        params.isPrimary || false,
        params.userSet !== false, // Default to true
        params.confidence || 1.0
      ]
    );
    
    // Return updated person
    return await personService.getPersonById(params.personId, userId) as PersonWithDetails;
  }
  
  async getRelationshipSuggestions(userId: string, email: string): Promise<{ type: string; confidence: number; reason: string }[]> {
    // Use the detector to get a suggestion
    const detection = await this.relationshipDetector.detectRelationship({
      userId,
      recipientEmail: email
    });
    
    // Get all available relationship types
    const relationships = await this.getUserRelationships(userId);
    const activeRelationships = relationships.filter(r => r.is_active);
    
    // Build suggestions
    const suggestions = [];
    
    // Add the detected relationship as primary suggestion
    const detectedRel = activeRelationships.find(r => r.relationship_type === detection.relationship);
    if (detectedRel) {
      suggestions.push({
        type: detection.relationship,
        confidence: detection.confidence,
        reason: 'Based on email history and context'
      });
    }
    
    // Add other relationships as alternatives
    activeRelationships
      .filter(r => r.relationship_type !== detection.relationship)
      .forEach(rel => {
        suggestions.push({
          type: rel.relationship_type,
          confidence: 0.3,
          reason: 'Alternative option'
        });
      });
    
    return suggestions;
  }
}

// Export singleton instance - lazy initialization to avoid circular dependency
let _instance: UserRelationshipService | null = null;
export const userRelationshipService = {
  get instance(): UserRelationshipService {
    if (!_instance) {
      _instance = new UserRelationshipService();
    }
    return _instance;
  },
  get pool() {
    return this.instance.pool;
  },
  // Proxy methods to maintain backward compatibility
  async getAllRelationships(userId?: string): Promise<UserRelationship[]> {
    return this.instance.getUserRelationships(userId!);
  },
  async getRelationshipById(relationshipId: string): Promise<UserRelationship | null> {
    // Need to fetch all relationships to find by ID
    const allUsers = await this.instance.pool.query(
      'SELECT DISTINCT user_id FROM user_relationships'
    );
    for (const row of allUsers.rows) {
      const rels = await this.instance.getUserRelationships(row.user_id);
      const found = rels.find(r => r.id === relationshipId);
      if (found) return found;
    }
    return null;
  },
  async getRelationshipByType(userId: string, relationshipType: string): Promise<UserRelationship | null> {
    const all = await this.instance.getUserRelationships(userId);
    return all.find(r => r.relationship_type === relationshipType) || null;
  },
  async createRelationship(userId: string, relationshipType: string, displayName?: string): Promise<UserRelationship> {
    return this.instance.createRelationship(userId, {
      relationshipType,
      displayName: displayName || relationshipType
    });
  },
  async updateRelationship(relationshipId: string, updates: Partial<UserRelationship>): Promise<UserRelationship> {
    // Find the relationship first
    const rel = await this.getRelationshipById(relationshipId);
    if (!rel) throw new Error('Relationship not found');
    
    return this.instance.updateRelationship(rel.user_id, rel.relationship_type, {
      displayName: updates.display_name,
      isActive: updates.is_active
    });
  },
  async deleteRelationship(relationshipId: string): Promise<void> {
    // Find the relationship first
    const rel = await this.getRelationshipById(relationshipId);
    if (!rel) throw new Error('Relationship not found');
    
    return this.instance.deleteRelationship(rel.user_id, rel.relationship_type);
  },
  async getRelationshipSuggestions(): Promise<any[]> {
    return this.instance.getRelationshipSuggestions('', '');
  }
};