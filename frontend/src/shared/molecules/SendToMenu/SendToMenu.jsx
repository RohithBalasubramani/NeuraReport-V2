import { useCrossPageActions } from '@/hooks/hooks'
import { FEATURE_ACTIONS, TransferAction } from '@/utils/helpers'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded'
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded'
import ChatRoundedIcon from '@mui/icons-material/ChatRounded'
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import SummarizeRoundedIcon from '@mui/icons-material/SummarizeRounded'
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded'
import {
  Button,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'

const ACTION_ICONS = {
  [TransferAction.CHAT_WITH]: ChatRoundedIcon,
  [TransferAction.SAVE_TO]: SaveRoundedIcon,
  [TransferAction.ADD_TO]: AddRoundedIcon,
  [TransferAction.CREATE_FROM]: DescriptionRoundedIcon,
  [TransferAction.OPEN_IN]: TableChartRoundedIcon,
  [TransferAction.ENRICH]: AutoFixHighRoundedIcon,
  [TransferAction.VISUALIZE]: BarChartRoundedIcon,
}

const TARGET_ICONS = {
  docqa: ChatRoundedIcon,
  knowledge: SaveRoundedIcon,
  documents: DescriptionRoundedIcon,
  spreadsheets: TableChartRoundedIcon,
  dashboards: DashboardRoundedIcon,
  enrichment: AutoFixHighRoundedIcon,
  visualization: BarChartRoundedIcon,
  synthesis: AddRoundedIcon,
  summary: SummarizeRoundedIcon,
  reports: DescriptionRoundedIcon,
}

/**
 * SendToMenu -- "Open in..." dropdown button for producer pages.
 */
export function SendToMenu({
  outputType,
  payload,
  sourceFeature,
  label = 'Open in\u2026',
  variant = 'outlined',
  size = 'small',
  disabled = false,
}) {
  const { sendTo, getAvailableTargets } = useCrossPageActions(sourceFeature)
  const [anchorEl, setAnchorEl] = useState(null)
  const targets = getAvailableTargets(outputType)

  const handleOpen = useCallback((e) => setAnchorEl(e.currentTarget), [])
  const handleClose = useCallback(() => setAnchorEl(null), [])

  const handleSelect = useCallback(
    (target) => {
      handleClose()
      const actionInfo = FEATURE_ACTIONS[target.key]
      if (actionInfo) {
        sendTo(target.key, actionInfo.action, payload)
      } else {
        sendTo(target.key, TransferAction.OPEN_IN, payload)
      }
    },
    [handleClose, payload, sendTo],
  )

  if (targets.length === 0) return null

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        startIcon={<OpenInNewRoundedIcon />}
        onClick={handleOpen}
        sx={{ textTransform: 'none', fontWeight: 500 }}
      >
        {label}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        slotProps={{ paper: { sx: { minWidth: 220 } } }}
      >
        {targets.map((target) => {
          const actionInfo = FEATURE_ACTIONS[target.key]
          const IconComp =
            TARGET_ICONS[target.key] ||
            ACTION_ICONS[actionInfo?.action] ||
            OpenInNewRoundedIcon

          return (
            <MenuItem key={target.key} onClick={() => handleSelect(target)}>
              <ListItemIcon>
                <IconComp fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                <Typography variant="body2">
                  {actionInfo?.label || `Open in ${target.label}`}
                </Typography>
              </ListItemText>
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}
