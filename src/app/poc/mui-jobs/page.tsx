'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Switch,
  Chip,
  Stack,
  CircularProgress,
  Tooltip,
  Divider,
  FormControlLabel,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  Pause as PauseIcon,
  PlayArrow as PlayIcon,
  Schedule as ScheduleIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  HourglassEmpty as WaitingIcon,
  Loop as ActiveIcon,
} from '@mui/icons-material';
import { useConfirm } from 'material-ui-confirm';
import { useMuiToast } from '@/hooks/use-mui-toast';
import { useAuth } from '@/lib/auth-context';
import { MuiAuthenticatedLayout, MuiLogViewer } from '@/components/mui';

// Types
interface JobProgress {
  current: number;
  total: number;
  percentage: number;
  currentTask: string;
}

interface JobData {
  jobId: string;
  queueName: string;
  type: string;
  status: string;
  progress?: JobProgress;
  result?: {
    profilesCreated?: number;
    emailsAnalyzed?: number;
    emailsProcessed?: number;
  };
  error?: string;
  timestamp: string;
  duration?: number;
  priority?: string;
  startedAt?: string;
  completedAt?: string;
  emailAddress?: string;
}

interface ApiJobData {
  jobId: string;
  queueName: string;
  type: string;
  status: string;
  progress?: JobProgress;
  result?: {
    profilesCreated?: number;
    emailsAnalyzed?: number;
    emailsProcessed?: number;
  };
  error?: string;
  createdAt: string;
  duration?: number;
  priority?: string;
  processedAt?: string | null;
  completedAt?: string | null;
  emailAddress?: string;
}

interface Scheduler {
  id: string;
  enabled: boolean;
  interval: number;
  description: string;
  monitoredAccounts: number;
  nextRun?: string;
}

interface QueueStats {
  active: number;
  waiting: number;
  prioritized?: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  isPaused?: boolean;
}

// Helper functions
function formatTimestamp(timestamp: string): string {
  if (!timestamp) return 'N/A';

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'N/A';

  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
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
  };
}

function formatInterval(ms: number): string {
  if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

// Job Row Component
function JobRow({ job, onRetry }: { job: JobData; onRetry: (jobId: string, queueName: string) => void }) {
  const statusConfig: Record<string, { color: 'default' | 'primary' | 'success' | 'error' | 'warning' | 'info'; icon: React.ReactNode }> = {
    queued: { color: 'default', icon: <WaitingIcon sx={{ fontSize: 14 }} /> },
    waiting: { color: 'default', icon: <WaitingIcon sx={{ fontSize: 14 }} /> },
    prioritized: { color: 'info', icon: <WaitingIcon sx={{ fontSize: 14 }} /> },
    delayed: { color: 'warning', icon: <ScheduleIcon sx={{ fontSize: 14 }} /> },
    paused: { color: 'warning', icon: <PauseIcon sx={{ fontSize: 14 }} /> },
    active: { color: 'primary', icon: <ActiveIcon sx={{ fontSize: 14, animation: 'spin 1s linear infinite' }} /> },
    completed: { color: 'success', icon: <CheckCircleIcon sx={{ fontSize: 14 }} /> },
    failed: { color: 'error', icon: <ErrorIcon sx={{ fontSize: 14 }} /> },
    cancelled: { color: 'default', icon: <ErrorIcon sx={{ fontSize: 14 }} /> },
  };

  const config = statusConfig[job.status] || { color: 'default' as const, icon: <WaitingIcon sx={{ fontSize: 14 }} /> };

  // Display job type with email address if available
  let jobTypeDisplay: string;
  if (job.emailAddress) {
    if (job.type === 'process-inbox') {
      jobTypeDisplay = `Process Email for ${job.emailAddress}`;
    } else if (job.type === 'build-tone-profile') {
      jobTypeDisplay = `Rebuild Tone for ${job.emailAddress}`;
    } else {
      jobTypeDisplay = job.type;
    }
  } else {
    jobTypeDisplay = {
      'build-tone-profile': 'Rebuild All Tones',
      'process-inbox': 'Process All Emails',
      'learn-from-edit': 'Learn From Edit',
    }[job.type] || job.type;
  }

  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0, flex: 1 }}>
        {config.icon}
        <Typography variant="body2" fontWeight="medium" noWrap>
          {jobTypeDisplay}
        </Typography>
        <Chip label={job.status} color={config.color} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
        {job.priority && job.priority !== 'normal' && (
          <Chip label={job.priority} variant="outlined" size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
        )}
      </Stack>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="caption" color="text.secondary">
          {formatTimestamp(job.timestamp)}
        </Typography>
        {job.status === 'failed' && (
          <Button size="small" onClick={() => onRetry(job.jobId, job.queueName)} sx={{ minWidth: 0, p: 0.5 }}>
            <RefreshIcon sx={{ fontSize: 16 }} />
          </Button>
        )}
      </Stack>
    </Stack>
  );
}

