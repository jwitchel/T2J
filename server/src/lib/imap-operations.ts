import { ImapConnection, ImapConnectionError } from './imap-connection';
import { imapPool } from './imap-pool';
import { decryptPassword, decrypt, encrypt } from './crypto';
import { pool } from '../server';
import { simpleParser } from 'mailparser';
import { OAuthTokenService } from './oauth-token-service';
import { getActiveContext, hasActiveContextFor, setContextConnection } from './imap-context';
import Redis from 'ioredis';

// Redis instance for UID tracking
const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null
});

export interface EmailAccountConfig {
  id: string;
  userId: string;
  email: string;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  imapPasswordEncrypted?: string;
  imapSecure?: boolean;
  oauthProvider?: string;
  oauthRefreshToken?: string;
  oauthAccessToken?: string;
  oauthTokenExpiresAt?: Date;
}

export interface EmailFolder {
  name: string;
  path: string;
  delimiter: string;
  flags: string[];
  messageCount?: number;
  unseenCount?: number;
}

export interface EmailMessage {
  uid: number;
  messageId?: string;
  from?: string;
  to?: string[];
  subject?: string;
  date?: Date;
  flags: string[];
  size?: number;
  preview?: string;
}

export interface EmailMessageWithRaw extends EmailMessage {
  rawMessage: string;
}

export interface SearchCriteria {
  seen?: boolean;
  unseen?: boolean;
  flagged?: boolean;
  unflagged?: boolean;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  before?: Date;
  since?: Date;
  larger?: number;
  smaller?: number;
}

export class ImapOperations {
  private account: EmailAccountConfig;
  private connection: ImapConnection | null = null;

  constructor(account: EmailAccountConfig) {
    this.account = account;
  }

  static async fromAccountId(accountId: string, userId: string): Promise<ImapOperations> {
    const result = await pool.query(
      `SELECT id, user_id, email_address, imap_host, imap_port, 
              imap_username, imap_password_encrypted,
              oauth_provider, oauth_refresh_token, oauth_access_token,
              oauth_token_expires_at
       FROM email_accounts 
       WHERE id = $1 AND user_id = $2`,
      [accountId, userId]
    );

    if (result.rows.length === 0) {
      throw new ImapConnectionError('Email account not found', 'ACCOUNT_NOT_FOUND');
    }

    const row = result.rows[0];
    const account: EmailAccountConfig = {
      id: row.id,
      userId: row.user_id,
      email: row.email_address,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      imapUsername: row.imap_username,
      imapPasswordEncrypted: row.imap_password_encrypted,
      imapSecure: row.imap_port === 993 || row.imap_port === 995,
      oauthProvider: row.oauth_provider,
      oauthRefreshToken: row.oauth_refresh_token,
      oauthAccessToken: row.oauth_access_token,
      oauthTokenExpiresAt: row.oauth_token_expires_at
    };

    return new ImapOperations(account);
  }

  /**
   * Get Redis key for storing last processed UID
   */
  private getLastUidKey(folderName: string): string {
    return `imap:last_uid:${this.account.id}:${folderName}`;
  }

