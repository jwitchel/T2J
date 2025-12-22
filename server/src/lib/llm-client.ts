import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LLMProviderConfig, LLMProviderError, LLMProviderType, getModelInfo } from '../types/llm-provider';
import { EmailActionType } from '../types/email-action-tracking';
import { OAuthTokenService, OAuthTokens } from './oauth-token-service';
import { userAlertService } from './user-alert-service';
import { AlertType, AlertSeverity, SourceType } from '../types/user-alerts';

/**
 * Optional context for alert tracking
 * When provided, LLM errors will create user alerts
 */
export interface LLMAlertContext {
  userId: string;
  providerId: string;
  providerName: string;
}

/**
 * Context flags for email classification
 * Includes both structural info and semantic analysis
 */
export interface ContextFlags {
  // Structural flags
  isThreaded: boolean;
  hasAttachments: boolean;
  isGroupEmail: boolean;
  // Semantic flags (from LLM analysis)
  inboundMsgAddressedTo: 'you' | 'group' | 'someone-else';
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Action analysis result from LLM
 * Single source of truth for email classification and action determination
 */
export interface ActionData {
  recommendedAction: EmailActionType;
  keyConsiderations: string[]; // Includes spam screening reasons for transparency (e.g., "Not spam - legitimate domain")
  contextFlags: ContextFlags;
}

/**
 * Complete metadata for email draft generation
 * Combines action analysis with context flags
 */
export interface LLMMetadata extends ActionData {}

export interface SpamCheckResponse {
  meta: {
    isSpam: boolean;
    spamIndicators: string[];
  };
}

export interface ActionAnalysisResponse {
  meta: ActionData;
}

export class LLMClient {
  private model: any;
  private modelName: string;
  private alertContext?: LLMAlertContext;

  constructor(config: LLMProviderConfig, alertContext?: LLMAlertContext) {
    this.model = this._createModel(config);
    this.modelName = config.modelName;
    this.alertContext = alertContext;
  }

  private _createModel(config: LLMProviderConfig): any {
    switch (config.type) {
      case 'openai': {
        const openai = createOpenAI({
          apiKey: config.apiKey,
          baseURL: this._normalizeBaseURL(config.apiEndpoint, 'https://api.openai.com/v1')
        });
        return openai(config.modelName);
      }

      case 'anthropic': {
        const anthropic = createAnthropic({
          apiKey: config.apiKey,
          baseURL: this._normalizeBaseURL(config.apiEndpoint, 'https://api.anthropic.com')
        });
        return anthropic(config.modelName);
      }

      case 'google': {
        const google = createGoogleGenerativeAI({
          apiKey: config.apiKey,
          baseURL: this._normalizeBaseURL(config.apiEndpoint, 'https://generativelanguage.googleapis.com/v1beta')
        });
        return google(config.modelName);
      }
      
      case 'local': {
        // Use OpenAI-compatible provider for Ollama
        const ollama = createOpenAICompatible({
          baseURL: config.apiEndpoint || 'http://localhost:11434/v1',
          apiKey: 'ollama', // Ollama doesn't need a real API key
          name: 'ollama'
        });
        return ollama(config.modelName);
      }
      
      default:
        throw new LLMProviderError(
          `Unsupported provider type: ${config.type}`,
          'UNKNOWN'
        );
    }
  }

  private _normalizeBaseURL(endpoint: string | undefined, defaultURL: string): string | undefined {
    if (!endpoint) {
      // Use SDK default by returning undefined
      return undefined;
    }
    
    // If it's already a full URL, use it as-is
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      return endpoint;
    }
    
    // If it's just a path, append it to the default URL
    if (endpoint.startsWith('/')) {
      const base = defaultURL.endsWith('/') ? defaultURL.slice(0, -1) : defaultURL;
      return base + endpoint;
    }
    
    // Otherwise, assume it's a full URL without protocol
    return 'https://' + endpoint;
  }


