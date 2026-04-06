import AccessTimeIcon from '@mui/icons-material/AccessTime'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RestoreIcon from '@mui/icons-material/Restore'
import { Alert, AlertTitle, Button, Collapse, Stack, Typography } from '@mui/material'

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

export function DraftRecoveryBanner({ show, draftData, onRestore, onDiscard, restoring = false }) {
  if (!show || !draftData) return null
  return (
    <Collapse in={show}>
      <Alert
        severity="info"
        icon={<RestoreIcon />}
        sx={{ mb: 2, borderRadius: 1, '& .MuiAlert-message': { width: '100%' } }}
        action={
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" startIcon={<RestoreIcon />} onClick={onRestore} disabled={restoring}>
              {restoring ? 'Restoring...' : 'Restore'}
            </Button>
            <Button size="small" variant="outlined" color="inherit" startIcon={<DeleteOutlineIcon />} onClick={onDiscard} disabled={restoring}>
              Discard
            </Button>
          </Stack>
        }
      >
        <AlertTitle sx={{ fontWeight: 600 }}>Unsaved Draft Found</AlertTitle>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="body2">You have unsaved changes from a previous session.</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary">{formatTimeAgo(draftData.savedAt)}</Typography>
          </Stack>
        </Stack>
      </Alert>
    </Collapse>
  )
}
