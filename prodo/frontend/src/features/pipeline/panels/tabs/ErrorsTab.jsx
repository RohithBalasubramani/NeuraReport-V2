/**
 * ErrorsTab — Validation errors with:
 * - Sentry-like error grouping by category
 * - Recharts performance view (query timing per step)
 * - User action replay (timeline from history)
 * - Error explanation (expandable)
 * - Cross-panel jump links
 */
import React, { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Box, Button, Card, CardContent, Chip, Collapse, Divider,
  IconButton, Paper, Slider, Stack, Tooltip, Typography,
} from '@mui/material'
import {
  CheckCircle as PassIcon,
  Cancel as ErrorIcon,
  Warning as WarnIcon,
  Info as InfoIcon,
  OpenInNew as JumpIcon,
  Refresh as RetryIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Speed as PerfIcon,
  History as HistoryIcon,
} from '@mui/icons-material'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken } from '../../utils'

const SEVERITY = {
  error:   { Icon: ErrorIcon, color: 'error.main', label: 'Errors', chartColor: '#f44336' },
  warning: { Icon: WarnIcon, color: 'warning.main', label: 'Warnings', chartColor: '#ff9800' },
  info:    { Icon: InfoIcon, color: 'info.main', label: 'Info', chartColor: '#2196f3' },
}

const CATEGORIES = {
  template: { label: 'Template', color: '#e3f2fd' },
  mapping:  { label: 'Mapping', color: '#fff3e0' },
  data:     { label: 'Data', color: '#e8f5e9' },
  validation: { label: 'Validation', color: '#fce4ec' },
  generation: { label: 'Generation', color: '#f3e5f5' },
  other:    { label: 'Other', color: '#f5f5f5' },
}

// ── Issue Item with explanation ──
function IssueItem({ issue, onJump }) {
  const [showExplanation, setShowExplanation] = useState(false)
  const cfg = SEVERITY[issue.severity] || SEVERITY.info
  const Icon = cfg.Icon

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: issue.severity === 'error' ? 'error.light' : 'divider',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Icon sx={{ fontSize: 18, color: cfg.color, mt: 0.25 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
              {issue.message || issue.text || 'Unknown issue'}
            </Typography>
            {issue.token && (
              <Chip label={humanizeToken(issue.token)} size="small" sx={{ mt: 0.5, height: 20, fontSize: '0.65rem' }} />
            )}
            {issue.fix && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                Suggestion: {issue.fix}
              </Typography>
            )}

            {/* Expandable explanation */}
            {issue.explanation && (
              <>
                <Box
                  onClick={() => setShowExplanation(o => !o)}
                  sx={{ cursor: 'pointer', mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.25 }}
                >
                  <Typography variant="caption" color="primary.main" fontWeight={600}>
                    {showExplanation ? 'Hide' : 'Why?'}
                  </Typography>
                  {showExplanation ? <CollapseIcon sx={{ fontSize: 12 }} /> : <ExpandIcon sx={{ fontSize: 12 }} />}
                </Box>
                <Collapse in={showExplanation}>
                  <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: 'grey.50' }}>
                    <Typography variant="caption" color="text.secondary">
                      {issue.explanation}
                    </Typography>
                  </Paper>
                </Collapse>
              </>
            )}
          </Box>
          {issue.panel && (
            <Button
              size="small"
              startIcon={<JumpIcon sx={{ fontSize: 14 }} />}
              onClick={() => onJump(issue.panel, issue.token || issue.field)}
              sx={{ textTransform: 'none', fontSize: '0.7rem', minWidth: 'auto' }}
            >
              View
            </Button>
          )}
        </Box>
      </CardContent>
    </Card>
  )
}

