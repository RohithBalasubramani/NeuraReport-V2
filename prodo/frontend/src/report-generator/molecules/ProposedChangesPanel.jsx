import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloseIcon from '@mui/icons-material/Close'
import { Box, Button, CircularProgress, Collapse, Stack, Typography, alpha } from '@mui/material'
import { useState } from 'react'

export function ProposedChangesPanel({ changes, proposedHtml, onApply, onReject, applying }) {
  const [showPreview, setShowPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)

  const handleTogglePreview = () => {
    if (!showPreview && proposedHtml && !previewUrl) {
      const blob = new Blob([proposedHtml], { type: 'text/html' })
      setPreviewUrl(URL.createObjectURL(blob))
    }
    setShowPreview(!showPreview)
  }

  const changeList = Array.isArray(changes) ? changes : []

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Box
        sx={{
          borderRadius: 1.5, border: '1px solid', borderColor: 'divider',
          bgcolor: 'background.paper', overflow: 'hidden',
        }}
      >
        <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle2" fontWeight={600}>Proposed Changes</Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="text" onClick={handleTogglePreview}>
                {showPreview ? 'Hide Preview' : 'Preview'}
              </Button>
            </Stack>
          </Stack>
        </Box>
        {changeList.length > 0 && (
          <Box sx={{ p: 2 }}>
            <Stack spacing={0.75}>
              {changeList.map((change, idx) => (
                <Stack key={idx} direction="row" spacing={1} alignItems="flex-start">
                  <CheckCircleIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.25 }} />
                  <Typography variant="body2" color="text.secondary">{change}</Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        )}
        <Collapse in={showPreview}>
          {previewUrl && (
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Box
                component="iframe"
                src={previewUrl}
                sx={{
                  width: '100%', height: 300, border: '1px solid', borderColor: 'divider',
                  borderRadius: 1, bgcolor: 'white',
                }}
              />
            </Box>
          )}
        </Collapse>
        <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained" size="small"
              onClick={onApply}
              disabled={applying}
              startIcon={applying ? <CircularProgress size={14} /> : <CheckCircleIcon />}
            >
              {applying ? 'Applying...' : 'Apply Changes'}
            </Button>
            <Button
              variant="outlined" size="small" color="inherit"
              onClick={onReject}
              disabled={applying}
              startIcon={<CloseIcon />}
            >
              Reject
            </Button>
          </Stack>
        </Box>
      </Box>
    </Box>
  )
}
