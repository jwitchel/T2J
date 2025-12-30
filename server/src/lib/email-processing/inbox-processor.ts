/**
 * InboxProcessor Service
 * Consolidated business logic for processing inbox emails
 * Used by both UI and batch processing (workers, routes)
 */

import { ImapOperations, EmailMessageWithRaw } from '../imap-operations';
import { draftGenerator, EmailAnalysisResult } from './draft-generator';
import { emailMover } from './email-mover';
import { withImapContext } from '../imap-context';
import { emailStorageService } from '../email-storage-service';
import { ProcessedEmail, DraftEmail, SpamCheckResult } from '../pipeline/types';
import { pool } from '../db';
import { EmailActionType, EmailDirection } from '../../types/email-action-tracking';
import { simpleParser } from 'mailparser';
import { PoolClient } from 'pg';
import { EmailActionRouter } from '../email-action-router';
import { EmailRepository } from '../repositories/email-repository';
import { preferencesService } from '../preferences-service';
import { ResolvedUserPreferences } from '../../types/settings';
import { getSpamDetector } from './spam-detector';
import { stripAttachments } from '../email-attachment-stripper';
import { normalizeMessageId } from '../message-id-utils';
import { RelationshipType } from '../relationships/types';
import { personService } from '../relationships/person-service';
import PostalMime, { Email as PostalMimeEmail, Address } from 'postal-mime';
import { actionRulesService } from '../action-rules-service';
import { ContextFlags } from '../llm-client';
import { ActionRuleMatchResult } from '../../types/action-rules';
import addressparser from 'nodemailer/lib/addressparser';
import { withTransaction } from '../db/transaction-utils';

// Re-export types for consumers
export type { EmailAnalysisResult } from './draft-generator';

/**
 * User context needed for email processing
 * Built from ProcessingContext (no separate query needed)
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
 * Build UserContext from ProcessingContext
 * No database call - uses data already fetched in _buildContext
 */
function buildUserContext(context: ProcessingContext): UserContext {
  const prefs = context.preferences;
  return {
    userEmail: context.accountEmail,
    userNames: {
      name: prefs.name ?? '',
      nicknames: prefs.nicknames ?? ''
    },
    typedNameSignature: prefs.typedName?.appendString ?? '',
    signatureBlock: prefs.signatureBlock ?? ''
  };
}

/**
 * Parsed email data
 */
export interface ParsedEmailData {
  parsed: PostalMimeEmail;
  processedEmail: ProcessedEmail;
}

// Constants
const DEFAULT_SOURCE_FOLDER = 'INBOX';
const DEFAULT_DESTINATION = 'INBOX';

// Internal types for processing
interface ProcessingContext {
  message: ProcessEmailParams['message'];
  accountId: string;
  accountEmail: string;
  userId: string;
  providerId: string;
  messageKey: string; // Computed once: messageId || `${uid}@${accountId}`
  preferences: ResolvedUserPreferences;
}

interface ImapOperationResult {
  moved: boolean;
  destination: string;
  actionDescription: string;
}

interface ActionDeterminationResult {
  rawAction: EmailActionType;
  analysis: EmailAnalysisResult | null;
}

export interface ProcessEmailParams {
  message: {
    uid: number;
    messageId?: string;
    subject?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    date?: Date;
    flags?: string[];
    fullMessage: string;
  };
  accountId: string;
  userId: string;
  providerId: string;
  generatedDraft?: DraftEmail; // Optional pre-generated draft to avoid LLM non-determinism
}

export interface ProcessEmailResult {
  success: boolean;
  messageId?: string;
  subject?: string;
  from?: string;
  action: string;
  actionDescription: string;
  destination: string;
  draftId?: string;
  moved: boolean;
  error?: string;
}

export interface BatchProcessParams {
  accountId: string;
  userId: string;
  providerId: string;
  batchSize: number;
  offset: number;
  force: boolean;
  since?: Date;
}

export interface BatchProcessResult {
  success: boolean;
  processed: number;
  results: ProcessEmailResult[];
  hasMore: boolean;
  nextOffset: number;
  elapsed: number;
}

export class InboxProcessor {
  private emailRepository: EmailRepository;

  constructor() {
    this.emailRepository = new EmailRepository(pool);
  }

