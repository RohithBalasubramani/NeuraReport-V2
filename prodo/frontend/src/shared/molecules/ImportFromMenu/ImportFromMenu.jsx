import { useCrossPageActions } from '@/hooks/hooks'
import { FEATURE_LABELS } from '@/utils/helpers'
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import InputRoundedIcon from '@mui/icons-material/InputRounded'
import MergeRoundedIcon from '@mui/icons-material/MergeRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import SummarizeRoundedIcon from '@mui/icons-material/SummarizeRounded'
import {
  Button,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'

const FEATURE_ICONS = {
  agents: SmartToyRoundedIcon,
  query: StorageRoundedIcon,
  synthesis: MergeRoundedIcon,
  summary: SummarizeRoundedIcon,
  visualization: BarChartRoundedIcon,
  federation: StorageRoundedIcon,
  documents: DescriptionRoundedIcon,
}

function timeAgo(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * ImportFromMenu -- "Import from..." dropdown button for consumer pages.
 */
export function ImportFromMenu({
  currentFeature,
  onImport,
  label = 'Import from\u2026',
  variant = 'outlined',
  size = 'small',
  disabled = false,
}) {
  const { getAvailableOutputs } = useCrossPageActions(currentFeature)
  const [anchorEl, setAnchorEl] = useState(null)

  const outputs = getAvailableOutputs()

  const handleOpen = useCallback((e) => setAnchorEl(e.currentTarget), [])
  const handleClose = useCallback(() => setAnchorEl(null), [])

  const handleSelect = useCallback(
    (output) => {
      handleClose()
      if (onImport) onImport(output)
    },
    [handleClose, onImport],
  )

  if (outputs.length === 0) return null

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        startIcon={<InputRoundedIcon />}
        onClick={handleOpen}
        sx={{ textTransform: 'none', fontWeight: 500 }}
      >
        {label}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        slotProps={{ paper: { sx: { minWidth: 260 } } }}
      >
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Available outputs
          </Typography>
        </MenuItem>
        <Divider />
        {outputs.map((output) => {
          const IconComp =
            FEATURE_ICONS[output.featureKey] || DescriptionRoundedIcon
          const sourceLabel =
            FEATURE_LABELS[output.featureKey] || output.featureKey

          return (
            <MenuItem
              key={`${output.featureKey}-${output.timestamp}`}
              onClick={() => handleSelect(output)}
            >
              <ListItemIcon>
                <IconComp fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                    {output.title || 'Untitled'}
                  </Typography>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary">
                    {sourceLabel} &middot; {timeAgo(output.timestamp)}
                  </Typography>
                }
              />
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}
