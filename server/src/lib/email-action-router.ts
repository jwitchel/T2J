import { ImapOperations } from './imap-operations';
import { LLMMetadata } from './llm-client';
import { FolderPreferences } from '../types/settings';
import { EmailActionType } from '../types/email-action-tracking';

export interface ActionRouteResult {
  folder: string;
  flags: string[];
  displayName: string;
}

export class EmailActionRouter {
  // Read defaults from environment variables
  private static readonly DEFAULT_ROOT_FOLDER = process.env.DEFAULT_ROOT_FOLDER!;
  private static readonly DEFAULT_DRAFTS_FOLDER = process.env.DEFAULT_DRAFTS_FOLDER!;
  private static readonly DEFAULT_NO_ACTION_FOLDER = process.env.DEFAULT_NO_ACTION_FOLDER!;
  private static readonly DEFAULT_SPAM_FOLDER = process.env.DEFAULT_SPAM_FOLDER!;
  private static readonly DEFAULT_TODO_FOLDER = process.env.DEFAULT_TODO_FOLDER!;

  // Public method to get default folder configuration
  static getDefaultFolders(): FolderPreferences {
    return {
      rootFolder: EmailActionRouter.DEFAULT_ROOT_FOLDER,
      draftsFolderPath: EmailActionRouter.DEFAULT_DRAFTS_FOLDER,
      noActionFolder: EmailActionRouter.DEFAULT_NO_ACTION_FOLDER,
      spamFolder: EmailActionRouter.DEFAULT_SPAM_FOLDER,
      todoFolder: EmailActionRouter.DEFAULT_TODO_FOLDER
    };
  }

  private folderPrefs: FolderPreferences;

  constructor(preferences?: Partial<FolderPreferences>) {
    this.folderPrefs = {
      rootFolder: preferences?.rootFolder ?? EmailActionRouter.DEFAULT_ROOT_FOLDER,
      draftsFolderPath: preferences?.draftsFolderPath ?? EmailActionRouter.DEFAULT_DRAFTS_FOLDER,
      noActionFolder: preferences?.noActionFolder ?? EmailActionRouter.DEFAULT_NO_ACTION_FOLDER,
      spamFolder: preferences?.spamFolder ?? EmailActionRouter.DEFAULT_SPAM_FOLDER,
      todoFolder: preferences?.todoFolder ?? EmailActionRouter.DEFAULT_TODO_FOLDER
    };
  }

  /**
   * Determine the destination folder and flags based on the recommended action
   */
  getActionRoute(recommendedAction: LLMMetadata['recommendedAction']): ActionRouteResult {
    const rootPath = this.folderPrefs.rootFolder ? `${this.folderPrefs.rootFolder}/` : '';

    switch (recommendedAction) {
      case EmailActionType.REPLY:
      case EmailActionType.REPLY_ALL:
      case EmailActionType.FORWARD:
      case EmailActionType.FORWARD_WITH_COMMENT:
        return {
          folder: this.folderPrefs.draftsFolderPath,
          flags: ['\\Draft'],  // Drafts should not be marked as Seen
          displayName: this.folderPrefs.draftsFolderPath
        };

      case EmailActionType.SILENT_FYI_ONLY:
      case EmailActionType.SILENT_LARGE_LIST:
      case EmailActionType.SILENT_UNSUBSCRIBE:
        return {
          folder: `${rootPath}${this.folderPrefs.noActionFolder}`,
          flags: [],  // No-action items should not be marked as Seen
          displayName: this.folderPrefs.noActionFolder
        };

      case EmailActionType.SILENT_SPAM:
        return {
          folder: `${rootPath}${this.folderPrefs.spamFolder}`,
          flags: ['\\Seen'],  // Spam should be marked as Seen
          displayName: this.folderPrefs.spamFolder
        };

      case EmailActionType.SILENT_TODO:
        return {
          folder: `${rootPath}${this.folderPrefs.todoFolder}`,
          flags: [],  // Todo items should not be marked as Seen
          displayName: this.folderPrefs.todoFolder
        };

      case EmailActionType.KEEP_IN_INBOX:
      case EmailActionType.MANUALLY_HANDLED:
      case EmailActionType.PENDING:
      case EmailActionType.TRAINING:
        // These actions keep email in INBOX for manual review
        return {
          folder: 'INBOX',
          flags: [],  // Keep unread for user attention
          displayName: 'INBOX'
        };

      default:
        // Log unexpected action but don't crash - treat as keep-in-inbox
        console.warn(`[EmailActionRouter] Unexpected action: ${recommendedAction}, treating as keep-in-inbox`);
        return {
          folder: 'INBOX',
          flags: [],
          displayName: 'INBOX'
        };
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
    allFolders: Array<{ name: string; path: string; flags?: string[] }>;
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

    return { existing, missing, allFolders: existingFolders };
  }

  /**
   * Create missing folders
   * @param imapOps - IMAP operations instance
   * @param missingFolders - Optional pre-computed list of missing folders (avoids calling checkFolders again)
   */
  async createMissingFolders(
    imapOps: ImapOperations,
    missingFolders?: string[]
  ): Promise<{
    created: string[];
    failed: Array<{ folder: string; error: string }>;
  }> {
    // Use provided list or check folders to find missing ones
    const missing = missingFolders !== undefined
      ? missingFolders
      : (await this.checkFolders(imapOps)).missing;

    const created: string[] = [];
    const failed: Array<{ folder: string; error: string }> = [];

    for (const folder of missing) {
      try {
        await imapOps.createFolder(folder);
        created.push(folder);
      } catch (error: unknown) {
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
    return EmailActionType.DESCRIPTIONS[recommendedAction] || 'Unknown action';
  }
}
