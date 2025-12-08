import { WebSocketServer, WebSocket } from 'ws';
import { Server as HTTPServer } from 'http';
import { auth } from '../lib/auth';
import { realTimeLogger, RealTimeLogEntry } from '../lib/real-time-logger';
import { EventEmitter } from 'events';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  sessionId?: string;
  isAlive?: boolean;
  subscribedChannels?: Set<string>;
  connectionPath?: string; // Track which path client connected on (/ws or /ws/imap-logs)
}

export type EventType =
  | 'log'           // General log entries (IMAP, jobs, monitoring, etc.)
  | 'new-log'       // Legacy: log entry for /ws/imap-logs clients
  | 'job-event'     // Job state changes
  | 'ping'          // Keep-alive
  | 'pong'          // Keep-alive response
  | 'subscribe'     // Subscribe to specific channels
  | 'unsubscribe'   // Unsubscribe from channels
  | 'clear-logs'    // Clear log history
  | 'get-logs'      // Legacy: request logs (for /ws/imap-logs clients)
  | 'logs'          // Legacy: response to get-logs
  | 'initial-logs'  // Initial log dump on connection
  | 'logs-cleared'  // Logs were cleared notification
  | 'error';        // Error messages

export interface WebSocketMessage {
  type: EventType;
  channel?: string;
  data?: any;
  log?: RealTimeLogEntry;
  logs?: RealTimeLogEntry[];
  error?: string;
  timestamp?: string;
}

export class UnifiedWebSocketServer extends EventEmitter {
  private wss!: WebSocketServer;
  private clients: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  private heartbeatInterval!: NodeJS.Timeout;
  private static instance: UnifiedWebSocketServer;

