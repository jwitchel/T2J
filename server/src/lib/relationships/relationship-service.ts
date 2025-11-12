import { pool } from '../db';
import { RelationshipProfile } from '../pipeline/types';
import { StylePreferences, DEFAULT_STYLE_PREFERENCES } from './style-preferences';
import { personService } from './person-service';
import { PersonServiceError } from './person-service';
import {
  AggregatedStyle,
  PhraseFrequency,
  EmojiFrequency
} from '../style/style-aggregation-service';
import { EnhancedRelationshipProfile } from '../pipeline/template-manager';
import { formalityScoreToString, PHRASE_FREQUENCY_THRESHOLDS, RELATIONSHIP_THRESHOLDS } from '../style/style-constants';

export interface VectorSearchContext {
  relationship: string;
  stylePreferences: StylePreferences;
  personId: string;
  searchFilters: {
    relationship: string;
    formality_range: [number, number];
  };
}

export class RelationshipService {
  constructor() {}

  public async initialize(): Promise<void> {
    await personService.initialize();
  }

  /**
   * Get tone preference profile data for a user and relationship type
   * Returns null if no preference exists
   * @private
   */
  private async getTonePreference(
    userId: string,
    relationshipType: string
  ): Promise<any | null> {
    const result = await pool.query(
      `SELECT profile_data
       FROM tone_preferences
       WHERE user_id = $1 AND preference_type = $2 AND target_identifier = $3`,
      [userId, 'category', relationshipType]
    );

    if (result.rows.length > 0 && result.rows[0].profile_data) {
      return result.rows[0].profile_data;
    }

    return null;
  }

  public async getRelationshipProfile(userId: string, relationship: string): Promise<RelationshipProfile | null> {
    // Get style preferences from database
    const stylePrefs = await this.getStylePreferences(userId, relationship);
    
    if (!stylePrefs) {
      return null;
    }
    
    // Convert to RelationshipProfile format
    return {
      typicalFormality: formalityScoreToString(stylePrefs.formality),
      commonGreetings: stylePrefs.preferred_greetings,
      commonClosings: stylePrefs.preferred_closings,
      useEmojis: stylePrefs.common_emojis.length > 0,
      useHumor: stylePrefs.enthusiasm > 0.7
    };
  }
  
  public async getEnhancedProfile(userId: string, recipientEmail: string): Promise<EnhancedRelationshipProfile | null> {
    // First get person and relationship info
    const person = await personService.findPersonByEmail(recipientEmail, userId);
    if (!person) {
      return null;
    }
    
    const primaryRel = person.relationships.find(r => r.is_primary) || person.relationships[0];
    if (!primaryRel) {
      return null;
    }
    
    const relationshipType = primaryRel.relationship_type;
    
    // Get basic profile
    const basicProfile = await this.getRelationshipProfile(userId, relationshipType);
    if (!basicProfile) {
      return null;
    }
    
    // Get aggregated style data
    const aggregatedStyle = await this.getAggregatedStyle(userId, relationshipType);
    
    // Build enhanced profile
    const enhancedProfile: EnhancedRelationshipProfile = {
      ...basicProfile,
      personName: person.name,
      relationshipType: relationshipType,
      aggregatedStyle: aggregatedStyle || undefined
    };
    
    return enhancedProfile;
  }
  
  public async getStylePreferences(userId: string, relationshipType: string): Promise<StylePreferences | null> {
    // First check if user has custom preferences
    const profileData = await this.getTonePreference(userId, relationshipType);

    if (profileData) {
      
      // Handle new format with meta block
      const storedData = profileData.aggregatedStyle || profileData;
      
      // Check if this is AggregatedStyle format (has emailCount property)
      if ('emailCount' in storedData) {
        // Convert AggregatedStyle to StylePreferences
        return this.convertAggregatedToPreferences(storedData as AggregatedStyle, relationshipType);
      } else {
        // Legacy format - merge with defaults
        const defaultPrefs = DEFAULT_STYLE_PREFERENCES[relationshipType] || DEFAULT_STYLE_PREFERENCES.external;
        return { ...defaultPrefs, ...storedData };
      }
    }
    
    // Return defaults if no custom preferences
    return DEFAULT_STYLE_PREFERENCES[relationshipType] || DEFAULT_STYLE_PREFERENCES.external;
  }
  
  public async getAggregatedStyle(userId: string, relationshipType: string): Promise<AggregatedStyle | null> {
    const profileData = await this.getTonePreference(userId, relationshipType);

    if (profileData) {
      
      // Handle new format with meta block
      const storedData = profileData.aggregatedStyle || profileData;
      
      // Check if this is AggregatedStyle format
      if ('emailCount' in storedData) {
        return storedData as AggregatedStyle;
      }
    }
    
    return null;
  }
  
