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
import { emailLockManager } from '../email-lock-manager';

// Silent actions that don't require draft creation
const SILENT_ACTIONS = ['silent-fyi-only', 'silent-large-list', 'silent-unsubscribe', 'silent-spam'];

export interface ProcessEmailParams {
  message: {
    uid: number;
    messageId?: string;
    subject?: string;
    from?: string;
    rawMessage: string;
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
   * Process a single email with distributed lock protection
   * Prevents duplicate drafts when same email is processed concurrently
   */
  async processEmail(params: ProcessEmailParams): Promise<ProcessEmailResult> {
    const { message, accountId } = params;
    const emailId = message.messageId || `${message.uid}@${accountId}`;

    // Acquire distributed lock - prevents concurrent processing of same email
    const lockResult = await emailLockManager.processWithLock(
      emailId,
      accountId,
      (signal) => this._executeProcessing(params, signal)
    );

    // Lock already held by another process - skip to avoid duplicate
    if (!lockResult.acquired) {
      return this._createSkippedResult(message, lockResult.reason);
    }

    return lockResult.result!;
  }

  /**
   * Execute email processing with lock held
   * @private
   */
  private async _executeProcessing(
    params: ProcessEmailParams,
    signal: AbortSignal
  ): Promise<ProcessEmailResult> {
    const { message, accountId, userId, providerId, generatedDraft: existingDraft } = params;

    try {
      let generatedDraft: any;

      // Step 1: Use existing draft if provided, otherwise process email (spam check + draft generation)
      if (existingDraft) {
        generatedDraft = existingDraft;
      } else {
        // Use EmailProcessingService - handles spam check and draft generation
        // with NO duplicate parsing or DB queries
        const processingResult = await emailProcessingService.processEmail({
          rawMessage: message.rawMessage,
          emailAccountId: accountId,
          providerId,
          userId
        });

        if (!processingResult.success) {
          const error = processingResult.error || 'Failed to process email';

          // Check if this is a permanent failure (account not found/deleted)
          // These should NOT retry - they're user configuration issues
          if (processingResult.errorCode === 'ACCOUNT_NOT_FOUND') {
            const permanentError = new Error(error);
            (permanentError as any).permanent = true; // Mark as permanent for worker to skip retry
            throw permanentError;
          }

          // Retryable error (LLM timeout, network issues, etc.)
          throw new Error(error);
        }

        generatedDraft = processingResult.draft;
      }

      // Critical check: Abort if lock expired during draft generation
      // This prevents duplicate drafts when operations run long
      if (signal.aborted) {
        throw new Error('Lock expired during draft generation - aborting to prevent duplicate');
      }

      const recommendedAction = generatedDraft.meta.recommendedAction; // Always present

      let moved = false;
      let destination = 'INBOX';
      let actionDescription = 'Reply sent';

      // Step 2: Record action tracking BEFORE IMAP operations (optimistic locking)
      // This prevents duplicates if process crashes after IMAP but before tracking
      try {
        await EmailActionTracker.recordAction(
          userId,
          accountId,
          message.messageId || `${message.uid}@${accountId}`,
          recommendedAction,  // Record the actual recommended action
          message.subject,     // Store subject for dashboard display
          undefined,           // Destination will be updated after IMAP operations
          message.uid,         // Store UID for fallback IMAP fetching
          message.from         // Store sender email for dashboard display
        );
      } catch (trackingError) {
        console.error(`[InboxProcessor] Failed to record action tracking:`, trackingError);
        throw trackingError;
      }

      // Step 3: Check signal before IMAP operations (lock may have expired during draft generation)
      if (signal.aborted) {
        throw new Error('Lock expired before IMAP operations - aborting to prevent duplicate');
      }

      // Step 4: Process based on action type (matching /inbox page logic exactly)
      try {
        if (SILENT_ACTIONS.includes(recommendedAction)) {
          // For silent actions, just move the email (no draft to upload)
          const moveResponse = await emailMover.moveEmail({
            emailAccountId: accountId,
            userId,
            messageUid: message.uid,
            messageId: message.messageId,
            sourceFolder: 'INBOX',
            recommendedAction
          });

          if (moveResponse.success) {
            moved = true;
            destination = moveResponse.folder || destination;
            actionDescription = moveResponse.message || `Moved to ${destination}`;
          }
        } else {
          // For other actions (reply, etc), upload the draft (original stays in INBOX)
          const uploadResponse = await emailMover.uploadDraft({
            emailAccountId: accountId,
            userId,
            to: generatedDraft.to,
            cc: generatedDraft.cc,
            subject: generatedDraft.subject,
            body: generatedDraft.body,
            bodyHtml: generatedDraft.bodyHtml,
            inReplyTo: generatedDraft.inReplyTo,
            references: generatedDraft.references,
            recommendedAction
          });

          if (uploadResponse.success) {
            moved = true;
            destination = uploadResponse.folder || destination;
            actionDescription = uploadResponse.message || 'Draft created and email moved';
          }
        }

        // Update action tracking with final destination after IMAP operations
        await EmailActionTracker.recordAction(
          userId,
          accountId,
          message.messageId || `${message.uid}@${accountId}`,
          recommendedAction,  // Use the actual recommended action
          message.subject,
          destination,
          message.uid,         // Store UID for fallback IMAP fetching
          message.from         // Store sender email for dashboard display
        );

      } catch (moveError) {
        console.error(`[InboxProcessor] Failed to process message ${message.messageId}:`, moveError);
        // Rollback action tracking on failure
        try {
          await EmailActionTracker.resetAction(accountId, message.messageId || `${message.uid}@${accountId}`);
        } catch (rollbackError) {
          console.error(`[InboxProcessor] Failed to rollback action tracking:`, rollbackError);
        }
        throw moveError;
      }

      // Step 5: Save incoming email to Qdrant (same as processBatch)
      try {
        // Construct full email data structure matching EmailMessageWithRaw
        const emailData = {
          uid: message.uid,
          messageId: message.messageId,
          subject: message.subject,
          from: message.from,
          rawMessage: message.rawMessage,
          to: [], // These will be parsed from rawMessage by emailStorageService
          cc: [],
          date: new Date(),
          flags: [],
          size: message.rawMessage.length
        };

        // Construct LLM response metadata from generated draft
        const llmResponse = generatedDraft ? {
          meta: generatedDraft.meta, // Contains recommendedAction, urgency, keyConsiderations, etc.
          generatedAt: generatedDraft.generatedAt || new Date().toISOString(),
          providerId: providerId,
          modelName: generatedDraft.modelName || 'unknown',
          draftId: generatedDraft.id || '',
          relationship: generatedDraft.relationship || {
            type: 'professional',
            confidence: 0.5,
            detectionMethod: 'default'
          }
        } : undefined;

        await emailStorageService.saveEmail({
          userId,
          emailAccountId: accountId,
          emailData,
          emailType: 'incoming',
          folderName: 'INBOX',
          llmResponse
        });
      } catch (storageError) {
        // Log error but don't fail inbox processing
        console.error(`[InboxProcessor] Failed to save email ${message.messageId} to Qdrant:`, storageError);
      }

      return {
        success: true,
        messageId: message.messageId,
        subject: message.subject,
        from: message.from,
        action: recommendedAction,
        actionDescription,
        destination,
        draftId: generatedDraft?.id,
        moved
      };

    } catch (error) {
      console.error(`[InboxProcessor] Error processing message ${message.messageId}:`, error);
      return {
        success: false,
        messageId: message.messageId,
        subject: message.subject,
        from: message.from,
        action: 'error',
        actionDescription: 'Failed to process',
        destination: 'INBOX',
        moved: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
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
        const results: ProcessEmailResult[] = [];

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

        // Process each email
        // Note: processEmail now handles Qdrant storage internally (DRY)
        for (const msg of toProcess) {
          const result = await this.processEmail({
            message: {
              uid: msg.uid,
              messageId: msg.messageId,
              subject: msg.subject,
              from: msg.from,
              rawMessage: msg.rawMessage
            },
            accountId,
            userId,
            providerId
          });

          results.push(result);
        }

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

      } catch (error) {
        console.error('[InboxProcessor] Batch processing error:', error);
        throw error;
      }
    });
  }
}

// Export singleton instance
export const inboxProcessor = new InboxProcessor();