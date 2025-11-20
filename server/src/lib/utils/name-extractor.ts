/**
 * Utility class for extracting and normalizing person names from email addresses
 */
export class NameExtractor {
  /**
   * Extract person name from email address and recipient name
   * Priority: recipientName (if valid) > formatted email prefix as fallback
   *
   * @param emailAddress - The email address (e.g., "john.doe@example.com")
   * @param recipientName - Optional recipient name from email headers (e.g., "John Doe" or '"John Doe"')
   * @returns Cleaned and normalized name
   *
   * @example
   * extractName('raswheeler@gmail.com', 'Jessica Wheeler') // => 'Jessica Wheeler'
   * extractName('raswheeler@gmail.com', '"Jessica Wheeler"') // => 'Jessica Wheeler'
   * extractName('test@example.com', 'Viola, John L.') // => 'John L. Viola'
   * extractName('john.doe@example.com', undefined) // => 'John Doe'
   * extractName('j.w.smith@example.com', undefined) // => 'J W Smith'
   */
  public static extractName(emailAddress: string, recipientName?: string): string {
    // If we have a valid recipient name, use it
    if (recipientName && recipientName.trim().length > 0) {
      const cleanedName = this.cleanRecipientName(recipientName);

      // If after cleaning we have a valid name, use it
      if (cleanedName.length > 0) {
        return cleanedName;
      }
    }

    // Fallback: format the email prefix to be more readable
    return this.formatEmailPrefix(emailAddress);
  }

  /**
   * Clean recipient name by removing quotes, normalizing whitespace, and flipping Last, First format
   *
   * @param recipientName - Raw recipient name from email headers
   * @returns Cleaned name or empty string if invalid
   *
   * @example
   * cleanRecipientName('"Jessica Wheeler"') // => 'Jessica Wheeler'
   * cleanRecipientName('  John   Doe  ') // => 'John Doe'
   * cleanRecipientName('Viola, John L.') // => 'John L. Viola'
   * cleanRecipientName('Smith, Jane') // => 'Jane Smith'
   * cleanRecipientName('""') // => ''
   */
  private static cleanRecipientName(recipientName: string): string {
    // 1. Trim whitespace
    let cleanName = recipientName.trim();

    // 2. Remove leading quote (single or double)
    if (cleanName.startsWith('"') || cleanName.startsWith("'")) {
      cleanName = cleanName.slice(1);
    }

    // 3. Remove trailing quote (single or double)
    if (cleanName.endsWith('"') || cleanName.endsWith("'")) {
      cleanName = cleanName.slice(0, -1);
    }

    // 4. Trim again after quote removal
    cleanName = cleanName.trim();

    // 5. Flip "Last, First" format to "First Last"
    cleanName = this.flipLastFirstName(cleanName);

    // 6. Normalize internal whitespace
    return cleanName.replace(/\s+/g, ' ');
  }

  /**
   * Format email prefix to be more readable as a name
   * Converts: john.doe -> John Doe, j.w.smith -> J W Smith
   *
   * @param emailAddress - Full email address
   * @returns Formatted name from email prefix
   *
   * @example
   * formatEmailPrefix('john.doe@example.com') // => 'John Doe'
   * formatEmailPrefix('j.w.smith@example.com') // => 'J W Smith'
   * formatEmailPrefix('raswheeler@gmail.com') // => 'Raswheeler'
   */
  private static formatEmailPrefix(emailAddress: string): string {
    // Extract the part before @
    const emailPrefix = emailAddress.split('@')[0];

    // Replace dots with spaces
    const withSpaces = emailPrefix.replace(/\./g, ' ');

    // Capitalize each word
    const capitalized = withSpaces
      .split(' ')
      .map(word => this.capitalizeWord(word))
      .join(' ');

    return capitalized;
  }

  /**
   * Flip "Last, First" name format to "First Last"
   * Only flips if there is exactly one comma in the name
   *
   * @param name - Name that may be in "Last, First" format
   * @returns Name in "First Last" format
   *
   * @example
   * flipLastFirstName('Viola, John L.') // => 'John L. Viola'
   * flipLastFirstName('Smith, Jane') // => 'Jane Smith'
   * flipLastFirstName('John Doe') // => 'John Doe' (no comma, unchanged)
   * flipLastFirstName('Company, Inc., Legal') // => 'Company, Inc., Legal' (multiple commas, unchanged)
   */
  private static flipLastFirstName(name: string): string {
    // Count commas in the name
    const commaCount = (name.match(/,/g) || []).length;

    // Only flip if there is exactly one comma
    if (commaCount !== 1) {
      return name;
    }

    // Split on the comma
    const parts = name.split(',').map(part => part.trim());

    // If we don't have exactly 2 parts, don't flip
    if (parts.length !== 2) {
      return name;
    }

    const [lastName, firstName] = parts;

    // Flip to "First Last" format
    return `${firstName} ${lastName}`;
  }

  /**
   * Capitalize the first letter of a word
   *
   * @param word - Word to capitalize
   * @returns Capitalized word
   *
   * @example
   * capitalizeWord('john') // => 'John'
   * capitalizeWord('j') // => 'J'
   * capitalizeWord('') // => ''
   */
  private static capitalizeWord(word: string): string {
    if (word.length === 0) {
      return word;
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
}