  /**
   * Compute structural context flags from parsed email data
   * These are objective facts about the email structure, not semantic analysis
   * @private
   */
  private _computeStructuralContextFlags(parsedData: ParsedEmailData): Pick<ContextFlags, 'isThreaded' | 'hasAttachments' | 'isGroupEmail'> {
    const { parsed, processedEmail } = parsedData;
    return {
      isThreaded: processedEmail.inReplyTo !== null,
      hasAttachments: parsed.attachments.length > 0,
      isGroupEmail: processedEmail.to.length + processedEmail.cc.length > 1
    };
  }

  /**
   * Extract email body, handling HTML if no plain text is available
   * @private
   */
  private async _extractEmailBody(parsed: PostalMimeEmail): Promise<string> {
    let emailBody = parsed.text;

    // MIME allows emails with only HTML content (no text/plain part)
    // This is common for marketing emails and rich-text newsletters
    if (!emailBody || emailBody.trim().length === 0) {
      if (parsed.html) {
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
    }

    if (!emailBody || emailBody.trim().length === 0) {
      emailBody = '(No content)';
    }

    return emailBody;
  }

  /**
   * Parse email into structured data
   * Throws Error with message starting with "Malformed email:" for invalid emails
   * @private
   */
  private async _parseEmail(fullMessage: string, emailAccountId: string): Promise<ParsedEmailData> {
    const parser = new PostalMime();
    const parsed = await parser.parse(fullMessage);

    // RFC 5322 requires From header - emails without it are malformed
    if (!parsed.from?.address) {
      throw new Error('Malformed email: missing From address');
    }

    const fromAddress = parsed.from.address;
    const fromName = parsed.from.name ?? parsed.from.address;
    const subject = parsed.subject!;
    // RFC 5322: To, Cc, and Reply-To are optional headers in valid emails.
    // Marketing emails often have empty To (using Bcc), and most emails lack Cc/Reply-To.
    // This is NOT a defensive default - these are legitimately optional per email protocol.
    const to = (parsed.to ?? []).map((addr: Address) => ({ address: addr.address!, name: addr.name! }));
    const cc = (parsed.cc ?? []).map((addr: Address) => ({ address: addr.address!, name: addr.name! }));
    const replyTo = (parsed.replyTo ?? []).map((addr: Address) => ({ address: addr.address!, name: addr.name! }));
    const messageId = normalizeMessageId(parsed.messageId) ?? `${Date.now()}@${emailAccountId}`;
    const messageDate = parsed.date ? new Date(parsed.date) : new Date();
    const inReplyTo = parsed.inReplyTo ?? null;

    const emailBody = await this._extractEmailBody(parsed);

    // textContent: immutable original body (for display, quoting in replies)
    // userReply: text for LLM analysis (can be processed/cleaned downstream)
    // Both start identical; userReply may diverge after signature removal, quote extraction, etc.
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
      htmlContent: parsed.html ?? null,
      userReply: emailBody,
      respondedTo: '',
      fullMessage: fullMessage
    };

    return { parsed, processedEmail };
  }

  /**
   * Create a minimal draft to carry metadata without response content
   * Used for spam and LLM-analyzed silent actions
   * @private
   */
  private _createMetadataOnlyDraft(
    parsedData: ParsedEmailData,
    userContext: UserContext,
    meta: DraftEmail['meta'],
    relationship: DraftEmail['relationship'],
    spamAnalysis?: SpamCheckResult
  ): DraftEmail {
    const { processedEmail } = parsedData;

    return {
      id: `draft-${Date.now()}`,
      from: userContext.userEmail,
      to: processedEmail.from[0].address,
      cc: '',
      subject: processedEmail.subject!,
      body: '',
      bodyHtml: undefined,
      inReplyTo: processedEmail.messageId || `<${Date.now()}>`,
      references: processedEmail.messageId || `<${Date.now()}>`,
      meta,
      relationship,
      draftMetadata: {
        exampleCount: 0,
        timestamp: new Date().toISOString(),
        originalSubject: processedEmail.subject,
        originalFrom: processedEmail.from[0].address,
        spamAnalysis: spamAnalysis ? {
          isSpam: spamAnalysis.isSpam,
          indicators: spamAnalysis.indicators,
          senderResponseCount: spamAnalysis.senderResponseCount
        } : undefined
      }
    };
  }

