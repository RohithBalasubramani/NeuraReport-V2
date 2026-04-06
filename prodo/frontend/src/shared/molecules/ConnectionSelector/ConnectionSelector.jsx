import { neutral } from '@/app/theme'
import { useAppStore } from '@/stores/app'
import StorageIcon from '@mui/icons-material/Storage'
import {
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  alpha,
} from '@mui/material'

/**
 * ConnectionSelector -- Reusable database connection picker.
 *
 * Reads saved connections from useAppStore and lets the user pick one.
 * Can be dropped into any feature page that operates on a database.
 */
export function ConnectionSelector({
  value,
  onChange,
  label = 'Database Connection',
  size = 'small',
  fullWidth = true,
  disabled = false,
  showStatus = false,
  sx = {},
}) {
  const connections = useAppStore((s) => s.savedConnections)
  const labelId = `conn-selector-label-${label.replace(/\s/g, '-')}`

  return (
    <FormControl fullWidth={fullWidth} size={size} disabled={disabled} sx={sx}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        value={value || ''}
        label={label}
        labelId={labelId}
        onChange={(e) => onChange(e.target.value)}
        startAdornment={<StorageIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />}
      >
        {connections.length === 0 && (
          <MenuItem disabled value="">
            <Typography variant="body2" color="text.secondary">
              No connections available
            </Typography>
          </MenuItem>
        )}
        {connections.map((conn) => (
          <MenuItem key={conn.id} value={conn.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                {conn.name || conn.database_path || conn.id}
              </Typography>
              {showStatus && conn.status && (
                <Chip
                  size="small"
                  label={conn.status}
                  sx={{
                    height: 18,
                    fontSize: '10px',
                    bgcolor: (theme) =>
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.text.primary, 0.1)
                        : neutral[100],
                    color: 'text.secondary',
                  }}
                />
              )}
              {conn.db_type && (
                <Chip
                  size="small"
                  label={conn.db_type}
                  sx={{
                    height: 18,
                    fontSize: '10px',
                    bgcolor: (theme) =>
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.text.primary, 0.08)
                        : neutral[50],
                    color: 'text.secondary',
                  }}
                />
              )}
            </Box>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
