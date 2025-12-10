import Imap from 'imap';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { realTimeLogger } from './real-time-logger';
import { normalizeMessageIdArray } from './message-id-utils';

export interface ImapConfig {
  user: string;
  password?: string;
  xoauth2?: string;
  host: string;
  port: number;
  tls?: boolean;
  tlsOptions?: {
    rejectUnauthorized?: boolean;
  };
  authTimeout?: number;
  connTimeout?: number;
  keepalive?: {
    interval?: number;
    idleInterval?: number;
    forceNoop?: boolean;
  };
}

export interface ImapMessage {
  uid: number;
  flags: string[];
  date: Date;
  headers: {
    from?: string[];
    to?: string[];
    subject?: string[];
    date?: string[];
    messageId?: string[];
  };
  body?: string;
  size?: number;
}

export interface ImapFolder {
  name: string;
  delimiter: string;
  flags: string[];
  children?: ImapFolder[];
}

export class ImapConnectionError extends Error {
  constructor(
    message: string,
    public code?: string,
    public source?: string
  ) {
    super(message);
    this.name = 'ImapConnectionError';
  }
}

export class ImapConnection extends EventEmitter {
  private imap: Imap;
  private config: ImapConfig;
  private connected = false;
  private userId: string;
  private emailAccountId: string;
  private currentBox: string | null = null;

  constructor(
    config: ImapConfig,
    userId: string,
    emailAccountId: string
  ) {
    super();
    this.config = config;
    this.userId = userId;
    this.emailAccountId = emailAccountId;

    // Configure IMAP connection
    const imapConfig: any = {
      user: config.user,
      host: config.host,
      port: config.port,
      tls: config.tls ?? (config.port === 993),
      tlsOptions: config.tlsOptions || { rejectUnauthorized: false },
      authTimeout: config.authTimeout || 10000,
      connTimeout: config.connTimeout || 10000,
      keepalive: config.keepalive || {
        interval: 10000,
        idleInterval: 300000,
        forceNoop: true
      }
    };

    // Use OAuth2 if available, otherwise use password
    if (config.xoauth2) {
      imapConfig.xoauth2 = config.xoauth2;
    } else if (config.password) {
      imapConfig.password = config.password;
    } else {
      throw new ImapConnectionError('No authentication method provided', 'AUTH_MISSING');
    }

    this.imap = new Imap(imapConfig);

    this._setupEventHandlers();
  }

  private _setupEventHandlers(): void {
    this.imap.on('ready', () => {
      this.connected = true;
      this._logOperation('CONNECT', {
        raw: `Connection established for ${this.config.user}`,
        response: 'Connection established',
        parsed: {
          host: this.config.host,
          port: this.config.port,
          user: this.config.user
        }
      });
      this.emit('ready');
    });

    this.imap.on('error', (err: Error) => {
      this._logOperation('ERROR', {
        raw: `Error for ${this.config.user}: ${err.message}`,
        error: err.message,
        parsed: {
          code: (err as any).code,
          source: (err as any).source,
          user: this.config.user
        }
      }, 'error');
      this.emit('error', err);
    });

    this.imap.on('end', () => {
      this.connected = false;
      this.currentBox = null;
      this._logOperation('DISCONNECT', {
        raw: `Connection ended for ${this.config.user}`,
        response: 'Connection ended'
      });
      this.emit('end');
    });

    this.imap.on('close', (hadError: boolean) => {
      this.connected = false;
      this.currentBox = null;
      this._logOperation('CLOSE', {
        raw: `Connection closed for ${this.config.user}${hadError ? ' (with error)' : ''}`,
        response: hadError ? 'Connection closed with error' : 'Connection closed',
        parsed: { hadError, user: this.config.user }
      });
      this.emit('close', hadError);
    });
  }

