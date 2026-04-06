import * as api from '@/api/client'
import { cancelJob as cancelJobRequest } from '@/api/client'
import { neutral, palette, status } from '@/app/theme'
import { EmptyState, useToast } from '@/components/core'
import { DataTable } from '@/components/data'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { ConfirmModal } from '@/components/modals'
import { useJobsList } from '@/hooks/hooks'
import { useAppStore } from '@/stores/app'
import { GlassDialog as StyledDialog, PaddedPageContainer as PageContainer, fadeInUp } from '@/styles/styles'
import {
  JobStatus,
  canCancelJob,
  canRetryJob,
  isActiveStatus,
  isFailureStatus,
  normalizeJob,
  normalizeJobStatus,
  readPreferences,
  subscribePreferences,
} from '@/utils/helpers'
import CancelIcon from '@mui/icons-material/Cancel'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import ErrorIcon from '@mui/icons-material/Error'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import ReplayIcon from '@mui/icons-material/Replay'
import TaskAltIcon from '@mui/icons-material/TaskAlt'
import VisibilityIcon from '@mui/icons-material/Visibility'
import WorkIcon from '@mui/icons-material/Work'
import WorkHistoryOutlinedIcon from '@mui/icons-material/WorkHistoryOutlined'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
]

const STATUS_CHIP_PROPS = {
  queued: { label: 'Queued', color: 'default', Icon: WorkHistoryOutlinedIcon },
  pending: { label: 'Pending', color: 'default', Icon: WorkHistoryOutlinedIcon },
  running: { label: 'Running', color: 'default', Icon: RefreshIcon },
  completed: { label: 'Completed', color: 'default', Icon: TaskAltIcon },
  succeeded: { label: 'Completed', color: 'default', Icon: TaskAltIcon },
  failed: { label: 'Failed', color: 'default', Icon: ErrorOutlineIcon },
  cancelled: { label: 'Cancelled', color: 'default', Icon: ErrorOutlineIcon },
}

const STEP_STATUS_COLORS = {
  queued: 'default',
  pending: 'default',
  running: 'default',
  completed: 'default',
  succeeded: 'default',
  failed: 'default',
  cancelled: 'default',
}

const formatTimestamp = (value) => {
  if (!value) return '\u2014'
  try {
    const date = new Date(value)
    return date.toLocaleString()
  } catch {
    return value
  }
}

const pickMetaValue = (meta, ...keys) => {
  if (!meta) return undefined
  for (const key of keys) {
    if (meta[key] != null) return meta[key]
  }
  return undefined
}

const formatDateToken = (value) => {
  if (!value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
    if (match) return match[1]
  }
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toISOString().slice(0, 10)
  } catch {
    return String(value)
  }
}

const formatDateRange = (start, end) => {
  const startLabel = formatDateToken(start)
  const endLabel = formatDateToken(end)
  if (startLabel && endLabel) {
    return `${startLabel} -> ${endLabel}`
  }
  if (startLabel) {
    return `${startLabel} -> ongoing`
  }
  if (endLabel) {
    return `through ${endLabel}`
  }
  return 'Not provided'
}

const normalizeErrorText = (raw) => {
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    if (typeof raw.message === 'string') return raw.message
    try {
      return JSON.stringify(raw)
    } catch {
      return String(raw)
    }
  }
  return String(raw)
}

const toArray = (value) => {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

const extractJobIssues = (job) => {
  const issues = []
  if (!job) return issues
  const seen = new Set()
  const pushIssue = (source, raw) => {
    toArray(raw).forEach((item) => {
      const message = normalizeErrorText(item)
      if (!message) return
      const key = `${source}:${message}`
      if (seen.has(key)) return
      seen.add(key)
      issues.push({ source, message })
    })
  }
  if (job.error) {
    pushIssue('Job', job.error)
  }
  const meta = job.meta || job.metadata
  if (meta) {
    if (meta.error) pushIssue('Meta', meta.error)
    if (meta.errors) pushIssue('Meta', meta.errors)
  }
  const result = job.result
  if (result) {
    if (result.error) pushIssue('Result', result.error)
    if (result.errors) pushIssue('Result', result.errors)
  }
  return issues
}

function StepBadge({ step }) {
  const status = normalizeJobStatus(step?.status || 'queued')
  const color = STEP_STATUS_COLORS[status] || 'default'
  const label = step?.label || step?.name || 'Step'
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography variant="body2" sx={{ mr: 1 }}>
        {label}
      </Typography>
      <Chip
        size="small"
        label={status.charAt(0).toUpperCase() + status.slice(1)}
        color={color === 'default' ? 'default' : color}
        variant={color === 'default' ? 'outlined' : 'filled'}
      />
    </Stack>
  )
}

function JobDetailField({ label, value }) {
  const text = value || '\u2014'
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ letterSpacing: '0.08em', fontWeight: 600, textTransform: 'uppercase' }}
      >
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }} title={typeof text === 'string' ? text : undefined}>
        {text}
      </Typography>
    </Box>
  )
}

