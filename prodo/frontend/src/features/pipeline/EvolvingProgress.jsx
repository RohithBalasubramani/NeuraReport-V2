/**
 * EvolvingProgress — single evolving message showing pipeline stage progress.
 * Updates in place. Shows durations. Detects stalls. Groups parallel stages.
 */
import React, { useEffect, useRef } from 'react'
import { Box, LinearProgress, Typography } from '@mui/material'
import {
  CheckCircle as DoneIcon,
  HourglassEmpty as RunningIcon,
  Error as ErrorIcon,
  Refresh as RetryIcon,
} from '@mui/icons-material'

const STALL_THRESHOLD_MS = 60000 // 1 minute
const STATUS_CONFIG = {
  pending:  { Icon: RunningIcon, color: 'grey.400', label: 'Pending' },
  running:  { Icon: RunningIcon, color: 'primary.main', label: 'Running', pulse: true },
  success:  { Icon: DoneIcon, color: 'success.main', label: 'Done' },
  failed:   { Icon: ErrorIcon, color: 'error.main', label: 'Failed' },
  retrying: { Icon: RetryIcon, color: 'warning.main', label: 'Retrying' },
}

function formatDuration(ms) {
  if (!ms || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function StageRow({ stage }) {
  const config = STATUS_CONFIG[stage.status] || STATUS_CONFIG.pending
  const Icon = config.Icon
  const elapsed = stage.status === 'running' ? Date.now() - (stage.timestamp || Date.now()) : 0
  const stalled = elapsed > STALL_THRESHOLD_MS
  const duration = stage.status === 'success' && stage.completedAt
    ? formatDuration(stage.completedAt - stage.timestamp)
    : stage.status === 'running' ? formatDuration(elapsed) : ''

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
      <Icon
        sx={{
          fontSize: 16,
          color: config.color,
          ...(config.pulse && {
            animation: 'pulse 1.5s ease-in-out infinite',
            '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
          }),
        }}
      />
      <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem' }}>
        {stage.name?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Processing'}
      </Typography>
      {stage.progress > 0 && stage.status === 'running' && (
        <LinearProgress
          variant="determinate"
          value={stage.progress}
          sx={{ width: 60, height: 3, borderRadius: 2 }}
        />
      )}
      {duration && (
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 40, textAlign: 'right' }}>
          {duration}
        </Typography>
      )}
      {stalled && (
        <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.7rem' }}>
          (slower than usual)
        </Typography>
      )}
    </Box>
  )
}

export default function EvolvingProgress({ message }) {
  const stages = message?.data?.stages || []
  const ref = useRef(null)

  // Force re-render every second for elapsed time updates
  const [, setTick] = React.useState(0)
  useEffect(() => {
    if (!message?.streaming) return
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [message?.streaming])

  if (!stages.length) return null

  // Group parallel stages
  const groups = []
  let currentGroup = null
  for (const stage of stages) {
    if (stage.parallelGroup) {
      if (currentGroup?.group === stage.parallelGroup) {
        currentGroup.stages.push(stage)
      } else {
        currentGroup = { group: stage.parallelGroup, stages: [stage] }
        groups.push(currentGroup)
      }
    } else {
      currentGroup = null
      groups.push({ group: null, stages: [stage] })
    }
  }

  return (
    <Box ref={ref} sx={{ mb: 1.5, pl: 5 }}>
      {groups.map((g, gi) => (
        <Box key={gi} sx={g.group ? { borderLeft: 2, borderColor: 'grey.300', pl: 1, ml: 1 } : {}}>
          {g.stages.map((stage, si) => (
            <StageRow key={`${stage.name}-${si}`} stage={stage} />
          ))}
        </Box>
      ))}
    </Box>
  )
}
