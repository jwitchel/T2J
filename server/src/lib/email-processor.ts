import { ParsedMail } from 'mailparser';
import { emailContentParser, ParsedEmailContent } from './email-content-parser';
import { replyExtractor } from './reply-extractor';
import { realTimeLogger } from './real-time-logger';
import { Pool } from 'pg';
import { RegexSignatureDetector } from './regex-signature-detector';
import { TypedNameRemover } from './typed-name-remover';

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
    this.typedNameRemover = new TypedNameRemover(pool);
  }

  /**
   * Process a parsed email to extract only the user's written content
   */
  async processEmail(parsedMail: ParsedMail, context?: ProcessingContext): Promise<ProcessedEmail> {
    const startTime = Date.now();
    
    // Log the start of processing
    // if (context) {
    //   realTimeLogger.log(context.userId, {
    //     userId: context.userId,
    //     emailAccountId: context.emailAccountId,
    //     level: 'info',
    //     command: 'EMAIL_PARSE_START',
    //     data: {
    //       parsed: {
    //         messageId: parsedMail.messageId,
    //         subject: parsedMail.subject,
    //         from: parsedMail.from?.text,
    //         date: parsedMail.date?.toISOString(),
    //         originalText: parsedMail.text?.substring(0, 500) + (parsedMail.text && parsedMail.text.length > 500 ? '...' : '')
    //       }
    //     }
    //   });
    // }
    
    // First, parse the basic email content (userTextPlain, userTextRich)
    const parsedContent = emailContentParser.parseFromMailparser(parsedMail);
    
    // Extract the user's reply from the plain text
    let plainResult = replyExtractor.extractWithMetadata(parsedContent.userTextPlain);
    
    // Split the email into user reply and quoted content from the original text
    const splitResult = replyExtractor.splitReply(parsedContent.userTextPlain);
    
    // Remove signature from userReply if it exists
    let userReplyClean = splitResult.userReply;
    if (splitResult.userReply && context?.userId) {
      const signatureResult = await this.signatureDetector.removeSignature(splitResult.userReply, context.userId);
      userReplyClean = signatureResult.cleanedText;

      // Remove typed name from userReply
      const typedNameResult = await this.typedNameRemover.removeTypedName(userReplyClean, context.userId);
      userReplyClean = typedNameResult.cleanedText;
      
      if (typedNameResult.removedText) {
        realTimeLogger.log(context.userId, {
          userId: context.userId,
          emailAccountId: context.emailAccountId,
          level: 'info',
          command: 'TYPED_NAME_REMOVED',
          data: {
            parsed: {
              messageId: parsedMail.messageId,
              removedText: typedNameResult.removedText,
              matchedPattern: typedNameResult.matchedPattern
            }
          }
        });
      }
    }
    
    // Extract only the user's written text from HTML if available
    let processedRichText: string | undefined;
    
    if (parsedContent.userTextRich) {
      // For HTML content, we need to extract the reply content
      // This is a bit more complex as we need to preserve HTML structure
      processedRichText = replyExtractor.extractFromHtml(parsedContent.userTextRich);      
    }

    const result: ProcessedEmail = {
      ...parsedContent,
      userTextPlain: plainResult.userReply,
      userTextRich: processedRichText,
      userReply: userReplyClean,  // User's reply with signature and typed name removed
      respondedTo: splitResult.respondedTo
    };

    // Log the completion of processing
    if (context) {
      const duration = Date.now() - startTime;
      realTimeLogger.log(context.userId, {
        userId: context.userId,
        emailAccountId: context.emailAccountId,
        level: 'info',
        command: 'EMAIL_PARSE_COMPLETE',
        data: {
          duration,
          parsed: {
            messageId: parsedMail.messageId,
            userReply: result.userTextPlain,
          }
        }
      });
    }

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