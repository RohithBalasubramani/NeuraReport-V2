/**
 * MappingsTab — Full-featured mapping table with:
 * - @tanstack/react-table (sorting, row selection, bulk actions)
 * - @tippyjs/react (column stats popover)
 * - react-sparklines (inline distribution charts)
 * - MUI Autocomplete (column search)
 * - clsx (conditional styling)
 */
import React, { useState, useMemo, useCallback } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, flexRender,
} from '@tanstack/react-table'
import {
  Autocomplete, Box, Button, Checkbox, Chip, Stack,
  TextField, Tooltip, Typography,
} from '@mui/material'
import {
  Check as ApproveIcon, Warning as WarningIcon,
  ArrowUpward as SortAscIcon, ArrowDownward as SortDescIcon,
  Queue as QueueIcon, SelectAll as SelectAllIcon,
  Deselect as DeselectIcon,
} from '@mui/icons-material'
import Tippy from '@tippyjs/react'
import { Sparklines, SparklinesBars } from 'react-sparklines'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken, humanizeColumn } from '../../utils'
// confidenceSx inlined in cell renderer to avoid hooks-in-render violation

// ── Column Stats Popover ──
function ColumnStatsPopover({ column, stats }) {
  if (!stats) return <Typography variant="caption" color="text.secondary">{humanizeColumn(column)}</Typography>

  return (
    <Box sx={{ p: 1.5, maxWidth: 260, fontSize: '0.75rem' }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{humanizeColumn(column)}</Typography>
      <Stack spacing={0.5}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Type</Typography>
          <Chip label={stats.type || 'text'} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Unique</Typography>
          <Typography variant="caption">{stats.uniqueCount ?? '—'}</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Null %</Typography>
          <Typography variant="caption" color={stats.nullPct > 10 ? 'warning.main' : 'text.primary'}>
            {stats.nullPct != null ? `${stats.nullPct.toFixed(1)}%` : '—'}
          </Typography>
        </Box>
        {stats.topValues?.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary">Top values</Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.25} sx={{ mt: 0.25 }}>
              {stats.topValues.slice(0, 5).map((v, i) => (
                <Chip key={i} label={String(v)} size="small" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} />
              ))}
            </Stack>
          </Box>
        )}
        {stats.distribution?.length > 0 && (
          <Box sx={{ mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">Distribution</Typography>
            <Sparklines data={stats.distribution} width={200} height={30} margin={2}>
              <SparklinesBars style={{ fill: '#2196F3', fillOpacity: 0.6 }} />
            </Sparklines>
          </Box>
        )}
      </Stack>
    </Box>
  )
}

// ── Inline Sparkline Cell ──
function SparklineCell({ distribution }) {
  if (!distribution?.length) return <Typography variant="caption" color="text.disabled">—</Typography>
  return (
    <Sparklines data={distribution} width={60} height={20} margin={1}>
      <SparklinesBars style={{ fill: '#90CAF9', fillOpacity: 0.8 }} />
    </Sparklines>
  )
}

// ── Bulk Actions Bar ──
function BulkActionsBar({ selectedCount, onBulkAction }) {
  if (selectedCount === 0) return null
  return (
    <Box sx={{
      px: 2, py: 1, bgcolor: 'primary.50', borderBottom: 1, borderColor: 'primary.light',
      display: 'flex', alignItems: 'center', gap: 1,
    }}>
      <Typography variant="caption" fontWeight={600}>{selectedCount} selected</Typography>
      <Button size="small" variant="outlined" onClick={() => onBulkAction('unresolve')} sx={{ textTransform: 'none', fontSize: '0.7rem' }}>
        Set Unresolved
      </Button>
      <Button size="small" variant="outlined" onClick={() => onBulkAction('remap')} sx={{ textTransform: 'none', fontSize: '0.7rem' }}>
        Auto-remap
      </Button>
      <Button size="small" variant="outlined" color="success" onClick={() => onBulkAction('accept')} sx={{ textTransform: 'none', fontSize: '0.7rem' }}>
        Accept All
      </Button>
    </Box>
  )
}

export default function MappingsTab({ onAction }) {
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const errors = usePipelineStore(s => s.pipelineState.errors)
  const template = usePipelineStore(s => s.pipelineState.data.template)
  const getTokenColor = usePipelineStore(s => s.getTokenColor)
  const setMappingData = usePipelineStore(s => s.setMappingData)
  const isProcessing = usePipelineStore(s => s.isProcessing)
  const columnStats = usePipelineStore(s => s.columnStats)
  const highlightedField = usePipelineStore(s => s.highlightedField)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)

  const [edits, setEdits] = useState({})
  const [sorting, setSorting] = useState([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [rowSelection, setRowSelection] = useState({})

  const mappingDict = mapping?.mapping || {}
  const candidates = mapping?.candidates || {}
  const confidence = mapping?.confidence || {}
  const confidenceReason = mapping?.confidence_reason || {}
  const errorTokens = useMemo(() => new Set(errors.filter(e => e.severity === 'error').map(e => e.token_name)), [errors])

  const finalMapping = useMemo(() => ({ ...mappingDict, ...edits }), [mappingDict, edits])

  // All DB columns for autocomplete
  const allColumns = useMemo(() => {
    const catalog = mapping?.catalog
    if (!catalog) return []
    if (Array.isArray(catalog)) return catalog.map(c => typeof c === 'string' ? c : c.name || '')
    return Object.entries(catalog).flatMap(([table, cols]) =>
      (Array.isArray(cols) ? cols : []).map(c => `${table}.${typeof c === 'string' ? c : c.name}`)
    )
  }, [mapping?.catalog])

  // Table data
  const data = useMemo(() =>
    Object.entries(finalMapping).map(([token, column]) => ({
      token,
      column,
      sample: mapping?.token_samples?.[token] || '',
      conf: confidence[token] ?? null,
      confReason: confidenceReason[token] || '',
      isError: column === 'UNRESOLVED' || errorTokens.has(token),
      isEdited: token in edits,
      signature: mapping?.token_signatures?.[token] || token,
      distribution: columnStats[column]?.distribution || null,
      stats: columnStats[column] || null,
      candidates: candidates[token] || [],
    })),
  [finalMapping, mapping, confidence, confidenceReason, errorTokens, edits, columnStats, candidates])

  const handleEdit = useCallback((token, value) => {
    setEdits(prev => ({ ...prev, [token]: value }))
  }, [])

  const handleApprove = useCallback((force = false) => {
    setMappingData({
      mapping: finalMapping,
      status: force ? 'approved_with_warnings' : 'approved',
    })
    onAction?.({ type: 'approve_mapping', mapping: finalMapping, force })
  }, [finalMapping, setMappingData, onAction])

  const handleQueueContinue = useCallback(() => {
    setMappingData({ mapping: finalMapping, status: 'approved' })
    onAction?.({ type: 'approve_and_continue', mapping: finalMapping })
  }, [finalMapping, setMappingData, onAction])

  const handleBulkAction = useCallback((action) => {
    const selectedTokens = Object.keys(rowSelection).map(idx => data[parseInt(idx)]?.token).filter(Boolean)
    if (action === 'unresolve') {
      const newEdits = { ...edits }
      selectedTokens.forEach(t => { newEdits[t] = 'UNRESOLVED' })
      setEdits(newEdits)
    } else if (action === 'accept') {
      // no-op: keep current values
    } else if (action === 'remap') {
      onAction?.({ type: 'remap_selected', tokens: selectedTokens })
    }
    setRowSelection({})
  }, [rowSelection, data, edits, onAction])

  // TanStack Table columns
  const columns = useMemo(() => [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          size="small"
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          sx={{ p: 0 }}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          size="small"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          sx={{ p: 0 }}
        />
      ),
      size: 36,
      enableSorting: false,
    },
    {
      accessorKey: 'token',
      header: 'Field',
      cell: ({ row }) => {
        const { token, signature } = row.original
        const isHighlighted = highlightedField === token
        return (
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer' }}
            onClick={() => setHighlightedField(isHighlighted ? null : token)}
          >
            <Box sx={{ width: 4, height: 16, borderRadius: 1, bgcolor: getTokenColor(signature) }} />
            <Tooltip title={`{{${token}}}`} placement="right">
              <Typography
                variant="body2"
                fontSize="0.8rem"
                fontWeight={isHighlighted ? 700 : 400}
                sx={isHighlighted ? { textDecoration: 'underline' } : {}}
              >
                {humanizeToken(token)}
              </Typography>
            </Tooltip>
          </Box>
        )
      },
      size: 160,
    },
    {
      accessorKey: 'column',
      header: 'Source Column',
      cell: ({ row }) => {
        const { token, column, candidates: tokenCandidates, stats } = row.original
        const isApproved = mapping?.status

        if (isApproved) {
          return (
            <Tippy
              content={<ColumnStatsPopover column={column} stats={stats} />}
              delay={[300, 0]}
              interactive
              placement="bottom"
              appendTo={() => document.body}
            >
              <Typography variant="body2" fontSize="0.8rem" noWrap sx={{ cursor: 'help' }}>
                {humanizeColumn(column)}
              </Typography>
            </Tippy>
          )
        }

        return (
          <Autocomplete
            size="small"
            freeSolo
            value={column === 'UNRESOLVED' ? '' : column}
            options={[...new Set([...tokenCandidates, ...allColumns])]}
            getOptionLabel={o => humanizeColumn(o)}
            onChange={(_, val) => handleEdit(token, val || 'UNRESOLVED')}
            onInputChange={(_, val) => { if (val) handleEdit(token, val) }}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="standard"
                placeholder={tokenCandidates[0] ? humanizeColumn(tokenCandidates[0]) : 'Select...'}
                sx={{ fontSize: '0.8rem' }}
              />
            )}
            sx={{ minWidth: 140 }}
          />
        )
      },
      size: 200,
    },
    {
      accessorKey: 'sample',
      header: 'Sample',
      cell: ({ getValue }) => (
        <Typography variant="caption" color="text.secondary" noWrap>{getValue() || '—'}</Typography>
      ),
      size: 100,
    },
    {
      id: 'sparkline',
      header: 'Dist.',
      cell: ({ row }) => <SparklineCell distribution={row.original.distribution} />,
      size: 70,
      enableSorting: false,
    },
    {
      accessorKey: 'conf',
      header: 'Conf.',
      cell: ({ row }) => {
        const { conf, confReason } = row.original
        if (conf == null) return null
        return (
          <Tooltip title={confReason}>
            <Chip
              label={`${Math.round(conf * 100)}%`}
              size="small"
              color={conf >= 0.8 ? 'success' : conf >= 0.5 ? 'warning' : 'error'}
              variant="outlined"
              sx={{
                height: 20, fontSize: '0.7rem',
                ...(conf < 0.8 && { opacity: conf >= 0.5 ? 0.65 : 0.35, filter: conf >= 0.5 ? 'saturate(0.6)' : 'saturate(0.3)' }),
              }}
            />
          </Tooltip>
        )
      },
      sortingFn: (a, b) => (a.original.conf ?? 0) - (b.original.conf ?? 0),
      size: 70,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const { isError, isEdited } = row.original
        if (isError) return <Chip label="Error" size="small" color="error" sx={{ height: 20, fontSize: '0.7rem' }} />
        if (isEdited) return <Chip label="Edited" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
        return <Chip label="OK" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
      },
      sortingFn: (a, b) => {
        const score = (r) => r.original.isError ? 0 : r.original.isEdited ? 1 : 2
        return score(a) - score(b)
      },
      size: 70,
    },
  ], [mapping?.status, highlightedField, getTokenColor, setHighlightedField, allColumns, handleEdit])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableRowSelection: true,
  })

  // Summary stats
  const totalTokens = template?.tokens?.length || 0
  const unresolvedCount = Object.values(finalMapping).filter(v => v === 'UNRESOLVED').length
  const resolvedCount = Object.keys(finalMapping).length - unresolvedCount
  const editedCount = Object.keys(edits).length
  const lowConfCount = Object.values(confidence).filter(c => c < 0.5).length
  const hasErrors = unresolvedCount > 0 || errors.some(e => e.severity === 'error')
  const selectedCount = Object.keys(rowSelection).length

  if (!Object.keys(mappingDict).length) {
    if (isProcessing) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
          <Typography color="text.secondary" fontStyle="italic">Mapping in progress...</Typography>
        </Box>
      )
    }
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Typography color="text.secondary">No mapping yet. Say "map" in the chat to auto-map fields.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>Field Mapping</Typography>
          {mapping?.status === 'approved_with_warnings' && (
            <Chip icon={<WarningIcon />} label="Approved with warnings" size="small" color="warning" />
          )}
        </Box>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" gap={0.5}>
          <Chip label={`${resolvedCount}/${totalTokens} mapped`} size="small" color={resolvedCount === totalTokens ? 'success' : 'default'} variant="outlined" />
          {unresolvedCount > 0 && <Chip label={`${unresolvedCount} unresolved`} size="small" color="error" />}
          {editedCount > 0 && <Chip label={`${editedCount} edited`} size="small" color="warning" variant="outlined" />}
          {lowConfCount > 0 && <Chip label={`${lowConfCount} low confidence`} size="small" color="warning" variant="outlined" />}
        </Stack>
      </Box>

      {/* Search */}
      <Box sx={{ px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <TextField
          size="small"
          variant="outlined"
          placeholder="Search fields..."
          value={globalFilter ?? ''}
          onChange={e => setGlobalFilter(e.target.value)}
          fullWidth
          sx={{ '& .MuiInputBase-root': { height: 32, fontSize: '0.8rem' } }}
        />
      </Box>

      {/* Bulk Actions */}
      <BulkActionsBar selectedCount={selectedCount} onBulkAction={handleBulkAction} />

      {/* Table */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => (
                  <th
                    key={header.id}
                    onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                    style={{
                      width: header.getSize(),
                      padding: '6px 8px',
                      textAlign: 'left',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      borderBottom: '2px solid #e0e0e0',
                      cursor: header.column.getCanSort() ? 'pointer' : 'default',
                      userSelect: 'none',
                      position: 'sticky',
                      top: 0,
                      background: '#fafafa',
                      zIndex: 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' && <SortAscIcon sx={{ fontSize: 14 }} />}
                      {header.column.getIsSorted() === 'desc' && <SortDescIcon sx={{ fontSize: 14 }} />}
                    </Box>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(row => {
              const { isError, token } = row.original
              const isHighlighted = highlightedField === token
              return (
                <tr
                  key={row.id}
                  className={clsx({ 'row-error': isError, 'row-highlighted': isHighlighted })}
                  style={{
                    backgroundColor: isError ? '#fef2f2' : isHighlighted ? '#e3f2fd' : undefined,
                    transition: 'background-color 0.15s',
                  }}
                >
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      style={{
                        padding: '4px 8px',
                        borderBottom: '1px solid #f0f0f0',
                        verticalAlign: 'middle',
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Box>

      {/* Actions */}
      {!mapping?.status && (
        <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              variant="contained"
              size="small"
              startIcon={<ApproveIcon />}
              onClick={() => handleApprove(false)}
              disabled={hasErrors || isProcessing}
            >
              Approve Mapping
            </Button>
            {!hasErrors && (
              <Button
                variant="contained"
                size="small"
                color="secondary"
                startIcon={<QueueIcon />}
                onClick={handleQueueContinue}
                disabled={isProcessing}
              >
                Approve & Continue
              </Button>
            )}
            {hasErrors && (
              <Tooltip title="Override errors — validation will run in strict mode">
                <Button
                  variant="outlined"
                  size="small"
                  color="warning"
                  startIcon={<WarningIcon />}
                  onClick={() => handleApprove(true)}
                  disabled={isProcessing}
                >
                  Force Approve
                </Button>
              </Tooltip>
            )}
          </Stack>
        </Box>
      )}
    </Box>
  )
}
