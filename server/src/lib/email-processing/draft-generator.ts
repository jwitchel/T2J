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
import { ParsedEmailData, UserContext } from './inbox-processor';
import { encode as encodeHtml } from 'he';
import { EmailActionType } from '../../types/email-action-tracking';
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
 * Result of email analysis (action determination without draft generation)
 */
export interface EmailAnalysisResult {
  meta: LLMMetadata;
  relationship: RelationshipResult;
}

/**
 * Extract email addresses from Address array
 * Handles PostalMime's Address[] type
 */
function extractAddresses(field: Address[] | undefined): EmailAddress[] {
  if (!field) return [];

  return field.map(addr => ({
    address: addr.address!,
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
   * Determine recommended action for an incoming email (no draft generation)
   * Returns action metadata and relationship - use when you only need to know what action to take
   */
  async determineAction(
    userId: string,
    providerId: string,
    parsedData: ParsedEmailData,
    userContext: UserContext,
    spamCheckResult: SpamCheckResult
  ): Promise<EmailAnalysisResult> {
    const { processedEmail } = parsedData;
    const recipientEmail = processedEmail.from[0].address;

    const orchestrator = await getOrchestrator(providerId);

    const incomingEmailMetadata = {
      from: processedEmail.from,
      to: processedEmail.to,
      cc: processedEmail.cc,
      subject: processedEmail.subject,
      date: processedEmail.date,
      fullMessage: processedEmail.fullMessage
    };

    return this._runAnalysisPipeline(
      orchestrator,
      processedEmail,
      recipientEmail,
      userId,
      userContext,
      incomingEmailMetadata,
      spamCheckResult
    );
  }

  /**
   * Generate an AI-powered email draft with tone learning
   * Calls determineAction first, then generateDraftFromAnalysis
   */
  async generateDraft(
    userId: string,
    providerId: string,
    parsedData: ParsedEmailData,
    userContext: UserContext,
    spamCheckResult: SpamCheckResult
  ): Promise<EmailProcessingResult> {
    const analysis = await this.determineAction(userId, providerId, parsedData, userContext, spamCheckResult);
    return this.generateDraftFromAnalysis(userId, providerId, parsedData, userContext, spamCheckResult, analysis);
  }

  /**
   * Generate draft using pre-computed analysis result (skips action analysis LLM call)
   * Use this when determineAction has already been called
   */
  async generateDraftFromAnalysis(
    userId: string,
    providerId: string,
    parsedData: ParsedEmailData,
    userContext: UserContext,
    spamCheckResult: SpamCheckResult,
    analysis: EmailAnalysisResult
  ): Promise<EmailProcessingResult> {
    const { parsed, processedEmail } = parsedData;
    const recipientEmail = processedEmail.from[0].address;
    const maxExamples = parseInt(process.env.EXAMPLE_COUNT!);

    const orchestrator = await getOrchestrator(providerId);

    const incomingEmailMetadata = {
      from: processedEmail.from,
      to: processedEmail.to,
      cc: processedEmail.cc,
      subject: processedEmail.subject,
      date: processedEmail.date,
      fullMessage: processedEmail.fullMessage
    };

    // Run response-only pipeline (skips action analysis since we have it)
    const aiResult = await this._runResponsePipeline(
      orchestrator,
      processedEmail,
      recipientEmail,
      userId,
      userContext,
      maxExamples,
      incomingEmailMetadata,
      analysis
    );

    // Clean any typed name that the LLM may have added
    const cleanedBody = await this._removeTypedName(aiResult.body, userId);

    const isSilentAction = EmailActionType.isSilentAction(aiResult.meta.recommendedAction);

    const formattedDraft = isSilentAction
      ? this._buildSilentDraft(parsed, aiResult.meta, aiResult.relationship, userContext, spamCheckResult)
      : this._buildReplyDraft(parsed, processedEmail.textContent!, cleanedBody, aiResult.meta, aiResult.relationship, userContext, spamCheckResult);

    this._logDraftCompletion(userId, aiResult);

    return {
      success: true,
      draft: formattedDraft
    };
  }
  /**
   * Run analysis-only pipeline (no response generation)
   * LLMClient handles timeout internally via AbortController
   * @private
   */
  private async _runAnalysisPipeline(
    orchestrator: ToneLearningOrchestrator,
    processedEmail: ProcessedEmail,
    recipientEmail: string,
    userId: string,
    userContext: UserContext,
    incomingEmailMetadata: SimplifiedEmailMetadata,
    spamCheckResult: SpamCheckResult
  ): Promise<EmailAnalysisResult> {
    const llmClient = orchestrator['patternAnalyzer']['llmClient']!;

    // Relationship detection
    const replyToEmail = processedEmail.replyTo[0]?.address;
    const recipientName = processedEmail.from[0]?.name;
    const detectedRelationship = await orchestrator['relationshipDetector'].detectRelationship({
      userId,
      recipientEmail,
      recipientName,
      replyToEmail
    });

    // Action Analysis (single LLM call)
    const actionPrompt = await orchestrator['promptFormatter'].formatActionAnalysis({
      incomingEmail: processedEmail.userReply,
      recipientEmail,
      userNames: userContext.userNames,
      incomingEmailMetadata,
      spamCheckResult
    });

    const actionAnalysis = await llmClient.generateActionAnalysis(actionPrompt);
    const meta = actionAnalysis.meta;

    // Build relationship result
    const relationship = EmailActionType.isSpamAction(meta.recommendedAction)
      ? { type: RelationshipType.SPAM, confidence: 0.9 }
      : { type: detectedRelationship.relationship, confidence: detectedRelationship.confidence };

    console.log(`[DraftGenerator] determineAction: action=${meta.recommendedAction}, relationship=${relationship.type}`);

    return { meta, relationship };
  }

  /**
   * Run response generation pipeline with pre-computed analysis (skips action analysis LLM call)
   * LLMClient handles timeout internally via AbortController
   * @private
   */
  private async _runResponsePipeline(
    orchestrator: ToneLearningOrchestrator,
    processedEmail: ProcessedEmail,
    recipientEmail: string,
    userId: string,
    userContext: UserContext,
    maxExamples: number,
    incomingEmailMetadata: SimplifiedEmailMetadata,
    analysis: EmailAnalysisResult
  ): Promise<{ body: string; meta: LLMMetadata; relationship: RelationshipResult }> {
    const llmClient = orchestrator['patternAnalyzer']['llmClient']!;

    // Step 1: Select relevant examples
    const exampleSelection = await orchestrator['exampleSelector'].selectExamples({
      userId,
      incomingEmail: processedEmail.userReply,
      recipientEmail,
      desiredCount: maxExamples
    });

    const directCount = exampleSelection.examples.filter(e => e.metadata.isDirectCorrespondence).length;
    const categoryCount = exampleSelection.examples.filter(e => !e.metadata.isDirectCorrespondence).length;
    console.log(`[DraftGenerator] 📧 Selected ${exampleSelection.examples.length} examples for ${exampleSelection.relationship} relationship: ${directCount} direct, ${categoryCount} category`);

    // Step 2: Get enhanced profile with aggregated style
    const styleService = new StyleAggregationService(pool);
    const aggregatedStyle = await styleService.getAggregatedStyle(userId, exampleSelection.relationship);

    const enhancedProfile = aggregatedStyle ? {
      typicalFormality: aggregatedStyle.sentimentProfile.averageFormality.toFixed(2),
      commonGreetings: aggregatedStyle.greetings?.map(g => g.text) ?? [],
      commonClosings: aggregatedStyle.closings?.map(c => c.text) ?? [],
      useEmojis: (aggregatedStyle.emojis?.length ?? 0) > 0,
      useHumor: false,
      preferredTopics: [],
      avoidTopics: [],
      aggregatedStyle
    } : null;

    // Step 3: Load writing patterns
    const writingPatterns = await orchestrator['patternAnalyzer'].loadPatterns(
      userId,
      exampleSelection.relationship
    );

    if (!writingPatterns) {
      console.log(`[DraftGenerator] No writing patterns for ${exampleSelection.relationship} - using aggregatedStyle only`);
    }

    // Step 4: Response Generation (single LLM call - action analysis already done)
    const needsResponse = !EmailActionType.isSilentAction(analysis.meta.recommendedAction);
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
        actionMeta: analysis.meta
      });

      responseMessage = await llmClient.generateResponseMessage(responsePrompt);
    } else {
      console.log('[DraftGenerator] Skipping response generation for silent action');
    }

    console.log(`[DraftGenerator] generateDraftFromAnalysis: action=${analysis.meta.recommendedAction}, relationship=${analysis.relationship.type}, examples=${exampleSelection.examples.length}, patterns=${!!writingPatterns}, needsResponse=${needsResponse}`);

    return {
      body: responseMessage,
      meta: analysis.meta,
      relationship: analysis.relationship
    };
  }

  /**
   * Remove typed name signature from draft body
   * @private
   */
  private async _removeTypedName(body: string, userId: string): Promise<string> {
    const typedNameRemover = new TypedNameRemover();
    const cleaned = await typedNameRemover.removeTypedName(body, userId);
    return cleaned.cleanedText;
  }

  /**
   * Build base draft email structure with common fields
   * @private
   */
  private _buildBaseDraft(
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
  private _buildSilentDraft(
    parsed: PostalMimeEmail,
    meta: LLMMetadata,
    relationship: RelationshipResult,
    userContext: UserContext,
    spamCheckResult: SpamCheckResult
  ): DraftEmail {
    const fromAddress = extractSingleAddress(parsed.from);
    return {
      ...this._buildBaseDraft(parsed, meta, relationship, userContext, spamCheckResult),
      to: this._formatEmailAddress(fromAddress?.name, fromAddress!.address),
      cc: '',
      subject: parsed.subject!,  // Validated at entry point
      body: ''
    };
  }

  /**
   * Build draft for reply actions
   * @private
   */
  private _buildReplyDraft(
    parsed: PostalMimeEmail,
    emailBody: string,
    cleanedBody: string,
    meta: LLMMetadata,
    relationship: RelationshipResult,
    userContext: UserContext,
    spamCheckResult: SpamCheckResult
  ): DraftEmail {
    const fromAddress = extractSingleAddress(parsed.from);
    const formattedReply = this._formatReplyEmail(
      fromAddress?.name || fromAddress!.address,
      fromAddress!.address,
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

    const isReplyAll = EmailActionType.isReplyAll(meta.recommendedAction);
    const { to, cc } = isReplyAll
      ? this._calculateReplyAllRecipients(parsed, userContext.userEmail)
      : { to: this._formatEmailAddress(fromAddress?.name, fromAddress!.address), cc: '' };

    return {
      ...this._buildBaseDraft(parsed, meta, relationship, userContext, spamCheckResult),
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
  private _formatReplyEmail(
    originalFromName: string,
    originalFromEmail: string,
    originalDate: Date,
    originalBody: string,
    replyBody: string,
    typedName?: string,
    originalHtml?: string,
    signatureBlock?: string
  ): { text: string; html?: string } {
    const formattedDate = this._formatEmailDate(originalDate);
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
      ? this._formatHtmlReply(replyBody, typedName, signatureBlock, formattedDate, originalFromName, originalFromEmail, originalHtml)
      : undefined;

    return { text: textReply, html: htmlReply };
  }

  /**
   * Format HTML version of reply
   * @private
   */
  private _formatHtmlReply(
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
  private _calculateReplyAllRecipients(parsed: PostalMimeEmail, userEmail: string): { to: string; cc: string } {
    const allTo: string[] = [];
    const allCc: string[] = [];

    // Add sender to TO
    const from = extractSingleAddress(parsed.from);
    if (from) {
      allTo.push(this._formatEmailAddress(from.name, from.address));
    }

    // Add all TO recipients (except the user)
    const toAddresses = extractAddresses(parsed.to);
    toAddresses.forEach(addr => {
      if (addr.address && addr.address.toLowerCase() !== userEmail.toLowerCase()) {
        allTo.push(this._formatEmailAddress(addr.name, addr.address));
      }
    });

    // Add all CC recipients (except the user)
    const ccAddresses = extractAddresses(parsed.cc);
    ccAddresses.forEach(addr => {
      if (addr.address && addr.address.toLowerCase() !== userEmail.toLowerCase()) {
        allCc.push(this._formatEmailAddress(addr.name, addr.address));
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
  private _formatEmailAddress(name: string | undefined, email: string): string {
    return name && name !== email ? `${name} <${email}>` : email;
  }

  /**
   * Format date for email reply header
   * @private
   */
  private _formatEmailDate(date: Date): string {
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
   * Log draft generation completion
   * @private
   */
  private _logDraftCompletion(
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
          recommendedAction: aiResult.meta.recommendedAction
        }
      }
    });
  }
}

// Export singleton instance
export const draftGenerator = new DraftGenerator();
