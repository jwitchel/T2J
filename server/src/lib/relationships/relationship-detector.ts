import { PoolClient } from 'pg';
import { RelationshipDetectorResult } from '../pipeline/types';
import { personService as defaultPersonService, PersonService } from './person-service';
import { pool } from '../db';
import { NameExtractor } from '../utils/name-extractor';
import { PersonCache } from './person-cache';
import { RelationshipType } from './types';

// Re-export for backwards compatibility
export { RelationshipType }

export interface DetectRelationshipParams {
  userId: string;
  recipientEmail: string;
  recipientName?: string;  // Optional: Recipient's full name from email headers
  replyToEmail?: string;  // Optional: Reply-To header address (checked first for relationship detection)
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
  private personCache: PersonCache;

  constructor(personService?: PersonService) {
    this.personService = personService || defaultPersonService;
    this.personCache = new PersonCache(pool, this.personService);
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
   * Clear person cache
   * Call this when starting a new batch operation to reset cache
   */
  public clearPersonCache(): void {
    this.personCache.clear();
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

  /**
   * Detect relationship type for an email contact
   * @param params - Detection parameters
   * @param client - Optional transaction client. If provided, operation is part of transaction.
   */
  public async detectRelationship(params: DetectRelationshipParams, client?: PoolClient): Promise<RelationshipDetectorResult> {
    const { userId, recipientEmail, replyToEmail } = params;

    // Check BOTH Reply-To and From addresses (not just fallback)
    // For Google Docs shares: From=noreply@google.com, Reply-To=tmoon@kingenergy.com
    // We want to detect the relationship for either address

    // Step 1: Check cache/database for both addresses (prefer Reply-To if both exist)
    // Use PersonCache for optimized bulk lookups during batch processing
    // Uses transaction client (if provided) for proper isolation
    let person = null;

    // Build list of emails to lookup (prioritize replyToEmail)
    const emailsToLookup = replyToEmail ? [replyToEmail, recipientEmail] : [recipientEmail];

    // Bulk lookup with cache (much faster for batch operations)
    // Pass transaction client for proper isolation
    const { found } = await this.personCache.bulkFind(emailsToLookup, userId, client);

    // Prefer replyToEmail if found
    if (replyToEmail) {
      person = found.get(replyToEmail.toLowerCase().trim()) || null;
    }

    // Fallback to recipientEmail
    if (!person) {
      person = found.get(recipientEmail.toLowerCase().trim()) || null;
    }

    if (person && person.relationships.length > 0) {
      // Find the primary relationship or the one with highest confidence
      const primaryRel = person.relationships.find(r => r.is_primary)
        || person.relationships.sort((a, b) => b.confidence - a.confidence)[0];

      // Return early - will extract primaryEmail at end
      return this._buildResult(person, primaryRel.relationship_type, primaryRel.confidence);
    }

    // Step 2: Check configured relationships for BOTH addresses
    // Priority: spouse > family > colleague
    const config = await this.getUserRelationshipConfig(userId);

    let replyToMatch = null;
    let fromMatch = null;

    if (replyToEmail) {
      replyToMatch = this.checkConfiguredRelationship(replyToEmail, config);
    }
    fromMatch = this.checkConfiguredRelationship(recipientEmail, config);

    // Choose the higher priority match (spouse > family > colleague)
    const configuredMatch = RelationshipType.selectHigherPriorityMatch(replyToMatch, fromMatch);

    if (configuredMatch) {
      // Determine which email to store based on which one matched
      const matchedEmail = (replyToMatch?.relationship === configuredMatch.relationship && replyToEmail)
        ? replyToEmail
        : recipientEmail;

      // Create person record with configured relationship
      if (!person) {
        // Extract name from email address or use formatted email prefix as fallback
        const personName = NameExtractor.extractName(matchedEmail, params.recipientName);

        person = await this.personService.findOrCreatePerson({
          userId,
          name: personName,
          emailAddress: matchedEmail,
          relationshipType: configuredMatch.relationship,
          confidence: configuredMatch.confidence
        }, client);
      }

      // Return with person data - will extract primaryEmail at end
      return this._buildResult(person, configuredMatch.relationship, configuredMatch.confidence);
    }

    // Step 3: Use domain-based heuristics (prefer Reply-To if available)
    const email = (replyToEmail || recipientEmail).toLowerCase();
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
      const emailToStore = replyToEmail || recipientEmail;
      // Extract name from email address or use formatted email prefix as fallback
      const personName = NameExtractor.extractName(emailToStore, params.recipientName);

      person = await this.personService.findOrCreatePerson({
        userId,
        name: personName,
        emailAddress: emailToStore,
        relationshipType: relationship,
        confidence
      }, client);
    }

    // Return with person data - will extract primaryEmail at end
    return this._buildResult(person, relationship, confidence);
  }

  /**
   * Helper to build RelationshipDetectorResult from person and relationship data
   * Centralizes primaryEmail extraction logic
   */
  private _buildResult(person: any, relationship: string, confidence: number): RelationshipDetectorResult {
    if (!person || !person.emails || person.emails.length === 0) {
      throw new Error(`Failed to create or retrieve person record. Cannot proceed without person_email_id`);
    }

    const primaryEmail = person.emails.find((e: any) => e.is_primary) || person.emails[0];
    if (!primaryEmail) {
      throw new Error(`Person ${person.id} has no email addresses`);
    }

    return {
      relationship,
      confidence,
      personEmailId: primaryEmail.id
    };
  }
}

// Export singleton instance
export const relationshipDetector = new RelationshipDetector();