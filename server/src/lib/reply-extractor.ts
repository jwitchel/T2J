import EmailReplyParser from 'email-reply-parser';
import EmailForwardParser from 'email-forward-parser';
import { convert as htmlToText } from 'html-to-text';
import { EmailMarkers, isEmailMarker } from './email-markers';

export interface ReplyExtractionResult {
  userReply: string;
}

export interface SplitReplyResult {
  userReply: string;
  respondedTo: string;
  wasForwarded?: boolean;      // Whether the email was detected as a forward
  forwardMarker?: string;       // The marker to use if content is empty after processing
}

export class ReplyExtractor {
  private parser: EmailReplyParser;
  private forwardParser: EmailForwardParser;

  constructor() {
    this.parser = new EmailReplyParser();
    this.forwardParser = new EmailForwardParser();
  }

  /**
   * Extract only the user's written text from an email, removing all quoted content
   */
  extractUserText(emailBody: string, subject?: string): string {
    if (!emailBody || emailBody.trim() === '') {
      return '';
    }

    try {
      // Pre-process to handle special quote patterns that email-reply-parser misses
      const preprocessed = this._preprocessQuotePatterns(emailBody, subject);

      // If preprocessing returned just a marker, return it directly
      // Don't pass markers through email-reply-parser as they may be filtered out
      if (isEmailMarker(preprocessed.trim())) {
        return preprocessed.trim();
      }

      // Parse the email body
      const parsed = this.parser.read(preprocessed);

      // Post-process fragments to handle code continuation issues
      const fragments = this._mergeCodeContinuations(parsed.getFragments());

      // Get only the non-quoted fragments
      // We now check both isQuoted() and isHidden() but with special handling
      const visibleFragments = fragments
        .filter(fragment => {
          // Always exclude quoted fragments
          if (fragment.isQuoted()) return false;

          // For hidden fragments, check if it's actually a quote pattern
          if (fragment.isHidden()) {
            const content = fragment.getContent();
            return !this._isQuotePattern(content);
          }

          return true;
        })
        .map(fragment => fragment.getContent())
        .join('\n');

      return visibleFragments.trim();
    } catch (error: unknown) {
      // If parsing fails, return the original text
      console.error('Failed to parse email for reply extraction:', error);
      return emailBody.trim();
    }
  }

  /**
   * Extract user text with additional metadata about the email
   */
  extractWithMetadata(emailBody: string, subject?: string): ReplyExtractionResult {
    if (!emailBody || emailBody.trim() === '') {
      return {
        userReply: ''
      };
    }

    try {
      // Pre-process to handle special quote patterns
      const preprocessed = this._preprocessQuotePatterns(emailBody, subject);

      // If preprocessing returned just a marker, return it directly
      // Don't pass markers through email-reply-parser as they may be filtered out
      if (isEmailMarker(preprocessed.trim())) {
        return {
          userReply: preprocessed.trim()
        };
      }

      const parsed = this.parser.read(preprocessed);
      const fragments = this._mergeCodeContinuations(parsed.getFragments());

      // Get only the non-quoted fragments with special handling for hidden fragments
      const visibleFragments = fragments
        .filter(fragment => {
          if (fragment.isQuoted()) return false;
          if (fragment.isHidden()) {
            return !this._isQuotePattern(fragment.getContent());
          }
          return true;
        })
        .map(fragment => fragment.getContent())
        .join('\n')
        .trim();

      return {
        userReply: visibleFragments
      };
    } catch (error: unknown) {
      console.error('Failed to parse email for reply extraction:', error);
      return {
        userReply: emailBody.trim()
      };
    }
  }

