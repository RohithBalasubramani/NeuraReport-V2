/**
 * Pipeline Visualization — Real-time LangGraph pipeline progress view.
 *
 * Shows which pipeline stage is active, completed stages with timing,
 * retry indicators, and checkpoint info. Used in report generation
 * and agent workflow pages.
 */
import React, { useMemo } from 'react'
import {
  Box,
  Typography,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  IconButton,
} from '@mui/material'
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  HourglassEmpty as PendingIcon,
  Refresh as RetryIcon,
  PlayArrow as RunningIcon,
  Timeline as TimelineIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material'

const stageStatusConfig = {
  pending: { color: 'default', icon: PendingIcon, label: 'Pending' },
  running: { color: 'primary', icon: RunningIcon, label: 'Running' },
  completed: { color: 'success', icon: CheckCircleIcon, label: 'Complete' },
  failed: { color: 'error', icon: ErrorIcon, label: 'Failed' },
  retrying: { color: 'warning', icon: RetryIcon, label: 'Retrying' },
}

function formatDuration(ms) {
  if (!ms) return '\u2014'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function StageIndicator({ stage }) {
  const config = stageStatusConfig[stage.status] || stageStatusConfig.pending
  const Icon = config.icon

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Icon
        sx={{
          fontSize: 20,
          color: `${config.color}.main`,
          ...(stage.status === 'running' && {
            animation: 'pulse 1.5s ease-in-out infinite',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.4 },
            },
          }),
        }}
      />
      <Typography variant="body2" sx={{ fontWeight: stage.status === 'running' ? 600 : 400 }}>
        {stage.label}
      </Typography>
      {stage.duration && (
        <Chip
          label={formatDuration(stage.duration)}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: '0.7rem' }}
        />
      )}
      {stage.retryCount > 0 && (
        <Tooltip title={`Retried ${stage.retryCount} time(s)`}>
          <Chip
            icon={<RetryIcon sx={{ fontSize: 14 }} />}
            label={stage.retryCount}
            size="small"
            color="warning"
            sx={{ height: 20, fontSize: '0.7rem' }}
          />
        </Tooltip>
      )}
      {stage.error && (
        <Tooltip title={stage.error}>
          <Chip label="Error" size="small" color="error" sx={{ height: 20, fontSize: '0.7rem' }} />
        </Tooltip>
      )}
    </Box>
  )
}

/**
 * PipelineVisualization component.
 *
 * @param {Object} props
 * @param {Object} props.run - Pipeline run object with stages, progress, status, etc.
 * @param {boolean} [props.compact=false] - Whether to render in compact mode
 */
export default function PipelineVisualization({ run, compact = false }) {
  const [expanded, setExpanded] = React.useState(!compact)

  const activeStageIndex = useMemo(() => {
    if (!run) return -1
    return run.stages.findIndex((s) => s.status === 'running')
  }, [run])

  if (!run) {
    return null
  }

  const pipelineLabel = run.type === 'report' ? 'Report Pipeline' : 'Agent Workflow'

  if (compact && !expanded) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderRadius: 2,
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(true)}
      >
        <TimelineIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {pipelineLabel}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={run.progress}
          sx={{ flex: 1, height: 6, borderRadius: 3, mx: 1 }}
        />
        <Typography variant="caption" color="text.secondary">
          {run.progress}%
        </Typography>
        <ExpandMoreIcon sx={{ fontSize: 18 }} />
      </Paper>
    )
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        borderColor: run.status === 'running' ? 'primary.main' : undefined,
        borderWidth: run.status === 'running' ? 2 : 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <TimelineIcon sx={{ color: 'primary.main' }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {pipelineLabel}
          </Typography>
          <Chip
            label={run.status}
            size="small"
            color={
              run.status === 'running'
                ? 'primary'
                : run.status === 'completed'
                  ? 'success'
                  : run.status === 'failed'
                    ? 'error'
                    : 'default'
            }
            sx={{ height: 22, textTransform: 'capitalize' }}
          />
        </Stack>
        {compact && (
          <IconButton size="small" onClick={() => setExpanded(false)}>
            <ExpandLessIcon />
          </IconButton>
        )}
      </Box>

      <LinearProgress
        variant="determinate"
        value={run.progress}
        sx={{ mb: 2, height: 8, borderRadius: 4 }}
      />

      <Box sx={{ pl: 1 }}>
        {run.stages.map((stage) => (
          <StageIndicator key={stage.id} stage={stage} />
        ))}
      </Box>

      {run.error && (
        <Box
          sx={{
            mt: 2,
            p: 1.5,
            bgcolor: 'error.main',
            color: 'error.contrastText',
            borderRadius: 1,
            fontSize: '0.85rem',
          }}
        >
          {run.error}
        </Box>
      )}

      {run.checkpoints?.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {run.checkpoints.length} checkpoint(s) saved
          </Typography>
        </Box>
      )}
    </Paper>
  )
}
