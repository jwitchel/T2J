/**
 * Message ID Utilities
 *
 * Normalizes message IDs to a consistent format (without angle brackets).
 * IMAP headers and postal-mime include angle brackets, but we store without them.
 */

/**
 * Normalize message ID by stripping angle brackets
 * @param messageId - Message ID with or without angle brackets
 * @returns Message ID without angle brackets, or undefined if input is undefined
 */
export function normalizeMessageId(messageId: string | undefined): string | undefined {
  if (!messageId) return undefined;
  return messageId.replace(/^<|>$/g, '');
}

/**
 * Normalize message ID from array format (as returned by IMAP parseHeader)
 * @param messageId - Message ID string or array of strings
 * @returns Array of normalized message IDs, or undefined if input is undefined
 */
export function normalizeMessageIdArray(messageId: string | string[] | undefined): string[] | undefined {
  if (!messageId) return undefined;
  const ids = Array.isArray(messageId) ? messageId : [messageId];
  return ids.map(id => id.replace(/^<|>$/g, ''));
}
