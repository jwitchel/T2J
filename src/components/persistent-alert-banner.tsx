'use client'

import { useRouter } from 'next/navigation'
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAlerts } from '@/lib/alert-context'
import { AlertSeverity } from '@server/types/user-alerts'

/**
 * Persistent alert banner that displays at the top of the page
 * Shows errors first (red), then warnings (amber)
 * Non-dismissible for errors; warnings can be dismissed
 */
export function PersistentAlertBanner() {
  const router = useRouter()
  const { alerts, resolveAlert, hasAlerts } = useAlerts()

  if (!hasAlerts) {
    return null
  }

  // Sort by severity (errors first)
  const sortedAlerts = [...alerts].sort((a, b) => {
    if (a.severity === AlertSeverity.ERROR && b.severity !== AlertSeverity.ERROR)
      return -1
    if (a.severity !== AlertSeverity.ERROR && b.severity === AlertSeverity.ERROR)
      return 1
    return 0
  })

  return (
    <div className="space-y-2 px-4 py-2">
      {sortedAlerts.map((alert) => {
        const isError = alert.severity === AlertSeverity.ERROR
        const variantMap = {
          [AlertSeverity.ERROR]: 'destructive',
          [AlertSeverity.WARNING]: 'warning',
          [AlertSeverity.INFO]: 'info',
        } as const
        const variant = variantMap[alert.severity] ?? 'warning'

        return (
          <Alert key={alert.id} variant={variant}>
            {alert.severity === AlertSeverity.ERROR && <AlertCircle className="h-4 w-4" />}
            {alert.severity === AlertSeverity.WARNING && <AlertTriangle className="h-4 w-4" />}
            {alert.severity === AlertSeverity.INFO && <Info className="h-4 w-4" />}
            <div className="flex flex-1 items-start justify-between gap-4">
              <div className="flex-1">
                <AlertTitle className="flex items-center gap-2">
                  <span className="font-semibold">{alert.sourceName}</span>
                  {alert.errorCount > 1 && (
                    <span className="text-xs font-normal opacity-70">
                      (failed {alert.errorCount} times)
                    </span>
                  )}
                </AlertTitle>
                <AlertDescription>{alert.message}</AlertDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={
                    alert.severity === AlertSeverity.ERROR
                      ? 'destructive'
                      : alert.severity === AlertSeverity.WARNING
                        ? 'warning'
                        : 'info'
                  }
                  onClick={() => router.push(alert.actionUrl)}
                >
                  {alert.actionLabel}
                </Button>
                {!isError && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => resolveAlert(alert.id)}
                    aria-label="Dismiss alert"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </Alert>
        )
      })}
    </div>
  )
}