  /**
   * Build processing context from parameters
   * Fetches account email and preferences ONCE - passed through to all subsequent methods
   * @private
   */
  private async _buildContext(params: ProcessEmailParams): Promise<ProcessingContext> {
    const { message, accountId, userId, providerId } = params;

    // Fetch account email and preferences in parallel
    const [accountResult, preferences] = await Promise.all([
      pool.query('SELECT email_address FROM email_accounts WHERE id = $1', [accountId]),
      preferencesService.getPreferences(userId)
    ]);

    return {
      message,
      accountId,
      accountEmail: accountResult.rows[0].email_address,
      userId,
      providerId,
      messageKey: message.messageId ?? `${message.uid}@${accountId}`,
      preferences
    };
  }

  /**
   * Check if sender is whitelisted via configured relationships
   * @private
   */
  private _isWhitelistedSender(
    senderEmail: string,
    relationshipConfig: { workDomains: string[]; familyEmails: string[]; spouseEmails: string[] }
  ): SpamCheckResult | null {
    const senderDomain = senderEmail.split('@')[1];
    const { workDomains, familyEmails, spouseEmails } = relationshipConfig;

    if (senderDomain && workDomains.includes(senderDomain)) {
      return {
        isSpam: false,
        indicators: [`Sender domain ${senderDomain} is a configured work domain`],
        senderResponseCount: 0
      };
    }

    if (familyEmails.includes(senderEmail)) {
      return {
        isSpam: false,
        indicators: ['Sender is a configured family member'],
        senderResponseCount: 0
      };
    }

    if (spouseEmails.includes(senderEmail)) {
      return {
        isSpam: false,
        indicators: ['Sender is a configured spouse'],
        senderResponseCount: 0
      };
    }

    return null;
  }

  /**
   * Check if email is spam (GATED by spamDetection preference)
   * @private
   */
  private async _checkSpam(
    context: ProcessingContext,
    parsedData: ParsedEmailData,
    userContext: UserContext,
    llmSafeMessage: string
  ): Promise<SpamCheckResult> {
    // GATE: Skip spam detection if disabled
    if (!context.preferences.actionPreferences.spamDetection) {
      return {
        isSpam: false,
        indicators: ['Spam detection disabled'],
        senderResponseCount: 0
      };
    }

    const senderEmail = parsedData.processedEmail.from[0].address.toLowerCase();

    // GATE: Whitelisted senders cannot be spam
    const whitelistResult = this._isWhitelistedSender(senderEmail, context.preferences.relationshipConfig);
    if (whitelistResult) {
      return whitelistResult;
    }

    const replyTo = parsedData.processedEmail.replyTo[0]?.address?.toLowerCase();

    const spamDetector = await getSpamDetector(context.providerId, context.userId);
    return spamDetector.checkSpam({
      senderEmail,
      replyTo,
      fullMessage: llmSafeMessage,
      subject: parsedData.processedEmail.subject,
      userNames: userContext.userNames,
      userId: context.userId
    });
  }

  /**
   * Determine effective action after applying preference constraints
   * Preferences GATE here - determines what actions are allowed
   * @private
   */
  private _applyPreferenceGates(
    rawAction: EmailActionType,
    preferences: ResolvedUserPreferences
  ): EmailActionType {
    // GATE: Draft actions → KEEP_IN_INBOX when draft generation is disabled
    if (!preferences.actionPreferences.draftGeneration && EmailActionType.isDraftAction(rawAction)) {
      return EmailActionType.KEEP_IN_INBOX;
    }

    // GATE: Silent actions → KEEP_IN_INBOX when sub-preference is disabled
    if (EmailActionType.hasActionSubPreference(rawAction) &&
        !preferences.actionPreferences.silentActions[rawAction]) {
      return EmailActionType.KEEP_IN_INBOX;
    }

    return rawAction;
  }

  /**
   * Determine destination folder based on action and preferences
   * @private
   */
  private _determineDestination(
    action: EmailActionType,
    preferences: ResolvedUserPreferences
  ): string {
    const folderPrefs = preferences.folderPreferences;
    const actionRouter = new EmailActionRouter(folderPrefs);
    const routeResult = actionRouter.getActionRoute(action);
    return routeResult.folder;
  }


