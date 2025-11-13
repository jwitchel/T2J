import { Router } from 'express';
import { pool } from '../lib/db';
import { requireAuth } from '../middleware/auth';

const router = Router();

/**
  * Get actions summary for all time periods
  * Returns counts grouped by action type for: 15min, 1hour, 24hours, 30days
 */
router.get('/actions-summary', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;

    // Query all time periods in parallel
    const [last15min, lastHour, last24Hours, last30Days] = await Promise.all([
      // Last 15 minutes
      pool.query(
        `SELECT action_taken, COUNT(*)::int as count
         FROM email_action_tracking
         WHERE user_id = $1
           AND updated_at >= NOW() - INTERVAL '15 minutes'
           AND action_taken != 'none'
         GROUP BY action_taken`,
        [userId]
      ),
      // Last hour
      pool.query(
        `SELECT action_taken, COUNT(*)::int as count
         FROM email_action_tracking
         WHERE user_id = $1
           AND updated_at >= NOW() - INTERVAL '1 hour'
           AND action_taken != 'none'
         GROUP BY action_taken`,
        [userId]
      ),
      // Last 24 hours
      pool.query(
        `SELECT action_taken, COUNT(*)::int as count
         FROM email_action_tracking
         WHERE user_id = $1
           AND updated_at >= NOW() - INTERVAL '24 hours'
           AND action_taken != 'none'
         GROUP BY action_taken`,
        [userId]
      ),
      // Last 30 days
      pool.query(
        `SELECT action_taken, COUNT(*)::int as count
         FROM email_action_tracking
         WHERE user_id = $1
           AND updated_at >= NOW() - INTERVAL '30 days'
           AND action_taken != 'none'
         GROUP BY action_taken`,
        [userId]
      )
    ]);

    // Helper to convert rows to action counts object
    // Returns all actions so frontend can aggregate as needed
    const rowsToObject = (rows: any[]) => {
      const result: Record<string, number> = {};
      rows.forEach(row => {
        result[row.action_taken] = row.count;
      });
      return result;
    };

    res.json({
      periods: {
        last15min: rowsToObject(last15min.rows),
        lastHour: rowsToObject(lastHour.rows),
        last24Hours: rowsToObject(last24Hours.rows),
        last30Days: rowsToObject(last30Days.rows)
      }
    });
  } catch (error) {
    console.error('Error fetching actions summary:', error);
    res.status(500).json({ error: 'Failed to fetch actions summary' });
  }
});

/**
 * Get recent actions with email details
 * Returns paginated list of recent actions for the table
 */
router.get('/recent-actions', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    // Get recent actions with email account info, subject, sender, and destination
    const result = await pool.query(
      `SELECT
        eat.id,
        eat.message_id,
        eat.action_taken,
        eat.subject,
        eat.sender_email,
        eat.destination_folder,
        eat.updated_at,
        eat.email_account_id,
        ea.email_address
       FROM email_action_tracking eat
       JOIN email_accounts ea ON eat.email_account_id = ea.id
       WHERE eat.user_id = $1
         AND eat.action_taken != 'none'
       ORDER BY eat.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*)::int as total
       FROM email_action_tracking
       WHERE user_id = $1 AND action_taken != 'none'`,
      [userId]
    );

    res.json({
      actions: result.rows.map(row => ({
        id: row.id,
        messageId: row.message_id,
        actionTaken: row.action_taken,
        subject: row.subject || '(Subject unavailable for old emails)',
        senderEmail: row.sender_email,
        destinationFolder: row.destination_folder,
        updatedAt: row.updated_at,
        emailAccountId: row.email_account_id,
        emailAccount: row.email_address
      })),
      total: countResult.rows[0]?.total || 0
    });
  } catch (error) {
    console.error('Error fetching recent actions:', error);
    res.status(500).json({ error: 'Failed to fetch recent actions' });
  }
});

export default router;
