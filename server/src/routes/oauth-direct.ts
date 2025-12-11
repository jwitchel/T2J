import express from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../lib/db';
import { encrypt } from '../lib/crypto';
import crypto from 'crypto';
import { detectSentFolder, IMAP_HOSTS } from './email-accounts';

const router = express.Router();

// In-memory store for OAuth state (in production, use Redis or database)
const oauthStates = new Map<string, { userId: string; timestamp: number }>();

// Clean up old states every hour
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.timestamp > 3600000) { // 1 hour
      oauthStates.delete(state);
    }
  }
}, 3600000);

// Initiate OAuth flow for email connection
router.post('/authorize', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const { provider } = req.body;

    if (provider !== 'google') {
      res.status(400).json({ error: 'Only Google OAuth is currently supported' });
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.OAUTH_REDIRECT_URI!;

    if (!clientId) {
      res.status(500).json({ error: 'Google OAuth not configured' });
      return;
    }

    // Generate secure state parameter
    const state = crypto.randomBytes(32).toString('hex');
    oauthStates.set(state, { userId, timestamp: Date.now() });

    // Build Google OAuth URL
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile https://mail.google.com/',
      access_type: 'offline',
      prompt: 'consent', // Force consent to ensure we get refresh token
      state
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    res.json({ authUrl });
  } catch (error) {
    console.error('OAuth direct authorize error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

// Handle OAuth callback
router.get('/callback', async (req, res): Promise<void> => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error('OAuth error:', oauthError);
      res.redirect(`${process.env.OAUTH_ERROR_REDIRECT_URI!}?error=oauth_denied`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${process.env.OAUTH_ERROR_REDIRECT_URI!}?error=invalid_callback`);
      return;
    }

    // Verify state
    const stateData = oauthStates.get(state as string);
    if (!stateData) {
      res.redirect(`${process.env.OAUTH_ERROR_REDIRECT_URI!}?error=invalid_state`);
      return;
    }

    const { userId } = stateData;
    oauthStates.delete(state as string);

    // Exchange code for tokens
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI!;

    if (!clientId || !clientSecret) {
      res.redirect(`${process.env.OAUTH_ERROR_REDIRECT_URI!}?error=oauth_config`);
      return;
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }).toString()
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      res.redirect(`${process.env.OAUTH_ERROR_REDIRECT_URI!}?error=token_exchange`);
      return;
    }

    const tokens: any = await tokenResponse.json();

    // Get user info to determine email address
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`
      }
    });

    if (!userInfoResponse.ok) {
      res.redirect(`${process.env.OAUTH_ERROR_REDIRECT_URI!}?error=user_info`);
      return;
    }

    const userInfo: any = await userInfoResponse.json();
    const email = userInfo.email;

    // Store tokens in session for the frontend to complete the process
    // In production, use a more secure method
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    // Store in temporary table or cache
    await pool.query(
      `INSERT INTO oauth_sessions (token, user_id, email, access_token, refresh_token, expires_in, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (token) DO UPDATE SET
         user_id = $2,
         email = $3,
         access_token = $4,
         refresh_token = $5,
         expires_in = $6,
         created_at = NOW()`,
      [
        sessionToken,
        userId,
        email,
        encrypt(tokens.access_token),
        tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
        tokens.expires_in || 3600
      ]
    );

    // Clean up old sessions
    await pool.query(
      `DELETE FROM oauth_sessions WHERE created_at < NOW() - INTERVAL '1 hour'`
    );

    // Redirect to frontend with session token
    res.redirect(`${process.env.OAUTH_COMPLETE_REDIRECT_URI!}?session=${sessionToken}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.OAUTH_ERROR_REDIRECT_URI!}?error=callback_error`);
  }
});

// Complete OAuth flow - called by frontend
router.post('/complete', requireAuth, async (req, res): Promise<void> => {
  const client = await pool.connect();
  
  try {
    const userId = req.user.id;
    const { sessionToken } = req.body;

    if (!sessionToken) {
      res.status(400).json({ error: 'Missing session token' });
      return;
    }

    await client.query('BEGIN');

    // Retrieve OAuth session
    const sessionResult = await client.query(
      `SELECT * FROM oauth_sessions WHERE token = $1 AND user_id = $2`,
      [sessionToken, userId]
    );

    if (sessionResult.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired session' });
      return;
    }

    const session = sessionResult.rows[0];
    const expiresAt = new Date(Date.now() + session.expires_in * 1000);

    // Check if email account already exists
    const existing = await client.query(
      'SELECT id FROM email_accounts WHERE user_id = $1 AND email_address = $2',
      [userId, session.email]
    );

    if (existing.rows.length > 0) {
      // Update existing account with OAuth credentials
      await client.query(
        `UPDATE email_accounts 
         SET oauth_provider = $1,
             oauth_refresh_token = $2,
             oauth_access_token = $3,
             oauth_token_expires_at = $4,
             oauth_user_id = $5,
             imap_password_encrypted = NULL
         WHERE id = $6`,
        [
          'google',
          session.refresh_token,
          session.access_token,
          expiresAt,
          session.email,
          existing.rows[0].id
        ]
      );
    } else {
      // Create new email account with OAuth
      await client.query(
        `INSERT INTO email_accounts
         (user_id, email_address, imap_host, imap_port, imap_username,
          oauth_provider, oauth_refresh_token, oauth_access_token,
          oauth_token_expires_at, oauth_user_id, sent_folder)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          userId,
          session.email,
          IMAP_HOSTS.GMAIL,
          993,
          session.email,
          'google',
          session.refresh_token,
          session.access_token,
          expiresAt,
          session.email,
          detectSentFolder(IMAP_HOSTS.GMAIL)
        ]
      );
    }

    // Delete the session
    await client.query('DELETE FROM oauth_sessions WHERE token = $1', [sessionToken]);

    await client.query('COMMIT');

    res.json({ 
      success: true, 
      email: session.email
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('OAuth complete error:', error);
    res.status(500).json({ error: 'Failed to save OAuth credentials' });
  } finally {
    client.release();
  }
});

export default router;
