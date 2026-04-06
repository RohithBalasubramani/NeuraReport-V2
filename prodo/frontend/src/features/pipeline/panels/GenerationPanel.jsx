/**
 * GenerationPanel — sequential sub-views: Preview -> Batch -> Progress -> Results.
 * Primary: generate reports. Each sub-view gates the next.
 * Features: date range inputs, search filter, total row count in BatchSelectionView.
 */
import React, { useState, useMemo } from 'react'
import {
  Box, Button, Checkbox, Chip, FormControlLabel, LinearProgress,
  List, ListItem, ListItemText, Paper, Stack, TextField, Typography,
  InputAdornment,
} from '@mui/material'
import {
  PlayArrow as GenerateIcon,
  Visibility as PreviewIcon,
  Download as DownloadIcon,
  CheckCircle as DoneIcon,
  Search as SearchIcon,
  DateRange as DateRangeIcon,
} from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'

// Sub-view 0: Preview
function PreviewView({ onAction }) {
  const generation = usePipelineStore(s => s.pipelineState.data.generation)
  const previewApproved = generation?.previewApproved

  if (previewApproved) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <DoneIcon sx={{ fontSize: 40, color: 'success.main', mb: 1 }} />
        <Typography variant="body2" color="success.main">Preview approved. Select batches below.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>Sample Preview</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Generate 1-3 sample reports to verify output before committing to full batch.
      </Typography>
      <Button
        variant="contained"
        size="small"
        startIcon={<PreviewIcon />}
        onClick={() => onAction?.({ type: 'generate_preview' })}
        sx={{ mt: 1 }}
      >
        Generate Preview
      </Button>
    </Box>
  )
}

// Sub-view 1: Batch Selection with date range, search, row count
function BatchSelectionView({ onAction }) {
  const generation = usePipelineStore(s => s.pipelineState.data.generation)
  const batches = generation?.batches || []
  const [selected, setSelected] = useState(() => batches.map(b => b.id))
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const toggle = (id) => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  // Filter batches by search and date range
  const filteredBatches = useMemo(() => {
    let result = batches
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(b =>
        (b.name || b.id || '').toLowerCase().includes(q) ||
        (b.description || '').toLowerCase().includes(q)
      )
    }
    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter(b => {
        if (!b.date && !b.created_at) return true
        return new Date(b.date || b.created_at) >= from
      })
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      result = result.filter(b => {
        if (!b.date && !b.created_at) return true
        return new Date(b.date || b.created_at) <= to
      })
    }
    return result
  }, [batches, search, dateFrom, dateTo])

  // Total rows across selected & visible batches
  const totalRows = useMemo(() => {
    return filteredBatches
      .filter(b => selected.includes(b.id))
      .reduce((sum, b) => sum + (b.rows || 0), 0)
  }, [filteredBatches, selected])

  const selectedVisible = filteredBatches.filter(b => selected.includes(b.id)).length

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        Select Batches ({batches.length} available)
      </Typography>

      {/* Search filter */}
      <TextField
        size="small"
        placeholder="Search batches..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        fullWidth
        sx={{ mb: 1.5 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" color="action" />
            </InputAdornment>
          ),
        }}
      />

      {/* Date range filters */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <TextField
          size="small"
          type="date"
          label="From"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          type="date"
          label="To"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ flex: 1 }}
        />
      </Stack>

      {/* Select/Deselect and row count summary */}
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
        <Button size="small" variant="text" onClick={() => setSelected(filteredBatches.map(b => b.id))}>All</Button>
        <Button size="small" variant="text" onClick={() => setSelected([])}>None</Button>
        <Box sx={{ flex: 1 }} />
        <Chip
          label={`${selectedVisible} selected`}
          size="small"
          variant="outlined"
          color="primary"
        />
        {totalRows > 0 && (
          <Chip
            label={`${totalRows.toLocaleString()} total rows`}
            size="small"
            variant="outlined"
          />
        )}
      </Stack>

      {/* Batch list */}
      <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
        {filteredBatches.slice(0, 100).map(batch => (
          <ListItem key={batch.id} disablePadding>
            <FormControlLabel
              control={<Checkbox checked={selected.includes(batch.id)} onChange={() => toggle(batch.id)} size="small" />}
              label={
                <ListItemText
                  primary={batch.name || batch.id}
                  secondary={
                    [
                      batch.rows != null ? `${batch.rows} rows` : null,
                      batch.date || batch.created_at ? new Date(batch.date || batch.created_at).toLocaleDateString() : null,
                    ].filter(Boolean).join(' \u00B7 ') || undefined
                  }
                />
              }
            />
          </ListItem>
        ))}
        {filteredBatches.length > 100 && (
          <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>
            ... and {filteredBatches.length - 100} more
          </Typography>
        )}
        {filteredBatches.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ pl: 2, py: 2, textAlign: 'center' }}>
            No batches match your filters.
          </Typography>
        )}
      </List>
      <Button
        variant="contained"
        size="small"
        startIcon={<GenerateIcon />}
        onClick={() => onAction?.({ type: 'generate', batchIds: selected })}
        disabled={selected.length === 0}
        sx={{ mt: 1 }}
      >
        Generate {selected.length} Report{selected.length !== 1 ? 's' : ''}
        {totalRows > 0 ? ` (${totalRows.toLocaleString()} rows)` : ''}
      </Button>
    </Box>
  )
}

