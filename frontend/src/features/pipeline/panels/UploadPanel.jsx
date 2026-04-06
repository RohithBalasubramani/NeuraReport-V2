/**
 * UploadPanel — shows extracted structure from uploaded PDF/Excel.
 * Primary: see what was extracted (tokens, layout, structure).
 */
import React from 'react'
import { Box, Chip, Paper, Stack, Typography } from '@mui/material'
import { Upload as UploadIcon } from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'

export default function UploadPanel() {
  const template = usePipelineStore(s => s.pipelineState.data.template)
  const getTokenColor = usePipelineStore(s => s.getTokenColor)
  const tokens = template?.tokens || []

  if (!template?.html) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, textAlign: 'center' }}>
        <UploadIcon sx={{ fontSize: 48, color: 'grey.300', mb: 2 }} />
        <Typography variant="h6" color="text.secondary">Drop a PDF or Excel file</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Or describe your report in the chat
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>Extracted Structure</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {tokens.length} tokens found in template
      </Typography>

      {/* Token list with colors */}
      <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mb: 2 }}>
        {tokens.map(t => (
          <Chip
            key={t}
            label={`{${t}}`}
            size="small"
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              borderLeft: 3,
              borderColor: getTokenColor(t),
            }}
          />
        ))}
      </Stack>

      {/* Template preview */}
      <Paper variant="outlined" sx={{ p: 1, overflow: 'auto', maxHeight: '60vh' }}>
        <Box
          sx={{ transform: 'scale(0.4)', transformOrigin: 'top left', width: '250%', pointerEvents: 'none' }}
          dangerouslySetInnerHTML={{ __html: template.html }}
        />
      </Paper>
    </Box>
  )
}