  /**
   * Log concise two-line processing summary
   * @private
   */
  private _logProcessingSummary(
    context: ProcessingContext,
    result: ProcessEmailResult,
    isSpam: boolean
  ): void {
    // Extract clean sender email from "Name <email>" format
    const parsed = context.message.from ? addressparser(context.message.from)[0] : null;
    const fromEmail = parsed && 'address' in parsed ? parsed.address : (context.message.from ?? 'unknown');
    const subject = (context.message.subject || 'No subject').substring(0, 60);
    const account = context.accountEmail || context.accountId.slice(0, 8);

    // Build status and action
    const status = result.success ? '✓' : '✗';
    const spamTag = isSpam ? ' [SPAM]' : '';
    const action = result.action.replace(/-/g, '_').toUpperCase();
    const dest = result.destination !== DEFAULT_DESTINATION ? ` → ${result.destination}` : '';

    // Single line format: [status] Account: from@example.com | "Subject" | ACTION → dest
    console.log(`[EMAIL ${status}${spamTag}] ${account}: ${fromEmail} | "${subject}" | ${action}${dest}`);
  }

  /**
   * Save email to database
   * @private
   */
  private async _saveToDatabase(
    context: ProcessingContext,
    effectiveAction: EmailActionType,
    draft: DraftEmail | null,
    destinationFolder: string,
    parsedData: ParsedEmailData,
    client: PoolClient
  ): Promise<void> {
    // Parse with simpleParser for storage service compatibility
    const parsed = await simpleParser(context.message.fullMessage);

    const emailData = {
      uid: context.message.uid,
      messageId: context.message.messageId,
      subject: context.message.subject,
      from: context.message.from,
      fullMessage: context.message.fullMessage,
      to: context.message.to!,
      cc: context.message.cc!,
      date: context.message.date || parsed.date || new Date(),
      flags: context.message.flags!,
      size: context.message.fullMessage.length,
      parsed
    };

    // Build LLM response object (may be minimal if no draft was generated)
    // Note: modelName not currently tracked in DraftEmail - would need pipeline enhancement
    const llmResponse = draft ? {
      meta: draft.meta,
      generatedAt: draft.draftMetadata.timestamp,
      providerId: context.providerId,
      modelName: 'unknown',
      draftId: draft.id,
      relationship: draft.relationship,
      spamAnalysis: draft.draftMetadata?.spamAnalysis,
      generatedContent: draft.body
    } : {
      meta: {
        recommendedAction: effectiveAction,
        keyConsiderations: [],
        inboundMsgAddressedTo: 'unknown',
        inboundMsgIsRequesting: 'unknown',
        urgencyLevel: 'low',
        contextFlags: this._computeStructuralContextFlags(parsedData)
      },
      generatedAt: new Date().toISOString(),
      providerId: context.providerId,
      modelName: 'none',
      draftId: `action-${Date.now()}`,
      relationship: { type: 'unknown', confidence: 0 },
      spamAnalysis: undefined,
      generatedContent: ''
    };

    await emailStorageService.saveEmail({
      userId: context.userId,
      emailAccountId: context.accountId,
      emailData,
      emailType: EmailDirection.INCOMING,
      folderName: DEFAULT_SOURCE_FOLDER,
      llmResponse,
      client,
      actionTaken: effectiveAction,
      destinationFolder,
      uid: context.message.uid
    });
  }

  /**
   * Perform IMAP operation
   * @private
   */
  private async _performImapOperation(
    context: ProcessingContext,
    effectiveAction: EmailActionType,
    draft: DraftEmail | null
  ): Promise<ImapOperationResult> {
    const folderPrefs = context.preferences.folderPreferences;

    // Silent actions (including KEEP_IN_INBOX): Move email to appropriate folder
    if (EmailActionType.isSilentAction(effectiveAction)) {
      const result = await emailMover.moveEmail({
        emailAccountId: context.accountId,
        userId: context.userId,
        messageUid: context.message.uid,
        messageId: context.messageKey,
        sourceFolder: DEFAULT_SOURCE_FOLDER,
        recommendedAction: effectiveAction,
        folderPreferences: folderPrefs
      });

      if (!result.success) {
        throw new Error(`Failed to move email: ${result.error}`);
      }

      return {
        moved: true,
        destination: result.folder!,
        actionDescription: result.message!
      };
    }

    // Draft actions: Upload draft if we have one and draftGeneration is enabled
    if (EmailActionType.isDraftAction(effectiveAction) && draft) {
      // draftGeneration must be enabled (already checked in _applyPreferenceGates)
      // If it was disabled, effectiveAction would be KEEP_IN_INBOX, not a draft action
      const result = await emailMover.uploadDraft({
        emailAccountId: context.accountId,
        userId: context.userId,
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
        body: draft.body,
        bodyHtml: draft.bodyHtml,
        inReplyTo: draft.inReplyTo,
        references: draft.references,
        recommendedAction: effectiveAction,
        folderPreferences: folderPrefs
      });

      if (!result.success) {
        throw new Error(`Failed to upload draft: ${result.error}`);
      }

      return {
        moved: true,
        destination: result.folder!,
        actionDescription: result.message!
      };
    }

    // No IMAP operation needed (e.g., KEEP_IN_INBOX without draft)
    return {
      moved: false,
      destination: DEFAULT_DESTINATION,
      actionDescription: 'Kept in inbox'
    };
  }