// Queue Stats Component
function QueueStatsDisplay({ label, stats }: { label: string; stats: QueueStats }) {
  return (
    <Paper variant="outlined" sx={{ px: 1.5, py: 0.5 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="caption" fontWeight="medium" color="text.secondary">
          {label}:
        </Typography>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Tooltip title="Active - Currently processing">
            <Typography variant="caption" fontWeight="bold" color="primary.main">
              {stats.active}
            </Typography>
          </Tooltip>
          <Typography variant="caption" color="text.disabled">/</Typography>
          <Tooltip title="Queued - Waiting to process">
            <Typography variant="caption" color="text.secondary">
              {(stats.waiting || 0) + (stats.prioritized || 0)}
            </Typography>
          </Tooltip>
          <Typography variant="caption" color="text.disabled">/</Typography>
          <Tooltip title="Completed - Successfully processed">
            <Typography variant="caption" color="success.main">
              {stats.completed}
            </Typography>
          </Tooltip>
          <Typography variant="caption" color="text.disabled">/</Typography>
          <Tooltip title="Failed - Encountered errors">
            <Typography variant="caption" color="error.main">
              {stats.failed}
            </Typography>
          </Tooltip>
        </Stack>
      </Stack>
    </Paper>
  );
}

export default function MuiJobsPage() {
  const { user, signOut } = useAuth();
  const { success, error: showError } = useMuiToast();
  const confirm = useConfirm();

  // State
  const [refreshKey, setRefreshKey] = useState(0);
  const [workersActive, setWorkersActive] = useState(false);
  const [isLoadingWorkers, setIsLoadingWorkers] = useState(false);
  const [queuesEmergencyPaused, setQueuesEmergencyPaused] = useState(false);
  const [isLoadingEmergency, setIsLoadingEmergency] = useState(false);
  const [schedulers, setSchedulers] = useState<Scheduler[]>([]);
  const [isLoadingSchedulers, setIsLoadingSchedulers] = useState(false);
  const [queueStats, setQueueStats] = useState<{ emailProcessing: QueueStats; toneProfile: QueueStats }>({
    emailProcessing: { active: 0, waiting: 0, prioritized: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
    toneProfile: { active: 0, waiting: 0, prioritized: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
  });

  // Jobs state
  const [jobs, setJobs] = useState<Map<string, JobData>>(new Map());
  const [jobsLoading, setJobsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const loadJobsRef = useRef<((forceReplace?: boolean) => Promise<void>) | undefined>(undefined);
  const pendingLoadJobs = useRef<Set<string>>(new Set());

  // API request helper
  const handleApiRequest = useCallback(
    async (config: {
      endpoint: string;
      method?: string;
      body?: unknown;
      loadingStateSetter?: (loading: boolean) => void;
      onSuccess?: (data: Record<string, unknown>) => void;
      onError?: (errorData: Record<string, unknown>) => void;
      defaultErrorMessage: string;
      logPrefix: string;
      refreshAfter?: boolean;
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
      } = config;

      if (loadingStateSetter) loadingStateSetter(true);

      try {
        const requestOptions: RequestInit = { method, credentials: 'include' };
        if (body) {
          requestOptions.headers = { 'Content-Type': 'application/json' };
          requestOptions.body = JSON.stringify(body);
        }

        const response = await fetch(endpoint, requestOptions);

        if (response.ok) {
          const data = await response.json();
          if (onSuccess) {
            onSuccess(data);
          } else {
            success(data.message || 'Operation completed successfully');
          }
          if (refreshAfter) {
            setRefreshKey((prev) => prev + 1);
          }
        } else {
          const errorData = await response.json();
          const errorMessage = errorData.error || defaultErrorMessage;
          if (onError) {
            onError(errorData);
          } else {
            showError(errorMessage);
          }
        }
      } catch (err) {
        showError(defaultErrorMessage);
        console.error(`${logPrefix}:`, err);
      } finally {
        if (loadingStateSetter) loadingStateSetter(false);
      }
    },
    [success, showError]
  );

  // Queue job helper
  const queueJob = async (jobConfig: {
    type: string;
    data: Record<string, unknown>;
    priority: string;
    successMessage: string;
    errorMessage: string;
    logMessage: string;
  }) => {
    try {
      let jobData = jobConfig.data;
      if (!jobConfig.data.accountId && !jobConfig.data.fanOut) {
        const accountsResponse = await fetch('/api/email-accounts', { credentials: 'include' });
        if (!accountsResponse.ok) {
          showError('Please add an email account first');
          return;
        }
        const accounts = await accountsResponse.json();
        if (!accounts || accounts.length === 0) {
          showError('Please add an email account first');
          return;
        }
        const firstAccount = accounts[0];
        jobData = { accountId: firstAccount.id, ...jobConfig.data };
      }

      const response = await fetch('/api/jobs/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type: jobConfig.type, data: jobData, priority: jobConfig.priority }),
      });

      if (response.ok) {
        const data = await response.json();
        success(`${jobConfig.successMessage}: ${data.jobId}`);
        setTimeout(() => setRefreshKey((prev) => prev + 1), 300);
      } else {
        const errorData = await response.json();
        showError(errorData.error || jobConfig.errorMessage);
      }
    } catch (err) {
      showError(jobConfig.errorMessage);
      console.error(jobConfig.logMessage, err);
    }
  };

  // Action handlers
  const handleCheckAllNow = () =>
    queueJob({
      type: 'process-inbox',
      data: { folderName: 'INBOX', fanOut: true },
      priority: 'high',
      successMessage: 'Email check queued for all monitored accounts',
      errorMessage: 'Failed to queue email check',
      logMessage: 'Error queueing email check:',
    });

  const handleUpdateAllTones = () =>
    queueJob({
      type: 'build-tone-profile',
      data: { historyDays: 30, fanOut: true },
      priority: 'high',
      successMessage: 'Tone rebuild queued for all accounts',
      errorMessage: 'Failed to queue tone rebuild',
      logMessage: 'Error queueing tone rebuild:',
    });

  const handleWorkersToggle = async (enabled: boolean) => {
    const endpoint = enabled ? '/api/workers/resume' : '/api/workers/pause';
    await handleApiRequest({
      endpoint,
      loadingStateSetter: setIsLoadingWorkers,
      onSuccess: (data) => {
        const statusData = data.status as { workersPaused?: boolean };
        setWorkersActive(!statusData?.workersPaused);
        success(data.message as string);
      },
      defaultErrorMessage: 'Failed to toggle workers',
      logPrefix: 'Error toggling workers',
    });
  };

  const handleEmergencyToggle = async () => {
    const endpoint = queuesEmergencyPaused ? '/api/workers/resume-queues' : '/api/workers/emergency-pause';
    await handleApiRequest({
      endpoint,
      loadingStateSetter: setIsLoadingEmergency,
      onSuccess: (data) => {
        setQueuesEmergencyPaused(!queuesEmergencyPaused);
        success(data.message as string);
      },
      defaultErrorMessage: 'Failed to toggle emergency pause',
      logPrefix: 'Error toggling emergency pause',
    });
  };

  const handleClearQueue = async () => {
    try {
      await confirm({
        title: 'Clear Waiting Jobs',
        description: 'Remove all waiting/queued jobs from both queues? Active and completed jobs will remain. This cannot be undone.',
        confirmationText: 'Clear Jobs',
        confirmationButtonProps: { color: 'error' },
      });
    } catch {
      return;
    }

    await handleApiRequest({
      endpoint: '/api/jobs/clear-pending-jobs',
      onSuccess: (data) => {
        success(`Cleared ${data.cleared || 0} pending jobs (queued/prioritized)`);
        fetchStats();
      },
      defaultErrorMessage: 'Failed to clear pending jobs',
      logPrefix: 'Error clearing pending jobs',
    });
  };

  const handleObliterateQueue = async () => {
    try {
      await confirm({
        title: 'DANGER: Obliterate All Queues',
        description: 'This will delete ALL jobs (waiting, active, completed, failed) from all queues. All job history will be lost. This cannot be undone.',
        confirmationText: 'Obliterate Everything',
        confirmationButtonProps: { color: 'error' },
      });
    } catch {
      return;
    }

    await handleApiRequest({
      endpoint: '/api/jobs/clear-all-queues',
      onSuccess: (data) => {
        success(`Obliterated ${data.cleared || 0} jobs from all queues`);
        fetchStats();
      },
      defaultErrorMessage: 'Failed to obliterate all queues',
      logPrefix: 'Error obliterating all queues',
    });
  };

  const handleSchedulerToggle = async (schedulerId: string, enabled: boolean) => {
    await handleApiRequest({
      endpoint: `/api/schedulers/${schedulerId}`,
      method: 'PUT',
      body: { enabled },
      loadingStateSetter: setIsLoadingSchedulers,
      onSuccess: (data) => {
        success(data.message as string);
        fetchSchedulers();
        if (enabled) {
          setTimeout(() => setRefreshKey((prev) => prev + 1), 500);
        }
      },
      defaultErrorMessage: `Failed to ${enabled ? 'enable' : 'disable'} scheduler`,
      logPrefix: 'Error toggling scheduler',
      refreshAfter: false,
    });
  };

  // Fetch functions
  const fetchStats = useCallback(async () => {
    await handleApiRequest({
      endpoint: '/api/jobs/stats',
      method: 'GET',
      onSuccess: (data) => {
        if (data.queues) {
          const queues = data.queues as { emailProcessing?: QueueStats; toneProfile?: QueueStats };
          setQueueStats({
            emailProcessing: queues.emailProcessing || { active: 0, waiting: 0, prioritized: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
            toneProfile: queues.toneProfile || { active: 0, waiting: 0, prioritized: 0, completed: 0, failed: 0, delayed: 0, paused: 0 },
          });
        }
      },
      onError: () => {},
      defaultErrorMessage: 'Failed to fetch stats',
      logPrefix: 'Error fetching stats',
      refreshAfter: false,
    });
  }, [handleApiRequest]);

  const fetchSchedulers = useCallback(async () => {
    await handleApiRequest({
      endpoint: '/api/schedulers',
      method: 'GET',
      onSuccess: (data) => {
        const schedulerData = data as { schedulers?: Scheduler[] };
        setSchedulers(schedulerData.schedulers || []);
      },
      onError: () => {},
      defaultErrorMessage: 'Failed to fetch schedulers',
      logPrefix: 'Error fetching schedulers',
      refreshAfter: false,
    });
  }, [handleApiRequest]);

  // Load jobs from API
  const loadJobs = useCallback(async (forceReplace: boolean = false) => {
    try {
      const response = await fetch('/api/jobs/list', { credentials: 'include' });

      if (response.ok) {
        const data = await response.json();

        if (forceReplace) {
          const newJobs = new Map<string, JobData>();
          for (const apiJob of data.jobs) {
            const jobKey = `${apiJob.queueName}:${apiJob.jobId}`;
            newJobs.set(jobKey, convertApiJobToJobData(apiJob));
          }
          setJobs(newJobs);
        } else {
          setJobs((prevJobs) => {
            const newJobs = new Map(prevJobs);
            for (const apiJob of data.jobs) {
              const jobKey = `${apiJob.queueName}:${apiJob.jobId}`;
              const existing = newJobs.get(jobKey);
              const jobData = convertApiJobToJobData(apiJob);
              if (!existing || existing.status === 'queued' || apiJob.status !== 'queued') {
                newJobs.set(jobKey, jobData);
              }
            }
            return newJobs;
          });
        }
      }
    } catch (error) {
      console.error('Failed to load jobs:', error);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  loadJobsRef.current = loadJobs;

  // Handle retry
  const handleRetry = async (jobId: string, queueName: string) => {
    try {
      const response = await fetch(`/api/jobs/${queueName}/${jobId}/retry`, {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Retrying job:', data);
      }
    } catch (error) {
      console.error('Failed to retry job:', error);
    }
  };

  // Initial load
  useEffect(() => {
    const checkWorkerStatus = async () => {
      await handleApiRequest({
        endpoint: '/api/workers/status',
        method: 'GET',
        onSuccess: (data) => {
          setWorkersActive(!(data.workersPaused as boolean));
          setQueuesEmergencyPaused(data.queuesPaused as boolean);
        },
        onError: () => {},
        defaultErrorMessage: 'Failed to check worker status',
        logPrefix: 'Error checking worker status',
        refreshAfter: false,
      });
    };
    checkWorkerStatus();
    fetchStats();
    fetchSchedulers();
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh stats when refreshKey changes
  useEffect(() => {
    if (refreshKey > 0) {
      fetchStats();
      loadJobs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('JobsMonitor: WebSocket connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'job-event' && data.data) {
          const wsEvent = data.data;

          setJobs((prev) => {
            const newJobs = new Map(prev);
            const jobKey = `${wsEvent.queueName}:${wsEvent.jobId}`;
            const existingJob = newJobs.get(jobKey) || ({} as JobData);

            switch (wsEvent.type) {
              case 'JOB_QUEUED':
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: wsEvent.jobId,
                  queueName: wsEvent.queueName || existingJob.queueName,
                  type: wsEvent.jobType || existingJob.type,
                  status: 'queued',
                  timestamp: wsEvent.timestamp || new Date().toISOString(),
                  priority: wsEvent.priority,
                  emailAddress: wsEvent.emailAddress || existingJob.emailAddress,
                });

                if (!existingJob.jobId && loadJobsRef.current && !pendingLoadJobs.current.has(jobKey)) {
                  pendingLoadJobs.current.add(jobKey);
                  setTimeout(() => {
                    pendingLoadJobs.current.delete(jobKey);
                    loadJobsRef.current!();
                  }, 200);
                }
                break;

              case 'JOB_ACTIVE':
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: wsEvent.jobId || existingJob.jobId,
                  queueName: wsEvent.queueName || existingJob.queueName,
                  type: wsEvent.jobType || existingJob.type,
                  status: 'active',
                  timestamp: existingJob.timestamp || wsEvent.timestamp || new Date().toISOString(),
                  startedAt: wsEvent.startedAt || new Date().toISOString(),
                  emailAddress: wsEvent.emailAddress || existingJob.emailAddress,
                });
                break;

              case 'JOB_PROGRESS':
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: wsEvent.jobId || existingJob.jobId,
                  queueName: wsEvent.queueName || existingJob.queueName,
                  type: wsEvent.jobType || existingJob.type,
                  status: 'active',
                  timestamp: existingJob.timestamp || wsEvent.timestamp || new Date().toISOString(),
                  progress: wsEvent.progress,
                  emailAddress: wsEvent.emailAddress || existingJob.emailAddress,
                });
                break;

              case 'JOB_COMPLETED':
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: wsEvent.jobId || existingJob.jobId,
                  queueName: wsEvent.queueName || existingJob.queueName,
                  type: wsEvent.jobType || existingJob.type,
                  status: 'completed',
                  timestamp: existingJob.timestamp || wsEvent.timestamp || new Date().toISOString(),
                  result: wsEvent.result,
                  completedAt: new Date().toISOString(),
                  emailAddress: wsEvent.emailAddress || existingJob.emailAddress,
                });
                fetchStats();
                break;

              case 'JOB_FAILED':
                newJobs.set(jobKey, {
                  ...existingJob,
                  jobId: wsEvent.jobId || existingJob.jobId,
                  queueName: wsEvent.queueName || existingJob.queueName,
                  type: wsEvent.jobType || existingJob.type,
                  status: 'failed',
                  timestamp: existingJob.timestamp || wsEvent.timestamp || new Date().toISOString(),
                  error: wsEvent.error,
                  completedAt: wsEvent.failedAt || new Date().toISOString(),
                  emailAddress: wsEvent.emailAddress || existingJob.emailAddress,
                });
                fetchStats();
                break;

              case 'QUEUE_CLEARED':
                return new Map();
            }

            return newJobs;
          });
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    ws.onerror = () => setIsConnected(false);
    ws.onclose = () => setIsConnected(false);

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [fetchStats]);

  const sortedJobs = useMemo(() => {
    return Array.from(jobs.values()).sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [jobs]);

  return (
    <MuiAuthenticatedLayout>
      {/* Page Header */}
      <Box mb={3}>
        <Typography variant="h4">Background Jobs</Typography>
        <Typography variant="body2" color="text.secondary">
          Monitor and manage background processing tasks
        </Typography>
      </Box>

      {/* Controls Section */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack spacing={2}>
          {/* Row 1: Queue Stats */}
          <Stack direction="row" spacing={2} alignItems="center">
            <QueueStatsDisplay label="Email" stats={queueStats.emailProcessing} />
            <QueueStatsDisplay label="Tone" stats={queueStats.toneProfile} />
            <Box flex={1} />
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: isConnected ? 'success.main' : 'text.disabled',
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {isConnected ? 'Live' : 'Offline'}
              </Typography>
            </Stack>
          </Stack>

          <Divider />

          {/* Row 2: Schedulers and Workers */}
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" fontWeight="medium" color="text.secondary">
              Schedulers:
            </Typography>
            {schedulers.map((scheduler) => {
              const intervalStr = formatInterval(scheduler.interval);
              let nextRunStr = 'Not scheduled';
              if (scheduler.nextRun) {
                const nextRunDate = new Date(scheduler.nextRun);
                if (!isNaN(nextRunDate.getTime())) {
                  nextRunStr = `Next: ${nextRunDate.toLocaleTimeString()}`;
                }
              }

              return (
                <Tooltip
                  key={scheduler.id}
                  title={`${scheduler.description}\n${scheduler.monitoredAccounts} account(s) monitored\nInterval: every ${intervalStr}\n${nextRunStr}`}
                >
                  <Paper variant="outlined" sx={{ px: 1, py: 0.5 }}>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={scheduler.enabled}
                          onChange={(e) => handleSchedulerToggle(scheduler.id, e.target.checked)}
                          disabled={isLoadingSchedulers}
                        />
                      }
                      label={
                        <Typography variant="caption">
                          {scheduler.id === 'check-mail' ? '📧' : '🎨'} {intervalStr}
                          {scheduler.monitoredAccounts > 0 && ` (${scheduler.monitoredAccounts})`}
                        </Typography>
                      }
                      sx={{ m: 0 }}
                    />
                  </Paper>
                </Tooltip>
              );
            })}

            <Divider orientation="vertical" flexItem />

            <FormControlLabel
              control={
                <Switch
                  checked={workersActive}
                  onChange={(e) => handleWorkersToggle(e.target.checked)}
                  disabled={isLoadingWorkers}
                />
              }
              label={<Typography variant="body2">Workers</Typography>}
            />

            <Divider orientation="vertical" flexItem />

            <Button
              variant="contained"
              color="success"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={handleCheckAllNow}
            >
              Check Recent Emails
            </Button>
            <Button
              variant="contained"
              color="primary"
              size="small"
              startIcon={<RefreshIcon />}
              onClick={handleUpdateAllTones}
            >
              Update All Tones
            </Button>
          </Stack>

          <Divider />

          {/* Row 3: Emergency Controls */}
          <Stack direction="row" spacing={2} alignItems="center">
            <Button
              variant="contained"
              color={queuesEmergencyPaused ? 'success' : 'error'}
              size="small"
              startIcon={queuesEmergencyPaused ? <PlayIcon /> : <PauseIcon />}
              onClick={handleEmergencyToggle}
              disabled={isLoadingEmergency}
            >
              {queuesEmergencyPaused ? 'Resume Queues' : 'Emergency Pause'}
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<DeleteIcon />}
              onClick={handleClearQueue}
            >
              Clear Waiting
            </Button>
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<DeleteIcon />}
              onClick={handleObliterateQueue}
              sx={{ fontWeight: 'bold' }}
            >
              Obliterate All
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Jobs List */}
      <Paper sx={{ mb: 3 }}>
        <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="h6">Background Jobs</Typography>
              <Typography variant="caption" color="text.secondary">
                Real-time status of all background processing
              </Typography>
            </Box>
          </Stack>
        </Box>
        <Box sx={{ height: 250, overflow: 'auto' }}>
          {jobsLoading ? (
            <Box display="flex" justifyContent="center" alignItems="center" height="100%">
              <CircularProgress />
            </Box>
          ) : sortedJobs.length > 0 ? (
            sortedJobs.slice(0, 20).map((job, index) => (
              <JobRow key={`${job.jobId}-${job.timestamp}-${index}`} job={job} onRetry={handleRetry} />
            ))
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" height="100%">
              <Typography color="text.secondary">No background jobs yet</Typography>
            </Box>
          )}
        </Box>
      </Paper>

      {/* Real-Time Logs Panel */}
      <Box>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Real-Time Logs
        </Typography>
        <MuiLogViewer height={400} autoConnect={true} />
      </Box>
    </MuiAuthenticatedLayout>
  );
}
