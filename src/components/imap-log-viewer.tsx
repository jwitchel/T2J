'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Loader2,
  Trash2,
  PlayCircle,
  StopCircle,
  AlertCircle,
  CheckCircle,
  Info,
  XCircle,
  ChevronRight,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImapLogEntry {
  id: string
  timestamp: string
  userId: string
  emailAccountId: string
  level: 'debug' | 'info' | 'warn' | 'error'
  command: string
  data: {
    raw?: string
    parsed?: unknown
    response?: string
    duration?: number
    error?: string
  }
}

interface ImapLogViewerProps {
  emailAccountId: string
  className?: string
  hideHeader?: boolean
}

export function ImapLogViewer({
  emailAccountId,
  className,
  hideHeader = false,
}: ImapLogViewerProps) {
  // TODO: Use emailAccountId to filter logs for specific email account
  const [logs, setLogs] = useState<ImapLogEntry[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setIsConnecting(true)
    setError(null)

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = process.env.NEXT_PUBLIC_API_URL!.replace(/^https?:\/\//, '')
      const ws = new WebSocket(`${protocol}//${host}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('WebSocket connected')
        setIsConnected(true)
        setIsConnecting(false)
        setError(null)
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'initial-logs') {
            setLogs(data.logs || [])
          } else if (data.type === 'log' && data.log) {
            setLogs((prev) => [...(prev || []), data.log])
          } else if (data.type === 'logs-cleared') {
            setLogs([])
          } else if (data.type === 'job-event' && data.data) {
            // Handle job events from the queue system
            const jobEvent = data.data

            // Format job type display with email address if available
            let jobTypeDisplay: string
            if (jobEvent.emailAddress) {
              if (jobEvent.jobType === 'process-inbox') {
                jobTypeDisplay = `Process Email for ${jobEvent.emailAddress}`
              } else if (jobEvent.jobType === 'build-tone-profile') {
                jobTypeDisplay = `Rebuild Tone for ${jobEvent.emailAddress}`
              } else {
                jobTypeDisplay = jobEvent.jobType || ''
              }
            } else {
              // Parent jobs without specific email
              if (jobEvent.jobType === 'process-inbox') {
                jobTypeDisplay = 'Process All Emails'
              } else if (jobEvent.jobType === 'build-tone-profile') {
                jobTypeDisplay = 'Rebuild All Tones'
              } else {
                jobTypeDisplay = jobEvent.jobType || ''
              }
            }

            // Use a more unique ID with random component to avoid duplicates
            const uniqueId = `job-${jobEvent.jobId}-${jobEvent.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

            // Format header (easy to read) and body (detailed debugging)
            const eventTypeShort = jobEvent.type?.replace('JOB_', '').toLowerCase() || 'event'
            const header = jobEvent.emailAddress
              ? `${eventTypeShort}: ${jobTypeDisplay}`
              : `${eventTypeShort}: ${jobTypeDisplay}`

            const log: ImapLogEntry = {
              id: uniqueId,
              timestamp: data.timestamp || new Date().toISOString(),
              userId: jobEvent.userId || '',
              emailAccountId: emailAccountId || '',
              level: 'info',
              command: jobEvent.type || 'JOB_EVENT',
              data: {
                raw: header, // Clean readable header
                parsed: {
                  jobId: jobEvent.jobId,
                  type: jobEvent.type,
                  queue: jobEvent.queueName,
                  email: jobEvent.emailAddress,
                  ...jobEvent,
                }, // Detailed data for expanded view
              },
            }
            setLogs((prev) => [...(prev || []), log])
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err)
        }
      }

      ws.onerror = () => {
        // WebSocket errors don't provide useful information in the browser
        // The actual error details will be in the onclose event
        console.debug('WebSocket error event (check onclose for details)')
      }

      ws.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason)
        setIsConnected(false)
        setIsConnecting(false)
        wsRef.current = null

        // Handle authentication errors
        if (event.code === 1008 && event.reason === 'Authentication error') {
          setError('Authentication required. Please sign in first.')
          return
        }

        // Auto-reconnect after 5 seconds for unexpected closures (including abnormal closures like 1006)
        // Don't show error toast - the connection status badge already shows disconnected state
        if (event.code !== 1000 && !reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null
            setError(null)
            connect()
          }, 5000)
        }
      }
    } catch (err) {
      console.error('Failed to create WebSocket:', err)
      setError('Failed to connect to log server')
      setIsConnecting(false)
    }
  }, [emailAccountId])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setIsConnected(false)
    setLogs([])
  }, [])

  const clearLogs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'clear-logs' }))
    }
  }, [])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // Connect on mount with a small delay to ensure auth is established
  useEffect(() => {
    const timer = setTimeout(() => {
      connect()
    }, 500) // Small delay to ensure authentication is ready

    return () => {
      clearTimeout(timer)
      disconnect()
    }
  }, [connect, disconnect])

  const getLogIcon = (level: string) => {
    switch (level) {
      case 'error':
        return <XCircle className="h-3 w-3" />
      case 'warn':
        return <AlertCircle className="h-3 w-3" />
      case 'info':
        return <CheckCircle className="h-3 w-3" />
      default:
        return <Info className="h-3 w-3" />
    }
  }

  const getLogColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-500'
      case 'warn':
        return 'text-yellow-500'
      case 'info':
        return 'text-blue-500'
      default:
        return 'text-zinc-500'
    }
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const toggleLogExpanded = (logId: string) => {
    setExpandedLogs((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(logId)) {
        newSet.delete(logId)
      } else {
        newSet.add(logId)
      }
      return newSet
    })
  }

  const getLogSummary = (log: ImapLogEntry) => {
    // Create a concise summary for the single-line view
    if (log.data.raw) {
      return log.data.raw.substring(0, 100) + (log.data.raw.length > 100 ? '...' : '')
    }
    if (log.data.response) {
      return log.data.response.substring(0, 100) + (log.data.response.length > 100 ? '...' : '')
    }
    if (log.data.parsed) {
      return JSON.stringify(log.data.parsed).substring(0, 100) + '...'
    }
    if (log.data.error) {
      return `Error: ${log.data.error}`
    }
    return 'No data'
  }

  return (
    <Card
      className={cn('flex h-full flex-col overflow-hidden', hideHeader ? 'pt-0' : '', className)}
    >
      {!hideHeader && (
        <div className="flex flex-shrink-0 items-center justify-between border-b px-2 py-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Real-Time Logs</h3>
            <Badge variant={isConnected ? 'default' : 'secondary'} className="py-0 text-xs">
              {isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoScroll(!autoScroll)}
              className={cn(autoScroll && 'bg-zinc-100')}
            >
              Auto-scroll: {autoScroll ? 'On' : 'Off'}
            </Button>
            {!isConnected ? (
              <Button variant="outline" size="sm" onClick={connect} disabled={isConnecting}>
                {isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={disconnect}>
                <StopCircle className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={clearLogs}
              disabled={!isConnected || !logs || logs.length === 0}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {hideHeader && (
        <div className="flex flex-shrink-0 items-center justify-between border-b px-2 py-1">
          <div className="flex items-center gap-2">
            <Badge variant={isConnected ? 'default' : 'secondary'} className="py-0 text-xs">
              {isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAutoScroll(!autoScroll)}
              className={cn(autoScroll && 'bg-zinc-100')}
            >
              Auto-scroll: {autoScroll ? 'On' : 'Off'}
            </Button>
            {!isConnected ? (
              <Button variant="outline" size="sm" onClick={connect} disabled={isConnecting}>
                {isConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={disconnect}>
                <StopCircle className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={clearLogs}
              disabled={!isConnected || !logs || logs.length === 0}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="m-4 flex-shrink-0">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error}
            {error.includes('connection error') && (
              <div className="mt-2 text-sm">
                <p>Troubleshooting tips:</p>
                <ul className="mt-1 list-inside list-disc">
                  <li>Ensure you&apos;re signed in to your account</li>
                  <li>Check that the backend server is running on port 3002</li>
                  <li>Try refreshing the page</li>
                </ul>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-xs" ref={scrollAreaRef}>
        {!logs || logs.length === 0 ? (
          <div className="py-8 text-center font-sans text-zinc-500">
            {isConnected ? 'No logs yet. Waiting for system activity...' : 'Connect to view logs.'}
          </div>
        ) : (
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {logs.map((log) => {
              const isExpanded = expandedLogs.has(log.id)
              return (
                <div key={log.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  {/* Single line view */}
                  <div
                    className="flex cursor-pointer items-center gap-2 px-2 py-0.5"
                    onClick={() => toggleLogExpanded(log.id)}
                  >
                    {/* Expand icon */}
                    <div className="w-3 flex-shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-zinc-400" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-zinc-400" />
                      )}
                    </div>

                    {/* Timestamp */}
                    <div className="w-24 flex-shrink-0 text-zinc-500">
                      {formatTimestamp(log.timestamp)}
                    </div>

                    {/* Level icon */}
                    <div className={cn('flex-shrink-0', getLogColor(log.level))}>
                      {getLogIcon(log.level)}
                    </div>

                    {/* Command badge */}
                    <div className="flex-shrink-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 px-1 py-0 text-[10px]',
                          // Job events
                          log.command?.startsWith('JOB_') && 'border-indigo-500 text-indigo-600',
                          log.command === 'JOB_COMPLETED' && 'border-green-500 text-green-600',
                          log.command === 'JOB_FAILED' && 'border-red-500 text-red-600',
                          // Worker events
                          log.command?.startsWith('WORKER_') && 'border-cyan-500 text-cyan-600',
                          log.command === 'WORKER_INBOX_COMPLETE' &&
                            'border-green-500 text-green-600',
                          // Monitoring events
                          log.command?.includes('MONITORING') && 'border-blue-500 text-blue-600',
                          // IMAP operations
                          log.command?.startsWith('IMAP') && 'border-purple-500 text-purple-600',
                          log.command === 'CONNECT' && 'border-zinc-500 text-zinc-600',
                          log.command === 'IDLE' && 'border-amber-500 text-amber-600',
                          // Email processing
                          log.command?.startsWith('email.') && 'border-purple-500 text-purple-600',
                          log.command?.startsWith('nlp.') && 'border-blue-500 text-blue-600',
                          log.command?.startsWith('relationship.') &&
                            'border-green-500 text-green-600',
                          log.command?.startsWith('person.') && 'border-yellow-500 text-yellow-600',
                          log.command?.startsWith('vector.') && 'border-orange-500 text-orange-600',
                          log.command?.startsWith('style.') && 'border-pink-500 text-pink-600',
                          log.command?.startsWith('prompt.') && 'border-indigo-500 text-indigo-600',
                          log.command === 'pipeline.complete' &&
                            'border-emerald-500 font-semibold text-emerald-600'
                        )}
                      >
                        {log.command}
                      </Badge>
                    </div>

                    {/* Duration */}
                    {log.data?.duration && (
                      <div className="w-12 flex-shrink-0 text-right text-zinc-500">
                        {log.data.duration}ms
                      </div>
                    )}

                    {/* Summary */}
                    <div className="flex-1 truncate text-zinc-600 dark:text-zinc-400">
                      {getLogSummary(log)}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/50 px-8 pb-2 dark:border-zinc-800 dark:bg-zinc-900/50">
                      {/* Raw data */}
                      {log.data.raw && (
                        <div>
                          <div className="mb-1 text-[10px] text-zinc-500">Raw</div>
                          <pre className="overflow-x-auto rounded border border-zinc-200 bg-white p-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-900">
                            {log.data.raw}
                          </pre>
                        </div>
                      )}

                      {/* Parsed data */}
                      {log.data.parsed !== undefined && log.data.parsed !== null && (
                        <div>
                          <div className="mb-1 text-[10px] text-zinc-500">Parsed</div>
                          <pre className="overflow-x-auto rounded border border-zinc-200 bg-white p-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-900">
                            {JSON.stringify(log.data.parsed, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Response */}
                      {log.data.response && (
                        <div>
                          <div className="mb-1 text-[10px] text-zinc-500">Response</div>
                          <pre className="overflow-x-auto rounded border border-zinc-200 bg-white p-2 text-[11px] whitespace-pre-wrap dark:border-zinc-700 dark:bg-zinc-900">
                            {log.data.response}
                          </pre>
                        </div>
                      )}

                      {/* Error */}
                      {log.data.error && (
                        <div>
                          <div className="mb-1 text-[10px] text-red-500">Error</div>
                          <pre className="rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-600 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
                            {log.data.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}
