import { neutral } from '@/app/theme'
import {
  Storage as DbIcon,
} from '@mui/icons-material'
import { Chip, alpha } from '@mui/material'

export function DataSourceBadge({ source }) {
  if (!source) return null

  return (
    <Chip
      icon={<DbIcon sx={{ fontSize: 14 }} />}
      label={source}
      size="small"
      variant="outlined"
      sx={{
        height: 20,
        fontSize: 11,
        borderColor: (theme) => alpha(theme.palette.divider, 0.5),
        color: 'text.secondary',
      }}
    />
  )
}
