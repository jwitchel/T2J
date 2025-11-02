// Type definitions for the tone learning pipeline

import { LLMMetadata } from '../llm-client';

/**
 * Parsed incoming email (structured representation)
 *
 * Purpose: Represents an email that has been received and parsed from raw MIME format.
 * Used for: Email analysis, training data, feeding to LLM for draft generation.
 *
 * Key characteristics:
 * - Structured data (from/to/cc are arrays of address objects)
 * - Contains both full content and parsed reply text
 * - Includes original raw message for reference
 * - Used as INPUT to the draft generation pipeline
 */
export interface ProcessedEmail {
  uid: string;
  messageId: string;
  inReplyTo: string | null;
  date: Date;
  from: Array<{ address: string; name?: string }>;
  to: Array<{ address: string; name?: string }>;
  cc: Array<{ address: string; name?: string }>;
  bcc: Array<{ address: string; name?: string }>;
  subject: string;
  textContent: string | null;
  htmlContent: string | null;
  userReply: string;        // Just what the user wrote (no signature, no quotes)
  respondedTo: string;      // The quoted content the user was responding to
  relationship?: {
    type: string;
    confidence: number;
    detectionMethod: string;
  };
  rawMessage: string;       // Raw RFC 5322 message format (complete email with headers)
}

/**
 * LLM-generated draft result (internal representation)
 *
 * Purpose: Represents the raw output from the AI/LLM after analyzing an email.
 * Used for: Internal processing between LLM generation and email formatting.
 *
 * Key characteristics:
 * - Contains AI analysis metadata (meta, relationship, examples used)
 * - Unformatted content (no email headers, no quoted replies)
 * - Includes analytics data for model improvement
 * - INTERMEDIATE stage between ProcessedEmail (input) and DraftEmail (output)
 */
export interface LLMDraftResult {
  id: string;
  userId: string;
  incomingEmailId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  meta?: LLMMetadata;
  relationship: {
    type: string;
    confidence: number;
    detectionMethod: string;
  };
  examplesUsed: string[];
  metadata: {
    exampleCount: number;
    directCorrespondence?: number;
    timestamp: string;
  };
  createdAt: Date;
}

/**
 * Formatted draft email ready for sending (final representation)
 *
 * Purpose: Represents a fully formatted email ready to be sent via SMTP/IMAP.
 * Used for: API responses, email client display, uploading to IMAP drafts folder.
 *
 * Key characteristics:
 * - Formatted strings (from/to/cc are "Name <email>" format)
 * - Complete email structure (headers, body, HTML, quoted replies)
 * - Includes AI metadata for UI display and tracking
 * - Used as OUTPUT from the draft generation pipeline
 * - Ready to be sent without further processing
 */
export interface DraftEmail {
  id: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  inReplyTo: string;
  references: string;
  meta: LLMMetadata;
  relationship: {
    type: string;
    confidence: number;
    detectionMethod: string;
  };
  draftMetadata: {
    originalSubject?: string;
    originalFrom?: string;
    exampleCount: number;
    directCorrespondence?: number;
    timestamp: string;
  };
}

/**
 * Result wrapper for email processing operations
 *
 * Purpose: Unified response type for all email processing operations (spam check + draft generation).
 * Used for: API responses, service-to-service communication, error handling.
 *
 * Key characteristics:
 * - Discriminated union on `success` field for type-safe error handling
 * - Contains either a DraftEmail (success) or error details (failure)
 * - Error codes enable proper HTTP status mapping and retry logic
 * - Used by EmailProcessingService, SpamDetector, and DraftGenerator
 */
export interface EmailProcessingResult {
  success: boolean;
  draft?: DraftEmail;
  error?: string;
  errorCode?: 'ACCOUNT_NOT_FOUND' | 'LLM_TIMEOUT' | 'PARSE_ERROR' | 'SPAM_DETECTED' | 'UNKNOWN';
}

export interface EmailFeatures {
  relationshipHints: {
    familiarityLevel: string;
    intimacyMarkers: string[];
    professionalMarkers: string[];
  };
  stats: {
    formalityScore: number;
    wordCount: number;
  };
  sentiment: {
    dominant: 'positive' | 'negative' | 'neutral';
  };
  urgency: {
    level: 'low' | 'medium' | 'high';
  };
}

export interface RelationshipDetectorResult {
  relationship: string;
  confidence: number;
  method: string;
}

export interface RelationshipProfile {
  typicalFormality: string;
  commonGreetings: string[];
  commonClosings: string[];
  useEmojis: boolean;
  useHumor: boolean;
}

// Temporary function until nlp-feature-extractor is implemented
export function extractEmailFeatures(text: string, _recipientInfo?: any): EmailFeatures {
  // Stub implementation
  return {
    relationshipHints: {
      familiarityLevel: 'professional',
      intimacyMarkers: [],
      professionalMarkers: []
    },
    stats: {
      formalityScore: 0.5,
      wordCount: text.split(/\s+/).length
    },
    sentiment: {
      dominant: 'neutral'
    },
    urgency: {
      level: 'low'
    }
  };
}