  /**
   * Get last processed UID from Redis
   */
  private async getLastProcessedUid(folderName: string): Promise<number> {
    const key = this.getLastUidKey(folderName);
    const value = await redis.get(key);
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Update last processed UID in Redis
   */
  private async updateLastProcessedUid(folderName: string, uid: number): Promise<void> {
    const key = this.getLastUidKey(folderName);
    await redis.set(key, uid.toString());
  }

  private async getConnection(): Promise<ImapConnection> {
    // Prefer context-managed connection if present
    const ctx = getActiveContext();
    if (ctx && ctx.userId === this.account.userId && ctx.accountId === this.account.id && ctx.connection && ctx.connection.isConnected()) {
      return ctx.connection;
    }

    if (!this.connection) {
      let config: any = {
        user: this.account.imapUsername,
        host: this.account.imapHost,
        port: this.account.imapPort,
        tls: this.account.imapSecure
      };

      // Use OAuth2 if available
      if (this.account.oauthProvider && this.account.oauthAccessToken) {
        let accessToken = decrypt(this.account.oauthAccessToken);
        
        // Check if token needs refresh
        if (this.account.oauthTokenExpiresAt && 
            OAuthTokenService.needsRefresh(this.account.oauthTokenExpiresAt)) {
          if (!this.account.oauthRefreshToken) {
            throw new ImapConnectionError('OAuth refresh token not available', 'AUTH_REFRESH_TOKEN_MISSING');
          }
          
          try {
            const refreshToken = decrypt(this.account.oauthRefreshToken);
            const newTokens = await OAuthTokenService.refreshTokens(
              refreshToken,
              this.account.oauthProvider,
              this.account.id
            );
            
            // Update the access token for this connection
            accessToken = newTokens.accessToken;
            
            // Update the account object with new token info
            this.account.oauthAccessToken = encrypt(newTokens.accessToken);
            this.account.oauthTokenExpiresAt = newTokens.expiresAt;
          } catch (error) {
            console.error('Failed to refresh OAuth token:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new ImapConnectionError(
              `OAuth token refresh failed: ${errorMessage}`, 
              'AUTH_REFRESH_FAILED'
            );
          }
        }

        // Generate XOAUTH2 string with the (possibly refreshed) access token
        const xoauth2 = OAuthTokenService.generateXOAuth2Token(
          this.account.email,
          accessToken
        );
        
        config.xoauth2 = xoauth2;
        // Remove password field to ensure OAuth is used
        delete config.password;
      } else if (this.account.imapPasswordEncrypted) {
        // Fall back to password authentication
        const password = decryptPassword(this.account.imapPasswordEncrypted);
        config.password = password;
      } else {
        throw new ImapConnectionError('No authentication method available', 'AUTH_MISSING');
      }

      this.connection = await imapPool.getConnection(
        config,
        this.account.userId,
        this.account.id
      );

      // If within context for this account, register the connection so all ops reuse it
      const active = getActiveContext();
      if (active && active.userId === this.account.userId && active.accountId === this.account.id) {
        setContextConnection(this.connection);
      }
    }

    return this.connection;
  }

  async testConnection(preserveConnection: boolean = false): Promise<boolean> {
    let success = false;
    try {
      const conn = await this.getConnection();
      
      // Try to list folders as a test
      await conn.listFolders();
      
      success = true;
    } catch (error) {
      console.error('IMAP connection test failed:', error);
      success = false;
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
    return success;
  }

  /**
   * Get message count for a specific folder (fast version)
   * This is much faster than getFolders() when you only need one folder's count
   */
  async getFolderMessageCount(folderName: string, preserveConnection: boolean = false): Promise<{ total: number; unseen: number }> {
    const conn = await this.getConnection();
    
    try {
      const box = await conn.selectFolder(folderName);
      return {
        total: box.messages.total,
        unseen: box.messages.unseen
      };
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  async getFolders(preserveConnection: boolean = false): Promise<EmailFolder[]> {
    const conn = await this.getConnection();
    
    try {
      const imapFolders = await conn.listFolders();
      const folders: EmailFolder[] = [];

      // Recursive function to flatten nested folders
      const flattenFolders = (folderList: any[]) => {
        for (const imapFolder of folderList) {
          const folderPath = imapFolder.name;
          
          // Add the current folder
          folders.push({
            name: imapFolder.name,
            path: folderPath,
            delimiter: imapFolder.delimiter,
            flags: imapFolder.flags
          });
          
          // If it has children, recursively add them
          if (imapFolder.children && imapFolder.children.length > 0) {
            flattenFolders(imapFolder.children);
          }
        }
      };

      // Start flattening from root folders
      flattenFolders(imapFolders);

      // For folders we can select, get message counts
      for (const folder of folders) {
        // Skip folders with \Noselect flag
        if (folder.flags && folder.flags.includes('\\Noselect')) {
          continue;
        }
        
        try {
          const box = await conn.selectFolder(folder.path);
          folder.messageCount = box.messages.total;
          folder.unseenCount = box.messages.unseen;
        } catch (err) {
          // Silently skip folders we can't select
          console.debug(`Cannot select folder ${folder.path}:`, err);
        }
      }

      return folders;
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  async getMessages(
    folderName: string,
    options: {
      limit?: number;
      offset?: number;
      sort?: 'date' | 'from' | 'subject';
      descending?: boolean;
      preserveConnection?: boolean;
      since?: Date;  // For Look Back feature - filter emails by date
      updateLastUid?: boolean;  // Whether to update Redis tracking (default: true)
    } = {}
  ): Promise<EmailMessage[]> {
    const conn = await this.getConnection();

    try {
      await conn.selectFolder(folderName);

      let uids: number[];
      const limit = options.limit || 50;
      const offset = options.offset || 0;

      // Build search criteria based on options
      if (options.since) {
        // Look Back mode: Use SINCE date filter
        const searchCriteria: any[] = [['SINCE', options.since]];

        // Also filter by UID if we have a last processed UID
        const lastUid = await this.getLastProcessedUid(folderName);
        if (lastUid > 0) {
          searchCriteria.push(['UID', `${lastUid + 1}:*`]);
        }

        uids = await conn.search(searchCriteria);
        console.log(`[ImapOperations] SINCE search returned ${uids.length} UIDs from ${this.account.email} ${folderName}`);
      } else {
        // Standard mode: Use UID tracking for efficiency
        const lastUid = await this.getLastProcessedUid(folderName);

        if (lastUid === 0) {
          // First run - use 15-min lookback to avoid processing ancient emails
          const lookbackMinutes = parseInt(process.env.NEXT_PUBLIC_LOOK_BACK_DEFAULT_MINUTES || '15', 10);
          const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);
          uids = await conn.search([['SINCE', since]]);
          console.log(`[ImapOperations] First run with ${lookbackMinutes}min lookback returned ${uids.length} UIDs`);
        } else {
          // Use UID range - server-side filtering!
          uids = await conn.search([['UID', `${lastUid + 1}:*`]]);

          // IMPORTANT: IMAP protocol quirk - searching for "X:*" always includes the last message
          // even if X is greater than the highest UID. We must filter client-side.
          // See: https://github.com/mscdex/node-imap/issues/473
          uids = uids.filter(uid => uid > lastUid);
          console.log(`[ImapOperations] UID range ${lastUid + 1}:* returned ${uids.length} new UIDs`);
        }
      }

      if (uids.length === 0) {
        return [];
      }

      // Sort UIDs (descending = newest first)
      let sortedUids = [...uids];
      if (options.descending !== false) {
        sortedUids.reverse();
      }

      // Apply pagination
      const paginatedUids = sortedUids.slice(offset, offset + limit);

      console.log(`[ImapOperations] Fetching ${paginatedUids.length} messages from ${this.account.email} ${folderName} (total new: ${uids.length}, offset: ${offset})`);

      if (paginatedUids.length === 0) {
        return [];
      }

      // Fetch message details in parallel
      const fetchPromises = paginatedUids.map(async (uid) => {
        try {
          const fetchedMessages = await conn.fetch(uid, {
            bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)',
            envelope: true,
            size: true,
            flags: true
          });
          return fetchedMessages.length > 0 ? fetchedMessages[0] : null;
        } catch (err) {
          console.error(`Error fetching UID ${uid}: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      });

      const fetchResults = await Promise.all(fetchPromises);
      const messages = fetchResults.filter(msg => msg !== null);

      // Update last processed UID (if requested)
      if (options.updateLastUid !== false && paginatedUids.length > 0) {
        const highestUid = Math.max(...paginatedUids);
        await this.updateLastProcessedUid(folderName, highestUid);
      }

      return messages.map((msg: any) => ({
        uid: msg.uid,
        messageId: msg.headers?.messageId?.[0],
        from: msg.headers?.from?.[0],
        to: msg.headers?.to,
        subject: msg.headers?.subject?.[0],
        date: msg.date,
        flags: msg.flags,
        size: msg.size
      }));
    } finally {
      if (!options.preserveConnection) {
        this.release();
      }
    }
  }

  async searchMessages(
    folderName: string,
    criteria: SearchCriteria,
    options: {
      limit?: number;
      offset?: number;
      preserveConnection?: boolean;
    } = {}
  ): Promise<EmailMessage[]> {
    const conn = await this.getConnection();
    
    try {
      await conn.selectFolder(folderName);
      
      // Build IMAP search criteria
      const imapCriteria: any[] = [];
      
      if (criteria.seen !== undefined) {
        imapCriteria.push(criteria.seen ? 'SEEN' : 'UNSEEN');
      }
      if (criteria.flagged !== undefined) {
        imapCriteria.push(criteria.flagged ? 'FLAGGED' : 'UNFLAGGED');
      }
      if (criteria.from) {
        imapCriteria.push(['FROM', criteria.from]);
      }
      if (criteria.to) {
        imapCriteria.push(['TO', criteria.to]);
      }
      if (criteria.subject) {
        imapCriteria.push(['SUBJECT', criteria.subject]);
      }
      if (criteria.body) {
        imapCriteria.push(['BODY', criteria.body]);
      }
      if (criteria.before) {
        imapCriteria.push(['BEFORE', criteria.before]);
      }
      if (criteria.since) {
        imapCriteria.push(['SINCE', criteria.since]);
      }
      if (criteria.larger) {
        imapCriteria.push(['LARGER', criteria.larger]);
      }
      if (criteria.smaller) {
        imapCriteria.push(['SMALLER', criteria.smaller]);
      }

      // Default to ALL if no criteria
      if (imapCriteria.length === 0) {
        imapCriteria.push('ALL');
      }

      const uids = await conn.search(imapCriteria);
      console.log(`IMAP search with criteria ${JSON.stringify(imapCriteria)} returned ${uids.length} UIDs`);
      
      if (uids.length === 0) {
        return [];
      }

      // Sort UIDs in descending order to get newest emails first
      const sortedUids = [...uids].sort((a, b) => b - a);

      // Apply pagination
      const offset = options.offset || 0;
      const limit = options.limit || 50;
      const paginatedUids = sortedUids.slice(offset, offset + limit);
      console.log(`Pagination: offset=${offset}, limit=${limit}, paginatedUids.length=${paginatedUids.length}`);

      if (paginatedUids.length === 0) {
        return [];
      }

      // Fetch message details in parallel for better performance
      console.log(`Fetching UIDs: ${paginatedUids.slice(0, 10).join(',')}... (total: ${paginatedUids.length})`);
      
      const fetchPromises = paginatedUids.map(async (uid) => {
        try {
          const fetchedMessages = await conn.fetch(uid, {
            bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)',
            envelope: true,
            size: true,
            flags: true
          });
          return fetchedMessages.length > 0 ? fetchedMessages[0] : null;
        } catch (err) {
          console.error(`Error fetching UID ${uid}: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      });

      // Wait for all fetches to complete
      const fetchResults = await Promise.all(fetchPromises);
      
      // Filter out nulls
      const messages = fetchResults.filter(msg => msg !== null);
      
      console.log(`Total fetched ${messages.length} messages from IMAP`);

      return messages.map((msg: any) => ({
        uid: msg.uid,
        messageId: msg.headers?.messageId?.[0],
        from: msg.headers?.from?.[0],
        to: msg.headers?.to,
        subject: msg.headers?.subject?.[0],
        date: msg.date,
        flags: msg.flags,
        size: msg.size
      }));
    } finally {
      if (!options.preserveConnection) {
        this.release();
      }
    }
  }

  async getMessage(folderName: string, uid: number, preserveConnection: boolean = false): Promise<EmailMessage & { body?: string; parsed?: any; rawMessage?: string }> {
    const conn = await this.getConnection();
    
    try {
      await conn.selectFolder(folderName);
      
      // Fetch the complete message including all headers and body
      const messages = await conn.fetch(uid.toString(), {
        bodies: '', // Empty string fetches the entire RFC 5322 message
        envelope: true,
        size: true,
        flags: true
      });

      if (messages.length === 0) {
        throw new ImapConnectionError('Message not found', 'MESSAGE_NOT_FOUND');
      }

      const msg = messages[0];
      
      // Validate we have the body
      if (!msg.body) {
        throw new ImapConnectionError('Message body not retrieved', 'BODY_NOT_FOUND');
      }
      
      // Ensure body is a string with proper encoding
      let bodyString: string;
      if (Buffer.isBuffer(msg.body)) {
        // Convert Buffer to string using UTF-8 encoding
        bodyString = msg.body.toString('utf8');
      } else if (typeof msg.body === 'string') {
        bodyString = msg.body;
      } else {
        throw new ImapConnectionError('Unexpected body type', 'INVALID_BODY_TYPE');
      }
      
      // Parse the message
      const parsed = await simpleParser(bodyString);
      
      return {
        uid: msg.uid,
        messageId: msg.headers?.messageId?.[0],
        from: msg.headers?.from?.[0],
        to: msg.headers?.to,
        subject: msg.headers?.subject?.[0],
        date: msg.date,
        flags: msg.flags,
        size: msg.size,
        body: bodyString,
        parsed,
        rawMessage: bodyString  // This is the complete RFC 5322 message with headers and body
      };
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  /**
   * Get multiple messages without parsing in a single batch (fast version)
   * This uses the same connection for all fetches and can parallelize operations
   */
  async getMessagesRaw(
    folderName: string, 
    uids: number[], 
    preserveConnection: boolean = false
  ): Promise<EmailMessageWithRaw[]> {
    if (uids.length === 0) {
      return [];
    }

    const conn = await this.getConnection();
    
    try {
      await conn.selectFolder(folderName);
      
      // Fetch messages in parallel for better performance
      const fetchPromises = uids.map(async (uid) => {
        try {
          const messages = await conn.fetch(uid.toString(), {
            bodies: '', // Empty string fetches the entire RFC 5322 message
            envelope: true,
            size: true,
            flags: true
          });

          if (messages.length === 0) {
            console.warn(`Message ${uid} not found`);
            return null;
          }

          const msg = messages[0] as any;

          if (!msg.body) {
            console.warn(`Message ${uid} has no body`);
            return null;
          }

          // Ensure body is a string with proper encoding
          let bodyString: string;
          if (Buffer.isBuffer(msg.body)) {
            bodyString = msg.body.toString('utf8');
          } else if (typeof msg.body === 'string') {
            bodyString = msg.body;
          } else {
            console.warn(`Message ${uid} has invalid body type`);
            return null;
          }

          // Use mailparser to parse the complete message for proper header extraction
          const parsedEmail = await simpleParser(bodyString);

          const result: EmailMessageWithRaw = {
            uid: msg.uid,
            messageId: parsedEmail.messageId || undefined,
            from: parsedEmail.from?.value?.[0]?.address || undefined,
            to: parsedEmail.to ? (Array.isArray(parsedEmail.to) ? parsedEmail.to : [parsedEmail.to]).flatMap((addr: any) => addr.value || []).map((a: any) => a.address || '') : undefined,
            subject: parsedEmail.subject || undefined,
            date: parsedEmail.date || msg.date || new Date(),
            flags: msg.flags,
            size: msg.size,
            rawMessage: bodyString
          };
          return result;
        } catch (err) {
          console.error(`Error fetching UID ${uid}:`, err);
          return null;
        }
      });

      // Wait for all fetches to complete
      const results = await Promise.all(fetchPromises);
      
      // Filter out nulls from failed fetches  
      const validMessages: EmailMessageWithRaw[] = [];
      for (const msg of results) {
        if (msg !== null) {
          validMessages.push(msg);
        }
      }
      return validMessages;
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  /**
   * Get message without parsing (fast version for inbox listing)
   * This skips the expensive parsing step which includes decoding attachments
   */
  async getMessageRaw(folderName: string, uid: number, preserveConnection: boolean = false): Promise<EmailMessageWithRaw> {
    const conn = await this.getConnection();
    
    try {
      await conn.selectFolder(folderName);
      
      // Fetch the complete message including all headers and body
      const messages = await conn.fetch(uid.toString(), {
        bodies: '', // Empty string fetches the entire RFC 5322 message
        envelope: true,
        size: true,
        flags: true
      });

      if (messages.length === 0) {
        throw new ImapConnectionError('Message not found', 'MESSAGE_NOT_FOUND');
      }

      const msg = messages[0];
      
      // Validate we have the body
      if (!msg.body) {
        throw new ImapConnectionError('Message body not retrieved', 'BODY_NOT_FOUND');
      }
      
      // Ensure body is a string with proper encoding
      let bodyString: string;
      if (Buffer.isBuffer(msg.body)) {
        // Convert Buffer to string using UTF-8 encoding
        bodyString = msg.body.toString('utf8');
      } else if (typeof msg.body === 'string') {
        bodyString = msg.body;
      } else {
        throw new ImapConnectionError('Unexpected body type', 'INVALID_BODY_TYPE');
      }
      
      // Return without parsing - much faster for emails with attachments
      return {
        uid: msg.uid,
        messageId: msg.headers?.messageId?.[0],
        from: msg.headers?.from?.[0],
        to: msg.headers?.to,
        subject: msg.headers?.subject?.[0],
        date: msg.date,
        flags: msg.flags,
        size: msg.size,
        rawMessage: bodyString  // This is the complete RFC 5322 message with headers and body
      };
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  async markAsRead(folderName: string, uid: number, preserveConnection: boolean = false): Promise<void> {
    const conn = await this.getConnection();
    
    try {
      await conn.selectFolder(folderName);
      
      // Add the \Seen flag
      await new Promise<void>((resolve, reject) => {
        (conn as any).imap.addFlags(uid, '\\Seen', (err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  async markAsUnread(folderName: string, uid: number, preserveConnection: boolean = false): Promise<void> {
    const conn = await this.getConnection();
    
    try {
      await conn.selectFolder(folderName);
      
      // Remove the \Seen flag
      await new Promise<void>((resolve, reject) => {
        (conn as any).imap.delFlags(uid, '\\Seen', (err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  async deleteMessage(folderName: string, uid: number, preserveConnection: boolean = false): Promise<void> {
    const conn = await this.getConnection();
    
    try {
      await conn.selectFolder(folderName);
      
      // Add the \Deleted flag
      await new Promise<void>((resolve, reject) => {
        (conn as any).imap.addFlags(uid, '\\Deleted', (err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Expunge to permanently delete
      await new Promise<void>((resolve, reject) => {
        (conn as any).imap.expunge((err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  async startIdleMonitoring(folderName: string, callback: (event: any) => void): Promise<void> {
    const conn = await this.getConnection();
    
    try {
      await conn.selectFolder(folderName);
      
      conn.on('mail', (numNewMsgs: number) => {
        callback({ type: 'new_mail', count: numNewMsgs });
      });

      conn.on('expunge', (seqno: number) => {
        callback({ type: 'expunge', seqno });
      });

      await conn.idle();
    } catch (error) {
      // On error, release the connection
      this.release();
      throw error;
    }
    // Note: We don't release here because IDLE monitoring keeps the connection open
    // stopIdleMonitoring() should be called to clean up
  }

  stopIdleMonitoring(): void {
    if (this.connection) {
      this.connection.stopIdle();
    }
  }

  release(): void {
    // If running inside a managed context for this account, do not release here
    if (hasActiveContextFor(this.account.userId, this.account.id)) {
      return;
    }
    if (this.connection) {
      imapPool.releaseConnection(this.connection, this.account.userId, this.account.id);
      this.connection = null;
    }
  }

  async updateLastSync(): Promise<void> {
    await pool.query(
      'UPDATE email_accounts SET last_sync = CURRENT_TIMESTAMP WHERE id = $1',
      [this.account.id]
    );
  }

  async findDraftFolder(preserveConnection: boolean = false): Promise<string> {
    const folders = await this.getFolders(preserveConnection);
    
    // Log all folders for debugging
    console.log('Available folders:', folders.map(f => ({
      name: f.name,
      path: f.path,
      flags: f.flags
    })));
    
    // Common draft folder names - check exact matches first
    const draftFolderNames = ['[Gmail]/Drafts', 'Drafts', 'Draft', 'INBOX.Drafts', 'INBOX/Drafts'];
    
    for (const folderName of draftFolderNames) {
      const folder = folders.find(f => 
        f.name === folderName ||
        f.path === folderName
      );
      if (folder) {
        console.log(`Found draft folder by exact match: ${folder.path}`);
        return folder.path;
      }
    }
    
    // Try case-insensitive match
    for (const folderName of draftFolderNames) {
      const folder = folders.find(f => 
        f.name.toLowerCase() === folderName.toLowerCase() ||
        f.path.toLowerCase() === folderName.toLowerCase()
      );
      if (folder) {
        console.log(`Found draft folder by case-insensitive match: ${folder.path}`);
        return folder.path;
      }
    }
    
    // If no standard draft folder found, look for any folder with 'draft' in the name
    const draftFolder = folders.find(f => 
      f.name.toLowerCase().includes('draft') ||
      f.path.toLowerCase().includes('draft')
    );
    
    if (draftFolder) {
      console.log(`Found draft folder by partial match: ${draftFolder.path}`);
      return draftFolder.path;
    }
    
    // Also check if any folder has the \Drafts flag
    const flaggedDraftFolder = folders.find(f => 
      f.flags && f.flags.some(flag => flag.toLowerCase() === '\\drafts')
    );
    
    if (flaggedDraftFolder) {
      console.log(`Found draft folder by \\Drafts flag: ${flaggedDraftFolder.path}`);
      return flaggedDraftFolder.path;
    }
    
    console.error('No draft folder found among:', folders.map(f => f.path));
    throw new ImapConnectionError('Draft folder not found', 'DRAFT_FOLDER_NOT_FOUND');
  }

  async createFolder(folderPath: string, preserveConnection: boolean = false): Promise<void> {
    const conn = await this.getConnection();
    
    try {
      await new Promise<void>((resolve, reject) => {
        (conn as any).imap.addBox(folderPath, (err: Error) => {
          if (err) {
            console.error(`Failed to create folder ${folderPath}:`, err);
            reject(err);
          } else {
            console.log(`Successfully created folder: ${folderPath}`);
            resolve();
          }
        });
      });
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  async appendMessage(
    folderName: string, 
    messageContent: string,
    flags?: string[],
    preserveConnection: boolean = false
  ): Promise<void> {
    const conn = await this.getConnection();
    
    try {
      // Ensure the message has proper line endings (CRLF)
      const normalizedMessage = messageContent.replace(/\r?\n/g, '\r\n');
      
      // node-imap expects a buffer or string
      await conn.append(normalizedMessage, {
        mailbox: folderName,
        flags: flags || ['\\Draft']
      });
    } catch (error) {
      console.error('Error appending message:', error);
      throw new ImapConnectionError(
        `Failed to append message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'APPEND_FAILED'
      );
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  async moveMessage(
    sourceFolder: string,
    destFolder: string,
    uid: number,
    flags?: string[],
    preserveConnection: boolean = false
  ): Promise<void> {
    const conn = await this.getConnection();

    try {
      // Select the source folder
      await conn.selectFolder(sourceFolder);

      // Fetch Message-ID for verification
      let messageId: string | undefined;
      try {
        const headerMsgs = await conn.fetch(uid.toString(), {
          bodies: 'HEADER.FIELDS (MESSAGE-ID SUBJECT)',
          envelope: true,
          flags: true
        });
        if (headerMsgs.length > 0) {
          const msg = headerMsgs[0] as any;
          const midArr = msg.headers?.messageId;
          messageId = Array.isArray(midArr) ? midArr[0] : undefined;
        }
      } catch {
        // Non-fatal: continue without verification
      }

      // If flags are provided (e.g., mark spam as \Seen), apply them before move so they carry over
      if (flags && flags.length > 0) {
        await new Promise<void>((resolve, reject) => {
          (conn as any).imap.addFlags(uid, flags, (err: Error) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      // Try server-side MOVE first (if supported by the server/node-imap)
      const tryMove = async (): Promise<boolean> => {
        return await new Promise<boolean>((resolve) => {
          const imap: any = (conn as any).imap;
          if (typeof imap.move !== 'function') {
            return resolve(false);
          }
          imap.move(uid.toString(), destFolder, (err: Error | null) => {
            if (err) {
              // MOVE not supported or failed; fall back
              return resolve(false);
            }
            resolve(true);
          });
        });
      };

      const moved = await tryMove();
      if (!moved) {
        // Fallback: COPY then mark original as \Deleted and EXPUNGE
        await new Promise<void>((resolve, reject) => {
          (conn as any).imap.copy(uid.toString(), destFolder, (err: Error) => {
            if (err) reject(err);
            else resolve();
          });
        });

        await new Promise<void>((resolve, reject) => {
          (conn as any).imap.addFlags(uid, '\\Deleted', (err: Error) => {
            if (err) reject(err);
            else resolve();
          });
        });

        await new Promise<void>((resolve, reject) => {
          (conn as any).imap.expunge((err: Error) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }

      // Removed verbose logging - summary now in InboxProcessor

      // Verify removal from source; if still present by Message-ID, force delete and expunge
      if (messageId) {
        try {
          const remaining = await conn.search(['HEADER', 'Message-ID', messageId]);
          if (remaining && remaining.length > 0) {
            await new Promise<void>((resolve, reject) => {
              (conn as any).imap.addFlags(remaining.join(','), '\\Deleted', (err: Error) => {
                if (err) reject(err);
                else resolve();
              });
            });
            await new Promise<void>((resolve, reject) => {
              (conn as any).imap.expunge((err: Error) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        } catch {
          // Ignore verification failures
        }
      }
    } catch (error) {
      console.error('Error moving message:', error);
      throw new ImapConnectionError(
        `Failed to move message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'MOVE_FAILED'
      );
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
  }

  async findMessageByMessageId(folderName: string, messageId: string, preserveConnection: boolean = false): Promise<number | null> {
    const conn = await this.getConnection();
    let result: number | null = null;
    
    try {
      await conn.selectFolder(folderName);
      
      // Search for message by Message-ID header
      const searchCriteria = ['HEADER', 'Message-ID', messageId];
      const uids = await conn.search(searchCriteria);
      
      if (uids.length === 0) {
        result = null;
      } else {
        // Return the first matching UID
        result = uids[0];
      }
    } catch (error) {
      console.error('Error finding message by ID:', error);
      result = null;
    } finally {
      if (!preserveConnection) {
        this.release();
      }
    }
    return result;
  }
}
