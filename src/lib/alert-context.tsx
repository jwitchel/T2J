'use client'

import { createContext, useContext, ReactNode } from 'react'
import { useUserAlerts, UserAlert } from '@/hooks/use-user-alerts'

interface AlertContextType {
  /** All active alerts */
  alerts: UserAlert[]
  /** Only error-severity alerts */
  errors: UserAlert[]
  /** Only warning-severity alerts */
  warnings: UserAlert[]
  /** Whether there are any active alerts */
  hasAlerts: boolean
  /** Whether alerts are loading */
  isLoading: boolean
  /** Manually refresh alerts */
  refresh: () => void
  /** Resolve an alert by ID */
  resolveAlert: (alertId: string) => Promise<void>
}

const AlertContext = createContext<AlertContextType | undefined>(undefined)

export function AlertProvider({ children }: { children: ReactNode }) {
  const alertState = useUserAlerts()

  return (
    <AlertContext.Provider value={alertState}>{children}</AlertContext.Provider>
  )
}

export function useAlerts() {
  const context = useContext(AlertContext)
  if (context === undefined) {
    throw new Error('useAlerts must be used within an AlertProvider')
  }
  return context
}
