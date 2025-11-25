/**
 * DraftGenerator Service
 * Handles AI-powered email draft generation with tone learning
 * Combines AI pipeline (tone learning, example selection) with email formatting
 */

import { ToneLearningOrchestrator } from '../pipeline/tone-learning-orchestrator';
import { ProcessedEmail, EmailProcessingResult, DraftEmail, SpamCheckResult, SimplifiedEmailMetadata } from '../pipeline/types';
import { LLMMetadata } from '../llm-client';
import { realTimeLogger } from '../real-time-logger';
import { TypedNameRemover } from '../typed-name-remover';
import { pool } from '../db';
import { ParsedEmailData, UserContext } from './email-processing-service';
import { encode as encodeHtml } from 'he';
import { ActionHelpers } from '../email-actions';
import { RelationshipType } from '../relationships/relationship-detector';
import { StyleAggregationService } from '../style/style-aggregation-service';
import type { Email as PostalMimeEmail, Address } from 'postal-mime';

/**
 * Simplified email address format
 */
interface EmailAddress {
  address: string;
  name?: string;
}

/**
 * Relationship detection result
 */
interface RelationshipResult {
  type: string;
  confidence: number;
}

/**
 * Extract email addresses from Address array
 * Handles PostalMime's Address[] type
 */
function extractAddresses(field: Address[] | undefined): EmailAddress[] {
  if (!field) return [];

  return field.map(addr => ({
    address: addr.address || '',
    name: addr.name
  }));
}

/**
 * Extract single email address (for from field)
 * Handles PostalMime's Address type: { name: string; address?: string }
 */