  constructor(server: HTTPServer) {
    super();
    
    // Singleton pattern
    if (UnifiedWebSocketServer.instance) {
      return UnifiedWebSocketServer.instance;
    }
    
    this.wss = new WebSocketServer({
      noServer: true
    });
    
    // Handle upgrade requests for WebSocket paths
    // Supports both /ws (unified) and /ws/imap-logs (legacy) for backwards compatibility
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

      if (pathname === '/ws' || pathname === '/ws/imap-logs') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          // Track which path the client connected on
          (ws as AuthenticatedWebSocket).connectionPath = pathname;
          this.wss.emit('connection', ws, request);
        });
      }
    });

    this._setupEventHandlers();
    this._setupHeartbeat();
    this._setupLoggerListeners();
    
    UnifiedWebSocketServer.instance = this;
  }

  private _setupEventHandlers(): void {
    this.wss.on('connection', async (ws: AuthenticatedWebSocket, request) => {
      try {
        // Create headers object for better-auth
        const headers = new Headers();
        Object.entries(request.headers).forEach(([key, value]) => {
          if (value) {
            headers.set(key, Array.isArray(value) ? value[0] : value);
          }
        });

        // Verify session with better-auth
        const session = await auth.api.getSession({ headers });
        
        let userId: string;
        let sessionId: string;
        
        if (!session) {
          // For development, allow unauthenticated connections with a warning
          console.warn('WebSocket connection without authentication - allowing for development');
          userId = 'anonymous';
          sessionId = 'anonymous';
        } else {
          userId = session.user.id;
          sessionId = session.session.id;
        }

        // Set up the authenticated websocket
        ws.userId = userId;
        ws.sessionId = sessionId;
        ws.isAlive = true;
        // Only set up subscriptions for /ws clients (not legacy /ws/imap-logs)
        if (ws.connectionPath !== '/ws/imap-logs') {
          ws.subscribedChannels = new Set(['all']); // Subscribe to all events by default
        }

        // Add to clients map
        if (!this.clients.has(userId)) {
          this.clients.set(userId, new Set());
        }
        this.clients.get(userId)!.add(ws);
        
        // Send initial logs
        this._sendInitialLogs(ws, userId);

        // Set up ping/pong handlers
        ws.on('pong', () => {
          ws.isAlive = true;
        });

        // Handle messages from client
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString()) as WebSocketMessage;
            this._handleClientMessage(ws, message);
          } catch (error) {
            console.error('Invalid WebSocket message:', error);
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Invalid message format'
            }));
          }
        });

        // Handle disconnection
        ws.on('close', () => {
          this._handleDisconnection(ws);
        });

        ws.on('error', (error) => {
          console.error(`WebSocket error for user ${userId}:`, error);
          this._handleDisconnection(ws);
        });
      } catch (error) {
        console.error('WebSocket authentication error:', error);
        ws.close(1008, 'Authentication error');
      }
    });
  }

  private _setupHeartbeat(): void {
    // Ping clients every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (ws.isAlive === false) {
          ws.terminate();
          return;
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    // Clean up on server shutdown
    this.wss.on('close', () => {
      clearInterval(this.heartbeatInterval);
    });
  }

  private _setupLoggerListeners(): void {
    // Listen for all log events from realTimeLogger
    realTimeLogger.on('log', (logEntry: RealTimeLogEntry) => {
      this._broadcastToUser(logEntry.userId, {
        type: 'log',
        log: logEntry,
        timestamp: new Date().toISOString()
      });
    });

    // Listen for logs cleared events
    realTimeLogger.on('logs-cleared', ({ userId }: { userId: string }) => {
      this._broadcastToUser(userId, {
        type: 'logs-cleared',
        timestamp: new Date().toISOString()
      });
    });
  }

  private _sendInitialLogs(ws: AuthenticatedWebSocket, userId: string): void {
    try {
      const logs = realTimeLogger.getLogs(userId, 100);
      // Legacy clients don't expect timestamps
      const message = ws.connectionPath === '/ws/imap-logs'
        ? { type: 'initial-logs', logs }
        : { type: 'initial-logs', logs, timestamp: new Date().toISOString() };
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending initial logs:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to load initial logs'
      }));
    }
  }

  private _handleClientMessage(ws: AuthenticatedWebSocket, message: WebSocketMessage): void {
    const { type, ...payload } = message;

    switch (type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;

      case 'clear-logs':
        if (ws.userId) {
          realTimeLogger.clearLogs(ws.userId);
        }
        break;

      case 'subscribe':
        if (payload.channel && ws.subscribedChannels) {
          ws.subscribedChannels.add(payload.channel);
        }
        break;

      case 'unsubscribe':
        if (payload.channel && ws.subscribedChannels) {
          ws.subscribedChannels.delete(payload.channel);
        }
        break;

      case 'get-logs':
        // Legacy support for /ws/imap-logs clients
        if (ws.userId) {
          const limit = (payload as any).limit || 100;
          const logs = realTimeLogger.getLogs(ws.userId, limit);
          ws.send(JSON.stringify({
            type: 'logs',
            data: logs
          }));
        }
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${type}`
        }));
    }
  }

  private _handleDisconnection(ws: AuthenticatedWebSocket): void {
    if (ws.userId) {
      const userClients = this.clients.get(ws.userId);
      if (userClients) {
        userClients.delete(ws);
        if (userClients.size === 0) {
          this.clients.delete(ws.userId);
        }
      }
      console.log(`WebSocket client disconnected for user ${ws.userId}`);
    }
  }

  private _broadcastToUser(userId: string, message: WebSocketMessage): void {
    const userClients = this.clients.get(userId);
    if (!userClients) return;

    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        // For legacy /ws/imap-logs clients, use different message format
        if (client.connectionPath === '/ws/imap-logs') {
          // Convert 'log' to 'new-log' and strip timestamp for legacy clients
          const legacyMessage = { ...message };
          if (legacyMessage.type === 'log') {
            legacyMessage.type = 'new-log';
          }
          delete legacyMessage.timestamp;
          client.send(JSON.stringify(legacyMessage));
        } else {
          // Check if client is subscribed to this type of message
          if (message.channel && client.subscribedChannels) {
            if (!client.subscribedChannels.has('all') &&
                !client.subscribedChannels.has(message.channel)) {
              return; // Skip if not subscribed
            }
          }
          client.send(JSON.stringify(message));
        }
      }
    });
  }

  /**
   * Broadcast a message to all connected clients of a user
   */
  public broadcast(userId: string, message: WebSocketMessage): void {
    this._broadcastToUser(userId, message);
  }

  /**
   * Broadcast a job event
   */
  public broadcastJobEvent(event: any): void {
    if (event.userId) {
      this._broadcastToUser(event.userId, {
        type: 'job-event',
        channel: 'jobs',
        data: event,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): UnifiedWebSocketServer | null {
    return UnifiedWebSocketServer.instance || null;
  }

  /**
   * Gracefully shutdown the WebSocket server
   */
  public close(): Promise<void> {
    return new Promise((resolve) => {
      clearInterval(this.heartbeatInterval);
      
      // Close all client connections
      this.wss.clients.forEach((client) => {
        client.close(1001, 'Server shutting down');
      });

      this.wss.close(() => {
        console.log('Unified WebSocket server closed');
        resolve();
      });
    });
  }
}

// Singleton instance
let wsServerInstance: UnifiedWebSocketServer | null = null;

/**
 * Create and attach unified WebSocket server to HTTP server
 */
export function createUnifiedWebSocketServer(server: HTTPServer): UnifiedWebSocketServer {
  wsServerInstance = new UnifiedWebSocketServer(server);
  return wsServerInstance;
}

/**
 * Get the singleton WebSocket server instance
 */
export function getUnifiedWebSocketServer(): UnifiedWebSocketServer | null {
  return wsServerInstance;
}