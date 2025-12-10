import express from 'express';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

// Get current user session
router.get('/session', requireAuth, (req, res) => {
  res.json({
    user: req.user,
    session: req.session,
  });
});

// Additional auth endpoints can go here
// (better-auth handles the main auth routes automatically)

export default router;