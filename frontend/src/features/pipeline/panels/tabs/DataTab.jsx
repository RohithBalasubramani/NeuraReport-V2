/**
 * DataTab — Database explorer and data quality panel.
 *
 * References:
 *   - Hasura Console: expandable table/column explorer with FK indicators
 *   - react-querybuilder: visual SQL query builder
 *   - Recharts: temporal distribution charts with anomaly detection
 *   - arquero: client-side column profiling (null%, distributions)
 *
 * Covers:
 *   3a: Database explorer (tables, columns with FK/PK indicators)
 *   3b: Query builder (react-querybuilder with SQL output)
 *   3c: Column tagging (ID/Date/Metric chips per column)
 *   3d: Preview in report button (column click → preview panel)
 *   D2: Data quality (null% bars, sparklines, outlier markers)
 *   D6: Temporal consistency (Recharts bar chart with gap/spike highlighting)
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Box, Button, Chip, Collapse, IconButton, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import {
  Storage as DbIcon, ExpandMore as ExpandIcon, ExpandLess as CollapseIcon,
  TableChart as TableIcon, Key as KeyIcon, CalendarMonth as DateIcon,
  BarChart as MetricIcon, FilterAlt as FilterIcon, Visibility as PreviewIcon,
} from '@mui/icons-material'
import { QueryBuilder, formatQuery } from 'react-querybuilder'
import 'react-querybuilder/dist/query-builder.css'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Cell } from 'recharts'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'
import { humanizeColumn } from '../../utils'
import { fetchColumnStats, fetchTemporal, fetchTags, saveTags, executeQuery } from '@/api/widgetData'

// ── 3c: Column Tag Selector ──
function ColumnTagSelector({ column, currentTag, onTag }) {
  const tags = [
    { value: 'id', label: 'ID', icon: <KeyIcon sx={{ fontSize: 12 }} />, color: 'primary' },
    { value: 'date', label: 'Date', icon: <DateIcon sx={{ fontSize: 12 }} />, color: 'info' },
    { value: 'metric', label: 'Metric', icon: <MetricIcon sx={{ fontSize: 12 }} />, color: 'success' },
  ]
  return (
    <Stack direction="row" spacing={0.25}>
      {tags.map(t => (
        <Chip key={t.value} icon={t.icon} label={t.label} size="small"
          color={currentTag === t.value ? t.color : 'default'}
          variant={currentTag === t.value ? 'filled' : 'outlined'}
          onClick={() => onTag(column, currentTag === t.value ? null : t.value)}
          sx={{ height: 20, fontSize: '0.6rem', cursor: 'pointer' }}
        />
      ))}
    </Stack>
  )
}

// ── D6: Temporal Consistency Chart with gap/spike detection ──
function TemporalChart({ data }) {
  if (!data?.length) return null
  const counts = data.map(d => d.count ?? 0)
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length
  const stddev = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / counts.length)

  const barColor = (count) => {
    if (count > mean + 2 * stddev) return '#f44336' // spike
    if (count < mean / 3 || count === 0) return '#ff9800' // gap
    return '#2196F3'
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        Record Distribution Over Time
      </Typography>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis dataKey="period" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} width={30} />
          <RTooltip contentStyle={{ fontSize: '0.75rem' }} formatter={v => [`${v} records`, 'Count']} />
          <Bar dataKey="count" fillOpacity={0.7} radius={[2, 2, 0, 0]}>
            {data.map((entry, idx) => <Cell key={idx} fill={barColor(entry.count ?? 0)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}

// ── Lazy arquero for profiling ──
let _aq = null
function useArquero() {
  const [ready, setReady] = useState(!!_aq)
  useEffect(() => {
    if (_aq) return
    import('arquero').then(m => { _aq = m; setReady(true) }).catch(() => {})
  }, [])
  return ready ? _aq : null
}

function useColumnProfile(sampleData, aq) {
  return useMemo(() => {
    if (!aq || !sampleData?.length) return {}
    try {
      const dt = aq.from(sampleData)
      const result = {}
      dt.columnNames().forEach(col => {
        const total = dt.numRows()
        let nulls = 0
        try { nulls = dt.filter(aq.escape(d => d[col] == null || d[col] === '')).numRows() } catch {}
        let distinct = 0
        try { distinct = dt.groupby(col).count().numRows() } catch {}
        let distribution = []
        try { distribution = dt.groupby(col).count().orderby(aq.desc('count')).slice(0, 8).objects().map(r => ({ name: String(r[col] ?? ''), count: r.count })) } catch {}
        result[col] = { nullPct: total > 0 ? (nulls / total) * 100 : 0, distinct, distribution }
      })
      return result
    } catch { return {} }
  }, [sampleData, aq])
}

// ── D2: Inline Sparkline with outlier detection (IQR) ──
function ColumnSparkline({ data }) {
  if (!data?.length) return null
  const sorted = [...data].map(d => d.count ?? 0).sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)] ?? 0
  const q3 = sorted[Math.floor(sorted.length * 0.75)] ?? 0
  const threshold = q3 + 1.5 * (q3 - q1)

  return (
    <ResponsiveContainer width={60} height={18}>
      <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <Bar dataKey="count" radius={[1, 1, 0, 0]}>
          {data.map((entry, i) => <Cell key={i} fill={(entry.count ?? 0) > threshold ? '#f44336' : '#90caf9'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── 3a: Expandable Table Section ──
function TableSection({ tableName, columns, defaultOpen, columnTags, onTag, usedColumns, foreignKeys, columnProfile, onPreviewColumn }) {
  const [open, setOpen] = useState(defaultOpen)
  const usedCount = columns.filter(c => usedColumns.has(`${tableName}.${c.name}`) || usedColumns.has(c.name)).length

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box onClick={() => setOpen(o => !o)}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
        <TableIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>{tableName}</Typography>
        <Chip label={`${columns.length} cols`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
        {usedCount > 0 && <Chip label={`${usedCount} used`} size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />}
        {open ? <CollapseIcon sx={{ fontSize: 18 }} /> : <ExpandIcon sx={{ fontSize: 18 }} />}
      </Box>
      <Collapse in={open}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>Column</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem' }}>Type</TableCell>
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
                const fk = foreignKeys?.find(f => f.from === col.name)
                const profile = columnProfile?.[col.name] || columnProfile?.[fullName]

                return (
                  <TableRow key={col.name} className={clsx({ 'row-used': isUsed })} sx={isUsed ? { bgcolor: '#e8f5e9' } : {}}>
                    <TableCell sx={{ fontSize: '0.75rem' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {isPk && <KeyIcon sx={{ fontSize: 12, color: 'warning.main' }} />}
                        <Typography component="span" sx={{ fontSize: '0.75rem', cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}
                          onClick={() => onPreviewColumn?.(fullName)}>
                          {col.name}
                        </Typography>
                        {/* 3d: Preview in report */}
                        <Tooltip title="Preview in Report">
                          <IconButton size="small" onClick={() => onPreviewColumn?.(fullName)} sx={{ p: 0, ml: 0.25 }}>
                            <PreviewIcon sx={{ fontSize: 12, color: 'action.active' }} />
                          </IconButton>
                        </Tooltip>
                        {fk && (
                          <Tooltip title={`FK → ${fk.to_table}.${fk.to_column}`}>
                            <Typography variant="caption" color="info.main" sx={{ fontSize: '0.6rem' }}>→ {fk.to_table}</Typography>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell><Chip label={col.type || 'text'} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} /></TableCell>
                    <TableCell sx={{ fontSize: '0.7rem' }}>
                      {profile ? (
                        <Tooltip title={`${profile.nullPct.toFixed(1)}% null`}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 50 }}>
                            <Box sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: '#e0e0e0', overflow: 'hidden' }}>
                              <Box sx={{ width: `${100 - profile.nullPct}%`, height: '100%', borderRadius: 2,
                                bgcolor: profile.nullPct > 50 ? '#f44336' : profile.nullPct > 10 ? '#ff9800' : '#4caf50' }} />
                            </Box>
                            <Typography variant="caption" sx={{ fontSize: '0.55rem' }}>{profile.nullPct.toFixed(0)}%</Typography>
                          </Box>
                        </Tooltip>
                      ) : <Typography variant="caption" color="text.disabled">--</Typography>}
                    </TableCell>
                    <TableCell><ColumnSparkline data={profile?.distribution} /></TableCell>
                    <TableCell><ColumnTagSelector column={fullName} currentTag={columnTags[fullName]} onTag={onTag} /></TableCell>
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

