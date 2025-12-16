import { ParsedMail, simpleParser } from 'mailparser';
import { convert as htmlToText } from 'html-to-text';
import { replyExtractor } from './reply-extractor';
import { Pool } from 'pg';
import { RegexSignatureDetector } from './regex-signature-detector';
import { TypedNameRemover } from './typed-name-remover';
import { isEmailMarker } from './email-markers';

export interface ParsedEmailContent {
  messageId: string;
  from: string;
  to: string[];
  sentDate: Date;
  userTextPlain: string;    // Plain text version of what user wrote
  userTextRich?: string;    // HTML/Rich text version if available
}

export interface ProcessedEmail extends ParsedEmailContent {
  userTextPlain: string;    // Override to ensure it's the extracted user text
  userTextRich?: string;    // Override to ensure it's the extracted user text
  // New fields for split content
  userReply: string;        // Just what the user wrote (no signature, no quotes)
  respondedTo: string;      // The quoted content the user was responding to
}

export interface ProcessingContext {
  userId: string;
  emailAccountId: string;
}

export class EmailProcessor {
  private signatureDetector: RegexSignatureDetector;
  private typedNameRemover: TypedNameRemover;

  constructor(pool: Pool) {
    this.signatureDetector = new RegexSignatureDetector(pool);
    this.typedNameRemover = new TypedNameRemover();
  }

  /**
   * Process a parsed email to extract only the user's written content
   */
  async processEmail(parsedMail: ParsedMail, context?: ProcessingContext): Promise<ProcessedEmail> {
    // First, parse the basic email content (userTextPlain, userTextRich)
    const parsedContent = this._parseFromMailparser(parsedMail);

    // Get subject for forward detection (email-forward-parser uses it to improve accuracy)
    const subject = parsedMail.subject;

    // Extract the user's reply from the plain text
    const plainResult = replyExtractor.extractWithMetadata(parsedContent.userTextPlain, subject);

    // Split the email into user reply and quoted content from the original text
    const splitResult = replyExtractor.splitReply(parsedContent.userTextPlain, subject);

    // Remove signature from userReply if it exists
    // Don't process email markers - they should be preserved as-is
    let userReplyClean = splitResult.userReply;
    if (splitResult.userReply && !isEmailMarker(splitResult.userReply) && context?.userId) {
      const signatureResult = await this.signatureDetector.removeSignature(splitResult.userReply, context.userId);
      userReplyClean = signatureResult.cleanedText;

      // Remove typed name from userReply
      const typedNameResult = await this.typedNameRemover.removeTypedName(userReplyClean, context.userId);
      userReplyClean = typedNameResult.cleanedText;

      // If this was a forward and we have no content left after signature/name removal,
      // mark it as forwarded content removed
      if (splitResult.wasForwarded && userReplyClean.trim().length === 0) {
        userReplyClean = splitResult.forwardMarker!;
      }
    }

    // Extract only the user's written text from HTML if available
    let processedRichText: string | undefined;

    if (parsedContent.userTextRich) {
      // For HTML content, we need to extract the reply content
      // This is a bit more complex as we need to preserve HTML structure
      processedRichText = replyExtractor.extractFromHtml(parsedContent.userTextRich, subject);
    }

    const result: ProcessedEmail = {
      ...parsedContent,
      userTextPlain: plainResult.userReply,
      userTextRich: processedRichText,
      userReply: userReplyClean,  // User's reply with signature and typed name removed
      respondedTo: splitResult.respondedTo
    };

    return result;
  }

  /**
   * Process raw email data
   */
  async processRawEmail(rawEmail: string | Buffer, context?: ProcessingContext): Promise<ProcessedEmail> {
    const parsedMail = await simpleParser(rawEmail);
    return this.processEmail(parsedMail, context);
  }

  /**
   * Extract text content from already parsed email
   */
  private _parseFromMailparser(parsedMail: ParsedMail): ParsedEmailContent {
    // Extract basic metadata
    const messageId = parsedMail.messageId || `generated-${Date.now()}`;
    const from = this._extractFromAddress(parsedMail);
    const to = this._extractToAddresses(parsedMail);
    const sentDate = parsedMail.date || new Date();

    // Extract text content
    // Handle malformed emails that have empty text/plain parts (e.g., Venmo receipts)
    // If text/plain exists but is empty/whitespace-only, fall back to HTML conversion
    let userTextPlain = parsedMail.text!;

    if (userTextPlain.trim().length === 0 && parsedMail.html) {
      // text/plain is empty but HTML exists - convert HTML to text
      userTextPlain = htmlToText(parsedMail.html, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' }
        ]
      });
    }

    const userTextRich = parsedMail.html || undefined;

    return {
      messageId,
      from,
      to,
      sentDate,
      userTextPlain,
      userTextRich
    };
  }

  /**
   * Extract sender email address
   * Trusts that parsedMail.from exists (valid emails have a From header per RFC 5322)
   */
  private _extractFromAddress(parsedMail: ParsedMail): string {
    // mailparser's AddressObject has value array with Address objects
    return parsedMail.from!.value[0].address!;
  }

  /**
   * Extract recipient email addresses
   * RFC 5322: To is optional (emails can use Bcc only)
   */
  private _extractToAddresses(parsedMail: ParsedMail): string[] {
    // To is optional per RFC 5322, return empty array if not present
    const toField = parsedMail.to;
    if (!toField) {
      return [];
    }

    if (Array.isArray(toField)) {
      return toField.flatMap(obj => obj.value.map(addr => addr.address!));
    }
    return toField.value.map(addr => addr.address!);
  }
}
