import { Box, Stack, Typography, alpha } from '@mui/material'

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Unknown time'
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  return date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function AutoSaveIndicator({ lastSaved, dirty }) {
  if (!lastSaved && !dirty) return null
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      sx={{
        py: 0.5, px: 1, borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.text.primary, 0.05),
      }}
    >
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.secondary' }} />
      <Typography variant="caption" color="text.secondary">
        {dirty ? 'Unsaved changes' : lastSaved ? `Draft saved ${formatTimeAgo(lastSaved)}` : 'All changes saved'}
      </Typography>
    </Stack>
  )
}
