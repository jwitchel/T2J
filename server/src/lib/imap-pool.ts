import { ImapConnection, ImapConfig, ImapConnectionError } from './imap-connection';
import { EventEmitter } from 'events';
import { realTimeLogger } from './real-time-logger';

interface PooledConnection {
  connection: ImapConnection;
  accountId: string;
  inUse: boolean;
  lastUsed: Date;
  userId: string;
}

export interface ImapPoolOptions {
  maxConnections?: number;
  minConnections?: number;
  idleTimeout?: number; // ms before closing idle connections
  connectionTimeout?: number; // ms to wait for connection
  retryAttempts?: number;
  retryDelay?: number; // ms between retries
}

export class ImapConnectionPool extends EventEmitter {
  private connections: Map<string, PooledConnection[]> = new Map();
  private options: Required<ImapPoolOptions>;

  constructor(options: ImapPoolOptions = {}) {
    super();
    this.options = {
      maxConnections: options.maxConnections || 5,
      minConnections: options.minConnections || 1,
      idleTimeout: options.idleTimeout || 300000, // 5 minutes
      connectionTimeout: options.connectionTimeout || 30000, // 30 seconds
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000 // 1 second
    };

    // Start idle connection cleanup
    this._startIdleCleanup();
  }

  private _getPoolKey(userId: string, accountId: string): string {
    return `${userId}:${accountId}`;
  }

  async getConnection(
    config: ImapConfig,
    userId: string,
    accountId: string
  ): Promise<ImapConnection> {
    const poolKey = this._getPoolKey(userId, accountId);
    
    // Log pool stats before getting connection
    const stats = this.getPoolStats();
    if (stats.totalConnections > 10) {
      console.warn(`⚠️ High connection count: ${stats.totalConnections} total, ${stats.activeConnections} active`);
    }
    
    // Try to find an available connection
    const pool = this.connections.get(poolKey) || [];
    const available = pool.find(p => !p.inUse && p.connection.isConnected());

    if (available) {
      available.inUse = true;
      available.lastUsed = new Date();
      this._logPoolEvent('connection_reused', userId, accountId, {
        poolSize: pool.length,
        inUse: pool.filter(p => p.inUse).length
      });
      return available.connection;
    }

    // Check if we can create a new connection
    if (pool.length < this.options.maxConnections) {
      const connection = await this._createConnection(config, userId, accountId);
      const pooled: PooledConnection = {
        connection,
        accountId,
        inUse: true,
        lastUsed: new Date(),
        userId
      };

      pool.push(pooled);
      this.connections.set(poolKey, pool);

      this._logPoolEvent('connection_created', userId, accountId, {
        poolSize: pool.length,
        inUse: pool.filter(p => p.inUse).length
      });

      return connection;
    }

    // Wait for a connection to become available
    return this._waitForConnection(poolKey, config, userId, accountId);
  }