// ── Main Component ──
export default function DataTab({ onAction }) {
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const columnStats = usePipelineStore(s => s.columnStats)
  const columnTags = usePipelineStore(s => s.columnTags)
  const setColumnTag = usePipelineStore(s => s.setColumnTag)
  const setColumnStats = usePipelineStore(s => s.setColumnStats)
  const statusView = usePipelineStore(s => s.statusView)
  const sessionId = usePipelineStore(s => s.sessionId)
  const connectionId = usePipelineStore(s => s.connectionId)
  const queryBuilderState = usePipelineStore(s => s.queryBuilderState)
  const setQueryBuilderState = usePipelineStore(s => s.setQueryBuilderState)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)

  const [showQueryBuilder, setShowQueryBuilder] = useState(false)
  const [showTemporal, setShowTemporal] = useState(false)
  const [queryResult, setQueryResult] = useState(null)
  const [queryLoading, setQueryLoading] = useState(false)

  // Fetch column stats from backend on mount when connection + mapping exist
  useEffect(() => {
    if (!sessionId || !connectionId || !mapping?.catalog) return
    // Extract table names from catalog
    const catalog = mapping.catalog
    const tableNames = Array.isArray(catalog)
      ? [...new Set(catalog.map(c => (typeof c === 'string' ? c : c.name || '').split('.')[0]).filter(Boolean))]
      : typeof catalog === 'object' ? Object.keys(catalog) : []

    if (tableNames.length) {
      tableNames.forEach(table => {
        fetchColumnStats(sessionId, table)
          .then(r => {
            if (r?.columns) {
              const current = usePipelineStore.getState().columnStats
              setColumnStats({ ...current, ...r.columns })
            }
          })
          .catch(() => {})
      })
    } else if (connectionId) {
      // No mapping yet — fetch stats for first available table from schema
      try {
        fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/schema`)
          .then(r => r.ok ? r.json() : null)
          .then(schema => {
            const firstTable = schema?.tables?.[0]?.name
            if (firstTable) {
              fetchColumnStats(sessionId, firstTable)
                .then(r => { if (r?.columns) setColumnStats(r.columns) })
                .catch(() => {})
            }
          })
          .catch(() => {})
      } catch (_) { /* ignore */ }
    }
  }, [sessionId, connectionId, mapping?.catalog]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch detailed temporal data for date-tagged columns
  useEffect(() => {
    if (!sessionId) return
    const dateCols = Object.entries(columnTags).filter(([, t]) => t === 'date').map(([c]) => c)
    dateCols.forEach(col => {
      const parts = col.split('.')
      if (parts.length < 2) return
      fetchTemporal(sessionId, parts[0], parts.slice(1).join('.'))
        .then(r => {
          if (r?.periods) {
            const current = usePipelineStore.getState().columnStats
            setColumnStats({ ...current, [col]: { ...(current[col] || {}), temporalDistribution: r.periods, _temporal: r } })
          }
        })
        .catch(() => {})
    })
  }, [sessionId, columnTags]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load persisted tags on mount
  useEffect(() => {
    if (!sessionId) return
    fetchTags(sessionId)
      .then(r => {
        if (r?.tags) Object.entries(r.tags).forEach(([col, tag]) => setColumnTag(col, tag))
      })
      .catch(() => {})
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist tags to backend when they change
  const handleTagChange = useCallback((col, tag) => {
    setColumnTag(col, tag)
    if (sessionId) saveTags(sessionId, { [col]: tag }).catch(() => {})
  }, [sessionId, setColumnTag])

  const handlePreviewColumn = useCallback((fullName) => {
    setHighlightedField(fullName)
    setActivePanel('preview')
  }, [setHighlightedField, setActivePanel])

  // Arquero profiling
  const aq = useArquero()
  const sampleData = useMemo(() => {
    const samples = mapping?.token_samples
    if (!samples || !Object.keys(samples).length) return null
    const tokens = Object.keys(samples)
    const maxLen = Math.max(...tokens.map(t => Array.isArray(samples[t]) ? samples[t].length : 1))
    return Array.from({ length: maxLen }, (_, i) =>
      Object.fromEntries(tokens.map(t => [t, Array.isArray(samples[t]) ? samples[t][i] : samples[t]]))
    )
  }, [mapping?.token_samples])
  const columnProfile = useColumnProfile(sampleData, aq)

  // Parse catalog
  const tables = useMemo(() => {
    const catalog = mapping?.catalog
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
        name, columns: (Array.isArray(cols) ? cols : []).map(c => typeof c === 'string' ? { name: c, type: 'text' } : c),
      }))
    }
    return []
  }, [mapping?.catalog])

  const usedColumns = useMemo(() => {
    const used = new Set()
    Object.values(mapping?.mapping || {}).forEach(v => { if (v && typeof v === 'string' && v.includes('.')) used.add(v) })
    return used
  }, [mapping?.mapping])

  const queryFields = useMemo(() =>
    tables.flatMap(t => t.columns.map(c => ({
      name: `${t.name}.${c.name}`, label: `${c.name} (${t.name})`,
      inputType: columnTags[`${t.name}.${c.name}`] === 'date' ? 'date' : columnTags[`${t.name}.${c.name}`] === 'metric' ? 'number' : 'text',
    }))), [tables, columnTags])

  const query = queryBuilderState || { combinator: 'and', rules: [] }

  const temporalData = useMemo(() => {
    const dateCol = Object.entries(columnTags).find(([, tag]) => tag === 'date')
    return dateCol ? columnStats[dateCol[0]]?.temporalDistribution || null : null
  }, [columnTags, columnStats])

  if (!tables.length) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Box sx={{ textAlign: 'center' }}>
          <DbIcon sx={{ fontSize: 48, color: '#e0e0e0', mb: 1 }} />
          <Typography color="text.secondary">No database connected yet.</Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Database Explorer</Typography>
        <Chip label={`${tables.length} tables`} size="small" variant="outlined" />
      </Box>

      <Box sx={{ px: 2, py: 0.5, display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <Button size="small" variant={showQueryBuilder ? 'contained' : 'outlined'} startIcon={<FilterIcon sx={{ fontSize: 14 }} />}
          onClick={() => setShowQueryBuilder(o => !o)} sx={{ textTransform: 'none', fontSize: '0.7rem' }}>Query Builder</Button>
        <Button size="small" variant={showTemporal ? 'contained' : 'outlined'} startIcon={<DateIcon sx={{ fontSize: 14 }} />}
          onClick={() => setShowTemporal(o => !o)} sx={{ textTransform: 'none', fontSize: '0.7rem' }}>Timeline</Button>
      </Box>

      {/* 3b: Query Builder */}
      <Collapse in={showQueryBuilder}>
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: '#fafafa' }}>
          <QueryBuilder fields={queryFields} query={query} onQueryChange={setQueryBuilderState} />
          <Box sx={{ mt: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button size="small" variant="contained" disabled={queryLoading}
              onClick={async () => {
                setQueryLoading(true); setQueryResult(null)
                try { setQueryResult(await executeQuery(sessionId, formatQuery(query, 'sql'))) }
                catch (e) { setQueryResult({ error: e.message }) }
                finally { setQueryLoading(false) }
              }}
              sx={{ textTransform: 'none', fontSize: '0.7rem' }}>{queryLoading ? 'Running...' : 'Run Query'}</Button>
            <Typography variant="caption" color="text.disabled" fontFamily="monospace" sx={{ flex: 1 }} noWrap>{formatQuery(query, 'sql')}</Typography>
          </Box>
          {queryResult?.error && (
            <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>{queryResult.error}</Typography>
          )}
          {queryResult?.columns && (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 1, maxHeight: 200 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow>{queryResult.columns.map(c => <TableCell key={c} sx={{ fontWeight: 600, fontSize: '0.65rem', py: 0.5 }}>{c}</TableCell>)}</TableRow></TableHead>
                <TableBody>{queryResult.rows.slice(0, 50).map((row, i) => (
                  <TableRow key={i}>{queryResult.columns.map(c => <TableCell key={c} sx={{ fontSize: '0.65rem', py: 0.25 }}>{row[c] ?? ''}</TableCell>)}</TableRow>
                ))}</TableBody>
              </Table>
              {queryResult.row_count > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.5, display: 'block' }}>
                  {queryResult.row_count} rows in {queryResult.execution_time_ms}ms
                </Typography>
              )}
            </TableContainer>
          )}
        </Box>
      </Collapse>

      {/* D6: Temporal chart */}
      <Collapse in={showTemporal}>
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
          {temporalData ? <TemporalChart data={temporalData} /> : (
            <Typography variant="caption" color="text.secondary">Tag a column as "Date" to see temporal distribution.</Typography>
          )}
        </Box>
      </Collapse>

      {/* 3a: Table explorer */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Stack spacing={1}>
          {tables.map((t, i) => (
            <TableSection key={t.name} tableName={t.name} columns={t.columns} defaultOpen={i === 0}
              columnTags={columnTags} onTag={handleTagChange} usedColumns={usedColumns}
              foreignKeys={t.foreignKeys || []} columnProfile={columnProfile} onPreviewColumn={handlePreviewColumn} />
          ))}
        </Stack>
      </Box>
    </Box>
  )
}
