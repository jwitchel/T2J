/**
 * DraftGenerator Service
 * Handles AI-powered email draft generation with tone learning
 * Combines AI pipeline (tone learning, example selection) with email formatting
 */

import { ToneLearningOrchestrator } from '../pipeline/tone-learning-orchestrator';
import { ProcessedEmail, EmailProcessingResult, DraftEmail } from '../pipeline/types';
import { LLMMetadata } from '../llm-client';
import { realTimeLogger } from '../real-time-logger';
import { TypedNameRemover } from '../typed-name-remover';
import { pool } from '../../server';
import { ParsedEmailData, UserContext } from './email-processing-service';
import { encode as encodeHtml } from 'he';
import { ActionHelpers } from '../email-actions';
import { SpamCheckResult } from './spam-detector';

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

export class DraftGenerator {
  /**
   * Generate an AI-powered email draft with tone learning
   * Full pipeline: example selection → pattern analysis → LLM calls → email formatting
   */
  async generateDraft(
    userId: string,
    providerId: string,
    parsedData: ParsedEmailData,
    userContext: UserContext,
    spamCheckResult: SpamCheckResult
  ): Promise<EmailProcessingResult> {
    const { parsed, processedEmail } = parsedData;
    const recipientEmail = processedEmail.from[0].address;
    const maxExamples = parseInt(process.env.EXAMPLE_COUNT || '25');

    try {
      // Step 1: Get provider-specific orchestrator (cached, already initialized)
      const orchestrator = await getOrchestrator(providerId);

      // Initialize constants - pass complete raw email for LLM analysis
      // Note: LLMClient automatically strips attachments to prevent token limit errors
      const incomingEmailMetadata = {
        from: processedEmail.from,
        to: processedEmail.to,
        cc: processedEmail.cc,
        subject: processedEmail.subject,
        date: processedEmail.date,
        rawMessage: processedEmail.rawMessage
      };

      // Step 2: Run AI pipeline with timeout protection
      const llmTimeout = parseInt(process.env.EMAIL_PROCESSING_LLM_TIMEOUT || '20000');
      const aiResult = await this.runAIPipelineWithTimeout(
        orchestrator,
        processedEmail,
        recipientEmail,
        userId,
        userContext,
        maxExamples,
        incomingEmailMetadata,
        spamCheckResult,
        llmTimeout
      );

      // Step 3: Clean any typed name that the LLM may have added
      const cleanedBody = await this.removeTypedName(aiResult.body, userId);

      // Step 4: Determine if this is a silent action
      const isSilentAction = aiResult.meta && ActionHelpers.isSilentAction(aiResult.meta.recommendedAction);

      // Step 5: Format complete draft response
      const formattedDraft = isSilentAction
        ? this.buildSilentDraft(parsed, aiResult.meta, aiResult.relationship, userContext)
        : this.buildReplyDraft(parsed, parsedData.emailBody, cleanedBody, aiResult.meta, aiResult.relationship, userContext);

      // Step 6: Log completion
      this.logDraftCompletion(userId, aiResult);

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
   * Run complete AI pipeline with timeout protection (moved from ToneLearningOrchestrator.generateDraft)
   * Incorporates: example selection, pattern analysis, LLM calls (meta-context, action, response)
   * @private
   */
  private async runAIPipelineWithTimeout(
    orchestrator: ToneLearningOrchestrator,
    processedEmail: ProcessedEmail,
    recipientEmail: string,
    userId: string,
    userContext: UserContext,
    maxExamples: number,
    incomingEmailMetadata: any,
    spamCheckResult: SpamCheckResult,
    timeoutMs: number
  ): Promise<{ body: string; meta: LLMMetadata; relationship: { type: string; confidence: number; detectionMethod: string } }> {
    // Validate LLM client is available (should be already checked, but for type safety)
    const llmClient = orchestrator['patternAnalyzer']['llmClient'];
    if (!llmClient) {
      throw new Error('LLM client not initialized');
    }

    const pipelinePromise = (async () => {
      // Step 1: Select relevant examples
      const exampleSelection = await orchestrator['exampleSelector'].selectExamples({
        userId,
        incomingEmail: processedEmail.userReply,
        recipientEmail,
        desiredCount: maxExamples
      });

      // Get the detected relationship
      const detectedRelationship = await orchestrator['relationshipDetector'].detectRelationship({
        userId,
        recipientEmail
      });

      // Get enhanced profile with aggregated style
      const enhancedProfile = await orchestrator['relationshipService'].getEnhancedProfile(
        userId,
        recipientEmail
      );

      // Step 2: Analyze writing patterns
      let writingPatterns = await orchestrator['patternAnalyzer'].loadPatterns(
        userId,
        exampleSelection.relationship
      );

      // If no patterns exist, analyze from available examples
      if (!writingPatterns && exampleSelection.examples.length > 0) {
        const emailsForAnalysis: ProcessedEmail[] = exampleSelection.examples.map(ex => ({
          uid: ex.id,
          messageId: ex.id,
          inReplyTo: null,
          date: new Date(ex.metadata.sentAt || Date.now()),
          from: [{ address: ex.metadata.senderEmail || '', name: '' }],
          to: [{ address: ex.metadata.recipientEmail || recipientEmail, name: '' }],
          cc: [],
          bcc: [],
          subject: ex.metadata.subject || '',
          textContent: ex.text,
          htmlContent: null,
          userReply: ex.text,
          respondedTo: '',
          rawMessage: '' // Not needed for pattern analysis
        }));

        writingPatterns = await orchestrator['patternAnalyzer'].analyzeWritingPatterns(
          userId,
          emailsForAnalysis,
          exampleSelection.relationship
        );

        await orchestrator['patternAnalyzer'].savePatterns(
          userId,
          writingPatterns,
          exampleSelection.relationship,
          emailsForAnalysis.length
        );
      }

      // Step 3: Meta-Context Analysis (First LLM Call)
      const metaContextPrompt = await orchestrator['promptFormatter'].formatMetaContextAnalysis({
        incomingEmail: processedEmail.userReply,
        recipientEmail,
        userNames: userContext.userNames,
        incomingEmailMetadata
      });

      const metaContextAnalysis = await llmClient.generateMetaContextAnalysis(metaContextPrompt);

      // Step 4: Action Analysis (Second LLM Call)
      const actionPrompt = await orchestrator['promptFormatter'].formatActionAnalysis({
        incomingEmail: processedEmail.userReply,
        recipientEmail,
        userNames: userContext.userNames,
        incomingEmailMetadata,
        spamCheckResult
      });

      const actionAnalysis = await llmClient.generateActionAnalysis(actionPrompt);

      // Combine meta-context and action into full metadata
      const combinedMeta: LLMMetadata = {
        ...metaContextAnalysis.meta,
        ...actionAnalysis.meta
      };

      // Step 5: Response Generation (Third LLM Call - conditional)
      const needsResponse = !ActionHelpers.isSilentAction(combinedMeta.recommendedAction);
      let responseMessage = '';

      if (needsResponse) {
        const responsePrompt = await orchestrator['promptFormatter'].formatResponseGeneration({
          incomingEmail: processedEmail.userReply,
          recipientEmail,
          examples: exampleSelection.examples,
          relationship: exampleSelection.relationship,
          relationshipProfile: enhancedProfile,
          writingPatterns,
          userNames: userContext.userNames,
          incomingEmailMetadata,
          actionMeta: combinedMeta
        });

        responseMessage = await llmClient.generateResponseMessage(responsePrompt);
      }

      // Build final relationship
      const finalRelationship = ActionHelpers.isSpamAction(combinedMeta.recommendedAction)
        ? { type: 'external', confidence: 0.9, detectionMethod: 'spam-override' }
        : { type: exampleSelection.relationship, confidence: detectedRelationship.confidence, detectionMethod: detectedRelationship.method };

      return {
        body: responseMessage,
        meta: combinedMeta,
        relationship: finalRelationship
      };
    })();

    // Create timeout promise with cleanup capability
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        console.error(`[DraftGenerator] ⏱️ TIMEOUT: Pipeline exceeded ${timeoutMs}ms - aborting at runAIPipelineWithTimeout() level`);
        reject(new Error(`LLM timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    // Race between pipeline and timeout, then cleanup
    return Promise.race([pipelinePromise, timeoutPromise]).finally(() => {
      // Clear timeout to prevent false timeout messages after successful completion
      clearTimeout(timeoutId);
    });
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
    meta: LLMMetadata,
    relationship: { type: string; confidence: number; detectionMethod: string },
    userContext: UserContext
  ): Omit<DraftEmail, 'to' | 'cc' | 'subject' | 'body' | 'bodyHtml'> {
    return {
      id: `draft-${Date.now()}`,
      from: userContext.userEmail,
      inReplyTo: parsed.messageId || `<${Date.now()}>`,
      references: parsed.messageId || `<${Date.now()}>`,
      meta,
      relationship,
      draftMetadata: {
        exampleCount: 0, // Will be overridden if needed
        timestamp: new Date().toISOString(),
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
    meta: LLMMetadata,
    relationship: { type: string; confidence: number; detectionMethod: string },
    userContext: UserContext
  ): DraftEmail {
    return {
      ...this.buildBaseDraft(parsed, meta, relationship, userContext),
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
    meta: LLMMetadata,
    relationship: { type: string; confidence: number; detectionMethod: string },
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

    const isReplyAll = ActionHelpers.isReplyAll(meta.recommendedAction);
    const { to, cc } = isReplyAll
      ? this.calculateReplyAllRecipients(parsed, userContext.userEmail)
      : { to: this.formatEmailAddress(parsed.from?.name, parsed.from?.address), cc: '' };

    return {
      ...this.buildBaseDraft(parsed, meta, relationship, userContext),
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
      .map(line => line.trim() === '' ? '<br>' : `<p style="margin: 0 0 1em 0;">${encodeHtml(line)}</p>`)
      .join('\n');

    const typedNameHtml = typedName ? `<p style="margin: 0;">${encodeHtml(typedName)}</p>` : '';
    const signatureHtml = signatureBlock
      ? signatureBlock.split('\n').map(line => `<p style="margin: 0;">${encodeHtml(line)}</p>`).join('\n')
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
   * NOTE: Now using 'he' library's encode() function instead of custom implementation
   * The 'he' library is the industry-standard, well-tested HTML entity encoder/decoder
   * @deprecated - Replaced by he.encode() imported at top of file
   */

  /**
   * Log draft generation completion
   * @private
   */
  private logDraftCompletion(
    userId: string,
    aiResult: { body: string; meta: LLMMetadata; relationship: { type: string; confidence: number; detectionMethod: string } }
  ): void {
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: 'unknown', // Not available in this context
      level: 'info',
      command: 'DRAFT_GENERATION_COMPLETE',
      data: {
        parsed: {
          draftId: `draft-${Date.now()}`,
          wordCount: aiResult.body.split(/\s+/).length,
          relationship: aiResult.relationship.type,
          recommendedAction: aiResult.meta?.recommendedAction
        }
      }
    });
  }
}

// Export singleton instance
export const draftGenerator = new DraftGenerator();
