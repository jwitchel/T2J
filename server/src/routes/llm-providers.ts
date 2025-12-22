import express from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../lib/db';
import { withTransaction } from '../lib/db/transaction-utils';
import { encryptPassword } from '../lib/crypto';
import {
  CreateLLMProviderRequest,
  UpdateLLMProviderRequest,
  LLMProviderResponse,
  LLMProviderError,
  LLMProviderConfig,
  getModelInfo
} from '../types/llm-provider';
import { LLMClient } from '../lib/llm-client';
import { userAlertService } from '../lib/user-alert-service';
import { SourceType } from '../types/user-alerts';

const router = express.Router();

// Validation middleware
function validateLLMProvider(req: express.Request, res: express.Response, next: express.NextFunction) {
  const data = req.body as CreateLLMProviderRequest;
  
  if (!data.provider_name || data.provider_name.trim().length === 0) {
    return res.status(400).json({ error: 'Provider name is required' });
  }
  
  if (!data.provider_type || !['openai', 'anthropic', 'google', 'local'].includes(data.provider_type)) {
    return res.status(400).json({ error: 'Invalid provider type' });
  }
  
  if (!data.api_key || data.api_key.trim().length === 0) {
    return res.status(400).json({ error: 'API key is required' });
  }
  
  if (!data.model_name || data.model_name.trim().length === 0) {
    return res.status(400).json({ error: 'Model name is required' });
  }
  
  next();
  return;
}

// Test provider connection
router.post('/test', requireAuth, validateLLMProvider, async (req, res): Promise<void> => {
  try {
    const data = req.body as CreateLLMProviderRequest;
    
    // Create temporary config for testing
    const config: LLMProviderConfig = {
      id: 'test',
      name: data.provider_name,
      type: data.provider_type,
      apiKey: data.api_key,
      apiEndpoint: data.api_endpoint,
      modelName: data.model_name
    };
    
    const client = new LLMClient(config);
    const success = await client.testConnection();

    if (success) {
      const modelInfo = getModelInfo(config.modelName);
      res.json({
        success: true,
        message: 'Connection successful',
        model_info: modelInfo
      });
    } else {
      res.status(400).json({ 
        error: 'Connection test failed',
        message: 'Unable to connect to the LLM provider. Please check your settings.'
      });
    }
  } catch (error: any) {
    console.error('LLM provider test error:', error);
    
    if (error instanceof LLMProviderError) {
      if (error.code === 'INVALID_API_KEY') {
        res.status(401).json({ 
          error: 'Invalid API key',
          message: 'The API key provided is invalid or expired.'
        });
      } else if (error.code === 'MODEL_NOT_FOUND') {
        res.status(404).json({ 
          error: 'Model not found',
          message: `The model ${req.body.model_name} is not available for this provider.`
        });
      } else {
        res.status(400).json({ 
          error: error.code,
          message: error.message
        });
      }
    } else {
      res.status(500).json({ 
        error: 'Connection test failed',
        message: 'An unexpected error occurred while testing the connection.'
      });
    }
  }
});

// Get user's LLM providers
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(
      `SELECT id, provider_name, provider_type, api_endpoint, model_name, 
              is_active, is_default, created_at, updated_at
       FROM llm_providers 
       WHERE user_id = $1 
       ORDER BY is_default DESC, created_at DESC`,
      [userId]
    );
    
    const providers: LLMProviderResponse[] = result.rows.map(row => ({
      id: row.id,
      provider_name: row.provider_name,
      provider_type: row.provider_type,
      api_endpoint: row.api_endpoint,
      model_name: row.model_name,
      is_active: row.is_active,
      is_default: row.is_default,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString()
    }));
    
    res.json(providers);
  } catch (error) {
    console.error('Error fetching LLM providers:', error);
    res.status(500).json({ error: 'Failed to fetch LLM providers' });
  }
});

// Result type for transaction callbacks
type TransactionResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: string;
  status: number;
  field?: string;
  message?: string;
}

