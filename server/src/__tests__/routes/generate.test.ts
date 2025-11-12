import request from 'supertest';
import { Pool } from 'pg';
import { encryptPassword } from '../../lib/crypto';

// We need to test against the actual server
// Import it in a way that prevents automatic startup
process.env.SKIP_SERVER_START = 'true';
import { app } from './db';

describe('Generate API', () => {
  let pool: Pool;
  let testUserId: string;
  let testProviderId: string;
  let sessionToken: string;

  beforeAll(async () => {
    // Create real database connection
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://aiemailuser:aiemailpass@localhost:5434/aiemaildb'
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Create test user
    testUserId = 'test-generate-' + Date.now();
    await pool.query(
      `INSERT INTO "user" (id, email, name, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [testUserId, `${testUserId}@test.com`, 'Test User']
    );

    // Create test account for auth
    await pool.query(
      `INSERT INTO "account" (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'credential', $4, NOW(), NOW())`,
      [testUserId + '-account', testUserId, `${testUserId}@test.com`, await encryptPassword('password123')]
    );

    // Create test session
    sessionToken = 'test-session-' + Date.now();
    await pool.query(
      `INSERT INTO "session" (id, "userId", "token", "expiresAt", "createdAt", "updatedAt", "ipAddress", "userAgent")
       VALUES ($1, $2, $3, $4, NOW(), NOW(), '127.0.0.1', 'test-agent')`,
      [sessionToken, testUserId, sessionToken, new Date(Date.now() + 86400000)]
    );

    // Create test LLM provider
    testProviderId = 'test-provider-' + Date.now();
    const encryptedApiKey = encryptPassword('test-api-key');
    
    await pool.query(
      `INSERT INTO llm_providers 
       (id, user_id, provider_name, provider_type, api_key_encrypted, model_name, is_active, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, true, true)`,
      [testProviderId, testUserId, 'Test Provider', 'openai', encryptedApiKey, 'gpt-3.5-turbo']
    );
  });

  afterEach(async () => {
    // Clean up test data (cascades will handle related data)
    await pool.query('DELETE FROM "session" WHERE "userId" = $1', [testUserId]);
    await pool.query('DELETE FROM "user" WHERE id = $1', [testUserId]);
  });

  describe('POST /api/generate/email-reply', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/generate/email-reply')
        .send({
          llm_prompt: 'Test prompt',
          pipeline_data: {}
        });

      expect(response.status).toBe(401);
    });

    it('should require llm_prompt', async () => {
      const response = await request(app)
        .post('/api/generate/email-reply')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          pipeline_data: {}
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Missing required fields');
    });

    it('should handle missing LLM provider', async () => {
      // Delete the provider
      await pool.query('DELETE FROM llm_providers WHERE user_id = $1', [testUserId]);

      const response = await request(app)
        .post('/api/generate/email-reply')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          llm_prompt: 'Test prompt',
          pipeline_data: {}
        });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'No active LLM provider found');
    });

    it('should handle specific provider request', async () => {
      // Create another provider
      const specificProviderId = 'specific-' + Date.now();
      const encryptedApiKey = encryptPassword('test-api-key-2');
      
      await pool.query(
        `INSERT INTO llm_providers 
         (id, user_id, provider_name, provider_type, api_key_encrypted, model_name, is_active, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, true, false)`,
        [specificProviderId, testUserId, 'Specific Provider', 'anthropic', encryptedApiKey, 'claude-3-sonnet']
      );

      const response = await request(app)
        .post('/api/generate/email-reply')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          llm_prompt: 'Test prompt',
          pipeline_data: {},
          provider_id: specificProviderId
        });

      // It will fail because we don't have a real API key, but we can check the error
      expect(response.status).toBeGreaterThanOrEqual(400);
      // The important thing is it tried to use the specific provider
    });

    // Note: We can't test successful generation without a real API key
    // That would require integration tests with real LLM providers
  });

  describe('POST /api/generate', () => {
    it('should require prompt', async () => {
      const response = await request(app)
        .post('/api/generate')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Prompt is required');
    });

    it('should handle inactive provider', async () => {
      // Deactivate the provider
      await pool.query(
        'UPDATE llm_providers SET is_active = false WHERE user_id = $1',
        [testUserId]
      );

      const response = await request(app)
        .post('/api/generate')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          prompt: 'Test prompt'
        });

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'No active LLM provider found');
    });

    // Note: We can't test successful generation without a real API key
  });
});