  private _logOperation(
    command: string,
    data: Partial<{
      raw?: string;
      parsed?: any;
      response?: string;
      error?: string;
      duration?: number;
    }>,
    level: 'debug' | 'info' | 'warn' | 'error' = 'info'
  ): void {
    realTimeLogger.log(this.userId, {
      userId: this.userId,
      emailAccountId: this.emailAccountId,
      level,
      command,
      data
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.imap.end();
        reject(new ImapConnectionError('Connection timeout', 'ETIMEDOUT'));
      }, this.config.connTimeout || 10000);

      this.imap.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.imap.once('error', (err: Error) => {
        clearTimeout(timeout);
        reject(new ImapConnectionError(
          err.message,
          (err as any).code,
          (err as any).source
        ));
      });

      this.imap.connect();
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.connected) {
        resolve();
        return;
      }

      this.imap.once('close', () => {
        resolve();
      });

      this.imap.end();
    });
  }

  async listFolders(): Promise<ImapFolder[]> {
    if (!this.connected) {
      throw new ImapConnectionError('Not connected', 'NOT_CONNECTED');
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      this._logOperation('LIST', {
        raw: 'LIST "" "*"'
      }, 'debug');

      this.imap.getBoxes((err: Error | null, boxes: any) => {
        if (err) {
          this._logOperation('LIST', {
            error: err.message,
            duration: Date.now() - startTime
          }, 'error');
          reject(new ImapConnectionError('Failed to list folders', 'LIST_FAILED'));
          return;
        }

        const folders = this._parseBoxes(boxes);

        this._logOperation('LIST', {
          response: `Found ${folders.length} folders`,
          parsed: folders.map(f => f.name),
          duration: Date.now() - startTime
        }, 'debug');

        resolve(folders);
      });
    });
  }

  private _parseBoxes(boxes: any, parent?: string): ImapFolder[] {
    const folders: ImapFolder[] = [];

    for (const [name, box] of Object.entries(boxes)) {
      if (typeof box !== 'object' || !box) continue;

      const boxObj = box as any;
      const folder: ImapFolder = {
        name: parent ? `${parent}${boxObj.delimiter}${name}` : name,
        delimiter: boxObj.delimiter || '.',
        flags: boxObj.attribs
      };

      if (boxObj.children) {
        folder.children = this._parseBoxes(boxObj.children, folder.name);
      }

      folders.push(folder);
    }

    return folders;
  }

  async selectFolder(folderName: string): Promise<any> {
    if (!this.connected) {
      throw new ImapConnectionError('Not connected', 'NOT_CONNECTED');
    }

    return new Promise((resolve, reject) => {
      this.imap.openBox(folderName, false, (err: Error | null, box: any) => {
        if (err) {
          reject(new ImapConnectionError(`Failed to select folder: ${err.message}`, 'SELECT_FAILED'));
          return;
        }

        this.currentBox = folderName;

        resolve(box);
      });
    });
  }

  async search(criteria: any[]): Promise<number[]> {
    if (!this.connected || !this.currentBox) {
      throw new ImapConnectionError('Not connected or no folder selected', 'INVALID_STATE');
    }

    const searchAsync = promisify(this.imap.search.bind(this.imap));
    const startTime = Date.now();

    this._logOperation('SEARCH', {
      raw: `SEARCH ${criteria.join(' ')}`,
      parsed: { criteria }
    }, 'debug');

    try {
      const uids = await searchAsync(criteria);

      // Show first 5 and last 5 UIDs for better visibility
      let uidSample: number[] = [];
      if (Array.isArray(uids) && uids.length > 0) {
        if (uids.length <= 10) {
          uidSample = uids;
        } else {
          uidSample = [...uids.slice(0, 5), ...uids.slice(-5)];
        }
      }

      this._logOperation('SEARCH', {
        response: `Found ${uids.length} messages on ${this.config.user}`,
        parsed: {
          count: uids.length,
          uids: uidSample,
          email: this.config.user
        },
        duration: Date.now() - startTime
      });

      return uids;
    } catch (err: any) {
      this._logOperation('SEARCH', {
        error: err.message,
        duration: Date.now() - startTime
      }, 'error');
      throw new ImapConnectionError(`Search failed: ${err.message}`, 'SEARCH_FAILED');
    }
  }

  async fetch(uids: number | string | number[], options: any): Promise<ImapMessage[]> {
    if (!this.connected || !this.currentBox) {
      throw new ImapConnectionError('Not connected or no folder selected', 'INVALID_STATE');
    }

    return new Promise((resolve, reject) => {
      const messages: ImapMessage[] = [];
      const startTime = Date.now();

      this._logOperation('FETCH', {
        raw: `FETCH ${uids} (${Object.keys(options).join(' ')})`,
        parsed: { uids, options }
      }, 'debug');

      const fetch = this.imap.fetch(uids, options);

      fetch.on('message', (msg: any, _seqno: number) => {
        const message: Partial<ImapMessage> = {};

        msg.on('body', (stream: any, info: any) => {
          let buffer = '';
          stream.on('data', (chunk: any) => {
            buffer += chunk.toString('utf8');
          });
          stream.on('end', () => {
            if (info.which === 'HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)') {
              const headers = Imap.parseHeader(buffer);
              message.headers = {
                from: headers.from,
                to: headers.to,
                subject: headers.subject,
                date: headers.date,
                messageId: normalizeMessageIdArray(headers['message-id'])
              };
            } else {
              message.body = buffer;
            }
          });
        });

        msg.on('attributes', (attrs: any) => {
          message.uid = attrs.uid;
          message.flags = attrs.flags;
          message.date = attrs.date;
          message.size = attrs.size;
        });

        msg.on('end', () => {
          messages.push(message as ImapMessage);
        });
      });

      fetch.on('error', (err: Error) => {
        this._logOperation('FETCH', {
          error: err.message,
          duration: Date.now() - startTime
        }, 'error');
        reject(new ImapConnectionError(`Fetch failed: ${err.message}`, 'FETCH_FAILED'));
      });

      fetch.on('end', () => {
        this._logOperation('FETCH', {
          response: `Fetched ${messages.length} messages`,
          parsed: { count: messages.length },
          duration: Date.now() - startTime
        }, 'debug');
        resolve(messages);
      });
    });
  }

  async idle(): Promise<void> {
    if (!this.connected || !this.currentBox) {
      throw new ImapConnectionError('Not connected or no folder selected', 'INVALID_STATE');
    }

    this._logOperation('IDLE', {
      raw: 'IDLE',
      parsed: { folder: this.currentBox }
    }, 'debug');

    // IDLE is not in the types but is available
    (this.imap as any).idle();
  }

  stopIdle(): void {
    if (this.connected) {
      this._logOperation('IDLE', {
        response: 'DONE',
        parsed: { action: 'stopped' }
      }, 'debug');
      // IDLE stop is not in the types but is available
      (this.imap as any).idle?.stop?.();
    }
  }

  async append(messageData: string | Buffer, options: { mailbox: string; flags?: string[] }): Promise<void> {
    if (!this.connected) {
      throw new ImapConnectionError('Not connected', 'NOT_CONNECTED');
    }

    const startTime = Date.now();
    this._logOperation('APPEND', {
      raw: `APPEND ${options.mailbox}`,
      parsed: { mailbox: options.mailbox, flags: options.flags, size: messageData.length }
    }, 'debug');

    return new Promise((resolve, reject) => {
      this.imap.append(messageData, options, (err: Error) => {
        if (err) {
          this._logOperation('APPEND', {
            error: err.message,
            duration: Date.now() - startTime
          }, 'error');
          reject(new ImapConnectionError(`Append failed: ${err.message}`, 'APPEND_FAILED'));
        } else {
          this._logOperation('APPEND', {
            response: 'Message appended successfully',
            duration: Date.now() - startTime
          }, 'debug');
          resolve();
        }
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  getCurrentFolder(): string | null {
    return this.currentBox;
  }
}