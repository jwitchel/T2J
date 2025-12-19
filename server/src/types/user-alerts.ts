/**
 * User Alerts Types
 *
 * Shared types for the persistent alert system.
 * Used by both backend services and frontend components.
 */

/**
 * Alert type constants - define once, use everywhere
 */
export const AlertType = {
  REAUTH_REQUIRED: 'reauth_required',
  CONNECTION_FAILED: 'connection_failed',
  INVALID_CREDENTIALS: 'invalid_credentials',
  RATE_LIMIT: 'rate_limit',
  QUOTA_EXCEEDED: 'quota_exceeded',
  SERVICE_UNAVAILABLE: 'service_unavailable',
} as const;

export type AlertType = (typeof AlertType)[keyof typeof AlertType];

/**
 * Alert severity constants
 */
export const AlertSeverity = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const;

export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];

/**
 * Source type constants - extend when adding new integrations
 */
export const SourceType = {
  EMAIL_ACCOUNT: 'email_account',
  LLM_PROVIDER: 'llm_provider',
  // Future: SLACK: 'slack',
} as const;

export type SourceType = (typeof SourceType)[keyof typeof SourceType];

/**
 * Threshold for considering an error persistent (not transient)
 */
export const PERSISTENT_ERROR_THRESHOLD = 3;

/**
 * Parameters for creating an alert
 */
export interface CreateAlertParams {
  userId: string;
  alertType: AlertType;
  severity: AlertSeverity;
  sourceType: SourceType;
  sourceId: string;
  sourceName: string;
  message: string;
  actionUrl: string;
  actionLabel: string;
}

/**
 * Alert data returned by the API
 */
export interface UserAlert {
  id: string;
  alertType: AlertType;
  severity: AlertSeverity;
  sourceType: SourceType;
  sourceId: string;
  sourceName: string;
  message: string;
  actionUrl: string;
  actionLabel: string;
  errorCount: number;
  lastOccurredAt: string;
  createdAt: string;
}

/**
 * API response for alerts endpoint
 */
export interface UserAlertsResponse {
  alerts: UserAlert[];
}
