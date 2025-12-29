import { EventEmitter } from 'events';
import crypto from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogChannel = 'training' | 'jobs' | 'imap' | 'system';

export interface RealTimeLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  emailAccountId: string;
  level: LogLevel;
  command: string;
  channel?: LogChannel;
  data: {
    raw?: string;
    parsed?: any;
    response?: string;
    duration?: number;
    error?: string;
  };
}

export interface RealTimeLoggerOptions {
  maxLogsPerUser?: number;
  logLevel?: LogLevel;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

export class RealTimeLogger extends EventEmitter {
  private logs: Map<string, RealTimeLogEntry[]> = new Map();
  private maxLogsPerUser: number;
  private logLevel: LogLevel;

  constructor(options: RealTimeLoggerOptions = {}) {
    super();
    this.maxLogsPerUser = options.maxLogsPerUser || 1000;
    this.logLevel = options.logLevel || 'info';
  }

  /**
   * Log an IMAP operation
   */
  log(userId: string, entry: Omit<RealTimeLogEntry, 'id' | 'timestamp'>): void {
    // Check if we should log based on level
    if (LOG_LEVELS[entry.level] < LOG_LEVELS[this.logLevel]) {
      return;
    }

    // Format timestamp without milliseconds: "2025-01-11T10:16:42Z"
    const now = new Date();
    const timestamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

    const logEntry: RealTimeLogEntry = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp
    };

    // Sanitize the log entry
    const sanitizedEntry = this._sanitizeLogEntry(logEntry);

    // Store the log
    if (!this.logs.has(userId)) {
      this.logs.set(userId, []);
    }

    const userLogs = this.logs.get(userId)!;
    userLogs.push(sanitizedEntry);

    // Maintain circular buffer
    if (userLogs.length > this.maxLogsPerUser) {
      userLogs.shift();
    }

    // Emit the log event
    this.emit('log', sanitizedEntry);
    this.emit(`log:${userId}`, sanitizedEntry);
  }

  /**
   * Get logs for a specific user
   */
  getLogs(userId: string, limit?: number): RealTimeLogEntry[] {
    const userLogs = this.logs.get(userId) || [];
    if (limit && limit > 0) {
      return userLogs.slice(-limit);
    }
    return [...userLogs];
  }

  /**
   * Clear logs for a specific user
   */
  clearLogs(userId: string): void {
    this.logs.delete(userId);
    this.emit('logs-cleared', { userId });
  }

  /**
   * Get the number of logs for a user
   */
  getLogCount(userId: string): number {
    return this.logs.get(userId)?.length || 0;
  }

  /**
   * Sanitize log entry to remove sensitive information
   */
  private _sanitizeLogEntry(entry: RealTimeLogEntry): RealTimeLogEntry {
    const sanitized = { ...entry };

    if (sanitized.data.raw) {
      sanitized.data.raw = this._sanitizeString(sanitized.data.raw);
    }

    if (sanitized.data.response) {
      sanitized.data.response = this._sanitizeString(sanitized.data.response);
    }

    if (sanitized.data.parsed) {
      sanitized.data.parsed = this._sanitizeObject(sanitized.data.parsed);
    }

    return sanitized;
  }

  /**
   * Sanitize a string to remove passwords and sensitive data
   */
  private _sanitizeString(str: string): string {
    // Replace passwords in LOGIN commands
    let sanitized = str.replace(
      /(\bLOGIN\s+[^\s]+\s+)([^\s]+)/gi,
      '$1****'
    );

    // Replace passwords in AUTHENTICATE commands
    sanitized = sanitized.replace(
      /(\bAUTHENTICATE\s+[^\s]+\s+)([^\s]+)/gi,
      '$1****'
    );

    // Replace base64 encoded passwords
    sanitized = sanitized.replace(
      /(\bAUTH[=\s]+)([A-Za-z0-9+/]+=*)/g,
      '$1****'
    );

    // Mask email message content in FETCH responses
    sanitized = sanitized.replace(
      /(\* \d+ FETCH \(.*BODY\[.*\] \{[\d]+\})[\s\S]*?(\))/g,
      '$1\n[MESSAGE CONTENT REDACTED]\n$2'
    );

    return sanitized;
  }

  /**
   * Sanitize an object recursively
   */
  private _sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this._sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact password fields
      if (key.toLowerCase().includes('password') ||
          key.toLowerCase().includes('passwd') ||
          key.toLowerCase().includes('auth')) {
        sanitized[key] = '****';
      } else if (typeof value === 'string') {
        sanitized[key] = this._sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[key] = this._sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

// Create a singleton instance
export const realTimeLogger = new RealTimeLogger({
  maxLogsPerUser: parseInt(process.env.IMAP_MAX_LOGS_PER_USER || '1000'),
  logLevel: (process.env.IMAP_LOG_LEVEL as LogLevel) || 'info'
});