// Sub-view 2: Job Progress
function ProgressView() {
  const generation = usePipelineStore(s => s.pipelineState.data.generation)
  const jobs = generation?.jobs || []

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>Generation Progress</Typography>
      {jobs.map(job => (
        <Box key={job.job_id || job.id} sx={{ mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" fontFamily="monospace" fontSize="0.8rem">{job.job_id || job.id}</Typography>
            <Chip label={job.status || 'queued'} size="small" color={job.status === 'completed' ? 'success' : 'default'} />
          </Box>
          {job.status === 'running' && <LinearProgress sx={{ mt: 0.5 }} />}
        </Box>
      ))}
    </Box>
  )
}

// Sub-view 3: Results
function ResultsView() {
  const generation = usePipelineStore(s => s.pipelineState.data.generation)
  const jobs = (generation?.jobs || []).filter(j => j.status === 'completed')

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>Results</Typography>
      {jobs.map(job => (
        <Paper key={job.job_id || job.id} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
          <Typography variant="body2" fontFamily="monospace">{job.job_id || job.id}</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            {job.pdf_url && (
              <Button size="small" variant="contained" startIcon={<DownloadIcon />} href={job.pdf_url} target="_blank">
                PDF
              </Button>
            )}
            {job.xlsx_url && (
              <Button size="small" variant="outlined" startIcon={<DownloadIcon />} href={job.xlsx_url} target="_blank">
                Excel
              </Button>
            )}
          </Stack>
        </Paper>
      ))}
      {jobs.length === 0 && <Typography variant="body2" color="text.secondary">No completed reports yet.</Typography>}
    </Box>
  )
}

// Main panel with sub-view routing
export default function GenerationPanel({ onAction }) {
  const generation = usePipelineStore(s => s.pipelineState.data.generation)
  const previewApproved = generation?.previewApproved
  const hasBatches = (generation?.batches || []).length > 0
  const hasJobs = (generation?.jobs || []).length > 0
  const hasCompleted = (generation?.jobs || []).some(j => j.status === 'completed')

  // Determine active sub-view (sequential gating)
  let activeView = 'preview'
  if (previewApproved && hasBatches) activeView = 'batches'
  if (hasJobs && !hasCompleted) activeView = 'progress'
  if (hasCompleted) activeView = 'results'

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Sub-view tabs */}
      <Box sx={{ display: 'flex', gap: 0.5, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        {['preview', 'batches', 'progress', 'results'].map(v => (
          <Chip
            key={v}
            label={v.charAt(0).toUpperCase() + v.slice(1)}
            size="small"
            variant={v === activeView ? 'filled' : 'outlined'}
            color={v === activeView ? 'primary' : 'default'}
            sx={{ opacity: v === activeView ? 1 : 0.5 }}
          />
        ))}
      </Box>

      {/* Active sub-view */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {activeView === 'preview' && <PreviewView onAction={onAction} />}
        {activeView === 'batches' && <BatchSelectionView onAction={onAction} />}
        {activeView === 'progress' && <ProgressView />}
        {activeView === 'results' && <ResultsView />}
      </Box>
    </Box>
  )
}