  /**
   * Generic generation method for direct API calls with built-in retry logic
   */
  async generate(prompt: string, options?: {
    temperature?: number;
  }): Promise<string> {
    const maxRetries = parseInt(process.env.LLM_ACTION_RETRIES!);
    const llmTimeout = parseInt(process.env.EMAIL_PROCESSING_LLM_TIMEOUT!);
    let lastError: any;

    // Truncate prompt if it exceeds model's context window
    const truncatedPrompt = this._truncatePromptToFit(prompt);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Create AbortController for this attempt with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error(`[LLMClient] ⏱️ TIMEOUT: LLM call exceeded ${llmTimeout}ms - aborting at generateText() level`);
        controller.abort();
      }, llmTimeout);

      try {
        const { text } = await generateText({
          model: this.model,
          prompt: truncatedPrompt,
          temperature: options?.temperature ?? 0.7,
          abortSignal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Success - resolve ALL LLM alerts for this user
        if (this.alertContext) {
          await userAlertService.resolveAllAlertsForSourceType(
            this.alertContext.userId,
            SourceType.LLM_PROVIDER
          );
        }

        return text;
      } catch (error: unknown) {
        clearTimeout(timeoutId);
        lastError = error;

        // Check if this was an abort (timeout)
        const errorName = error instanceof Error ? error.name : '';
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isAborted = errorName === 'AbortError' || errorMessage.includes('aborted');

        // Only retry on JSON parsing errors, temporary failures, or timeouts
        const shouldRetry = errorMessage.includes('JSON') ||
                           errorMessage.includes('rate limit') ||
                           errorMessage.includes('timeout') ||
                           isAborted;

        if (shouldRetry && attempt < maxRetries) {
          continue;
        }

        // Final attempt failed or non-retryable error
        break;
      }
    }

    // Create alert for persistent LLM failure
    if (this.alertContext) {
      await this._createLLMAlert(lastError);
    }

    throw this._handleError(lastError);
  }

  /**
   * Create an alert for LLM provider errors
   * @private
   */
  private async _createLLMAlert(error: unknown): Promise<void> {
    if (!this.alertContext) return;

    const errorMessage = error instanceof Error ? error.message : String(error);
    const { userId, providerId, providerName } = this.alertContext;

    // Determine alert type and message based on error
    let alertType: AlertType = AlertType.SERVICE_UNAVAILABLE;
    let message = `LLM request failed: ${errorMessage}`;
    let severity: AlertSeverity = AlertSeverity.WARNING;

    if (errorMessage.includes('API key') || errorMessage.includes('auth')) {
      alertType = AlertType.INVALID_CREDENTIALS;
      message = 'Invalid API key. Please check your credentials.';
      severity = AlertSeverity.ERROR;
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
      alertType = AlertType.RATE_LIMIT;
      message = 'Rate limited by provider. Requests may be delayed.';
      severity = AlertSeverity.WARNING;
    } else if (errorMessage.includes('quota')) {
      alertType = AlertType.QUOTA_EXCEEDED;
      message = 'Usage quota exceeded. Please check your plan.';
      severity = AlertSeverity.ERROR;
    } else if (errorMessage.includes('connection') || errorMessage.includes('ECONNREFUSED')) {
      alertType = AlertType.CONNECTION_FAILED;
      message = 'Cannot connect to LLM provider.';
      severity = AlertSeverity.ERROR;
    }

    await userAlertService.createAlert({
      userId,
      alertType,
      severity,
      sourceType: SourceType.LLM_PROVIDER,
      sourceId: providerId,
      sourceName: `${providerName} (${this.modelName})`,
      message,
      actionUrl: '/settings/llm-providers',
      actionLabel: 'View Settings',
    });
  }

  /**
   * Generate spam check for email (analyze if email is spam)
   */
  async generateSpamCheck(prompt: string, options?: {
    temperature?: number;
  }): Promise<SpamCheckResponse> {
    try {
      const text = await this.generate(prompt, options);

      const parsed = this._extractJSON(text, 'spam check');

      this._validateJSON(
        parsed,
        (p) => p.meta && typeof p.meta.isSpam === 'boolean',
        'missing meta.isSpam field',
        'spam check'
      );

      return { meta: parsed.meta };
    } catch (error: unknown) {
      this._handleJSONError(error, 'Spam check');
    }
  }

  /**
   * Generate action analysis for email (what action to take)
   * Single source of truth for email classification and action determination
   */
  async generateActionAnalysis(prompt: string, options?: {
    temperature?: number;
  }): Promise<ActionAnalysisResponse> {
    try {
      const text = await this.generate(prompt, options);

      const parsed = this._extractJSON(text, 'action analysis');

      this._validateJSON(
        parsed,
        (p) => p.meta,
        'missing meta field',
        'action analysis'
      );

      return { meta: parsed.meta };
    } catch (error: unknown) {
      this._handleJSONError(error, 'Action analysis');
    }
  }

  /**
   * Generate response message for email (with tone/style)
   */
  async generateResponseMessage(prompt: string, options?: {
    temperature?: number;
  }): Promise<string> {
    try {
      const text = await this.generate(prompt, options);

      const parsed = this._extractJSON(text, 'response generation');

      this._validateJSON(
        parsed,
        (p) => typeof p.message === 'string',
        'missing message field',
        'response generation'
      );

      return parsed.message;
    } catch (error: unknown) {
      console.error('[LLMClient] Error in generateResponseMessage:', error);
      this._handleJSONError(error, 'Response generation');
    }
  }

  /**
   * Test the provider connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.generate('Say "test"');
      return true;
    } catch (error: unknown) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  /**
   * Get model information (context window, max output, etc.)
   */
  getModelInfo() {
    return getModelInfo(this.modelName);
  }


  /**
   * Truncate prompt to fit within model's context window
   * Uses conservative character-based token estimation (1 token ≈ 2 chars)
   * This is conservative to handle worst-case tokenization
   * @private
   */
  private _truncatePromptToFit(prompt: string): string {
    const modelInfo = getModelInfo(this.modelName);
    const maxInputTokens = modelInfo.contextWindow - modelInfo.maxOutput;

    // Conservative estimate: 1 token ≈ 2 characters
    // This accounts for worst-case tokenization (actual is typically 2-4 chars/token)
    const estimatedTokens = Math.ceil(prompt.length / 2);

    if (estimatedTokens <= maxInputTokens) {
      return prompt; // No truncation needed
    }

    // Calculate how many characters we can keep (use conservative ratio)
    const maxChars = maxInputTokens * 2;
    const truncatedPrompt = prompt.substring(0, maxChars);

    console.warn(
      `[LLMClient] Prompt truncated from ${estimatedTokens.toLocaleString()} to ${maxInputTokens.toLocaleString()} estimated tokens ` +
      `(${prompt.length.toLocaleString()} → ${truncatedPrompt.length.toLocaleString()} chars) for model ${this.modelName}`
    );

    return truncatedPrompt;
  }

  /**
   * Extract and parse JSON from LLM response text
   * @private
   */
  private _extractJSON(text: string, context: string): any {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[LLMClient] No JSON found in ${context}. Full response:`, text);
      throw new Error(`No valid JSON found in ${context}`);
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[LLMClient] JSON parse error in ${context}:`, parseError);
      console.error('[LLMClient] Attempted to parse:', jsonMatch[0].substring(0, 500));
      throw new Error(`Failed to parse ${context} JSON: ${parseError}`);
    }
  }

  /**
   * Validate JSON structure with custom validator
   * @private
   */
  private _validateJSON(
    parsed: any,
    validator: (parsed: any) => boolean,
    errorMessage: string,
    context: string
  ): void {
    if (!validator(parsed)) {
      console.error(`[LLMClient] Invalid ${context} structure. ${errorMessage}, got:`, JSON.stringify(parsed).substring(0, 500));
      throw new Error(`Invalid ${context} structure: ${errorMessage}`);
    }
  }

  /**
   * Handle JSON parsing errors consistently
   * @private
   */
  private _handleJSONError(error: any, context: string): never {
    if (error.message?.includes('JSON')) {
      console.error(`${context} JSON parse error:`, error.message);
      throw new Error(`Failed to parse ${context} as JSON: ${error.message}`);
    }
    throw this._handleError(error);
  }

  /**
   * Handle errors from Vercel AI SDK
   */
  private _handleError(error: any): Error {
    // The Vercel AI SDK throws specific error types
    if (error.message?.includes('API key')) {
      throw new LLMProviderError('Invalid API key', 'INVALID_API_KEY');
    } else if (error.message?.includes('rate limit') || error.status === 429) {
      throw new LLMProviderError('Rate limit exceeded', 'RATE_LIMIT');
    } else if (error.message?.includes('model') && error.message?.includes('not found')) {
      throw new LLMProviderError('Model not found', 'MODEL_NOT_FOUND');
    } else if (error.message?.includes('connection') || error.code === 'ECONNREFUSED') {
      throw new LLMProviderError('Connection failed', 'CONNECTION_FAILED');
    } else {
      throw new LLMProviderError(
        error.message || 'Unknown error occurred',
        'UNKNOWN'
      );
    }
  }

  /**
   * Auto-refresh OAuth token with retry logic
   * Handles token refresh failures gracefully with automatic retry
   * Retries on transient errors, but immediately fails on REFRESH_TOKEN_INVALID
   * This method should be used when OAuth token refresh fails to automatically retry
   */
  static async autoRefreshOAuthToken(
    refreshToken: string,
    provider: string,
    emailAccountId: string,
    maxRetries: number = 2
  ): Promise<OAuthTokens> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const tokens = await OAuthTokenService.refreshTokens(
          refreshToken,
          provider,
          emailAccountId
        );
        
        // Success - return the refreshed tokens
        return tokens;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if this is a REFRESH_TOKEN_INVALID error
        const errorMessage = lastError.message || '';
        if (errorMessage.includes('REFRESH_TOKEN_INVALID')) {
          // Refresh token is invalid or expired - cannot retry
          // Log and re-throw immediately
          console.error(`[LLMClient] OAuth refresh token invalid for account ${emailAccountId}. Re-authentication required.`);
          throw lastError;
        }

        // For other errors, retry with exponential backoff
        if (attempt < maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...
          console.warn(
            `[LLMClient] OAuth token refresh failed (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${backoffMs}ms...`,
            errorMessage
          );
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }

        // Final attempt failed
        break;
      }
    }

    // All retries exhausted
    console.error(`[LLMClient] OAuth token refresh failed after ${maxRetries + 1} attempts for account ${emailAccountId}`);
    throw lastError || new Error('OAuth token refresh failed');
  }

  /**
   * Static method to detect provider type from API key format
   */
  static detectProviderType(apiKey: string): LLMProviderType | null {
    if (apiKey.startsWith('sk-ant-')) {
      return 'anthropic';
    } else if (apiKey.startsWith('sk-')) {
      return 'openai';
    } else if (apiKey.includes('AIza')) {
      return 'google';
    }
    return null;
  }

  /**
   * Get available models for a provider type
   */
  static getAvailableModels(providerType: LLMProviderType): string[] {
    const models: Record<LLMProviderType, string[]> = {
      'openai': [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-4',
        'gpt-3.5-turbo'
      ],
      'anthropic': [
        'claude-3-5-sonnet-20241022',
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307'
      ],
      'google': [
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-pro'
      ],
      'local': [
        'llama3.2',
        'llama3.1',
        'llama3',
        'llama2',
        'mistral',
        'mixtral',
        'codellama',
        'qwen2.5-coder'
      ]
    };
    
    return models[providerType] || [];
  }
}