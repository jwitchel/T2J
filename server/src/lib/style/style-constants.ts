/**
 * Style Analysis Constants
 * Centralized configuration for style aggregation and analysis
 */

/**
 * Maximum number of historical emails to analyze for style aggregation
 * Balances between comprehensive analysis and query performance
 */
export const MAX_EMAILS_TO_ANALYZE = parseInt(
  process.env.STYLE_MAX_EMAILS_TO_ANALYZE || '1000',
  10
);

/**
 * Estimated average sentence length in words
 * Used as a baseline when actual sentence parsing is not performed
 */
export const ESTIMATED_AVG_SENTENCE_LENGTH = parseInt(
  process.env.STYLE_ESTIMATED_SENTENCE_LENGTH || '15',
  10
);

/**
 * Word count threshold to determine if email uses multi-paragraph style
 * Emails longer than this are likely to use multiple paragraphs
 */
export const MULTI_PARAGRAPH_THRESHOLD = parseInt(
  process.env.STYLE_MULTI_PARAGRAPH_THRESHOLD || '200',
  10
);

/**
 * Formality score thresholds for converting numeric scores to string descriptors
 * Scores range from 0 (very casual) to 1 (very formal)
 */
export const FORMALITY_THRESHOLDS = {
  VERY_FORMAL: parseFloat(process.env.STYLE_FORMALITY_VERY_FORMAL || '0.8'),
  FORMAL: parseFloat(process.env.STYLE_FORMALITY_FORMAL || '0.6'),
  NEUTRAL: parseFloat(process.env.STYLE_FORMALITY_NEUTRAL || '0.4'),
  CASUAL: parseFloat(process.env.STYLE_FORMALITY_CASUAL || '0.2')
} as const;

/**
 * Confidence score thresholds based on sample size
 * More emails analyzed = higher confidence in the aggregated style
 */
export const CONFIDENCE_THRESHOLDS = {
  MIN_SAMPLE: parseInt(process.env.STYLE_CONFIDENCE_MIN_SAMPLE || '10', 10),
  LOW_CONFIDENCE: parseInt(process.env.STYLE_CONFIDENCE_LOW || '50', 10),
  MEDIUM_CONFIDENCE: parseInt(process.env.STYLE_CONFIDENCE_MEDIUM || '100', 10),
  HIGH_CONFIDENCE: parseInt(process.env.STYLE_CONFIDENCE_HIGH || '500', 10)
} as const;

/**
 * Phrase frequency thresholds for style pattern detection
 * Determines when greetings/closings are considered significant
 */
export const PHRASE_FREQUENCY_THRESHOLDS = {
  /** Minimum percentage (0-100) for a phrase to be considered "preferred" in style preferences */
  PREFERRED_THRESHOLD: parseInt(process.env.STYLE_PREFERRED_PHRASE_THRESHOLD || '20', 10),
  /** Minimum percentage (0-100) for a phrase to be included in prompt templates */
  PROMPT_INCLUSION_THRESHOLD: parseInt(process.env.STYLE_PROMPT_PHRASE_THRESHOLD || '30', 10)
} as const;

/**
 * Relationship-based style thresholds
 * Used for formatting and categorizing communication styles
 */
export const RELATIONSHIP_THRESHOLDS = {
  /** Formality buffer for vector search range (±0.2 around user's formality score) */
  FORMALITY_BUFFER: parseFloat(process.env.RELATIONSHIP_FORMALITY_BUFFER || '0.2'),

  /** Email length categorization (in words) */
  EMAIL_LENGTH: {
    VERY_BRIEF: parseInt(process.env.RELATIONSHIP_EMAIL_VERY_BRIEF || '50', 10),
    BRIEF: parseInt(process.env.RELATIONSHIP_EMAIL_BRIEF || '100', 10),
    DETAILED: parseInt(process.env.RELATIONSHIP_EMAIL_DETAILED || '200', 10)
  },

  /** Formality level thresholds for prompt formatting */
  FORMALITY_LEVELS: {
    CASUAL: parseFloat(process.env.RELATIONSHIP_FORMALITY_CASUAL || '0.3'),
    MODERATE: parseFloat(process.env.RELATIONSHIP_FORMALITY_MODERATE || '0.7')
  },

  /** Enthusiasm level thresholds for prompt formatting */
  ENTHUSIASM_LEVELS: {
    LOW: parseFloat(process.env.RELATIONSHIP_ENTHUSIASM_LOW || '0.4'),
    HIGH: parseFloat(process.env.RELATIONSHIP_ENTHUSIASM_HIGH || '0.7')
  },

  /** Brevity level thresholds for prompt formatting */
  BREVITY_LEVELS: {
    LOW: parseFloat(process.env.RELATIONSHIP_BREVITY_LOW || '0.4'),
    HIGH: parseFloat(process.env.RELATIONSHIP_BREVITY_HIGH || '0.7')
  },

  /** Minimum frequency for phrases/emojis to be considered significant */
  MIN_PHRASE_FREQUENCY: parseInt(process.env.RELATIONSHIP_MIN_PHRASE_FREQUENCY || '2', 10)
} as const;

/**
 * Convert a numeric formality score (0-1) to a string descriptor
 * @param score - Formality score from 0 (casual) to 1 (formal)
 * @returns String descriptor of formality level
 */
export function formalityScoreToString(score: number): string {
  if (score >= FORMALITY_THRESHOLDS.VERY_FORMAL) return 'very_formal';
  if (score >= FORMALITY_THRESHOLDS.FORMAL) return 'formal';
  if (score >= FORMALITY_THRESHOLDS.NEUTRAL) return 'neutral';
  if (score >= FORMALITY_THRESHOLDS.CASUAL) return 'casual';
  return 'very_casual';
}
