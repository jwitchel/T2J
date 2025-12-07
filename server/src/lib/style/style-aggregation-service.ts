import { Pool } from 'pg';
import { pool } from '../db';
import { extractEmailFeatures } from '../pipeline/types';
import {
  MAX_EMAILS_TO_ANALYZE,
  ESTIMATED_AVG_SENTENCE_LENGTH,
  MULTI_PARAGRAPH_THRESHOLD,
  CONFIDENCE_THRESHOLDS
} from './style-constants';

/**
 * Currently implemented style metrics
 * These fields are actively populated by the aggregation service
 */
export interface ImplementedStyleMetrics {
  sentimentProfile: {
    primaryTone: string;
    averageWarmth: number;
    averageFormality: number;
  };
  vocabularyProfile: {
    complexityLevel: string;
    technicalTerms: string[];  // Currently empty, but structure ready
  };
  structuralPatterns: {
    averageEmailLength: number;
    averageSentenceLength: number;
    paragraphingStyle: string;
  };
  // Metadata for continuous learning
  emailCount: number;
  lastUpdated: string;
  confidenceScore: number;
}

/**
 * Common phrase with frequency tracking
 */
export interface PhraseFrequency {
  phrase: string;
  frequency: number;
}

/**
 * Greeting with usage statistics
 */
export interface GreetingFrequency {
  text: string;
  frequency: number;
  percentage: number;
}

/**
 * Closing with usage statistics
 */
export interface ClosingFrequency {
  text: string;
  frequency: number;
  percentage: number;
}

/**
 * Emoji with usage context tracking
 */
export interface EmojiFrequency {
  emoji: string;
  frequency: number;
  contexts: string[];
}

/**
 * Future style features requiring pattern extraction
 * These fields are optional until the pattern analyzer is implemented
 */
export interface FutureStyleFeatures {
  greetings?: GreetingFrequency[];
  closings?: ClosingFrequency[];
  emojis?: EmojiFrequency[];
  commonPhrases?: PhraseFrequency[];
}

/**
 * Complete aggregated style combining implemented and future features
 */
export type AggregatedStyle = ImplementedStyleMetrics & FutureStyleFeatures;

export class StyleAggregationService {
  constructor(
    private customPool: Pool = pool
  ) {}

  public async aggregateStyleForUser(
    userId: string,
    relationshipType: string
  ): Promise<AggregatedStyle> {
    // Query email_sent from PostgreSQL for this user and relationship
    // JOIN through person_emails and person_relationships to filter by relationship type
    const emailsResult = await this.customPool.query(`
      SELECT es.user_reply, es.word_count, es.sent_date
      FROM email_sent es
      INNER JOIN person_emails pe ON es.recipient_person_email_id = pe.id
      INNER JOIN people p ON pe.person_id = p.id
      INNER JOIN person_relationships pr ON pr.person_id = p.id AND pr.user_id = es.user_id AND pr.is_primary = true
      INNER JOIN user_relationships ur ON pr.user_relationship_id = ur.id
      WHERE es.user_id = $1 AND ur.relationship_type = $2
      ORDER BY es.sent_date DESC
      LIMIT $3
    `, [userId, relationshipType, MAX_EMAILS_TO_ANALYZE]);

    const emails = emailsResult.rows;

    if (emails.length === 0) {
      return this._getDefaultStyle(relationshipType);
    }

    // Extract basic features from each email (using stub extractor)
    const allFeatures = emails.map(email =>
      extractEmailFeatures(email.user_reply, { email: '', name: '' })
    );

    // Calculate average formality from extracted features
    const totalFormality = allFeatures.reduce((sum, f) => sum + f.stats.formalityScore, 0);
    const averageFormality = totalFormality / allFeatures.length;

    // Calculate warmth as inverse of formality (simplified)
    const averageWarmth = 1 - averageFormality;

    // Calculate structural patterns from word counts
    const totalWords = emails.reduce((sum, email) => sum + (email.word_count || 0), 0);
    const averageEmailLength = totalWords / emails.length;
    const averageSentenceLength = ESTIMATED_AVG_SENTENCE_LENGTH;

    const aggregated: AggregatedStyle = {
      sentimentProfile: {
        primaryTone: this._determinePrimaryTone(averageWarmth),
        averageWarmth,
        averageFormality
      },
      vocabularyProfile: {
        complexityLevel: this._determineComplexityLevel(averageSentenceLength),
        technicalTerms: []
      },
      structuralPatterns: {
        averageEmailLength,
        averageSentenceLength,
        paragraphingStyle: averageEmailLength > MULTI_PARAGRAPH_THRESHOLD ? 'multi' : 'single'
      },
      emailCount: emails.length,
      lastUpdated: new Date().toISOString(),
      confidenceScore: this._calculateConfidence(emails.length)
      // Future features (greetings, closings, emojis, commonPhrases) omitted until implemented
    };

    return aggregated;
  }