  public async getVectorSearchContext(userId: string, recipientEmail: string): Promise<VectorSearchContext> {
    // Detect relationship
    const detection = await personService.findPersonByEmail(recipientEmail, userId);
    
    if (!detection) {
      throw new PersonServiceError('Person not found', 'NOT_FOUND');
    }
    
    const primaryRel = detection.relationships.find(r => r.is_primary) || detection.relationships[0];
    if (!primaryRel) {
      throw new PersonServiceError('No relationship found for person', 'NO_RELATIONSHIP');
    }
    
    const relationshipType = primaryRel.relationship_type;
    const stylePrefs = await this.getStylePreferences(userId, relationshipType);
    
    if (!stylePrefs) {
      throw new PersonServiceError('No style preferences found', 'NO_PREFERENCES');
    }
    
    // Calculate formality range for search
    const minFormality = Math.max(0, stylePrefs.formality - RELATIONSHIP_THRESHOLDS.FORMALITY_BUFFER);
    const maxFormality = Math.min(1, stylePrefs.formality + RELATIONSHIP_THRESHOLDS.FORMALITY_BUFFER);
    
    return {
      relationship: relationshipType,
      stylePreferences: stylePrefs,
      personId: detection.id,
      searchFilters: {
        relationship: relationshipType,
        formality_range: [minFormality, maxFormality]
      }
    };
  }
  
  public formatStylePreferencesForPrompt(prefs: StylePreferences): string {
    const parts: string[] = [];
    
    // Formality
    if (prefs.formality < RELATIONSHIP_THRESHOLDS.FORMALITY_LEVELS.CASUAL) {
      parts.push('Write in a very casual tone.');
    } else if (prefs.formality < RELATIONSHIP_THRESHOLDS.FORMALITY_LEVELS.MODERATE) {
      parts.push('Write in a moderately formal tone.');
    } else {
      parts.push('Write in a formal tone.');
    }

    // Enthusiasm
    if (prefs.enthusiasm > RELATIONSHIP_THRESHOLDS.ENTHUSIASM_LEVELS.HIGH) {
      parts.push('Be very enthusiastic.');
    } else if (prefs.enthusiasm > RELATIONSHIP_THRESHOLDS.ENTHUSIASM_LEVELS.LOW) {
      parts.push('Be moderately enthusiastic.');
    } else {
      parts.push('Keep a professional, measured tone.');
    }

    // Brevity
    if (prefs.brevity > RELATIONSHIP_THRESHOLDS.BREVITY_LEVELS.HIGH) {
      parts.push('Keep responses very brief and to the point.');
    } else if (prefs.brevity > RELATIONSHIP_THRESHOLDS.BREVITY_LEVELS.LOW) {
      parts.push('Keep responses concise.');
    } else {
      parts.push('Provide thorough, detailed responses.');
    }
    
    // Greetings and closings
    if (prefs.preferred_greetings.length > 0) {
      parts.push(`Use greetings like: ${prefs.preferred_greetings.join(', ')}.`);
    }
    
    if (prefs.preferred_closings.length > 0) {
      parts.push(`Close with: ${prefs.preferred_closings.join(', ')}.`);
    }
    
    // Common phrases
    if (prefs.common_phrases.length > 0) {
      parts.push(`Feel free to use phrases like: ${prefs.common_phrases.join(', ')}.`);
    }
    
    if (prefs.avoid_phrases.length > 0) {
      parts.push(`Avoid phrases like: ${prefs.avoid_phrases.join(', ')}.`);
    }
    
    // Emojis
    if (prefs.common_emojis.length > 0) {
      parts.push(`Feel free to use emojis like: ${prefs.common_emojis.join(' ')}.`);
    }
    
    // Contractions
    if (prefs.common_contractions.length > 0) {
      parts.push(`Use contractions like: ${prefs.common_contractions.join(', ')}.`);
    }
    
    return parts.join(' ');
  }
  
