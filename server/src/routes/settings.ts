import express from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../lib/db';
import { EmailActionRouter } from '../lib/email-action-router';
import { ImapOperations } from '../lib/imap-operations';
import { withImapContext } from '../lib/imap-context';
import { relationshipService } from '../lib/relationships/relationship-service';
import { relationshipDetector } from '../lib/relationships/relationship-detector';

const router = express.Router();

// Get profile preferences
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;

    // Query both user prefs and email accounts to get drafts folder
    const userResult = await pool.query(
      `SELECT name, preferences
       FROM "user"
       WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const preferences = user.preferences || {};

    // Get defaults from EmailActionRouter and merge with saved preferences
    const defaultFolders = EmailActionRouter.getDefaultFolders();
    const folderPreferences = preferences.folderPreferences
      ? { ...defaultFolders, ...preferences.folderPreferences }
      : defaultFolders;

    // Get drafts folder path from user preferences, with fallback to default
    const draftsFolderPath = preferences.folderPreferences?.draftsFolderPath || '[Gmail]/Drafts';

    // Add draftsFolderPath to folderPreferences
    const completeFolderPreferences = {
      ...folderPreferences,
      draftsFolderPath
    };

    return res.json({
      preferences: {
        name: preferences.name || user.name || '',
        nicknames: preferences.nicknames || '',
        signatureBlock: preferences.signatureBlock || '',
        folderPreferences: completeFolderPreferences,
        workDomainsCSV: preferences.workDomainsCSV || '',
        familyEmailsCSV: preferences.familyEmailsCSV || '',
        spouseEmailsCSV: preferences.spouseEmailsCSV || ''
      }
    });
  } catch (error) {
    console.error('Error fetching profile preferences:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update profile preferences (folderPreferences no longer user-configurable)
router.post('/profile', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { name, nicknames, signatureBlock, workDomainsCSV, familyEmailsCSV, spouseEmailsCSV } = req.body;

    // Helper to parse CSV and handle empty values
    const parseCSV = (csv: string | undefined): string[] => {
      if (!csv || csv.trim().length === 0) return [];
      return csv.split(',').map((item: string) => item.trim().toLowerCase()).filter((item: string) => item.length > 0);
    };

    // Fetch current preferences
    const currentResult = await pool.query(
      `SELECT preferences FROM "user" WHERE id = $1`,
      [userId]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Merge current preferences with updates
    const currentPrefs = currentResult.rows[0].preferences || {};
    const updatedPrefs = {
      ...currentPrefs,
      ...(name !== undefined && { name }),
      ...(nicknames !== undefined && { nicknames }),
      ...(signatureBlock !== undefined && { signatureBlock }),
      ...(workDomainsCSV !== undefined && { workDomainsCSV: workDomainsCSV || '' }),
      ...(familyEmailsCSV !== undefined && { familyEmailsCSV: familyEmailsCSV || '' }),
      ...(spouseEmailsCSV !== undefined && { spouseEmailsCSV: spouseEmailsCSV || '' })
    };

    // Update with merged preferences
    const result = await pool.query(
      `UPDATE "user" SET preferences = $2 WHERE id = $1 RETURNING preferences`,
      [userId, JSON.stringify(updatedPrefs)]
    );

    // If relationship domains were provided, clear cache and re-categorize
    let recategorization = null;
    if (workDomainsCSV !== undefined || familyEmailsCSV !== undefined || spouseEmailsCSV !== undefined) {
      relationshipDetector.clearConfigCache(userId);

      const workDomains = parseCSV(workDomainsCSV);
      const familyEmails = parseCSV(familyEmailsCSV);
      const spouseEmails = parseCSV(spouseEmailsCSV);

      recategorization = await relationshipService.recategorizePeople(userId, {
        workDomains,
        familyEmails,
        spouseEmails
      });
    }

    return res.json({
      success: true,
      preferences: result.rows[0].preferences,
      ...(recategorization && {
        recategorization: {
          updated: recategorization.updated,
          breakdown: {
            spouse: recategorization.spouse,
            family: recategorization.family,
            colleague: recategorization.colleague
          }
        }
      })
    });
  } catch (error) {
    console.error('Error updating profile preferences:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Get typed name preferences
router.get('/typed-name', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    
    const result = await pool.query(
      `SELECT preferences->'typedName' as typed_name_prefs
       FROM "user"
       WHERE id = $1`,
      [userId]
    );
    
    if (!result.rows.length || !result.rows[0].typed_name_prefs) {
      // Return empty preferences if none exist
      return res.json({
        preferences: {
          removalRegex: '',
          appendString: ''
        }
      });
    }
    
    return res.json({
      preferences: result.rows[0].typed_name_prefs
    });
  } catch (error) {
    console.error('Error fetching typed name preferences:', error);
    return res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Save typed name preferences
router.post('/typed-name', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const { preferences } = req.body;
    
    // Validate preferences
    if (!preferences || typeof preferences !== 'object') {
      return res.status(400).json({ error: 'Invalid preferences' });
    }
    
    // Validate regex if provided
    if (preferences.removalRegex) {
      try {
        new RegExp(preferences.removalRegex);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid regular expression' });
      }
    }
    
    // Update user preferences
    await pool.query(
      `UPDATE "user"
       SET preferences = jsonb_set(
         COALESCE(preferences, '{}'),
         '{typedName}',
         $1::jsonb,
         true
       ),
       "updatedAt" = NOW()
       WHERE id = $2`,
      [JSON.stringify(preferences), userId]
    );
    
    return res.json({ success: true });
  } catch (error) {
    console.error('Error saving typed name preferences:', error);
    return res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// Test and create email folders (uses saved configuration; no user input)
router.post('/test-folders', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    
    // Get all email accounts for the user
    const accountsResult = await pool.query(
      'SELECT id, email_address FROM email_accounts WHERE user_id = $1',
      [userId]
    );
    
    if (accountsResult.rows.length === 0) {
      res.status(404).json({ error: 'No email accounts found' });
      return;
    }
    
    // Get saved folder preferences (during setup)
    const userResult = await pool.query(
      'SELECT preferences->\'folderPreferences\' as folder_prefs, preferences->\'folderPreferences\'->\'draftsFolderPath\' as drafts_path FROM "user" WHERE id = $1',
      [userId]
    );
    const folderPrefs = userResult.rows[0]?.folder_prefs || EmailActionRouter.getDefaultFolders();
    const draftsFolderPath = userResult.rows[0]?.drafts_path;
    
    // Create router with user's preferences and drafts folder path
    const router = new EmailActionRouter(folderPrefs, draftsFolderPath);
    const requiredFolders = router.getRequiredFolders();
    
    // Check folders for each account
    const results: any[] = [];
    
    for (const account of accountsResult.rows) {
      try {
        await withImapContext(account.id, userId, async () => {
          const imapOps = await ImapOperations.fromAccountId(account.id, userId);
          const folderStatus = await router.checkFolders(imapOps);

          // Detect the provider's actual Drafts folder path and persist it
          // Reuse the folder list from checkFolders to avoid duplicate getFolders call
          try {
            const draftsPath = await imapOps.findDraftFolder(true, folderStatus.allFolders);
            await pool.query(
              `UPDATE "user"
               SET preferences = jsonb_set(
                 COALESCE(preferences, '{}'::jsonb),
                 '{folderPreferences,draftsFolderPath}',
                 $2::jsonb,
                 true
               )
               WHERE id = $1`,
              [userId, JSON.stringify(draftsPath)]
            );
          } catch (e) {
            // Ignore detection failure; report in results only
          }

          results.push({
            accountId: account.id,
            email: account.email_address,
            success: true,
            existing: folderStatus.existing,
            missing: folderStatus.missing
          });
        });
      } catch (error) {
        results.push({
          accountId: account.id,
          email: account.email_address,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    res.json({
      success: true,
      requiredFolders,
      accounts: results
    });
  } catch (error) {
    console.error('Error testing folders:', error);
    res.status(500).json({ 
      error: 'Failed to test folders',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
    return;
  }
});

// Create missing folders (based on saved configuration)
router.post('/create-folders', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req as any).user.id;
    
    // Get all email accounts for the user
    const accountsResult = await pool.query(
      'SELECT id, email_address FROM email_accounts WHERE user_id = $1',
      [userId]
    );
    
    if (accountsResult.rows.length === 0) {
      res.status(404).json({ error: 'No email accounts found' });
      return;
    }
    
    // Get saved folder preferences
    const userResult = await pool.query(
      'SELECT preferences->\'folderPreferences\' as folder_prefs, preferences->\'folderPreferences\'->\'draftsFolderPath\' as drafts_path FROM "user" WHERE id = $1',
      [userId]
    );
    const folderPrefs = userResult.rows[0]?.folder_prefs || EmailActionRouter.getDefaultFolders();
    const draftsFolderPath = userResult.rows[0]?.drafts_path;
    
    // Create router with user's preferences and drafts folder path
    const router = new EmailActionRouter(folderPrefs, draftsFolderPath);
    
    // Create folders for each account
    const results: any[] = [];
    
    for (const account of accountsResult.rows) {
      try {
        await withImapContext(account.id, userId, async () => {
          const imapOps = await ImapOperations.fromAccountId(account.id, userId);
          const result = await router.createMissingFolders(imapOps);
          results.push({
            accountId: account.id,
            email: account.email_address,
            success: true,
            created: result.created,
            failed: result.failed
          });
        });
      } catch (error) {
        results.push({
          accountId: account.id,
          email: account.email_address,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    res.json({
      success: true,
      accounts: results
    });
  } catch (error) {
    console.error('Error creating folders:', error);
    res.status(500).json({ 
      error: 'Failed to create folders',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
    return;
  }
});

export default router;