// ── Category Group (Sentry-style) ──
function CategoryGroup({ category, issues, onJump, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const catConfig = CATEGORIES[category] || CATEGORIES.other
  const errorCount = issues.filter(i => i.severity === 'error').length
  const warnCount = issues.filter(i => i.severity === 'warning').length

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75,
          cursor: 'pointer', bgcolor: catConfig.color,
          '&:hover': { filter: 'brightness(0.97)' },
        }}
      >
        <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>
          {catConfig.label}
        </Typography>
        {errorCount > 0 && <Chip label={`${errorCount} errors`} size="small" color="error" sx={{ height: 18, fontSize: '0.6rem' }} />}
        {warnCount > 0 && <Chip label={`${warnCount} warnings`} size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />}
        <Chip label={issues.length} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
        {open ? <CollapseIcon sx={{ fontSize: 16 }} /> : <ExpandIcon sx={{ fontSize: 16 }} />}
      </Box>
      <Collapse in={open}>
        <Stack spacing={0.5} sx={{ p: 1 }}>
          <AnimatePresence>
            {issues.map((issue, i) => (
              <motion.div
                key={issue.message || issue.text || i}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, delay: i * 0.03 }}
              >
                <IssueItem issue={issue} onJump={onJump} />
              </motion.div>
            ))}
          </AnimatePresence>
        </Stack>
      </Collapse>
    </Paper>
  )
}

// ── Performance View ──
function PerformanceView({ metrics }) {
  if (!metrics?.length) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ p: 2 }}>
        No performance data available yet.
      </Typography>
    )
  }

  const chartData = metrics.map(m => ({
    name: m.step?.replace(/_/g, ' ') || 'Unknown',
    duration: Math.round((m.durationMs || 0) / 1000 * 10) / 10,
    queries: m.queryCount || 0,
  }))

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        Step Duration (seconds)
      </Typography>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={40} />
          <YAxis tick={{ fontSize: 9 }} width={30} />
          <RechartsTooltip
            contentStyle={{ fontSize: '0.75rem' }}
            formatter={(value, name) => [
              name === 'duration' ? `${value}s` : value,
              name === 'duration' ? 'Duration' : 'Queries',
            ]}
          />
          <Bar dataKey="duration" radius={[3, 3, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.duration > 10 ? '#f44336' : entry.duration > 5 ? '#ff9800' : '#4caf50'}
                fillOpacity={0.7}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}

// ── Action Replay Timeline ──
function ActionReplay({ history }) {
  const [previewIdx, setPreviewIdx] = useState(null)
  const previewHistoryAt = usePipelineStore(s => s.previewHistoryAt)
  const clearHistoryPreview = usePipelineStore(s => s.clearHistoryPreview)

  if (!history?.length) {
    return (
      <Typography variant="caption" color="text.secondary" sx={{ p: 2 }}>
        No action history yet.
      </Typography>
    )
  }

  const marks = history.map((h, i) => ({
    value: i,
    label: h.field?.replace(/_/g, ' ') || `Step ${i + 1}`,
  }))

  return (
    <Box sx={{ px: 3, py: 2 }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 1, display: 'block' }}>
        Action Timeline
      </Typography>
      <Slider
        min={0}
        max={history.length - 1}
        value={previewIdx ?? history.length - 1}
        marks={marks.length <= 10 ? marks : undefined}
        onChange={(_, val) => {
          setPreviewIdx(val)
          previewHistoryAt(val)
        }}
        onChangeCommitted={() => {
          clearHistoryPreview()
          setPreviewIdx(null)
        }}
        valueLabelDisplay="auto"
        valueLabelFormat={(val) => marks[val]?.label || `Step ${val + 1}`}
        sx={{
          '& .MuiSlider-mark': { width: 6, height: 6, borderRadius: '50%' },
          '& .MuiSlider-markLabel': { fontSize: '0.6rem' },
        }}
      />
      <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 1 }}>
        {history.map((h, i) => (
          <Chip
            key={i}
            label={h.field || `Step ${i + 1}`}
            size="small"
            variant={previewIdx === i ? 'filled' : 'outlined'}
            color={previewIdx === i ? 'primary' : 'default'}
            onClick={() => {
              setPreviewIdx(i)
              previewHistoryAt(i)
            }}
            sx={{ height: 20, fontSize: '0.6rem' }}
          />
        ))}
      </Stack>
    </Box>
  )
}

