import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LLMProviderConfig, LLMProviderError, LLMProviderType } from '../types/llm-provider';

export interface PipelineOutput {
  llmPrompt: string;
  nlpFeatures: any;
  relationship: {
    type: string;
    confidence: number;
  };
  enhancedProfile: any;
}

export interface MetaContext {
  inboundMsgAddressedTo: 'you' | 'group' | 'someone-else';
  inboundMsgIsRequesting: 'meeting-request' | 'answer-questions' | 'acknowledge-receipt' | 'acknowledge-emotional' | 'request-for-info' | 'fyi-only' | 'task-assignment' | 'approval-needed' | 'none';
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  contextFlags: {
    isThreaded: boolean;
    hasAttachments: boolean;
    isGroupEmail: boolean;
  };
}

export interface ActionData {
  recommendedAction: 'reply' | 'reply-all' | 'forward' | 'forward-with-comment' | 'silent-fyi-only' | 'silent-large-list' | 'silent-unsubscribe' | 'silent-spam' | 'unknown';
  keyConsiderations: string[];
}

export interface LLMMetadata extends MetaContext, ActionData {}

export interface StructuredLLMResponse {
  meta: LLMMetadata;
  message: string;
}

export interface SpamCheckResponse {
  meta: {
    isSpam: boolean;
    spamIndicators: string[];
  };
}

export interface MetaContextAnalysisResponse {
  meta: MetaContext;
}

export interface ActionAnalysisResponse {
  meta: ActionData;
}

export class LLMClient {
  private model: any;
  private modelName: string;

  constructor(config: LLMProviderConfig) {
    this.model = this.createModel(config);
    this.modelName = config.modelName;
  }