// Add new LLM provider
router.post('/', requireAuth, validateLLMProvider, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const data = req.body as CreateLLMProviderRequest;

    const result = await withTransaction(pool, async (client): Promise<TransactionResult<LLMProviderResponse>> => {
      // Check if provider name already exists for this user
      const existing = await client.query(
        'SELECT id FROM llm_providers WHERE user_id = $1 AND provider_name = $2',
        [userId, data.provider_name]
      );

      if (existing.rows.length > 0) {
        return {
          success: false,
          error: 'Provider name already exists',
          status: 409,
          field: 'provider_name'
        };
      }

      // Test the provider connection first
      const config: LLMProviderConfig = {
        id: 'test',
        name: data.provider_name,
        type: data.provider_type,
        apiKey: data.api_key,
        apiEndpoint: data.api_endpoint,
        modelName: data.model_name
      };

      const llmClient = new LLMClient(config);
      const connectionTest = await llmClient.testConnection();

      if (!connectionTest) {
        return {
          success: false,
          error: 'Connection test failed',
          status: 400,
          message: 'Unable to connect to the LLM provider'
        };
      }

      // If this should be the default, unset other defaults
      if (data.is_default) {
        await client.query(
          'UPDATE llm_providers SET is_default = false WHERE user_id = $1',
          [userId]
        );
      }

      // Check if this is the first provider for the user
      const countResult = await client.query(
        'SELECT COUNT(*) as count FROM llm_providers WHERE user_id = $1',
        [userId]
      );
      const isFirstProvider = parseInt(countResult.rows[0].count) === 0;

      // Encrypt the API key
      const encryptedApiKey = encryptPassword(data.api_key);

      // Insert the new provider
      const insertResult = await client.query(
        `INSERT INTO llm_providers
         (user_id, provider_name, provider_type, api_key_encrypted, api_endpoint, model_name, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, provider_name, provider_type, api_endpoint, model_name,
                   is_active, is_default, created_at, updated_at`,
        [
          userId,
          data.provider_name,
          data.provider_type,
          encryptedApiKey,
          data.api_endpoint || null,
          data.model_name,
          data.is_default || isFirstProvider
        ]
      );

      const provider: LLMProviderResponse = {
        id: insertResult.rows[0].id,
        provider_name: insertResult.rows[0].provider_name,
        provider_type: insertResult.rows[0].provider_type,
        api_endpoint: insertResult.rows[0].api_endpoint,
        model_name: insertResult.rows[0].model_name,
        is_active: insertResult.rows[0].is_active,
        is_default: insertResult.rows[0].is_default,
        created_at: insertResult.rows[0].created_at.toISOString(),
        updated_at: insertResult.rows[0].updated_at.toISOString()
      };

      return { success: true, data: provider };
    });

    if (!result.success) {
      const response: Record<string, unknown> = { error: result.error };
      if (result.field) response.field = result.field;
      if (result.message) response.message = result.message;
      res.status(result.status).json(response);
      return;
    }

    res.status(201).json(result.data);
  } catch (error: unknown) {
    console.error('Error creating LLM provider:', error);

    if (error instanceof LLMProviderError) {
      if (error.code === 'INVALID_API_KEY') {
        res.status(401).json({
          error: 'Invalid API key',
          message: 'The API key provided is invalid'
        });
      } else {
        res.status(400).json({
          error: error.code,
          message: error.message
        });
      }
    } else {
      res.status(500).json({ error: 'Failed to create LLM provider' });
    }
  }
});

