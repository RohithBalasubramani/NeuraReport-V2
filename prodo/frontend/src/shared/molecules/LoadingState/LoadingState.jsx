import { neutral } from '@/app/theme'
import { shimmer } from '@/styles/styles'
import {
  Box,
  CircularProgress,
  Fade,
  LinearProgress,
  Stack,
  Typography,
  alpha,
  keyframes,
  useTheme,
} from '@mui/material'

// Local pulse -- differs from shared version (opacity-based, not scale-based)
const dialogPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`

/**
 * Primary Loading State Component
 */
export function LoadingState({
  label = 'Loading\u2026',
  description,
  progress = null,
  inline = false,
  dense = false,
  color = 'primary',
  variant = 'linear', // 'linear' | 'circular' | 'skeleton'
  size = 'medium', // 'small' | 'medium' | 'large'
  centered = false,
  sx = [],
  ...props
}) {
  const theme = useTheme()
  const sxArray = Array.isArray(sx) ? sx : [sx]
  const spacing = inline || dense ? 0.75 : 1.5
  const width = inline ? 'auto' : '100%'

  // Size configurations
  const sizeConfig = {
    small: { circular: 20, text: 'caption' },
    medium: { circular: 32, text: 'body2' },
    large: { circular: 48, text: 'body1' },
  }[size]

  // Circular variant
  if (variant === 'circular') {
    return (
      <Fade in>
        <Stack
          direction={inline ? 'row' : 'column'}
          spacing={spacing}
          alignItems="center"
          justifyContent={centered ? 'center' : 'flex-start'}
          role="status"
          aria-live="polite"
          sx={[{ width: centered ? '100%' : width }, ...sxArray]}
          {...props}
        >
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress
              size={sizeConfig.circular}
              color={color}
              variant={progress != null ? 'determinate' : 'indeterminate'}
              value={progress ?? undefined}
            />
            {progress != null && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="caption" fontWeight={600}>
                  {Math.round(progress)}%
                </Typography>
              </Box>
            )}
          </Box>
          {label && (
            <Typography variant={sizeConfig.text} color="text.secondary">
              {label}
            </Typography>
          )}
        </Stack>
      </Fade>
    )
  }

  // Default linear variant
  return (
    <Fade in>
      <Stack
        direction="column"
        spacing={spacing}
        role="status"
        aria-live="polite"
        sx={[
          {
            width,
            maxWidth: inline ? '100%' : 440,
          },
          ...sxArray,
        ]}
        {...props}
      >
        <Typography variant={sizeConfig.text} color="text.secondary">
          {label}
        </Typography>
        <LinearProgress
          variant={progress == null ? 'indeterminate' : 'determinate'}
          value={progress ?? undefined}
          color={color}
          aria-label={label}
          sx={{ borderRadius: 1, height: size === 'small' ? 3 : size === 'large' ? 6 : 4 }}
        />
        {description && (
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        )}
      </Stack>
    </Fade>
  )
}

/**
 * Skeleton Loader Component
 * Shows placeholder content while loading
 */
export function Skeleton({
  variant = 'text', // 'text' | 'circular' | 'rectangular' | 'rounded'
  width,
  height,
  lines = 1,
  animation = 'shimmer', // 'shimmer' | 'pulse' | 'none'
  sx = [],
  ...props
}) {
  const theme = useTheme()
  const sxArray = Array.isArray(sx) ? sx : [sx]

  const pulse = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  `

  const animationStyle = {
    shimmer: {
      background: `linear-gradient(90deg,
        ${alpha(theme.palette.text.primary, 0.06)} 25%,
        ${alpha(theme.palette.text.primary, 0.12)} 50%,
        ${alpha(theme.palette.text.primary, 0.06)} 75%)`,
      backgroundSize: '200% 100%',
      animation: `${shimmer} 1.5s infinite`,
    },
    pulse: {
      bgcolor: alpha(theme.palette.text.primary, 0.08),
      animation: `${pulse} 1.5s infinite`,
    },
    none: {
      bgcolor: alpha(theme.palette.text.primary, 0.08),
    },
  }[animation]

  if (variant === 'text') {
    return (
      <Box sx={[{ display: 'flex', flexDirection: 'column', gap: 1 }, ...sxArray]} {...props}>
        {Array.from({ length: lines }).map((_, i) => (
          <Box
            key={i}
            sx={{
              height: height || 16,
              width: i === lines - 1 && lines > 1 ? '60%' : width || '100%',
              borderRadius: 1,
              ...animationStyle,
            }}
          />
        ))}
      </Box>
    )
  }

  if (variant === 'circular') {
    return (
      <Box
        sx={[
          {
            width: width || 40,
            height: height || 40,
            borderRadius: '50%',
            ...animationStyle,
          },
          ...sxArray,
        ]}
        {...props}
      />
    )
  }

  if (variant === 'rounded') {
    return (
      <Box
        sx={[
          {
            width: width || '100%',
            height: height || 120,
            borderRadius: 1,
            ...animationStyle,
          },
          ...sxArray,
        ]}
        {...props}
      />
    )
  }

  // rectangular
  return (
    <Box
      sx={[
        {
          width: width || '100%',
          height: height || 120,
          ...animationStyle,
        },
        ...sxArray,
      ]}
      {...props}
    />
  )
}

/**
 * Content Skeleton - Pre-built skeleton patterns
 */
export function ContentSkeleton({ type = 'card', count = 1 }) {
  const items = Array.from({ length: count })

  if (type === 'card') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((_, i) => (
          <Box key={i} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Skeleton variant="circular" width={48} height={48} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="60%" height={20} />
                <Skeleton variant="text" width="40%" height={16} sx={{ mt: 1 }} />
              </Box>
            </Box>
            <Skeleton variant="text" lines={3} />
          </Box>
        ))}
      </Box>
    )
  }

  if (type === 'list') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {items.map((_, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
            <Skeleton variant="circular" width={40} height={40} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="70%" />
              <Skeleton variant="text" width="50%" height={14} sx={{ mt: 0.5 }} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  }

  if (type === 'table') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Skeleton variant="rectangular" height={48} />
        {items.map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={52} />
        ))}
      </Box>
    )
  }

  if (type === 'chat') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((_, i) => (
          <Box
            key={i}
            sx={{
              display: 'flex',
              gap: 2,
              alignSelf: i % 2 === 0 ? 'flex-start' : 'flex-end',
              maxWidth: '70%',
            }}
          >
            {i % 2 === 0 && <Skeleton variant="circular" width={36} height={36} />}
            <Skeleton variant="rounded" width={200 + Math.random() * 100} height={60 + Math.random() * 40} />
            {i % 2 !== 0 && <Skeleton variant="circular" width={36} height={36} />}
          </Box>
        ))}
      </Box>
    )
  }

  return <Skeleton variant="rectangular" />
}
