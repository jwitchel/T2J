export interface CreateEmailAccountRequest {
  email_address: string
  imap_host: string
  imap_port: number
  imap_secure: boolean
  imap_username: string
  imap_password: string
}

export interface EmailAccountResponse {
  id: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_secure: boolean
  imap_username: string
  monitoring_enabled?: boolean
  last_sync: string | null
  created_at: string
  updated_at: string
  oauth_provider?: string
}
