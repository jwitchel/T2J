import { Pool } from 'pg';

export interface TypedNameRemovalResult {
  cleanedText: string;
  removedText: string | null;
  matchedPattern: string | null;
}

export class TypedNameRemover {
  constructor(private pool: Pool) {}

  /**
   * Remove typed name from user reply based on user preferences
   */
  async removeTypedName(text: string, userId: string): Promise<TypedNameRemovalResult> {
    try {
      // Get user's typed name removal preference
      const result = await this.pool.query(
        `SELECT preferences->'typedName' as typed_name_prefs
         FROM "user"
         WHERE id = $1`,
        [userId]
      );

      if (!result.rows.length || !result.rows[0].typed_name_prefs) {
        // No preferences set, return text as-is
        return {
          cleanedText: text,
          removedText: null,
          matchedPattern: null
        };
      }

      const preferences = result.rows[0].typed_name_prefs;
      const removalRegex = preferences.removalRegex;

      if (!removalRegex) {
        // No removal regex configured
        return {
          cleanedText: text,
          removedText: null,
          matchedPattern: null
        };
      }

      // Apply the removal regex - work from bottom up, remove only first match
      try {
        const regex = new RegExp(removalRegex, 'mi'); 
        
        // Split text into lines
        const lines = text.split('\n');
        
        // Work from bottom up
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i];
          const match = line.match(regex);
          
          if (match) {
            // Remove the matched text from this line
            lines[i] = line.replace(regex, '').trim();
            
            // Remove the line entirely if it's now empty
            if (lines[i] === '') {
              lines.splice(i, 1);
            }
            
            // Join back together and clean up extra newlines at the end
            const cleanedText = lines.join('\n').replace(/\n+$/, '\n').trim();
            
            return {
              cleanedText,
              removedText: match[0],
              matchedPattern: removalRegex
            };
          }
        }
      } catch (regexError) {
        console.error(`Invalid regex pattern for user ${userId}: ${removalRegex}`, regexError);
      }

      // No matches found or regex error
      return {
        cleanedText: text,
        removedText: null,
        matchedPattern: null
      };
    } catch (error: unknown) {
      console.error('Error removing typed name:', error);
      // On error, return text as-is
      return {
        cleanedText: text,
        removedText: null,
        matchedPattern: null
      };
    }
  }

  /**
   * Get typed name append string for a user
   */
  async getTypedNameAppend(userId: string): Promise<string | null> {
    try {
      const result = await this.pool.query(
        `SELECT preferences->'typedName'->'appendString' as append_string
         FROM "user"
         WHERE id = $1`,
        [userId]
      );

      if (!result.rows.length || !result.rows[0].append_string) {
        return null;
      }

      // Remove quotes from JSON string value
      return result.rows[0].append_string.replace(/^"|"$/g, '');
    } catch (error: unknown) {
      console.error('Error getting typed name append:', error);
      return null;
    }
  }
}