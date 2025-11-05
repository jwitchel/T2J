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
import { pool } from '../../server';
import { SpamDetector, SpamCheckResult } from './spam-detector';
import { draftGenerator } from './draft-generator';
import { ProcessedEmail, EmailProcessingResult } from '../pipeline/types';
import { EmailActions } from '../email-actions';

// Provider-keyed cache to avoid race conditions when processing emails concurrently
// with different providers
const spamDetectorCache = new Map<string, SpamDetector>();

async function getSpamDetector(providerId: string): Promise<SpamDetector> {
  let detector = spamDetectorCache.get(providerId);

  if (!detector) {
    detector = new SpamDetector();
    await detector.initialize(providerId);
    spamDetectorCache.set(providerId, detector);
  }

  return detector;
}

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
  rawMessage: string;
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
  private async parseEmail(rawMessage: string, emailAccountId: string): Promise<ParsedEmailData> {
    const parser = new PostalMime();
    const parsed = await parser.parse(rawMessage);

    const fromAddress = parsed.from?.address || '';
    const fromName = parsed.from?.name || parsed.from?.address || '';
    const subject = parsed.subject || '';
    const to = (parsed.to || []).map((addr: any) => ({ address: addr.address || '', name: addr.name || '' }));
    const cc = (parsed.cc || []).map((addr: any) => ({ address: addr.address || '', name: addr.name || '' }));
    const messageId = parsed.messageId || `<${Date.now()}@${emailAccountId}>`;
    const messageDate = parsed.date ? new Date(parsed.date) : new Date();
    const inReplyTo = parsed.inReplyTo || null;

    // Extract email body
    const emailBody = await this.extractEmailBody(parsed);

    const processedEmail: ProcessedEmail = {
      uid: messageId,
      messageId: messageId,
      inReplyTo: inReplyTo,
      date: messageDate,
      from: [{ address: fromAddress, name: fromName }],
      to,
      cc,
      bcc: [],
      subject: subject,
      textContent: emailBody,
      htmlContent: parsed.html || null,
      userReply: emailBody,
      respondedTo: '', // Set by reply extractor when content is split into user text vs quoted text
      rawMessage: rawMessage
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
        type: 'external',
        confidence: 0.9,
        detectionMethod: 'spam-detection'
      },
      draftMetadata: {
        exampleCount: 0,
        timestamp: new Date().toISOString(),
        originalSubject: processedEmail.subject,
        originalFrom: processedEmail.from[0].address
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
    const { rawMessage, emailAccountId, providerId, userId } = params;

    try {
      // Step 1: Parse email
      const parseStartTime = Date.now();
      console.log('[EmailProcessingService] ⏱️ Step 1: Parsing email...');

      const parsedData = await this.parseEmail(rawMessage, emailAccountId);

      console.log(`[EmailProcessingService] ✓ Email parsed (${Date.now() - parseStartTime}ms)`);

      // Step 2: Load user context
      const contextStartTime = Date.now();
      console.log('[EmailProcessingService] ⏱️ Step 2: Loading user context...');

      const userContext = await this.loadUserContext(userId, emailAccountId);

      console.log(`[EmailProcessingService] ✓ User context loaded (${Date.now() - contextStartTime}ms)`);

      // Step 3: Check for spam
      const spamCheckStartTime = Date.now();
      console.log('[EmailProcessingService] ⏱️ Step 3: Starting spam check...');

      const spamDetector = await getSpamDetector(providerId);

      const spamCheckResult = await spamDetector.checkSpam({
        rawMessage,
        userNames: userContext.userNames
      });

      const spamCheckDuration = Date.now() - spamCheckStartTime;
      console.log(`[EmailProcessingService] ✓ Spam check complete: isSpam=${spamCheckResult.isSpam} (${spamCheckDuration}ms)`);

      // Step 4: Generate draft (or create spam draft)
      console.log('[EmailProcessingService] ⏱️ Step 4: Starting draft generation...');
      const draftStartTime = Date.now();

      // If spam detected, create a silent-spam draft instead of full generation
      if (spamCheckResult.isSpam) {
        console.log('[EmailProcessingService] Spam detected, creating silent-spam draft');
        const spamDraft = this.createSpamDraft(parsedData, userContext, spamCheckResult);
        console.log(`[EmailProcessingService] ✅ Spam draft created (${Date.now() - draftStartTime}ms)`);
        return {
          success: true,
          draft: spamDraft
        };
      }

      // Not spam - generate full draft (pass spam check results for transparency)
      const result = await draftGenerator.generateDraft(userId, providerId, parsedData, userContext, spamCheckResult);

      console.log(`[EmailProcessingService] ✅ Draft generation complete (${Date.now() - draftStartTime}ms)`);
      return result;

    } catch (error) {
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