function JobCard({ job, onNavigate, onSetupNavigate, connectionName, onCancel, onForceCancel }) {
  const status = normalizeJobStatus(job?.status || 'queued')
  const chip = STATUS_CHIP_PROPS[status] || STATUS_CHIP_PROPS.pending
  const progressValue = job?.progress == null ? (status === 'completed' ? 100 : 0) : job.progress
  const steps = Array.isArray(job?.steps) ? job.steps : []
  const readableType = (job?.type || job?.job_type || 'run_report').replace(/_/g, ' ')
  const meta = job?.meta || job?.metadata || {}
  const startDate = pickMetaValue(meta, 'start_date', 'startDate') || job?.start_date || job?.startDate
  const endDate = pickMetaValue(meta, 'end_date', 'endDate') || job?.end_date || job?.endDate
  const connectionLabel =
    connectionName
    || meta.connection_name
    || meta.connectionName
    || job?.connectionId
    || job?.connection_id
    || 'No connection selected'
  const jobIssues = extractJobIssues(job)
  const isActive = isActiveStatus(status)
  const canOpenGenerate = Boolean(job?.templateId && onNavigate)
  const canOpenSetup = Boolean(job?.connectionId && onSetupNavigate)
  return (
    <Box
      sx={{
        borderRadius: 1,  // Figma spec: 8px
        border: '1px solid',
        borderColor: 'divider',
        p: 2,
        bgcolor: 'background.paper',
        boxShadow: `0 6px 18px ${alpha(neutral[900], 0.05)}`,
      }}
      data-testid="job-card"
    >
      <Stack spacing={0.75}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap title={job?.templateName || job?.templateId || 'Job'}>
              {job?.templateName || job?.templateId || 'Job'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {readableType} {' \u00b7 '}{(job?.templateKind || job?.kind || 'pdf').toUpperCase()}
            </Typography>
            {job?.templateId && (
              <Typography variant="caption" color="text.secondary">
                {job.templateId}
              </Typography>
            )}
          </Box>
          <Chip
            size="small"
            icon={<chip.Icon fontSize="inherit" />}
            label={chip.label}
            color={chip.color === 'default' ? 'default' : chip.color}
            variant={chip.color === 'default' ? 'outlined' : 'filled'}
            data-testid="job-status"
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Started: {formatTimestamp(job?.startedAt || job?.queuedAt)} {' \u00b7 '} Finished:{' '}
          {formatTimestamp(job?.finishedAt)}
        </Typography>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1, sm: 2 }}
          sx={{ mt: 0.5, flexWrap: 'wrap' }}
        >
          <JobDetailField label="Template ID" value={job?.templateId || 'Unknown template'} />
          <JobDetailField label="Connection" value={connectionLabel} />
          <JobDetailField label="Date range" value={formatDateRange(startDate, endDate)} />
        </Stack>
        {jobIssues.length > 0 && (
          <Stack spacing={0.5}>
            {jobIssues.map((issue, idx) => (
              <Alert
                key={`${job.id || 'job'}-${issue.source}-${idx}`}
                severity="error"
                variant="outlined"
                icon={<ErrorOutlineIcon fontSize="inherit" />}
              >
                <Typography variant="body2">
                  <strong>{issue.source}:</strong> {issue.message}
                </Typography>
              </Alert>
            ))}
          </Stack>
        )}
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.max(0, progressValue || 0))}
          sx={{ mt: 1, borderRadius: 1 }}
        />
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {steps.map((step) => (
            <StepBadge key={step.id || step.name} step={step} />
          ))}
          {!steps.length && (
            <Typography variant="body2" color="text.secondary">
              Awaiting updates...
            </Typography>
          )}
        </Stack>
        {(canOpenGenerate || canOpenSetup) && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
            {canOpenGenerate && (
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={() => onNavigate(job.templateId)}
              >
                Open Report
              </Button>
            )}
            {canOpenSetup && (
              <Button
                size="small"
                variant="outlined"
                sx={{ color: 'text.secondary' }}
                onClick={() => onSetupNavigate(job.connectionId)}
              >
                Go to Setup
              </Button>
            )}
            {isActive && (
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ color: 'text.secondary' }}
                  startIcon={<CancelIcon fontSize="small" />}
                  onClick={() => onCancel?.(job.id)}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="text"
                  sx={{ color: 'text.secondary' }}
                  onClick={() => onForceCancel?.(job.id)}
                >
                  Force stop
                </Button>
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </Box>
  )
}

