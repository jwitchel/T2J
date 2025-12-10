import { pool } from './db';
import {
  UserPreferences,
  FolderPreferences,
  TypedNamePreferences,
  ActionPreferences,
  ProfileUpdateRequest,
  ProfileUpdateResult,
  ResolvedUserPreferences,
} from '../types/settings';
import { EmailActionRouter } from './email-action-router';

export class PreferencesService {
  // ==================== DEFAULT PREFERENCES ====================

  /**
   * Get the default preferences object for new users.
   * This is used by the auth hook when creating users.
   */
  getDefaultPreferences(): UserPreferences {
    const folderDefaults = EmailActionRouter.getDefaultFolders();
    return {
      folderPreferences: {
        rootFolder: folderDefaults.rootFolder,
        draftsFolderPath: folderDefaults.draftsFolderPath,
        noActionFolder: folderDefaults.noActionFolder,
        spamFolder: folderDefaults.spamFolder,
        todoFolder: folderDefaults.todoFolder,
      },
      actionPreferences: {
        spamDetection: true,
        silentActions: {
          'silent-fyi-only': true,
          'silent-large-list': true,
          'silent-unsubscribe': true,
          'silent-todo': true,
        },
        draftGeneration: true,
      },
    };
  }

  // ==================== READ OPERATIONS ====================

  /**
   * Get fully resolved user preferences with CSV fields parsed.
   * Assumes preferences were initialized at user creation time.
   */
  async getPreferences(userId: string): Promise<ResolvedUserPreferences> {
    const result = await pool.query(
      `SELECT preferences FROM "user" WHERE id = $1`,
      [userId]
    );
    const raw: UserPreferences = result.rows[0]?.preferences;

    // Preferences should be initialized at user creation time.
    // If missing, this indicates a data integrity issue.
    if (!raw?.folderPreferences || !raw?.actionPreferences) {
      throw new Error(`User ${userId} has corrupted or missing preferences`);
    }

    return {
      // Profile fields (pass-through)
      name: raw.name,
      nicknames: raw.nicknames,
      signatureBlock: raw.signatureBlock,

      // Folder preferences (initialized at user creation)
      folderPreferences: raw.folderPreferences,

      // Typed name (pass-through)
      typedName: raw.typedName,

      // Action preferences (initialized at user creation)
      actionPreferences: raw.actionPreferences,

      // Sent folder (pass-through)
      sentFolder: raw.sentFolder,

      // Relationship config (CSV parsed to arrays)
      relationshipConfig: {
        workDomains: this._parseCSV(raw.workDomainsCSV),
        familyEmails: this._parseCSV(raw.familyEmailsCSV),
        spouseEmails: this._parseCSV(raw.spouseEmailsCSV),
      },

      // Raw CSV strings (for UI display/editing)
      workDomainsCSV: raw.workDomainsCSV,
      familyEmailsCSV: raw.familyEmailsCSV,
      spouseEmailsCSV: raw.spouseEmailsCSV,
    };
  }

  // ==================== WRITE OPERATIONS ====================

  /**
   * Update profile preferences (name, nicknames, signatureBlock, domain settings)
   */
  async updateProfile(userId: string, updates: ProfileUpdateRequest): Promise<ProfileUpdateResult> {
    const current = await this._getRawPreferences(userId);
    const merged = this._mergeProfileUpdates(current, updates);

    const result = await pool.query(
      `UPDATE "user" SET preferences = $2 WHERE id = $1 RETURNING preferences`,
      [userId, JSON.stringify(merged)]
    );

    return {
      preferences: result.rows[0].preferences,
      domainSettingsChanged: this._domainSettingsChanged(updates),
    };
  }