  private async _createConnection(
    config: ImapConfig,
    userId: string,
    accountId: string
  ): Promise<ImapConnection> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
      try {
        const connection = new ImapConnection(config, userId, accountId);
        
        // Set up connection event handlers
        connection.on('error', (err) => {
          this._logPoolEvent('connection_error', userId, accountId, {
            error: err.message,
            attempt
          });
        });

        connection.on('close', (hadError) => {
          this._handleConnectionClose(userId, accountId, connection, hadError);
        });

        await connection.connect();
        return connection;
      } catch (err) {
        lastError = err as Error;

        this._logPoolEvent('connection_failed', userId, accountId, {
          error: lastError.message,
          attempt,
          willRetry: attempt < this.options.retryAttempts
        });

        if (attempt < this.options.retryAttempts) {
          await this._delay(this.options.retryDelay * attempt); // Exponential backoff
        }
      }
    }

    throw new ImapConnectionError(
      `Failed to connect after ${this.options.retryAttempts} attempts: ${lastError?.message}`,
      'CONNECTION_FAILED'
    );
  }

  private async _waitForConnection(
    poolKey: string,
    _config: ImapConfig,
    _userId: string,
    _accountId: string
  ): Promise<ImapConnection> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.options.connectionTimeout) {
      const pool = this.connections.get(poolKey) || [];
      const available = pool.find(p => !p.inUse && p.connection.isConnected());

      if (available) {
        available.inUse = true;
        available.lastUsed = new Date();
        return available.connection;
      }

      // Wait a bit before checking again
      await this._delay(100);
    }

    throw new ImapConnectionError(
      'Connection timeout - no available connections in pool',
      'POOL_TIMEOUT'
    );
  }

  releaseConnection(connection: ImapConnection, userId: string, accountId: string): void {
    const poolKey = this._getPoolKey(userId, accountId);
    const pool = this.connections.get(poolKey) || [];
    const pooled = pool.find(p => p.connection === connection);

    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = new Date();

      this._logPoolEvent('connection_released', userId, accountId, {
        poolSize: pool.length,
        inUse: pool.filter(p => p.inUse).length
      });
    }
  }

  private _handleConnectionClose(
    userId: string,
    accountId: string,
    connection: ImapConnection,
    hadError: boolean
  ): void {
    const poolKey = this._getPoolKey(userId, accountId);
    const pool = this.connections.get(poolKey) || [];
    const index = pool.findIndex(p => p.connection === connection);

    if (index !== -1) {
      pool.splice(index, 1);
      
      if (pool.length === 0) {
        this.connections.delete(poolKey);
      } else {
        this.connections.set(poolKey, pool);
      }

      this._logPoolEvent('connection_removed', userId, accountId, {
        poolSize: pool.length,
        hadError
      });
    }
  }

  private _startIdleCleanup(): void {
    setInterval(() => {
      const now = new Date();

      for (const [poolKey, pool] of this.connections) {
        const toRemove: PooledConnection[] = [];

        for (const pooled of pool) {
          if (!pooled.inUse && 
              now.getTime() - pooled.lastUsed.getTime() > this.options.idleTimeout &&
              pool.filter(p => !p.inUse).length > this.options.minConnections) {
            toRemove.push(pooled);
          }
        }

        for (const pooled of toRemove) {
          pooled.connection.disconnect().catch(() => {
            // Ignore disconnect errors
          });
          
          const index = pool.indexOf(pooled);
          if (index !== -1) {
            pool.splice(index, 1);
          }

          this._logPoolEvent('connection_idle_closed', pooled.userId, pooled.accountId, {
            idleTime: now.getTime() - pooled.lastUsed.getTime()
          });
        }

        if (pool.length === 0) {
          this.connections.delete(poolKey);
        }
      }
    }, 60000); // Check every minute
  }

  async closeAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [_, pool] of this.connections) {
      for (const pooled of pool) {
        promises.push(pooled.connection.disconnect());
      }
    }

    await Promise.allSettled(promises);
    this.connections.clear();

    this._logPoolEvent('pool_closed', '', '', {
      totalClosed: promises.length
    });
  }

  getPoolStats(): {
    totalConnections: number;
    activeConnections: number;
    pooledAccounts: number;
  } {
    let totalConnections = 0;
    let activeConnections = 0;

    for (const [_, pool] of this.connections) {
      totalConnections += pool.length;
      activeConnections += pool.filter(p => p.inUse).length;
    }

    return {
      totalConnections,
      activeConnections,
      pooledAccounts: this.connections.size
    };
  }

  private _delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private _logPoolEvent(
    event: string,
    userId: string,
    accountId: string,
    data: any
  ): void {
    if (userId && accountId) {
      realTimeLogger.log(userId, {
        userId,
        emailAccountId: accountId,
        level: 'debug',
        channel: 'imap',
        command: `POOL_${event.toUpperCase()}`,
        data: { parsed: data }
      });
    }
  }
}

// Export singleton instance
export const imapPool = new ImapConnectionPool();