// Update LLM provider
router.put('/:id', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const providerId = req.params.id;
    const updates = req.body as UpdateLLMProviderRequest;

    // Validate UUID format (before transaction)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(providerId)) {
      res.status(400).json({ error: 'Invalid provider ID format' });
      return;
    }

    const result = await withTransaction(pool, async (client): Promise<TransactionResult<LLMProviderResponse>> => {
      // Check if provider exists and belongs to user
      const existing = await client.query(
        'SELECT * FROM llm_providers WHERE id = $1 AND user_id = $2',
        [providerId, userId]
      );

      if (existing.rows.length === 0) {
        return { success: false, error: 'LLM provider not found', status: 404 };
      }

      const currentProvider = existing.rows[0];

      // If updating API key, test the connection
      if (updates.api_key) {
        const config: LLMProviderConfig = {
          id: providerId,
          name: updates.provider_name || currentProvider.provider_name,
          type: currentProvider.provider_type,
          apiKey: updates.api_key,
          apiEndpoint: updates.api_endpoint || currentProvider.api_endpoint,
          modelName: updates.model_name || currentProvider.model_name
        };

        const llmClient = new LLMClient(config);
        const connectionTest = await llmClient.testConnection();

        if (!connectionTest) {
          return {
            success: false,
            error: 'Connection test failed',
            status: 400,
            message: 'Unable to connect with the new settings'
          };
        }
      }

      // Build update query dynamically
      const updateFields: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (updates.provider_name !== undefined) {
        updateFields.push(`provider_name = $${paramIndex++}`);
        values.push(updates.provider_name);
      }

      if (updates.api_key !== undefined) {
        updateFields.push(`api_key_encrypted = $${paramIndex++}`);
        values.push(encryptPassword(updates.api_key));
      }

      if (updates.api_endpoint !== undefined) {
        updateFields.push(`api_endpoint = $${paramIndex++}`);
        values.push(updates.api_endpoint || null);
      }

      if (updates.model_name !== undefined) {
        updateFields.push(`model_name = $${paramIndex++}`);
        values.push(updates.model_name);
      }

      if (updates.is_active !== undefined) {
        updateFields.push(`is_active = $${paramIndex++}`);
        values.push(updates.is_active);
      }

      if (updates.is_default !== undefined) {
        // If setting as default, unset other defaults
        if (updates.is_default) {
          await client.query(
            'UPDATE llm_providers SET is_default = false WHERE user_id = $1 AND id != $2',
            [userId, providerId]
          );
        }
        updateFields.push(`is_default = $${paramIndex++}`);
        values.push(updates.is_default);
      }

      if (updateFields.length === 0) {
        return { success: false, error: 'No valid fields to update', status: 400 };
      }

      // Add WHERE clause parameters
      values.push(providerId, userId);

      const updateQuery = `
        UPDATE llm_providers
        SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
        RETURNING id, provider_name, provider_type, api_endpoint, model_name,
                  is_active, is_default, created_at, updated_at
      `;

      const updateResult = await client.query(updateQuery, values);

      const provider: LLMProviderResponse = {
        id: updateResult.rows[0].id,
        provider_name: updateResult.rows[0].provider_name,
        provider_type: updateResult.rows[0].provider_type,
        api_endpoint: updateResult.rows[0].api_endpoint,
        model_name: updateResult.rows[0].model_name,
        is_active: updateResult.rows[0].is_active,
        is_default: updateResult.rows[0].is_default,
        created_at: updateResult.rows[0].created_at.toISOString(),
        updated_at: updateResult.rows[0].updated_at.toISOString()
      };

      return { success: true, data: provider };
    });

    if (!result.success) {
      const response: Record<string, unknown> = { error: result.error };
      if (result.message) response.message = result.message;
      res.status(result.status).json(response);
      return;
    }

    res.json(result.data);
  } catch (error) {
    console.error('Error updating LLM provider:', error);
    res.status(500).json({ error: 'Failed to update LLM provider' });
  }
});

// Delete LLM provider
router.delete('/:id', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const providerId = req.params.id;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(providerId)) {
      res.status(400).json({ error: 'Invalid provider ID format' });
      return;
    }
    
    const result = await pool.query(
      'DELETE FROM llm_providers WHERE id = $1 AND user_id = $2 RETURNING id',
      [providerId, userId]
    );
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'LLM provider not found' });
      return;
    }

    // Resolve any active alerts for the deleted provider
    await userAlertService.resolveAlertsForSource(SourceType.LLM_PROVIDER, providerId);
    console.log('[llm-providers] Deleted provider %s (user: %s)', providerId, userId);

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting LLM provider:', error);
    res.status(500).json({ error: 'Failed to delete LLM provider' });
  }
});

export default router;