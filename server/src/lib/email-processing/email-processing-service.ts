/**
 * EmailProcessingService
 * Central orchestrator for email processing that eliminates duplicate work
 * Handles: parsing, user context loading, spam detection, and draft generation
 *
 * This service ensures:
 * - Email is parsed exactly once
 * - User context is fetched exactly once (single DB query)
 * - Spam detection happens before expensive draft generation
 * - Consistent flow for both automated and manual processing
 */

import PostalMime from 'postal-mime';
import { normalizeMessageId } from '../message-id-utils';

// Helper to format milliseconds as seconds (e.g., 8234ms → 8.2s)
function formatDuration(ms: number): string {
  return (ms / 1000).toFixed(1) + 's';
}

import { pool } from '../db';
import { getSpamDetector } from './spam-detector';
import { draftGenerator } from './draft-generator';
import { ProcessedEmail, EmailProcessingResult, SpamCheckResult } from '../pipeline/types';
import { EmailActions } from '../email-actions';
import { stripAttachments } from '../email-attachment-stripper';
import { RelationshipType } from '../relationships/relationship-detector';

/**
 * User context needed for email processing
 */
export interface UserContext {
  userEmail: string;
  userNames: {
    name: string;
    nicknames: string;
  };
  typedNameSignature: string;
  signatureBlock: string;
}

/**
 * Parsed email data
 */
export interface ParsedEmailData {
  parsed: any; // PostalMime result
  processedEmail: ProcessedEmail;
  emailBody: string;
}

export interface ProcessEmailParams {
  fullMessage: string;
  emailAccountId: string;
  providerId: string;
  userId: string;
}

export class EmailProcessingService {
  /**
   * Extract email body, handling HTML if no plain text is available
   * @private
   */
  private async extractEmailBody(parsed: any): Promise<string> {
    let emailBody = parsed.text || '';

    // Handle malformed emails with empty text/plain parts
    if (emailBody.trim().length === 0 && parsed.html) {
      const { convert } = await import('html-to-text');
      emailBody = convert(parsed.html, {
        wordwrap: false,
        preserveNewlines: true,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' }
        ]
      });
    }

    if (!emailBody || emailBody.trim().length === 0) {
      emailBody = '(No content)';
    }