  /**
   * Build result object
   * @private
   */
  private _buildResult(
    context: ProcessingContext,
    effectiveAction: EmailActionType,
    draft: DraftEmail | null,
    imapResult: ImapOperationResult,
    error?: Error
  ): ProcessEmailResult {
    if (error) {
      return {
        success: false,
        messageId: context.message.messageId,
        subject: context.message.subject,
        from: context.message.from,
        action: 'error',
        actionDescription: 'Failed to process',
        destination: DEFAULT_DESTINATION,
        moved: false,
        error: error.message
      };
    }

    return {
      success: true,
      messageId: context.message.messageId,
      subject: context.message.subject,
      from: context.message.from,
      action: effectiveAction,
      actionDescription: imapResult.actionDescription,
      destination: imapResult.destination,
      draftId: draft?.id,
      moved: imapResult.moved
    };
  }

  /**
   * Check user-defined action rules
   * Sender rules are checked first, then relationship rules
   * @private
   */
  private async _checkUserRules(
    context: ProcessingContext,
    senderEmail: string
  ): Promise<ActionRuleMatchResult> {
    // Look up sender's relationship in the database
    let relationshipType: string | null = null;

    const person = await personService.findPersonByEmail(senderEmail, context.userId);
    if (person?.relationship_type) {
      relationshipType = person.relationship_type;
    }

    // Check rules (sender rules first, then relationship rules)
    return actionRulesService.checkRules(context.userId, senderEmail, relationshipType);
  }

  /**
   * Determine the raw action for an email
   * @private
   */
  private async _determineAction(
    context: ProcessingContext,
    parsedData: ParsedEmailData,
    userContext: UserContext,
    spamResult: SpamCheckResult,
    isSpam: boolean,
    llmSafeMessage: string,
    preGeneratedDraft: DraftEmail | undefined
  ): Promise<ActionDeterminationResult> {
    if (preGeneratedDraft) {
      return {
        rawAction: preGeneratedDraft.meta.recommendedAction as EmailActionType,
        analysis: null
      };
    }

    // Check user-defined action rules FIRST (before spam/LLM)
    const senderEmail = parsedData.processedEmail.from[0].address.toLowerCase();
    const ruleResult = await this._checkUserRules(context, senderEmail);
    if (ruleResult.matched && ruleResult.action) {
      const ruleDescription = `User rule: ${ruleResult.rule?.conditionType}=${ruleResult.rule?.conditionValue} -> ${ruleResult.action}`;
      console.log(`[InboxProcessor] ${ruleDescription}`);
      return {
        rawAction: ruleResult.action as EmailActionType,
        analysis: {
          meta: {
            recommendedAction: ruleResult.action as EmailActionType,
            keyConsiderations: [ruleDescription],
            contextFlags: {
              ...this._computeStructuralContextFlags(parsedData),
              inboundMsgAddressedTo: 'you' as const,
              urgencyLevel: 'low' as const
            }
          },
          relationship: { type: 'rule-based', confidence: 1.0 }
        }
      };
    }

    if (isSpam) {
      return {
        rawAction: EmailActionType.SILENT_SPAM,
        analysis: null
      };
    }

    const llmParsedData: ParsedEmailData = {
      ...parsedData,
      processedEmail: { ...parsedData.processedEmail, fullMessage: llmSafeMessage }
    };
    const analysis = await draftGenerator.determineAction(
      context.userId,
      context.providerId,
      llmParsedData,
      userContext,
      spamResult
    );

    return {
      rawAction: analysis.meta.recommendedAction as EmailActionType,
      analysis
    };
  }

