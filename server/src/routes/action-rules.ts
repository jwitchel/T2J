/**
 * Action Rules Routes
 *
 * API endpoints for managing user action override rules.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { actionRulesService } from '../lib/action-rules-service';
import {
  ActionRuleConditionType,
  isValidUserAction,
  DuplicateSenderRuleError,
  DuplicateRelationshipRuleError,
} from '../types/action-rules';

const router = Router();

/**
 * GET /api/action-rules
 * Get all rules for the current user (sender rules first, then relationship)
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const rules = await actionRulesService.getRulesForUser(userId);
    return res.json({ rules });
  } catch (error) {
    console.error('Error fetching action rules:', error);
    return res.status(500).json({ error: 'Failed to fetch action rules' });
  }
});

/**
 * POST /api/action-rules
 * Create a new action rule
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { conditionType, conditionValue, targetAction } = req.body;

    // Validate required fields
    if (!conditionType) {
      return res.status(400).json({ error: 'conditionType is required' });
    }
    if (!conditionValue) {
      return res.status(400).json({ error: 'conditionValue is required' });
    }
    if (!targetAction) {
      return res.status(400).json({ error: 'targetAction is required' });
    }

    // Validate condition type
    if (!Object.values(ActionRuleConditionType).includes(conditionType)) {
      return res.status(400).json({ error: `Invalid conditionType: ${conditionType}` });
    }

    // Validate target action
    if (!isValidUserAction(targetAction)) {
      return res.status(400).json({ error: `Invalid targetAction: ${targetAction}` });
    }

    const rule = await actionRulesService.createRule({
      userId,
      conditionType,
      conditionValue,
      targetAction,
    });

    return res.status(201).json({ rule });
  } catch (error) {
    if (error instanceof DuplicateSenderRuleError || error instanceof DuplicateRelationshipRuleError) {
      return res.status(409).json({ error: error.message });
    }
    console.error('Error creating action rule:', error);
    return res.status(500).json({ error: 'Failed to create action rule' });
  }
});

/**
 * DELETE /api/action-rules/:id
 * Delete an action rule
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid rule ID format' });
    }

    const deleted = await actionRulesService.deleteRule(id, userId);

    if (!deleted) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    return res.status(204).send();
  } catch (error) {
    console.error('Error deleting action rule:', error);
    return res.status(500).json({ error: 'Failed to delete action rule' });
  }
});

export default router;
