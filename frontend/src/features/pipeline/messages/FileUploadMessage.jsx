import React from 'react'
import { Box, Chip, Typography } from '@mui/material'
import { InsertDriveFile as FileIcon } from '@mui/icons-material'

export default function FileUploadMessage({ message }) {
  const { fileName, fileSize } = message.data || {}
  const sizeStr = fileSize
    ? fileSize > 1048576
      ? `${(fileSize / 1048576).toFixed(1)} MB`
      : `${(fileSize / 1024).toFixed(0)} KB`
    : ''

  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
      <Chip
        icon={<FileIcon />}
        label={
          <Box>
            <Typography variant="body2" fontWeight={600}>{fileName || 'Uploaded file'}</Typography>
            {sizeStr && <Typography variant="caption" color="text.secondary">{sizeStr}</Typography>}
          </Box>
        }
        variant="outlined"
        color="primary"
        sx={{ height: 'auto', py: 1, px: 0.5, '& .MuiChip-label': { display: 'block' } }}
      />
    </Box>
  )
}
