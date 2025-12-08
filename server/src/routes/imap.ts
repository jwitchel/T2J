import express from 'express';
import { requireAuth } from '../middleware/auth';
import { ImapOperations } from '../lib/imap-operations';
import { withImapContext } from '../lib/imap-context';
import { withImapJson, mapImapError } from '../lib/http/imap-utils';

const router = express.Router();

// Get folders for an email account
router.get('/accounts/:accountId/folders', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const { accountId } = req.params as any;
  await withImapJson(res, accountId, userId, async () => {
    const imapOps = await ImapOperations.fromAccountId(accountId, userId);
    return imapOps.getFolders();
  }, 'Failed to fetch folders');
});

// Get messages from a folder
router.get('/accounts/:accountId/folders/:folderName/messages', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const { accountId, folderName } = req.params as any;
  const { limit = 50, offset = 0, sort = 'date', descending = 'true' } = req.query as any;
  await withImapJson(res, accountId, userId, async () => {
    const imapOps = await ImapOperations.fromAccountId(accountId, userId);
    const messages = await imapOps.getMessages(folderName, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      sort: sort as 'date' | 'from' | 'subject',
      descending: descending === 'true'
    });
    await imapOps.updateLastSync();
    return messages;
  }, 'Failed to fetch messages');
});

// Search messages
router.post('/accounts/:accountId/folders/:folderName/search', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const { accountId, folderName } = req.params as any;
  const { limit = 50, offset = 0 } = req.query as any;
  const criteria = req.body;
  await withImapJson(res, accountId, userId, async () => {
    const imapOps = await ImapOperations.fromAccountId(accountId, userId);
    return imapOps.searchMessages(folderName, criteria, {
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  }, 'Failed to search messages');
});

// Get a single message
router.get('/accounts/:accountId/folders/:folderName/messages/:uid', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const { accountId, folderName, uid } = req.params as any;
  await withImapJson(res, accountId, userId, async () => {
    const imapOps = await ImapOperations.fromAccountId(accountId, userId);
    return imapOps.getMessage(folderName, parseInt(uid));
  }, 'Failed to fetch message');
});

// Mark message as read
router.put('/accounts/:accountId/folders/:folderName/messages/:uid/read', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const { accountId, folderName, uid } = req.params as any;
  await withImapJson(res, accountId, userId, async () => {
    const imapOps = await ImapOperations.fromAccountId(accountId, userId);
    await imapOps.markAsRead(folderName, parseInt(uid));
    return { success: true };
  }, 'Failed to mark message as read');
});

// Mark message as unread
router.put('/accounts/:accountId/folders/:folderName/messages/:uid/unread', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const { accountId, folderName, uid } = req.params as any;
  await withImapJson(res, accountId, userId, async () => {
    const imapOps = await ImapOperations.fromAccountId(accountId, userId);
    await imapOps.markAsUnread(folderName, parseInt(uid));
    return { success: true };
  }, 'Failed to mark message as unread');
});

// Delete message
router.delete('/accounts/:accountId/folders/:folderName/messages/:uid', requireAuth, async (req, res): Promise<void> => {
  const userId = req.user.id;
  const { accountId, folderName, uid } = req.params as any;
  try {
    await withImapContext(accountId, userId, async () => {
      const imapOps = await ImapOperations.fromAccountId(accountId, userId);
      await imapOps.deleteMessage(folderName, parseInt(uid));
    });
    res.status(204).send();
  } catch (error) {
    mapImapError(res, error, 'Failed to delete message');
  }
});

export default router;
