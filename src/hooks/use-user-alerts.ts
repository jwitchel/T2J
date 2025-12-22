'use client'

import { useRef, useEffect } from 'react'
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
 * Polls version key every 3 seconds, only fetches full alerts when version changes
 */
export function useUserAlerts() {
  const { user } = useAuth()
  const lastVersionRef = useRef<number>(0)

  // Poll version frequently (cheap Redis read)
  const { data: versionData } = useSWR<{ version: number }>(
    user ? '/api/alerts/version' : null,
    {
      refreshInterval: 3000, // Poll every 3 seconds
    }
  )

  // Fetch full alerts only when version changes
  const { data, mutate, isLoading } = useSWR<UserAlertsResponse>(
    user ? '/api/alerts' : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  )

  // Reset version tracking when user changes
  useEffect(() => {
    lastVersionRef.current = 0
  }, [user?.id])

  // Refetch alerts when version changes
  useEffect(() => {
    if (versionData?.version !== undefined && versionData.version !== lastVersionRef.current) {
      lastVersionRef.current = versionData.version
      mutate()
    }
  }, [versionData?.version, mutate])

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