export function JobsPanel({ open, onClose }) {
  const navigate = useNavigate()
  const { execute } = useInteraction()
  const queryClient = useQueryClient()
  const savedConnections = useAppStore((state) => state.savedConnections)
  const setActiveConnectionId = useAppStore((state) => state.setActiveConnectionId)
  const setSetupNav = useAppStore((state) => state.setSetupNav)
  const jobsQuery = useJobsList({ limit: 30 }) || {}
  const { data, isLoading, isFetching, error, refetch } = jobsQuery
  const [statusFilter, setStatusFilter] = useState('all')
  const jobs = data?.jobs || []
  const normalizedJobs = useMemo(
    () => jobs.map((job) => normalizeJob(job)),
    [jobs],
  )

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'jobs-panel', ...intent },
      action,
    })
  }, [execute])

  const handleNavigate = useCallback((path, options = {}) => {
    const {
      label = `Open ${path}`,
      intent = {},
      navigateOptions,
      beforeNavigate,
    } = options
    return execute({
      type: InteractionType.NAVIGATE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'jobs-panel', path, ...intent },
      action: () => {
        beforeNavigate?.()
        return navigate(path, navigateOptions)
      },
    })
  }, [execute, navigate])

  const markJobCancelled = useCallback((jobId) => {
    if (!jobId || !queryClient) return
    const queries = queryClient.getQueriesData({ queryKey: ['jobs'] }) || []
    queries.forEach(([queryKey, value]) => {
      if (!value) return
      if (Array.isArray(value.jobs)) {
        const updatedJobs = value.jobs.map((job) => {
          if (job.id !== jobId) return job
          const steps = Array.isArray(job.steps)
            ? job.steps.map((step) => {
                const status = (step?.status || '').toLowerCase()
                if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
                  return step
                }
                return { ...step, status: 'cancelled' }
              })
            : job.steps
          return { ...job, status: 'cancelled', steps }
        })
        queryClient.setQueryData(queryKey, { ...value, jobs: updatedJobs })
      } else if (value.id === jobId) {
        queryClient.setQueryData(queryKey, { ...value, status: 'cancelled' })
      }
    })
  }, [queryClient])

  const handleCancelJob = useCallback((jobId, options = {}) => {
    if (!jobId) return undefined
    const force = Boolean(options?.force)
    return execute({
      type: InteractionType.UPDATE,
      label: force ? 'Force stop job' : 'Cancel job',
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      intent: { source: 'jobs-panel', jobId, force },
      action: async () => {
        await cancelJobRequest(jobId, { force })
        markJobCancelled(jobId)
        await refetch?.()
      },
    })
  }, [execute, markJobCancelled, refetch])

  const handleForceCancelJob = useCallback(
    (jobId) => handleCancelJob(jobId, { force: true }),
    [handleCancelJob],
  )

  const filteredJobs = useMemo(() => {
    if (statusFilter === 'all') {
      return normalizedJobs
    }
    if (statusFilter === 'active') {
      return normalizedJobs.filter((job) => isActiveStatus(job.status))
    }
    if (statusFilter === 'completed') {
      return normalizedJobs.filter((job) => job.status === JobStatus.COMPLETED)
    }
    if (statusFilter === 'failed') {
      return normalizedJobs.filter((job) => isFailureStatus(job.status))
    }
    return normalizedJobs
  }, [normalizedJobs, statusFilter])

  const activeCount = useMemo(
    () => normalizedJobs.filter((job) => isActiveStatus(job.status)).length,
    [normalizedJobs],
  )
  const showEmptyState = !filteredJobs.length && !isLoading && !isFetching && !error

  const connectionLookup = useMemo(() => {
    const lookup = new Map()
    savedConnections.forEach((conn) => {
      if (!conn?.id) return
      lookup.set(conn.id, conn.name || conn.id)
    })
    return lookup
  }, [savedConnections])

  const handleClosePanel = useCallback(() => {
    return executeUI('Close jobs panel', () => onClose?.())
  }, [executeUI, onClose])

  const handleFilterChange = useCallback((filter) => {
    return executeUI('Filter jobs', () => setStatusFilter(filter), { filter })
  }, [executeUI])

  const handleRetry = useCallback(() => {
    return executeUI('Retry jobs refresh', () => refetch?.(), { action: 'refetch' })
  }, [executeUI, refetch])

  const onJobNavigate = useCallback((templateId) => {
    if (!templateId) return undefined
    return handleNavigate(`/reports?template=${encodeURIComponent(templateId)}`, {
      label: 'Open report',
      intent: { templateId },
      beforeNavigate: () => onClose?.(),
    })
  }, [handleNavigate, onClose])

  const onSetupNavigate = useCallback((connectionId) => {
    if (!connectionId) return undefined
    return handleNavigate('/pipeline', {
      label: 'Open setup wizard',
      intent: { connectionId },
      beforeNavigate: () => {
        setSetupNav('connect')
        setActiveConnectionId(connectionId)
        onClose?.()
      },
    })
  }, [handleNavigate, setActiveConnectionId, setSetupNav, onClose])

  const emptyDescription =
    statusFilter === 'all'
      ? 'Jobs launched from the Reports page will appear here so you can check progress without leaving your work.'
      : 'No jobs match the selected filter. Try another status or start a new run.'

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClosePanel}
      PaperProps={{
        sx: {
          backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(17, 24, 39, 0.95)' : 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(12px)',
        },
      }}
    >
      <Box
        sx={{
          width: { xs: '100vw', sm: 420 },
          maxWidth: '100vw',
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="h6">Background Jobs</Typography>
              <Typography variant="body2" color="text.secondary">
                {activeCount ? `${activeCount} active` : 'No active jobs'}
              </Typography>
            </Box>
            <IconButton onClick={handleClosePanel} aria-label="Close jobs panel">
              <CloseIcon />
            </IconButton>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            data-testid="jobs-filter-group"
          >
            <Typography variant="body2" color="text.secondary">
              Status:
            </Typography>
            {STATUS_FILTERS.map((filter) => (
              <Chip
                key={filter.value}
                size="small"
                label={filter.label}
                sx={statusFilter === filter.value ? { bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' } : undefined}
                variant={statusFilter === filter.value ? 'filled' : 'outlined'}
                onClick={() => handleFilterChange(filter.value)}
                data-testid={`jobs-filter-${filter.value}`}
              />
            ))}
          </Stack>
          {error && (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={handleRetry}>
                  Retry
                </Button>
              }
            >
              Failed to load jobs: {error.message || String(error)}
            </Alert>
          )}
          {(isLoading || isFetching) && <LinearProgress sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], '& .MuiLinearProgress-bar': { bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700] } }} aria-label="Loading jobs" />}
        </Stack>
        <Divider />
        {showEmptyState ? (
          <EmptyState
            title="No jobs to display"
            description={emptyDescription}
            action={
              statusFilter !== 'all' ? (
                <Button size="small" variant="outlined" onClick={() => handleFilterChange('all')}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        ) : (
          <Stack
            spacing={2}
            sx={{ flex: 1, overflowY: 'auto', pr: 1 }}
            data-testid="jobs-list"
          >
            {filteredJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onNavigate={onJobNavigate}
                onSetupNavigate={onSetupNavigate}
                connectionName={connectionLookup.get(job.connectionId)}
                onCancel={handleCancelJob}
                onForceCancel={handleForceCancelJob}
              />
            ))}
            {!filteredJobs.length && (
              <Tooltip title="Jobs refresh automatically every few seconds" arrow>
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  No jobs yet. Run a report to see progress here.
                </Typography>
              </Tooltip>
            )}
          </Stack>
        )}
      </Box>
    </Drawer>
  )
}

// === From: JobsPageContainer.jsx ===
/**
 * Premium Jobs Page
 * Sophisticated job progress tracking with glassmorphism and animations
 */


const StyledMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    borderRadius: 8,  // Figma spec: 8px
    boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.15)}`,
    minWidth: 180,
    animation: `${fadeInUp} 0.2s ease-out`,
  },
}))

const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
  borderRadius: 8,
  margin: theme.spacing(0.5, 1),
  padding: theme.spacing(1, 1.5),
  fontSize: '14px',
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
  '& .MuiListItemIcon-root': {
    minWidth: 32,
  },
}))


const DialogHeader = styled(DialogTitle)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(2.5, 3),
  fontSize: '1.125rem',
  fontWeight: 600,
}))

const CloseButton = styled(IconButton)(({ theme }) => ({
  width: 32,
  height: 32,
  borderRadius: 8,  // Figma spec: 8px
  color: theme.palette.text.secondary,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    color: theme.palette.text.primary,
    transform: 'rotate(90deg)',
  },
}))

const StyledDialogContent = styled(DialogContent)(({ theme }) => ({
  padding: theme.spacing(0, 3, 3),
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
}))

const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
  padding: theme.spacing(2, 3),
  gap: theme.spacing(1),
}))

const DetailLabel = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: theme.palette.text.secondary,
  marginBottom: theme.spacing(0.5),
}))

const DetailValue = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  color: theme.palette.text.primary,
}))

const MonoText = styled(Typography)(({ theme }) => ({
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.75rem',
  color: theme.palette.text.secondary,
  whiteSpace: 'nowrap',
}))

const StatusChip = styled(Chip, {
  shouldForwardProp: (prop) => !['statusColor', 'statusBg'].includes(prop),
})(({ theme, statusColor, statusBg }) => ({
  borderRadius: 8,
  fontWeight: 600,
  fontSize: '12px',
  backgroundColor: statusBg,
  color: statusColor,
  '& .MuiChip-icon': {
    marginLeft: theme.spacing(0.5),
    color: statusColor,
  },
}))

const TypeChip = styled(Chip)(({ theme }) => ({
  borderRadius: 8,
  fontWeight: 500,
  fontSize: '12px',
  textTransform: 'capitalize',
  backgroundColor: alpha(theme.palette.text.primary, 0.08),
  color: theme.palette.text.secondary,
}))

const StyledLinearProgress = styled(LinearProgress)(({ theme }) => ({
  borderRadius: 4,
  height: 6,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
  '& .MuiLinearProgress-bar': {
    borderRadius: 4,
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
  },
}))

const ActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '14px',
  padding: theme.spacing(0.75, 2),
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
}))

const PrimaryButton = styled(ActionButton)(({ theme }) => ({
  background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  color: theme.palette.common.white,
  boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
  '&:hover': {
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
    transform: 'translateY(-1px)',
  },
}))

const ResultBox = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(1),
  padding: theme.spacing(1.5),
  backgroundColor: alpha(theme.palette.background.paper, 0.4),
  borderRadius: 8,  // Figma spec: 8px
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.75rem',
  whiteSpace: 'pre-wrap',
  color: theme.palette.text.secondary,
  maxHeight: 260,
  overflow: 'auto',
  '&::-webkit-scrollbar': {
    width: 6,
  },
  '&::-webkit-scrollbar-track': {
    background: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    background: alpha(theme.palette.text.primary, 0.2),
    borderRadius: 1,  // Figma spec: 8px
  },
}))

const StyledDivider = styled(Divider)(({ theme }) => ({
  borderColor: alpha(theme.palette.divider, 0.08),
  margin: theme.spacing(2, 0),
}))

const ErrorAlert = styled(Alert)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  '& .MuiAlert-icon': {
    color: theme.palette.text.secondary,
  },
}))

const MoreActionsButton = styled(IconButton)(({ theme }) => ({
  color: theme.palette.text.secondary,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
}))


const getStatusConfig = (theme, status) => {
  const configs = {
    pending: {
      icon: HourglassEmptyIcon,
      color: theme.palette.text.secondary,
      bgColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
      label: 'Pending',
    },
    running: {
      icon: PlayArrowIcon,
      color: theme.palette.text.secondary,
      bgColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
      label: 'Running',
    },
    completed: {
      icon: CheckCircleIcon,
      color: theme.palette.text.secondary,
      bgColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
      label: 'Completed',
    },
    failed: {
      icon: ErrorIcon,
      color: theme.palette.text.secondary,
      bgColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[100],
      label: 'Failed',
    },
    cancelled: {
      icon: CancelIcon,
      color: theme.palette.text.secondary,
      bgColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
      label: 'Cancelled',
    },
    cancelling: {
      icon: HourglassEmptyIcon,
      color: theme.palette.text.secondary,
      bgColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
      label: 'Cancelling...',
    },
  }
  return configs[status] || configs.pending
}


export default function JobsPage() {
  const theme = useTheme()
  const toast = useToast()
  const navigate = useNavigateInteraction()
  const { execute } = useInteraction()
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { from: 'jobs', ...intent } }),
    [navigate]
  )
  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { from: 'jobs', ...intent },
      action,
    })
  }, [execute])

  const executeDownload = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.DOWNLOAD,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { from: 'jobs', ...intent },
      action,
    })
  }, [execute])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancellingJob, setCancellingJob] = useState(null)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuJob, setMenuJob] = useState(null)
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [detailsJob, setDetailsJob] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [autoRefreshJobs, setAutoRefreshJobs] = useState(
    () => readPreferences().autoRefreshJobs ?? true
  )
  const pollIntervalRef = useRef(null)
  const bulkDeleteUndoRef = useRef(null)
  const isMountedRef = useRef(true)
  const isUserActionInProgressRef = useRef(false)
  const abortControllerRef = useRef(null)

  useEffect(() => {
    const unsubscribe = subscribePreferences((prefs) => {
      setAutoRefreshJobs(prefs?.autoRefreshJobs ?? true)
    })
    return unsubscribe
  }, [])

  const fetchJobs = useCallback(async (force = false) => {
    if (!force && isUserActionInProgressRef.current) {
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    try {
      const data = await api.listJobs({ limit: 50, signal: abortControllerRef.current.signal })
      if (isMountedRef.current && (force || !isUserActionInProgressRef.current)) {
        const normalized = Array.isArray(data.jobs) ? data.jobs.map((job) => normalizeJob(job)) : []
        setJobs(normalized)
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Failed to fetch jobs:', err)
      }
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    setLoading(true)
    fetchJobs(true).finally(() => setLoading(false))

    if (autoRefreshJobs) {
      pollIntervalRef.current = setInterval(() => fetchJobs(false), 5000)
    }

    return () => {
      isMountedRef.current = false
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [fetchJobs, autoRefreshJobs])

  const openMenu = useCallback((anchor, job) => {
    setMenuAnchor(anchor)
    setMenuJob(job)
  }, [])

  const closeMenu = useCallback(() => {
    setMenuAnchor(null)
    setMenuJob(null)
  }, [])

  const openDetails = useCallback((job) => {
    setDetailsJob(job)
    setDetailsDialogOpen(true)
  }, [])

  const closeDetails = useCallback(() => {
    setDetailsDialogOpen(false)
  }, [])

  const handleOpenMenu = useCallback((event, job) => {
    event.stopPropagation()
    const anchor = event.currentTarget
    return executeUI('Open job actions', () => openMenu(anchor, job), { jobId: job?.id })
  }, [executeUI, openMenu])

  const handleCloseMenu = useCallback(() => {
    return executeUI('Close job actions', () => closeMenu())
  }, [executeUI, closeMenu])

  const handleRefresh = useCallback(() => {
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Refresh jobs',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { from: 'jobs', action: 'refresh_jobs' },
      action: async () => {
        setLoading(true)
        try {
          await fetchJobs()
          toast.show('Progress updated', 'info')
        } finally {
          setLoading(false)
        }
      },
    })
  }, [execute, fetchJobs, toast])

  const handleCancelClick = useCallback(() => {
    if (!menuJob) return undefined
    return executeUI('Review cancel job', () => {
      setCancellingJob(menuJob)
      setCancelConfirmOpen(true)
      closeMenu()
    }, { jobId: menuJob.id })
  }, [executeUI, menuJob, closeMenu])

  const handleCancelConfirm = useCallback(async () => {
    if (!cancellingJob) return

    await execute({
      type: InteractionType.UPDATE,
      label: 'Cancel job',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        jobId: cancellingJob.id,
        action: 'cancel_job',
      },
      action: async () => {
        isUserActionInProgressRef.current = true

        setJobs((prev) =>
          prev.map((job) =>
            job.id === cancellingJob.id ? { ...job, status: JobStatus.CANCELLING } : job
          )
        )
        setCancelConfirmOpen(false)

        try {
          await api.cancelJob(cancellingJob.id)
          toast.show('Job cancelled', 'success')
        } catch (err) {
          toast.show(err.message || 'Failed to cancel job', 'error')
          throw err
        } finally {
          setCancellingJob(null)
          isUserActionInProgressRef.current = false
          fetchJobs(true)
        }
      },
    })
  }, [cancellingJob, toast, fetchJobs, execute])

  const handleDownload = useCallback(() => {
    return executeDownload('Download job output', () => {
      if (menuJob?.artifacts?.html_url) {
        window.open(api.withBase(menuJob.artifacts.html_url), '_blank')
      } else {
        toast.show('Download not available', 'warning')
      }
      closeMenu()
    }, { jobId: menuJob?.id, format: 'html' })
  }, [executeDownload, menuJob, toast, closeMenu])

  const handleViewDetails = useCallback(() => {
    if (!menuJob) return undefined
    return executeUI('Open job details', () => {
      openDetails(menuJob)
      closeMenu()
    }, { jobId: menuJob.id })
  }, [executeUI, menuJob, openDetails, closeMenu])

  const handleRowClick = useCallback((row) => {
    return executeUI('Open job details', () => openDetails(row), { jobId: row?.id, source: 'jobs-table' })
  }, [executeUI, openDetails])

  const handleRetry = useCallback(async () => {
    if (!menuJob) return
    await execute({
      type: InteractionType.UPDATE,
      label: 'Retry job',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        jobId: menuJob.id,
        action: 'retry_job',
      },
      action: async () => {
        isUserActionInProgressRef.current = true
        setRetrying(true)
        closeMenu()
        try {
          await api.retryJob(menuJob.id)
          toast.show('Job restarted successfully', 'success')
        } catch (err) {
          toast.show(err.message || 'Failed to retry job', 'error')
          throw err
        } finally {
          setRetrying(false)
          isUserActionInProgressRef.current = false
          fetchJobs(true)
        }
      },
    })
  }, [menuJob, toast, fetchJobs, closeMenu, execute])

  const handleBulkCancelOpen = useCallback(() => {
    if (!selectedIds.length) return undefined
    return executeUI('Review cancel jobs', () => {
      const hasActive = selectedIds.some((id) => {
        const job = jobs.find((item) => item.id === id)
        return isActiveStatus(job?.status)
      })
      if (!hasActive) {
        toast.show('Select running or pending jobs to cancel', 'warning')
        return
      }
      setBulkCancelOpen(true)
    }, { count: selectedIds.length })
  }, [executeUI, jobs, selectedIds, toast])

  const handleBulkCancelConfirm = useCallback(async () => {
    const activeIds = selectedIds.filter((id) => {
      const job = jobs.find((item) => item.id === id)
      return isActiveStatus(job?.status)
    })
    if (!activeIds.length) {
      toast.show('Select running or pending jobs to cancel', 'warning')
      setBulkCancelOpen(false)
      return
    }

    await execute({
      type: InteractionType.UPDATE,
      label: 'Cancel selected jobs',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        jobIds: activeIds,
        action: 'bulk_cancel_jobs',
      },
      action: async () => {
        isUserActionInProgressRef.current = true

        const activeIdSet = new Set(activeIds)
        setJobs((prev) =>
          prev.map((job) =>
            activeIdSet.has(job.id) ? { ...job, status: JobStatus.CANCELLING } : job
          )
        )
        setBulkCancelOpen(false)
        setBulkActionLoading(true)

        try {
          const result = await api.bulkCancelJobs(activeIds)
          const cancelledCount = result?.cancelledCount ?? result?.cancelled?.length ?? 0
          const failedCount = result?.failedCount ?? result?.failed?.length ?? 0
          if (failedCount > 0) {
            toast.show(
              `Cancelled ${cancelledCount} job${cancelledCount !== 1 ? 's' : ''}, ${failedCount} failed`,
              'warning'
            )
          } else {
            toast.show(`Cancelled ${cancelledCount} job${cancelledCount !== 1 ? 's' : ''}`, 'success')
          }
          return result
        } catch (err) {
          toast.show(err.message || 'Failed to cancel jobs', 'error')
          throw err
        } finally {
          setBulkActionLoading(false)
          isUserActionInProgressRef.current = false
          fetchJobs(true)
        }
      },
    })
  }, [selectedIds, jobs, toast, fetchJobs, execute])

  const handleBulkDeleteOpen = useCallback(() => {
    if (!selectedIds.length) return undefined
    return executeUI('Review delete jobs', () => setBulkDeleteOpen(true), { count: selectedIds.length })
  }, [executeUI, selectedIds])

  const handleSelectionChange = useCallback((nextSelection) => {
    return executeUI('Select jobs', () => setSelectedIds(nextSelection), { count: nextSelection.length })
  }, [executeUI])

  const handleCancelConfirmClose = useCallback(() => {
    return executeUI('Close cancel confirmation', () => setCancelConfirmOpen(false))
  }, [executeUI])

  const handleBulkCancelClose = useCallback(() => {
    return executeUI('Close bulk cancel', () => setBulkCancelOpen(false))
  }, [executeUI])

  const handleBulkDeleteClose = useCallback(() => {
    return executeUI('Close bulk delete', () => setBulkDeleteOpen(false))
  }, [executeUI])

  const handleDetailsClose = useCallback(() => {
    return executeUI('Close job details', () => closeDetails())
  }, [executeUI, closeDetails])

  const handleDetailsDownload = useCallback(() => {
    return executeDownload('Download job output', () => {
      const url = detailsJob?.artifacts?.html_url
      if (url) {
        window.open(api.withBase(url), '_blank')
      } else {
        toast.show('Download not available', 'warning')
      }
    }, { jobId: detailsJob?.id, format: 'html' })
  }, [executeDownload, detailsJob, toast])

  const handleDetailsRetry = useCallback(() => {
    if (!detailsJob) return undefined
    return execute({
      type: InteractionType.UPDATE,
      label: 'Retry job',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        jobId: detailsJob.id,
        action: 'retry_job',
        source: 'details',
      },
      action: async () => {
        setRetrying(true)
        try {
          await api.retryJob(detailsJob.id)
          toast.show('Job restarted successfully', 'success')
          setDetailsDialogOpen(false)
          fetchJobs()
        } catch (err) {
          toast.show(err.message || 'Failed to retry job', 'error')
          throw err
        } finally {
          setRetrying(false)
        }
      },
    })
  }, [detailsJob, toast, fetchJobs, execute])

  const handleBulkDeleteConfirm = useCallback(async () => {
    if (!selectedIds.length) {
      setBulkDeleteOpen(false)
      return
    }
    const idsToDelete = [...selectedIds]
    const removedJobs = jobs.filter((job) => idsToDelete.includes(job.id))
    if (!removedJobs.length) {
      setBulkDeleteOpen(false)
      return
    }

    setBulkDeleteOpen(false)
    setSelectedIds([])

    if (bulkDeleteUndoRef.current?.timeoutId) {
      clearTimeout(bulkDeleteUndoRef.current.timeoutId)
      bulkDeleteUndoRef.current = null
    }

    isUserActionInProgressRef.current = true
    setJobs((prev) => prev.filter((job) => !idsToDelete.includes(job.id)))

    let undone = false
    const timeoutId = setTimeout(async () => {
      if (undone) return
      await execute({
        type: InteractionType.DELETE,
        label: 'Delete jobs',
        reversibility: Reversibility.SYSTEM_MANAGED,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: {
          jobIds: idsToDelete,
          action: 'bulk_delete_jobs',
        },
        action: async () => {
          setBulkActionLoading(true)
          try {
            const result = await api.bulkDeleteJobs(idsToDelete)
            const deletedCount = result?.deletedCount ?? result?.deleted?.length ?? 0
            const failedCount = result?.failedCount ?? result?.failed?.length ?? 0
            if (failedCount > 0) {
              toast.show(
                `Removed ${deletedCount} job${deletedCount !== 1 ? 's' : ''}, ${failedCount} failed`,
                'warning'
              )
            } else {
              toast.show(`Removed ${deletedCount} job${deletedCount !== 1 ? 's' : ''}`, 'success')
            }
            return result
          } catch (err) {
            setJobs((prev) => {
              const existing = new Set(prev.map((job) => job.id))
              const restored = removedJobs.filter((job) => !existing.has(job.id))
              return restored.length ? [...prev, ...restored] : prev
            })
            toast.show(err.message || 'Failed to delete jobs', 'error')
            throw err
          } finally {
            setBulkActionLoading(false)
            isUserActionInProgressRef.current = false
            bulkDeleteUndoRef.current = null
            fetchJobs(true)
          }
        },
      })
    }, 5000)

    bulkDeleteUndoRef.current = { timeoutId, ids: idsToDelete, jobs: removedJobs }

    toast.showWithUndo(
      `Removed ${idsToDelete.length} job${idsToDelete.length !== 1 ? 's' : ''} from history`,
      () => {
        undone = true
        clearTimeout(timeoutId)
        bulkDeleteUndoRef.current = null
        setJobs((prev) => {
          const existing = new Set(prev.map((job) => job.id))
          const restored = removedJobs.filter((job) => !existing.has(job.id))
          return restored.length ? [...prev, ...restored] : prev
        })
        isUserActionInProgressRef.current = false
        toast.show('Jobs restored', 'success')
      },
      { severity: 'info' }
    )
  }, [selectedIds, jobs, toast, fetchJobs, execute])

  const columns = useMemo(() => [
    {
      field: 'id',
      headerName: 'Job ID',
      width: 160,
      renderCell: (value) => (
        <MonoText>
          {value?.slice(0, 12)}...
        </MonoText>
      ),
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 140,
      renderCell: (value) => {
        const typeLabels = {
          run_report: 'Report Run',
          verify_template: 'Verify Design',
          verify_excel: 'Verify Excel',
          recommend_templates: 'Recommendations',
          summary_generate: 'Summary',
          summary_report: 'Report Summary',
          chart_analyze: 'Chart Analyze',
          chart_generate: 'Chart Generate',
        }
        const label = typeLabels[value] || (value || 'report').replace(/_/g, ' ')
        return (
          <TypeChip
            label={label}
            size="small"
          />
        )
      },
    },
    {
      field: 'templateName',
      headerName: 'Design',
      width: 220,
      renderCell: (value, row) => (
        <Typography sx={{
          fontSize: '14px',
          color: 'text.secondary',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 200,
        }}>
          {value || row.templateId?.slice(0, 12) || '-'}
        </Typography>
      ),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      renderCell: (value) => {
        const config = getStatusConfig(theme, value)
        const Icon = config.icon

        return (
          <StatusChip
            icon={<Icon sx={{ fontSize: 14 }} />}
            label={config.label}
            size="small"
            statusColor={config.color}
            statusBg={config.bgColor}
          />
        )
      },
    },
    {
      field: 'progress',
      headerName: 'Progress',
      width: 150,
      renderCell: (value, row) => {
        if (row.status === JobStatus.COMPLETED) {
          return (
            <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', fontWeight: 600 }}>
              100%
            </Typography>
          )
        }
        if (row.status === JobStatus.FAILED || row.status === JobStatus.CANCELLED) {
          return (
            <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>
              -
            </Typography>
          )
        }
        const progress = value || 0
        return (
          <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1 }}>
            <StyledLinearProgress
              variant="determinate"
              value={progress}
              sx={{ flex: 1 }}
            />
            <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', minWidth: 32 }}>
              {progress}%
            </Typography>
          </Box>
        )
      },
    },
    {
      field: 'createdAt',
      headerName: 'Started',
      width: 160,
      renderCell: (value) => {
        if (!value) return <Typography sx={{ fontSize: '14px', color: 'text.disabled' }}>-</Typography>
        const d = new Date(value)
        const now = new Date()
        const diffMs = now - d
        const diffMin = Math.floor(diffMs / 60000)
        const diffHr = Math.floor(diffMs / 3600000)
        const diffDay = Math.floor(diffMs / 86400000)
        let relative
        if (diffMin < 1) relative = 'Just now'
        else if (diffMin < 60) relative = `${diffMin}m ago`
        else if (diffHr < 24) relative = `${diffHr}h ago`
        else if (diffDay < 7) relative = `${diffDay}d ago`
        else relative = d.toLocaleDateString()
        return (
          <Tooltip title={d.toLocaleString()} arrow>
            <Typography sx={{ fontSize: '14px', color: 'text.secondary', cursor: 'default' }}>
              {relative}
            </Typography>
          </Tooltip>
        )
      },
    },
    {
      field: 'finishedAt',
      headerName: 'Completed',
      width: 160,
      renderCell: (value) => {
        if (!value) return <Typography sx={{ fontSize: '14px', color: 'text.disabled' }}>-</Typography>
        const d = new Date(value)
        const now = new Date()
        const diffMs = now - d
        const diffMin = Math.floor(diffMs / 60000)
        const diffHr = Math.floor(diffMs / 3600000)
        const diffDay = Math.floor(diffMs / 86400000)
        let relative
        if (diffMin < 1) relative = 'Just now'
        else if (diffMin < 60) relative = `${diffMin}m ago`
        else if (diffHr < 24) relative = `${diffHr}h ago`
        else if (diffDay < 7) relative = `${diffDay}d ago`
        else relative = d.toLocaleDateString()
        return (
          <Tooltip title={d.toLocaleString()} arrow>
            <Typography sx={{ fontSize: '14px', color: 'text.secondary', cursor: 'default' }}>
              {relative}
            </Typography>
          </Tooltip>
        )
      },
    },
  ], [theme])

  const filters = useMemo(() => [
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: 'pending', label: 'Pending' },
        { value: 'running', label: 'Running' },
        { value: 'completed', label: 'Completed' },
        { value: 'failed', label: 'Failed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    {
      key: 'type',
      label: 'Type',
      options: [
        { value: 'run_report', label: 'Report' },
        { value: 'verify_template', label: 'Verify Template' },
        { value: 'verify_excel', label: 'Verify Excel' },
        { value: 'recommend_templates', label: 'Recommendations' },
        { value: 'summary_generate', label: 'Summary' },
        { value: 'summary_report', label: 'Report Summary' },
        { value: 'chart_analyze', label: 'Chart Analyze' },
        { value: 'chart_generate', label: 'Chart Generate' },
      ],
    },
  ], [])

  const activeSelectedCount = useMemo(() => {
    const activeSet = new Set(['running', 'pending'])
    const jobLookup = new Map(jobs.map((job) => [job.id, job.status]))
    return selectedIds.filter((id) => activeSet.has(jobLookup.get(id))).length
  }, [jobs, selectedIds])

  const bulkActions = useMemo(() => ([
    {
      label: 'Cancel',
      icon: <CancelIcon sx={{ fontSize: 16 }} />,
      onClick: handleBulkCancelOpen,
      disabled: bulkActionLoading,
    },
  ]), [bulkActionLoading, handleBulkCancelOpen])

  const activeJobsCount = useMemo(() =>
    jobs.filter((j) => isActiveStatus(j.status)).length
  , [jobs])

  return (
    <PageContainer>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 1 }}>
        Jobs track background report runs. Removing a job only clears it from this list; downloaded files remain in
        History.
      </Alert>
      <DataTable
        title="Report Progress"
        subtitle={activeJobsCount > 0 ? `${activeJobsCount} report${activeJobsCount > 1 ? 's' : ''} generating` : 'All reports complete'}
        columns={columns}
        data={jobs}
        loading={loading}
        searchPlaceholder="Search reports..."
        filters={filters}
        selectable
        onSelectionChange={handleSelectionChange}
        onRowClick={handleRowClick}
        bulkActions={bulkActions}
        onBulkDelete={handleBulkDeleteOpen}
        actions={[
          {
            label: 'Refresh',
            icon: <RefreshIcon sx={{ fontSize: 18 }} />,
            variant: 'outlined',
            onClick: handleRefresh,
          },
        ]}
        onRefresh={handleRefresh}
        rowActions={(row) => (
          <Tooltip title="More actions">
            <MoreActionsButton
              size="small"
              onClick={(e) => handleOpenMenu(e, row)}
              aria-label="More actions"
            >
              <MoreVertIcon sx={{ fontSize: 18 }} />
            </MoreActionsButton>
          </Tooltip>
        )}
        emptyState={{
          icon: WorkIcon,
          title: 'No reports in progress',
          description: 'When you create a report, you can track its progress here.',
          actionLabel: 'Create Report',
          onAction: () => handleNavigate('/reports', 'Open reports'),
        }}
      />

      {/* Row Actions Menu */}
      <StyledMenu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleCloseMenu}
      >
        <StyledMenuItem onClick={handleViewDetails}>
          <ListItemIcon><VisibilityIcon sx={{ fontSize: 16 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>View Details</ListItemText>
        </StyledMenuItem>
        {menuJob?.status === JobStatus.COMPLETED && menuJob?.artifacts?.html_url && (
          <StyledMenuItem onClick={handleDownload}>
            <ListItemIcon><DownloadIcon sx={{ fontSize: 16 }} /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>Download</ListItemText>
          </StyledMenuItem>
        )}
        {canRetryJob(menuJob?.status) && (
          <StyledMenuItem onClick={handleRetry} disabled={retrying}>
            <ListItemIcon><ReplayIcon sx={{ fontSize: 16 }} /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>
              {retrying ? 'Retrying...' : 'Retry'}
            </ListItemText>
          </StyledMenuItem>
        )}
        {canCancelJob(menuJob?.status) && (
          <StyledMenuItem onClick={handleCancelClick} sx={{ color: 'text.secondary' }}>
            <ListItemIcon><CancelIcon sx={{ fontSize: 16, color: 'text.secondary' }} /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>Cancel</ListItemText>
          </StyledMenuItem>
        )}
      </StyledMenu>

      {/* Cancel Confirmation */}
      <ConfirmModal
        open={cancelConfirmOpen}
        onClose={handleCancelConfirmClose}
        onConfirm={handleCancelConfirm}
        title="Cancel Job"
        message="Are you sure you want to cancel this job? This action cannot be undone."
        confirmLabel="Cancel Job"
        severity="warning"
      />

      <ConfirmModal
        open={bulkCancelOpen}
        onClose={handleBulkCancelClose}
        onConfirm={handleBulkCancelConfirm}
        title="Cancel Jobs"
        message={`Cancel ${activeSelectedCount} running job${activeSelectedCount !== 1 ? 's' : ''}?`}
        confirmLabel="Cancel Jobs"
        severity="warning"
        loading={bulkActionLoading}
      />

      <ConfirmModal
        open={bulkDeleteOpen}
        onClose={handleBulkDeleteClose}
        onConfirm={handleBulkDeleteConfirm}
        title="Delete Jobs"
        message={(() => {
          const selectedJobs = jobs.filter((j) => selectedIds.includes(j.id))
          const names = selectedJobs.slice(0, 3).map((j) => j.templateName || j.id?.slice(0, 8) || 'Unknown')
          const namesList = names.join(', ')
          const remaining = selectedIds.length - 3
          const suffix = remaining > 0 ? ` and ${remaining} more` : ''
          return `Remove ${selectedIds.length} job${selectedIds.length !== 1 ? 's' : ''} (${namesList}${suffix}) from history? You can undo within a few seconds. Downloaded files are not affected.`
        })()}
        confirmLabel="Delete Jobs"
        severity="error"
        loading={bulkActionLoading}
      />

      {/* Job Details Dialog */}
      <StyledDialog
        open={detailsDialogOpen}
        onClose={handleDetailsClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogHeader>
          Job Details
          <Tooltip title="Close">
            <CloseButton size="small" onClick={handleDetailsClose} aria-label="Close dialog">
              <CloseIcon sx={{ fontSize: 18 }} />
            </CloseButton>
          </Tooltip>
        </DialogHeader>
        <StyledDialogContent>
          {detailsJob && (
            <Stack spacing={2} sx={{ pt: 2 }}>
              <Box>
                <DetailLabel>Job ID</DetailLabel>
                <MonoText sx={{ fontSize: '14px' }}>
                  {detailsJob.id}
                </MonoText>
              </Box>
              <StyledDivider />
              <Box>
                <DetailLabel>Status</DetailLabel>
                <Box sx={{ mt: 0.5 }}>
                  {(() => {
                    const config = getStatusConfig(theme, detailsJob.status)
                    const Icon = config.icon
                    return (
                      <StatusChip
                        icon={<Icon sx={{ fontSize: 14 }} />}
                        label={config.label}
                        size="small"
                        statusColor={config.color}
                        statusBg={config.bgColor}
                      />
                    )
                  })()}
                </Box>
              </Box>
              <StyledDivider />
              <Box>
                <DetailLabel>Template</DetailLabel>
                <DetailValue>
                  {detailsJob.templateName || detailsJob.templateId || detailsJob.template_id || '-'}
                </DetailValue>
              </Box>
              {(detailsJob.connectionId || detailsJob.connection_id) && (
                <>
                  <StyledDivider />
                  <Box>
                    <DetailLabel>Connection ID</DetailLabel>
                    <MonoText>
                      {detailsJob.connectionId || detailsJob.connection_id}
                    </MonoText>
                  </Box>
                </>
              )}
              <StyledDivider />
              <Box>
                <DetailLabel>Created</DetailLabel>
                <DetailValue>
                  {detailsJob.createdAt ? new Date(detailsJob.createdAt).toLocaleString() : '-'}
                </DetailValue>
              </Box>
              {(detailsJob.finishedAt || detailsJob.completed_at) && (
                <>
                  <StyledDivider />
                  <Box>
                    <DetailLabel>Completed</DetailLabel>
                    <DetailValue>
                      {new Date(detailsJob.finishedAt || detailsJob.completed_at).toLocaleString()}
                    </DetailValue>
                  </Box>
                </>
              )}
              {detailsJob.error && (
                <>
                  <StyledDivider />
                  <ErrorAlert severity="error">
                    {detailsJob.error}
                  </ErrorAlert>
                </>
              )}
              {(() => {
                const resultPayload = detailsJob?.result && Object.keys(detailsJob.result || {}).length
                  ? detailsJob.result
                  : null
                if (!resultPayload) return null
                const summaryText = typeof resultPayload.summary === 'string' ? resultPayload.summary : null
                const bodyText = summaryText || JSON.stringify(resultPayload, null, 2)
                return (
                  <>
                    <StyledDivider />
                    <Box>
                      <DetailLabel>Result</DetailLabel>
                      <ResultBox component="pre">
                        {bodyText}
                      </ResultBox>
                    </Box>
                  </>
                )
              })()}
            </Stack>
          )}
        </StyledDialogContent>
        <StyledDialogActions>
          {detailsJob?.status === JobStatus.COMPLETED && detailsJob?.artifacts?.html_url && (
            <ActionButton
              variant="outlined"
              size="small"
              startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
              onClick={handleDetailsDownload}
            >
              Download
            </ActionButton>
          )}
          {canRetryJob(detailsJob?.status) && (
            <ActionButton
              variant="outlined"
              size="small"
              startIcon={<ReplayIcon sx={{ fontSize: 16 }} />}
              disabled={retrying}
              onClick={handleDetailsRetry}
            >
              {retrying ? 'Retrying...' : 'Retry'}
            </ActionButton>
          )}
          <ActionButton onClick={handleDetailsClose}>
            Close
          </ActionButton>
        </StyledDialogActions>
      </StyledDialog>
    </PageContainer>
  )
}
