import type { EmailFeatures, RelationshipDetectorResult } from '../lib/pipeline/types';
import type { EnhancedRelationshipProfile } from '../lib/pipeline/template-manager';

export type LLMProviderType = 'openai' | 'anthropic' | 'google' | 'local';

export interface LLMProvider {
  id: string;
  userId: string;
  providerName: string;
  providerType: LLMProviderType;
  apiEndpoint?: string;
  modelName: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLLMProviderRequest {
  provider_name: string;
  provider_type: LLMProviderType;
  api_key: string;
  api_endpoint?: string;
  model_name: string;
  is_default?: boolean;
}

export interface UpdateLLMProviderRequest {
  provider_name?: string;
  api_key?: string;
  api_endpoint?: string;
  model_name?: string;
  is_active?: boolean;
  is_default?: boolean;
}

export interface LLMProviderResponse {
  id: string;
  provider_name: string;
  provider_type: LLMProviderType;
  api_endpoint?: string;
  model_name: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface LLMGenerateRequest {
  prompt: string;
  provider_id?: string;
  temperature?: number;
  stream?: boolean;
}

export interface LLMGenerateFromPipelineRequest {
  llm_prompt: string;
  nlp_features: EmailFeatures;
  relationship: RelationshipDetectorResult;
  enhanced_profile: EnhancedRelationshipProfile;
  provider_id?: string;
  temperature?: number;
}

export interface LLMGenerateResponse {
  reply: string;
  provider_id: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMProviderConfig {
  id: string;
  name: string;
  type: LLMProviderType;
  apiKey: string;
  apiEndpoint?: string;
  modelName: string;
}

export interface GenerateOptions {
  temperature?: number;
  stream?: boolean;
}

export interface StreamOptions {
  temperature?: number;
  onToken?: (token: string) => void;
}

export class LLMProviderError extends Error {
  constructor(
    message: string,
    public code: 'INVALID_API_KEY' | 'RATE_LIMIT' | 'MODEL_NOT_FOUND' | 'CONNECTION_FAILED' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}

export interface ModelInfo {
  name: string;
  contextWindow: number;
  maxOutput: number;
}

/**
 * Get model information (context window and max output tokens) for a given model name
 */
export function getModelInfo(modelName: string): ModelInfo {
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

  const info = modelInfo[modelName] || modelInfo['default'];

  return {
    name: modelName,
    ...info
  };
}