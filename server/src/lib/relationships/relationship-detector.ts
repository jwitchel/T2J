import { RelationshipDetectorResult } from '../pipeline/types';
import { personService as defaultPersonService, PersonService } from './person-service';
import { pool } from '../db';

/**
 * Well-defined relationship types used throughout the system
 */
export enum RelationshipType {
  SPOUSE = 'spouse',
  FAMILY = 'family',
  COLLEAGUE = 'colleague',
  FRIENDS = 'friends',
  EXTERNAL = 'external'
}

export interface DetectRelationshipParams {
  userId: string;
  recipientEmail: string;
  subject?: string;
  historicalContext?: {
    familiarityLevel: string;
    hasIntimacyMarkers: boolean;
    hasProfessionalMarkers: boolean;
    formalityScore: number;
  };
}

interface RelationshipConfig {
  workDomains: string[];
  familyEmails: string[];
  spouseEmails: string[];
}

export class RelationshipDetector {
  private personService: PersonService;
  private configCache: Map<string, RelationshipConfig> = new Map();

  constructor(personService?: PersonService) {
    this.personService = personService || defaultPersonService;
  }

  public async initialize(): Promise<void> {
    await this.personService.initialize();
  }

  /**
   * Clear cached configuration for a user
   * Call this when user updates their relationship domain settings
   */
  public clearConfigCache(userId: string): void {
    this.configCache.delete(userId);
  }

  /**
   * Fetch user's relationship configuration from preferences
   * Caches result for performance
   */
  private async getUserRelationshipConfig(userId: string): Promise<RelationshipConfig> {
    // Check cache first
    if (this.configCache.has(userId)) {
      return this.configCache.get(userId)!;
    }

    // Fetch from database
    const result = await pool.query(
      `SELECT preferences FROM "user" WHERE id = $1`,
      [userId]
    );

    const preferences = result.rows[0]?.preferences || {};
    const config: RelationshipConfig = {
      workDomains: this.parseCSV(preferences.workDomainsCSV || ''),
      familyEmails: this.parseCSV(preferences.familyEmailsCSV || ''),
      spouseEmails: this.parseCSV(preferences.spouseEmailsCSV || '')
    };

    // Cache it
    this.configCache.set(userId, config);
    return config;
  }

  /**
   * Parse CSV string into array of normalized values
   */
  private parseCSV(csv: string): string[] {
    if (!csv || csv.trim().length === 0) return [];
    return csv
      .split(',')
      .map(item => item.trim().toLowerCase())
      .filter(item => item.length > 0);
  }

  /**
   * Determine relationship type from email based on configured domains/emails
   *
   * Priority order (checked top to bottom, first match wins):
   * 1. SPOUSE - exact email match, trumps all other categories
   * 2. FAMILY - exact email match
   * 3. COLLEAGUE - domain match
   *
   * This ensures spouse takes precedence even if they're also in family list or work at same company
   *
   * Static method so it can be shared with relationship-service for re-categorization
   */
  public static determineConfiguredRelationship(
    email: string,
    config: RelationshipConfig
  ): RelationshipType | null {
    const normalizedEmail = email.toLowerCase();
    const domain = normalizedEmail.split('@')[1];

    // Priority 1: Spouse (beats family and work)
    if (config.spouseEmails.includes(normalizedEmail)) {
      return RelationshipType.SPOUSE;
    }

    // Priority 2: Family (beats work)
    if (config.familyEmails.includes(normalizedEmail)) {
      return RelationshipType.FAMILY;
    }

    // Priority 3: Work colleague (domain match)
    if (domain && config.workDomains.includes(domain)) {
      return RelationshipType.COLLEAGUE;
    }

    return null;
  }

  /**
   * Check if email matches user's configured relationship categories
   * Instance wrapper for static helper
   */
  private checkConfiguredRelationship(
    email: string,
    config: RelationshipConfig
  ): { relationship: string; confidence: number } | null {
    const relationship = RelationshipDetector.determineConfiguredRelationship(email, config);
    if (relationship) {
      return { relationship, confidence: 1.0 };
    }
    return null;
  }

  public async detectRelationship(params: DetectRelationshipParams): Promise<RelationshipDetectorResult> {
    const { userId, recipientEmail } = params;

    // First, check if we have this person in our database
    const person = await this.personService.findPersonByEmail(recipientEmail, userId);

    if (person && person.relationships.length > 0) {
      // Find the primary relationship or the one with highest confidence
      const primaryRel = person.relationships.find(r => r.is_primary)
        || person.relationships.sort((a, b) => b.confidence - a.confidence)[0];

      return {
        relationship: primaryRel.relationship_type,
        confidence: primaryRel.confidence,
        method: primaryRel.user_set ? 'user-defined' : 'database'
      };
    }

    // Get user's relationship configuration
    const config = await this.getUserRelationshipConfig(userId);

    // Check configured relationships (deterministic, highest priority for new contacts)
    const configuredMatch = this.checkConfiguredRelationship(recipientEmail, config);
    if (configuredMatch) {
      // Create person record with configured relationship
      if (!person) {
        try {
          await this.personService.findOrCreatePerson({
            userId,
            name: recipientEmail.split('@')[0],
            emailAddress: recipientEmail,
            relationshipType: configuredMatch.relationship,
            confidence: configuredMatch.confidence
          });
        } catch (error: unknown) {
          console.error('Failed to create person record:', error);
        }
      }

      return {
        relationship: configuredMatch.relationship,
        confidence: configuredMatch.confidence,
        method: 'configured'
      };
    }

    // If person not found and no configured match, use domain-based heuristics
    const email = recipientEmail.toLowerCase();
    let relationship = RelationshipType.EXTERNAL;
    let confidence = 0.5;

    // Domain-based detection
    // TODO: Write a service to better detect domain type (corporate vs mailgun vs united airlines)
    const domain = email.split('@')[1];
    if (domain) {
      // Check for personal email domains (hint towards FRIENDS)
      if (['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'].includes(domain)) {
        relationship = RelationshipType.FRIENDS;
        confidence = 0.6;
      }
      // Note: COLLEAGUE is determined by user's configured work domains only
      // All other domains fall through as EXTERNAL with confidence 0.5
    }

    // Use historical context if provided to refine the detection
    if (params.historicalContext) {
      const ctx = params.historicalContext;

      if (ctx.hasIntimacyMarkers && ctx.familiarityLevel === 'high') {
        relationship = RelationshipType.SPOUSE;
        confidence = Math.max(confidence, 0.8);
      } else if (ctx.hasProfessionalMarkers && ctx.formalityScore > 0.7) {
        relationship = RelationshipType.COLLEAGUE;
        confidence = Math.max(confidence, 0.75);
      } else if (ctx.familiarityLevel === 'high' && !ctx.hasProfessionalMarkers) {
        relationship = RelationshipType.FRIENDS;
        confidence = Math.max(confidence, 0.7);
      }
    }
    
    // Create person record for future use (only if we didn't find them)
    if (!person) {
      try {
        await this.personService.findOrCreatePerson({
          userId,
          name: email.split('@')[0], // Use email prefix as initial name
          emailAddress: recipientEmail,
          relationshipType: relationship,
          confidence
        });
      } catch (error: unknown) {
        // Log but don't fail - the detection still worked
        console.error('Failed to create person record:', error);
      }
    }
    
    return {
      relationship,
      confidence,
      method: 'heuristic'
    };
  }
}

// Export singleton instance
export const relationshipDetector = new RelationshipDetector();