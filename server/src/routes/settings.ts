import express from 'express';
import { requireAuth } from '../middleware/auth';
import { pool } from '../lib/db';
import { EmailActionRouter } from '../lib/email-action-router';
import { ImapOperations } from '../lib/imap-operations';
import { withImapContext } from '../lib/imap-context';
import { relationshipService } from '../lib/relationships/relationship-service';
import { relationshipDetector } from '../lib/relationships/relationship-detector';
import { preferencesService } from '../lib/preferences-service';

const router = express.Router();

// Helper interface for account operation results
interface AccountOperationResult {
  accountId: string;
  email: string;
  success: boolean;
  error?: string;
  [key: string]: any;  // Allow additional properties from operation
}

/**
 * Execute an operation on all email accounts for a user
 * Handles account/preference fetching and IMAP context management
 */
async function executeOnAllAccounts(
  userId: string,
  operation: (imapOps: ImapOperations, actionRouter: EmailActionRouter, account: { id: string; email_address: string }) => Promise<Omit<AccountOperationResult, 'accountId' | 'email' | 'success'>>
): Promise<{ accounts: AccountOperationResult[]; actionRouter: EmailActionRouter; requiredFolders: string[] } | { error: string }> {
  // Get all email accounts for the user
  const accountsResult = await pool.query(
    'SELECT id, email_address FROM email_accounts WHERE user_id = $1',
    [userId]
  );

  if (accountsResult.rows.length === 0) {
    return { error: 'No email accounts found' };
  }

  // Get user preferences (single fetch)
  const prefs = await preferencesService.getPreferences(userId);
  const folderPrefs = prefs.folderPreferences;

  // Create router with user's preferences
  const actionRouter = new EmailActionRouter(folderPrefs, folderPrefs.draftsFolderPath);
  const requiredFolders = actionRouter.getRequiredFolders();

  // Execute operation on each account
  const results: AccountOperationResult[] = [];

  for (const account of accountsResult.rows) {
    try {
      await withImapContext(account.id, userId, async () => {
        const imapOps = await ImapOperations.fromAccountId(account.id, userId);
        const opResult = await operation(imapOps, actionRouter, account);
        results.push({
          accountId: account.id,
          email: account.email_address,
          success: true,
          ...opResult
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

  return { accounts: results, actionRouter, requiredFolders };
}

// Get profile preferences
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all preferences in one call
    const prefs = await preferencesService.getPreferences(userId);

    // FIX: Name exists in two places - preferences.name (user-editable) and user.name (set at registration).
    // Should consolidate to preferences.name only. For now, fallback to user.name for backwards compatibility.
    const userResult = await pool.query(
      `SELECT name FROM "user" WHERE id = $1`,
      [userId]
    );

    return res.json({
      preferences: {
        name: prefs.name ?? userResult.rows[0]?.name,
        nicknames: prefs.nicknames,
        signatureBlock: prefs.signatureBlock,
        folderPreferences: prefs.folderPreferences,
        workDomainsCSV: prefs.workDomainsCSV,
        familyEmailsCSV: prefs.familyEmailsCSV,
        spouseEmailsCSV: prefs.spouseEmailsCSV
      }
    });
  } catch (error) {
    console.error('Error fetching profile preferences:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Update profile preferences
router.post('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, nicknames, signatureBlock, workDomainsCSV, familyEmailsCSV, spouseEmailsCSV } = req.body;

    // Update profile using service
    const result = await preferencesService.updateProfile(userId, {
      name,
      nicknames,
      signatureBlock,
      workDomainsCSV,
      familyEmailsCSV,
      spouseEmailsCSV
    });

    // If relationship domains changed, clear cache and re-categorize
    let recategorization = null;
    if (result.domainSettingsChanged) {
      relationshipDetector.clearConfigCache(userId);

      // Re-fetch preferences to get the updated relationshipConfig
      const updatedPrefs = await preferencesService.getPreferences(userId);

      recategorization = await relationshipService.recategorizePeople(userId, updatedPrefs.relationshipConfig);
    }

    return res.json({
      success: true,
      preferences: result.preferences,
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
    const userId = req.user.id;

    const prefs = await preferencesService.getPreferences(userId);

    if (!prefs.typedName) {
      // Return empty preferences if none exist
      return res.json({
        preferences: {
          removalRegex: '',
          appendString: ''
        }
      });
    }

    return res.json({
      preferences: prefs.typedName
    });
  } catch (error) {
    console.error('Error fetching typed name preferences:', error);
    return res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Save typed name preferences
router.post('/typed-name', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
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

    // Update user preferences using service
    await preferencesService.updateTypedNamePreferences(userId, preferences);

    return res.json({ success: true });
  } catch (error) {
    console.error('Error saving typed name preferences:', error);
    return res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// Test and create email folders (uses saved configuration; no user input)
router.post('/test-folders', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = req.user.id;

    const result = await executeOnAllAccounts(userId, async (imapOps, actionRouter) => {
      const folderStatus = await actionRouter.checkFolders(imapOps);

      // Detect the provider's actual Drafts folder path and persist it
      try {
        const draftsPath = await imapOps.findDraftFolder(true, folderStatus.allFolders);
        await preferencesService.updateDraftsFolderPath(userId, draftsPath);
      } catch (e) {
        // Ignore detection failure; report in results only
      }

      return {
        existing: folderStatus.existing,
        missing: folderStatus.missing
      };
    });

    if ('error' in result) {
      res.status(404).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      requiredFolders: result.requiredFolders,
      accounts: result.accounts
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
    const userId = req.user.id;

    const result = await executeOnAllAccounts(userId, async (imapOps, actionRouter) => {
      const createResult = await actionRouter.createMissingFolders(imapOps);
      return {
        created: createResult.created,
        failed: createResult.failed
      };
    });

    if ('error' in result) {
      res.status(404).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      accounts: result.accounts
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

// Update folder preferences
router.post('/folder-preferences', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { rootFolder, noActionFolder, spamFolder, todoFolder } = req.body;

    const updatedFolderPrefs = await preferencesService.updateFolderPreferences(userId, {
      rootFolder,
      noActionFolder,
      spamFolder,
      todoFolder
    });

    return res.json({
      success: true,
      folderPreferences: updatedFolderPrefs
    });
  } catch (error) {
    console.error('Error updating folder preferences:', error);
    return res.status(500).json({ error: 'Failed to update folder preferences' });
  }
});

export default router;
