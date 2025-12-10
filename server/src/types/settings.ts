// User preferences and settings types

export interface FolderPreferences {
  rootFolder: string;
  draftsFolderPath: string;
  noActionFolder: string;
  spamFolder: string;
  todoFolder: string;
}

export interface TypedNamePreferences {
  appendToName?: boolean;
  appendString?: string;
  removalRegex?: string;
}

export interface UserPreferences {
  name?: string;
  nicknames?: string;
  signatureBlock?: string;
  folderPreferences?: FolderPreferences;
  typedName?: TypedNamePreferences;
  sentFolder?: string;
  workDomainsCSV?: string;
  familyEmailsCSV?: string;
  spouseEmailsCSV?: string;
}

// Request/response types for profile updates
export interface ProfileUpdateRequest {
  name?: string;
  nicknames?: string;
  signatureBlock?: string;
  workDomainsCSV?: string;
  familyEmailsCSV?: string;
  spouseEmailsCSV?: string;
}

export interface ProfileUpdateResult {
  preferences: UserPreferences;
  domainSettingsChanged: boolean;
}

// Parsed relationship configuration (from CSV fields)
export interface RelationshipConfig {
  workDomains: string[];
  familyEmails: string[];
  spouseEmails: string[];
}