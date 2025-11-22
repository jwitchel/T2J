/**
 * Well-defined relationship types used throughout the system
 */
export enum RelationshipType {
  SPAM = 'spam',
  SPOUSE = 'spouse',
  FAMILY = 'family',
  COLLEAGUE = 'colleague',
  FRIENDS = 'friends',
  EXTERNAL = 'external'
}

/**
 * Namespace for RelationshipType utility functions
 */
export namespace RelationshipType {
  /**
   * Priority order for relationship types (lower number = higher priority)
   * SPAM has lowest priority (highest number) so it's always overridden by other relationships
   */
  export const PRIORITY: Record<string, number> = {
    [RelationshipType.SPOUSE]: 1,
    [RelationshipType.FAMILY]: 2,
    [RelationshipType.COLLEAGUE]: 3,
    [RelationshipType.FRIENDS]: 4,
    [RelationshipType.EXTERNAL]: 5,
    [RelationshipType.SPAM]: 6
  };

  /**
   * Select the higher priority relationship match
   * Priority: spouse > family > colleague > friends > external > spam
   */
  export function selectHigherPriorityMatch(
    match1: { relationship: string; confidence: number } | null,
    match2: { relationship: string; confidence: number } | null
  ): { relationship: string; confidence: number } | null {
    if (!match1) return match2;
    if (!match2) return match1;

    const priority1 = PRIORITY[match1.relationship] || 999;
    const priority2 = PRIORITY[match2.relationship] || 999;

    return priority1 <= priority2 ? match1 : match2;
  }
}
