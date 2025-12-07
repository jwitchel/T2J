/**
 * Spam Detector Service
 * Single source of truth for spam/unsolicited commercial email detection
 */

import { PromptFormatterV2 } from '../pipeline/prompt-formatter-v2';
import { LLMClient } from '../llm-client';
import { pool } from '../db';
import { SpamCheckResult } from '../pipeline/types';

export interface SpamCheckParams {
  senderEmail: string;
  replyTo?: string;  // Optional: Reply-To header address (checked first for response count)
  fullMessage: string;
  subject?: string;
  userNames: {
    name: string;
    nicknames?: string;
  };
  userId: string;
}

export type { SpamCheckResult };

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
   * Get response count for sender across ALL user's email accounts
   * Uses JOIN through person_emails to find responses to this sender
   * @private
   */
  private async _getResponseCount(userId: string, senderEmail: string): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*)::int as total
       FROM email_sent es
       INNER JOIN person_emails pe ON es.recipient_person_email_id = pe.id
       WHERE es.user_id = $1 AND pe.email_address = $2`,
      [userId, senderEmail.toLowerCase()]
    );

    return result.rows[0]?.total || 0;
  }

  /**
   * Check if an email is spam or unsolicited commercial content
   * @param params - Sender email, raw message, and user context
   * @returns SpamCheckResult with spam classification
   */
  async checkSpam(params: SpamCheckParams): Promise<SpamCheckResult> {
    if (!this.llmClient) {
      throw new Error('SpamDetector not initialized. Call initialize() first.');
    }

    const { senderEmail, replyTo, fullMessage, userNames, userId } = params;

    // Check response count for BOTH Reply-To and From addresses
    // Use the maximum count (if user replied to either address, it's not spam)
    // For Google Docs: From=noreply@google.com (0 replies), Reply-To=workmate@foo.com (5 replies)
    // We want to use the 5 replies from the actual person
    let responseCount = await this._getResponseCount(userId, senderEmail);

    if (replyTo && replyTo !== senderEmail) {
      const replyToResponseCount = await this._getResponseCount(userId, replyTo);
      responseCount = Math.max(responseCount, replyToResponseCount);
    }

    // Step 2: Auto-whitelist if user has replied 2+ times to either address
    if (responseCount >= 2) {
      const result: SpamCheckResult = {
        isSpam: false,
        indicators: [
          `Not unsolicited - user has replied ${responseCount} times to this sender`
        ],
        senderResponseCount: responseCount
      };
      return result;
    }

    // Step 3: Prepare response history context for LLM
    const responseHistory = {
      responseCount,
      hasRespondedBefore: responseCount > 0
    };

    // Step 4: Format prompt for spam check with response history
    // Note: Truncation happens in LLMClient right before sending to LLM
    const spamCheckPrompt = await this.promptFormatter.formatSpamCheck({
      rawEmail: fullMessage,
      userNames,
      responseHistory
    });

    // Step 5: Perform spam check (with retry logic)
    const spamCheckResult = await this.llmClient.generateSpamCheck(spamCheckPrompt);

    const isSpam = spamCheckResult.meta.isSpam;
    const indicators = spamCheckResult.meta.spamIndicators || [];

    const result: SpamCheckResult = {
      isSpam,
      indicators,
      senderResponseCount: responseCount
    };
    return result;
  }
}

// Provider-keyed cache to avoid race conditions when processing emails concurrently
const spamDetectorCache = new Map<string, SpamDetector>();

/**
 * Get or create a SpamDetector instance for a given provider
 * @param providerId - LLM provider ID
 * @returns Initialized SpamDetector instance
 */
export async function getSpamDetector(providerId: string): Promise<SpamDetector> {
  let detector = spamDetectorCache.get(providerId);

  if (!detector) {
    detector = new SpamDetector();
    await detector.initialize(providerId);
    spamDetectorCache.set(providerId, detector);
  }

  return detector;
}
