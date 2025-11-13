import express from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../lib/db';

import { encryptPassword } from '../lib/crypto';
import { validateEmailAccount } from '../middleware/validation';
import {
  CreateEmailAccountRequest,
  EmailAccountResponse,
  ImapConnectionError
} from '../types/email-account';
import { ImapOperations } from '../lib/imap-operations';
import { withImapContext } from '../lib/imap-context';
import { realTimeLogger } from '../lib/real-time-logger';
import { jobSchedulerManager, SchedulerId } from '../lib/job-scheduler-manager';

const router = express.Router();

// Real IMAP connection test
async function testImapConnection(
  config: CreateEmailAccountRequest,
  userId: string
): Promise<void> {
  // Create a temporary account config for testing
  const tempAccount = {
    id: 'temp-test',
    userId,
    email: config.email_address,
    imapHost: config.imap_host,
    imapPort: config.imap_port,
    imapUsername: config.imap_username,
    imapPasswordEncrypted: encryptPassword(config.imap_password),
    imapSecure: config.imap_secure
  };

  const imapOps = new ImapOperations(tempAccount);
  
  try {
    // Use context to ensure consistent lifecycle
    const success = await withImapContext(tempAccount.id, userId, async () => {
      return imapOps.testConnection(true);
    });
    
    if (!success) {
      throw new ImapConnectionError('Connection test failed', 'CONNECTION_FAILED');
    }
    
    console.log(`IMAP connection test passed for ${config.email_address}`);
  } catch (error: any) {
    // Map common IMAP errors to our error types
    if (error.code === 'AUTHENTICATIONFAILED' || error.message?.includes('Authentication')) {
      throw new ImapConnectionError('Authentication failed', 'AUTHENTICATIONFAILED');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.message?.includes('connect')) {
      throw new ImapConnectionError('Cannot connect to IMAP server', 'ENOTFOUND');
    } else if (error.code === 'CONNECTION_FAILED') {
      throw error;
    } else {
      throw new ImapConnectionError(`IMAP error: ${error.message}`, 'UNKNOWN');
    }
  }
}

// Test email account connection
router.post('/test', requireAuth, validateEmailAccount, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const accountData = req.body as CreateEmailAccountRequest;
    
    // Test IMAP connection
    await testImapConnection(accountData, userId);
    
    res.json({ success: true, message: 'Connection successful' });
  } catch (error) {
    if (error instanceof ImapConnectionError) {
      if (error.code === 'AUTHENTICATIONFAILED') {
        res.status(401).json({ 
          error: 'IMAP authentication failed',
          message: 'Invalid email credentials. Please check your username and password.'
        });
        return;
      } else if (error.code === 'ENOTFOUND') {
        res.status(400).json({ 
          error: 'IMAP connection failed',
          message: 'Unable to connect to IMAP server. Please check the server address and port.'
        });
        return;
      }
    }
    
    res.status(408).json({ 
      error: 'IMAP connection timeout',
      message: 'Connection to email server timed out. Please check your settings and try again.'
    });
  }
});

