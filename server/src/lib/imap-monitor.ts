/**
 * IMAP Monitoring Service
 * Implements real-time email monitoring using IMAP IDLE
 * Handles multiple accounts, reconnection, and queuing of new emails
 */

import { EventEmitter } from 'events';
import { ImapOperations } from './imap-operations';
import { addInboxJob, JobPriority } from './queue';
import { pool } from './db';
import { realTimeLogger } from './real-time-logger';

// Monitoring configuration
interface MonitorConfig {
  reconnectDelay?: number;       // Delay before reconnection attempt (ms)
  maxReconnectAttempts?: number; // Maximum reconnection attempts
  heartbeatInterval?: number;    // Interval to check connection health (ms)
  idleTimeout?: number;          // Timeout for IDLE connection (ms)
}

// Monitor status for each account
interface MonitorStatus {
  accountId: string;
  status: 'connected' | 'disconnected' | 'reconnecting' | 'error';
  lastConnected?: Date;
  lastError?: string;
  reconnectAttempts: number;
  messagesProcessed: number;
}

// Event types emitted by the monitor (for documentation purposes)
// interface MonitorEvents {
//   'email:new': (accountId: string, count: number) => void;
//   'email:queued': (accountId: string, jobId: string) => void;
//   'connection:established': (accountId: string) => void;
//   'connection:lost': (accountId: string, error: Error) => void;
//   'connection:reconnecting': (accountId: string, attempt: number) => void;
//   'error': (accountId: string, error: Error) => void;
// }

export class ImapMonitor extends EventEmitter {
  private monitors: Map<string, MonitorInstance> = new Map();
  private config: Required<MonitorConfig>;

  constructor(config: MonitorConfig = {}) {
    super();
    this.config = {
      reconnectDelay: config.reconnectDelay ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      heartbeatInterval: config.heartbeatInterval ?? 60000,
      idleTimeout: config.idleTimeout ?? 29 * 60 * 1000 // 29 minutes
    };
  }

  /**
   * Start monitoring an email account
   */
  async startMonitoring(accountId: string, userId: string): Promise<void> {
    if (this.monitors.has(accountId)) {
      console.log(`Already monitoring account ${accountId}`);
      return;
    }

    const monitor = new MonitorInstance(
      accountId,
      userId,
      this.config,
      this
    );

    this.monitors.set(accountId, monitor);
    await monitor.start();
  }

  /**
   * Stop monitoring an email account
   */
  async stopMonitoring(accountId: string): Promise<void> {
    const monitor = this.monitors.get(accountId);
    if (monitor) {
      await monitor.stop();
      this.monitors.delete(accountId);
    }
  }

  /**
   * Stop monitoring all accounts
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.monitors.values()).map(
      monitor => monitor.stop()
    );
    await Promise.all(stopPromises);
    this.monitors.clear();
  }

  /**
   * Get status of all monitored accounts
   */
  getStatus(): MonitorStatus[] {
    return Array.from(this.monitors.values()).map(
      monitor => monitor.getStatus()
    );
  }

  /**
   * Get status of a specific account
   */
  getAccountStatus(accountId: string): MonitorStatus | undefined {
    const monitor = this.monitors.get(accountId);
    return monitor?.getStatus();
  }

  /**
   * Check if an account is being monitored
   */
  isMonitoring(accountId: string): boolean {
    return this.monitors.has(accountId);
  }

  /**
   * Get number of monitored accounts
   */
  getMonitoredAccountCount(): number {
    return this.monitors.size;
  }
}

/**
 * Individual monitor instance for each email account
 */
class MonitorInstance {
  private accountId: string;
  private userId: string;
  private config: Required<MonitorConfig>;
  private parent: ImapMonitor;
  private operations: ImapOperations | null = null;
  private status: MonitorStatus;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private isReconnecting: boolean = false;

  constructor(
    accountId: string,
    userId: string,
    config: Required<MonitorConfig>,
    parent: ImapMonitor
  ) {
    this.accountId = accountId;
    this.userId = userId;
    this.config = config;
    this.parent = parent;
    this.status = {
      accountId,
      status: 'disconnected',
      reconnectAttempts: 0,
      messagesProcessed: 0
    };
  }