  /**
   * Extract user text from HTML email by converting to plain text first
   */
  extractFromHtml(htmlContent: string, subject?: string): string {
    // Convert HTML to plain text using the html-to-text library
    const textContent = htmlToText(htmlContent, {
      wordwrap: false,
      preserveNewlines: true,
      selectors: [
        // Preserve line breaks from block elements
        { selector: 'p', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
        { selector: 'br', options: { leadingLineBreaks: 1 } },
        { selector: 'div', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
        { selector: 'h1', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
        { selector: 'h2', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
        { selector: 'h3', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
        { selector: 'h4', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
        { selector: 'h5', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
        { selector: 'h6', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
        // Remove images alt text as they're not user content
        { selector: 'img', format: 'skip' },
        // Preserve link text but not URLs
        { selector: 'a', options: { ignoreHref: true } }
      ]
    });
    return this.extractUserText(textContent, subject);
  }

  /**
   * Merge code continuation fragments that were incorrectly split
   */
  private _mergeCodeContinuations(fragments: any[]): any[] {
    if (fragments.length < 2) return fragments;
    
    const merged: any[] = [];
    let i = 0;
    
    while (i < fragments.length) {
      const current = fragments[i];
      merged.push(current);
      
      // Check if the next fragment might be a code continuation
      if (i + 1 < fragments.length && current.isQuoted()) {
        const next = fragments[i + 1];
        
        // If the next fragment is non-quoted, starts with spaces, and looks like code
        if (!next.isQuoted() &&
            !next.isHidden() &&
            this._looksLikeCodeContinuation(next.getContent())) {
          
          // Check if there's a pattern suggesting this is a continuation
          const currentContent = current.getContent();
          const nextContent = next.getContent();
          
          // If the current fragment ends with an opening brace or incomplete statement
          if (this._isIncompleteCodeBlock(currentContent)) {
            // Merge the next fragment into the current one
            current._content = currentContent + '\n' + nextContent;
            i++; // Skip the next fragment since we merged it
          }
        }
      }
      
      i++;
    }
    
    return merged;
  }

  /**
   * Check if text looks like a code continuation
   */
  private _looksLikeCodeContinuation(text: string): boolean {
    // Starts with 2+ spaces (common code indentation)
    if (!/^\s{2,}/.test(text)) return false;
    
    // Contains common code patterns
    const codePatterns = [
      /console\.log/,
      /function/,
      /return/,
      /[{}();]/,
      /\w+\s*\(/,  // function calls
      /['"]/       // strings
    ];
    
    return codePatterns.some(pattern => pattern.test(text));
  }

  /**
   * Check if a code block appears incomplete
   */
  private _isIncompleteCodeBlock(text: string): boolean {
    // Count opening and closing braces
    const openBraces = (text.match(/{/g) || []).length;
    const closeBraces = (text.match(/}/g) || []).length;
    
    // If there are more opening than closing braces, it's incomplete
    if (openBraces > closeBraces) return true;
    
    // Check if it ends with common incomplete patterns
    const incompletePatterns = [
      /{\s*$/,           // ends with opening brace
      /\(\s*$/,          // ends with opening parenthesis
      /,\s*$/,           // ends with comma
      /\|\|\s*$/,        // ends with OR operator
      /&&\s*$/,          // ends with AND operator
      /=\s*$/,           // ends with assignment
    ];
    
    return incompletePatterns.some(pattern => pattern.test(text.trim()));
  }

  /**
   * Pre-process email to handle special quote patterns
   * Handles various email client formats for forwards and replies
   *
   * Process order:
   * 1. email-forward-parser (detects forwards from major clients)
   * 2. Custom regex patterns (catches remaining edge cases)
   */
  private _preprocessQuotePatterns(emailBody: string, subject?: string): string {
    let processed = emailBody;

    // Step 1: Use email-forward-parser to detect and remove forwarded content
    // This library handles: Apple Mail, Gmail, Outlook (multiple versions), Yahoo,
    // Thunderbird, Missive, HubSpot, and more with locale support
    try {
      const forwardResult = this.forwardParser.read(emailBody, subject);

      if (forwardResult.forwarded) {
        // If email was forwarded, keep only the forwarding message (user's added text)
        // and replace the original forwarded content with a marker
        processed = forwardResult.message!;

        // Add marker to indicate forwarded content was removed
        // Note: Don't use '>' prefix as email-reply-parser treats it as quoted content
        if (processed.trim()) {
          processed += `\n\n${EmailMarkers.FORWARDED_CONTENT_REMOVED}`;
        } else {
          // User added no message before forwarding - use marker
          processed = EmailMarkers.FORWARDED_CONTENT_REMOVED;
        }

        // Return early - email-forward-parser already handled the forward
        return processed;
      }
    } catch (error) {
      // If email-forward-parser fails, continue with custom patterns
      console.warn('[ReplyExtractor] email-forward-parser failed, using fallback patterns:', error);
    }

    // Step 2: Custom regex patterns for edge cases not handled by email-forward-parser

    // Handle "-----Original Message-----" pattern (Outlook)
    processed = processed.replace(
      /(?:\r?\n|^)-{3,}\s*Original Message\s*-{3,}[\s\S]*/i,
      '\n> [Quoted content removed]'
    );

    // Handle "---------- Forwarded message ---------" pattern (Gmail)
    processed = processed.replace(
      /(?:\r?\n|^)-{5,}\s*Forwarded message\s*-{5,}[\s\S]*/i,
      '\n> [Forwarded content removed]'
    );

    // Handle "Begin forwarded message:" pattern (Apple Mail)
    processed = processed.replace(
      /(?:\r?\n|^)Begin forwarded message:\s*(?:\r?\n)+[\s\S]*/i,
      '\n> [Forwarded content removed]'
    );

    // Handle "-------- Forwarded Message --------" pattern (variations)
    processed = processed.replace(
      /(?:\r?\n|^)-{4,}\s*Forwarded Message\s*-{4,}[\s\S]*/i,
      '\n> [Forwarded content removed]'
    );

    // Handle "On DATE at TIME, PERSON wrote:" pattern (inline replies)
    processed = processed.replace(
      /(?:\r?\n){2,}On\s+.+?(?:at|@)\s+.+?(?:wrote|said):\s*(?:\r?\n)+[\s\S]*/i,
      '\n\n> [Quoted reply removed]'
    );

    // Handle "Le DATE, PERSON a écrit :" pattern (French)
    processed = processed.replace(
      /(?:\r?\n){2,}Le\s+.+?,\s+.+?\s+a\s+écrit\s*:\s*(?:\r?\n)+[\s\S]*/i,
      '\n\n> [Quoted reply removed]'
    );

    // Handle "Am DATE schrieb PERSON:" pattern (German)
    processed = processed.replace(
      /(?:\r?\n){2,}Am\s+.+?\s+schrieb\s+.+?:\s*(?:\r?\n)+[\s\S]*/i,
      '\n\n> [Quoted reply removed]'
    );

    // Handle Outlook-style header block (From: / Sent: / To: / Subject:)
    processed = processed.replace(
      /(?:\r?\n){2,}From:\s*.+?(?:\r?\n)+(?:Sent|Date):\s*.+?(?:\r?\n)+To:\s*.+?(?:\r?\n)+Subject:\s*.+?(?:\r?\n)+[\s\S]*/i,
      '\n\n> [Quoted content removed]'
    );

    return processed;
  }

  /**
   * Check if a hidden fragment is actually a quote pattern
   */
  private _isQuotePattern(content: string): boolean {
    const trimmed = content.trim();
    const quotePatterns = [
      /^-{3,}\s*Original Message\s*-{3,}/i,
      /^-{4,}\s*Forwarded [Mm]essage\s*-{4,}/i,
      /^Begin forwarded message:/i,
      /^From:\s*.+[\r\n]+(?:Sent|Date):\s*.+[\r\n]+To:\s*.+[\r\n]+Subject:/i,
      /^On .+(?:at|@).+(?:wrote|said):/i,
      /^Le\s+.+,\s+.+\s+a\s+écrit\s*:/i,
      /^Am\s+.+\s+schrieb\s+.+:/i
    ];

    return quotePatterns.some(pattern => pattern.test(trimmed));
  }


  /**
   * Split email into user's reply and quoted content
   */
  splitReply(emailBody: string, subject?: string): SplitReplyResult {
    if (!emailBody || emailBody.trim() === '') {
      return {
        userReply: '',
        respondedTo: ''
      };
    }

    try {
      // Pre-process to handle special quote patterns
      const preprocessed = this._preprocessQuotePatterns(emailBody, subject);

      // If preprocessing returned just a marker, return it directly
      // Don't pass markers through email-reply-parser as they may be filtered out
      if (isEmailMarker(preprocessed.trim())) {
        const marker = preprocessed.trim();
        return {
          userReply: marker,
          respondedTo: '',
          wasForwarded: marker === EmailMarkers.FORWARDED_CONTENT_REMOVED,
          forwardMarker: marker
        };
      }

      // Check if preprocessed contains a marker that we need to preserve
      // Markers are added by forward detection after user content
      let preservedMarker = '';
      let textToProcess = preprocessed;

      // Check for markers at the end of the text
      for (const marker of [EmailMarkers.FORWARDED_CONTENT_REMOVED, EmailMarkers.ATTACHMENT_ONLY]) {
        if (preprocessed.includes(marker)) {
          preservedMarker = marker;
          // Remove the marker temporarily so email-reply-parser doesn't filter it
          textToProcess = preprocessed.replace(new RegExp(`\\n\\n${this._escapeRegex(marker)}$`), '').trim();
          break;
        }
      }

      // Parse the email body
      const parsed = this.parser.read(textToProcess);

      // Post-process fragments to handle code continuation issues
      const fragments = this._mergeCodeContinuations(parsed.getFragments());

      // Separate user reply from quoted content
      const userFragments: string[] = [];
      const quotedFragments: string[] = [];

      fragments.forEach(fragment => {
        const content = fragment.getContent();

        if (fragment.isQuoted()) {
          quotedFragments.push(content);
        } else if (fragment.isHidden() && this._isQuotePattern(content)) {
          quotedFragments.push(content);
        } else if (!fragment.isHidden()) {
          userFragments.push(content);
        }
      });

      let userReply = userFragments.join('\n').trim();
      const respondedTo = quotedFragments.join('\n').trim();

      // If we had a marker and no user content remains, use the marker
      // This happens when forward contained only signature/quoted content
      // NOTE: This check is for when email-reply-parser filtered everything out
      // There's also a check in email-processor.ts after signature removal
      if (preservedMarker && userReply.length === 0) {
        userReply = preservedMarker;
      }

      return {
        userReply,
        respondedTo,
        wasForwarded: !!preservedMarker && preservedMarker === EmailMarkers.FORWARDED_CONTENT_REMOVED,
        forwardMarker: preservedMarker || undefined
      };
    } catch (error: unknown) {
      console.error('Failed to split email:', error);
      // Fallback: try to split on common patterns
      return this._fallbackSplit(emailBody);
    }
  }

  /**
   * Escape special regex characters
   */
  private _escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Fallback method to split email on common patterns
   */
  private _fallbackSplit(emailBody: string): SplitReplyResult {
    // Look for common reply markers
    const replyMarkers = [
      /\nOn .+ wrote:\s*\n/i,
      /\n-----\s*Original Message\s*-----\s*\n/i,
      /\n_{10,}\s*\n/,
      /\n-{10,}\s*\n/,
      /\nFrom:\s*.+\nSent:\s*.+\nTo:\s*.+\nSubject:.+\n/i
    ];
    
    for (const marker of replyMarkers) {
      const match = emailBody.match(marker);
      if (match && match.index !== undefined) {
        const splitPoint = match.index;
        return {
          userReply: emailBody.substring(0, splitPoint).trim(),
          respondedTo: emailBody.substring(splitPoint).trim()
        };
      }
    }
    
    // No reply marker found - entire email is user's content
    return {
      userReply: '',
      respondedTo: ''
    };
  }
}

// Export singleton instance
export const replyExtractor = new ReplyExtractor();