// Type definitions for the tone learning pipeline

import { LLMMetadata } from '../llm-client';

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
  rawMessage?: string;      // Raw RFC 5322 message format
}

export interface GeneratedDraft {
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
 * Unified result type for email processing operations
 * Used by both SpamDetector and DraftGenerator to ensure consistent return values
 */
export interface EmailProcessingResult {
  success: boolean;
  draft?: {
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
    metadata: {
      originalSubject?: string;
      originalFrom?: string;
      exampleCount: number;
      directCorrespondence?: number;
      timestamp: string;
    };
  };
  error?: string;
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