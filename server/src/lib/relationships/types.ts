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
  export const PRIORITY: Record<RelationshipType, number> = {
    [RelationshipType.SPOUSE]: 1,
    [RelationshipType.FAMILY]: 2,
    [RelationshipType.COLLEAGUE]: 3,
    [RelationshipType.FRIENDS]: 4,
    [RelationshipType.EXTERNAL]: 5,
    [RelationshipType.SPAM]: 6
  };

  /**
   * Colors for relationship badges/pills in the UI
   * Tailwind CSS color classes for consistent display
   */
  export const COLORS: Record<string, string> = {
    [RelationshipType.SPOUSE]: 'bg-pink-500 hover:bg-pink-600',
    [RelationshipType.FAMILY]: 'bg-purple-500 hover:bg-purple-600',
    [RelationshipType.COLLEAGUE]: 'bg-blue-500 hover:bg-blue-600',
    [RelationshipType.FRIENDS]: 'bg-green-500 hover:bg-green-600',
    [RelationshipType.EXTERNAL]: 'bg-gray-500 hover:bg-gray-600',
    [RelationshipType.SPAM]: 'bg-red-500 hover:bg-red-600',
    'unknown': 'bg-zinc-500 hover:bg-zinc-600'
  };

  /**
   * Display labels for relationship types
   */
  export const LABELS: Record<string, string> = {
    [RelationshipType.SPOUSE]: 'Spouse',
    [RelationshipType.FAMILY]: 'Family',
    [RelationshipType.COLLEAGUE]: 'Colleague',
    [RelationshipType.FRIENDS]: 'Friends',
    [RelationshipType.EXTERNAL]: 'External',
    [RelationshipType.SPAM]: 'Spam',
    'unknown': 'Unknown'
  };

  /**
   * Select the higher priority relationship match
   * Priority: spouse > family > colleague > friends > external > spam
   */
  export function selectHigherPriorityMatch(
    match1: { relationship: RelationshipType; confidence: number } | null,
    match2: { relationship: RelationshipType; confidence: number } | null
  ): { relationship: RelationshipType; confidence: number } | null {
    if (!match1) return match2;
    if (!match2) return match1;

    const priority1 = PRIORITY[match1.relationship];
    const priority2 = PRIORITY[match2.relationship];

    return priority1 <= priority2 ? match1 : match2;
  }
}
