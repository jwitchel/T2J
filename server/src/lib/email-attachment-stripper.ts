import PostalMime from 'postal-mime';

/**
 * Utility class for stripping attachments from raw RFC 5322 emails
 * while preserving headers and text content for LLM processing
 */
export class EmailAttachmentStripper {
  /**
   * Strips attachments from raw RFC 5322 email while preserving headers and text content
   * This reduces token count for LLM processing while maintaining spam detection capabilities
   * 
   * @param rawEmail - Raw RFC 5322 formatted email string
   * @returns Reconstructed email without attachment data
   */
  static async stripAttachments(rawEmail: string): Promise<string> {
    try {
      // Parse the raw email
      const parser = new PostalMime();
      const parsed = await parser.parse(rawEmail);
      
      // Extract headers from original email
      const headerEndIndex = rawEmail.indexOf('\r\n\r\n');
      const headers = headerEndIndex > -1 
        ? rawEmail.substring(0, headerEndIndex)
        : rawEmail.substring(0, rawEmail.indexOf('\n\n'));
      
      // Build email body without attachments
      let bodyParts: string[] = [];
      
      // Add text content if available
      if (parsed.text) {
        bodyParts.push('Content-Type: text/plain; charset=utf-8');
        bodyParts.push('');
        bodyParts.push(parsed.text);
      }
      
      // Add HTML content if available (and different from text)
      if (parsed.html && parsed.html !== parsed.text) {
        if (bodyParts.length > 0) {
          bodyParts.push('');
          bodyParts.push('--boundary-stripped');
        }
        bodyParts.push('Content-Type: text/html; charset=utf-8');
        bodyParts.push('');
        bodyParts.push(parsed.html);
      }
      
      // Add attachment placeholders
      if (parsed.attachments && parsed.attachments.length > 0) {
        bodyParts.push('');
        bodyParts.push('--boundary-stripped');
        bodyParts.push('Content-Type: text/plain; charset=utf-8');
        bodyParts.push('');
        bodyParts.push('=== ATTACHMENTS REMOVED FOR PROCESSING ===');
        
        for (const attachment of parsed.attachments) {
          const filename = attachment.filename || 'unnamed';
          const size = attachment.content ? 
            (typeof attachment.content === 'string' ? attachment.content.length : attachment.content.byteLength) : 
            0;
          const sizeKB = Math.round(size / 1024);
          const mimeType = attachment.mimeType || 'unknown';
          
          bodyParts.push(`[Attachment removed: ${filename} (${sizeKB}KB, type: ${mimeType})]`);
        }
        
        bodyParts.push('=== END ATTACHMENTS ===');
      }
      
      // If we have multiple parts, add MIME structure
      let reconstructedBody: string;
      if (parsed.html || (parsed.attachments && parsed.attachments.length > 0)) {
        // Multi-part email
        reconstructedBody = [
          'Content-Type: multipart/mixed; boundary="boundary-stripped"',
          '',
          '--boundary-stripped',
          bodyParts.join('\r\n'),
          '--boundary-stripped--'
        ].join('\r\n');
      } else {
        // Simple text email
        reconstructedBody = bodyParts.join('\r\n');
      }
      
      // Combine headers with stripped body
      return headers + '\r\n\r\n' + reconstructedBody;
      
    } catch (error: unknown) {
      console.error('Error stripping attachments from email:', error);
      
      // Fallback: Try simple regex-based removal for common attachment patterns
      return EmailAttachmentStripper.fallbackStripAttachments(rawEmail);
    }
  }
  
  /**
   * Fallback method using regex to remove base64 encoded attachments
   * Used when PostalMime parsing fails
   */
  private static fallbackStripAttachments(rawEmail: string): string {
    try {
      // Remove base64 encoded content blocks
      // Pattern: Content-Transfer-Encoding: base64 followed by base64 data
      let stripped = rawEmail.replace(
        /Content-Transfer-Encoding:\s*base64\r?\n\r?\n[A-Za-z0-9+\/\r\n]+=*/g,
        'Content-Transfer-Encoding: base64\r\n\r\n[Base64 attachment removed for processing]'
      );
      
      // Remove large blocks of continuous base64 data (safety net)
      // This catches base64 blocks that might not have proper headers
      stripped = stripped.replace(
        /(?:[A-Za-z0-9+\/]{76}\r?\n){20,}[A-Za-z0-9+\/\r\n]+=*/g,
        '[Large base64 block removed for processing]'
      );
      
      // Remove Content-Disposition: attachment sections
      // Using [\s\S] instead of . with 's' flag for compatibility
      stripped = stripped.replace(
        /Content-Disposition:\s*attachment[\s\S]+?(?=--boundary|--[A-Za-z0-9_-]+--|$)/g,
        'Content-Disposition: attachment\r\n[Attachment content removed for processing]\r\n'
      );
      
      return stripped;
      
    } catch (fallbackError) {
      console.error('Fallback attachment stripping also failed:', fallbackError);
      // Return original if both methods fail
      return rawEmail;
    }
  }
  
  /**
   * Quick check if email likely has attachments
   * Used for optimization and metadata tracking
   * 
   * @param rawEmail - Raw RFC 5322 formatted email string
   * @returns true if email likely contains attachments
   */
  static hasAttachments(rawEmail: string): boolean {
    // Check for common attachment indicators
    const attachmentIndicators = [
      /Content-Disposition:\s*attachment/i,
      /Content-Type:\s*application\//i,
      /Content-Type:\s*image\//i,
      /Content-Type:\s*video\//i,
      /Content-Type:\s*audio\//i,
      /Content-Transfer-Encoding:\s*base64/i,
      /filename=/i,
      /name="/i
    ];
    
    return attachmentIndicators.some(pattern => pattern.test(rawEmail));
  }
  
  /**
   * Estimates the size reduction from stripping attachments
   * Useful for logging and metrics
   * 
   * @param originalSize - Size of original email in bytes
   * @param strippedSize - Size of stripped email in bytes
   * @returns Object with size metrics
   */
  static calculateSizeReduction(originalSize: number, strippedSize: number): {
    originalSizeKB: number;
    strippedSizeKB: number;
    reductionKB: number;
    reductionPercent: number;
  } {
    const originalKB = Math.round(originalSize / 1024);
    const strippedKB = Math.round(strippedSize / 1024);
    const reductionKB = originalKB - strippedKB;
    const reductionPercent = originalSize > 0 
      ? Math.round((reductionKB / originalKB) * 100)
      : 0;
    
    return {
      originalSizeKB: originalKB,
      strippedSizeKB: strippedKB,
      reductionKB,
      reductionPercent
    };
  }
}