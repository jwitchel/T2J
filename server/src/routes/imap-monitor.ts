/**
 * IMAP Monitor API Routes
 *
 * TODO: IMAP IDLE monitoring is opt-in and not automatically enabled.
 * Primary email checking uses BullMQ polling via JobSchedulerManager (60s interval).
 * These routes allow manual activation of real-time IMAP IDLE monitoring.
 */

import express from 'express';
import { requireAuth } from '../middleware/auth';
import { imapMonitor } from '../lib/imap-monitor';
import { pool } from '../lib/db';

const router = express.Router();

// Start monitoring an email account
router.post('/start/:accountId', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { accountId } = req.params;

    // Verify account belongs to user
    const accountCheck = await pool.query(
      'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    if (accountCheck.rows.length === 0) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    // Check if already monitoring
    if (imapMonitor.isMonitoring(accountId)) {
      res.json({
        success: true,
        message: 'Already monitoring this account',
        status: imapMonitor.getAccountStatus(accountId)
      });
      return;
    }

    // Start monitoring
    await imapMonitor.startMonitoring(accountId, userId);

    res.json({
      success: true,
      message: 'IMAP monitoring started',
      status: imapMonitor.getAccountStatus(accountId)
    });
  } catch (error) {
    console.error('Error starting IMAP monitoring:', error);
    res.status(500).json({
      error: 'Failed to start monitoring',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stop monitoring an email account
router.post('/stop/:accountId', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { accountId } = req.params;

    // Verify account belongs to user
    const accountCheck = await pool.query(
      'SELECT id FROM email_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    if (accountCheck.rows.length === 0) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    // Stop monitoring
    await imapMonitor.stopMonitoring(accountId);

    res.json({
      success: true,
      message: 'IMAP monitoring stopped'
    });
  } catch (error) {
    console.error('Error stopping IMAP monitoring:', error);
    res.status(500).json({
      error: 'Failed to stop monitoring',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get monitoring status for all user's accounts
router.get('/status', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;

    // Get user's email accounts
    const accountsResult = await pool.query(
      'SELECT id, email_address FROM email_accounts WHERE user_id = $1',
      [userId]
    );

    const statuses = accountsResult.rows.map(account => ({
      accountId: account.id,
      email: account.email_address,
      monitoring: imapMonitor.getAccountStatus(account.id) || {
        accountId: account.id,
        status: 'not_monitored'
      }
    }));

    res.json({
      accounts: statuses,
      totalMonitored: statuses.filter(s => s.monitoring.status !== 'not_monitored').length
    });
  } catch (error) {
    console.error('Error getting monitoring status:', error);
    res.status(500).json({
      error: 'Failed to get status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get monitoring status for a specific account
router.get('/status/:accountId', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { accountId } = req.params;

    // Verify account belongs to user
    const accountCheck = await pool.query(
      'SELECT email_address FROM email_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    if (accountCheck.rows.length === 0) {
      res.status(404).json({ error: 'Email account not found' });
      return;
    }

    const status = imapMonitor.getAccountStatus(accountId);

    res.json({
      accountId,
      email: accountCheck.rows[0].email_address,
      monitoring: status || {
        accountId,
        status: 'not_monitored'
      }
    });
  } catch (error) {
    console.error('Error getting account monitoring status:', error);
    res.status(500).json({
      error: 'Failed to get status',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start monitoring all user's accounts
router.post('/start-all', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;

    // Get user's email accounts
    const accountsResult = await pool.query(
      'SELECT id FROM email_accounts WHERE user_id = $1',
      [userId]
    );

    const startPromises = accountsResult.rows.map(account =>
      imapMonitor.startMonitoring(account.id, userId).catch(err => ({
        accountId: account.id,
        error: err.message
      }))
    );

    const results = await Promise.all(startPromises);
    const errors = results.filter(r => r && typeof r === 'object' && 'error' in r);

    res.json({
      success: true,
      started: accountsResult.rows.length - errors.length,
      errors: errors.length > 0 ? errors : undefined,
      totalMonitored: imapMonitor.getMonitoredAccountCount()
    });
  } catch (error) {
    console.error('Error starting monitoring for all accounts:', error);
    res.status(500).json({
      error: 'Failed to start monitoring',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stop monitoring all user's accounts
router.post('/stop-all', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;

    // Get user's email accounts
    const accountsResult = await pool.query(
      'SELECT id FROM email_accounts WHERE user_id = $1',
      [userId]
    );

    const stopPromises = accountsResult.rows.map(account =>
      imapMonitor.stopMonitoring(account.id)
    );

    await Promise.all(stopPromises);

    res.json({
      success: true,
      message: 'All monitoring stopped',
      stopped: accountsResult.rows.length
    });
  } catch (error) {
    console.error('Error stopping monitoring for all accounts:', error);
    res.status(500).json({
      error: 'Failed to stop monitoring',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get overall monitoring statistics
router.get('/stats', requireAuth, async (_req, res): Promise<void> => {
  try {
    const allStatuses = imapMonitor.getStatus();
    
    const stats = {
      totalMonitored: allStatuses.length,
      connected: allStatuses.filter(s => s.status === 'connected').length,
      disconnected: allStatuses.filter(s => s.status === 'disconnected').length,
      reconnecting: allStatuses.filter(s => s.status === 'reconnecting').length,
      error: allStatuses.filter(s => s.status === 'error').length,
      totalMessagesProcessed: allStatuses.reduce((sum, s) => sum + s.messagesProcessed, 0),
      accounts: allStatuses
    };

    res.json(stats);
  } catch (error) {
    console.error('Error getting monitoring stats:', error);
    res.status(500).json({
      error: 'Failed to get stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;