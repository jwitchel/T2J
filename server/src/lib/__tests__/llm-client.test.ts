import { LLMClient } from '../llm-client';
import { LLMProviderConfig, LLMProviderError } from '../../types/llm-provider';

describe('LLMClient', () => {
  describe('detectProviderType', () => {
    it('should detect OpenAI API keys', () => {
      expect(LLMClient.detectProviderType('sk-1234567890abcdef')).toBe('openai');
      expect(LLMClient.detectProviderType('sk-proj-1234567890')).toBe('openai');
    });

    it('should detect Anthropic API keys', () => {
      expect(LLMClient.detectProviderType('sk-ant-api03-1234567890')).toBe('anthropic');
      expect(LLMClient.detectProviderType('sk-ant-1234567890')).toBe('anthropic');
    });

    it('should detect Google API keys', () => {
      expect(LLMClient.detectProviderType('AIzaSyABCDEF1234567890')).toBe('google');
      expect(LLMClient.detectProviderType('randomAIzaInMiddle123')).toBe('google');
    });

    it('should return null for unknown API key formats', () => {
      expect(LLMClient.detectProviderType('random-key-123')).toBeNull();
      expect(LLMClient.detectProviderType('')).toBeNull();
      expect(LLMClient.detectProviderType('Bearer token123')).toBeNull();
    });
  });

  describe('getAvailableModels', () => {
    it('should return OpenAI models', () => {
      const models = LLMClient.getAvailableModels('openai');
      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-3.5-turbo');
      expect(models.length).toBeGreaterThan(0);
    });

    it('should return Anthropic models', () => {
      const models = LLMClient.getAvailableModels('anthropic');
      expect(models).toContain('claude-3-5-sonnet-20241022');
      expect(models).toContain('claude-3-opus-20240229');
      expect(models.length).toBeGreaterThan(0);
    });

    it('should return Google models', () => {
      const models = LLMClient.getAvailableModels('google');
      expect(models).toContain('gemini-1.5-pro');
      expect(models).toContain('gemini-pro');
      expect(models.length).toBeGreaterThan(0);
    });

    it('should return local models', () => {
      const models = LLMClient.getAvailableModels('local');
      expect(models).toContain('llama3');
      expect(models).toContain('mistral');
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('constructor', () => {
    it('should create client with valid config', () => {
      const config: LLMProviderConfig = {
        id: 'test-id',
        type: 'openai',
        apiKey: 'sk-test',
        modelName: 'gpt-3.5-turbo'
      };

      expect(() => new LLMClient(config)).not.toThrow();
    });

    it('should throw error for unsupported provider type', () => {
      const config: LLMProviderConfig = {
        id: 'test-id',
        type: 'unsupported' as any,
        apiKey: 'test-key',
        modelName: 'test-model'
      };

      expect(() => new LLMClient(config)).toThrow(LLMProviderError);
      expect(() => new LLMClient(config)).toThrow('Unsupported provider type');
    });
  });

  describe('getModelInfo', () => {
    it('should return correct model info for known models', () => {
      const config: LLMProviderConfig = {
        id: 'test-id',
        type: 'openai',
        apiKey: 'sk-test',
        modelName: 'gpt-4'
      };

      const client = new LLMClient(config);
      const info = client.getModelInfo();

      expect(info.name).toBe('gpt-4');
      expect(info.contextWindow).toBe(8192);
      expect(info.maxOutput).toBe(4096);
    });

    it('should return default info for unknown models', () => {
      const config: LLMProviderConfig = {
        id: 'test-id',
        type: 'openai',
        apiKey: 'sk-test',
        modelName: 'unknown-model-xyz'
      };

      const client = new LLMClient(config);
      const info = client.getModelInfo();

      expect(info.name).toBe('unknown-model-xyz');
      expect(info.contextWindow).toBe(4096);
      expect(info.maxOutput).toBe(2048);
    });
  });

});