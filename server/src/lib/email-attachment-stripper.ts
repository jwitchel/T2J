import PostalMime from 'postal-mime';

/**
 * Utility for stripping attachments from raw RFC 5322 emails
 * Relies on postal-mime's battle-tested parsing to exclude attachment content
 * Keeps embedded images (related=true) for proper email context
 */

/**
 * Strips attachments from raw email using postal-mime parsed structure
 * Removes attachments with disposition "attachment" or "inline" (unless related=true for embedded images)
 *
 * @param fullMessage - Raw RFC 5322 formatted email string
 * @param parsed - Optional pre-parsed postal-mime result (avoids double parsing)
 * @returns Email content without attachments
 */
export async function stripAttachments(fullMessage: string, parsed?: any): Promise<string> {
  // Parse email if not already parsed
  if (!parsed) {
    const parser = new PostalMime();
    parsed = await parser.parse(fullMessage);
  }

  // Rebuild RFC 5322 message with all headers but without attachment binary data
  const messageParts: string[] = [];

  // 1. Add message-level headers (skip MIME body headers that we'll regenerate)
  const skipHeaders = new Set([
    'content-type',
    'content-transfer-encoding',
    'content-disposition',
    'content-id',
    'mime-version'
  ]);

  if (parsed.headers && Array.isArray(parsed.headers)) {
    parsed.headers.forEach((header: any) => {
      const key = header.key;
      const keyLower = key.toLowerCase();

      // Skip body-related headers - we'll add our own
      if (!skipHeaders.has(keyLower)) {
        const value = header.value;
        messageParts.push(`${key}: ${value}`);
      }
    });
  }

  // Add MIME-Version header
  messageParts.push('MIME-Version: 1.0');

  // 2. Blank line separating headers from body
  messageParts.push('');

  // 3. Build message body
  const hasText = parsed.text && parsed.text.trim().length > 0;
  const hasHtml = parsed.html && parsed.html.trim().length > 0;

  if (hasText && hasHtml) {
    // Multipart/alternative message
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    messageParts.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    messageParts.push('');
    messageParts.push(`--${boundary}`);
    messageParts.push('Content-Type: text/plain; charset="UTF-8"');
    messageParts.push('');
    messageParts.push(parsed.text);
    messageParts.push('');
    messageParts.push(`--${boundary}`);
    messageParts.push('Content-Type: text/html; charset="UTF-8"');
    messageParts.push('');

    // Replace embedded image CIDs with placeholder
    let cleanHtml = parsed.html;
    const embeddedImageCids = new Set<string>();

    if (parsed.attachments) {
      parsed.attachments.forEach((att: any) => {
        const isImage = att.mimeType?.startsWith('image/');
        const isEmbedded = att.related === true || att.disposition === 'inline';

        if (isImage && isEmbedded && att.contentId) {
          const cid = att.contentId.replace(/^<|>$/g, '');
          embeddedImageCids.add(cid);
        }
      });

      embeddedImageCids.forEach((cid) => {
        const escapedCid = cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cidPattern = new RegExp(`src=["']cid:${escapedCid}["']`, 'gi');
        cleanHtml = cleanHtml.replace(cidPattern, 'src="[image removed]"');
      });
    }

    messageParts.push(cleanHtml);
    messageParts.push('');
    messageParts.push(`--${boundary}--`);
  } else if (hasHtml) {
    // HTML only
    messageParts.push('Content-Type: text/html; charset="UTF-8"');
    messageParts.push('');

    let cleanHtml = parsed.html;
    const embeddedImageCids = new Set<string>();

    if (parsed.attachments) {
      parsed.attachments.forEach((att: any) => {
        const isImage = att.mimeType?.startsWith('image/');
        const isEmbedded = att.related === true || att.disposition === 'inline';

        if (isImage && isEmbedded && att.contentId) {
          const cid = att.contentId.replace(/^<|>$/g, '');
          embeddedImageCids.add(cid);
        }
      });

      embeddedImageCids.forEach((cid) => {
        const escapedCid = cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cidPattern = new RegExp(`src=["']cid:${escapedCid}["']`, 'gi');
        cleanHtml = cleanHtml.replace(cidPattern, 'src="[image removed]"');
      });
    }

    messageParts.push(cleanHtml);
  } else if (hasText) {
    // Text only
    messageParts.push('Content-Type: text/plain; charset="UTF-8"');
    messageParts.push('');
    messageParts.push(parsed.text);
  } else {
    // No content
    messageParts.push('Content-Type: text/plain; charset="UTF-8"');
    messageParts.push('');
    messageParts.push('(No content)');
  }

  return messageParts.join('\r\n');
}