  /**
   * Generate draft based on action and context
   * @private
   */
  private async _generateDraft(
    context: ProcessingContext,
    parsedData: ParsedEmailData,
    userContext: UserContext,
    spamResult: SpamCheckResult,
    isSpam: boolean,
    effectiveAction: EmailActionType,
    analysis: EmailAnalysisResult | null,
    llmSafeMessage: string,
    preGeneratedDraft: DraftEmail | undefined
  ): Promise<DraftEmail | null> {
    if (preGeneratedDraft) {
      if (preGeneratedDraft.meta.recommendedAction !== effectiveAction) {
        preGeneratedDraft.meta.recommendedAction = effectiveAction;
      }
      return preGeneratedDraft;
    }

    if (isSpam) {
      const senderEmail = parsedData.processedEmail.from[0].address;
      const senderName = parsedData.processedEmail.from[0].name ?? senderEmail;
      await personService.findOrCreatePerson({
        userId: context.userId,
        name: senderName,
        emailAddress: senderEmail,
        relationshipType: RelationshipType.SPAM,
        confidence: 0.9
      });
      return this._createMetadataOnlyDraft(
        parsedData,
        userContext,
        {
          recommendedAction: EmailActionType.SILENT_SPAM,
          keyConsiderations: spamResult.indicators,
          contextFlags: {
            ...this._computeStructuralContextFlags(parsedData),
            inboundMsgAddressedTo: 'you',
            urgencyLevel: 'low'
          }
        },
        { type: RelationshipType.SPAM, confidence: 0.9 },
        spamResult
      );
    }

    if (EmailActionType.isDraftAction(effectiveAction)) {
      const llmParsedData: ParsedEmailData = {
        ...parsedData,
        processedEmail: { ...parsedData.processedEmail, fullMessage: llmSafeMessage }
      };
      const draftResult = await draftGenerator.generateDraftFromAnalysis(
        context.userId,
        context.providerId,
        llmParsedData,
        userContext,
        spamResult,
        analysis!
      );
      if (!draftResult.draft) {
        throw new Error(`LLM failed to generate draft: ${draftResult.error}`);
      }
      if (draftResult.draft.meta.recommendedAction !== effectiveAction) {
        draftResult.draft.meta.recommendedAction = effectiveAction;
      }
      return draftResult.draft;
    }

    // Silent action with LLM analysis - carry the metadata
    if (analysis) {
      return this._createMetadataOnlyDraft(
        parsedData,
        userContext,
        { ...analysis.meta, recommendedAction: effectiveAction },
        analysis.relationship,
        spamResult  // Pass spamResult to store indicators
      );
    }

    // User rule match - no LLM analysis to preserve
    return null;
  }

  /**
   * Process a single email
   * Uses action tracking for deduplication after BullMQ's job ID deduplication
   */
  async processEmail(params: ProcessEmailParams): Promise<ProcessEmailResult> {
    const { message, accountId, userId } = params;

    // Check action tracking - second layer of defense after job deduplication
    if (message.messageId) {
      const alreadyProcessed = await this.emailRepository.isReceivedEmailProcessed(
        userId,
        accountId,
        message.messageId
      );

      if (alreadyProcessed) {
        const shortId = message.messageId.length > 30
          ? `${message.messageId.substring(0, 8)}...${message.messageId.substring(message.messageId.length - 22)}`
          : message.messageId;
        console.log(`[InboxProcessor] Email ${shortId} already processed - skipping`);
        return {
          success: true,
          messageId: message.messageId,
          subject: message.subject,
          from: message.from,
          action: 'already_processed',
          actionDescription: 'Email already processed',
          destination: 'N/A',
          moved: false
        };
      }
    }

    const context = await this._buildContext(params);
    const userContext = buildUserContext(context);

    // Parse email - skip malformed emails at the highest level
    let parsedData: ParsedEmailData;
    try {
      parsedData = await this._parseEmail(
        context.message.fullMessage,
        context.accountId
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Malformed email:')) {
        console.log(`[InboxProcessor] Skipping malformed email: ${error.message}`);
        return {
          success: false,
          messageId: message.messageId,
          subject: message.subject,
          from: message.from,
          action: 'malformed',
          actionDescription: error.message,
          destination: 'N/A',
          moved: false,
          error: error.message
        };
      }
      throw error;
    }

    // Strip attachments once for all LLM operations
    const llmSafeMessage = await stripAttachments(
      context.message.fullMessage,
      parsedData.parsed
    );

    // Check if email is spam
    const spamResult = await this._checkSpam(context, parsedData, userContext, llmSafeMessage);

    // Determine action
    const { rawAction, analysis } = await this._determineAction(
      context,
      parsedData,
      userContext,
      spamResult,
      spamResult.isSpam,
      llmSafeMessage,
      params.generatedDraft as DraftEmail | undefined
    );

    // Apply preference gates
    const effectiveAction = this._applyPreferenceGates(rawAction, context.preferences);

    // Generate draft
    const draft = await this._generateDraft(
      context,
      parsedData,
      userContext,
      spamResult,
      spamResult.isSpam,
      effectiveAction,
      analysis,
      llmSafeMessage,
      params.generatedDraft as DraftEmail | undefined
    );

    // Determine destination folder
    const destinationFolder = this._determineDestination(effectiveAction, context.preferences);

    // Save email to database in a transaction
    await withTransaction(pool, (client) =>
      this._saveToDatabase(context, effectiveAction, draft, destinationFolder, parsedData, client)
    );

    const imapResult = await this._performImapOperation(context, effectiveAction, draft);

    const result = this._buildResult(context, effectiveAction, draft, imapResult);
    this._logProcessingSummary(context, result, spamResult.isSpam);
    return result;
  }

