/**
 * EditPanel — template preview with visual diff + apply/reject + undo.
 * Primary: apply or reject proposed changes.
 * Features: fullscreen preview Dialog, undo Badge, collapsible sections.
 */
import React, { useState } from 'react'
import {
  Badge, Box, Button, Chip, Collapse, Dialog, DialogContent, DialogTitle,
  Divider, IconButton, Paper, Stack, Tooltip, Typography,
} from '@mui/material'
import {
  Check as ApplyIcon, Close as RejectIcon, Undo as UndoIcon,
  Fullscreen as FullscreenIcon, FullscreenExit as FullscreenExitIcon,
  ExpandMore as ExpandIcon, ExpandLess as CollapseIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken } from '../utils'

function CollapsibleSection({ title, defaultOpen = true, badge, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Box>
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 0.75,
          cursor: 'pointer', userSelect: 'none', '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {open ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
        <Typography variant="subtitle2" sx={{ flex: 1 }}>{title}</Typography>
        {badge != null && badge > 0 && (
          <Chip label={badge} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
        )}
      </Box>
      <Collapse in={open}>
        {children}
      </Collapse>
    </Box>
  )
}

export default function EditPanel({ onAction }) {
  const template = usePipelineStore(s => s.pipelineState.data.template)
  const history = usePipelineStore(s => s.pipelineState.history)
  const canUndo = usePipelineStore(s => s.canUndo())
  const undo = usePipelineStore(s => s.undo)
  const [fullscreen, setFullscreen] = useState(false)

  const html = template?.html || ''
  const tokens = template?.tokens || []
  const undoCount = history.length

  if (!html) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Typography color="text.secondary">No template to edit yet.</Typography>
      </Box>
    )
  }

  const previewContent = (
    <Box
      sx={{ transform: fullscreen ? 'scale(0.75)' : 'scale(0.45)', transformOrigin: 'top left', width: fullscreen ? '133%' : '222%', pointerEvents: 'none' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Template Preview</Typography>
        <Chip label={`${tokens.length} tokens`} size="small" variant="outlined" />
        {canUndo && (
          <Tooltip title={`Undo (${undoCount} change${undoCount !== 1 ? 's' : ''} in history)`}>
            <Badge badgeContent={undoCount} color="warning" max={99}>
              <Button size="small" startIcon={<UndoIcon />} onClick={undo} variant="text">
                Undo
              </Button>
            </Badge>
          </Tooltip>
        )}
        <Tooltip title="Fullscreen preview">
          <IconButton size="small" onClick={() => setFullscreen(true)}>
            <FullscreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Token list (collapsible) */}
      <CollapsibleSection title="Tokens" badge={tokens.length} defaultOpen={tokens.length <= 12}>
        <Box sx={{ px: 2, pb: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {tokens.map(t => (
            <Chip key={t} label={humanizeToken(t)} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.72rem' }} />
          ))}
        </Box>
      </CollapsibleSection>

      <Divider />

      {/* Preview (collapsible) */}
      <CollapsibleSection title="HTML Preview" defaultOpen>
        <Box sx={{ px: 2, pb: 2, overflow: 'auto', maxHeight: 500 }}>
          <Paper variant="outlined" sx={{ p: 1, overflow: 'auto' }}>
            {previewContent}
          </Paper>
        </Box>
      </CollapsibleSection>

      {/* Fullscreen Dialog */}
      <Dialog open={fullscreen} onClose={() => setFullscreen(false)} maxWidth="xl" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography variant="subtitle1" sx={{ flex: 1 }}>Template Preview</Typography>
          <Chip label={`${tokens.length} tokens`} size="small" variant="outlined" sx={{ mr: 1 }} />
          <IconButton onClick={() => setFullscreen(false)} size="small">
            <FullscreenExitIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ minHeight: '70vh', overflow: 'auto' }}>
          <Box
            sx={{ transform: 'scale(0.9)', transformOrigin: 'top left', width: '111%', pointerEvents: 'none' }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </DialogContent>
      </Dialog>
    </Box>
  )
}
