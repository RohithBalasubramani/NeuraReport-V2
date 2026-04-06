import { neutral } from '@/app/theme'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import {
  Box,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

/**
 * Premium Empty State
 * Placeholder for empty lists with theme-based styling
 */
export function EmptyState({
  icon: Icon = InfoOutlinedIcon,
  iconColor,
  title,
  description,
  action = null,
  align = 'center',
  size = 'medium',
  sx = [],
  ...props
}) {
  const theme = useTheme()
  const IconComponent = Icon
  const iconSize = size === 'large' ? 56 : size === 'small' ? 36 : 48
  const spacing = size === 'large' ? 2.5 : size === 'small' ? 1.5 : 2
  const px = size === 'large' ? 4 : size === 'small' ? 2 : 3
  const py = size === 'large' ? 5 : size === 'small' ? 3 : 4
  const sxArray = Array.isArray(sx) ? sx : [sx]
  const resolvedIconColor = iconColor || theme.palette.text.secondary

  return (
    <Stack
      spacing={spacing}
      alignItems={align === 'center' ? 'center' : 'flex-start'}
      textAlign={align}
      sx={[
        {
          px,
          py,
          borderRadius: '8px',
          bgcolor: alpha(theme.palette.background.paper, 0.5),
          border: `1px dashed ${alpha(theme.palette.divider, 0.4)}`,
        },
        ...sxArray,
      ]}
      {...props}
    >
      <Box
        aria-hidden
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: iconSize,
          height: iconSize,
          borderRadius: '8px',
          bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
          border: `1px solid ${alpha(theme.palette.divider, 0.25)}`,
          color: resolvedIconColor,
        }}
      >
        <IconComponent sx={{ fontSize: iconSize * 0.5 }} />
      </Box>
      {title && (
        <Typography
          sx={{
            fontSize: size === 'large' ? '1.125rem' : size === 'small' ? '0.875rem' : '1rem',
            fontWeight: 600,
            color: theme.palette.text.primary,
          }}
        >
          {title}
        </Typography>
      )}
      {description && (
        <Typography
          sx={{
            fontSize: size === 'large' ? '0.875rem' : '0.8125rem',
            color: theme.palette.text.secondary,
            maxWidth: 380,
            lineHeight: 1.5,
          }}
        >
          {description}
        </Typography>
      )}
      {action}
    </Stack>
  )
}
