import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { toNodeHandler } from 'better-auth/node';
import { pool } from './lib/db';
import { auth } from './lib/auth';
import { createServer } from 'http';
import { createUnifiedWebSocketServer } from './websocket/unified-websocket';

// Load environment variables from root .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Validate required environment variables
if (!process.env.ENCRYPTION_KEY) {
  console.error('❌ ENCRYPTION_KEY environment variable is required');
  console.error('   Please set ENCRYPTION_KEY in your .env file');
  console.error('   Generate one with: openssl rand -base64 32');
  process.exit(1);
}

// SERVICE_TOKEN is loaded from .env for worker authentication

const app = express();
const PORT = process.env.PORT || 3002;

// Test database connection and initialize schedulers
async function initializeDatabase() {
  try {
    // Test PostgreSQL connection
    await pool.connect();
    console.log('✅ Connected to PostgreSQL');
    return true;
  } catch (err) {
    console.error('❌ Database initialization error:', err);
    return false;
  }
}

// Initialize schedulers for all users on startup
async function initializeSchedulers() {
  try {
    const { jobSchedulerManager } = await import('./lib/job-scheduler-manager');

    // Get all unique users with email accounts
    const result = await pool.query(
      'SELECT DISTINCT user_id FROM email_accounts'
    );

    console.log(`🔄 Initializing schedulers for ${result.rows.length} users...`);

    for (const row of result.rows) {
      try {
        await jobSchedulerManager.initializeUserSchedulers(row.user_id);
      } catch (error) {
        console.error(`Failed to initialize schedulers for user ${row.user_id}:`, error);
      }
    }

    console.log('✅ Schedulers initialized');
  } catch (error) {
    console.error('❌ Scheduler initialization error:', error);
  }
}

// Initialize database and schedulers on startup
initializeDatabase().then(() => {
  // Initialize schedulers after database is ready
  initializeSchedulers();
});

// CORS configuration for Next.js frontend
app.use(cors({
  origin: process.env.FRONTEND_URL!,
  credentials: true, // Enable cookies for sessions
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
}));

// Request logging middleware (suppress frequently polled endpoints)
app.use((req, _res, next) => {
  // Skip logging for polling endpoints to reduce console noise
  const skipPaths = ['/api/jobs/stats', '/health'];
  if (!skipPaths.includes(req.path)) {
    console.log(`${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })} - ${req.method} ${req.path}`);
  }
  next();
});

// Better Auth routes - handles /api/auth/signup, /api/auth/signin, etc.
// IMPORTANT: Don't use express.json() before better-auth
app.all('/api/auth/*', toNodeHandler(auth));

// Body parsing middleware (after better-auth)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Import and re-export auth middleware
import { requireAuth } from './middleware/auth';
export { requireAuth };

// API Routes
import authRoutes from './routes/auth';
import emailAccountRoutes from './routes/email-accounts';
import toneProfileRoutes from './routes/tone-profile';
import imapRoutes from './routes/imap';
import relationshipsRoutes from './routes/relationships';
import styleRoutes from './routes/style';
import llmProvidersRoutes from './routes/llm-providers';
import generateRoutes from './routes/generate';
import trainingRoutes from './routes/training';
import oauthEmailRoutes from './routes/oauth-email';
import oauthDirectRoutes from './routes/oauth-direct';
import accountsRoutes from './routes/accounts';
import signaturePatternsRoutes from './routes/signature-patterns';
import settingsRoutes from './routes/settings';
import inboxRoutes from './routes/inbox';
import inboxDraftRoutes from './routes/inbox-draft';
import monitoringRoutes from './routes/monitoring';
import queueRoutes from './routes/queue';
import imapMonitorRoutes from './routes/imap-monitor';
import jobsRoutes from './routes/jobs';
import workersRoutes from './routes/workers';
import schedulersRoutes from './routes/schedulers';
import dashboardAnalyticsRoutes from './routes/dashboard-analytics';

app.use('/api/custom-auth', authRoutes);
app.use('/api/email-accounts', emailAccountRoutes);
app.use('/api/tone-profile', toneProfileRoutes);
app.use('/api/imap', imapRoutes);
app.use('/api/relationships', relationshipsRoutes);
app.use('/', styleRoutes);
app.use('/api/llm-providers', llmProvidersRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/oauth-email', oauthEmailRoutes);
app.use('/api/oauth-direct', oauthDirectRoutes);
app.use('/api', accountsRoutes);
app.use('/api/signature-patterns', signaturePatternsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/inbox', inboxRoutes);
app.use('/api/inbox-draft', inboxDraftRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/imap-monitor', imapMonitorRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/workers', workersRoutes);
app.use('/api/schedulers', schedulersRoutes);
app.use('/api/dashboard', dashboardAnalyticsRoutes);

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log(`❌ 404: ${req.method} ${req.path}`);
  res.status(404).json({ error: 'Route not found' });
});

// Create HTTP server
const server = createServer(app);

// Create unified WebSocket server
const wsServer = createUnifiedWebSocketServer(server);

// Import IMAP pool for cleanup
import { imapPool } from './lib/imap-pool';

// Initialize queue event listeners (for WebSocket broadcasting)
import './lib/queue-events';


// Helper function to format timestamp for errors
function errorTimestamp() {
  return new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

// Catch uncaught errors
process.on('uncaughtException', (error) => {
  console.error(`[${errorTimestamp()}] 💥 UNCAUGHT EXCEPTION:`, error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${errorTimestamp()}] 💥 UNHANDLED REJECTION at:`, promise);
  console.error('Reason:', reason);
  process.exit(1);
});



// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully');
  
  // Stop all mock IMAP clients
  
  // Close IMAP connection pool
  await imapPool.closeAll();
  console.log('IMAP connection pool closed');
  
  // Close WebSocket server
  await wsServer.close();
  
  // Close database pool
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully');
  
  // Stop all mock IMAP clients
  
  // Close IMAP connection pool
  await imapPool.closeAll();
  console.log('IMAP connection pool closed');
  
  // Close WebSocket server
  await wsServer.close();
  
  // Close database pool
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

// Start server only if not in script mode
if (process.env.SKIP_SERVER_START !== 'true') {
  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔐 Auth endpoints: http://localhost:${PORT}/api/auth/*`);
    console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws/imap-logs`);
    console.log(`📧 IMAP API: http://localhost:${PORT}/api/imap/*`);
    console.log(`🤖 LLM Providers API: http://localhost:${PORT}/api/llm-providers/*`);
    console.log(`✨ Generate API: http://localhost:${PORT}/api/generate/*`);
    console.log(`🎯 Training API: http://localhost:${PORT}/api/training/*`);
  });
}

// Handle server errors
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please try one of these solutions:`);
    console.error(`   1. Kill the process: lsof -ti:${PORT} | xargs kill -9`);
    console.error(`   2. Or wait a moment and try again`);
    console.error(`   3. Or use a different port by setting PORT env variable`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});

export { app, pool, auth, server, wsServer };