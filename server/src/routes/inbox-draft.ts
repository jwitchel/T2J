import express from 'express';
import { requireAuth } from '../middleware/auth';
import { emailProcessingService } from '../lib/email-processing/email-processing-service';

const router = express.Router();

// Generate draft endpoint - thin wrapper around EmailProcessingService
router.post('/generate-draft', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    const { fullMessage, emailAccountId, providerId } = req.body;

    if (!fullMessage || !emailAccountId || !providerId) {
      res.status(400).json({
        error: 'Missing required fields: fullMessage, emailAccountId, providerId'
      });
      return;
    }

    // Use EmailProcessingService - handles parsing, context loading, spam check, and draft generation
    const result = await emailProcessingService.processEmail({
      fullMessage,
      emailAccountId,
      providerId,
      userId
    });

    if (result.success) {
      res.json(result);
    } else {
      // Use error code to determine HTTP status
      if (result.errorCode === 'ACCOUNT_NOT_FOUND') {
        res.status(404).json({
          error: 'Email account not found',
          message: result.error
        });
      } else {
        res.status(500).json({
          error: 'Failed to generate draft',
          message: result.error
        });
      }
    }
  } catch (error) {
    console.error('Error generating draft:', error);
    res.status(500).json({
      error: 'Failed to generate draft',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;