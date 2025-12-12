import he from 'he'

/**
 * Decode HTML entities in a string using the 'he' library
 */
export function decodeHtmlEntities(text: string): string {
  return he.decode(text)
}

/**
 * Alias for consistency with existing code
 */
export const decodeHtmlEntitiesSafe = decodeHtmlEntities
export const decodeHtmlEntitiesServer = decodeHtmlEntities
