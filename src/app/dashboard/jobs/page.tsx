'use client'

import { JobsMonitor } from '@/components/jobs-monitor'
import { ImapLogViewer } from '@/components/imap-log-viewer'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { RefreshCw, Trash2, Pause, Play } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/hooks/use-toast'

export default function JobsPage() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [forceRefresh, setForceRefresh] = useState(false)
  const [workersActive, setWorkersActive] = useState(false)
  const [isLoadingWorkers, setIsLoadingWorkers] = useState(false)
  const [queuesEmergencyPaused, setQueuesEmergencyPaused] = useState(false)
  const [isLoadingEmergency, setIsLoadingEmergency] = useState(false)
  const [schedulers, setSchedulers] = useState<
    Array<{
      id: string
      enabled: boolean
      interval: number
      description: string
      monitoredAccounts: number
      nextRun?: string
    }>
  >([])
  const [isLoadingSchedulers, setIsLoadingSchedulers] = useState(false)
  const [queueStats, setQueueStats] = useState<{
    emailProcessing: {
      active: number
      waiting: number
      prioritized?: number
      completed: number
      failed: number
      delayed: number
      paused: number
      isPaused?: boolean
    }
    toneProfile: {
      active: number
      waiting: number
      prioritized?: number
      completed: number
      failed: number
      delayed: number
      paused: number
      isPaused?: boolean
    }
  }>({
    emailProcessing: {
      active: 0,
      waiting: 0,
      prioritized: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
      isPaused: false,
    },
    toneProfile: {
      active: 0,
      waiting: 0,
      prioritized: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
      isPaused: false,
    },
  })
  const { success, error } = useToast()

  // API URL used throughout the component
  const apiUrl = process.env.NEXT_PUBLIC_API_URL!

  // Shared method for consistent API request handling
  const handleApiRequest = useCallback(
    async (config: {
      endpoint: string
      method?: string
      body?: unknown
      loadingStateSetter?: (loading: boolean) => void
      onSuccess?: (data: Record<string, unknown>) => void
      onError?: (errorData: Record<string, unknown>) => void
      defaultErrorMessage: string
      logPrefix: string
      refreshAfter?: boolean
    }) => {
      const {
        endpoint,
        method = 'POST',
        body,
        loadingStateSetter,
        onSuccess,
        onError,
        defaultErrorMessage,
        logPrefix,
        refreshAfter = true,
      } = config

      if (loadingStateSetter) loadingStateSetter(true)

      try {
        const requestOptions: RequestInit = {
          method,
          credentials: 'include',
        }

        if (body) {
          requestOptions.headers = { 'Content-Type': 'application/json' }
          requestOptions.body = JSON.stringify(body)
        }

        const response = await fetch(`${apiUrl}${endpoint}`, requestOptions)

        if (response.ok) {
          const data = await response.json()
          if (onSuccess) {
            onSuccess(data)
          } else {
            success(data.message || 'Operation completed successfully')
          }
          if (refreshAfter) {
            setRefreshKey((prev) => prev + 1)
          }
        } else {
          const errorData = await response.json()
          const errorMessage = errorData.error || defaultErrorMessage
          if (onError) {
            onError(errorData)
          } else {
            error(errorMessage)
          }
        }
      } catch (err) {
        error(defaultErrorMessage)
        console.error(`${logPrefix}:`, err)
      } finally {
        if (loadingStateSetter) loadingStateSetter(false)
      }
    },
    [apiUrl, success, error, setRefreshKey]
  )

  const queueJob = async (jobConfig: {
    type: string
    data: Record<string, unknown>
    priority: string
    successMessage: string
    errorMessage: string
    logMessage: string
  }) => {
    try {
      // If no accountId provided and not a fan-out job, get the first email account
      let jobData = jobConfig.data
      if (!jobConfig.data.accountId && !jobConfig.data.fanOut) {
        const accountsResponse = await fetch(`${apiUrl}/api/email-accounts`, {
          credentials: 'include',
        })

        if (!accountsResponse.ok) {
          error('Please add an email account first')
          return
        }

        const accounts = await accountsResponse.json()
        if (!accounts || accounts.length === 0) {
          error('Please add an email account first')
          return
        }

        const firstAccount = accounts[0]
        jobData = { accountId: firstAccount.id, ...jobConfig.data }
      }

      // Queue the job
      const response = await fetch(`${apiUrl}/api/jobs/queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          type: jobConfig.type,
          data: jobData,
          priority: jobConfig.priority,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        success(`${jobConfig.successMessage}: ${data.jobId}`)
        // Trigger refresh to show the new job
        setTimeout(() => setRefreshKey((prev) => prev + 1), 300)
      } else {
        const errorData = await response.json()
        error(errorData.error || jobConfig.errorMessage)
      }
    } catch (err) {
      error(jobConfig.errorMessage)
      console.error(jobConfig.logMessage, err)
    }
  }

  const handleCheckAllNow = async () => {
    try {
      // Create a single parent fan-out job that will spawn child jobs for each monitored account
      await queueJob({
        type: 'process-inbox',
        data: {
          // No accountId = parent fan-out job
          folderName: 'INBOX',
          fanOut: true, // Flag to indicate this should fan out to all monitored accounts
        },
        priority: 'high',
        successMessage: 'Email check queued for all monitored accounts',
        errorMessage: 'Failed to queue email check',
        logMessage: 'Error queueing email check:',
      })
    } catch (err) {
      error('Failed to queue email checks')
      console.error('Error:', err)
    }
  }

  const handleUpdateAllTones = async () => {
    try {
      // Create a single parent fan-out job that will spawn child jobs for each account
      await queueJob({
        type: 'build-tone-profile',
        data: {
          // No accountId = parent fan-out job
          historyDays: 30,
          fanOut: true, // Flag to indicate this should fan out to all accounts
        },
        priority: 'high',
        successMessage: 'Tone rebuild queued for all accounts',
        errorMessage: 'Failed to queue tone rebuild',
        logMessage: 'Error queueing tone rebuild:',
      })
    } catch (err) {
      error('Failed to queue tone updates')
      console.error('Error:', err)
    }
  }

  const handleWorkersToggle = async (enabled: boolean) => {
    const endpoint = enabled ? '/api/workers/resume' : '/api/workers/pause'

    await handleApiRequest({
      endpoint,
      loadingStateSetter: setIsLoadingWorkers,
      onSuccess: (data) => {
        const statusData = data.status as { workersPaused?: boolean }
        setWorkersActive(!statusData?.workersPaused)
        success(data.message as string)
      },
      defaultErrorMessage: 'Failed to toggle workers',
      logPrefix: 'Error toggling workers',
    })
  }

  const handleEmergencyToggle = async () => {
    const endpoint = queuesEmergencyPaused
      ? '/api/workers/resume-queues'
      : '/api/workers/emergency-pause'

    await handleApiRequest({
      endpoint,
      loadingStateSetter: setIsLoadingEmergency,
      onSuccess: (data) => {
        setQueuesEmergencyPaused(!queuesEmergencyPaused)
        success(data.message as string)
      },
      defaultErrorMessage: 'Failed to toggle emergency pause',
      logPrefix: 'Error toggling emergency pause',
    })
  }

  const handleClearQueue = async () => {
    await handleApiRequest({
      endpoint: '/api/jobs/clear-pending-jobs',
      onSuccess: (data) => {
        success(`Cleared ${data.cleared || 0} pending jobs (queued/prioritized)`)
        // Refresh stats after clearing
        fetchStats()
      },
      defaultErrorMessage: 'Failed to clear pending jobs',
      logPrefix: 'Error clearing pending jobs',
    })
  }

  const handleObliterateQueue = async () => {
    await handleApiRequest({
      endpoint: '/api/jobs/clear-all-queues',
      onSuccess: (data) => {
        success(`Obliterated ${data.cleared || 0} jobs from all queues`)
        // Refresh stats after clearing
        fetchStats()
      },
      defaultErrorMessage: 'Failed to obliterate all queues',
      logPrefix: 'Error obliterating all queues',
    })
  }

  // Fetch stats
  const fetchStats = useCallback(async () => {
    await handleApiRequest({
      endpoint: '/api/jobs/stats',
      method: 'GET',
      onSuccess: (data) => {
        // Update queue-specific stats if available
        if (data.queues) {
          const queues = data.queues as {
            emailProcessing?: {
              active: number
              waiting: number
              prioritized?: number
              completed: number
              failed: number
              delayed: number
              paused: number
              isPaused?: boolean
            }
            toneProfile?: {
              active: number
              waiting: number
              prioritized?: number
              completed: number
              failed: number
              delayed: number
              paused: number
              isPaused?: boolean
            }
          }
          setQueueStats({
            emailProcessing: queues.emailProcessing || {
              active: 0,
              waiting: 0,
              prioritized: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
              paused: 0,
            },
            toneProfile: queues.toneProfile || {
              active: 0,
              waiting: 0,
              prioritized: 0,
              completed: 0,
              failed: 0,
              delayed: 0,
              paused: 0,
            },
          })
        }
      },
      onError: () => {
        // Silent error handling for stats - don't show toast
      },
      defaultErrorMessage: 'Failed to fetch stats',
      logPrefix: 'Error fetching stats',
      refreshAfter: false,
    })
  }, [handleApiRequest])

  // Fetch scheduler status
  const fetchSchedulers = useCallback(async () => {
    await handleApiRequest({
      endpoint: '/api/schedulers',
      method: 'GET',
      onSuccess: (data) => {
        const schedulerData = data as {
          schedulers?: Array<{
            id: string
            enabled: boolean
            interval: number
            description: string
            monitoredAccounts: number
            nextRun?: string
          }>
        }
        setSchedulers(schedulerData.schedulers || [])
      },
      onError: () => {
        // Silent error handling for schedulers - don't show toast
      },
      defaultErrorMessage: 'Failed to fetch schedulers',
      logPrefix: 'Error fetching schedulers',
      refreshAfter: false,
    })
  }, [handleApiRequest])

  // Handle global scheduler toggle
  const handleSchedulerToggle = async (schedulerId: string, enabled: boolean) => {
    await handleApiRequest({
      endpoint: `/api/schedulers/${schedulerId}`,
      method: 'PUT',
      body: { enabled },
      loadingStateSetter: setIsLoadingSchedulers,
      onSuccess: (data) => {
        success(data.message as string)
        fetchSchedulers() // Refresh scheduler list
        if (enabled) {
          // Refresh jobs to show newly scheduled ones
          setTimeout(() => setRefreshKey((prev) => prev + 1), 500)
        }
      },
      defaultErrorMessage: `Failed to ${enabled ? 'enable' : 'disable'} scheduler`,
      logPrefix: 'Error toggling scheduler',
      refreshAfter: false,
    })
  }

  // Check worker status and fetch stats on mount
  useEffect(() => {
    const checkWorkerStatus = async () => {
      await handleApiRequest({
        endpoint: '/api/workers/status',
        method: 'GET',
        onSuccess: (data) => {
          setWorkersActive(!(data.workersPaused as boolean))
          setQueuesEmergencyPaused(data.queuesPaused as boolean)
        },
        onError: () => {
          // Silent error handling for status check - don't show toast
        },
        defaultErrorMessage: 'Failed to check worker status',
        logPrefix: 'Error checking worker status',
        refreshAfter: false,
      })
    }
    checkWorkerStatus()
    fetchStats()
    fetchSchedulers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only run once on mount

  // Refresh stats when refreshKey changes
  useEffect(() => {
    if (refreshKey > 0) {
      fetchStats()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]) // Only re-run when refreshKey changes

  // Reset forceRefresh flag after it's been used
  useEffect(() => {
    if (forceRefresh) {
      const timer = setTimeout(() => {
        setForceRefresh(false)
      }, 100) // Reset after a short delay to ensure JobsMonitor processes it
      return () => clearTimeout(timer)
    }
  }, [forceRefresh])

  return (
    <div
      className="container mx-auto flex flex-col px-4 py-6 md:px-6"
      style={{ height: 'calc(100vh - 64px)' }}
    >
      <div className="mb-4 flex-shrink-0">
        <div className="mb-3">
          <h1 className="text-3xl font-bold text-zinc-900">Background Jobs</h1>
          <p className="mt-1 text-zinc-600">Monitor and manage background processing tasks</p>
        </div>

        {/* Single row with queue stats and controls */}
        <div className="flex items-start gap-2">
          {/* Queue Stats - aligned with Row 1 of controls */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {/* Email Queue Stats */}
              <div className="rounded-md border border-zinc-200 bg-white px-2 py-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-zinc-600">Email:</span>
                  <div className="flex items-center gap-1">
                    <span
                      className="text-xs font-semibold text-indigo-600"
                      title="Active - Currently processing"
                    >
                      {queueStats.emailProcessing.active}
                    </span>
                    <span className="text-xs text-zinc-400">/</span>
                    <span className="text-xs text-zinc-600" title="Queued - Waiting to process">
                      {(queueStats.emailProcessing.waiting || 0) +
                        (queueStats.emailProcessing.prioritized || 0)}
                    </span>
                    <span className="text-xs text-zinc-400">/</span>
                    <span
                      className="text-xs text-green-600"
                      title="Completed - Successfully processed"
                    >
                      {queueStats.emailProcessing.completed}
                    </span>
                    <span className="text-xs text-zinc-400">/</span>
                    <span className="text-xs text-red-600" title="Failed - Encountered errors">
                      {queueStats.emailProcessing.failed}
                    </span>
                  </div>
                </div>
              </div>

              {/* Tone Queue Stats */}
              <div className="rounded-md border border-zinc-200 bg-white px-2 py-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-zinc-600">Tone:</span>
                  <div className="flex items-center gap-1">
                    <span
                      className="text-xs font-semibold text-indigo-600"
                      title="Active - Currently processing"
                    >
                      {queueStats.toneProfile.active}
                    </span>
                    <span className="text-xs text-zinc-400">/</span>
                    <span className="text-xs text-zinc-600" title="Queued - Waiting to process">
                      {(queueStats.toneProfile.waiting || 0) +
                        (queueStats.toneProfile.prioritized || 0)}
                    </span>
                    <span className="text-xs text-zinc-400">/</span>
                    <span
                      className="text-xs text-green-600"
                      title="Completed - Successfully processed"
                    >
                      {queueStats.toneProfile.completed}
                    </span>
                    <span className="text-xs text-zinc-400">/</span>
                    <span className="text-xs text-red-600" title="Failed - Encountered errors">
                      {queueStats.toneProfile.failed}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Controls - Split into two rows */}
          <div className="flex flex-col items-end gap-1">
            {/* Row 1: Schedulers and Toggles */}
            <div className="flex items-center gap-1">
              {/* Scheduler Toggles */}
              <span className="mr-1 text-xs font-medium text-zinc-600">Schedulers:</span>
              {schedulers.map((scheduler) => {
                const intervalStr =
                  scheduler.interval >= 3600000
                    ? `${Math.round(scheduler.interval / 3600000)}h`
                    : scheduler.interval >= 60000
                      ? `${Math.round(scheduler.interval / 60000)}m`
                      : `${Math.round(scheduler.interval / 1000)}s`

                // Safely format next run time
                let nextRunStr = 'Not scheduled'
                if (scheduler.nextRun) {
                  const nextRunDate = new Date(scheduler.nextRun)
                  if (!isNaN(nextRunDate.getTime())) {
                    nextRunStr = `Next: ${nextRunDate.toLocaleTimeString()}`
                  }
                }

                return (
                  <div
                    key={scheduler.id}
                    className="flex items-center gap-1 rounded border border-zinc-200 px-2 py-0.5"
                  >
                    <label
                      htmlFor={`scheduler-${scheduler.id}`}
                      className="cursor-pointer text-xs font-medium text-zinc-600"
                      title={`${scheduler.description}\n${scheduler.monitoredAccounts} account(s) monitored\nInterval: every ${intervalStr}\n${nextRunStr}`}
                    >
                      {scheduler.id === 'check-mail' ? '📧' : '🎨'}
                      <span className="ml-1 text-zinc-500">{intervalStr}</span>
                      {scheduler.monitoredAccounts > 0 && (
                        <span className="ml-1 text-xs text-zinc-400">
                          ({scheduler.monitoredAccounts})
                        </span>
                      )}
                    </label>
                    <Switch
                      id={`scheduler-${scheduler.id}`}
                      checked={scheduler.enabled}
                      onCheckedChange={(enabled) => handleSchedulerToggle(scheduler.id, enabled)}
                      disabled={isLoadingSchedulers}
                      className="scale-75"
                    />
                  </div>
                )
              })}
              <div className="mx-1 h-5 w-px bg-zinc-300" />
              <div className="flex items-center gap-1.5">
                <label htmlFor="workers-toggle" className="text-xs font-medium text-zinc-600">
                  Workers
                </label>
                <Switch
                  id="workers-toggle"
                  checked={workersActive}
                  onCheckedChange={handleWorkersToggle}
                  disabled={isLoadingWorkers}
                  className="scale-90"
                />
              </div>
              <div className="mx-1 h-5 w-px bg-zinc-300" />
              <Button
                onClick={handleCheckAllNow}
                className="h-7 bg-emerald-600 px-2 text-xs hover:bg-emerald-700"
                title={`Check most recent emails for all accounts - processes up to ${parseInt(process.env.NEXT_PUBLIC_INBOX_BATCH_SIZE || '3')} newest emails per account`}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Check {parseInt(process.env.NEXT_PUBLIC_INBOX_BATCH_SIZE || '3')} Most Recent
              </Button>
              <Button
                onClick={handleUpdateAllTones}
                className="h-7 bg-indigo-600 px-2 text-xs hover:bg-indigo-700"
                title="Update tone profiles for all accounts - analyzes writing style from recent emails"
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Update All Tones
              </Button>
            </div>

            {/* Row 2: Emergency & Maintenance */}
            <div className="flex items-center gap-1 border-t border-red-200 pt-2">
              <Button
                onClick={handleEmergencyToggle}
                disabled={isLoadingEmergency}
                className={
                  queuesEmergencyPaused
                    ? 'h-7 bg-green-600 px-2 text-xs hover:bg-green-700'
                    : 'h-7 bg-red-600 px-2 text-xs hover:bg-red-700'
                }
                title={
                  queuesEmergencyPaused
                    ? 'Resume all queues after emergency pause'
                    : '⚠️ Immediately pause all job queues - use only in emergencies'
                }
              >
                {queuesEmergencyPaused ? (
                  <>
                    <Play className="mr-1 h-3.5 w-3.5" />
                    Resume Queues
                  </>
                ) : (
                  <>
                    <Pause className="mr-1 h-3.5 w-3.5" />
                    Emergency Pause
                  </>
                )}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-7 border-red-200 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                    title="Remove all waiting/queued jobs from all queues"
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Clear Waiting
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>⚠️ Clear Waiting Jobs</AlertDialogTitle>
                    <AlertDialogDescription>
                      Remove all waiting/queued jobs from both queues? Active and completed jobs
                      will remain. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleClearQueue}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      🗑 Clear Jobs
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-7 border-red-300 px-2 text-xs font-semibold text-red-700 hover:bg-red-100 hover:text-red-800"
                    title="⚠️ DANGER: Delete ALL jobs and history from all queues"
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Obliterate All
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-red-600">
                      ⚠️ DANGER: Obliterate All Queues
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2">
                        <div className="font-semibold text-red-700">
                          This will delete ALL jobs (waiting, active, completed, failed) from all
                          queues. All job history will be lost. This cannot be undone.
                        </div>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleObliterateQueue}
                      className="bg-red-700 hover:bg-red-800"
                    >
                      💥 Obliterate Everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 flex-shrink-0">
        <JobsMonitor
          refreshTrigger={refreshKey}
          forceRefresh={forceRefresh}
          onJobComplete={fetchStats}
        />
      </div>

      {/* Real-Time Logs Panel - grows to fill remaining space */}
      <div className="min-h-0 flex-1">
        <ImapLogViewer emailAccountId="monitoring" className="h-full" hideHeader={false} />
      </div>
    </div>
  )
}
