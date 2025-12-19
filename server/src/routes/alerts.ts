/**
 * Alerts API Routes
 *
 * GET /api/alerts - Get all active alerts for the current user
 * POST /api/alerts/:id/resolve - Manually resolve an alert
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { userAlertService } from '../lib/user-alert-service';
import { UserAlertsResponse } from '../types/user-alerts';

const router = Router();

/**
 * GET /api/alerts
 * Returns all active alerts for the authenticated user
 */
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const alerts = await userAlertService.getActiveAlerts(req.user.id);

  const response: UserAlertsResponse = { alerts };
  res.json(response);
});

/**
 * POST /api/alerts/:id/resolve
 * Manually resolve an alert by ID
 */
router.post('/:id/resolve', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  await userAlertService.resolveAlert(id);

  res.json({ success: true });
});

export default router;
