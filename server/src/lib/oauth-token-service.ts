import { pool } from './db';
import { encrypt, decrypt } from './crypto';
import { userAlertService } from './user-alert-service';
import { AlertType, AlertSeverity, SourceType } from '../types/user-alerts';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export class OAuthTokenService {
  /**
   * Store OAuth tokens for an email account
   */
  static async storeTokens(
    emailAccountId: string,
    tokens: OAuthTokens,
    oauthUserId: string
  ): Promise<void> {
    const encryptedRefreshToken = encrypt(tokens.refreshToken);
    const encryptedAccessToken = encrypt(tokens.accessToken);

    await pool.query(
      `UPDATE email_accounts 
       SET oauth_refresh_token = $1,
           oauth_access_token = $2,
           oauth_token_expires_at = $3,
           oauth_user_id = $4
       WHERE id = $5`,
      [
        encryptedRefreshToken,
        encryptedAccessToken,
        tokens.expiresAt,
        oauthUserId,
        emailAccountId
      ]
    );
  }

  /**
   * Get OAuth tokens for an email account
   */
  static async getTokens(emailAccountId: string): Promise<OAuthTokens | null> {
    const result = await pool.query(
      `SELECT oauth_refresh_token, oauth_access_token, oauth_token_expires_at
       FROM email_accounts
       WHERE id = $1 AND oauth_refresh_token IS NOT NULL`,
      [emailAccountId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      refreshToken: decrypt(row.oauth_refresh_token),
      accessToken: decrypt(row.oauth_access_token),
      expiresAt: row.oauth_token_expires_at
    };
  }

  /**
   * Generate XOAUTH2 string for IMAP authentication
   * Format: base64("user=" + userName + "^Aauth=Bearer " + accessToken + "^A^A")
   */
  static generateXOAuth2Token(email: string, accessToken: string): string {
    const authString = [
      `user=${email}`,
      `auth=Bearer ${accessToken}`,
      '',
      ''
    ].join('\x01');
    
    return Buffer.from(authString).toString('base64');
  }

  /**
   * Check if token needs refresh (5 minutes before expiry)
   */
  static needsRefresh(expiresAt: Date): boolean {
    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    return fiveMinutesFromNow >= expiresAt;
  }

  /**
   * Refresh OAuth tokens using refresh token
   */
  static async refreshTokens(
    refreshToken: string,
    provider: string,
    emailAccountId: string
  ): Promise<OAuthTokens> {
    if (provider !== 'google') {
      throw new Error(`Token refresh not implemented for provider: ${provider}`);
    }

    // Google OAuth token refresh endpoint
    const tokenEndpoint = 'https://oauth2.googleapis.com/token';

    // Get client credentials from environment
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth client credentials not configured');
    }

    // Prepare refresh request
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OAuthTokenService] Token refresh failed:', errorText);

      // Parse error response
      let errorData: any = {};
      try {
        errorData = JSON.parse(errorText);
      } catch {
        // Not JSON, use raw text
      }

      // Check for specific error types
      if (errorData.error === 'invalid_grant' || response.status === 400) {
        // Refresh token is invalid or expired - create alert
        await this._createReauthAlert(emailAccountId, AlertType.REAUTH_REQUIRED, 'Your email account requires re-authorization.');
        throw new Error('REFRESH_TOKEN_INVALID: The refresh token is invalid or expired. Please re-authenticate.');
      }

      // Other OAuth errors (server errors, network issues, etc.)
      await this._createReauthAlert(emailAccountId, AlertType.CONNECTION_FAILED, `OAuth refresh failed: ${errorData.error || response.status}`);
      throw new Error(`Token refresh failed: ${response.status} - ${errorData.error || errorText}`);
    }

    const data: any = await response.json();

    const newTokens: OAuthTokens = {
      accessToken: data.access_token,
      refreshToken: refreshToken, // Google doesn't always return a new refresh token
      expiresAt: new Date(Date.now() + data.expires_in * 1000)
    };

    // Store the new tokens
    await this.storeTokens(emailAccountId, newTokens, '');

    // Success - resolve any OAuth-related alerts for this account
    await userAlertService.resolveAlertsForSource(SourceType.EMAIL_ACCOUNT, emailAccountId);

    return newTokens;
  }

  /**
   * Create an alert for OAuth errors
   */
  private static async _createReauthAlert(
    emailAccountId: string,
    alertType: AlertType,
    message: string
  ): Promise<void> {
    const result = await pool.query(
      'SELECT user_id, email_address FROM email_accounts WHERE id = $1',
      [emailAccountId]
    );

    if (result.rows.length === 0) {
      console.error('[OAuthTokenService] Cannot create alert: email account %s not found', emailAccountId);
      return;
    }

    const { user_id, email_address } = result.rows[0];

    await userAlertService.createAlert({
      userId: user_id,
      alertType,
      severity: AlertSeverity.ERROR,
      sourceType: SourceType.EMAIL_ACCOUNT,
      sourceId: emailAccountId,
      sourceName: email_address,
      message,
      actionUrl: '/settings/email-accounts',
      actionLabel: 'Reconnect',
    });
  }
}