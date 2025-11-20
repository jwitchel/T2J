/**
 * InboxProcessor Service
 * Consolidated business logic for processing inbox emails
 * Used by both UI and batch processing (workers, routes)
 */

import { ImapOperations } from '../imap-operations';
import { EmailActionTracker } from '../email-action-tracker';
import { emailProcessingService } from './email-processing-service';
import { emailMover } from './email-mover';
import { withImapContext } from '../imap-context';
import { emailStorageService } from '../email-storage-service';
import { DraftEmail } from '../pipeline/types';
import { pool } from '../db';
import { ActionHelpers } from '../email-actions';

// Constants
const DEFAULT_SOURCE_FOLDER = 'INBOX';
const DEFAULT_DESTINATION = 'INBOX';

// Internal types for processing
interface ProcessingContext {
  message: ProcessEmailParams['message'];
  accountId: string;
  accountEmail?: string; // Email address of the account (for logging)
  userId: string;
  providerId: string;
  messageKey: string; // Computed once: messageId || `${uid}@${accountId}`
}

interface ProcessingState {
  draft: DraftEmail;
  moved: boolean;
  destination: string;
  actionDescription: string;
}

interface DraftGenerationResult {
  shouldSkip: boolean; // true for spam
  draft?: DraftEmail;
  skipReason?: string;
}

interface ImapOperationResult {
  moved: boolean;
  destination: string;
  actionDescription: string;
}

export interface ProcessEmailParams {
  message: {
    uid: number;
    messageId?: string;
    subject?: string;
    from?: string;
    fullMessage: string;
  };
  accountId: string;
  userId: string;
  providerId: string;
  generatedDraft?: any; // Optional pre-generated draft to avoid LLM non-determinism
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
  force?: boolean;
  since?: Date;  // For Look Back feature - filter emails by date
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
  /**
   * Process a single email
   * Uses action tracking for deduplication after BullMQ's job ID deduplication
   */
  async processEmail(params: ProcessEmailParams): Promise<ProcessEmailResult> {
    const { message, accountId, userId } = params;

    // Check action tracking - second layer of defense after job deduplication
    if (message.messageId) {
      const alreadyProcessed = await EmailActionTracker.hasEmailBeenProcessed(
        userId,
        accountId,
        message.messageId
      );

      if (alreadyProcessed) {
        // Shorten message ID for cleaner logs: first 8 chars + "..." + last 22 chars
        const shortId = message.messageId.length > 30
          ? `${message.messageId.substring(0, 8)}...${message.messageId.substring(message.messageId.length - 22)}`
          : message.messageId;
        console.log(`[InboxProcessor] Email ${shortId} already processed - skipping`);
        return this._createSkippedResult(message, 'already_processed_in_database');
      }
    }

    // Process email directly - no locking needed (BullMQ handles job-level deduplication)
    return this._executeProcessing(params);
  }

  /**
   * Build processing context from parameters
   * @private
   */
  private async _buildContext(params: ProcessEmailParams): Promise<ProcessingContext> {
    const { message, accountId, userId, providerId } = params;

    // Fetch account email for logging
    let accountEmail: string | undefined;
    try {
      const result = await pool.query(
        'SELECT email_address FROM email_accounts WHERE id = $1',
        [accountId]
      );
      accountEmail = result.rows[0]?.email_address;
    } catch (error: unknown) {
      console.error('[InboxProcessor] Failed to fetch account email:', error);
    }

    return {
      message,
      accountId,
      accountEmail,
      userId,
      providerId,
      messageKey: message.messageId || `${message.uid}@${accountId}`
    };
  }

  /**
   * Generate draft or detect spam
   * @private
   */
  private async _generateDraft(
    context: ProcessingContext,
    existingDraft?: DraftEmail
  ): Promise<DraftGenerationResult> {
    if (existingDraft) {
      return { shouldSkip: false, draft: existingDraft };
    }

    const processingResult = await emailProcessingService.processEmail({
      fullMessage: context.message.fullMessage,
      emailAccountId: context.accountId,
      providerId: context.providerId,
      userId: context.userId
    });

    if (!processingResult.success) {
      if (processingResult.errorCode === 'SPAM_DETECTED') {
        return { shouldSkip: true, skipReason: 'spam' };
      }

      if (processingResult.errorCode === 'ACCOUNT_NOT_FOUND') {
        const error = new Error(processingResult.error || 'Account not found');
        (error as any).permanent = true;
        throw error;
      }

      throw new Error(processingResult.error || 'Failed to process email');
    }

    return {
      shouldSkip: false,
      draft: processingResult.draft as DraftEmail
    };
  }


