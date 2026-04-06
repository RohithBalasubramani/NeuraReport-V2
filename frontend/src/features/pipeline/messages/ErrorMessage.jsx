import React from 'react'
import { Alert, Box } from '@mui/material'

export default function ErrorMessage({ message }) {
  const { code, detail } = message.data || {}

  return (
    <Box sx={{ mb: 2 }}>
      <Alert severity="error" variant="outlined">
        {message.content || detail || 'An error occurred.'}
        {code && <> (Code: {code})</>}
      </Alert>
    </Box>
  )
}
