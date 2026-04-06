/**
 * DataTab — Database explorer with:
 * - react-querybuilder (visual query builder)
 * - Recharts (temporal consistency chart, sparklines)
 * - arquero (client-side column profiling: null%, distributions)
 * - Row explosion/collapse indicator
 * - Column tagging (ID / Date / Metric)
 * - Enhanced schema explorer (Hasura-style)
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Box, Chip, Collapse, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
  ToggleButton, ToggleButtonGroup, Button,
} from '@mui/material'
import {
  Storage as DbIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  TableChart as TableIcon,
  Key as KeyIcon,
  CalendarMonth as DateIcon,
  BarChart as MetricIcon,
  FilterAlt as FilterIcon,
} from '@mui/icons-material'
import { QueryBuilder, formatQuery } from 'react-querybuilder'
import 'react-querybuilder/dist/query-builder.css'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'
import { humanizeColumn } from '../../utils'
import { RowFlowCompression } from '../viz'

// ── Column Tag Selector ──
function ColumnTagSelector({ column, currentTag, onTag }) {
  const tags = [
    { value: 'id', label: 'ID', icon: <KeyIcon sx={{ fontSize: 12 }} />, color: 'primary' },
    { value: 'date', label: 'Date', icon: <DateIcon sx={{ fontSize: 12 }} />, color: 'info' },
    { value: 'metric', label: 'Metric', icon: <MetricIcon sx={{ fontSize: 12 }} />, color: 'success' },
  ]
  return (
    <Stack direction="row" spacing={0.25}>
      {tags.map(tag => (
        <Chip
          key={tag.value}
          icon={tag.icon}
          label={tag.label}
          size="small"
          color={currentTag === tag.value ? tag.color : 'default'}
          variant={currentTag === tag.value ? 'filled' : 'outlined'}
          onClick={() => onTag(column, currentTag === tag.value ? null : tag.value)}
          sx={{ height: 20, fontSize: '0.6rem', cursor: 'pointer' }}
        />
      ))}
    </Stack>
  )
}

// ── Temporal Consistency Chart ──
function TemporalChart({ data }) {
  if (!data?.length) return null
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        Record Distribution Over Time
      </Typography>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="period" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} width={30} />
          <RechartsTooltip
            contentStyle={{ fontSize: '0.75rem' }}
            formatter={(value) => [`${value} records`, 'Count']}
          />
          <Bar dataKey="count" fill="#2196F3" fillOpacity={0.7} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}

// ── Lazy-loaded arquero for column profiling ──
let _aqModule = null
function useArquero() {
  const [ready, setReady] = useState(!!_aqModule)
  useEffect(() => {
    if (_aqModule) return
    import('arquero').then((m) => { _aqModule = m; setReady(true) }).catch(() => {})
  }, [])
  return ready ? _aqModule : null
}

function useColumnProfile(sampleData, aq) {
  return useMemo(() => {
    if (!aq || !sampleData?.length) return {}
    try {
      const dt = aq.from(sampleData)
      const result = {}
      dt.columnNames().forEach((col) => {
        const total = dt.numRows()
        let nulls = 0
        try { nulls = dt.filter(aq.escape((d) => d[col] == null || d[col] === '')).numRows() } catch { /* skip */ }
        let distinct = 0
        try { distinct = dt.groupby(col).count().numRows() } catch { /* skip */ }
        let distribution = []
        try {
          distribution = dt.groupby(col).count().orderby(aq.desc('count')).slice(0, 8).objects()
            .map((r) => ({ name: String(r[col] ?? ''), count: r.count }))
        } catch { /* skip */ }
        result[col] = { nullPct: total > 0 ? (nulls / total) * 100 : 0, distinct, distribution }
      })
      return result
    } catch { return {} }
  }, [sampleData, aq])
}

