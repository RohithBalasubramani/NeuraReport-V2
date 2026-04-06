/**
 * PreviewTab — Real data preview with:
 * - MUI Pagination + sample selector
 * - json-rules-engine (constraint violations)
 * - react-diff-viewer-continued (output variance)
 * - Null/empty cell highlights
 */
import React, { useMemo, useState, useEffect, lazy, Suspense } from 'react'
import {
  Box, Card, CardContent, MenuItem, Pagination, Paper,
  Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import {
  Preview as PreviewIcon,
  CheckCircle as PassIcon,
  Warning as WarnIcon,
  CompareArrows as DiffIcon,
  Error as ErrorIcon,
} from '@mui/icons-material'
import { Engine } from 'json-rules-engine'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'
import GenerationPanel from '../GenerationPanel'

// Lazy-load diff viewer
const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'))

// ── Constraint Violation Card ──
function ViolationCard({ violation }) {
  const Icon = violation.severity === 'error' ? ErrorIcon : WarnIcon
  const color = violation.severity === 'error' ? 'error.main' : 'warning.main'
  return (
    <Card variant="outlined" sx={{ borderColor: color }}>
      <CardContent sx={{ py: 0.75, px: 1.5, '&:last-child': { pb: 0.75 }, display: 'flex', gap: 1, alignItems: 'center' }}>
        <Icon sx={{ fontSize: 16, color }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="caption" fontWeight={600}>{violation.field}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
            {violation.message}
          </Typography>
        </Box>
        {violation.value != null && (
          <Chip label={String(violation.value)} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
        )}
      </CardContent>
    </Card>
  )
}

// ── Enhanced Data Table with null/empty highlights ──
function DataPreviewTable({ rows, violations }) {
  if (!rows?.length) return null

  const violatedCells = useMemo(() => {
    const map = new Map()
    violations?.forEach(v => {
      if (v.rowIndex != null && v.field) {
        map.set(`${v.rowIndex}-${v.field}`, v.severity)
      }
    })
    return map
  }, [violations])

  const keys = Object.keys(rows[0])

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem', width: 30 }}>#</TableCell>
            {keys.map(k => (
              <TableCell key={k} sx={{ fontWeight: 600, fontSize: '0.7rem' }}>{k}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              <TableCell sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>{i + 1}</TableCell>
              {keys.map(k => {
                const val = row[k]
                const isNull = val === null || val === undefined
                const isEmpty = val === ''
                const violationSev = violatedCells.get(`${i}-${k}`)

                return (
                  <TableCell
                    key={k}
                    className={clsx({
                      'cell-null': isNull,
                      'cell-empty': isEmpty && !isNull,
                      'cell-violation': !!violationSev,
                    })}
                    sx={{
                      fontSize: '0.75rem',
                      bgcolor: violationSev === 'error' ? '#fef2f2'
                        : violationSev === 'warning' ? '#fffbeb'
                        : isNull ? '#fff5f5'
                        : isEmpty ? '#fffde7'
                        : 'transparent',
                    }}
                  >
                    {isNull ? (
                      <Typography variant="caption" color="error.light" fontStyle="italic">null</Typography>
                    ) : isEmpty ? (
                      <Typography variant="caption" color="warning.light" fontStyle="italic">empty</Typography>
                    ) : (
                      String(val)
                    )}
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

// ── Output Variance Compare ──
function OutputVarianceView({ currentHtml, previousHtml }) {
  if (!previousHtml) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          No previous version available for comparison.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, overflow: 'auto' }}>
      <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading diff viewer...</Typography>}>
        <ReactDiffViewer
          oldValue={previousHtml}
          newValue={currentHtml}
          splitView
          useDarkTheme={false}
          leftTitle="Previous"
          rightTitle="Current"
          styles={{
            contentText: { fontSize: '0.7rem', fontFamily: 'monospace' },
          }}
        />
      </Suspense>
    </Box>
  )
}

// ── Constraint Engine ──
async function runConstraints(rows, contractRules) {
  const engine = new Engine()
  const violations = []

  // Build rules from contract or defaults
  const rules = contractRules || []

  // Default domain rules
  const defaultRules = [
    {
      conditions: {
        any: Object.keys(rows[0] || {}).map(field => ({
          fact: 'row',
          path: `.${field}`,
          operator: 'equal',
          value: null,
        })),
      },
      event: { type: 'null-value', params: { severity: 'warning', message: 'Contains null value' } },
    },
  ]

  const allRules = [...defaultRules, ...rules]

  for (const rule of allRules) {
    try {
      const tempEngine = new Engine()
      tempEngine.addRule({ ...rule, priority: 1 })

      for (let i = 0; i < Math.min(rows.length, 50); i++) {
        try {
          const result = await tempEngine.run({ row: rows[i] })
          result.events.forEach(evt => {
            const params = evt.params || {}
            // Find which field triggered
            const nullFields = Object.entries(rows[i])
              .filter(([_, v]) => v === null || v === undefined || v === '')
              .map(([k]) => k)

            nullFields.forEach(field => {
              violations.push({
                field,
                rowIndex: i,
                value: rows[i][field],
                severity: params.severity || 'warning',
                message: params.message || evt.type,
              })
            })
          })
        } catch { /* row didn't match — that's fine */ }
      }
    } catch { /* rule parse error */ }
  }

  // Deduplicate by field
  const seen = new Set()
  return violations.filter(v => {
    const key = `${v.field}-${v.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function DryRunSummary({ validation, generation }) {
  const dryRun = validation?.dryRunPdf
  const batches = generation?.batches || []
  const jobs = generation?.jobs || []
  const completedJobs = jobs.filter(j => j.status === 'completed')

  return (
    <Stack spacing={1}>
      {batches.length > 0 && (
        <Card variant="outlined">
          <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PassIcon sx={{ fontSize: 16, color: 'success.main' }} />
              <Typography variant="body2" fontWeight={600}>
                {batches.length} batches available
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Total rows: {batches.reduce((s, b) => s + (b.row_count || 0), 0).toLocaleString()}
            </Typography>
          </CardContent>
        </Card>
      )}
      {completedJobs.length > 0 && (
        <Card variant="outlined">
          <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PassIcon sx={{ fontSize: 16, color: 'success.main' }} />
              <Typography variant="body2" fontWeight={600}>{completedJobs.length} reports generated</Typography>
            </Box>
          </CardContent>
        </Card>
      )}
      {dryRun && (
        <Card variant="outlined">
          <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
            <Typography variant="caption" color="text.secondary">Test run completed successfully.</Typography>
          </CardContent>
        </Card>
      )}
    </Stack>
  )
}

export default function PreviewTab({ onAction }) {
  const validation = usePipelineStore(s => s.pipelineState.data.validation)
  const generation = usePipelineStore(s => s.pipelineState.data.generation)
  const contract = usePipelineStore(s => s.pipelineState.data.contract)
  const statusView = usePipelineStore(s => s.statusView)
  const constraintViolations = usePipelineStore(s => s.constraintViolations)
  const templateVersions = usePipelineStore(s => s.templateVersions)

  const [currentPage, setCurrentPage] = useState(1)
  const [selectedBatch, setSelectedBatch] = useState('')
  const [viewMode, setViewMode] = useState('preview') // preview | compare
  const [localViolations, setLocalViolations] = useState([])

  const hasBatches = (generation?.batches?.length || 0) > 0
  const hasJobs = (generation?.jobs?.length || 0) > 0
  const hasDryRun = !!validation?.dryRunPdf
  const hasPreviewData = hasBatches || hasJobs || hasDryRun

  const example = statusView?.example
  const batches = generation?.batches || []
  const rowsPerPage = 10

  // Paginated rows
  const allRows = example?.rows || []
  const totalPages = Math.max(1, Math.ceil(allRows.length / rowsPerPage))
  const paginatedRows = allRows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage)

  // Run constraint engine on mount when we have data
  useEffect(() => {
    if (allRows.length === 0) return
    const contractRules = contract?.contract?.constraints || []
    runConstraints(allRows, contractRules).then(setLocalViolations)
  }, [allRows, contract])

  // Merge backend + local violations
  const allViolations = useMemo(() => [
    ...(constraintViolations || []),
    ...localViolations,
  ], [constraintViolations, localViolations])

  if (!hasPreviewData && !example) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Box sx={{ textAlign: 'center' }}>
          <PreviewIcon sx={{ fontSize: 48, color: 'grey.300', mb: 1 }} />
          <Typography color="text.secondary">No preview available yet.</Typography>
          <Typography variant="caption" color="text.disabled">
            Run validation to see a preview with real data.
          </Typography>
        </Box>
      </Box>
    )
  }

  // If generation in progress, show full GenerationPanel
  if (hasBatches || hasJobs) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <GenerationPanel onAction={onAction} />
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Preview</Typography>

        <ToggleButtonGroup
          size="small"
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          sx={{ '& .MuiToggleButton-root': { px: 0.75, py: 0.25 } }}
        >
          <ToggleButton value="preview">
            <Tooltip title="Data preview"><PreviewIcon sx={{ fontSize: 14 }} /></Tooltip>
          </ToggleButton>
          <ToggleButton value="compare">
            <Tooltip title="Compare with previous"><DiffIcon sx={{ fontSize: 14 }} /></Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Batch selector */}
      {batches.length > 1 && (
        <Box sx={{ px: 2, py: 0.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">Batch:</Typography>
          <Select
            size="small"
            value={selectedBatch}
            onChange={(e) => setSelectedBatch(e.target.value)}
            displayEmpty
            sx={{ fontSize: '0.75rem', height: 28, minWidth: 120 }}
          >
            <MenuItem value="">All batches</MenuItem>
            {batches.map((b, i) => (
              <MenuItem key={i} value={b.key || b.name || i} sx={{ fontSize: '0.75rem' }}>
                {b.key || b.name || `Batch ${i + 1}`} ({b.row_count || 0} rows)
              </MenuItem>
            ))}
          </Select>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {viewMode === 'compare' ? (
          <OutputVarianceView
            currentHtml={JSON.stringify(allRows, null, 2)}
            previousHtml={templateVersions.length > 1 ? JSON.stringify(templateVersions[templateVersions.length - 2], null, 2) : null}
          />
        ) : (
          <>
            <DryRunSummary validation={validation} generation={generation} />

            {/* Constraint violations */}
            {allViolations.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" fontWeight={600} color="warning.main" sx={{ mb: 0.5, display: 'block' }}>
                  Constraint Violations ({allViolations.length})
                </Typography>
                <Stack spacing={0.5}>
                  {allViolations.slice(0, 10).map((v, i) => (
                    <ViolationCard key={i} violation={v} />
                  ))}
                  {allViolations.length > 10 && (
                    <Typography variant="caption" color="text.disabled">
                      + {allViolations.length - 10} more violations
                    </Typography>
                  )}
                </Stack>
              </Box>
            )}

            {/* Data table */}
            {paginatedRows.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  {example?.label || 'Sample data:'}
                </Typography>
                <DataPreviewTable rows={paginatedRows} violations={allViolations} />

                {/* Pagination */}
                {totalPages > 1 && (
                  <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}>
                    <Pagination
                      count={totalPages}
                      page={currentPage}
                      onChange={(_, page) => setCurrentPage(page)}
                      size="small"
                      color="primary"
                    />
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