  public async formatAggregatedStyleForPrompt(userId: string, relationshipType: string): Promise<string> {
    const aggregated = await this.getAggregatedStyle(userId, relationshipType);
    if (!aggregated) {
      // Fall back to basic style preferences
      const prefs = await this.getStylePreferences(userId, relationshipType);
      return prefs ? this.formatStylePreferencesForPrompt(prefs) : '';
    }
    
    const parts: string[] = [];
    
    // Add confidence-based prefix
    if (aggregated.confidenceScore < 0.4) {
      parts.push(`Note: Style analysis is based on limited data (${aggregated.emailCount} emails).`);
    } else if (aggregated.confidenceScore > 0.8) {
      parts.push(`Style analysis is based on ${aggregated.emailCount} emails with high confidence.`);
    }
    
    // Primary tone
    parts.push(`Write in a ${aggregated.sentimentProfile.primaryTone} tone.`);
    
    // Formality level
    const formalityLevel = formalityScoreToString(aggregated.sentimentProfile.averageFormality);
    parts.push(`Maintain a ${formalityLevel} level of formality.`);
    
    // Email length guidance
    if (aggregated.structuralPatterns.averageEmailLength < RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.VERY_BRIEF) {
      parts.push(`Keep emails very brief (typically under ${RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.VERY_BRIEF} words).`);
    } else if (aggregated.structuralPatterns.averageEmailLength < RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.BRIEF) {
      parts.push(`Keep emails concise (typically ${RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.VERY_BRIEF}-${RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.BRIEF} words).`);
    } else if (aggregated.structuralPatterns.averageEmailLength > RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.DETAILED) {
      parts.push(`Write detailed emails (typically over ${RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.DETAILED} words).`);
    }
    
    // Specific greetings if consistent (optional field)
    const topGreetings = aggregated.greetings?.filter(g => g.percentage > PHRASE_FREQUENCY_THRESHOLDS.PROMPT_INCLUSION_THRESHOLD) || [];
    if (topGreetings.length > 0) {
      parts.push(`Preferred greetings: ${topGreetings.map(g => g.text).join(', ')}.`);
    }

    // Specific closings if consistent (optional field)
    const topClosings = aggregated.closings?.filter(c => c.percentage > PHRASE_FREQUENCY_THRESHOLDS.PROMPT_INCLUSION_THRESHOLD) || [];
    if (topClosings.length > 0) {
      parts.push(`Preferred closings: ${topClosings.map(c => c.text).join(', ')}.`);
    }

    // Common phrases if frequent (optional field - not yet implemented)
    const commonPhrases: PhraseFrequency[] = aggregated.commonPhrases || [];
    if (commonPhrases.length > 0) {
      const topPhrases = commonPhrases
        .slice(0, 5)
        .map(p => p.phrase);
      parts.push(`Common phrases to consider: ${topPhrases.join(', ')}.`);
    }

    // Emoji usage (optional field)
    const emojis: EmojiFrequency[] = aggregated.emojis || [];
    if (emojis.length > 0) {
      const topEmojis = emojis.slice(0, 5).map(e => e.emoji);
      parts.push(`Feel free to use emojis like: ${topEmojis.join(' ')}.`);
    } else {
      parts.push('Avoid using emojis.');
    }
    
    // Contractions section removed - no longer analyzed
    
    // Sentence complexity
    parts.push(`Average sentence length is ${Math.round(aggregated.structuralPatterns.averageSentenceLength)} words.`);
    
    return parts.join(' ');
  }

  private convertAggregatedToPreferences(aggregated: AggregatedStyle, relationshipType: string): StylePreferences {
    // Start with defaults as base
    const defaults = DEFAULT_STYLE_PREFERENCES[relationshipType] || DEFAULT_STYLE_PREFERENCES.external;
    
    // Extract top greetings and closings (optional fields)
    const preferredGreetings = (aggregated.greetings || [])
      .filter(g => g.percentage > PHRASE_FREQUENCY_THRESHOLDS.PREFERRED_THRESHOLD)
      .map(g => g.text)
      .slice(0, 5);

    const preferredClosings = (aggregated.closings || [])
      .filter(c => c.percentage > PHRASE_FREQUENCY_THRESHOLDS.PREFERRED_THRESHOLD)
      .map(c => c.text)
      .slice(0, 5);

    // Extract common phrases (used frequently) - optional field not yet implemented
    const commonPhrases: string[] = (aggregated.commonPhrases || [])
      .filter(p => p.frequency > RELATIONSHIP_THRESHOLDS.MIN_PHRASE_FREQUENCY)
      .map(p => p.phrase)
      .slice(0, 10);

    // Extract emojis if used frequently enough (optional field)
    const commonEmojis: string[] = (aggregated.emojis || [])
      .filter(e => e.frequency > RELATIONSHIP_THRESHOLDS.MIN_PHRASE_FREQUENCY)
      .map(e => e.emoji)
      .slice(0, 10);
    
    // Calculate brevity based on average email length
    let brevity = 0.5; // default moderate
    if (aggregated.structuralPatterns.averageEmailLength < RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.VERY_BRIEF) {
      brevity = 0.9; // very brief
    } else if (aggregated.structuralPatterns.averageEmailLength < RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.BRIEF) {
      brevity = 0.7; // brief
    } else if (aggregated.structuralPatterns.averageEmailLength > RELATIONSHIP_THRESHOLDS.EMAIL_LENGTH.DETAILED) {
      brevity = 0.2; // verbose
    }
    
    // Use aggregated formality and warmth (warmth as proxy for enthusiasm)
    const formality = aggregated.sentimentProfile.averageFormality;
    const enthusiasm = aggregated.sentimentProfile.averageWarmth;
    
    // Build style preferences from aggregated data
    return {
      formality: formality,
      enthusiasm: enthusiasm,
      brevity: brevity,
      preferred_greetings: preferredGreetings.length > 0 ? preferredGreetings : defaults.preferred_greetings,
      preferred_closings: preferredClosings.length > 0 ? preferredClosings : defaults.preferred_closings,
      common_phrases: commonPhrases.length > 0 ? commonPhrases : defaults.common_phrases,
      avoid_phrases: defaults.avoid_phrases, // Keep defaults as we don't track these
      common_emojis: commonEmojis,
      common_contractions: [] // No longer analyzed
    };
  }
}

// Export singleton instance
export const relationshipService = new RelationshipService();