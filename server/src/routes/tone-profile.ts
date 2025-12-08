import express from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../lib/db';


const router = express.Router();

// Get user's tone profile
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(
      `SELECT preference_type, target_identifier, profile_data, emails_analyzed, updated_at
       FROM tone_preferences
       WHERE user_id = $1
         AND preference_type IN ('aggregate', 'category', 'individual')
         AND profile_data ? 'writingPatterns'`,
      [userId]
    );
    
    // Transform rows into object with target identifiers as keys
    const profiles: any = {};
    result.rows.forEach(row => {
      // Always return a consistent structure with writingPatterns at the root
      const writingPatterns = row.profile_data.writingPatterns;

      profiles[row.target_identifier] = {
        // Writing pattern fields at root level
        sentencePatterns: writingPatterns.sentencePatterns,
        paragraphPatterns: writingPatterns.paragraphPatterns,
        openingPatterns: writingPatterns.openingPatterns,
        valediction: writingPatterns.valediction,
        negativePatterns: writingPatterns.negativePatterns,
        responsePatterns: writingPatterns.responsePatterns,
        uniqueExpressions: writingPatterns.uniqueExpressions,

        // Metadata fields
        meta: {
          ...row.profile_data.meta,
          // Include sentence stats metadata if available
          sentenceStats: row.profile_data.sentenceStats ? {
            lastCalculated: row.profile_data.sentenceStats.lastCalculated,
            totalSentences: row.profile_data.sentenceStats.totalSentences,
            calculationMethod: 'direct' // Indicate this was calculated directly, not by LLM
          } : null
        },
        emails_analyzed: row.emails_analyzed,
        updated_at: row.updated_at,
        preference_type: row.preference_type
      };
    });
    
    // Use aggregate profile's count (total unique emails) instead of summing all categories
    // (which would count the same email multiple times if it appears in multiple relationship types)
    const aggregateProfile = result.rows.find(row => row.target_identifier === 'aggregate');
    const totalEmailsAnalyzed = aggregateProfile ? aggregateProfile.emails_analyzed : 0;

    // Get total loaded emails (regardless of whether patterns have been analyzed)
    const emailCountResult = await pool.query(
      'SELECT COUNT(*) as total FROM email_sent WHERE user_id = $1',
      [userId]
    );
    // COUNT(*) always returns exactly one row
    const totalEmailsLoaded = parseInt(emailCountResult.rows[0].total);

    res.json({
      profiles,
      totalEmailsAnalyzed,
      totalEmailsLoaded,
      lastUpdated: result.rows.length > 0
        ? Math.max(...result.rows.map(row => new Date(row.updated_at).getTime()))
        : null,
    });
  } catch (error) {
    console.error('Error fetching tone profile:', error);
    res.status(500).json({ error: 'Failed to fetch tone profile' });
  }
});

// Trigger tone profile building
router.post('/build', requireAuth, async (_req, res) => {
  try {
    // const userId = req.user.id;
    
    // TODO: Queue background job for tone profile building
    // For now, just return success
    
    res.json({ 
      message: 'Tone profile building started',
      status: 'queued',
    });
  } catch (error) {
    console.error('Error starting tone profile build:', error);
    res.status(500).json({ error: 'Failed to start tone profile building' });
  }
});

export default router;