    return emailBody;
  }


  /**
   * Parse email exactly once
   * @private
   */
  private async parseEmail(fullMessage: string, emailAccountId: string): Promise<ParsedEmailData> {
    const parser = new PostalMime();
    const parsed = await parser.parse(fullMessage);

    const fromAddress = parsed.from?.address || '';
    const fromName = parsed.from?.name || parsed.from?.address || '';
    const subject = parsed.subject || '';
    const to = (parsed.to || []).map((addr: any) => ({ address: addr.address || '', name: addr.name || '' }));
    const cc = (parsed.cc || []).map((addr: any) => ({ address: addr.address || '', name: addr.name || '' }));
    const replyTo = (parsed.replyTo || []).map((addr: any) => ({ address: addr.address || '', name: addr.name || '' }));
    const messageId = normalizeMessageId(parsed.messageId) || `${Date.now()}@${emailAccountId}`;
    const messageDate = parsed.date ? new Date(parsed.date) : new Date();
    const inReplyTo = parsed.inReplyTo || null;

    // Extract email body
    const emailBody = await this.extractEmailBody(parsed);

    // Create ProcessedEmail with ORIGINAL fullMessage (unmodified, with all attachments)
    // This will be stored in the database and used for draft generation
    const processedEmail: ProcessedEmail = {
      uid: messageId,
      messageId: messageId,
      inReplyTo: inReplyTo,
      date: messageDate,
      from: [{ address: fromAddress, name: fromName }],
      replyTo,
      to,
      cc,
      bcc: [],
      subject: subject,
      textContent: emailBody,
      htmlContent: parsed.html || null,
      userReply: emailBody,
      respondedTo: '', // Set by reply extractor when content is split into user text vs quoted text
      fullMessage: fullMessage // ORIGINAL - unmodified, includes all attachments
    };

    return { parsed, processedEmail, emailBody };
  }

  /**
   * Create a minimal draft for spam emails
   * @private
   */
  private createSpamDraft(parsedData: ParsedEmailData, userContext: UserContext, spamCheckResult: SpamCheckResult): any {
    const { processedEmail } = parsedData;

    return {
      id: `draft-${Date.now()}`,
      from: userContext.userEmail,
      to: processedEmail.from[0].address,
      cc: '',
      subject: processedEmail.subject || '',
      body: '',
      bodyHtml: undefined,
      inReplyTo: processedEmail.messageId || `<${Date.now()}>`,
      references: processedEmail.messageId || `<${Date.now()}>`,
      meta: {
        recommendedAction: EmailActions.SILENT_SPAM,
        keyConsiderations: spamCheckResult.indicators,
        inboundMsgAddressedTo: 'you',
        inboundMsgIsRequesting: 'none',
        urgencyLevel: 'low',
        contextFlags: {
          isThreaded: false,
          hasAttachments: false,
          isGroupEmail: false
        }
      },
      relationship: {
        type: RelationshipType.SPAM,
        confidence: 0.9
      },
      draftMetadata: {
        exampleCount: 0,
        timestamp: new Date().toISOString(),
        originalSubject: processedEmail.subject,
        originalFrom: processedEmail.from[0].address,
        spamAnalysis: {
          isSpam: spamCheckResult.isSpam,
          indicators: spamCheckResult.indicators,
          senderResponseCount: spamCheckResult.senderResponseCount
        }
      }
    };
  }

  /**
   * Load user context exactly once (single query joining account and user data)
   * @private
   */
  private async loadUserContext(userId: string, emailAccountId: string): Promise<UserContext> {
    // Single query to get both account email and user preferences
    const result = await pool.query(`
      SELECT
        ea.email_address,
        u.name,
        u.preferences
      FROM email_accounts ea
      JOIN "user" u ON u.id = ea.user_id
      WHERE ea.id = $1 AND ea.user_id = $2
    `, [emailAccountId, userId]);

    if (result.rows.length === 0) {
      throw new Error('Email account not found or does not belong to user');
    }

    const row = result.rows[0];
    const preferences = row.preferences || {};

    return {
      userEmail: row.email_address,
      userNames: {
        name: preferences.name || row.name || '',
        nicknames: preferences.nicknames || ''
      },
      typedNameSignature: preferences.typedName?.appendString || '',
      signatureBlock: preferences.signatureBlock || ''
    };
  }

  /**
   * Process an incoming email: check spam, generate draft if needed
   * This is the single entry point for processing an email
   */
  async processEmail(params: ProcessEmailParams): Promise<EmailProcessingResult> {
    const { fullMessage, emailAccountId, providerId, userId } = params;
    const totalStartTime = Date.now();

    try {
      // Step 1: Parse email
      const parsedData = await this.parseEmail(fullMessage, emailAccountId);

      // Step 2: Load user context
      const userContext = await this.loadUserContext(userId, emailAccountId);

      // Step 3: Create LLM-safe version (strip ALL attachments for LLM processing)
      // This prevents massive PDFs, images, etc. from bloating token count
      // Note: parsedData.processedEmail.fullMessage contains ORIGINAL with all attachments
      const llmSafeMessage = await stripAttachments(fullMessage, parsedData.parsed);

      // Step 4: Check for spam (using stripped version for LLM)
      const spamCheckStartTime = Date.now();
      const senderEmail = parsedData.processedEmail.from[0]?.address?.toLowerCase() || '';
      const replyTo = parsedData.processedEmail.replyTo[0]?.address?.toLowerCase();
      const spamDetector = await getSpamDetector(providerId);
      const spamCheckResult = await spamDetector.checkSpam({
        senderEmail,
        replyTo,
        fullMessage: llmSafeMessage, // Use stripped version for LLM
        subject: parsedData.processedEmail.subject,
        userNames: userContext.userNames,
        userId
      });
      const spamCheckDuration = Date.now() - spamCheckStartTime;

      // Step 5: Generate draft (or create spam draft)
      const draftStartTime = Date.now();
      let draftDuration = 0;
      let llmCalls = 1; // Spam check is always 1 LLM call

      // If spam detected, create a silent-spam draft instead of full generation
      if (spamCheckResult.isSpam) {
        const spamDraft = this.createSpamDraft(parsedData, userContext, spamCheckResult);
        draftDuration = Date.now() - draftStartTime;

        // Log concise summary
        const totalDuration = Date.now() - totalStartTime;
        console.log(`[EmailProcessingService] ⏱️ Processed in ${formatDuration(totalDuration)} (spam check: ${formatDuration(spamCheckDuration)}, LLM calls: ${llmCalls})`);

        return {
          success: true,
          draft: spamDraft
        };
      }

      // Not spam - generate full draft (pass spam check results for transparency)
      // Create a modified parsedData with llmSafeMessage for LLM prompts
      const llmParsedData = {
        ...parsedData,
        processedEmail: {
          ...parsedData.processedEmail,
          fullMessage: llmSafeMessage // Use stripped version for LLM prompts
        }
      };

      const result = await draftGenerator.generateDraft(userId, providerId, llmParsedData, userContext, spamCheckResult);
      draftDuration = Date.now() - draftStartTime;

      // Draft generation includes 2-3 LLM calls (meta-context, action, optional response)
      llmCalls += result.draft?.meta.recommendedAction.startsWith('silent') ? 2 : 3;

      // Log concise summary
      const totalDuration = Date.now() - totalStartTime;
      console.log(`[EmailProcessingService] ⏱️ Processed in ${formatDuration(totalDuration)} (spam: ${formatDuration(spamCheckDuration)}, draft: ${formatDuration(draftDuration)}, LLM calls: ${llmCalls})`);

      return result;

    } catch (error: unknown) {
      console.error('[EmailProcessingService] Error processing email:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error processing email';

      // Classify error by examining error message
      let errorCode: 'ACCOUNT_NOT_FOUND' | 'LLM_TIMEOUT' | 'PARSE_ERROR' | 'SPAM_DETECTED' | 'UNKNOWN' = 'UNKNOWN';

      if (errorMessage.includes('not found') || errorMessage.includes('does not belong')) {
        errorCode = 'ACCOUNT_NOT_FOUND';
      } else if (errorMessage.includes('timeout')) {
        errorCode = 'LLM_TIMEOUT';
      } else if (errorMessage.includes('parse') || errorMessage.includes('parsing')) {
        errorCode = 'PARSE_ERROR';
      }

      return {
        success: false,
        error: errorMessage,
        errorCode
      };
    }
  }
}

// Export singleton instance
export const emailProcessingService = new EmailProcessingService();
