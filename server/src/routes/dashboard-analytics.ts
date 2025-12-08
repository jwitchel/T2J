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
    const userId = req.user.id;

    // Query all time periods in parallel from email_received
    const [last15min, lastHour, last24Hours, last30Days] = await Promise.all([
      // Last 15 minutes
      pool.query(
        `SELECT action_taken, COUNT(*)::int as count
         FROM email_received
         WHERE user_id = $1
           AND updated_at >= NOW() - INTERVAL '15 minutes'
         GROUP BY action_taken`,
        [userId]
      ),
      // Last hour
      pool.query(
        `SELECT action_taken, COUNT(*)::int as count
         FROM email_received
         WHERE user_id = $1
           AND updated_at >= NOW() - INTERVAL '1 hour'
         GROUP BY action_taken`,
        [userId]
      ),
      // Last 24 hours
      pool.query(
        `SELECT action_taken, COUNT(*)::int as count
         FROM email_received
         WHERE user_id = $1
           AND updated_at >= NOW() - INTERVAL '24 hours'
         GROUP BY action_taken`,
        [userId]
      ),
      // Last 30 days
      pool.query(
        `SELECT action_taken, COUNT(*)::int as count
         FROM email_received
         WHERE user_id = $1
           AND updated_at >= NOW() - INTERVAL '30 days'
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
    const userId = req.user.id;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    // Get recent actions from email_received with related info
    const result = await pool.query(
      `SELECT
        er.id,
        er.email_id as message_id,
        er.action_taken,
        er.subject,
        pe.email_address as sender_email,
        er.destination_folder,
        er.updated_at,
        er.email_account_id,
        ea.email_address,
        ur.relationship_type,
        p.name as person_name
       FROM email_received er
       JOIN email_accounts ea ON er.email_account_id = ea.id
       LEFT JOIN person_emails pe ON er.sender_person_email_id = pe.id
       LEFT JOIN people p ON pe.person_id = p.id
       LEFT JOIN person_relationships pr ON pr.person_id = p.id AND pr.user_id = er.user_id AND pr.is_primary = true
       LEFT JOIN user_relationships ur ON pr.user_relationship_id = ur.id
       WHERE er.user_id = $1
       ORDER BY er.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*)::int as total
       FROM email_received
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      actions: result.rows.map(row => ({
        id: row.id,
        messageId: row.message_id,
        actionTaken: row.action_taken,
        subject: row.subject,
        senderEmail: row.sender_email,
        senderName: row.person_name,
        destinationFolder: row.destination_folder,
        updatedAt: row.updated_at,
        emailAccountId: row.email_account_id,
        emailAccount: row.email_address,
        relationship: row.relationship_type
      })),
      total: countResult.rows[0]?.total
    });
  } catch (error) {
    console.error('Error fetching recent actions:', error);
    res.status(500).json({ error: 'Failed to fetch recent actions' });
  }
});

export default router;