// ── Inline Sparkline for column distribution ──
function ColumnSparkline({ data }) {
  if (!data?.length) return null
  return (
    <ResponsiveContainer width={60} height={18}>
      <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <Bar dataKey="count" fill="#90CAF9" radius={[1, 1, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Enhanced Table Section ──
function TableSection({ tableName, columns, defaultOpen = false, columnTags, onTag, usedColumns, foreignKeys, columnProfile }) {
  const [open, setOpen] = useState(defaultOpen)
  const usedCount = columns.filter(c => usedColumns.has(`${tableName}.${c.name}`) || usedColumns.has(c.name)).length

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1,
          cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <TableIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>{tableName}</Typography>
        <Chip label={`${columns.length} cols`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
        {usedCount > 0 && (
          <Chip label={`${usedCount} used`} size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
        )}
        {open ? <CollapseIcon sx={{ fontSize: 18 }} /> : <ExpandIcon sx={{ fontSize: 18 }} />}
      </Box>
      <Collapse in={open}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>Column</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>Nullable</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>Used</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>Null%</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>Dist.</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>Tag</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {columns.map(col => {
                const fullName = `${tableName}.${col.name}`
                const isUsed = usedColumns.has(fullName) || usedColumns.has(col.name)
                const isPk = col.pk || col.primary_key
                const fk = foreignKeys?.find(fk => fk.from === col.name)
                return (
                  <TableRow
                    key={col.name}
                    className={clsx({ 'row-used': isUsed })}
                    sx={isUsed ? { bgcolor: 'success.50' } : {}}
                  >
                    <TableCell sx={{ fontSize: '0.75rem' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {isPk && <KeyIcon sx={{ fontSize: 12, color: 'warning.main' }} />}
                        {col.name}
                        {fk && (
                          <Tooltip title={`FK → ${fk.to_table}.${fk.to_column}`}>
                            <Typography variant="caption" color="info.main" sx={{ fontSize: '0.6rem' }}>
                              → {fk.to_table}
                            </Typography>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>
                      <Chip label={col.type || 'text'} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>
                      {col.nullable !== false ? (
                        <Typography variant="caption" color="text.disabled">yes</Typography>
                      ) : (
                        <Chip label="NOT NULL" size="small" color="warning" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
                      )}
                    </TableCell>
                    <TableCell>
                      {isUsed ? (
                        <Chip label="In use" size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
                      ) : (
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.7rem' }}>
                      {(() => {
                        const p = columnProfile?.[col.name] || columnProfile?.[fullName]
                        if (!p) return <Typography variant="caption" color="text.disabled">--</Typography>
                        const pct = p.nullPct
                        const color = pct > 50 ? 'error' : pct > 10 ? 'warning' : 'success'
                        return (
                          <Tooltip title={`${pct.toFixed(1)}% null`}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 50 }}>
                              <Box sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: 'grey.200', overflow: 'hidden' }}>
                                <Box sx={{ width: `${100 - pct}%`, height: '100%', bgcolor: `${color}.main`, borderRadius: 2 }} />
                              </Box>
                              <Typography variant="caption" sx={{ fontSize: '0.55rem' }}>{pct.toFixed(0)}%</Typography>
                            </Box>
                          </Tooltip>
                        )
                      })()}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const p = columnProfile?.[col.name] || columnProfile?.[fullName]
                        return <ColumnSparkline data={p?.distribution} />
                      })()}
                    </TableCell>
                    <TableCell>
                      <ColumnTagSelector
                        column={fullName}
                        currentTag={columnTags[fullName]}
                        onTag={onTag}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Collapse>
    </Paper>
  )
}

export default function DataTab({ onAction }) {
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const columnStats = usePipelineStore(s => s.columnStats)
  const columnTags = usePipelineStore(s => s.columnTags)
  const setColumnTag = usePipelineStore(s => s.setColumnTag)
  const statusView = usePipelineStore(s => s.statusView)
  const queryBuilderState = usePipelineStore(s => s.queryBuilderState)
  const setQueryBuilderState = usePipelineStore(s => s.setQueryBuilderState)
  const catalog = mapping?.catalog

  const [showQueryBuilder, setShowQueryBuilder] = useState(false)
  const [showTemporal, setShowTemporal] = useState(false)

  // Arquero profiling from token_samples
  const aq = useArquero()
  const sampleData = useMemo(() => {
    const samples = mapping?.token_samples
    if (!samples || !Object.keys(samples).length) return null
    const tokens = Object.keys(samples)
    const maxLen = Math.max(...tokens.map((t) => (Array.isArray(samples[t]) ? samples[t].length : 1)))
    return Array.from({ length: maxLen }, (_, i) =>
      Object.fromEntries(tokens.map((t) => [t, Array.isArray(samples[t]) ? samples[t][i] : samples[t]]))
    )
  }, [mapping?.token_samples])
  const columnProfile = useColumnProfile(sampleData, aq)

  // Parse catalog into table → columns structure
  const tables = useMemo(() => {
    if (!catalog) return []
    if (Array.isArray(catalog)) {
      const grouped = {}
      catalog.forEach(col => {
        const parts = (typeof col === 'string' ? col : col.name || '').split('.')
        const table = parts.length > 1 ? parts[0] : 'default'
        const name = parts.length > 1 ? parts.slice(1).join('.') : parts[0]
        if (!grouped[table]) grouped[table] = []
        grouped[table].push({ name, type: col.type, nullable: col.nullable, pk: col.pk })
      })
      return Object.entries(grouped).map(([name, cols]) => ({ name, columns: cols }))
    }
    if (typeof catalog === 'object') {
      return Object.entries(catalog).map(([name, cols]) => ({
        name,
        columns: (Array.isArray(cols) ? cols : []).map(c =>
          typeof c === 'string' ? { name: c, type: 'text' } : c
        ),
      }))
    }
    return []
  }, [catalog])

  // Used columns from mapping
  const usedColumns = useMemo(() => {
    const used = new Set()
    const m = mapping?.mapping || {}
    Object.values(m).forEach(v => {
      if (v && typeof v === 'string' && v.includes('.')) used.add(v)
    })
    return used
  }, [mapping?.mapping])

  // Query builder fields from catalog
  const queryFields = useMemo(() =>
    tables.flatMap(t =>
      t.columns.map(c => ({
        name: `${t.name}.${c.name}`,
        label: `${c.name} (${t.name})`,
        inputType: columnTags[`${t.name}.${c.name}`] === 'date' ? 'date'
          : columnTags[`${t.name}.${c.name}`] === 'metric' ? 'number'
          : 'text',
      }))
    ),
  [tables, columnTags])

  // Default query builder state
  const defaultQuery = { combinator: 'and', rules: [] }
  const query = queryBuilderState || defaultQuery

  // Temporal chart data from columnStats (date-tagged columns)
  const temporalData = useMemo(() => {
    const dateColumns = Object.entries(columnTags).filter(([_, tag]) => tag === 'date')
    if (dateColumns.length === 0) return null
    const firstDateCol = dateColumns[0][0]
    const stats = columnStats[firstDateCol]
    return stats?.temporalDistribution || null
  }, [columnTags, columnStats])

  // Handle query execution
  const handleRunQuery = useCallback(() => {
    const sql = formatQuery(query, 'sql')
    onAction?.({ type: 'inspect_data', query: sql })
  }, [query, onAction])

  if (tables.length === 0) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Box sx={{ textAlign: 'center' }}>
          <DbIcon sx={{ fontSize: 48, color: 'grey.300', mb: 1 }} />
          <Typography color="text.secondary">No database connected yet.</Typography>
          <Typography variant="caption" color="text.disabled">
            Connect a database to explore your data here.
          </Typography>
        </Box>
      </Box>
    )
  }

  const totalCols = tables.reduce((s, t) => s + t.columns.length, 0)
  const usedCount = [...usedColumns].length

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Database Explorer</Typography>
        <Chip label={`${tables.length} tables`} size="small" variant="outlined" />
        <Chip label={`${usedCount}/${totalCols} used`} size="small" color="primary" variant="outlined" />
      </Box>

      {/* Toolbar */}
      <Box sx={{ px: 2, py: 0.5, display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Button
          size="small"
          variant={showQueryBuilder ? 'contained' : 'outlined'}
          startIcon={<FilterIcon sx={{ fontSize: 14 }} />}
          onClick={() => setShowQueryBuilder(o => !o)}
          sx={{ textTransform: 'none', fontSize: '0.7rem' }}
        >
          Query Builder
        </Button>
        <Button
          size="small"
          variant={showTemporal ? 'contained' : 'outlined'}
          startIcon={<DateIcon sx={{ fontSize: 14 }} />}
          onClick={() => setShowTemporal(o => !o)}
          sx={{ textTransform: 'none', fontSize: '0.7rem' }}
        >
          Timeline
        </Button>
      </Box>

      {/* Query Builder (collapsible) */}
      <Collapse in={showQueryBuilder}>
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
          <QueryBuilder
            fields={queryFields}
            query={query}
            onQueryChange={setQueryBuilderState}
            controlClassnames={{
              queryBuilder: 'qb-compact',
            }}
          />
          <Box sx={{ mt: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button size="small" variant="contained" onClick={handleRunQuery} sx={{ textTransform: 'none', fontSize: '0.7rem' }}>
              Run Query
            </Button>
            <Typography variant="caption" color="text.disabled" fontFamily="monospace" sx={{ flex: 1 }} noWrap>
              {formatQuery(query, 'sql')}
            </Typography>
          </Box>
        </Box>
      </Collapse>

      {/* Row Flow (if available) */}
      {statusView?.row_counts && (
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Data Flow
          </Typography>
          <RowFlowCompression counts={statusView.row_counts} compact />
        </Box>
      )}

      {/* Temporal Chart (collapsible) */}
      <Collapse in={showTemporal}>
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          {temporalData ? (
            <TemporalChart data={temporalData} />
          ) : (
            <Typography variant="caption" color="text.secondary">
              Tag a column as "Date" to see the temporal distribution chart.
            </Typography>
          )}
        </Box>
      </Collapse>

      {/* Table list */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Stack spacing={1}>
          {tables.map((t, i) => (
            <TableSection
              key={t.name}
              tableName={t.name}
              columns={t.columns}
              defaultOpen={i === 0}
              columnTags={columnTags}
              onTag={setColumnTag}
              usedColumns={usedColumns}
              foreignKeys={t.foreignKeys || []}
              columnProfile={columnProfile}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  )
}
