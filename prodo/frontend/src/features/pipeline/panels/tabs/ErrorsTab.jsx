/**
 * ErrorsTab — Validation errors, performance, and action replay.
 *
 * References:
 *   - Sentry Issue List: category-grouped errors with severity badges
 *   - Datadog APM: step duration chart with optimization suggestions
 *   - Chrome DevTools Recorder: timeline scrubber for action replay
 *
 * Covers:
 *   7a: Validation/errors panel (Sentry-style category grouping)
 *   7b: Auto-fix vs manual distinction (Quick Fix / Manual chips)
 *   7c: Optimization suggestions (heuristic for slow steps)
 *   D10: Performance/cost view (Recharts bar chart + suggestions)
 *   D12: User action replay (timeline slider + revert button)
 */
import React, { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Box, Button, Card, CardContent, Chip, Collapse, Divider,
  Paper, Slider, Stack, Tooltip, Typography,
} from '@mui/material'
import {
  CheckCircle as PassIcon, Cancel as ErrorIcon, Warning as WarnIcon,
  Info as InfoIcon, OpenInNew as JumpIcon, Refresh as RetryIcon,
  ExpandMore as ExpandIcon, ExpandLess as CollapseIcon,
  Speed as PerfIcon, History as HistoryIcon,
} from '@mui/icons-material'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Cell } from 'recharts'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken } from '../../utils'
import { fetchPerformance, fetchProblems } from '@/api/widgetData'

const SEVERITY = {
  error: { Icon: ErrorIcon, color: 'error.main' },
  warning: { Icon: WarnIcon, color: 'warning.main' },
  info: { Icon: InfoIcon, color: 'info.main' },
}

const CATEGORIES = {
  template: { label: 'Template', bg: '#e3f2fd' },
  mapping: { label: 'Mapping', bg: '#fff3e0' },
  data: { label: 'Data', bg: '#e8f5e9' },
  validation: { label: 'Validation', bg: '#fce4ec' },
  generation: { label: 'Generation', bg: '#f3e5f5' },
  other: { label: 'Other', bg: '#f5f5f5' },
}

