import request from 'supertest';
import { Pool } from 'pg';
import { encryptPassword } from '../../lib/crypto';

// We need to test against the actual server
// Import it in a way that prevents automatic startup
process.env.SKIP_SERVER_START = 'true';
import { app } from './db';

describe('LLM Providers API', () => {
  let pool: Pool;
  let testUserId: string;
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
    testUserId = 'test-llm-' + Date.now();
    await pool.query(
      `INSERT INTO "user" (id, email, name, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [testUserId, `${testUserId}@test.com`, 'Test User']
    );

    // Create test session
    sessionToken = 'test-session-' + Date.now();
    await pool.query(
      `INSERT INTO "session" (id, "userId", "token", "expiresAt", "createdAt", "updatedAt", "ipAddress", "userAgent")
       VALUES ($1, $2, $3, $4, NOW(), NOW(), '127.0.0.1', 'test-agent')`,
      [sessionToken, testUserId, sessionToken, new Date(Date.now() + 86400000)]
    );
  });

  afterEach(async () => {
    // Clean up test data (cascades will handle related data)
    await pool.query('DELETE FROM "session" WHERE "userId" = $1', [testUserId]);
    await pool.query('DELETE FROM "user" WHERE id = $1', [testUserId]);
  });

  describe('GET /api/llm-providers', () => {
    it('should return empty array for new user', async () => {
      const response = await request(app)
        .get('/api/llm-providers')
        .set('Cookie', `sessionToken=${sessionToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/llm-providers');

      expect(response.status).toBe(401);
    });

    it('should return user providers', async () => {
      // Create test providers
      const encryptedApiKey = encryptPassword('test-api-key');
      
      await pool.query(
        `INSERT INTO llm_providers 
         (id, user_id, provider_name, provider_type, api_key_encrypted, model_name, is_active, is_default)
         VALUES 
         ($1, $2, 'Provider 1', 'openai', $3, 'gpt-3.5-turbo', true, true),
         ($4, $2, 'Provider 2', 'anthropic', $3, 'claude-3', true, false)`,
        [`provider-1-${Date.now()}`, testUserId, encryptedApiKey, `provider-2-${Date.now()}`]
      );

      const response = await request(app)
        .get('/api/llm-providers')
        .set('Cookie', `sessionToken=${sessionToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty('provider_name');
      expect(response.body[0]).not.toHaveProperty('api_key_encrypted'); // Should not expose encrypted key
    });
  });

  describe('POST /api/llm-providers/test', () => {
    it('should validate provider configuration', async () => {
      const response = await request(app)
        .post('/api/llm-providers/test')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          provider_type: 'openai',
          api_key: 'test-key',
          model_name: 'gpt-3.5-turbo'
        });

      // Since we're using a fake API key, this should fail validation
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('valid', false);
    });

    it('should reject invalid provider type', async () => {
      const response = await request(app)
        .post('/api/llm-providers/test')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          provider_type: 'invalid-provider',
          api_key: 'test-key',
          model_name: 'some-model'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Invalid provider type');
    });

    it('should require all fields', async () => {
      const response = await request(app)
        .post('/api/llm-providers/test')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          provider_type: 'openai'
          // missing api_key and model_name
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Missing required fields');
    });
  });

  describe('POST /api/llm-providers', () => {
    it('should create new provider', async () => {
      const response = await request(app)
        .post('/api/llm-providers')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          provider_name: 'My OpenAI',
          provider_type: 'openai',
          api_key: 'test-key',
          model_name: 'gpt-3.5-turbo',
          is_default: true
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('provider_name', 'My OpenAI');

      // Verify it was saved
      const result = await pool.query(
        'SELECT * FROM llm_providers WHERE id = $1',
        [response.body.id]
      );
      expect(result.rows).toHaveLength(1);
    });

    it('should unset other defaults when creating default provider', async () => {
      // Create an existing default provider
      const encryptedApiKey = encryptPassword('test-key');
      await pool.query(
        `INSERT INTO llm_providers 
         (id, user_id, provider_name, provider_type, api_key_encrypted, model_name, is_active, is_default)
         VALUES ($1, $2, 'Existing Default', 'openai', $3, 'gpt-3.5-turbo', true, true)`,
        [`existing-${Date.now()}`, testUserId, encryptedApiKey]
      );

      const response = await request(app)
        .post('/api/llm-providers')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          provider_name: 'New Default',
          provider_type: 'anthropic',
          api_key: 'test-key',
          model_name: 'claude-3',
          is_default: true
        });

      expect(response.status).toBe(201);

      // Verify only one default
      const result = await pool.query(
        'SELECT COUNT(*) FROM llm_providers WHERE user_id = $1 AND is_default = true',
        [testUserId]
      );
      expect(result.rows[0].count).toBe('1');
    });
  });

  describe('PUT /api/llm-providers/:id', () => {
    it('should update provider', async () => {
      // Create a provider
      const providerId = `provider-${Date.now()}`;
      const encryptedApiKey = encryptPassword('test-key');
      
      await pool.query(
        `INSERT INTO llm_providers 
         (id, user_id, provider_name, provider_type, api_key_encrypted, model_name, is_active, is_default)
         VALUES ($1, $2, 'Original Name', 'openai', $3, 'gpt-3.5-turbo', true, false)`,
        [providerId, testUserId, encryptedApiKey]
      );

      const response = await request(app)
        .put(`/api/llm-providers/${providerId}`)
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          provider_name: 'Updated Name'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('provider_name', 'Updated Name');
    });

    it('should handle not found', async () => {
      const response = await request(app)
        .put('/api/llm-providers/non-existent')
        .set('Cookie', `sessionToken=${sessionToken}`)
        .send({
          provider_name: 'Updated'
        });

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/llm-providers/:id', () => {
    it('should delete provider', async () => {
      // Create two providers so we can delete one
      const providerId = `provider-${Date.now()}`;
      const encryptedApiKey = encryptPassword('test-key');
      
      await pool.query(
        `INSERT INTO llm_providers 
         (id, user_id, provider_name, provider_type, api_key_encrypted, model_name, is_active, is_default)
         VALUES 
         ($1, $2, 'Provider 1', 'openai', $3, 'gpt-3.5-turbo', true, true),
         ($4, $2, 'Provider 2', 'anthropic', $3, 'claude-3', true, false)`,
        [providerId, testUserId, encryptedApiKey, `other-${Date.now()}`]
      );

      const response = await request(app)
        .delete(`/api/llm-providers/${providerId}`)
        .set('Cookie', `sessionToken=${sessionToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'Provider deleted successfully');

      // Verify it was deleted
      const result = await pool.query(
        'SELECT * FROM llm_providers WHERE id = $1',
        [providerId]
      );
      expect(result.rows).toHaveLength(0);
    });

    it('should prevent deleting last active provider', async () => {
      // Create only one provider
      const providerId = `provider-${Date.now()}`;
      const encryptedApiKey = encryptPassword('test-key');
      
      await pool.query(
        `INSERT INTO llm_providers 
         (id, user_id, provider_name, provider_type, api_key_encrypted, model_name, is_active, is_default)
         VALUES ($1, $2, 'Only Provider', 'openai', $3, 'gpt-3.5-turbo', true, true)`,
        [providerId, testUserId, encryptedApiKey]
      );

      const response = await request(app)
        .delete(`/api/llm-providers/${providerId}`)
        .set('Cookie', `sessionToken=${sessionToken}`);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'Cannot delete the last active provider');
    });
  });
});