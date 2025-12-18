'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface JobProgress {
  current: number
  total: number
  percentage: number
  currentTask: string
}

interface JobData {
  jobId: string
  queueName: string
  type: string
  status:
    | 'queued'
    | 'waiting'
    | 'prioritized'
    | 'delayed'
    | 'paused'
    | 'active'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | string
  progress?: JobProgress
  result?: {
    profilesCreated?: number
    emailsAnalyzed?: number
    emailsProcessed?: number
  }
  error?: string
  timestamp: string
  duration?: number
  priority?: string
  startedAt?: string
  completedAt?: string
  emailAddress?: string
}

interface ApiJobData {
  jobId: string
  queueName: string
  type: string
  status:
    | 'queued'
    | 'waiting'
    | 'prioritized'
    | 'delayed'
    | 'paused'
    | 'active'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | string
  progress?: JobProgress
  result?: {
    profilesCreated?: number
    emailsAnalyzed?: number
    emailsProcessed?: number
  }
  error?: string
  createdAt: string
  duration?: number
  priority?: string
  processedAt?: string | null
  completedAt?: string | null
  emailAddress?: string
}

function formatTimestamp(timestamp: string): string {
  if (!timestamp) return 'N/A'

  const date = new Date(timestamp)

  // Check if date is valid
  if (isNaN(date.getTime())) {
    return 'N/A'
  }

  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`

  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
}

function convertApiJobToJobData(apiJob: ApiJobData): JobData {
  return {
    jobId: apiJob.jobId,
    queueName: apiJob.queueName,
    type: apiJob.type,
    status: apiJob.status,
    progress: apiJob.progress,
    result: apiJob.result,
    error: apiJob.error,
    timestamp: apiJob.createdAt,
    duration: apiJob.duration,
    startedAt: apiJob.processedAt || undefined,
    completedAt: apiJob.completedAt || undefined,
    emailAddress: apiJob.emailAddress,
  }
}

function JobCard({
  job,
  onRetry,
}: {
  job: JobData
  onRetry: (jobId: string, queueName: string) => void
}) {
  const statusConfig = {
    queued: { variant: 'secondary' as const, icon: Clock, color: 'text-zinc-500' },
    waiting: { variant: 'secondary' as const, icon: Clock, color: 'text-zinc-500' },
    prioritized: { variant: 'secondary' as const, icon: Clock, color: 'text-zinc-500' },
    delayed: { variant: 'secondary' as const, icon: Clock, color: 'text-orange-500' },
    paused: { variant: 'secondary' as const, icon: Clock, color: 'text-yellow-500' },
    active: { variant: 'default' as const, icon: Loader2, color: 'text-indigo-600' },
    completed: { variant: 'default' as const, icon: CheckCircle, color: 'text-green-600' },
    failed: { variant: 'destructive' as const, icon: XCircle, color: 'text-red-600' },
    cancelled: { variant: 'secondary' as const, icon: XCircle, color: 'text-zinc-400' },
  }

  // Provide a default config for unknown statuses
  const config = statusConfig[job.status as keyof typeof statusConfig] || {
    variant: 'secondary' as const,
    icon: Clock,
    color: 'text-zinc-400',
  }
  const Icon = config.icon

  // Display job type with email address if available
  let jobTypeDisplay: string
  if (job.emailAddress) {
    if (job.type === 'process-inbox') {
      jobTypeDisplay = `Process Email for ${job.emailAddress}`
    } else if (job.type === 'build-tone-profile') {
      jobTypeDisplay = `Rebuild Tone for ${job.emailAddress}`
    } else {
      jobTypeDisplay = job.type
    }
  } else {
    jobTypeDisplay =
      {
        'build-tone-profile': 'Rebuild All Tones',
        'process-inbox': 'Process All Emails',
        'learn-from-edit': 'Learn From Edit',
      }[job.type] || job.type
  }

  return (
    <div className="flex items-center justify-between border-b border-zinc-100 px-2 py-1.5 text-xs hover:bg-zinc-50">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Icon
          className={`h-3 w-3 ${config.color} ${job.status === 'active' ? 'animate-spin' : ''} flex-shrink-0`}
        />
        <span className="truncate font-medium">{jobTypeDisplay}</span>
        <Badge variant={config.variant} className="h-4 px-1.5 py-0 text-[10px]">
          {job.status}
        </Badge>
        {job.priority && job.priority !== 'normal' && (
          <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px]">
            {job.priority}
          </Badge>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className="text-[10px] text-zinc-500">{formatTimestamp(job.timestamp)}</span>
        {job.status === 'failed' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRetry(job.jobId, job.queueName)}
            className="h-5 px-1.5 text-[10px] hover:bg-zinc-100"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

interface JobsMonitorProps {
  refreshTrigger?: number
  forceRefresh?: boolean
  onJobComplete?: () => void
}

export function JobsMonitor({ refreshTrigger, forceRefresh, onJobComplete }: JobsMonitorProps) {
  const [jobs, setJobs] = useState<Map<string, JobData>>(new Map())
  const [loading, setLoading] = useState(true)
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const loadJobsRef = useRef<((forceReplace?: boolean) => Promise<void>) | undefined>(undefined)
  const pendingLoadJobs = useRef<Set<string>>(new Set()) // Track pending loadJobs calls
  const onJobCompleteRef = useRef(onJobComplete)

  // Keep ref in sync with prop
  useEffect(() => {
    onJobCompleteRef.current = onJobComplete
  }, [onJobComplete])

  // Load jobs from API - memoized to be called from multiple places
  const loadJobs = async (forceReplace: boolean = false) => {
    try {
      const response = await fetch('/api/jobs/list', {
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()

        if (forceReplace) {
          // Replace all jobs with API data (used for refresh after clear operations)
          const newJobs = new Map<string, JobData>()

          for (const apiJob of data.jobs) {
            const jobKey = `${apiJob.queueName}:${apiJob.jobId}`
            const jobData = convertApiJobToJobData(apiJob)
            newJobs.set(jobKey, jobData)
          }

          setJobs(newJobs)
        } else {
          // Merge API data with existing WebSocket state (normal operation)
          setJobs((prevJobs) => {
            const newJobs = new Map(prevJobs)

            for (const apiJob of data.jobs) {
              // Use composite key: queueName:jobId to handle job ID reuse across queues
              const jobKey = `${apiJob.queueName}:${apiJob.jobId}`
              const existing = newJobs.get(jobKey)
              const jobData = convertApiJobToJobData(apiJob)

              // Prefer existing WebSocket data for active jobs, API data for others
              if (!existing || existing.status === 'queued' || apiJob.status !== 'queued') {
                newJobs.set(jobKey, jobData)
              }
            }

            return newJobs
          })
        }
      }
    } catch (error) {
      console.error('Failed to load jobs:', error)
    } finally {
      setLoading(false)
    }
  }

  // Store loadJobs ref for use in WebSocket handler
  loadJobsRef.current = loadJobs

  // Load initial jobs from API and when refresh is triggered
  useEffect(() => {
    loadJobs(forceRefresh)
  }, [refreshTrigger, forceRefresh])

  // Set up WebSocket connection for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    console.log('JobsMonitor: Connecting to WebSocket:', wsUrl)

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('JobsMonitor: WebSocket connected')
      setIsConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)

        // Handle job events from unified WebSocket
        if (data.type === 'job-event' && data.data) {
          const event = data.data

          setJobs((prev) => {
            const newJobs = new Map(prev)
            // Use composite key: queueName:jobId to handle job ID reuse across queues
            const jobKey = `${event.queueName}:${event.jobId}`
            const existingJob = newJobs.get(jobKey) || ({} as JobData)

            switch (event.type) {
              case 'JOB_QUEUED':
                // Always update the job in our state immediately
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: event.jobId,
                  queueName: event.queueName || existingJob.queueName,
                  type: event.jobType || existingJob.type,
                  status: 'queued',
                  timestamp: event.timestamp || new Date().toISOString(),
                  priority: event.priority,
                  emailAddress: event.emailAddress || existingJob.emailAddress,
                })

                // For completely new jobs, also fetch full details from API (with deduplication)
                if (
                  !existingJob.jobId &&
                  loadJobsRef.current &&
                  !pendingLoadJobs.current.has(jobKey)
                ) {
                  pendingLoadJobs.current.add(jobKey)

                  // Delay slightly to ensure job is fully persisted in Redis
                  setTimeout(() => {
                    pendingLoadJobs.current.delete(jobKey)
                    loadJobsRef.current!()
                  }, 200)
                }
                break

              case 'JOB_ACTIVE':
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: event.jobId || existingJob.jobId,
                  queueName: event.queueName || existingJob.queueName,
                  type: event.jobType || existingJob.type,
                  status: 'active',
                  timestamp: existingJob.timestamp || event.timestamp || new Date().toISOString(),
                  startedAt: event.startedAt || new Date().toISOString(),
                  emailAddress: event.emailAddress || existingJob.emailAddress,
                })
                break

              case 'JOB_PROGRESS':
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: event.jobId || existingJob.jobId,
                  queueName: event.queueName || existingJob.queueName,
                  type: event.jobType || existingJob.type,
                  status: 'active',
                  timestamp: existingJob.timestamp || event.timestamp || new Date().toISOString(),
                  progress: event.progress,
                  emailAddress: event.emailAddress || existingJob.emailAddress,
                })
                break

              case 'JOB_COMPLETED':
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: event.jobId || existingJob.jobId,
                  queueName: event.queueName || existingJob.queueName,
                  type: event.jobType || existingJob.type,
                  status: 'completed',
                  timestamp: existingJob.timestamp || event.timestamp || new Date().toISOString(),
                  result: event.result,
                  completedAt: new Date().toISOString(),
                  emailAddress: event.emailAddress || existingJob.emailAddress,
                })
                // Trigger stats refresh when a job completes
                if (onJobCompleteRef.current) {
                  onJobCompleteRef.current()
                }
                break

              case 'JOB_FAILED':
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: event.jobId || existingJob.jobId,
                  queueName: event.queueName || existingJob.queueName,
                  type: event.jobType || existingJob.type,
                  status: 'failed',
                  timestamp: existingJob.timestamp || event.timestamp || new Date().toISOString(),
                  error: event.error,
                  completedAt: event.failedAt || new Date().toISOString(),
                  emailAddress: event.emailAddress || existingJob.emailAddress,
                })
                // Trigger stats refresh when a job fails
                if (onJobCompleteRef.current) {
                  onJobCompleteRef.current()
                }
                break

              case 'QUEUE_CLEARED':
                // Clear ALL jobs from the UI when queue is cleared
                return new Map()
            }

            return newJobs
          })
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    ws.onerror = (error) => {
      console.error('JobsMonitor: WebSocket error:', error)
      setIsConnected(false)
    }

    ws.onclose = () => {
      console.log('JobsMonitor: WebSocket disconnected')
      setIsConnected(false)
    }

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
    }
  }, []) // Empty dependency array - only connect once on mount

  const handleRetry = async (jobId: string, queueName: string) => {
    try {
      const response = await fetch(`/api/jobs/${queueName}/${jobId}/retry`, {
        method: 'POST',
        credentials: 'include',
      })

      if (response.ok) {
        const data = await response.json()
        // New job will be added via WebSocket
        console.log('Retrying job:', data)
      }
    } catch (error) {
      console.error('Failed to retry job:', error)
    }
  }

  const sortedJobs = useMemo(() => {
    return Array.from(jobs.values()).sort((a, b) => {
      // Sort by timestamp, newest first
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    })
  }, [jobs])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div>
      {/* Job List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Background Jobs</CardTitle>
              <CardDescription className="text-xs">
                Real-time status of all background processing
              </CardDescription>
            </div>
            {!loading && (
              <div className="flex items-center gap-1.5">
                <div
                  className={`h-1.5 w-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-zinc-400'}`}
                />
                <span className="text-[10px] text-zinc-500">
                  {isConnected ? 'Live' : 'Offline'}
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[200px] overflow-y-auto">
            {sortedJobs.length > 0 ? (
              <div>
                {sortedJobs.slice(0, 20).map((job, index) => (
                  <JobCard
                    key={`${job.jobId}-${job.timestamp}-${index}`}
                    job={job}
                    onRetry={handleRetry}
                  />
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-zinc-500">No background jobs yet</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
