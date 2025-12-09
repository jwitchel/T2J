import { RelationshipType } from './types';

/**
 * User relationship service - provides relationship type information
 *
 * After migration 044, relationship types are defined by the RelationshipType enum.
 * This service provides backwards-compatible methods to access relationship type info.
 */

export interface UserRelationship {
  id: string;
  relationship_type: string;
  display_name: string;
  is_active: boolean;
  is_system_default: boolean;
}

// Explicit list of relationship type values (not the namespace properties)
const RELATIONSHIP_TYPE_VALUES: RelationshipType[] = [
  RelationshipType.SPAM,
  RelationshipType.SPOUSE,
  RelationshipType.FAMILY,
  RelationshipType.COLLEAGUE,
  RelationshipType.FRIENDS,
  RelationshipType.EXTERNAL
];

/**
 * Get all available relationship types from the enum
 */
function getAllRelationshipTypes(): UserRelationship[] {
  return RELATIONSHIP_TYPE_VALUES.map(type => ({
    id: type, // Use the type itself as ID
    relationship_type: type,
    display_name: RelationshipType.LABELS[type] || type,
    is_active: true,
    is_system_default: true
  }));
}

export class UserRelationshipService {
  async initialize(): Promise<void> {
    // No initialization needed - types are from enum
  }

  async getUserRelationships(_userId: string): Promise<UserRelationship[]> {
    // All users get the same relationship types from the enum
    return getAllRelationshipTypes();
  }

  async getRelationshipByType(_userId: string, relationshipType: string): Promise<UserRelationship | null> {
    const types = getAllRelationshipTypes();
    return types.find(t => t.relationship_type === relationshipType) || null;
  }
}

// Export singleton instance
const _instance = new UserRelationshipService();

export const userRelationshipService = {
  get instance(): UserRelationshipService {
    return _instance;
  },
  async getAllRelationships(_userId?: string): Promise<UserRelationship[]> {
    return getAllRelationshipTypes();
  },
  async getRelationshipById(relationshipId: string): Promise<UserRelationship | null> {
    const types = getAllRelationshipTypes();
    return types.find(t => t.id === relationshipId) || null;
  },
  async getRelationshipByType(_userId: string, relationshipType: string): Promise<UserRelationship | null> {
    return _instance.getRelationshipByType(_userId, relationshipType);
  },
  async createRelationship(_userId: string, _relationshipType: string, _displayName?: string): Promise<UserRelationship> {
    throw new Error('Custom relationship types are not supported. Use the predefined types from RelationshipType enum.');
  },
  async updateRelationship(_relationshipId: string, _updates: Partial<UserRelationship>): Promise<UserRelationship> {
    throw new Error('Relationship types cannot be modified. They are system defaults.');
  },
  async deleteRelationship(_relationshipId: string): Promise<void> {
    throw new Error('Relationship types cannot be deleted. They are system defaults.');
  },
  async getRelationshipSuggestions(): Promise<{ type: string; confidence: number; reason: string }[]> {
    // Return all types as suggestions
    return getAllRelationshipTypes().map(t => ({
      type: t.relationship_type,
      confidence: 0.5,
      reason: 'Available relationship type'
    }));
  }
};