function extractSingleAddress(field: Address | undefined): EmailAddress | undefined {
  if (!field || !field.address) {
    return undefined;
  }

  return {
    address: field.address,
    name: field.name
  };
}

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
    const maxExamples = parseInt(process.env.EXAMPLE_COUNT!);

    try {
      // Step 1: Get provider-specific orchestrator (cached, already initialized)
      const orchestrator = await getOrchestrator(providerId);

      // Validate required fields for draft generation (fail fast)
      if (!parsed.messageId) {
        throw new Error('Email missing message-id, cannot generate draft');
      }
      if (!parsed.subject) {
        throw new Error('Email missing subject, cannot generate draft');
      }

      // Initialize constants
      const incomingEmailMetadata = {
        from: processedEmail.from,
        to: processedEmail.to,
        cc: processedEmail.cc,
        subject: processedEmail.subject,
        date: processedEmail.date,
        fullMessage: processedEmail.fullMessage
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
        ? this.buildSilentDraft(parsed, aiResult.meta, aiResult.relationship, userContext, spamCheckResult)
        : this.buildReplyDraft(parsed, parsedData.emailBody, cleanedBody, aiResult.meta, aiResult.relationship, userContext, spamCheckResult);

      // Step 6: Log completion
      this.logDraftCompletion(userId, aiResult);

      return {
        success: true,
        draft: formattedDraft
      };

    } catch (error: unknown) {
      console.error('[DraftGenerator] Error generating draft:', error);

      // Re-throw - let caller handle errors (already marked as permanent if applicable)
      throw error;
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
    incomingEmailMetadata: SimplifiedEmailMetadata,
    spamCheckResult: SpamCheckResult,
    timeoutMs: number
  ): Promise<{ body: string; meta: LLMMetadata; relationship: RelationshipResult }> {
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
      // Log selected examples for draft generation
      const directCount = exampleSelection.examples.filter(e => e.metadata.isDirectCorrespondence).length;
      const categoryCount = exampleSelection.examples.filter(e => !e.metadata.isDirectCorrespondence).length;
      console.log(`[DraftGenerator] 📧 Selected ${exampleSelection.examples.length} examples for ${exampleSelection.relationship} relationship: ${directCount} direct, ${categoryCount} category`);
      // exampleSelection.examples.forEach((example, idx) => {
      //   const relationshipLabel = example.metadata.relationship?.type || example.metadata.relationship || 'unknown';
      //   const type = example.metadata.isDirectCorrespondence ? '[DIRECT]' : `[${relationshipLabel.toUpperCase()}]`;
      //   const subject = example.metadata?.subject || 'No subject';
      //   const snippet = example.text.substring(0, 80).replace(/\n/g, ' ');
      //   const scores = `sem=${example.scores.semantic.toFixed(2)} sty=${example.scores.style.toFixed(2)} combined=${example.scores.combined.toFixed(2)}`;
      //   console.log(`[DraftGenerator]   ${idx + 1}. ${type} ${subject} | ${snippet}... | ${scores}`);
      // });

      // Get the detected relationship
      const replyToEmail = processedEmail.replyTo[0]?.address;
      const recipientName = processedEmail.from[0]?.name;
      const detectedRelationship = await orchestrator['relationshipDetector'].detectRelationship({
        userId,
        recipientEmail,
        recipientName,
        replyToEmail
      });

      // Get enhanced profile with aggregated style from PostgreSQL
      const styleService = new StyleAggregationService(pool);
      const aggregatedStyle = await styleService.getAggregatedStyle(userId, exampleSelection.relationship);

      // Wrap aggregated style in enhanced profile structure
      const enhancedProfile = aggregatedStyle ? {
        // Basic relationship profile fields (all optional for now)
        typicalFormality: aggregatedStyle.sentimentProfile.averageFormality.toFixed(2),
        commonGreetings: aggregatedStyle.greetings?.map(g => g.text) || [],
        commonClosings: aggregatedStyle.closings?.map(c => c.text) || [],
        useEmojis: (aggregatedStyle.emojis?.length || 0) > 0,
        useHumor: false,  // Not detected in current system
        preferredTopics: [],
        avoidTopics: [],
        aggregatedStyle
      } : null;

      // Step 2: Load writing patterns (pre-computed during training)
      const writingPatterns = await orchestrator['patternAnalyzer'].loadPatterns(
        userId,
        exampleSelection.relationship
      );

      // Note: If no patterns exist, we should NOT analyze on-demand during draft generation
      // Pattern analysis is expensive (LLM calls + sentence stats calculation)
      // Instead: Background jobs should pre-compute patterns periodically
      // For now: If patterns don't exist, we'll use aggregatedStyle alone
      if (!writingPatterns) {
        console.log(`[DraftGenerator] No writing patterns for ${exampleSelection.relationship} - using aggregatedStyle only`);
      }

      // Step 3: Action Analysis (First LLM Call)
      // Single source of truth for email classification and action determination
      const actionPrompt = await orchestrator['promptFormatter'].formatActionAnalysis({
        incomingEmail: processedEmail.userReply,
        recipientEmail,
        userNames: userContext.userNames,
        incomingEmailMetadata,
        spamCheckResult
      });

      const actionAnalysis = await llmClient.generateActionAnalysis(actionPrompt);

      // Use action analysis as complete metadata (no merging needed)
      const combinedMeta: LLMMetadata = actionAnalysis.meta;

      // Step 4: Response Generation (Second LLM Call - conditional)
      const needsResponse = !ActionHelpers.isSilentAction(combinedMeta.recommendedAction);
      let responseMessage = '';

      if (needsResponse) {
        console.log(`[DraftGenerator] Generating response: action=${combinedMeta.recommendedAction}, examples=${exampleSelection.examples?.length || 0}, relationship=${exampleSelection.relationship}, patterns=${!!writingPatterns}`);

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
      } else {
        console.log('[DraftGenerator] Skipping response generation for silent action');
      }

      // Build final relationship
      const finalRelationship = ActionHelpers.isSpamAction(combinedMeta.recommendedAction)
        ? { type: RelationshipType.SPAM, confidence: 0.9 }
        : { type: exampleSelection.relationship, confidence: detectedRelationship.confidence };

      console.log(`[DraftGenerator] 🎯 Final relationship determination: action=${combinedMeta.recommendedAction}, isSpamAction=${ActionHelpers.isSpamAction(combinedMeta.recommendedAction)}, detectedRelationship=${detectedRelationship.relationship}, finalRelationship=${finalRelationship.type}`);

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
    parsed: PostalMimeEmail,
    meta: LLMMetadata,
    relationship: RelationshipResult,
    userContext: UserContext,
    spamCheckResult: SpamCheckResult
  ): Omit<DraftEmail, 'to' | 'cc' | 'subject' | 'body' | 'bodyHtml'> {
    return {
      id: `draft-${Date.now()}`,
      from: userContext.userEmail,
      inReplyTo: parsed.messageId!,  // Validated at entry point
      references: parsed.messageId!,  // Validated at entry point
      meta,
      relationship,
      draftMetadata: {
        exampleCount: 0, // Will be overridden if needed
        timestamp: new Date().toISOString(),
        originalSubject: parsed.subject,
        originalFrom: extractSingleAddress(parsed.from)?.address,
        spamAnalysis: {
          isSpam: spamCheckResult.isSpam,
          indicators: spamCheckResult.indicators,
          senderResponseCount: spamCheckResult.senderResponseCount
        }
      }
    };
  }

  /**
   * Build draft for silent actions (no reply needed)
   * @private
   */
  private buildSilentDraft(
    parsed: PostalMimeEmail,
    meta: LLMMetadata,
    relationship: RelationshipResult,
    userContext: UserContext,
    spamCheckResult: SpamCheckResult
  ): DraftEmail {
    const fromAddress = extractSingleAddress(parsed.from);
    return {
      ...this.buildBaseDraft(parsed, meta, relationship, userContext, spamCheckResult),
      to: this.formatEmailAddress(fromAddress?.name, fromAddress?.address || ''),
      cc: '',
      subject: parsed.subject!,  // Validated at entry point
      body: ''
    };
  }

  /**
   * Build draft for reply actions
   * @private
   */
  private buildReplyDraft(
    parsed: PostalMimeEmail,
    emailBody: string,
    cleanedBody: string,
    meta: LLMMetadata,
    relationship: RelationshipResult,
    userContext: UserContext,
    spamCheckResult: SpamCheckResult
  ): DraftEmail {
    const fromAddress = extractSingleAddress(parsed.from);
    const formattedReply = this.formatReplyEmail(
      fromAddress?.name || fromAddress?.address || '',
      fromAddress?.address || '',
      parsed.date ? new Date(parsed.date) : new Date(),
      emailBody,
      cleanedBody,
      userContext.typedNameSignature,
      parsed.html || undefined,
      userContext.signatureBlock
    );

    const replySubject = parsed.subject!.toLowerCase().startsWith('re:')  // Validated at entry point
      ? parsed.subject!
      : `Re: ${parsed.subject!}`;

    const isReplyAll = ActionHelpers.isReplyAll(meta.recommendedAction);
    const { to, cc } = isReplyAll
      ? this.calculateReplyAllRecipients(parsed, userContext.userEmail)
      : { to: this.formatEmailAddress(fromAddress?.name, fromAddress?.address || ''), cc: '' };

    return {
      ...this.buildBaseDraft(parsed, meta, relationship, userContext, spamCheckResult),
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
  private calculateReplyAllRecipients(parsed: PostalMimeEmail, userEmail: string): { to: string; cc: string } {
    const allTo: string[] = [];
    const allCc: string[] = [];

    // Add sender to TO
    const from = extractSingleAddress(parsed.from);
    if (from) {
      allTo.push(this.formatEmailAddress(from.name, from.address));
    }

    // Add all TO recipients (except the user)
    const toAddresses = extractAddresses(parsed.to);
    toAddresses.forEach(addr => {
      if (addr.address && addr.address.toLowerCase() !== userEmail.toLowerCase()) {
        allTo.push(this.formatEmailAddress(addr.name, addr.address));
      }
    });

    // Add all CC recipients (except the user)
    const ccAddresses = extractAddresses(parsed.cc);
    ccAddresses.forEach(addr => {
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
    aiResult: { body: string; meta: LLMMetadata; relationship: RelationshipResult }
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
