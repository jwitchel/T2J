import './env';

import express from 'express';
import { createServer } from 'http';
import next from 'next';
import { toNodeHandler } from 'better-auth/node';

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
import monitoringRoutes from './routes/monitoring';
import queueRoutes from './routes/queue';
import imapMonitorRoutes from './routes/imap-monitor';
import jobsRoutes from './routes/jobs';
import workersRoutes from './routes/workers';
import schedulersRoutes from './routes/schedulers';
import dashboardAnalyticsRoutes from './routes/dashboard-analytics';
import actionRulesRoutes from './routes/action-rules';

import { pool } from './lib/db';
import { auth } from './lib/auth';
import { imapPool } from './lib/imap-pool';
import { createUnifiedWebSocketServer } from './websocket/unified-websocket';

const requiredEnvVars = [
  'ENCRYPTION_KEY',
  'APP_URL',
  'TRUSTED_ORIGINS',
  'DATABASE_URL',
  'PORT',
];

const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  console.error('Missing required environment variables:');
  missingVars.forEach(v => console.error(`   - ${v}`));
  process.exit(1);
}

const dev = process.env.NODE_ENV !== 'production';
const PORT = parseInt(process.env.PORT!, 10);
const SHUTDOWN_TIMEOUT_MS = 10000;

const nextApp = next({ dev, dir: process.cwd() });
const handle = nextApp.getRequestHandler();

async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  client.release();
  console.log('Connected to PostgreSQL');
}

async function initializeSchedulers(): Promise<void> {
  const { jobSchedulerManager } = await import('./lib/job-scheduler-manager');
  const result = await pool.query('SELECT DISTINCT user_id FROM email_accounts');

  for (const row of result.rows) {
    await jobSchedulerManager.initializeUserSchedulers(row.user_id);
  }
  console.log(`Initialized schedulers for ${result.rows.length} users`);
}

async function main() {
  await nextApp.prepare();
  console.log('Next.js prepared');

  await initializeDatabase();
  await initializeSchedulers();

  const app = express();

  app.use((req, _res, next) => {
    const skipPaths = ['/api/jobs/stats', '/health', '/_next', '/__nextjs'];
    if (!skipPaths.some(path => req.path.startsWith(path))) {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    }
    next();
  });

  // Better Auth routes - handles /api/auth/signup, /api/auth/signin, etc.
  // IMPORTANT: Don't use express.json() before better-auth
  app.all('/api/auth/*', toNodeHandler(auth));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
    }
  });

  app.use('/api/custom-auth', authRoutes);
  app.use('/api/email-accounts', emailAccountRoutes);
  app.use('/api/tone-profile', toneProfileRoutes);
  app.use('/api/imap', imapRoutes);
  app.use('/api/relationships', relationshipsRoutes);
  app.use('/api/style', styleRoutes);
  app.use('/api/llm-providers', llmProvidersRoutes);
  app.use('/api/generate', generateRoutes);
  app.use('/api/training', trainingRoutes);
  app.use('/api/oauth-email', oauthEmailRoutes);
  app.use('/api/oauth-direct', oauthDirectRoutes);
  app.use('/api', accountsRoutes);
  app.use('/api/signature-patterns', signaturePatternsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/inbox', inboxRoutes);
  app.use('/api/monitoring', monitoringRoutes);
  app.use('/api/queue', queueRoutes);
  app.use('/api/imap-monitor', imapMonitorRoutes);
  app.use('/api/jobs', jobsRoutes);
  app.use('/api/workers', workersRoutes);
  app.use('/api/schedulers', schedulersRoutes);
  app.use('/api/dashboard', dashboardAnalyticsRoutes);
  app.use('/api/action-rules', actionRulesRoutes);

  await import('./lib/queue-events');

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  app.all('*', (req, res) => {
    if (res.headersSent) return;
    return handle(req, res);
  });

  const server = createServer(app);
  const wsServer = createUnifiedWebSocketServer(server);

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);

    const forceExit = setTimeout(() => {
      console.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    server.close(async () => {
      console.log('HTTP server closed');
      await wsServer.close();
      await imapPool.closeAll();
      await pool.end();
      clearTimeout(forceExit);
      console.log('Shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    shutdown('unhandledRejection');
  });

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} already in use`);
    } else {
      console.error('Server error:', error);
    }
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
