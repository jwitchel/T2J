import express from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../lib/db';
import { withTransaction } from '../lib/db/transaction-utils';
import { encrypt } from '../lib/crypto';
import { ImapOperations } from '../lib/imap-operations';
import { withImapContext } from '../lib/imap-context';
import { IMAP_HOSTS, detectSentFolder } from './email-accounts';

const router = express.Router();

// Initiate OAuth flow for email connection
router.post('/connect', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const { provider } = req.body;

    if (provider !== 'google') {
      res.status(400).json({ error: 'Only Google OAuth is currently supported' });
      return;
    }

    // Generate a state parameter to track this OAuth flow
    const state = `email_${userId}_${Date.now()}`;
    
    // Store state in session or temporary storage
    // For now, we'll use a simple in-memory store
    // TODO: Use Redis or database for production
    
    res.json({
      provider,
      authUrl: `/api/auth/social/google?scope=openid+profile+email+https://mail.google.com/&state=${state}`
    });
  } catch (error) {
    console.error('OAuth email connect error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

// Complete OAuth email connection
router.post('/complete', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const {
      provider,
      email,
      accessToken,
      refreshToken,
      expiresIn,
      oauthUserId
    } = req.body;

    if (!email || !accessToken) {
      res.status(400).json({ error: 'Missing required OAuth data' });
      return;
    }

    await withTransaction(pool, async (client) => {
      // Check if email account already exists
      const existing = await client.query(
        'SELECT id FROM email_accounts WHERE user_id = $1 AND email_address = $2',
        [userId, email]
      );

      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      if (existing.rows.length > 0) {
        // Update existing account with OAuth credentials
        await client.query(
          `UPDATE email_accounts
           SET oauth_provider = $1,
               oauth_refresh_token = $2,
               oauth_access_token = $3,
               oauth_token_expires_at = $4,
               oauth_user_id = $5,
               updated_at = NOW()
           WHERE id = $6`,
          [
            provider,
            refreshToken ? encrypt(refreshToken) : null,
            encrypt(accessToken),
            expiresAt,
            oauthUserId,
            existing.rows[0].id
          ]
        );
      } else {
        // Create new email account with OAuth
        const imapHost = provider === 'google' ? IMAP_HOSTS.GMAIL : '';
        const imapPort = 993;

        await client.query(
          `INSERT INTO email_accounts
           (user_id, email_address, imap_host, imap_port, imap_username,
            oauth_provider, oauth_refresh_token, oauth_access_token,
            oauth_token_expires_at, oauth_user_id, sent_folder)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            userId,
            email,
            imapHost,
            imapPort,
            email, // Username is email for OAuth
            provider,
            refreshToken ? encrypt(refreshToken) : null,
            encrypt(accessToken),
            expiresAt,
            oauthUserId,
            detectSentFolder(imapHost)
          ]
        );
      }
    });

    // Test the connection (outside transaction)
    const testResult = await testOAuthConnection(userId, email);

    res.json({
      success: true,
      email,
      connectionTest: testResult
    });
  } catch (error) {
    console.error('OAuth email complete error:', error);
    res.status(500).json({ error: 'Failed to save OAuth credentials' });
  }
});

// Test OAuth connection
async function testOAuthConnection(userId: string, email: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT id FROM email_accounts 
       WHERE user_id = $1 AND email_address = $2 
       AND oauth_provider IS NOT NULL`,
      [userId, email]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const accountId = result.rows[0].id as string;
    return await withImapContext(accountId, userId, async () => {
      const imapOps = await ImapOperations.fromAccountId(accountId, userId);
      return await imapOps.testConnection(true);
    });
  } catch (error) {
    console.error('OAuth connection test error:', error);
    return false;
  }
}

export default router;
