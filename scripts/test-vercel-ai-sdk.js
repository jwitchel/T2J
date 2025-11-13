const { LLMClient } = require('../server/dist/lib/llm-client');

async function testVercelAISDK() {
  console.log('🧪 Testing Vercel AI SDK Integration\n');

  // Test 1: OpenAI-compatible (Ollama) local model
  console.log('1️⃣ Testing Local Model (Ollama)...');
  try {
    const localClient = new LLMClient({
      id: 'test-local',
      type: 'local',
      apiKey: 'not-needed',
      modelName: 'llama3',
      apiEndpoint: 'http://localhost:11434/v1'
    });

    const localResult = await localClient.generate('Say hello in exactly 3 words.', {
      temperature: 0
    });
    console.log('✅ Local model response:', localResult);
  } catch (error) {
    console.log('❌ Local model error (this is expected if Ollama is not running):', error.message);
  }

  // Test 2: Pipeline integration
  console.log('\n2️⃣ Testing Pipeline Integration...');
  try {
    const pipelineClient = new LLMClient({
      id: 'test-pipeline',
      type: 'local',
      apiKey: 'not-needed',
      modelName: 'llama3',
      apiEndpoint: 'http://localhost:11434/v1'
    });

    const pipelineOutput = {
      llmPrompt: 'Write a brief friendly response to: "Thanks for your help!"',
      nlpFeatures: { sentiment: { primary: 'positive' } },
      relationship: { type: 'colleague', confidence: 0.9 },
      enhancedProfile: { useEmojis: false }
    };

    const pipelineResult = await pipelineClient.generateFromPipeline(pipelineOutput);
    console.log('✅ Pipeline response:', pipelineResult);
  } catch (error) {
    console.log('❌ Pipeline error:', error.message);
  }

  // Test 3: Model detection
  console.log('\n3️⃣ Testing API Key Detection...');
  const testKeys = [
    { key: 'sk-1234567890abcdef', expected: 'openai' },
    { key: 'sk-ant-api03-1234567890abcdef', expected: 'anthropic' },
    { key: 'AIzaSyABCDEF1234567890', expected: 'google' },
    { key: 'random-key-123', expected: null }
  ];

  testKeys.forEach(({ key, expected }) => {
    const detected = LLMClient.detectProviderType(key);
    const status = detected === expected ? '✅' : '❌';
    console.log(`${status} ${key.substring(0, 10)}... => ${detected} (expected: ${expected})`);
  });

  // Test 4: Available models
  console.log('\n4️⃣ Testing Available Models...');
  const providers = ['openai', 'anthropic', 'google', 'local'];
  providers.forEach(provider => {
    const models = LLMClient.getAvailableModels(provider);
    console.log(`${provider}: ${models.length} models available`);
  });

  console.log('\n✨ Vercel AI SDK integration test complete!');
}

// Run the test
testVercelAISDK().catch(console.error);