  public async updateStylePreferences(
    userId: string,
    relationshipType: string,
    aggregatedStyle: AggregatedStyle
  ): Promise<void> {
    const profileData = {
      meta: {
        type: 'category',
        lastAnalyzed: new Date().toISOString(),
        emailCount: aggregatedStyle.emailCount,
        confidence: aggregatedStyle.confidenceScore
      },
      aggregatedStyle
    };
    
    await this.customPool.query(
      `INSERT INTO tone_preferences (user_id, preference_type, target_identifier, profile_data, emails_analyzed, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (user_id, preference_type, target_identifier)
       DO UPDATE SET
         -- Merge new aggregatedStyle and meta into existing profile_data
         -- This preserves writingPatterns if it exists
         profile_data = COALESCE(tone_preferences.profile_data, '{}'::jsonb) || $4::jsonb,
         emails_analyzed = $5,
         updated_at = NOW()`,
      [userId, 'category', relationshipType, JSON.stringify(profileData), aggregatedStyle.emailCount]
    );
  }

  public async getAggregatedStyle(userId: string, relationshipType: string): Promise<AggregatedStyle | null> {
    const result = await this.customPool.query(
      `SELECT profile_data
       FROM tone_preferences
       WHERE user_id = $1 AND preference_type = $2 AND target_identifier = $3`,
      [userId, 'category', relationshipType]
    );

    if (result.rows.length > 0 && result.rows[0].profile_data) {
      const data = result.rows[0].profile_data;

      // Check if data has aggregatedStyle
      if (data.aggregatedStyle) {
        return data.aggregatedStyle;
      }

      // Check if data itself looks like AggregatedStyle (has sentimentProfile)
      if (data.sentimentProfile) {
        return data as AggregatedStyle;
      }

      // If data only has writingPatterns (from pattern analyzer), we need to aggregate style
      console.log(`[StyleAggregation] No aggregatedStyle found for ${relationshipType}, generating...`);
      const aggregated = await this.aggregateStyleForUser(userId, relationshipType);

      // Save it for next time
      await this.updateStylePreferences(userId, relationshipType, aggregated);

      return aggregated;
    }

    return null;
  }
  
  private _calculateConfidence(emailCount: number): number {
    // Confidence increases with sample size
    if (emailCount < CONFIDENCE_THRESHOLDS.MIN_SAMPLE) return 0.2;
    if (emailCount < CONFIDENCE_THRESHOLDS.LOW_CONFIDENCE) return 0.4;
    if (emailCount < CONFIDENCE_THRESHOLDS.MEDIUM_CONFIDENCE) return 0.6;
    if (emailCount < CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE) return 0.8;
    return 0.95;
  }

  private _determinePrimaryTone(warmth: number): string {
    if (warmth > 0.8) return 'very warm';
    if (warmth > 0.6) return 'warm';
    if (warmth > 0.4) return 'neutral';
    if (warmth > 0.2) return 'professional';
    return 'formal';
  }

  private _determineComplexityLevel(avgSentenceLength: number): string {
    if (avgSentenceLength < 10) return 'simple';
    if (avgSentenceLength < 15) return 'moderate';
    if (avgSentenceLength < 20) return 'complex';
    return 'very complex';
  }
  
  private _getDefaultStyle(_relationshipType: string): AggregatedStyle {
    // Return minimal default style when no data exists
    return {
      sentimentProfile: {
        primaryTone: 'neutral',
        averageWarmth: 0.5,
        averageFormality: 0.5
      },
      vocabularyProfile: {
        complexityLevel: 'moderate',
        technicalTerms: []
      },
      structuralPatterns: {
        averageEmailLength: 100,
        averageSentenceLength: ESTIMATED_AVG_SENTENCE_LENGTH,
        paragraphingStyle: 'single'
      },
      emailCount: 0,
      lastUpdated: new Date().toISOString(),
      confidenceScore: 0
      // Future features omitted - no defaults for unimplemented features
    };
  }

  public async getUserRelationshipTypes(userId: string): Promise<Array<{
    relationshipType: string;
    displayName: string;
    hasAggregatedStyle: boolean;
    emailCount?: number;
    lastUpdated?: string;
  }>> {
    // Get all relationship types from user_relationships
    const relationshipsResult = await this.customPool.query(
      `SELECT DISTINCT relationship_type, display_name 
       FROM user_relationships 
       WHERE user_id = $1 AND is_active = true
       ORDER BY relationship_type`,
      [userId]
    );
    
    // Get aggregated styles
    const stylesResult = await this.customPool.query(
      `SELECT target_identifier, profile_data 
       FROM tone_preferences 
       WHERE user_id = $1 AND preference_type = 'category'`,
      [userId]
    );
    
    const styleMap = new Map<string, AggregatedStyle>();
    for (const row of stylesResult.rows) {
      const data = row.profile_data;
      const style = data.aggregatedStyle || data;
      if (style && 'emailCount' in style) {
        styleMap.set(row.target_identifier, style as AggregatedStyle);
      }
    }
    
    return relationshipsResult.rows.map(row => ({
      relationshipType: row.relationship_type,
      displayName: row.display_name,
      hasAggregatedStyle: styleMap.has(row.relationship_type),
      emailCount: styleMap.get(row.relationship_type)?.emailCount,
      lastUpdated: styleMap.get(row.relationship_type)?.lastUpdated
    }));
  }
}

// Export singleton instance
export const styleAggregationService = new StyleAggregationService();