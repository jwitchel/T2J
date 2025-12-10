import { pool } from './db';
import {
  UserPreferences,
  FolderPreferences,
  TypedNamePreferences,
  ProfileUpdateRequest,
  ProfileUpdateResult,
  ResolvedUserPreferences,
} from '../types/settings';
import { EmailActionRouter } from './email-action-router';

export class PreferencesService {
  // ==================== READ OPERATIONS ====================

  /**
   * Get fully resolved user preferences with defaults merged and CSV fields parsed.
   * This is the single read method - callers access what they need from the result.
   */
  async getPreferences(userId: string): Promise<ResolvedUserPreferences> {
    const result = await pool.query(
      `SELECT preferences FROM "user" WHERE id = $1`,
      [userId]
    );
    const raw: UserPreferences = result.rows[0]?.preferences ?? {};
    const defaults = EmailActionRouter.getDefaultFolders();

    return {
      // Profile fields (pass-through)
      name: raw.name,
      nicknames: raw.nicknames,
      signatureBlock: raw.signatureBlock,

      // Folder preferences with defaults merged
      folderPreferences: {
        rootFolder: raw.folderPreferences?.rootFolder ?? defaults.rootFolder,
        draftsFolderPath: raw.folderPreferences?.draftsFolderPath ?? defaults.draftsFolderPath,
        noActionFolder: raw.folderPreferences?.noActionFolder ?? defaults.noActionFolder,
        spamFolder: raw.folderPreferences?.spamFolder ?? defaults.spamFolder,
        todoFolder: raw.folderPreferences?.todoFolder ?? defaults.todoFolder,
      },

      // Typed name (pass-through)
      typedName: raw.typedName,

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
    const defaults = EmailActionRouter.getDefaultFolders();

    const merged: UserPreferences = {
      ...current,
      folderPreferences: {
        rootFolder: folderPrefs.rootFolder ?? current.folderPreferences?.rootFolder ?? defaults.rootFolder,
        draftsFolderPath: folderPrefs.draftsFolderPath ?? current.folderPreferences?.draftsFolderPath ?? defaults.draftsFolderPath,
        noActionFolder: folderPrefs.noActionFolder ?? current.folderPreferences?.noActionFolder ?? defaults.noActionFolder,
        spamFolder: folderPrefs.spamFolder ?? current.folderPreferences?.spamFolder ?? defaults.spamFolder,
        todoFolder: folderPrefs.todoFolder ?? current.folderPreferences?.todoFolder ?? defaults.todoFolder,
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
