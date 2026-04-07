/**
 * PreviewTab — Real data preview with constraints and output comparison.
 *
 * References:
 *   - MUI DataGrid: paginated data table with cell highlighting
 *   - json-rules-engine: declarative constraint validation
 *   - react-diff-viewer-continued: output variance comparison
 *
 * Covers:
 *   6a: Real data preview (DataPreviewTable with pagination)
 *   6b: Constraint violations (json-rules-engine + ViolationCards)
 *   6c: Constraint rule editor (ConstraintRuleEditor UI)
 *   6d: Sample/batch selector (enhanced batch selector)
 *   6e: Toggle raw vs formatted (showRaw toggle)
 *   8b: Output variance check (diff viewer + trace-to-cause)
 *   D8: Output variance check
 *   D9: Constraint violations
 */
import React, { useMemo, useState, useEffect, lazy, Suspense } from 'react'
import {
  Box, Button, Card, CardContent, Chip, FormControl, InputLabel, MenuItem,
  Pagination, Paper, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import {
  Preview as PreviewIcon, CheckCircle as PassIcon, Warning as WarnIcon,
  CompareArrows as DiffIcon, Error as ErrorIcon, Code as RawIcon,
  Rule as RuleIcon, InfoOutlined as InfoIcon,
} from '@mui/icons-material'
import { Engine } from 'json-rules-engine'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'
import GenerationPanel from '../GenerationPanel'
import { fetchBatches, fetchConstraints, saveConstraints } from '@/api/widgetData'

const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'))

// ── 6b: Violation Card ──
function ViolationCard({ violation }) {
  const Icon = violation.severity === 'error' ? ErrorIcon : WarnIcon
  const color = violation.severity === 'error' ? 'error.main' : 'warning.main'
  return (
    <Card variant="outlined" sx={{ borderColor: color }}>
      <CardContent sx={{ py: 0.75, px: 1.5, '&:last-child': { pb: 0.75 }, display: 'flex', gap: 1, alignItems: 'center' }}>
        <Icon sx={{ fontSize: 16, color }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" fontWeight={600}>{violation.field}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>{violation.message}</Typography>
        </Box>
        {violation.value != null && <Chip label={String(violation.value)} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />}
      </CardContent>
    </Card>
  )
}

// 6e: Strip formatting for raw display
function stripFormatting(val) {
  if (val == null) return val
  const s = String(val)
  if (/[$,%]/.test(s) || /\d{1,3}(,\d{3})+/.test(s)) {
    const num = Number(s.replace(/[$,%\s]/g, ''))
    if (!isNaN(num)) return String(num)
  }
  return s
}

// ── 6a: Data Preview Table ──
function DataPreviewTable({ rows, violations, rawMode }) {
  if (!rows?.length) return null
  const violatedCells = useMemo(() => {
    const map = new Map()
    violations?.forEach(v => { if (v.rowIndex != null && v.field) map.set(`${v.rowIndex}-${v.field}`, v.severity) })
    return map
  }, [violations])
  const keys = Object.keys(rows[0])

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem', width: 30 }}>#</TableCell>
            {keys.map(k => <TableCell key={k} sx={{ fontWeight: 600, fontSize: '0.7rem' }}>{k}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>{i + 1}</TableCell>
              {keys.map(k => {
                const val = row[k]
                const isNull = val == null
                const isEmpty = val === ''
                const sev = violatedCells.get(`${i}-${k}`)
                return (
                  <TableCell key={k} className={clsx({ 'cell-null': isNull, 'cell-empty': isEmpty })}
                    sx={{
                      fontSize: '0.75rem', fontFamily: rawMode ? 'monospace' : 'inherit',
                      bgcolor: sev === 'error' ? '#fef2f2' : sev === 'warning' ? '#fffbeb' : isNull ? '#fff5f5' : isEmpty ? '#fffde7' : 'transparent',
                    }}>
                    {isNull ? <Typography variant="caption" color="error.light" fontStyle="italic">null</Typography>
                      : isEmpty ? <Typography variant="caption" color="warning.light" fontStyle="italic">empty</Typography>
                      : rawMode ? stripFormatting(val) : String(val)}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

// ── 8b/D8: Output Variance ──
function OutputVarianceView({ currentHtml, previousHtml, tokenNames, onTokenClick }) {
  if (!previousHtml) return <Box sx={{ p: 2 }}><Typography variant="caption" color="text.secondary">No previous version available.</Typography></Box>
  return (
    <Box sx={{ flex: 1, overflow: 'auto' }}>
      <Box sx={{ px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'action.hover', borderRadius: 1, mb: 1 }}>
        <InfoIcon sx={{ fontSize: 14, color: 'info.main' }} />
        <Typography variant="caption" color="text.secondary">Click a changed field to trace its source.</Typography>
      </Box>
      <Box onClick={e => { const t = e.target?.textContent || ''; const m = tokenNames?.find(n => t.includes(n)); if (m) onTokenClick?.(m) }} sx={{ cursor: 'pointer' }}>
        <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading diff...</Typography>}>
          <ReactDiffViewer oldValue={previousHtml} newValue={currentHtml} splitView useDarkTheme={false} leftTitle="Previous" rightTitle="Current"
            styles={{ contentText: { fontSize: '0.7rem', fontFamily: 'monospace' } }} />
        </Suspense>
      </Box>
    </Box>
  )
}

// ── Constraint Engine ──
async function runConstraints(rows, rules) {
  const violations = []
  const defaultRules = [{
    conditions: { any: Object.keys(rows[0] || {}).map(f => ({ fact: 'row', path: `.${f}`, operator: 'equal', value: null })) },
    event: { type: 'null-value', params: { severity: 'warning', message: 'Contains null value' } },
  }]
  for (const rule of [...defaultRules, ...rules]) {
    try {
      const eng = new Engine()
      eng.addRule({ ...rule, priority: 1 })
      for (let i = 0; i < Math.min(rows.length, 50); i++) {
        try {
          const res = await eng.run({ row: rows[i] })
          res.events.forEach(evt => {
            Object.entries(rows[i]).filter(([, v]) => v == null || v === '').forEach(([k]) => {
              violations.push({ field: k, rowIndex: i, value: rows[i][k], severity: evt.params?.severity || 'warning', message: evt.params?.message || evt.type })
            })
          })
        } catch {}
      }
    } catch {}
  }
  const seen = new Set()
  return violations.filter(v => { const k = `${v.field}-${v.message}`; if (seen.has(k)) return false; seen.add(k); return true })
}

// ── 6c: Constraint Rule Editor ──
function ConstraintRuleEditor({ allRows, onRulesChanged }) {
  const customRules = usePipelineStore(s => s.customConstraintRules)
  const setCustomConstraintRules = usePipelineStore(s => s.setCustomConstraintRules)
  const sessionId = usePipelineStore(s => s.sessionId)
  const [showForm, setShowForm] = useState(false)
  const [field, setField] = useState('')
  const [operator, setOperator] = useState('equal')
  const [value, setValue] = useState('')
  const [severity, setSeverity] = useState('warning')
  const fields = Object.keys(allRows[0] || {})

  // Load persisted rules on mount
  useEffect(() => {
    if (!sessionId) return
    fetchConstraints(sessionId)
      .then(r => { if (r?.rules?.length) setCustomConstraintRules(r.rules) })
      .catch(() => {})
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = () => {
    if (!field) return
    const updated = [...(customRules || []), { field, operator, value, severity }]
    setCustomConstraintRules(updated)
    setShowForm(false); setField(''); setValue('')
    onRulesChanged?.(updated)
    if (sessionId) saveConstraints(sessionId, updated).catch(() => {})
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Constraint Rules</Typography>
      <Stack spacing={1} sx={{ mb: 2 }}>
        {(customRules || []).map((r, i) => (
          <Card key={i} variant="outlined">
            <CardContent sx={{ py: 0.75, px: 1.5, '&:last-child': { pb: 0.75 }, display: 'flex', alignItems: 'center', gap: 1 }}>
              {r.severity === 'error' ? <ErrorIcon sx={{ fontSize: 14, color: 'error.main' }} /> : <WarnIcon sx={{ fontSize: 14, color: 'warning.main' }} />}
              <Typography variant="caption"><b>{r.field}</b> {r.operator} <code>{r.value}</code></Typography>
              <Chip label={r.severity} size="small" color={r.severity === 'error' ? 'error' : 'warning'} sx={{ height: 18, fontSize: '0.6rem', ml: 'auto' }} />
            </CardContent>
          </Card>
        ))}
      </Stack>
      {showForm ? (
        <Card variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <FormControl size="small" fullWidth><InputLabel>Field</InputLabel>
              <Select value={field} onChange={e => setField(e.target.value)} label="Field">{fields.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}</Select></FormControl>
            <FormControl size="small" fullWidth><InputLabel>Operator</InputLabel>
              <Select value={operator} onChange={e => setOperator(e.target.value)} label="Operator">
                {['equal', 'notEqual', 'greaterThan', 'lessThan', 'contains'].map(op => <MenuItem key={op} value={op}>{op}</MenuItem>)}</Select></FormControl>
            <TextField size="small" label="Value" value={value} onChange={e => setValue(e.target.value)} fullWidth />
            <FormControl size="small" fullWidth><InputLabel>Severity</InputLabel>
              <Select value={severity} onChange={e => setSeverity(e.target.value)} label="Severity">
                <MenuItem value="warning">Warning</MenuItem><MenuItem value="error">Error</MenuItem></Select></FormControl>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="contained" onClick={handleSave} disabled={!field}>Save</Button>
              <Button size="small" onClick={() => setShowForm(false)}>Cancel</Button>
            </Box>
          </Stack>
        </Card>
      ) : <Button size="small" variant="outlined" startIcon={<RuleIcon sx={{ fontSize: 14 }} />} onClick={() => setShowForm(true)}>Add Rule</Button>}
    </Box>
  )
}

// ── Main Component ──
export default function PreviewTab({ onAction }) {
  const validation = usePipelineStore(s => s.pipelineState.data.validation)
  const generation = usePipelineStore(s => s.pipelineState.data.generation)
  const contract = usePipelineStore(s => s.pipelineState.data.contract)
  const statusView = usePipelineStore(s => s.statusView)
  const constraintViolations = usePipelineStore(s => s.constraintViolations)
  const templateVersions = usePipelineStore(s => s.templateVersions)
  const template = usePipelineStore(s => s.pipelineState.data.template)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)
  const sessionId = usePipelineStore(s => s.sessionId)
  const setGenerationData = usePipelineStore(s => s.setGenerationData)

  const [page, setPage] = useState(1)
  const [selectedBatch, setSelectedBatch] = useState('')

  // Fetch batches from backend on mount when session has a contract
  useEffect(() => {
    if (!sessionId || !contract?.contract) return
    fetchBatches(sessionId)
      .then(r => { if (r?.batches?.length) setGenerationData({ batches: r.batches }) })
      .catch(() => {})
  }, [sessionId, contract?.contract]) // eslint-disable-line react-hooks/exhaustive-deps
  const [viewMode, setViewMode] = useState('preview')
  const [localViolations, setLocalViolations] = useState([])
  const [showRaw, setShowRaw] = useState(false)

  const example = statusView?.example
  const batches = generation?.batches || []
  const allRows = example?.rows || []
  const perPage = 10
  const totalPages = Math.max(1, Math.ceil(allRows.length / perPage))
  const pageRows = allRows.slice((page - 1) * perPage, page * perPage)

  useEffect(() => {
    if (!allRows.length) return
    runConstraints(allRows, contract?.contract?.constraints || []).then(setLocalViolations)
  }, [allRows, contract])

  const allViolations = useMemo(() => [...(constraintViolations || []), ...localViolations], [constraintViolations, localViolations])

  const hasGen = (generation?.batches?.length || 0) > 0 || (generation?.jobs?.length || 0) > 0

  if (!hasGen && !example) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Box sx={{ textAlign: 'center' }}>
          <PreviewIcon sx={{ fontSize: 48, color: '#e0e0e0', mb: 1 }} />
          <Typography color="text.secondary">No preview available yet.</Typography>
        </Box>
      </Box>
    )
  }

  if (hasGen) return <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}><GenerationPanel onAction={onAction} /></Box>

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Preview</Typography>
        <ToggleButtonGroup size="small" value={showRaw ? 'raw' : null} onChange={() => setShowRaw(r => !r)} sx={{ '& .MuiToggleButton-root': { px: 0.75, py: 0.25 }, mr: 0.5 }}>
          <ToggleButton value="raw" selected={showRaw}><Tooltip title="Raw values"><RawIcon sx={{ fontSize: 14 }} /></Tooltip></ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup size="small" value={viewMode} exclusive onChange={(_, v) => v && setViewMode(v)} sx={{ '& .MuiToggleButton-root': { px: 0.75, py: 0.25 } }}>
          <ToggleButton value="preview"><Tooltip title="Data"><PreviewIcon sx={{ fontSize: 14 }} /></Tooltip></ToggleButton>
          <ToggleButton value="compare"><Tooltip title="Compare"><DiffIcon sx={{ fontSize: 14 }} /></Tooltip></ToggleButton>
          <ToggleButton value="rules"><Tooltip title="Rules"><RuleIcon sx={{ fontSize: 14 }} /></Tooltip></ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* 6d: Batch selector */}
      {batches.length > 0 && (
        <Box sx={{ px: 2, py: 0.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">Batch:</Typography>
          <Select size="small" value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)} displayEmpty sx={{ fontSize: '0.75rem', height: 28, minWidth: 120 }}>
            <MenuItem value="">All</MenuItem>
            {batches.map((b, i) => <MenuItem key={i} value={b.key || i}>{b.key || `Batch ${i + 1}`} ({b.row_count || 0})</MenuItem>)}
          </Select>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {viewMode === 'rules' ? (
          <ConstraintRuleEditor allRows={allRows} onRulesChanged={updated => {
            runConstraints(allRows, [...(contract?.contract?.constraints || []), ...updated.map(r => ({
              conditions: { all: [{ fact: 'row', path: `.${r.field}`, operator: r.operator, value: r.value }] },
              event: { type: 'custom', params: { severity: r.severity, message: `${r.field} ${r.operator} ${r.value}` } },
            }))]).then(setLocalViolations)
          }} />
        ) : viewMode === 'compare' ? (
          <OutputVarianceView currentHtml={JSON.stringify(allRows, null, 2)}
            previousHtml={templateVersions.length > 1 ? JSON.stringify(templateVersions[templateVersions.length - 2], null, 2) : null}
            tokenNames={(template?.tokens || []).map(t => typeof t === 'string' ? t : t.name)}
            onTokenClick={setHighlightedField} />
        ) : (
          <>
            {allViolations.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" fontWeight={600} color="warning.main" sx={{ mb: 0.5, display: 'block' }}>
                  Violations ({allViolations.length})
                </Typography>
                <Stack spacing={0.5}>
                  {allViolations.slice(0, 10).map((v, i) => <ViolationCard key={i} violation={v} />)}
                  {allViolations.length > 10 && <Typography variant="caption" color="text.disabled">+{allViolations.length - 10} more</Typography>}
                </Stack>
              </Box>
            )}
            {pageRows.length > 0 && (
              <Box>
                <DataPreviewTable rows={pageRows} violations={allViolations} rawMode={showRaw} />
                {totalPages > 1 && (
                  <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}>
                    <Pagination count={totalPages} page={page} onChange={(_, p) => setPage(p)} size="small" color="primary" />
                  </Box>
                )}
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  )
}
