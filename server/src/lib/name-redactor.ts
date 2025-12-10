import nlp from 'compromise';

export interface RedactionResult {
  text: string;
  namesFound: string[];
  emailsFound: string[];
  redactionMap: Map<string, string>;
}

export class NameRedactor {
  private customNames: Set<string> = new Set();
  private emailPattern = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
  
  /**
   * Redact names and emails in text, replacing them with tokens like [firstname], [lastname], [email], etc.
   */
  redactNames(text: string): RedactionResult {
    const namesFound: string[] = [];
    const emailsFound: string[] = [];
    const redactionMap = new Map<string, string>();
    
    // Step 1: Find and redact email addresses
    const emailMatches: { placeholder: string; original: string }[] = [];
    let protectedText = text.replace(this.emailPattern, (match) => {
      emailsFound.push(match);
      const placeholder = `__EMAIL_${emailMatches.length}__`;
      emailMatches.push({ placeholder, original: '[email]' });
      return placeholder;
    });
    
    // Step 2: Use compromise to find names
    let doc = nlp(protectedText);
    
    // Get all people, but we'll need to clean them
    const peopleMatches = doc.people().json();
    
    // Step 3: Clean and process each person found
    peopleMatches.forEach((match: any) => {
      const terms = match.terms;
      
      // Extract just the name parts, excluding punctuation
      const nameParts = terms
        .filter((term: any) => {
          // Keep only terms tagged as names or proper nouns
          const tags = term.tags;
          return tags.includes('Person') || 
                 tags.includes('FirstName') || 
                 tags.includes('LastName') ||
                 tags.includes('ProperNoun');
        })
        .map((term: any) => term.text);
      
      if (nameParts.length === 0) return;
      
      const fullName = nameParts.join(' ');
      namesFound.push(fullName);
      
      // Determine redaction pattern
      let redactionPattern: string;
      
      // Check if it's a title + name
      if (nameParts[0]?.match(/^(Mr|Mrs|Ms|Dr|Prof|Sir|Lord|Lady)\.?$/i)) {
        if (nameParts.length === 2) {
          redactionPattern = '[title] [lastname]';
        } else if (nameParts.length >= 3) {
          redactionPattern = '[title] [firstname] [lastname]';
        } else {
          redactionPattern = '[title]';
        }
      } else {
        // Regular names
        if (nameParts.length === 1) {
          redactionPattern = '[firstname]';
        } else if (nameParts.length === 2) {
          redactionPattern = '[firstname] [lastname]';
        } else {
          redactionPattern = '[fullname]';
        }
      }
      
      redactionMap.set(fullName, redactionPattern);
    });
    
    // Step 4: Add custom names
    this.customNames.forEach(name => {
      if (!redactionMap.has(name)) {
        namesFound.push(name);
        const parts = name.split(' ');
        if (parts.length === 1) {
          redactionMap.set(name, '[firstname]');
        } else {
          redactionMap.set(name, '[firstname] [lastname]');
        }
      }
    });
    
    // Step 5: Perform replacements
    let result = protectedText;
    
    // Sort by length (longest first) to handle "John Smith" before "John"
    const sortedNames = Array.from(redactionMap.keys()).sort((a, b) => b.length - a.length);
    
    sortedNames.forEach(name => {
      const pattern = redactionMap.get(name)!;
      
      // Create regex that:
      // - Matches the name as whole words
      // - Captures optional possessive 's
      // - Doesn't match if preceded by @ (email)
      const nameRegex = new RegExp(
        `(?<!@)\\b${this._escapeRegex(name)}(?:'s)?\\b`,
        'gi'
      );
      
      result = result.replace(nameRegex, (match) => {
        // Check if it's possessive
        if (match.endsWith("'s")) {
          // For possessive, use the last part of the pattern
          const parts = pattern.split(' ');
          const lastPart = parts[parts.length - 1];
          return lastPart + "'s";
        }
        return pattern;
      });
    });
    
    // Step 6: Handle special patterns
    // Fix "-Name" pattern at end of lines or before punctuation
    result = result.replace(/\s*-\s*\[firstname\]/g, ' -[firstname]');
    
    // Step 7: Restore email placeholders with [email]
    emailMatches.forEach(({ placeholder, original }) => {
      result = result.replace(placeholder, original);
    });
    
    return {
      text: result,
      namesFound: Array.from(new Set(namesFound)),
      emailsFound: Array.from(new Set(emailsFound)),
      redactionMap
    };
  }
  
  /**
   * Add custom names to the detection list
   */
  addCustomNames(names: string[]): void {
    names.forEach(name => {
      this.customNames.add(name.trim());
    });
  }
  
  /**
   * Clear custom names
   */
  clearCustomNames(): void {
    this.customNames.clear();
  }

  private _escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// Export singleton instance
export const nameRedactor = new NameRedactor();