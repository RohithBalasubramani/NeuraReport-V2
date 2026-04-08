/**
 * EvolvingProgress — single evolving message showing pipeline stage progress.
 * Updates in place. Shows durations. Detects stalls. Groups parallel stages.
 *
 * Stage labels: uses backend-provided `label` when available, otherwise
 * maps raw stage names to end-user-friendly descriptions.
 */
import React, { useEffect, useRef } from 'react'
import { Box, LinearProgress, Typography } from '@mui/material'
import {
  CheckCircle as DoneIcon,
  HourglassEmpty as RunningIcon,
  Error as ErrorIcon,
  Refresh as RetryIcon,
} from '@mui/icons-material'

const STALL_THRESHOLD_MS = 60000

const STATUS_CONFIG = {
  pending:  { Icon: RunningIcon, color: 'grey.400' },
  started:  { Icon: RunningIcon, color: 'primary.main', pulse: true },
  running:  { Icon: RunningIcon, color: 'primary.main', pulse: true },
  waiting:  { Icon: RunningIcon, color: 'info.main', pulse: true },
  complete: { Icon: DoneIcon, color: 'success.main' },
  success:  { Icon: DoneIcon, color: 'success.main' },
  failed:   { Icon: ErrorIcon, color: 'error.main' },
  retrying: { Icon: RetryIcon, color: 'warning.main' },
}

// ── Human-friendly labels for raw stage names ──
// Backend tools push stage names like "verify.start", "mapping.auto_map", "agent_turn".
// This map turns them into language a non-technical user understands.
const STAGE_LABELS = {
  // Hermes agent loop
  'agent_turn':           'Thinking...',

  // Verify (PDF)
  'verify_template':      'Processing your file',
  'verify.start':         'Starting template conversion',
  'verify.upload_pdf':    'Reading your PDF',
  'verify.render_reference_preview': 'Creating reference preview',
  'verify.generate_html': 'Converting to report template',
  'verify.render_html_preview': 'Rendering template preview',
  'verify.refine_html_layout': 'Refining layout',
  'verify.save_artifacts':'Saving template',
  'verify.complete':      'Template ready',

  // Verify (Excel)
  'excel.upload_file':    'Reading your spreadsheet',
  'excel.generate_html':  'Converting spreadsheet to template',
  'excel.save_artifacts': 'Saving template',

  // Mapping
  'auto_map_tokens':      'Connecting fields to your database',
  'mapping.auto_map':     'Matching fields to columns',
  'mapping.wide_format_detect': 'Detecting wide-format patterns',
  'simulate_mapping':     'Previewing field connections',
  'refine_mapping':       'Updating field connections',
  'resolve_mapping_pipeline': 'Building complete mapping',

  // Contract / Approve
  'build_contract':       'Building report rules',
  'contract.build':       'Creating report structure',
  'build_generator_assets': 'Preparing report engine',
  'generator_assets':     'Preparing report engine',

  // Validate
  'validate_pipeline':    'Checking everything',
  'validate.start':       'Starting validation',
  'validate.complete':    'Validation complete',

  // Dry run / Preview
  'dry_run_preview':      'Testing with your real data',
  'dry_run.find_data':    'Finding your data',
  'dry_run.sample_db':    'Loading sample data',
  'dry_run.generate':     'Generating sample report',
  'dry_run.verify_html':  'Checking generated output',
  'dry_run.cross_verify': 'Cross-checking values',
  'dry_run.row_verify':   'Verifying row counts',

  // Generate
  'generate_report':      'Creating your reports',
  'discover_batches':     'Finding data batches',

  // Other tools
  'inspect_data':         'Examining your data',
  'get_schema':           'Reading database structure',
  'get_key_options':      'Loading filter options',
  'auto_fix_issues':      'Fixing issues',
  'save_template':        'Saving changes',
  'call_qwen_vision':     'Analyzing image',

  // Hermes built-in tools (internal)
  'read_file':            'Reading file',
  'write_file':           'Writing file',
  'search_files':         'Searching files',
  'execute_code':         'Running code',
  'web_search':           'Searching the web',
  'web_extract':          'Reading web page',
  'vision_analyze':       'Analyzing image',
  'clarify':              'Asking for clarification',
  'delegate_task':        'Working on subtask',
  'memory':               'Checking memory',
  'session_search':       'Searching past sessions',
}

// Stages to hide from the user (too noisy / internal)
const HIDDEN_STAGES = new Set([
  'agent_turn',
])

function getStageLabel(stage) {
  // 1. Backend-provided label (best — already human-friendly)
  if (stage.label) return stage.label
  // 2. Our curated map
  if (stage.name && STAGE_LABELS[stage.name]) return STAGE_LABELS[stage.name]
  // 3. Fallback: humanize the raw name
  if (stage.name) {
    return stage.name
      .replace(/[._]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }
  return 'Processing'
}

function formatDuration(ms) {
  if (!ms || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function StageRow({ stage }) {
  const config = STATUS_CONFIG[stage.status] || STATUS_CONFIG.pending
  const Icon = config.Icon
  const isRunning = stage.status === 'running' || stage.status === 'started' || stage.status === 'waiting'
  const isDone = stage.status === 'complete' || stage.status === 'success'
  const elapsed = isRunning ? Date.now() - (stage.timestamp || Date.now()) : 0
  const stalled = isRunning && elapsed > STALL_THRESHOLD_MS

  let duration = ''
  if (isDone && stage.completedAt && stage.timestamp) {
    const ms = stage.completedAt - stage.timestamp
    if (ms > 50) duration = formatDuration(ms)  // skip near-zero durations
  } else if (isRunning && elapsed > 500) {
    duration = formatDuration(elapsed)
  }

  const label = getStageLabel(stage)

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
      <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem', color: 'text.secondary' }}>
        {label}
      </Typography>
      {stage.progress > 0 && (stage.status === 'running' || stage.status === 'started') && (
        <LinearProgress
          variant="determinate"
          value={stage.progress}
          sx={{ width: 60, height: 3, borderRadius: 2 }}
        />
      )}
      {duration && (
        <Typography variant="caption" color="text.disabled" sx={{ minWidth: 40, textAlign: 'right' }}>
          {duration}
        </Typography>
      )}
      {stalled && (
        <Typography variant="caption" color="warning.main" sx={{ fontSize: '0.7rem' }}>
          (taking longer than usual)
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

  // Filter out hidden/noisy stages
  const visibleStages = stages.filter(s => !HIDDEN_STAGES.has(s.name))

  if (!visibleStages.length) return null

  // Group parallel stages
  const groups = []
  let currentGroup = null
  for (const stage of visibleStages) {
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