  private createModel(config: LLMProviderConfig): any {
    switch (config.type) {
      case 'openai': {
        const openai = createOpenAI({
          apiKey: config.apiKey,
          baseURL: this.normalizeBaseURL(config.apiEndpoint, 'https://api.openai.com/v1')
        });
        return openai(config.modelName);
      }
      
      case 'anthropic': {
        const anthropic = createAnthropic({
          apiKey: config.apiKey,
          baseURL: this.normalizeBaseURL(config.apiEndpoint, 'https://api.anthropic.com')
        });
        return anthropic(config.modelName);
      }
      
      case 'google': {
        const google = createGoogleGenerativeAI({
          apiKey: config.apiKey,
          baseURL: this.normalizeBaseURL(config.apiEndpoint, 'https://generativelanguage.googleapis.com/v1beta')
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

  private normalizeBaseURL(endpoint: string | undefined, defaultURL: string): string | undefined {
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
   * Main method for pipeline integration - accepts pipeline output directly
   */
  async generateFromPipeline(pipelineOutput: PipelineOutput): Promise<string> {
    // Use the pre-generated prompt from the pipeline
    const temperature = this.getTemperatureForRelationship(pipelineOutput.relationship.type);
    
    try {
      const { text } = await generateText({
        model: this.model,
        prompt: pipelineOutput.llmPrompt,
        temperature,
        maxTokens: 1000,
      });
      
      return text;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Generate with streaming support
   */
  async generateStream(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    onToken?: (token: string) => void;
  }) {
    try {
      const result = await streamText({
        model: this.model,
        prompt,
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens ?? 1000,
      });

      // Return the stream for consumption
      return result;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Generic generation method for direct API calls
   */
  async generate(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  }): Promise<string> {
    try {
      const messages = options?.systemPrompt 
        ? [
            { role: 'system' as const, content: options.systemPrompt },
            { role: 'user' as const, content: prompt }
          ]
        : prompt;

      const { text } = await generateText({
        model: this.model,
        messages: typeof messages === 'string' ? undefined : messages,
        prompt: typeof messages === 'string' ? messages : undefined,
        temperature: options?.temperature ?? 0.7,
        maxTokens: options?.maxTokens ?? 1000,
      });
      
      return text;
    } catch (error: any) {
      throw this.handleError(error);
    }
  }

  /**
   * Generate structured JSON response for email drafts
   */
  async generateStructured(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  }): Promise<StructuredLLMResponse> {
    try {
      const jsonSystemPrompt = `${options?.systemPrompt || ''}\n\nIMPORTANT: You must respond with a valid JSON object only. Do not include any text before or after the JSON.`;

      const text = await this.generate(prompt, {
        ...options,
        systemPrompt: jsonSystemPrompt,
        maxTokens: options?.maxTokens ?? 2000,
      });

      console.log('[LLMClient] Raw LLM response:', text.substring(0, 500) + '...');

      const parsed = this.extractJSON(text, 'draft generation');

      this.validateJSON(
        parsed,
        (p) => p.meta && typeof p.message === 'string',
        'missing meta or message field',
        'draft generation'
      );

      // For silent actions, empty message is acceptable
      const ignoreActions = ['silent-fyi-only', 'silent-large-list', 'silent-unsubscribe', 'silent-spam'];
      if (parsed.message === '' && !ignoreActions.includes(parsed.meta.recommendedAction)) {
        console.error('[LLMClient] Empty message for non-silent action:', parsed.meta.recommendedAction);
        throw new Error('Empty message content for action that requires a response');
      }

      return parsed;
    } catch (error: any) {
      this.handleJSONError(error, 'Draft generation');
    }
  }

  /**
   * Generate spam check for email (analyze if email is spam)
   */
  async generateSpamCheck(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  }): Promise<SpamCheckResponse> {
    try {
      const text = await this.generate(prompt, {
        ...options,
        maxTokens: options?.maxTokens ?? 300,
      });

      const parsed = this.extractJSON(text, 'spam check');

      this.validateJSON(
        parsed,
        (p) => p.meta && typeof p.meta.isSpam === 'boolean',
        'missing meta.isSpam field',
        'spam check'
      );

      return { meta: parsed.meta };
    } catch (error: any) {
      this.handleJSONError(error, 'Spam check');
    }
  }

  /**
   * Generate meta-context analysis for email (urgency, request type, context flags)
   */
  async generateMetaContextAnalysis(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  }): Promise<MetaContextAnalysisResponse> {
    try {
      const text = await this.generate(prompt, {
        ...options,
        maxTokens: options?.maxTokens ?? 500,
      });

      const parsed = this.extractJSON(text, 'meta-context analysis');

      this.validateJSON(
        parsed,
        (p) => p.meta,
        'missing meta field',
        'meta-context analysis'
      );

      return { meta: parsed.meta };
    } catch (error: any) {
      this.handleJSONError(error, 'Meta-context analysis');
    }
  }

  /**
   * Generate action analysis for email (what action to take)
   */
  async generateActionAnalysis(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  }): Promise<ActionAnalysisResponse> {
    try {
      const text = await this.generate(prompt, {
        ...options,
        maxTokens: options?.maxTokens ?? 1000,
      });

      const parsed = this.extractJSON(text, 'action analysis');

      this.validateJSON(
        parsed,
        (p) => p.meta,
        'missing meta field',
        'action analysis'
      );

      return { meta: parsed.meta };
    } catch (error: any) {
      this.handleJSONError(error, 'Action analysis');
    }
  }

  /**
   * Generate response message for email (with tone/style)
   */
  async generateResponseMessage(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  }): Promise<string> {
    try {
      const text = await this.generate(prompt, {
        ...options,
        maxTokens: options?.maxTokens ?? 2000,
      });

      const parsed = this.extractJSON(text, 'response generation');

      this.validateJSON(
        parsed,
        (p) => typeof p.message === 'string',
        'missing message field',
        'response generation'
      );

      return parsed.message;
    } catch (error: any) {
      this.handleJSONError(error, 'Response generation');
    }
  }

  /**
   * Test the provider connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.generate('Say "test"', { maxTokens: 5 });
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  /**
   * Get model information
   */
  getModelInfo() {
    // Model info based on provider and model name
    const modelInfo: Record<string, { contextWindow: number; maxOutput: number }> = {
      // OpenAI
      'gpt-4-turbo-preview': { contextWindow: 128000, maxOutput: 4096 },
      'gpt-4-turbo': { contextWindow: 128000, maxOutput: 4096 },
      'gpt-4': { contextWindow: 8192, maxOutput: 4096 },
      'gpt-3.5-turbo': { contextWindow: 16384, maxOutput: 4096 },
      // Anthropic
      'claude-3-opus-20240229': { contextWindow: 200000, maxOutput: 4096 },
      'claude-3-sonnet-20240229': { contextWindow: 200000, maxOutput: 4096 },
      'claude-3-haiku-20240307': { contextWindow: 200000, maxOutput: 4096 },
      'claude-3-5-sonnet-20241022': { contextWindow: 200000, maxOutput: 8192 },
      // Google
      'gemini-1.5-pro': { contextWindow: 1048576, maxOutput: 8192 },
      'gemini-1.5-flash': { contextWindow: 1048576, maxOutput: 8192 },
      'gemini-pro': { contextWindow: 30720, maxOutput: 2048 },
      // Default for unknown models
      'default': { contextWindow: 4096, maxOutput: 2048 }
    };

    const info = modelInfo[this.modelName] || modelInfo['default'];
    
    return {
      name: this.modelName,
      ...info
    };
  }

  /**
   * Extract and parse JSON from LLM response text
   * @private
   */
  private extractJSON(text: string, context: string): any {
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
  private validateJSON(
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
  private handleJSONError(error: any, context: string): never {
    if (error.message?.includes('JSON')) {
      console.error(`${context} JSON parse error:`, error.message);
      throw new Error(`Failed to parse ${context} as JSON: ${error.message}`);
    }
    throw this.handleError(error);
  }

  /**
   * Helper to adjust temperature based on relationship type
   */
  private getTemperatureForRelationship(relationshipType: string): number {
    const temperatureMap: Record<string, number> = {
      'spouse': 0.8,      // More creative for personal
      'family': 0.7,
      'friend': 0.7,
      'colleague': 0.5,   // More consistent for professional
      'manager': 0.4,
      'client': 0.3,      // Most conservative for clients
      'unknown': 0.5
    };

    return temperatureMap[relationshipType] || 0.5;
  }

  /**
   * Handle errors from Vercel AI SDK
   */
  private handleError(error: any): Error {
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
        'gpt-4-turbo-preview',
        'gpt-4-turbo', 
        'gpt-4',
        'gpt-3.5-turbo',
        'gpt-3.5-turbo-16k'
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