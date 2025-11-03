import { ImapOperations } from './imap-operations';
import { LLMMetadata } from './llm-client';
import { FolderPreferences } from '../types/settings';
import { EmailActions, ActionHelpers } from './email-actions';

export interface ActionRouteResult {
  folder: string;
  flags: string[];
  displayName: string;
}

export class EmailActionRouter {
  // Read defaults from environment variables or use fallback values
  private static readonly DEFAULT_ROOT_FOLDER = process.env.DEFAULT_ROOT_FOLDER || '';
  private static readonly DEFAULT_NO_ACTION_FOLDER = process.env.DEFAULT_NO_ACTION_FOLDER || 't2j-no-action';
  private static readonly DEFAULT_SPAM_FOLDER = process.env.DEFAULT_SPAM_FOLDER || 't2j-spam';
  private static readonly DEFAULT_TODO_FOLDER = process.env.DEFAULT_TODO_FOLDER || 't2j-todo';

  // Public method to get default folder configuration
  static getDefaultFolders(): FolderPreferences {
    return {
      rootFolder: EmailActionRouter.DEFAULT_ROOT_FOLDER,
      noActionFolder: EmailActionRouter.DEFAULT_NO_ACTION_FOLDER,
      spamFolder: EmailActionRouter.DEFAULT_SPAM_FOLDER,
      todoFolder: EmailActionRouter.DEFAULT_TODO_FOLDER
    };
  }

  private folderPrefs: FolderPreferences;
  private draftsFolderPath: string | undefined;

  constructor(preferences?: Partial<FolderPreferences>, draftsFolderPath?: string) {
    this.folderPrefs = {
      rootFolder: preferences?.rootFolder !== undefined ? preferences.rootFolder : EmailActionRouter.DEFAULT_ROOT_FOLDER,
      noActionFolder: preferences?.noActionFolder || EmailActionRouter.DEFAULT_NO_ACTION_FOLDER,
      spamFolder: preferences?.spamFolder || EmailActionRouter.DEFAULT_SPAM_FOLDER,
      todoFolder: preferences?.todoFolder || EmailActionRouter.DEFAULT_TODO_FOLDER
    };
    this.draftsFolderPath = draftsFolderPath;
  }

  /**
   * Determine the destination folder and flags based on the recommended action
   */
  getActionRoute(recommendedAction: LLMMetadata['recommendedAction']): ActionRouteResult {
    const rootPath = this.folderPrefs.rootFolder ? `${this.folderPrefs.rootFolder}/` : '';

    switch (recommendedAction) {
      case EmailActions.REPLY:
      case EmailActions.REPLY_ALL:
      case EmailActions.FORWARD:
      case EmailActions.FORWARD_WITH_COMMENT:
        if (!this.draftsFolderPath) {
          throw new Error('Draft folder path not configured');
        }
        return {
          folder: this.draftsFolderPath,
          flags: ['\\Draft'],  // Drafts should not be marked as Seen
          displayName: this.draftsFolderPath
        };

      case EmailActions.SILENT_FYI_ONLY:
      case EmailActions.SILENT_LARGE_LIST:
      case EmailActions.SILENT_UNSUBSCRIBE:
        return {
          folder: `${rootPath}${this.folderPrefs.noActionFolder}`,
          flags: [],  // No-action items should not be marked as Seen
          displayName: this.folderPrefs.noActionFolder
        };

      case EmailActions.SILENT_SPAM:
        return {
          folder: `${rootPath}${this.folderPrefs.spamFolder}`,
          flags: ['\\Seen'],  // Spam should be marked as Seen
          displayName: this.folderPrefs.spamFolder
        };

      case EmailActions.SILENT_TODO:
        return {
          folder: `${rootPath}${this.folderPrefs.todoFolder}`,
          flags: [],  // Todo items should not be marked as Seen
          displayName: this.folderPrefs.todoFolder
        };

      case EmailActions.SILENT_AMBIGUOUS:
        // Ambiguous emails stay in INBOX for manual review
        return {
          folder: 'INBOX',
          flags: [],  // Keep unread for user attention
          displayName: 'INBOX'
        };

      default:
        throw new Error(`Unknown action: ${recommendedAction}`);
    }
  }

  /**
   * Get all required folders based on current preferences
   */
  getRequiredFolders(): string[] {
    const folders: string[] = [];
    const rootPath = this.folderPrefs.rootFolder;

    if (rootPath) {
      // Add root folder
      folders.push(rootPath);

      // Add subfolders with root path (excluding drafts - it's system managed)
      folders.push(`${rootPath}/${this.folderPrefs.noActionFolder}`);
      folders.push(`${rootPath}/${this.folderPrefs.spamFolder}`);
      folders.push(`${rootPath}/${this.folderPrefs.todoFolder}`);
    } else {
      // Add folders at root level (excluding drafts - it's system managed)
      folders.push(this.folderPrefs.noActionFolder);
      folders.push(this.folderPrefs.spamFolder);
      folders.push(this.folderPrefs.todoFolder);
    }

    return folders;
  }

  /**
   * Check which required folders exist and which need to be created
   */
  async checkFolders(imapOps: ImapOperations): Promise<{
    existing: string[];
    missing: string[];
  }> {
    const requiredFolders = this.getRequiredFolders();
    const existingFolders = await imapOps.getFolders();
    const existingPaths = existingFolders.map(f => f.path);

    const existing: string[] = [];
    const missing: string[] = [];

    for (const folder of requiredFolders) {
      if (existingPaths.includes(folder)) {
        existing.push(folder);
      } else {
        missing.push(folder);
      }
    }

    return { existing, missing };
  }

  /**
   * Create missing folders
   */
  async createMissingFolders(imapOps: ImapOperations): Promise<{
    created: string[];
    failed: Array<{ folder: string; error: string }>;
  }> {
    const { missing } = await this.checkFolders(imapOps);
    const created: string[] = [];
    const failed: Array<{ folder: string; error: string }> = [];

    for (const folder of missing) {
      try {
        await imapOps.createFolder(folder);
        created.push(folder);
      } catch (error) {
        failed.push({
          folder,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { created, failed };
  }

  /**
   * Get a human-readable description of the action
   */
  getActionDescription(recommendedAction: LLMMetadata['recommendedAction']): string {
    return ActionHelpers.getDescription(recommendedAction);
  }
}