  /**
   * Start monitoring this account
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    await this.connect();
  }

  /**
   * Connect to IMAP server and start IDLE
   */
  private async connect(): Promise<void> {
    try {
      console.log(`Connecting to IMAP for account ${this.accountId}`);

      // Create new ImapOperations instance
      // NOTE: We intentionally do NOT use withImapContext() here because this is a
      // long-running connection that stays open for IDLE monitoring. The connection
      // lifecycle is managed explicitly by this monitor class (connect/stop/release).
      // This is different from route handlers which use withImapContext() for
      // automatic connection management scoped to a single request.
      this.operations = await ImapOperations.fromAccountId(
        this.accountId,
        this.userId
      );

      // Test connection
      const connected = await this.operations.testConnection(true);
      if (!connected) {
        throw new Error('Failed to connect to IMAP server');
      }

      // Start IDLE monitoring
      await this.operations.startIdleMonitoring('INBOX', async (event) => {
        await this.handleImapEvent(event);
      });

      // Update status
      this.status.status = 'connected';
      this.status.lastConnected = new Date();
      this.status.reconnectAttempts = 0;

      // Start heartbeat
      this.startHeartbeat();

      // Start IDLE timeout timer
      this.resetIdleTimer();

      // Emit connection established event
      this.parent.emit('connection:established', this.accountId);
      
      // Log to IMAP logger
      realTimeLogger.log(this.userId, {
        userId: this.userId,
        emailAccountId: this.accountId,
        level: 'info',
        command: 'MONITOR_CONNECTED',
        data: { parsed: { status: 'connected' } }
      });

      console.log(`IMAP monitoring started for account ${this.accountId}`);
      
    } catch (error: unknown) {
      console.error(`Failed to connect IMAP for account ${this.accountId}:`, error);
      
      this.status.status = 'error';
      this.status.lastError = error instanceof Error ? error.message : String(error);
      
      // Emit error event
      this.parent.emit('connection:lost', this.accountId, error as Error);
      
      // Log error
      realTimeLogger.log(this.userId, {
        userId: this.userId,
        emailAccountId: this.accountId,
        level: 'error',
        command: 'MONITOR_ERROR',
        data: { 
          error: error instanceof Error ? error.message : String(error),
          parsed: { status: 'error' }
        }
      });

      // Attempt reconnection
      await this.scheduleReconnect();
    }
  }

  /**
   * Handle IMAP events (new mail, expunge, etc.)
   */
  private async handleImapEvent(event: any): Promise<void> {
    try {
      if (event.type === 'new_mail') {
        console.log(`New mail detected for account ${this.accountId}: ${event.count} messages`);
        
        // Emit new email event
        this.parent.emit('email:new', this.accountId, event.count);
        
        // Queue new emails for processing
        await this.queueNewEmails(event.count);
        
        // Update statistics
        this.status.messagesProcessed += event.count;
        
        // Log event
        realTimeLogger.log(this.userId, {
          userId: this.userId,
          emailAccountId: this.accountId,
          level: 'info',
          command: 'NEW_MAIL_DETECTED',
          data: { parsed: { count: event.count } }
        });
      } else if (event.type === 'expunge') {
        console.log(`Message expunged for account ${this.accountId}: seqno ${event.seqno}`);
      }
      
      // Reset IDLE timer on any activity
      this.resetIdleTimer();
      
    } catch (error: unknown) {
      console.error(`Error handling IMAP event for account ${this.accountId}:`, error);
      this.parent.emit('error', this.accountId, error as Error);
    }
  }

  /**
   * Queue new emails for processing
   */
  private async queueNewEmails(count: number): Promise<void> {
    try {
      if (!this.operations) {
        throw new Error('IMAP operations not initialized');
      }

      // Get the UIDs of new messages
      const messages = await this.operations.searchMessages(
        'INBOX',
        { unseen: true },
        { limit: count, preserveConnection: true }
      );

      // Queue each message for processing
      // Note: Job ID deduplication means if scheduler already queued this account,
      // we'll get the existing job back instead of creating a duplicate
      for (const message of messages) {
        const job = await addInboxJob(
          {
            userId: this.userId,
            accountId: this.accountId,
            folderName: 'INBOX'
          },
          JobPriority.HIGH,
          { force: false }  // Don't override existing jobs
        );

        const jobState = await job.getState();
        if (jobState === 'waiting' || jobState === 'active') {
          console.log(`[IMAP] Email UID ${message.uid} - job ${job.id} already ${jobState}`);
        } else {
          console.log(`[IMAP] Queued email UID ${message.uid} for processing (job ${job.id})`);
        }

        // Emit queued event
        this.parent.emit('email:queued', this.accountId, job.id!);
      }

      // Update last sync time
      await pool.query(
        'UPDATE email_accounts SET last_sync = CURRENT_TIMESTAMP WHERE id = $1',
        [this.accountId]
      );
      
    } catch (error: unknown) {
      console.error(`Error queueing emails for account ${this.accountId}:`, error);
      throw error;
    }
  }

