import { Router, Request } from 'express';
import { pool } from '../lib/db';
import { requireAuth } from '../middleware/auth';

// Extend Express Request to include user
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name?: string;
  };
}

const router = Router();

// Get OAuth accounts for the current user
router.get('/accounts', requireAuth, async (req, res) => {
  try {
    const authenticatedReq = req as AuthenticatedRequest;
    const userId = authenticatedReq.user!.id;
    
    const result = await pool.query(
      `SELECT * FROM account WHERE "userId" = $1`,
      [userId]
    );
    
    res.json(result.rows);
  } catch (error: any) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;