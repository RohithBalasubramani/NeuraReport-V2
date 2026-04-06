import { neutral } from '@/app/theme'
import { useAppStore } from '@/stores/app'
import DescriptionIcon from '@mui/icons-material/Description'
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
import { useMemo } from 'react'

/**
 * TemplateSelector -- Reusable report template picker.
 *
 * Reads approved templates from useAppStore and lets the user pick one.
 * Can be dropped into any feature page that needs template context.
 */
export function TemplateSelector({
  value,
  onChange,
  label = 'Report Template',
  size = 'small',
  fullWidth = true,
  disabled = false,
  showAll = false,
  sx = {},
}) {
  const templates = useAppStore((s) => s.templates)

  const filtered = useMemo(
    () => (showAll ? templates : templates.filter((t) => t.status === 'approved')),
    [templates, showAll],
  )

  const labelId = `tpl-selector-label-${label.replace(/\s/g, '-')}`

  return (
    <FormControl fullWidth={fullWidth} size={size} disabled={disabled} sx={sx}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        value={value || ''}
        label={label}
        labelId={labelId}
        onChange={(e) => onChange(e.target.value)}
        startAdornment={
          <DescriptionIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />
        }
      >
        {filtered.length === 0 && (
          <MenuItem disabled value="">
            <Typography variant="body2" color="text.secondary">
              No templates available
            </Typography>
          </MenuItem>
        )}
        {filtered.map((tpl) => (
          <MenuItem key={tpl.id} value={tpl.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                {tpl.name || tpl.id}
              </Typography>
              {tpl.kind && (
                <Chip
                  size="small"
                  label={tpl.kind.toUpperCase()}
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
