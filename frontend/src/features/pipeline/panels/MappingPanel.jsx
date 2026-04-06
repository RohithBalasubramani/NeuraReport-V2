/**
 * MappingPanel — full editable mapping grid + data flow + approve.
 * Primary: resolve all mappings.
 * Features: humanized names, summary chips, expand/collapse sections,
 * Queue & Continue button, cycling progress indicator.
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Box, Button, Chip, Collapse, LinearProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
  Stack, Badge, IconButton, CircularProgress,
} from '@mui/material'
import {
  Check as ApproveIcon, Warning as WarningIcon, ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon, Queue as QueueIcon,
} from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken, humanizeColumn, PROGRESS_STEPS } from '../utils'

// Cycling progress label
function CyclingProgress() {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % PROGRESS_STEPS.length), 3000)
    return () => clearInterval(t)
  }, [])
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5 }}>
      <CircularProgress size={16} thickness={5} />
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
        {PROGRESS_STEPS[idx]}
      </Typography>
    </Box>
  )
}

// Summary chips at the top
function SummaryChips({ total, resolved, unresolved, edited, lowConf, warnings }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
      <Chip label={`${resolved}/${total} mapped`} size="small" color={resolved === total ? 'success' : 'default'} variant="outlined" />
      {unresolved > 0 && <Chip label={`${unresolved} unresolved`} size="small" color="error" />}
      {edited > 0 && <Chip label={`${edited} edited`} size="small" color="warning" variant="outlined" />}
      {lowConf > 0 && <Chip label={`${lowConf} low confidence`} size="small" color="warning" variant="outlined" />}
      {warnings > 0 && <Chip icon={<WarningIcon sx={{ fontSize: 14 }} />} label={`${warnings} warnings`} size="small" color="warning" variant="outlined" />}
    </Stack>
  )
}

// Collapsible group wrapper
function CollapsibleGroup({ title, defaultOpen = true, count, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Box>
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.5,
          cursor: 'pointer', userSelect: 'none', bgcolor: 'grey.50',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {open ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{title}</Typography>
        {count != null && (
          <Chip label={count} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
        )}
      </Box>
      <Collapse in={open}>{children}</Collapse>
    </Box>
  )
}

export default function MappingPanel({ onAction }) {
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const errors = usePipelineStore(s => s.pipelineState.errors)
  const template = usePipelineStore(s => s.pipelineState.data.template)
  const getTokenColor = usePipelineStore(s => s.getTokenColor)
  const setMappingData = usePipelineStore(s => s.setMappingData)
  const isProcessing = usePipelineStore(s => s.isProcessing)
  const [edits, setEdits] = useState({})
  const [queuedAction, setQueuedAction] = useState(null)

  const mappingDict = mapping?.mapping || {}
  const candidates = mapping?.candidates || {}
  const confidence = mapping?.confidence || {}
  const confidenceReason = mapping?.confidence_reason || {}
  const totalTokens = template?.tokens?.length || 0
  const mappedCount = Object.keys(mappingDict).length
  const errorTokens = new Set(errors.filter(e => e.severity === 'error').map(e => e.token_name))
  const warningCount = errors.filter(e => e.severity === 'warning').length

  const finalMapping = useMemo(() => ({ ...mappingDict, ...edits }), [mappingDict, edits])
  const unresolvedCount = Object.values(finalMapping).filter(v => v === 'UNRESOLVED').length
  const resolvedCount = Object.keys(finalMapping).length - unresolvedCount
  const editedCount = Object.keys(edits).length
  const lowConfCount = Object.values(confidence).filter(c => c < 0.5).length
  const hasErrors = unresolvedCount > 0 || errors.some(e => e.severity === 'error')

  // Group tokens: errors first, then low confidence, then OK
  const groupedTokens = useMemo(() => {
    const entries = Object.entries(finalMapping)
    const errorGroup = entries.filter(([t, v]) => v === 'UNRESOLVED' || errorTokens.has(t))
    const lowConfGroup = entries.filter(([t, v]) => !errorTokens.has(t) && v !== 'UNRESOLVED' && confidence[t] != null && confidence[t] < 0.8)
    const okGroup = entries.filter(([t, v]) => !errorTokens.has(t) && v !== 'UNRESOLVED' && (confidence[t] == null || confidence[t] >= 0.8))
    return { errorGroup, lowConfGroup, okGroup }
  }, [finalMapping, errorTokens, confidence])

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

  // Queue & Continue: approve and immediately trigger next step
  const handleQueueContinue = useCallback(() => {
    setQueuedAction('approve_and_continue')
    setMappingData({
      mapping: finalMapping,
      status: 'approved',
    })
    onAction?.({ type: 'approve_and_continue', mapping: finalMapping })
  }, [finalMapping, setMappingData, onAction])

  if (!Object.keys(mappingDict).length) {
    if (isProcessing) return <CyclingProgress />
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Typography color="text.secondary">No mapping yet. Say "map" in the chat to auto-map tokens.</Typography>
      </Box>
    )
  }

  const renderRow = ([token, column]) => {
    const isError = column === 'UNRESOLVED' || errorTokens.has(token)
    const isEdited = token in edits
    const conf = confidence[token]
    const reason = confidenceReason[token]
    const tokenCandidates = candidates[token] || []
    const sig = mapping?.token_signatures?.[token]

    return (
      <TableRow key={token} sx={isError ? { bgcolor: 'error.50' } : {}}>
        <TableCell>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 4, height: 16, borderRadius: 1, bgcolor: getTokenColor(sig || token) }} />
            <Tooltip title={`{${token}}`} placement="right">
              <Typography variant="body2" fontSize="0.8rem">
                {humanizeToken(token)}
              </Typography>
            </Tooltip>
          </Box>
        </TableCell>
        <TableCell>
          {mapping?.status ? (
            <Tooltip title={column} placement="top">
              <Typography variant="body2" fontSize="0.8rem" noWrap>{humanizeColumn(column)}</Typography>
            </Tooltip>
          ) : (
            <TextField
              size="small"
              variant="standard"
              value={column || ''}
              onChange={e => handleEdit(token, e.target.value)}
              fullWidth
              sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              placeholder={tokenCandidates[0] || 'Select column...'}
            />
          )}
        </TableCell>
        <TableCell>
          <Typography variant="caption" color="text.secondary" noWrap>
            {mapping?.token_samples?.[token] || '\u2014'}
          </Typography>
        </TableCell>
        <TableCell>
          {conf != null && (
            <Tooltip title={reason || ''}>
              <Chip
                label={`${Math.round(conf * 100)}%`}
                size="small"
                color={conf >= 0.8 ? 'success' : conf >= 0.5 ? 'warning' : 'error'}
                variant="outlined"
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
            </Tooltip>
          )}
        </TableCell>
        <TableCell>
          {isError ? (
            <Chip label="Error" size="small" color="error" sx={{ height: 20, fontSize: '0.7rem' }} />
          ) : isEdited ? (
            <Chip label="Edited" size="small" color="warning" sx={{ height: 20, fontSize: '0.7rem' }} />
          ) : (
            <Chip label="OK" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
          )}
        </TableCell>
      </TableRow>
    )
  }

  const tableHead = (
    <TableHead>
      <TableRow>
        <TableCell sx={{ fontWeight: 600, width: '28%' }}>Token</TableCell>
        <TableCell sx={{ fontWeight: 600, width: '32%' }}>Column</TableCell>
        <TableCell sx={{ fontWeight: 600, width: '15%' }}>Sample</TableCell>
        <TableCell sx={{ fontWeight: 600, width: '10%' }}>Conf.</TableCell>
        <TableCell sx={{ fontWeight: 600, width: '10%' }}>Status</TableCell>
      </TableRow>
    </TableHead>
  )

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header with summary chips */}
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Token Mapping
          </Typography>
          {mapping?.status === 'approved_with_warnings' && (
            <Chip icon={<WarningIcon />} label="Approved with warnings" size="small" color="warning" />
          )}
        </Box>
        <SummaryChips
          total={totalTokens}
          resolved={resolvedCount}
          unresolved={unresolvedCount}
          edited={editedCount}
          lowConf={lowConfCount}
          warnings={warningCount}
        />
      </Box>

      {/* Mapping table with collapsible groups */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {groupedTokens.errorGroup.length > 0 && (
          <CollapsibleGroup title="Needs Attention" count={groupedTokens.errorGroup.length} defaultOpen>
            <TableContainer>
              <Table size="small">
                {tableHead}
                <TableBody>{groupedTokens.errorGroup.map(renderRow)}</TableBody>
              </Table>
            </TableContainer>
          </CollapsibleGroup>
        )}

        {groupedTokens.lowConfGroup.length > 0 && (
          <CollapsibleGroup title="Low Confidence" count={groupedTokens.lowConfGroup.length} defaultOpen>
            <TableContainer>
              <Table size="small">
                {!groupedTokens.errorGroup.length && tableHead}
                <TableBody>{groupedTokens.lowConfGroup.map(renderRow)}</TableBody>
              </Table>
            </TableContainer>
          </CollapsibleGroup>
        )}

        {groupedTokens.okGroup.length > 0 && (
          <CollapsibleGroup
            title="Resolved"
            count={groupedTokens.okGroup.length}
            defaultOpen={groupedTokens.errorGroup.length === 0 && groupedTokens.lowConfGroup.length === 0}
          >
            <TableContainer>
              <Table size="small">
                {!groupedTokens.errorGroup.length && !groupedTokens.lowConfGroup.length && tableHead}
                <TableBody>{groupedTokens.okGroup.map(renderRow)}</TableBody>
              </Table>
            </TableContainer>
          </CollapsibleGroup>
        )}
      </Box>

      {/* Processing indicator */}
      {isProcessing && <CyclingProgress />}

      {/* Actions */}
      {!mapping?.status && (
        <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
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
              <Tooltip title="Override errors -- validation will run in strict mode">
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
