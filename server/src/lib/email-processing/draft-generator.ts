/**
 * DraftGenerator Service
 * Handles AI-powered email draft generation
 * Requires pre-parsed email data and user context from EmailProcessingService
 */

import { ToneLearningOrchestrator } from '../pipeline/tone-learning-orchestrator';
import { ProcessedEmail, EmailProcessingResult, DraftEmail } from '../pipeline/types';
import { realTimeLogger } from '../real-time-logger';
import { TypedNameRemover } from '../typed-name-remover';
import { pool } from '../../server';
import { ParsedEmailData, UserContext } from './email-processing-service';

// Provider-keyed cache to avoid race conditions when processing emails concurrently
const orchestratorCache = new Map<string, ToneLearningOrchestrator>();

async function getOrchestrator(providerId: string): Promise<ToneLearningOrchestrator> {
  let orchestrator = orchestratorCache.get(providerId);

  if (!orchestrator) {
    orchestrator = new ToneLearningOrchestrator();
    await orchestrator.initialize();
    await orchestrator['patternAnalyzer'].initialize(providerId);
    orchestratorCache.set(providerId, orchestrator);
  }

  return orchestrator;
}

const SILENT_ACTIONS = ['silent-fyi-only', 'silent-large-list', 'silent-unsubscribe', 'silent-spam'];

