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

  // If no attachments, return original
  if (!parsed.attachments || parsed.attachments.length === 0) {
    return fullMessage;
  }

  // Filter attachments to strip: disposition="attachment" or "inline", but keep related=true (embedded images)
  const attachmentsToStrip = parsed.attachments.filter((att: any) => {
    // Keep embedded images (related=true)
    if (att.related === true) {
      return false;
    }
    // Strip if disposition is "attachment" or "inline"
    return att.disposition === 'attachment' || att.disposition === 'inline';
  });

  if (attachmentsToStrip.length === 0) {
    return fullMessage; // No attachments to strip
  }

  // Log what we're stripping
  const attachmentInfo = attachmentsToStrip.map((att: any) =>
    `${att.filename || 'unnamed'} (${att.mimeType}, ${att.disposition || 'no-disposition'}, ${(att.content?.length || 0).toLocaleString()} bytes)`
  ).join(', ');

  console.log(`[EmailAttachmentStripper] Stripping ${attachmentsToStrip.length} attachments: ${attachmentInfo}`);

  // Postal-mime has already parsed and excluded attachment content from text/html
  // Build clean message from parsed content (postal-mime already excluded attachments)
  const parts: string[] = [];
  
  if (parsed.text) {
    parts.push(parsed.text);
  }
  
  if (parsed.html) {
    parts.push('\n\n--- HTML Version ---\n' + parsed.html);
  }

  return parts.length > 0 ? parts.join('') : '(No content)';
}