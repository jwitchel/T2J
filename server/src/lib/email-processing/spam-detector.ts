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
      `SELECT id, provider_type, api_key_encrypted as api_key, api_endpoint, model_name
       FROM llm_providers
       WHERE id = $1 AND is_active = true`,
      [providerId]
    );

    if (result.rows.length === 0) {
      throw new Error(`LLM provider ${providerId} not found or not active`);
    }

    const provider = result.rows[0];

    // Decrypt the API key
    const { decryptPassword } = await import('../crypto');
    const decryptedApiKey = decryptPassword(provider.api_key);

    // Build LLMProviderConfig object
    const config = {
      id: provider.id,
      type: provider.provider_type,
      apiKey: decryptedApiKey,
      apiEndpoint: provider.api_endpoint,
      modelName: provider.model_name
    };

    this.llmClient = new LLMClient(config);
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

    // Log spam check result for debugging (removed verbose multi-line format)

    return {
      isSpam,
      indicators
    };
  }
}