export class DraftGenerator {
  /**
   * Generate an AI-powered email draft
   */
  async generateDraft(
    userId: string,
    providerId: string,
    parsedData: ParsedEmailData,
    userContext: UserContext
  ): Promise<EmailProcessingResult> {
    const { parsed, processedEmail } = parsedData;

    try {
      // Step 1: Get provider-specific orchestrator (cached, already initialized)
      const orchestrator = await getOrchestrator(providerId);

      // Step 2: Generate draft using orchestrator (with timeout protection)
      const llmTimeout = parseInt(process.env.EMAIL_PROCESSING_LLM_TIMEOUT || '20000');
      const draft = await this.generateDraftWithTimeout(orchestrator, processedEmail, userId, userContext, llmTimeout);

      // Step 3: Clean any typed name that the LLM may have added
      const cleanedBody = await this.removeTypedName(draft.body, userId);

      // Step 4: Determine if this is a silent action
      const isSilentAction = draft.meta && SILENT_ACTIONS.includes(draft.meta.recommendedAction);

      // Step 5: Format complete draft response
      const formattedDraft = isSilentAction
        ? this.buildSilentDraft(parsed, draft, userContext)
        : this.buildReplyDraft(parsed, parsedData.emailBody, cleanedBody, draft, userContext);

      // Step 6: Log completion
      this.logDraftCompletion(userId, draft);

      return {
        success: true,
        draft: formattedDraft
      };

    } catch (error) {
      console.error('[DraftGenerator] Error generating draft:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = errorMessage.includes('timeout') ? 'LLM_TIMEOUT' : 'UNKNOWN';

      return {
        success: false,
        error: errorMessage,
        errorCode
      };
    }
  }

  /**
   * Generate draft with timeout protection
   * @private
   */
  private async generateDraftWithTimeout(
    orchestrator: ToneLearningOrchestrator,
    processedEmail: ProcessedEmail,
    userId: string,
    userContext: UserContext,
    timeoutMs: number
  ) {
    const draftPromise = orchestrator.generateDraft({
      incomingEmail: processedEmail,
      recipientEmail: processedEmail.from[0].address,
      config: {
        userId,
        userNames: userContext.userNames
      }
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`LLM timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([draftPromise, timeoutPromise]);
  }

  /**
   * Remove typed name signature from draft body
   * @private
   */
  private async removeTypedName(body: string, userId: string): Promise<string> {
    const typedNameRemover = new TypedNameRemover(pool);
    const cleaned = await typedNameRemover.removeTypedName(body, userId);
    return cleaned.cleanedText;
  }

  /**
   * Build base draft email structure with common fields
   * @private
   */
  private buildBaseDraft(
    parsed: any,
    draft: any,
    userContext: UserContext
  ): Omit<DraftEmail, 'to' | 'cc' | 'subject' | 'body' | 'bodyHtml'> {
    return {
      id: draft.id,
      from: userContext.userEmail,
      inReplyTo: parsed.messageId || `<${Date.now()}>`,
      references: parsed.messageId || `<${Date.now()}>`,
      meta: draft.meta!,
      relationship: draft.relationship,
      draftMetadata: {
        ...draft.metadata,
        originalSubject: parsed.subject,
        originalFrom: parsed.from?.address
      }
    };
  }

  /**
   * Build draft for silent actions (no reply needed)
   * @private
   */
  private buildSilentDraft(
    parsed: any,
    draft: any,
    userContext: UserContext
  ): DraftEmail {
    return {
      ...this.buildBaseDraft(parsed, draft, userContext),
      to: this.formatEmailAddress(parsed.from?.name, parsed.from?.address),
      cc: '',
      subject: parsed.subject || '',
      body: ''
    };
  }

  /**
   * Build draft for reply actions
   * @private
   */
  private buildReplyDraft(
    parsed: any,
    emailBody: string,
    cleanedBody: string,
    draft: any,
    userContext: UserContext
  ): DraftEmail {
    const formattedReply = this.formatReplyEmail(
      parsed.from?.name || parsed.from?.address,
      parsed.from?.address,
      parsed.date ? new Date(parsed.date) : new Date(),
      emailBody,
      cleanedBody,
      userContext.typedNameSignature,
      parsed.html || undefined,
      userContext.signatureBlock
    );

    const replySubject = (parsed.subject || '').toLowerCase().startsWith('re:')
      ? parsed.subject
      : `Re: ${parsed.subject}`;

    const isReplyAll = draft.meta?.recommendedAction === 'reply-all';
    const { to, cc } = isReplyAll
      ? this.calculateReplyAllRecipients(parsed, userContext.userEmail)
      : { to: this.formatEmailAddress(parsed.from?.name, parsed.from?.address), cc: '' };

    return {
      ...this.buildBaseDraft(parsed, draft, userContext),
      to,
      cc,
      subject: replySubject,
      body: formattedReply.text,
      bodyHtml: formattedReply.html
    };
  }

  /**
   * Format reply email with quoted original message
   * @private
   */
  private formatReplyEmail(
    originalFromName: string,
    originalFromEmail: string,
    originalDate: Date,
    originalBody: string,
    replyBody: string,
    typedName?: string,
    originalHtml?: string,
    signatureBlock?: string
  ): { text: string; html?: string } {
    const formattedDate = this.formatEmailDate(originalDate);
    const senderInfo = originalFromName && originalFromName !== originalFromEmail
      ? `${originalFromName} (${originalFromEmail})`
      : originalFromEmail;

    // Build reply with typed name and signature
    let fullReply = replyBody;
    if (typedName) fullReply = `${fullReply}\n${typedName}`;
    if (signatureBlock) fullReply = `${fullReply}\n${signatureBlock}`;

    // Plain text version
    const quotedBody = originalBody.split('\n').map(line => `> ${line}`).join('\n');
    const textReply = `${fullReply}\n\nOn ${formattedDate}, ${senderInfo} wrote:\n\n${quotedBody}`;

    // HTML version if original had HTML
    const htmlReply = originalHtml
      ? this.formatHtmlReply(replyBody, typedName, signatureBlock, formattedDate, originalFromName, originalFromEmail, originalHtml)
      : undefined;

    return { text: textReply, html: htmlReply };
  }

  /**
   * Format HTML version of reply
   * @private
   */
  private formatHtmlReply(
    replyBody: string,
    typedName: string | undefined,
    signatureBlock: string | undefined,
    formattedDate: string,
    originalFromName: string,
    originalFromEmail: string,
    originalHtml: string
  ): string {
    const replyHtml = replyBody.split('\n')
      .map(line => line.trim() === '' ? '<br>' : `<p style="margin: 0 0 1em 0;">${this.escapeHtml(line)}</p>`)
      .join('\n');

    const typedNameHtml = typedName ? `<p style="margin: 0;">${this.escapeHtml(typedName)}</p>` : '';
    const signatureHtml = signatureBlock
      ? signatureBlock.split('\n').map(line => `<p style="margin: 0;">${this.escapeHtml(line)}</p>`).join('\n')
      : '';

    const senderInfoHtml = originalFromName && originalFromName !== originalFromEmail
      ? `${originalFromName} (<a href="mailto:${originalFromEmail}">${originalFromEmail}</a>)`
      : `<a href="mailto:${originalFromEmail}">${originalFromEmail}</a>`;

    return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
${replyHtml}
${typedNameHtml}
${signatureHtml ? `<div style="margin-top: 1em;">${signatureHtml}</div>` : ''}
<br>
<div style="margin-top: 1em;">On ${formattedDate}, ${senderInfoHtml} wrote:</div>
<blockquote type="cite" style="margin: 1em 0 0 0; padding-left: 1em; border-left: 2px solid #ccc;">
${originalHtml}
</blockquote>
</div>`;
  }

  /**
   * Calculate recipients for reply-all
   * @private
   */
  private calculateReplyAllRecipients(parsed: any, userEmail: string): { to: string; cc: string } {
    const allTo: string[] = [this.formatEmailAddress(parsed.from?.name, parsed.from?.address)];
    const allCc: string[] = [];

    // Add all TO recipients (except the user)
    (parsed.to || []).forEach((addr: any) => {
      if (addr.address && addr.address.toLowerCase() !== userEmail.toLowerCase()) {
        allTo.push(this.formatEmailAddress(addr.name, addr.address));
      }
    });

    // Add all CC recipients (except the user)
    (parsed.cc || []).forEach((addr: any) => {
      if (addr.address && addr.address.toLowerCase() !== userEmail.toLowerCase()) {
        allCc.push(this.formatEmailAddress(addr.name, addr.address));
      }
    });

    return {
      to: allTo.join(', '),
      cc: allCc.join(', ')
    };
  }

  /**
   * Format email address with optional name
   * @private
   */
  private formatEmailAddress(name: string | undefined, email: string): string {
    return name && name !== email ? `${name} <${email}>` : email;
  }

  /**
   * Format date for email reply header
   * @private
   */
  private formatEmailDate(date: Date): string {
    const formatted = date.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    // Add "at" between date and time: "August 12, 2025 at 4:44:56 PM"
    const parts = formatted.split(', ');
    return parts.length === 3 ? `${parts[0]}, ${parts[1]} at ${parts[2]}` : formatted;
  }

  /**
   * Escape HTML entities
   * @private
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Log draft generation completion
   * @private
   */
  private logDraftCompletion(userId: string, draft: any): void {
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'unknown', // Not available in this context
      level: 'info',
      command: 'DRAFT_GENERATION_COMPLETE',
      data: {
        parsed: {
          draftId: draft.id,
          wordCount: draft.body.split(/\s+/).length,
          relationship: draft.relationship.type,
          recommendedAction: draft.meta?.recommendedAction
        }
      }
    });
  }
}

// Export singleton instance
export const draftGenerator = new DraftGenerator();