// ── 7a + 7b: Issue Item ──
function IssueItem({ issue, onJump }) {
  const [showWhy, setShowWhy] = useState(false)
  const cfg = SEVERITY[issue.severity] || SEVERITY.info
  const Icon = cfg.Icon
  const hasQuickFix = issue.autoFixable || (issue.fix && !issue.fix.toLowerCase().includes('manual'))

  return (
    <Card variant="outlined" sx={{ borderColor: issue.severity === 'error' ? 'error.light' : 'divider', '&:hover': { bgcolor: 'action.hover' } }}>
      <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Icon sx={{ fontSize: 18, color: cfg.color, mt: 0.25 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{issue.message || issue.text || 'Unknown issue'}</Typography>
            {issue.token && <Chip label={humanizeToken(issue.token)} size="small" sx={{ mt: 0.5, height: 20, fontSize: '0.65rem' }} />}
            {/* 7b: Quick Fix vs Manual */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              {issue.fix && <Typography variant="caption" color="text.secondary">{issue.fix}</Typography>}
              {hasQuickFix ? (
                <Chip label="Quick Fix" size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.6rem', cursor: 'pointer' }}
                  onClick={e => { e.stopPropagation(); onJump?.(issue.panel, issue.token || issue.field) }} />
              ) : (
                <Chip label="Manual" size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
              )}
            </Box>
            {issue.explanation && (
              <>
                <Box onClick={() => setShowWhy(o => !o)} sx={{ cursor: 'pointer', mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  <Typography variant="caption" color="primary.main" fontWeight={600}>{showWhy ? 'Hide' : 'Why?'}</Typography>
                  {showWhy ? <CollapseIcon sx={{ fontSize: 12 }} /> : <ExpandIcon sx={{ fontSize: 12 }} />}
                </Box>
                <Collapse in={showWhy}>
                  <Paper variant="outlined" sx={{ p: 1, mt: 0.5, bgcolor: '#fafafa' }}>
                    <Typography variant="caption" color="text.secondary">{issue.explanation}</Typography>
                  </Paper>
                </Collapse>
              </>
            )}
          </Box>
          {issue.panel && (
            <Button size="small" startIcon={<JumpIcon sx={{ fontSize: 14 }} />}
              onClick={() => onJump(issue.panel, issue.token || issue.field)}
              sx={{ textTransform: 'none', fontSize: '0.7rem', minWidth: 'auto' }}>View</Button>
          )}
        </Box>
      </CardContent>
    </Card>
  )
}

// ── 7a: Category Group ──
function CategoryGroup({ category, issues, onJump, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const cat = CATEGORIES[category] || CATEGORIES.other
  const errCount = issues.filter(i => i.severity === 'error').length

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box onClick={() => setOpen(o => !o)} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75, cursor: 'pointer', bgcolor: cat.bg, '&:hover': { filter: 'brightness(0.97)' } }}>
        <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>{cat.label}</Typography>
        {errCount > 0 && <Chip label={`${errCount} errors`} size="small" color="error" sx={{ height: 18, fontSize: '0.6rem' }} />}
        <Chip label={issues.length} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
        {open ? <CollapseIcon sx={{ fontSize: 16 }} /> : <ExpandIcon sx={{ fontSize: 16 }} />}
      </Box>
      <Collapse in={open}>
        <Stack spacing={0.5} sx={{ p: 1 }}>
          <AnimatePresence>
            {issues.map((issue, i) => (
              <motion.div key={issue.message || i} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, delay: i * 0.03 }}>
                <IssueItem issue={issue} onJump={onJump} />
              </motion.div>
            ))}
          </AnimatePresence>
        </Stack>
      </Collapse>
    </Paper>
  )
}

// ── D10: Performance View + 7c: Optimization Suggestions ──
function PerformanceView({ metrics }) {
  if (!metrics?.length) return <Typography variant="caption" color="text.secondary" sx={{ p: 2 }}>No performance data yet.</Typography>
  const data = metrics.map(m => ({ name: m.step?.replace(/_/g, ' ') || 'Unknown', dur: Math.round((m.durationMs || 0) / 100) / 10 }))

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 1, display: 'block' }}>Step Duration (s)</Typography>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={40} />
          <YAxis tick={{ fontSize: 9 }} width={30} />
          <RTooltip contentStyle={{ fontSize: '0.75rem' }} formatter={v => [`${v}s`, 'Duration']} />
          <Bar dataKey="dur" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.dur > 10 ? '#f44336' : d.dur > 5 ? '#ff9800' : '#4caf50'} fillOpacity={0.7} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {data.some(d => d.dur > 5) && (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          <Typography variant="caption" fontWeight={600} color="warning.main">Optimization suggestions</Typography>
          {data.filter(d => d.dur > 5).map((d, i) => (
            <Paper key={i} variant="outlined" sx={{ px: 1.5, py: 0.75, bgcolor: '#fff3e0' }}>
              <Typography variant="caption">
                <strong>{d.name}</strong> took {d.dur}s.
                {d.name.includes('map') && ' Reduce candidate columns or pre-filter schema.'}
                {d.name.includes('generat') && ' Reduce batch size or pre-aggregate data.'}
                {d.name.includes('validat') && ' Add indexes on join columns.'}
                {!d.name.match(/map|generat|validat/) && ' May benefit from caching.'}
              </Typography>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  )
}

// ── D12: Action Replay ──
function ActionReplay({ history }) {
  const [idx, setIdx] = useState(null)
  const previewHistoryAt = usePipelineStore(s => s.previewHistoryAt)
  const clearHistoryPreview = usePipelineStore(s => s.clearHistoryPreview)
  const revertToHistory = usePipelineStore(s => s.revertToHistory)

  if (!history?.length) return <Typography variant="caption" color="text.secondary" sx={{ p: 2 }}>No history yet.</Typography>

  return (
    <Box sx={{ px: 3, py: 2 }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 1, display: 'block' }}>Action Timeline</Typography>
      <Slider min={0} max={history.length - 1} value={idx ?? history.length - 1}
        onChange={(_, v) => { setIdx(v); previewHistoryAt(v) }}
        onChangeCommitted={() => { clearHistoryPreview(); setIdx(null) }}
        valueLabelDisplay="auto"
        valueLabelFormat={v => history[v]?.field || `Step ${v + 1}`}
        sx={{ '& .MuiSlider-mark': { width: 6, height: 6, borderRadius: '50%' }, '& .MuiSlider-markLabel': { fontSize: '0.6rem' } }}
      />
      {idx != null && idx < history.length - 1 && (
        <Button size="small" variant="outlined" color="warning" startIcon={<HistoryIcon sx={{ fontSize: 14 }} />}
          onClick={() => { revertToHistory(idx); clearHistoryPreview(); setIdx(null) }}
          sx={{ mt: 1, textTransform: 'none', fontSize: '0.7rem' }}>Revert here</Button>
      )}
    </Box>
  )
}

// ── Main Component ──
export default function ErrorsTab({ onAction }) {
  const validation = usePipelineStore(s => s.pipelineState.data.validation)
  const errors = usePipelineStore(s => s.pipelineState.errors)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)
  const performanceMetrics = usePipelineStore(s => s.performanceMetrics)
  const setPerformanceMetrics = usePipelineStore(s => s.setPerformanceMetrics)
  const setErrors = usePipelineStore(s => s.setErrors)
  const setConstraintViolations = usePipelineStore(s => s.setConstraintViolations)
  const sessionId = usePipelineStore(s => s.sessionId)
  const history = usePipelineStore(s => s.pipelineState.history)
  const [showPerf, setShowPerf] = useState(false)
  const [showReplay, setShowReplay] = useState(false)

  // Fetch performance metrics and problems from backend on mount
  useEffect(() => {
    if (!sessionId) return
    fetchPerformance(sessionId)
      .then(r => { if (r?.metrics?.length) setPerformanceMetrics(r.metrics) })
      .catch(() => {})
    fetchProblems(sessionId)
      .then(r => {
        if (r?.issues?.length) setErrors(r.issues)
        if (r?.violations?.length) setConstraintViolations(r.violations)
      })
      .catch(() => {})
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const issues = errors.length > 0 ? errors : (validation?.issues || [])
  const passed = validation?.result === 'pass'

  const annotated = useMemo(() => issues.map(i => {
    const a = { ...i }
    if (!a.panel) a.panel = (a.token || a.field) ? 'mappings' : a.category === 'validation' ? 'logic' : undefined
    if (!a.category) a.category = a.panel === 'template' ? 'template' : a.panel === 'mappings' ? 'mapping' : a.panel === 'data' ? 'data' : a.panel === 'logic' ? 'validation' : 'other'
    return a
  }), [issues])

  const categorized = useMemo(() => {
    const g = {}
    annotated.forEach(i => { const c = i.category || 'other'; (g[c] || (g[c] = [])).push(i) })
    return Object.entries(g).sort(([, a], [, b]) => b.filter(i => i.severity === 'error').length - a.filter(i => i.severity === 'error').length)
  }, [annotated])

  const handleJump = (panel, field) => { if (panel) setActivePanel(panel); if (field) setHighlightedField(field) }
  const totalErrors = annotated.filter(i => i.severity === 'error').length
  const totalWarnings = annotated.filter(i => i.severity === 'warning').length

  if (!issues.length && !passed) return <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}><Typography color="text.secondary">No validation results yet.</Typography></Box>

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>{passed ? 'All Checks Passed' : 'Validation Results'}</Typography>
        {passed && <PassIcon sx={{ color: 'success.main' }} />}
        {totalErrors > 0 && <Chip label={`${totalErrors} errors`} size="small" color="error" />}
        {totalWarnings > 0 && <Chip label={`${totalWarnings} warnings`} size="small" color="warning" variant="outlined" />}
      </Box>

      <Box sx={{ px: 2, py: 0.5, display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Button size="small" variant={showPerf ? 'contained' : 'outlined'} startIcon={<PerfIcon sx={{ fontSize: 14 }} />}
          onClick={() => setShowPerf(o => !o)} sx={{ textTransform: 'none', fontSize: '0.7rem' }}>Performance</Button>
        <Button size="small" variant={showReplay ? 'contained' : 'outlined'} startIcon={<HistoryIcon sx={{ fontSize: 14 }} />}
          onClick={() => setShowReplay(o => !o)} sx={{ textTransform: 'none', fontSize: '0.7rem' }}>Replay</Button>
      </Box>

      <Collapse in={showPerf}><Box sx={{ borderBottom: 1, borderColor: 'divider' }}><PerformanceView metrics={performanceMetrics} /></Box></Collapse>
      <Collapse in={showReplay}><Box sx={{ borderBottom: 1, borderColor: 'divider' }}><ActionReplay history={history} /></Box></Collapse>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {categorized.length > 0 ? (
          <Stack spacing={1}>
            {categorized.map(([cat, catIssues]) => (
              <CategoryGroup key={cat} category={cat} issues={catIssues} onJump={handleJump} defaultOpen={catIssues.some(i => i.severity === 'error')} />
            ))}
          </Stack>
        ) : passed ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <PassIcon sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
            <Typography color="text.secondary">All checks passed.</Typography>
          </Box>
        ) : null}
      </Box>

      {!passed && (
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
          <Button variant="outlined" size="small" startIcon={<RetryIcon />} onClick={() => onAction?.('validate')} sx={{ textTransform: 'none' }}>Check again</Button>
        </Box>
      )}
    </Box>
  )
}
