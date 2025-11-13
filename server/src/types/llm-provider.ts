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
  nlp_features: any;
  relationship: any;
  enhanced_profile: any;
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