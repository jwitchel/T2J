/**
 * Spam Detector Service
 * Single source of truth for spam/unsolicited commercial email detection
 */

import { EmailAttachmentStripper } from '../email-attachment-stripper';
import { PromptFormatterV2 } from '../pipeline/prompt-formatter-v2';
import { LLMClient } from '../llm-client';
import { pool } from '../../server';

export interface SpamCheckParams {
  rawMessage: string;
  userNames: {
    name: string;
    nicknames?: string;
  };
}

export interface SpamCheckResult {
  isSpam: boolean;
  indicators: string[];
}

export class SpamDetector {
  private promptFormatter: PromptFormatterV2;
  private llmClient: LLMClient | null = null;

  constructor() {
    this.promptFormatter = new PromptFormatterV2();
  }

  /**
   * Initialize the spam detector with an LLM provider
   * @param providerId - LLM provider ID to use for spam detection
   */
  async initialize(providerId: string): Promise<void> {
    // Load LLM provider config from database
    const result = await pool.query(
      'SELECT config FROM llm_providers WHERE id = $1',
      [providerId]
    );

    if (result.rows.length === 0) {
      throw new Error(`LLM provider ${providerId} not found`);
    }

    this.llmClient = new LLMClient(result.rows[0].config);
  }

  /**
   * Check if an email is spam or unsolicited commercial content
   * @param params - Raw email message and user names
   * @returns SpamCheckResult with spam classification
   */
  async checkSpam(params: SpamCheckParams): Promise<SpamCheckResult> {
    if (!this.llmClient) {
      throw new Error('SpamDetector not initialized. Call initialize() first.');
    }

    const { rawMessage, userNames } = params;

    // Strip attachments from email to reduce token count
    const emailForSpamCheck = await EmailAttachmentStripper.stripAttachments(rawMessage);

    // Format prompt for spam check with stripped email
    const spamCheckPrompt = await this.promptFormatter.formatSpamCheck({
      rawEmail: emailForSpamCheck,
      userNames
    });

    // Perform spam check (retry logic is handled in LLMClient.generate())
    const spamCheckResult = await this.llmClient.generateSpamCheck(spamCheckPrompt);

    const isSpam = spamCheckResult.meta.isSpam;
    const indicators = spamCheckResult.meta.spamIndicators || [];

    // Extract email headers for logging
    const fromMatch = rawMessage.match(/^From:\s*(.+?)$/mi);
    const subjectMatch = rawMessage.match(/^Subject:\s*(.+?)$/mi);

    // Log spam check result for debugging
    console.log('\n=================================================');
    console.log('[SpamDetector] SPAM CHECK RESULT');
    console.log('=================================================');
    console.log('Is Spam:', isSpam);
    console.log('From:', fromMatch?.[1]?.trim() || 'unknown');
    console.log('Subject:', subjectMatch?.[1]?.replace(/\r?\n\s*/g, ' ').trim() || 'unknown');
    console.log('Indicators:', indicators.length > 0 ? indicators : ['None detected']);
    console.log('=================================================\n');

    return {
      isSpam,
      indicators
    };
  }
}
