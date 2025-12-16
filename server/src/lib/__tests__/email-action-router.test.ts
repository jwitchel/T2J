import { EmailActionRouter } from '../email-action-router';
import { EmailActionType } from '../../types/email-action-tracking';

describe('EmailActionRouter', () => {
  describe('default configuration', () => {
    it('should use getDefaultFolders to retrieve configuration', () => {
      // The static fields are initialized when the module loads from env vars.
      // Without env vars set, these will be undefined (fail-fast behavior).
      const defaults = EmailActionRouter.getDefaultFolders();

      expect(defaults).toHaveProperty('rootFolder');
      expect(defaults).toHaveProperty('noActionFolder');
      expect(defaults).toHaveProperty('spamFolder');
      expect(defaults).toHaveProperty('todoFolder');
      expect(defaults).toHaveProperty('draftsFolderPath');
    });

    it('should return undefined for env vars not set in test environment', () => {
      // Without env vars set, getDefaultFolders returns undefined values
      // This is intentional fail-fast behavior - env vars must be set in production
      const defaults = EmailActionRouter.getDefaultFolders();

      // In test environment, env vars are not set, so these are undefined
      // In production, these would be set via .env file
      expect(defaults.noActionFolder).toBeUndefined();
      expect(defaults.spamFolder).toBeUndefined();
      expect(defaults.rootFolder).toBeUndefined();
    });

    it('should handle empty root folder correctly', () => {
      const router = new EmailActionRouter({
        rootFolder: '',
        noActionFolder: 'AI-No-Action',
        spamFolder: 'AI-Spam',
        todoFolder: 't2j-todo'
      });

      const requiredFolders = router.getRequiredFolders();

      // With empty root, folders should be at root level (drafts excluded - system managed)
      expect(requiredFolders).toEqual([
        'AI-No-Action',
        'AI-Spam',
        't2j-todo'
      ]);
    });

    it('should handle root folder correctly', () => {
      const router = new EmailActionRouter({
        rootFolder: 'Prescreen',
        noActionFolder: 'AI-No-Action',
        spamFolder: 'AI-Spam',
        todoFolder: 't2j-todo'
      });

      const requiredFolders = router.getRequiredFolders();

      // With root folder, should include root and subfolders (drafts excluded - system managed)
      expect(requiredFolders).toEqual([
        'Prescreen',
        'Prescreen/AI-No-Action',
        'Prescreen/AI-Spam',
        'Prescreen/t2j-todo'
      ]);
    });
  });

  describe('action routing', () => {
    let router: EmailActionRouter;
    const testDraftsPath = 'INBOX.Drafts';

    beforeEach(() => {
      router = new EmailActionRouter({
        rootFolder: '',
        noActionFolder: 'AI-No-Action',
        spamFolder: 'AI-Spam',
        todoFolder: 't2j-todo',
        draftsFolderPath: testDraftsPath
      });
    });

    it('should route reply actions to system drafts folder', () => {
      const replyRoute = router.getActionRoute(EmailActionType.REPLY);
      expect(replyRoute.folder).toBe(testDraftsPath);
      expect(replyRoute.displayName).toBe(testDraftsPath);
      expect(replyRoute.flags).toContain('\\Draft');
      expect(replyRoute.flags).not.toContain('\\Seen');  // Drafts should not be marked as Seen
    });

    it('should route reply-all actions to system drafts folder', () => {
      const replyAllRoute = router.getActionRoute(EmailActionType.REPLY_ALL);
      expect(replyAllRoute.folder).toBe(testDraftsPath);
      expect(replyAllRoute.displayName).toBe(testDraftsPath);
    });

    it('should route forward actions to system drafts folder', () => {
      const forwardRoute = router.getActionRoute(EmailActionType.FORWARD);
      expect(forwardRoute.folder).toBe(testDraftsPath);
      expect(forwardRoute.displayName).toBe(testDraftsPath);
    });

    it('should route silent-fyi-only to no-action folder', () => {
      const silentRoute = router.getActionRoute(EmailActionType.SILENT_FYI_ONLY);
      expect(silentRoute.folder).toBe('AI-No-Action');
      expect(silentRoute.displayName).toBe('AI-No-Action');
      expect(silentRoute.flags).not.toContain('\\Seen');  // No-action items should not be marked as Seen
      expect(silentRoute.flags).not.toContain('\\Draft');
    });

    it('should route silent-spam to spam folder', () => {
      const spamRoute = router.getActionRoute(EmailActionType.SILENT_SPAM);
      expect(spamRoute.folder).toBe('AI-Spam');
      expect(spamRoute.displayName).toBe('AI-Spam');
      expect(spamRoute.flags).toContain('\\Seen');
    });

    it('should handle unknown actions by routing to INBOX', () => {
      // Unknown actions are treated as keep-in-inbox for resilience
      const result = router.getActionRoute('unknown-action' as any);
      expect(result.folder).toBe('INBOX');
      expect(result.displayName).toBe('INBOX');
      expect(result.flags).toEqual([]);
    });
  });

  describe('folder creation', () => {
    it('should check for missing folders', async () => {
      const router = new EmailActionRouter({
        rootFolder: '',
        noActionFolder: 'AI-No-Action',
        spamFolder: 'AI-Spam',
        todoFolder: 't2j-todo'
      });

      // Mock IMAP operations
      const mockImapOps = {
        getFolders: jest.fn().mockResolvedValue([
          { path: 'AI-No-Action' }
          // AI-Spam is missing
        ])
      };

      const result = await router.checkFolders(mockImapOps as any);

      expect(result.existing).toContain('AI-No-Action');
      expect(result.missing).toContain('AI-Spam');
    });

    it('should create missing folders', async () => {
      const router = new EmailActionRouter({
        rootFolder: '',
        noActionFolder: 'AI-No-Action',
        spamFolder: 'AI-Spam',
        todoFolder: 't2j-todo'
      });

      // Mock IMAP operations
      const mockImapOps = {
        getFolders: jest.fn().mockResolvedValue([
          { path: 'AI-No-Action' }
        ]),
        createFolder: jest.fn().mockResolvedValue(undefined)
      };

      const result = await router.createMissingFolders(mockImapOps as any);

      expect(result.created).toContain('AI-Spam');
      expect(mockImapOps.createFolder).toHaveBeenCalledWith('AI-Spam');
    });

    it('should handle folder creation errors', async () => {
      const router = new EmailActionRouter({
        rootFolder: '',
        noActionFolder: 'AI-No-Action',
        spamFolder: 'AI-Spam',
        todoFolder: 't2j-todo'
      });

      // Mock IMAP operations
      const mockImapOps = {
        getFolders: jest.fn().mockResolvedValue([]),
        createFolder: jest.fn()
          .mockResolvedValueOnce(undefined) // First folder succeeds
          .mockRejectedValueOnce(new Error('Permission denied')) // Second fails
      };

      const result = await router.createMissingFolders(mockImapOps as any);

      expect(result.created).toContain('AI-No-Action');
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toEqual({
        folder: 'AI-Spam',
        error: 'Permission denied'
      });
    });
  });
});
