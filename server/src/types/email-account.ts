export interface CreateEmailAccountRequest {
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_username: string;
  imap_password: string;
  monitoring_enabled?: boolean;
}

export interface EmailAccountResponse {
  id: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_username: string;
  monitoring_enabled?: boolean;
  sent_folder: string;
  last_sync: string | null;
  created_at: string;
  updated_at: string;
  oauth_provider?: string;
}

export interface EmailAccountDb {
  id: string;
  user_id: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_username: string;
  imap_password_encrypted: string;
  last_sync: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ImapConnectionConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
  authTimeout: number;
  connTimeout: number;
}

export class EmailAccountValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'EmailAccountValidationError';
  }
}

export class ImapConnectionError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ImapConnectionError';
  }
}