  /**
   * Process a batch of emails
   */
  async processBatch(params: BatchProcessParams): Promise<BatchProcessResult> {
    const startTime = Date.now();
    const { accountId, userId, providerId, batchSize, offset, force, since } = params;

    return await withImapContext(accountId, userId, async () => {
      const imapOps = await ImapOperations.fromAccountId(accountId, userId);

      // Get messages from INBOX
      const messages = await imapOps.getMessages('INBOX', {
        offset: Number(offset),
        limit: Number(batchSize),
        descending: true,
        since
      });

      if (messages.length === 0) {
        return this._buildBatchResult([], offset, false, startTime);
      }

      const uids = messages.map(msg => msg.uid);
      const fullMessages = await imapOps.getMessagesRaw('INBOX', uids);

      // Filter messages to only those that haven't been processed
      const toProcess = await this._filterUnprocessedMessages(fullMessages, accountId, force);

      // Process each message
      const results: ProcessEmailResult[] = [];
      for (const msg of toProcess) {
        const result = await this.processEmail({
          message: this._buildMessageParams(msg),
          accountId,
          userId,
          providerId
        });
        results.push(result);
      }

      // Build batch result
      const hasMore = messages.length === batchSize;
      return this._buildBatchResult(results, offset + messages.length, hasMore, startTime);
    });
  }

  /**
   * Filter messages to only those that haven't been processed
   * @private
   */
  private async _filterUnprocessedMessages(
    messages: EmailMessageWithRaw[],
    accountId: string,
    force: boolean
  ): Promise<EmailMessageWithRaw[]> {
    const messageIds = messages
      .map(msg => msg.messageId)
      .filter((id): id is string => !!id);

    const actionTracking = await this.emailRepository.getReceivedEmailActions(accountId, messageIds);

    return messages.filter(msg => {
      if (!msg.messageId) return false;
      const tracked = actionTracking.get(msg.messageId);
      return force || !tracked || tracked.action === EmailActionType.PENDING;
    });
  }

  /**
   * Build message params from raw message
   * @private
   */
  private _buildMessageParams(msg: EmailMessageWithRaw): ProcessEmailParams['message'] {
    const ccAddresses = msg.parsed.cc
      ? [msg.parsed.cc].flat().map(addr => addr.text).filter((text): text is string => !!text)
      : [];

    return {
      uid: msg.uid,
      messageId: msg.messageId,
      subject: msg.subject,
      from: msg.from,
      to: msg.to,
      cc: ccAddresses,
      date: msg.date,
      flags: msg.flags,
      fullMessage: msg.fullMessage
    };
  }

  /**
   * Build batch result
   * @private
   */
  private _buildBatchResult(
    results: ProcessEmailResult[],
    nextOffset: number,
    hasMore: boolean,
    startTime: number
  ): BatchProcessResult {
    return {
      success: true,
      processed: results.length,
      results,
      hasMore,
      nextOffset,
      elapsed: Date.now() - startTime
    };
  }
}

// Export singleton instance
export const inboxProcessor = new InboxProcessor();