/**
 * Spam Detector Service
 * Single source of truth for spam/unsolicited commercial email detection
 */

import { PromptFormatterV2 } from '../pipeline/prompt-formatter-v2';
import { LLMClient } from '../llm-client';
import { pool } from '../../server';

export interface SpamCheckParams {
  senderEmail: string;
  rawMessage: string;
  userNames: {
    name: string;
    nicknames?: string;
  };
  userId: string;
}

export interface SpamCheckResult {
  isSpam: boolean;
  indicators: string[];
}

interface UpdateResponseStatsParams {
  userId: string;
  emailAccountId: string;
  senderEmail: string;
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
   * Get response count for sender across ALL user's email accounts
   * @private
   */
  private async getResponseCount(userId: string, senderEmail: string): Promise<number> {
    const result = await pool.query(
      `SELECT COALESCE(SUM(response_count), 0)::int as total
       FROM sender_response_stats
       WHERE user_id = $1 AND sender_email = $2`,
      [userId, senderEmail.toLowerCase()]
    );

    return result.rows[0]?.total || 0;
  }

  /**
   * Update response statistics after user replies to sender
   * @param params - User, account, and sender
   */
  async updateResponseStats(params: UpdateResponseStatsParams): Promise<void> {
    const { userId, emailAccountId, senderEmail } = params;

    await pool.query(
      `INSERT INTO sender_response_stats (
        user_id,
        email_account_id,
        sender_email,
        response_count,
        first_response_at,
        last_response_at,
        last_updated_at
      )
      VALUES ($1, $2, $3, 1, NOW(), NOW(), NOW())
      ON CONFLICT (user_id, email_account_id, sender_email)
      DO UPDATE SET
        response_count = sender_response_stats.response_count + 1,
        last_response_at = NOW(),
        last_updated_at = NOW()`,
      [userId, emailAccountId, senderEmail.toLowerCase()]
    );
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

    const { senderEmail, rawMessage, userNames, userId } = params;

    // Step 1: Get response count across ALL user's accounts
    const responseCount = await this.getResponseCount(userId, senderEmail);

    // Step 2: Auto-whitelist if user has replied 2+ times
    if (responseCount >= 2) {
      return {
        isSpam: false,
        indicators: [
          `Not unsolicited - user has replied ${responseCount} times to this sender`,
          'Established communication history with sender'
        ]
      };
    }

    // Step 3: Prepare response history context for LLM
    const responseHistory = {
      responseCount,
      hasRespondedBefore: responseCount > 0
    };

    // Step 4: Format prompt for spam check with response history
    // Note: LLMClient automatically strips attachments to prevent token limit errors
    const spamCheckPrompt = await this.promptFormatter.formatSpamCheck({
      rawEmail: rawMessage,
      userNames,
      responseHistory
    });

    // Step 5: Perform spam check (retry logic is handled in LLMClient.generate())
    const spamCheckResult = await this.llmClient.generateSpamCheck(spamCheckPrompt);

    const isSpam = spamCheckResult.meta.isSpam;
    const indicators = spamCheckResult.meta.spamIndicators || [];

    return {
      isSpam,
      indicators
    };
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
