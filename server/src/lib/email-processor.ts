import { ParsedMail } from 'mailparser';
import { emailContentParser, ParsedEmailContent } from './email-content-parser';
import { replyExtractor } from './reply-extractor';
import { Pool } from 'pg';
import { RegexSignatureDetector } from './regex-signature-detector';
import { TypedNameRemover } from './typed-name-remover';
import { isEmailMarker } from './email-markers';

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
    const parsedContent = emailContentParser.parseFromMailparser(parsedMail);

    // Get subject for forward detection (email-forward-parser uses it to improve accuracy)
    const subject = parsedMail.subject;

    // Extract the user's reply from the plain text
    let plainResult = replyExtractor.extractWithMetadata(parsedContent.userTextPlain, subject);

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
    const parsed = await emailContentParser.parseFromRaw(rawEmail);
    
    // Convert ParsedEmailContent to ParsedMail-like structure for processing
    // This is a bit of a hack, but works for our use case
    const pseudoParsed = {
      messageId: parsed.messageId,
      date: parsed.sentDate,
      text: parsed.userTextPlain,
      html: parsed.userTextRich,
      from: { text: parsed.from, value: [{ address: parsed.from }] },
      to: { text: parsed.to.join(', '), value: parsed.to.map(addr => ({ address: addr })) }
    } as any as ParsedMail;
    
    return this.processEmail(pseudoParsed, context);
  }
}

// Export singleton instance
// Note: Instance must be created with a pool parameter
// export const emailProcessor = new EmailProcessor(pool);