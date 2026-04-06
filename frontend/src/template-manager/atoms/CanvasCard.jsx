import { useTemplateCreatorStore } from '@/stores/content'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import {
  Box,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { useState } from 'react'

/**
 * Shared card shell for Intelligence Canvas cards.
 */
export function CanvasCard({
  id,
  icon: Icon,
  title,
  children,
  actions,
  defaultExpanded = true,
  loading = false,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const pinnedCards = useTemplateCreatorStore((s) => s.pinnedCards)
  const pinCard = useTemplateCreatorStore((s) => s.pinCard)
  const unpinCard = useTemplateCreatorStore((s) => s.unpinCard)

  const isPinned = pinnedCards.includes(id)

  return (
    <Box
      sx={{
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: isPinned ? (theme) => alpha(theme.palette.text.primary, 0.2) : 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: 2, py: 1.5,
          borderBottom: expanded ? '1px solid' : 'none',
          borderColor: 'divider',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          {Icon && <Icon fontSize="small" color="action" />}
          <Typography variant="subtitle2" noWrap>{title}</Typography>
          {loading && <CircularProgress size={14} />}
        </Stack>
        <Stack direction="row" spacing={0.5}>
          <Tooltip title={isPinned ? 'Unpin card' : 'Pin card'}>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); isPinned ? unpinCard(id) : pinCard(id) }}
            >
              {isPinned ? <PushPinIcon fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </Stack>
      </Stack>
      {expanded && (
        <>
          <Box sx={{ px: 2, py: 1.5, maxHeight: 300, overflowY: 'auto' }}>{children}</Box>
          {actions && (
            <Box sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
              {actions}
            </Box>
          )}
        </>
      )}
    </Box>
  )
}
