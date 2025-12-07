import { WebSocketServer, WebSocket } from 'ws';
import { Server as HTTPServer } from 'http';
import { auth } from '../lib/auth';
import { realTimeLogger, RealTimeLogEntry } from '../lib/real-time-logger';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  sessionId?: string;
  isAlive?: boolean;
}

export class ImapLogsWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  private heartbeatInterval!: NodeJS.Timeout;

  constructor(server: HTTPServer) {
    this.wss = new WebSocketServer({
      noServer: true
    });
    
    // Handle upgrade requests for this specific path
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;
      
      if (pathname === '/ws/imap-logs') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      }
    });

    this._setupEventHandlers();
    this._setupHeartbeat();
    this._setupRealTimeLoggerListeners();
  }

  private _setupEventHandlers(): void {
    this.wss.on('connection', async (ws: AuthenticatedWebSocket, request) => {
      // Perform authentication check
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
          console.warn('IMAP logs WebSocket connection without authentication - allowing for development');
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

        // Add to clients map
        if (!this.clients.has(userId)) {
          this.clients.set(userId, new Set());
        }
        this.clients.get(userId)!.add(ws);

        console.log(`WebSocket client connected for user ${userId}`);

        // Send initial logs (last 100)
        this._sendInitialLogs(ws, userId);

        // Set up ping/pong handlers
        ws.on('pong', () => {
          ws.isAlive = true;
        });

        // Handle messages from client
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
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

  private _setupRealTimeLoggerListeners(): void {
    // Listen for all log events
    realTimeLogger.on('log', (logEntry: RealTimeLogEntry) => {
      this._broadcastToUser(logEntry.userId, {
        type: 'new-log',  // Changed from 'log' to 'new-log' to match client
        log: logEntry     // Changed from 'data' to 'log' to match client
      });
    });

    // Listen for logs cleared events
    realTimeLogger.on('logs-cleared', ({ userId }: { userId: string }) => {
      this._broadcastToUser(userId, {
        type: 'logs-cleared'
      });
    });
  }

  private _sendInitialLogs(ws: AuthenticatedWebSocket, userId: string): void {
    try {
      const logs = realTimeLogger.getLogs(userId, 100);
      ws.send(JSON.stringify({
        type: 'initial-logs',
        logs: logs  // Changed from 'data' to 'logs' to match client expectation
      }));
    } catch (error) {
      console.error('Error sending initial logs:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Failed to load initial logs'
      }));
    }
  }

  private _handleClientMessage(ws: AuthenticatedWebSocket, message: any): void {
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

      case 'get-logs':
        if (ws.userId) {
          const limit = payload.limit || 100;
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

  private _broadcastToUser(userId: string, message: any): void {
    const userClients = this.clients.get(userId);
    if (!userClients) return;

    const messageStr = JSON.stringify(message);
    userClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
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
        console.log('WebSocket server closed');
        resolve();
      });
    });
  }
}

/**
 * Create and attach WebSocket server to HTTP server
 */
export function createImapLogsWebSocketServer(server: HTTPServer): ImapLogsWebSocketServer {
  return new ImapLogsWebSocketServer(server);
}