  /**
   * Start heartbeat to check connection health
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(async () => {
      if (!this.operations || !this.isRunning) {
        return;
      }

      try {
        // Test connection is still alive
        const alive = await this.operations.testConnection(true);
        if (!alive) {
          throw new Error('Connection test failed');
        }
      } catch (error: unknown) {
        console.error(`Heartbeat failed for account ${this.accountId}:`, error);
        await this.handleConnectionLoss(error as Error);
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Reset IDLE timer (IDLE connections timeout after 29 minutes typically)
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(async () => {
      console.log(`IDLE timeout for account ${this.accountId}, reconnecting...`);
      await this.reconnect();
    }, this.config.idleTimeout);
  }

  /**
   * Handle connection loss
   */
  private async handleConnectionLoss(error: Error): Promise<void> {
    this.status.status = 'disconnected';
    this.status.lastError = error.message;
    
    // Stop monitoring
    this.stopHeartbeat();
    
    // Release connection
    if (this.operations) {
      this.operations.stopIdleMonitoring();
      this.operations.release();
      this.operations = null;
    }

    // Emit connection lost event
    this.parent.emit('connection:lost', this.accountId, error);
    
    // Schedule reconnection
    await this.scheduleReconnect();
  }

  /**
   * Schedule reconnection attempt
   */
  private async scheduleReconnect(): Promise<void> {
    if (!this.isRunning || this.isReconnecting) {
      return;
    }

    if (this.status.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(`Max reconnection attempts reached for account ${this.accountId}`);
      this.status.status = 'error';
      this.status.lastError = 'Max reconnection attempts reached';
      return;
    }

    this.isReconnecting = true;
    this.status.status = 'reconnecting';
    this.status.reconnectAttempts++;
    
    const delay = this.config.reconnectDelay * Math.pow(2, Math.min(this.status.reconnectAttempts - 1, 5));
    
    console.log(`Scheduling reconnection for account ${this.accountId} (attempt ${this.status.reconnectAttempts}) in ${delay}ms`);
    
    // Emit reconnecting event
    this.parent.emit('connection:reconnecting', this.accountId, this.status.reconnectAttempts);
    
    this.reconnectTimer = setTimeout(async () => {
      this.isReconnecting = false;
      await this.connect();
    }, delay);
  }

  /**
   * Reconnect to IMAP server
   */
  private async reconnect(): Promise<void> {
    console.log(`Reconnecting IMAP for account ${this.accountId}`);
    
    // Clean up existing connection
    if (this.operations) {
      this.operations.stopIdleMonitoring();
      this.operations.release();
      this.operations = null;
    }

    // Clear timers
    this.stopHeartbeat();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // Reconnect
    await this.connect();
  }

  /**
   * Stop monitoring this account
   */
  async stop(): Promise<void> {
    console.log(`Stopping IMAP monitoring for account ${this.accountId}`);
    
    this.isRunning = false;
    
    // Clear all timers
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // Stop IDLE and release connection
    if (this.operations) {
      this.operations.stopIdleMonitoring();
      this.operations.release();
      this.operations = null;
    }

    this.status.status = 'disconnected';
    
    console.log(`IMAP monitoring stopped for account ${this.accountId}`);
  }

  /**
   * Get current status
   */
  getStatus(): MonitorStatus {
    return { ...this.status };
  }
}

// Export singleton instance
export const imapMonitor = new ImapMonitor();

// Handle process termination
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, stopping IMAP monitors...');
  await imapMonitor.stopAll();
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, stopping IMAP monitors...');
  await imapMonitor.stopAll();
});