export default function ErrorsTab({ onAction }) {
  const validation = usePipelineStore(s => s.pipelineState.data.validation)
  const errors = usePipelineStore(s => s.pipelineState.errors)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)
  const performanceMetrics = usePipelineStore(s => s.performanceMetrics)
  const history = usePipelineStore(s => s.pipelineState.history)

  const [showPerf, setShowPerf] = useState(false)
  const [showReplay, setShowReplay] = useState(false)

  const issues = errors.length > 0 ? errors : (validation?.issues || [])
  const passed = validation?.result === 'pass'

  // Annotate issues with panel hints and category
  const annotatedIssues = useMemo(() =>
    issues.map(issue => {
      const annotated = { ...issue }
      if (!annotated.panel) {
        if (annotated.token || annotated.field) annotated.panel = 'mappings'
        else if (annotated.category === 'validation') annotated.panel = 'logic'
      }
      if (!annotated.category) {
        if (annotated.panel === 'template') annotated.category = 'template'
        else if (annotated.panel === 'mappings') annotated.category = 'mapping'
        else if (annotated.panel === 'data') annotated.category = 'data'
        else if (annotated.panel === 'logic' || annotated.panel === 'errors') annotated.category = 'validation'
        else annotated.category = 'other'
      }
      return annotated
    }),
  [issues])

  // Group by category (Sentry-style)
  const categorized = useMemo(() => {
    const groups = {}
    annotatedIssues.forEach(issue => {
      const cat = issue.category || 'other'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(issue)
    })
    // Sort: errors-heavy categories first
    return Object.entries(groups).sort(([, a], [, b]) => {
      const scoreA = a.filter(i => i.severity === 'error').length
      const scoreB = b.filter(i => i.severity === 'error').length
      return scoreB - scoreA
    })
  }, [annotatedIssues])

  const handleJump = (panel, field) => {
    if (panel) setActivePanel(panel)
    if (field) setHighlightedField(field)
  }

  const totalErrors = annotatedIssues.filter(i => i.severity === 'error').length
  const totalWarnings = annotatedIssues.filter(i => i.severity === 'warning').length

  if (!issues.length && !passed) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Typography color="text.secondary">No validation results yet.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {passed ? 'All Checks Passed' : 'Validation Results'}
        </Typography>
        {passed && <PassIcon sx={{ color: 'success.main' }} />}
        {totalErrors > 0 && <Chip label={`${totalErrors} errors`} size="small" color="error" />}
        {totalWarnings > 0 && <Chip label={`${totalWarnings} warnings`} size="small" color="warning" variant="outlined" />}
      </Box>

      {/* Toolbar */}
      <Box sx={{ px: 2, py: 0.5, display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Button
          size="small"
          variant={showPerf ? 'contained' : 'outlined'}
          startIcon={<PerfIcon sx={{ fontSize: 14 }} />}
          onClick={() => setShowPerf(o => !o)}
          sx={{ textTransform: 'none', fontSize: '0.7rem' }}
        >
          Performance
        </Button>
        <Button
          size="small"
          variant={showReplay ? 'contained' : 'outlined'}
          startIcon={<HistoryIcon sx={{ fontSize: 14 }} />}
          onClick={() => setShowReplay(o => !o)}
          sx={{ textTransform: 'none', fontSize: '0.7rem' }}
        >
          Replay
        </Button>
      </Box>

      {/* Performance view (collapsible) */}
      <Collapse in={showPerf}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <PerformanceView metrics={performanceMetrics} />
        </Box>
      </Collapse>

      {/* Action replay (collapsible) */}
      <Collapse in={showReplay}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <ActionReplay history={history} />
        </Box>
      </Collapse>

      {/* Issues grouped by category */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {categorized.length > 0 ? (
          <Stack spacing={1}>
            {categorized.map(([category, catIssues]) => (
              <CategoryGroup
                key={category}
                category={category}
                issues={catIssues}
                onJump={handleJump}
                defaultOpen={catIssues.some(i => i.severity === 'error')}
              />
            ))}
          </Stack>
        ) : passed ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <PassIcon sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
            <Typography color="text.secondary">All validation checks passed.</Typography>
          </Box>
        ) : null}
      </Box>

      {/* Re-validate button */}
      {!passed && (
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RetryIcon />}
            onClick={() => onAction?.('validate')}
            sx={{ textTransform: 'none' }}
          >
            Check again
          </Button>
        </Box>
      )}
    </Box>
  )
}
