/**
 * Email Processing Markers
 *
 * Special tokens used to indicate emails with no user content.
 * These markers are stored in the user_reply field and excluded from:
 * - Word counts
 * - Feature extraction
 * - Vector generation
 */

export const EmailMarkers = {
  FORWARDED_CONTENT_REMOVED: '[Forwarded-content-removed]',
  ATTACHMENT_ONLY: '[Attachment-only]'
} as const;

export type EmailMarker = typeof EmailMarkers[keyof typeof EmailMarkers];

/**
 * Check if a string is a special email marker
 */
export function isEmailMarker(text: string): text is EmailMarker {
  return text === EmailMarkers.FORWARDED_CONTENT_REMOVED
    || text === EmailMarkers.ATTACHMENT_ONLY;
}

/**
 * Check if text contains actual user content (not just markers)
 */
export function hasActualUserContent(text: string | null | undefined): boolean {
  if (!text || text.trim() === '') {
    return false;
  }

  return !isEmailMarker(text);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove all email markers from text
 * Used by NLP feature extraction to exclude markers from analysis
 */
export function stripEmailMarkers(text: string): string {
  return text
    .replace(new RegExp(escapeRegExp(EmailMarkers.FORWARDED_CONTENT_REMOVED), 'gi'), '')
    .replace(new RegExp(escapeRegExp(EmailMarkers.ATTACHMENT_ONLY), 'gi'), '')
    .trim();
}
