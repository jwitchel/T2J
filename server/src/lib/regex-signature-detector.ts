import { Pool } from 'pg';
const trim = require('@stdlib/string-trim');

export class RegexSignatureDetector {
  private userPatterns: Map<string, string[]> = new Map();
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Load signature patterns for a user from the database
   */
  async loadUserPatterns(userId: string): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT signature_patterns FROM "user" WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return [];
    }

    const patterns = result.rows[0].signature_patterns;
    this.userPatterns.set(userId, patterns);
    return patterns;
  }

  /**
   * Save signature patterns for a user
   */
  async saveUserPatterns(userId: string, patterns: string[]): Promise<void> {
    await this.pool.query(
      'UPDATE "user" SET signature_patterns = $1 WHERE id = $2',
      [patterns, userId]
    );
    this.userPatterns.set(userId, patterns);
  }

  /**
   * Get default signature patterns
   * @private
   */
  private _getDefaultPatterns(): string[] {
    // No default patterns - users must configure their own
    return [];
  }

  /**
   * Detect and remove signature from email text using regex patterns
   */
  async removeSignature(emailText: string, userId: string): Promise<{
    cleanedText: string;
    signature: string | null;
    matchedPattern: string | null;
  }> {
    // Get user patterns or use defaults
    let patterns = this.userPatterns.get(userId);
    if (!patterns || patterns.length === 0) {
      patterns = await this.loadUserPatterns(userId);
    }
    
    // If still no patterns, use defaults
    if (patterns.length === 0) {
      patterns = this._getDefaultPatterns();
    }

    let cleanedText = emailText;
    let allRemovedSignatures: string[] = [];
    let matchedPattern: string | null = null;

    // Process each pattern and remove ALL matches
    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'gim'); // Global, case insensitive, multiline
        const matches = cleanedText.match(regex);
        
        if (matches && matches.length > 0) {
          // Store all matches as signatures
          allRemovedSignatures.push(...matches);
          matchedPattern = pattern;
          
          // Replace all instances with empty string
          cleanedText = cleanedText.replace(regex, '');
        }
      } catch (e) {
        console.error(`Invalid regex pattern: ${pattern}`, e);
      }
    }

    // Trim the cleaned text using @stdlib/string-trim
    cleanedText = trim(cleanedText);

    if (allRemovedSignatures.length === 0) {
      return {
        cleanedText: emailText,
        signature: null,
        matchedPattern: null
      };
    }

    return {
      cleanedText,
      signature: allRemovedSignatures.join('\n\n'),
      matchedPattern
    };
  }

}

// Note: Instance must be created with a pool parameter
// export const regexSignatureDetector = new RegexSignatureDetector(pool);