// Get user's email accounts
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    
    const result = await pool.query(
      `SELECT id, email_address, imap_host, imap_port, imap_username,
              last_sync, created_at, oauth_provider, monitoring_enabled
       FROM email_accounts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const accounts: EmailAccountResponse[] = result.rows.map(row => ({
      id: row.id,
      email_address: row.email_address,
      imap_host: row.imap_host,
      imap_port: row.imap_port,
      imap_secure: row.imap_port === 993 || row.imap_port === 1993, // Infer from port
      imap_username: row.imap_username,
      monitoring_enabled: row.monitoring_enabled || false,
      last_sync: row.last_sync ? row.last_sync.toISOString() : null,
      created_at: row.created_at.toISOString(),
      updated_at: row.created_at.toISOString(), // Use created_at as fallback
      oauth_provider: row.oauth_provider
    }));
    
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching email accounts:', error);
    res.status(500).json({ error: 'Failed to fetch email accounts' });
  }
});

// Add new email account
router.post('/', requireAuth, validateEmailAccount, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const accountData = req.body as CreateEmailAccountRequest;
    
    // Check if email account already exists for this user
    const existing = await pool.query(
      'SELECT id FROM email_accounts WHERE user_id = $1 AND email_address = $2',
      [userId, accountData.email_address]
    );
    
    if (existing.rows.length > 0) {
      res.status(409).json({ 
        error: 'Email account already exists',
        field: 'email_address'
      });
      return;
    }
    
    // Test IMAP connection
    try {
      await testImapConnection(accountData, userId);
    } catch (error) {
      if (error instanceof ImapConnectionError) {
        if (error.code === 'AUTHENTICATIONFAILED') {
          res.status(401).json({ 
            error: 'IMAP authentication failed',
            message: 'Invalid email credentials'
          });
          return;
        } else if (error.code === 'ENOTFOUND') {
          res.status(400).json({ 
            error: 'IMAP connection failed',
            message: 'Unable to connect to IMAP server'
          });
          return;
        }
      }
      
      res.status(408).json({ 
        error: 'IMAP connection timeout',
        message: 'Connection to email server timed out'
      });
      return;
    }
    
    // Encrypt password
    const encryptedPassword = encryptPassword(accountData.imap_password);

    // Insert into database
    const result = await pool.query(
      `INSERT INTO email_accounts
       (user_id, email_address, imap_host, imap_port, imap_username, imap_password_encrypted, monitoring_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email_address, imap_host, imap_port, imap_username, monitoring_enabled, last_sync, created_at`,
      [
        userId,
        accountData.email_address,
        accountData.imap_host,
        accountData.imap_port,
        accountData.imap_username,
        encryptedPassword,
        accountData.monitoring_enabled || false // Default to false if not specified
      ]
    );

    const newAccountId = result.rows[0].id;
    const monitoringEnabled = result.rows[0].monitoring_enabled;

    // Enable scheduler if monitoring was enabled during creation
    if (monitoringEnabled) {
      await jobSchedulerManager.enableScheduler(SchedulerId.CHECK_MAIL, userId, newAccountId);
      console.log(`[email-accounts] Enabled scheduler for new account ${newAccountId}`);
    }

    const account: EmailAccountResponse = {
      id: newAccountId,
      email_address: result.rows[0].email_address,
      imap_host: result.rows[0].imap_host,
      imap_port: result.rows[0].imap_port,
      imap_secure: accountData.imap_secure, // Not stored in DB, return from request
      imap_username: result.rows[0].imap_username,
      monitoring_enabled: monitoringEnabled,
      last_sync: result.rows[0].last_sync ? result.rows[0].last_sync.toISOString() : null,
      created_at: result.rows[0].created_at.toISOString(),
      updated_at: new Date().toISOString() // Not in DB, use current time
    };

    res.status(201).json(account);
  } catch (error) {
    console.error('Error creating email account:', error);
    res.status(500).json({ error: 'Failed to create email account' });
  }
});

// Test email account connection
router.post('/:id/test', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const accountId = req.params.id;

    // Verify the account belongs to the user
    const accountResult = await pool.query(
      'SELECT * FROM email_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    if (accountResult.rows.length === 0) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    const account = accountResult.rows[0];
    console.log('Testing connection for account:', {
      email: account.email_address,
      hasOAuth: !!account.oauth_provider,
      hasPassword: !!account.imap_password_encrypted
    });
    
    try {
      const success = await withImapContext(accountId, userId, async () => {
        const imapOps = await ImapOperations.fromAccountId(accountId, userId);
        return imapOps.testConnection(true);
      });
      
      if (!success) {
        res.status(400).json({ 
          error: 'Connection test failed',
          details: 'IMAP_TEST_FAILED'
        });
        return;
      }
      
      res.json({ 
        success: true, 
        message: 'Connection successful'
      });
    } catch (error: any) {
      console.error('IMAP test connection error:', error);
      if (error?.code === 'AUTH_REFRESH_FAILED') {
        res.status(401).json({
          error: 'OAUTH_REAUTH_REQUIRED',
          message: 'Email provider session expired or revoked. Please reconnect your account.'
        });
        return;
      }
      res.status(400).json({ 
        error: `Connection failed: ${error.message}`,
        details: error.code || 'UNKNOWN_ERROR'
      });
    }
  } catch (error: any) {
    console.error('Test connection error:', error);
    res.status(500).json({ error: error.message || 'Failed to test connection' });
  }
});

// Toggle monitoring for email account
router.post('/:id/monitoring', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const accountId = req.params.id;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    // Update the monitoring status
    const result = await pool.query(
      `UPDATE email_accounts
       SET monitoring_enabled = $1
       WHERE id = $2 AND user_id = $3
       RETURNING id, email_address, monitoring_enabled`,
      [enabled, accountId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    // Sync scheduler with monitoring state
    if (enabled) {
      await jobSchedulerManager.enableScheduler(SchedulerId.CHECK_MAIL, userId, accountId);
      console.log(`[email-accounts] Enabled scheduler for account ${accountId}`);
    } else {
      await jobSchedulerManager.disableScheduler(SchedulerId.CHECK_MAIL, userId, accountId);
      console.log(`[email-accounts] Disabled scheduler for account ${accountId}`);
    }

    // Log account monitoring toggle
    realTimeLogger.log(userId, {
      userId,
      emailAccountId: result.rows[0].id,
      level: 'info',
      command: 'ACCOUNT_MONITORING_TOGGLE',
      data: {
        parsed: {
          accountId: result.rows[0].id,
          email: result.rows[0].email_address,
          enabled
        },
        response: `Account monitoring ${enabled ? 'enabled' : 'disabled'} for ${result.rows[0].email_address}`
      }
    });

    res.json({
      success: true,
      account: {
        id: result.rows[0].id,
        email_address: result.rows[0].email_address,
        monitoring_enabled: result.rows[0].monitoring_enabled
      }
    });
  } catch (error) {
    console.error('Error toggling monitoring:', error);
    res.status(500).json({ error: 'Failed to toggle monitoring' });
  }
});

// Update email account credentials (password, host, port, username)
router.post('/:id/update-credentials', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const accountId = req.params.id;
    const { imap_host, imap_port, imap_username, imap_password } = req.body;

    // Verify account exists and belongs to user
    const accountResult = await pool.query(
      'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    if (accountResult.rows.length === 0) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    // Update connection fields
    const encryptedPassword = encryptPassword(imap_password);
    await pool.query(
      `UPDATE email_accounts
       SET imap_host = $1, imap_port = $2, imap_username = $3, imap_password_encrypted = $4
       WHERE id = $5`,
      [imap_host, imap_port, imap_username, encryptedPassword, accountId]
    );

    // No need to refresh scheduler - it fetches fresh credentials from database on each run

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating account credentials:', error);
    res.status(500).json({ error: 'Failed to update account credentials' });
  }
});

// Delete email account
router.delete('/:id', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const accountId = req.params.id;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(accountId)) {
      res.status(400).json({ error: 'Invalid account ID format' });
      return;
    }

    const result = await pool.query(
      'DELETE FROM email_accounts WHERE id = $1 AND user_id = $2 RETURNING id',
      [accountId, userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    // Disable scheduler for deleted account
    await jobSchedulerManager.disableScheduler(SchedulerId.CHECK_MAIL, userId, accountId);
    console.log(`[email-accounts] Disabled scheduler for deleted account ${accountId}`);

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting email account:', error);
    res.status(500).json({ error: 'Failed to delete email account' });
  }
});

export default router;
