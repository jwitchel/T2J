import express from 'express';
import { requireAuth } from '../middleware/auth';
import { jobSchedulerManager, SchedulerId } from '../lib/job-scheduler-manager';

const router = express.Router();

// Get global scheduler summary for the authenticated user
router.get('/', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const schedulers = await jobSchedulerManager.getSchedulerSummary(userId);

    res.json({
      schedulers,
      total: schedulers.length
    });
  } catch (error) {
    console.error('Error getting schedulers:', error);
    res.status(500).json({
      error: 'Failed to get schedulers',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Toggle scheduler globally (enable/disable for all monitored accounts)
router.put('/:id', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const schedulerId = req.params.id;
    const { enabled } = req.body;

    // Validate scheduler ID
    if (!Object.values(SchedulerId).includes(schedulerId as SchedulerId)) {
      res.status(400).json({ error: `Invalid scheduler ID: ${schedulerId}` });
      return;
    }

    // Validate enabled parameter
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    let affectedCount: number;
    if (enabled) {
      affectedCount = await jobSchedulerManager.enableSchedulerGlobally(schedulerId, userId);
    } else {
      affectedCount = await jobSchedulerManager.disableSchedulerGlobally(schedulerId, userId);
    }

    // Get updated summary
    const schedulers = await jobSchedulerManager.getSchedulerSummary(userId);
    const updatedScheduler = schedulers.find(s => s.id === schedulerId);

    res.json({
      success: true,
      message: `Scheduler ${schedulerId} ${enabled ? 'enabled' : 'disabled'} for ${affectedCount} account(s)`,
      scheduler: updatedScheduler
    });
  } catch (error) {
    console.error(`Error updating scheduler ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to update scheduler',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get specific scheduler status for an account (per-account management)
router.get('/:id/:accountId', requireAuth, async (req, res): Promise<void> => {
  try {
    const schedulerId = req.params.id;
    const accountId = req.params.accountId;

    // Validate scheduler ID
    if (!Object.values(SchedulerId).includes(schedulerId as SchedulerId)) {
      res.status(400).json({ error: `Invalid scheduler ID: ${schedulerId}` });
      return;
    }

    const status = await jobSchedulerManager.getSchedulerStatus(schedulerId, accountId);
    res.json(status);
  } catch (error) {
    console.error(`Error getting scheduler ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to get scheduler',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update scheduler (enable/disable) for a specific account (per-account management)
router.put('/:id/:accountId', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    const schedulerId = req.params.id;
    const accountId = req.params.accountId;
    const { enabled } = req.body;

    // Validate scheduler ID
    if (!Object.values(SchedulerId).includes(schedulerId as SchedulerId)) {
      res.status(400).json({ error: `Invalid scheduler ID: ${schedulerId}` });
      return;
    }

    // Validate enabled parameter
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    if (enabled) {
      await jobSchedulerManager.enableScheduler(schedulerId, userId, accountId);
    } else {
      await jobSchedulerManager.disableScheduler(schedulerId, userId, accountId);
    }

    // Get updated status
    const status = await jobSchedulerManager.getSchedulerStatus(schedulerId, accountId);

    res.json({
      success: true,
      message: `Scheduler ${schedulerId} ${enabled ? 'enabled' : 'disabled'} for account ${accountId}`,
      scheduler: status
    });
  } catch (error) {
    console.error(`Error updating scheduler ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to update scheduler',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Initialize schedulers for user (called when user logs in or app starts)
router.post('/initialize', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;
    await jobSchedulerManager.initializeUserSchedulers(userId);

    const schedulers = await jobSchedulerManager.getAllSchedulerStatuses(userId);

    res.json({
      success: true,
      message: 'Schedulers initialized',
      schedulers
    });
  } catch (error) {
    console.error('Error initializing schedulers:', error);
    res.status(500).json({
      error: 'Failed to initialize schedulers',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;