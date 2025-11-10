import { Response } from 'express';
import { withImapContext } from '../imap-context';
import { ImapConnectionError } from '../imap-connection';

type Task<T> = () => Promise<T>;

export function mapImapError(res: Response, error: any, fallbackMessage: string) {
  if (error instanceof ImapConnectionError) {
    if (error.code === 'ACCOUNT_NOT_FOUND') {
      return res.status(404).json({ error: 'Email account not found' });
    }
    if (error.code === 'AUTH_REFRESH_FAILED') {
      return res.status(401).json({
        error: 'OAUTH_REAUTH_REQUIRED',
        message: 'Email provider session expired or revoked. Please reconnect your account.'
      });
    }
    // Check for authentication/credential errors
    const errorMsg = error.message.toLowerCase();
    if (errorMsg.includes('invalid credentials') ||
        errorMsg.includes('authentication failed') ||
        errorMsg.includes('login failed') ||
        error.source === 'authentication') {
      return res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Email account credentials are invalid. Please update your password or reconnect your account.',
        code: error.code
      });
    }
    return res.status(503).json({
      error: 'IMAP connection failed',
      message: error.message,
      code: error.code
    });
  }
  return res.status(500).json({ error: fallbackMessage, message: error instanceof Error ? error.message : String(error) });
}

export async function withImapJson<T>(
  res: Response,
  accountId: string,
  userId: string,
  task: Task<T>,
  fallbackMessage = 'Request failed'
) {
  try {
    const data = await withImapContext(accountId, userId, async () => task());
    return res.json(data as any);
  } catch (error: unknown) {
    return mapImapError(res, error, fallbackMessage);
  }
}