  /**
   * Perform IMAP operation (move or upload draft)
   * @private
   */
  private async _performImapOperation(
    context: ProcessingContext,
    draft: DraftEmail
  ): Promise<ImapOperationResult> {
    const recommendedAction = draft.meta.recommendedAction;

    if (ActionHelpers.isSilentAction(recommendedAction)) {
      const result = await emailMover.moveEmail({
        emailAccountId: context.accountId,
        userId: context.userId,
        messageUid: context.message.uid,
        messageId: context.message.messageId,
        sourceFolder: DEFAULT_SOURCE_FOLDER,
        recommendedAction
      });

      if (!result.success) {
        throw new Error(`Failed to move email: ${result.error || 'Unknown error'}`);
      }

      return {
        moved: true,
        destination: result.folder || DEFAULT_DESTINATION,
        actionDescription: result.message || `Moved to ${result.folder}`
      };
    } else {
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
        recommendedAction
      });

      if (!result.success) {
        throw new Error(`Failed to upload draft: ${result.error || 'Unknown error'}`);
      }

      return {
        moved: true,
        destination: result.folder || DEFAULT_DESTINATION,
        actionDescription: result.message || 'Draft created'
      };
    }
  }

  /**
   * Record initial action tracking (before IMAP operations)
   * @private
   */
  private async _recordInitialTracking(context: ProcessingContext, draft: DraftEmail): Promise<void> {
    await EmailActionTracker.recordAction(
      context.userId,
      context.accountId,
      context.messageKey,
      draft.meta.recommendedAction as any, // recommendedAction type mismatch - cast for now
      context.message.subject,
      undefined, // Will be updated after IMAP
      context.message.uid,
      context.message.from
    );
  }

  /**
   * Update action tracking with final destination (after IMAP operations)
   * @private
   */
  private async _updateTracking(
    context: ProcessingContext,
    draft: DraftEmail,
    destination: string
  ): Promise<void> {
    await EmailActionTracker.recordAction(
      context.userId,
      context.accountId,
      context.messageKey,
      draft.meta.recommendedAction as any, // recommendedAction type mismatch - cast for now
      context.message.subject,
      destination,
      context.message.uid,
      context.message.from
    );
  }

  /**
   * Rollback action tracking on failure
   * @private
   */
  private async _rollbackTracking(context: ProcessingContext): Promise<void> {
    try {
      await EmailActionTracker.resetAction(context.accountId, context.messageKey);
    } catch (error: unknown) {
      console.error('[InboxProcessor] Rollback failed:', error);
    }
  }

  /**
   * Save email to database (best effort - doesn't throw on error)
   * @private
   */
  private async _saveToDatabase(
    context: ProcessingContext,
    draft: DraftEmail
  ): Promise<void> {
    try {
      // Always store the ORIGINAL fullMessage (complete, unedited, with all attachments)
      // This preserves the complete email for drafts, replies, and future processing
      const emailData = {
        uid: context.message.uid,
        messageId: context.message.messageId,
        subject: context.message.subject,
        from: context.message.from,
        fullMessage: context.message.fullMessage, // ORIGINAL - complete with all attachments
        to: [],
        cc: [],
        date: new Date(),
        flags: [],
        size: context.message.fullMessage.length
      };

      const llmResponse = {
        meta: draft.meta,
        generatedAt: (draft as any).generatedAt || draft.draftMetadata?.timestamp || new Date().toISOString(),
        providerId: context.providerId,
        modelName: (draft as any).modelName || 'unknown',
        draftId: draft.id || '',
        relationship: draft.relationship || {
          type: 'professional',
          confidence: 0.5
        },
        spamAnalysis: draft.draftMetadata.spamAnalysis,
        generatedContent: draft.body
      };

      await emailStorageService.saveEmail({
        userId: context.userId,
        emailAccountId: context.accountId,
        emailData,
        emailType: 'incoming',
        folderName: DEFAULT_SOURCE_FOLDER,
        llmResponse
      });
    } catch (error: unknown) {
      console.error(`[InboxProcessor] ⚠️ DATABASE SAVE FAILED for ${context.message.messageId}:`, error);
      console.error(`[InboxProcessor] This email will not be viewable in history!`);
      // Don't throw - database save is best-effort
    }
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
    const fromEmail = context.message.from?.match(/<(.+?)>/)?.[1] || context.message.from || 'unknown';
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
   * Build standardized result object
   * @private
   */
  private _buildResult(
    context: ProcessingContext,
    state?: Partial<ProcessingState>,
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
      action: state?.draft?.meta.recommendedAction || 'skipped-spam',
      actionDescription: state?.actionDescription || 'Spam detected - message skipped',
      destination: state?.destination || DEFAULT_DESTINATION,
      draftId: state?.draft?.id,
      moved: state?.moved || false
    };
  }

  /**
   * Execute email processing (called after deduplication checks)
   * @private
   */
  private async _executeProcessing(
    params: ProcessEmailParams
  ): Promise<ProcessEmailResult> {
    // 1. INITIALIZE CONTEXT (fetch account email for logging)
    const context = await this._buildContext(params);

    try {
      // 2. GENERATE DRAFT (includes spam detection)
      const draftResult = await this._generateDraft(context, params.generatedDraft as DraftEmail);

      if (draftResult.shouldSkip) {
        // Should not happen anymore - spam now returns a draft with silent-spam action
        const result = this._buildResult(context);
        this._logProcessingSummary(context, result, true);
        return result;
      }

      const draft = draftResult.draft!;
      const isSpam = ActionHelpers.isSpamAction(draft.meta.recommendedAction);

      // 3. RECORD INITIAL ACTION TRACKING
      await this._recordInitialTracking(context, draft);

      // 4. PERFORM IMAP OPERATIONS (move or upload) - throws on failure
      let imapResult: ImapOperationResult;
      try {
        imapResult = await this._performImapOperation(context, draft);
      } catch (imapError) {
        await this._rollbackTracking(context);
        throw imapError;
      }

      // 5. UPDATE ACTION TRACKING WITH FINAL DESTINATION
      await this._updateTracking(context, draft, imapResult.destination);

      // 6. SAVE TO DATABASE (best effort - doesn't fail on error)
      await this._saveToDatabase(context, draft);

      // 7. BUILD SUCCESS RESULT AND LOG SUMMARY
      const result = this._buildResult(context, {
        draft,
        moved: imapResult.moved,
        destination: imapResult.destination,
        actionDescription: imapResult.actionDescription
      });

      this._logProcessingSummary(context, result, isSpam);
      return result;

    } catch (error: unknown) {
      const result = this._buildResult(context, undefined, error as Error);
      this._logProcessingSummary(context, result, false);
      return result;
    }
  }

  /**
   * Create a "skipped" result when lock cannot be acquired
   * @private
   */
  private _createSkippedResult(
    message: ProcessEmailParams['message'],
    reason?: string
  ): ProcessEmailResult {
    const errorMsg = reason || 'Lock not acquired';
    return {
      success: false,
      messageId: message.messageId,
      subject: message.subject,
      from: message.from,
      action: 'skipped',
      actionDescription: errorMsg,
      destination: 'INBOX',
      moved: false,
      error: errorMsg
    };
  }

  /**
   * Process a batch of emails
   * Wrapped in withImapContext to ensure single connection reuse and guaranteed cleanup
   */
  async processBatch(params: BatchProcessParams): Promise<BatchProcessResult> {
    const startTime = Date.now();
    const { accountId, userId, providerId, batchSize, offset, force, since } = params;

    // Wrap entire batch operation in IMAP context to ensure:
    // 1. Single connection reused across all IMAP operations
    // 2. Guaranteed connection cleanup even on errors
    // 3. Nested operations (emailMover calls) share the same connection
    return await withImapContext(accountId, userId, async () => {
      try {
        const imapOps = await ImapOperations.fromAccountId(accountId, userId);

        // Fetch messages from inbox with pagination
        const messages = await imapOps.getMessages('INBOX', {
          offset: Number(offset),
          limit: Number(batchSize),
          descending: true,
          since: since  // Pass through for Look Back feature
        });

        if (messages.length === 0) {
          return {
            success: true,
            processed: 0,
            results: [],
            hasMore: false,
            nextOffset: offset,
            elapsed: Date.now() - startTime
          };
        }

        // Batch fetch full message details
        const uids = messages.map(msg => msg.uid);
        const fullMessages = await imapOps.getMessagesRaw('INBOX', uids);

        // Get action tracking for all messages to filter already processed
        const messageIds = fullMessages.map(msg => msg.messageId).filter((id): id is string => !!id);
        const actionTracking = await EmailActionTracker.getActionsForMessages(accountId, messageIds);

        // Filter to unprocessed messages (unless force is true)
        const toProcess = fullMessages.filter(msg => {
          if (!msg.messageId) {
            return false;
          }
          const tracked = actionTracking[msg.messageId];
          return force || !tracked || tracked.actionTaken === 'none';
        });

        // Process emails in parallel for better throughput
        // Note: processEmail now handles database storage internally (DRY)
        const processingPromises = toProcess.map(msg =>
          this.processEmail({
            message: {
              uid: msg.uid,
              messageId: msg.messageId,
              subject: msg.subject,
              from: msg.from,
              fullMessage: msg.fullMessage
            },
            accountId,
            userId,
            providerId
          })
        );

        const results = await Promise.all(processingPromises);

        // Check if there are more messages to process
        const hasMore = messages.length === batchSize;
        const nextOffset = offset + messages.length;

        return {
          success: true,
          processed: results.length,
          results,
          hasMore,
          nextOffset,
          elapsed: Date.now() - startTime
        };

      } catch (error: unknown) {
        console.error('[InboxProcessor] Batch processing error:', error);
        throw error;
      }
    });
  }
}

// Export singleton instance
export const inboxProcessor = new InboxProcessor();