// User preferences and settings types

export interface FolderPreferences {
  rootFolder: string;
  noActionFolder: string;
  spamFolder: string;
  todoFolder: string;
}

export interface TypedNamePreferences {
  appendToName: boolean;
  appendString: string;
}

export interface UserPreferences {
  name?: string;
  nicknames?: string;
  signatureBlock?: string;
  folderPreferences?: FolderPreferences;
  typedName?: TypedNamePreferences;
  // Add other preference types as needed
}