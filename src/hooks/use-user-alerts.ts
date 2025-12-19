'use client'

import useSWR from 'swr'
import { useAuth } from '@/lib/auth-context'
import { apiPost } from '@/lib/api'
import {
  UserAlert,
  UserAlertsResponse,
  AlertSeverity,
} from '@server/types/user-alerts'

/**
 * Hook for managing persistent user alerts
 * Polls every 30 seconds for new alerts
 */
export function useUserAlerts() {
  const { user } = useAuth()

  const { data, mutate, isLoading } = useSWR<UserAlertsResponse>(
    user ? '/api/alerts' : null,
    {
      refreshInterval: 30000, // Poll every 30 seconds
    }
  )

  const alerts = data?.alerts ?? []

  return {
    /** All active alerts */
    alerts,
    /** Only error-severity alerts */
    errors: alerts.filter((a) => a.severity === AlertSeverity.ERROR),
    /** Only warning-severity alerts */
    warnings: alerts.filter((a) => a.severity === AlertSeverity.WARNING),
    /** Whether there are any active alerts */
    hasAlerts: alerts.length > 0,
    /** Whether alerts are loading */
    isLoading,
    /** Manually refresh alerts */
    refresh: mutate,
    /** Resolve an alert by ID */
    resolveAlert: async (alertId: string) => {
      await apiPost(`/api/alerts/${alertId}/resolve`, {})
      mutate()
    },
  }
}

export type { UserAlert }