  /**
   * Update folder preferences
   */
  async updateFolderPreferences(userId: string, folderPrefs: Partial<FolderPreferences>): Promise<FolderPreferences> {
    const current = await this._getRawPreferences(userId);

    // folderPreferences should exist from user creation
    if (!current.folderPreferences) {
      throw new Error(`User ${userId} has corrupted or missing folderPreferences`);
    }

    const merged: UserPreferences = {
      ...current,
      folderPreferences: {
        rootFolder: folderPrefs.rootFolder ?? current.folderPreferences.rootFolder,
        draftsFolderPath: folderPrefs.draftsFolderPath ?? current.folderPreferences.draftsFolderPath,
        noActionFolder: folderPrefs.noActionFolder ?? current.folderPreferences.noActionFolder,
        spamFolder: folderPrefs.spamFolder ?? current.folderPreferences.spamFolder,
        todoFolder: folderPrefs.todoFolder ?? current.folderPreferences.todoFolder,
      },
    };

    await pool.query(
      `UPDATE "user" SET preferences = $2 WHERE id = $1`,
      [userId, JSON.stringify(merged)]
    );

    return merged.folderPreferences!;
  }

  /**
   * Update typed name preferences
   */
  async updateTypedNamePreferences(userId: string, typedName: TypedNamePreferences): Promise<void> {
    await pool.query(
      `UPDATE "user" SET preferences = jsonb_set(
        COALESCE(preferences, '{}'),
        '{typedName}',
        $2::jsonb
      ) WHERE id = $1`,
      [userId, JSON.stringify(typedName)]
    );
  }

  /**
   * Update drafts folder path (called after auto-detection)
   */
  async updateDraftsFolderPath(userId: string, draftsFolderPath: string): Promise<void> {
    await pool.query(
      `UPDATE "user" SET preferences = jsonb_set(
        jsonb_set(COALESCE(preferences, '{}'), '{folderPreferences}', COALESCE(preferences->'folderPreferences', '{}')),
        '{folderPreferences,draftsFolderPath}',
        $2::jsonb
      ) WHERE id = $1`,
      [userId, JSON.stringify(draftsFolderPath)]
    );
  }

  /**
   * Update sent folder path
   */
  async updateSentFolder(userId: string, sentFolder: string): Promise<void> {
    await pool.query(
      `UPDATE "user" SET preferences = jsonb_set(
        COALESCE(preferences, '{}'),
        '{sentFolder}',
        $2::jsonb
      ) WHERE id = $1`,
      [userId, JSON.stringify(sentFolder)]
    );
  }

  /**
   * Update action preferences (spam detection, silent actions, draft generation toggles)
   */
  async updateActionPreferences(userId: string, actionPreferences: ActionPreferences): Promise<void> {
    await pool.query(
      `UPDATE "user" SET preferences = jsonb_set(
        COALESCE(preferences, '{}'),
        '{actionPreferences}',
        $2::jsonb
      ) WHERE id = $1`,
      [userId, JSON.stringify(actionPreferences)]
    );
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Get raw preferences from database (for internal write operations)
   */
  private async _getRawPreferences(userId: string): Promise<UserPreferences> {
    const result = await pool.query(
      `SELECT preferences FROM "user" WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.preferences ?? {};
  }

  private _parseCSV(csv: string | undefined): string[] {
    if (!csv?.trim()) return [];
    return csv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  private _mergeProfileUpdates(current: UserPreferences, updates: ProfileUpdateRequest): UserPreferences {
    return {
      ...current,
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.nicknames !== undefined && { nicknames: updates.nicknames }),
      ...(updates.signatureBlock !== undefined && { signatureBlock: updates.signatureBlock }),
      ...(updates.workDomainsCSV !== undefined && { workDomainsCSV: updates.workDomainsCSV }),
      ...(updates.familyEmailsCSV !== undefined && { familyEmailsCSV: updates.familyEmailsCSV }),
      ...(updates.spouseEmailsCSV !== undefined && { spouseEmailsCSV: updates.spouseEmailsCSV }),
    };
  }

  private _domainSettingsChanged(updates: ProfileUpdateRequest): boolean {
    return updates.workDomainsCSV !== undefined ||
           updates.familyEmailsCSV !== undefined ||
           updates.spouseEmailsCSV !== undefined;
  }
}

export const preferencesService = new PreferencesService();
