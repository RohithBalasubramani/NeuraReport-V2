import { neutral, palette, primary } from '@/app/theme'
import { Box, Button as MuiButton, Card, CircularProgress, Dialog, FormControl, IconButton as MuiIconButton, InputAdornment, TextField, Tooltip, alpha, keyframes } from '@mui/material'
import { styled } from '@mui/material/styles'
import { forwardRef } from 'react'
export const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`

export const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`

// ---------------------------------------------------------------------------
// SLIDE
// ---------------------------------------------------------------------------

export const slideUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`

export const slideDown = keyframes`
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`

export const slideIn = keyframes`
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`

export const slideInLeft = keyframes`
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
`

export const slideInRight = keyframes`
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
`

// ---------------------------------------------------------------------------
// EMPHASIS
// ---------------------------------------------------------------------------

export const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.02); }
`

export const bounce = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
`

export const shake = keyframes`
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
  20%, 40%, 60%, 80% { transform: translateX(4px); }
`

export const float = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
`

// ---------------------------------------------------------------------------
// EFFECTS
// ---------------------------------------------------------------------------

export const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`

export const glow = keyframes`
  0%, 100% { box-shadow: 0 0 5px currentColor; }
  50% { box-shadow: 0 0 20px currentColor, 0 0 30px currentColor; }
`

export const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

export const typing = keyframes`
  from { width: 0; }
  to { width: 100%; }
`

// ---------------------------------------------------------------------------
// SHARED PAGE CONTAINERS
// ---------------------------------------------------------------------------

/** Padded page with max-width constraint (reports, connections, jobs, etc.) */
export const PaddedPageContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  maxWidth: 1400,
  margin: '0 auto',
  width: '100%',
  minHeight: '100vh',
  backgroundColor: theme.palette.background.default,
  animation: `${fadeInUp} 0.5s ease-out`,
}))

/** Full-height flex page (dashboards, documents, agents, etc.) */
export const FullHeightPageContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: 'calc(100vh - 64px)',
  backgroundColor: theme.palette.background.default,
}))

// ---------------------------------------------------------------------------
// SHARED ACTION BUTTON
// ---------------------------------------------------------------------------

/** Standard action button with consistent border-radius and weight */
export const ActionButton = styled(MuiButton)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
}))

// ---------------------------------------------------------------------------
// SHARED STYLED DIALOG
// ---------------------------------------------------------------------------

/** Glass-morphism dialog used across features */
export const GlassDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiBackdrop-root': {
    backgroundColor: alpha(theme.palette.common.black, 0.6),
    backdropFilter: 'blur(8px)',
  },
  '& .MuiDialog-paper': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    borderRadius: '8px',
    boxShadow: `0 24px 64px ${alpha(theme.palette.common.black, 0.25)}`,
    animation: `${fadeInUp} 0.3s ease-out`,
  },
}))

// ---------------------------------------------------------------------------
// GLASS CARD
// ---------------------------------------------------------------------------

export const GlassCard = styled(Card)(({ theme }) => ({
  background: alpha(theme.palette.background.paper, 0.7),
  backdropFilter: 'blur(10px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: theme.shape.borderRadius * 2,
  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.12)}`,
  },
}))

export const StyledFormControl = styled(FormControl)(({ theme }) => ({
  '& .MuiInputLabel-root': { fontSize: '0.875rem' },
  '& .MuiOutlinedInput-root': {
    borderRadius: theme.shape.borderRadius * 1.5,
    transition: 'box-shadow 0.2s ease',
    '&:hover': { boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.1)}` },
    '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}` },
  },
}))

export const ExportButton = styled(MuiButton)(({ theme }) => ({
  textTransform: 'none',
  fontWeight: 600,
  borderRadius: theme.shape.borderRadius * 1.5,
}))

export const RefreshButton = styled(MuiIconButton)(({ theme }) => ({
  transition: 'transform 0.3s ease',
  '&:hover': { transform: 'rotate(180deg)' },
}))

// ---------------------------------------------------------------------------
// SHADOWS
// ---------------------------------------------------------------------------

export const shadow = {
  card: (theme) =>
    `0 8px 32px ${alpha(theme.palette.common.black, 0.08)}`,
  cardHover: (theme) =>
    `0 12px 48px ${alpha(theme.palette.common.black, 0.12)}`,
  small: (theme) =>
    `0 4px 14px ${alpha(theme.palette.text.primary, 0.15)}`,
  focus: (theme) =>
    `0 0 0 3px ${alpha(theme.palette.text.primary, 0.08)}`,
}

// ---------------------------------------------------------------------------
// BACKGROUND PATTERNS
// ---------------------------------------------------------------------------

const Button = forwardRef(function Button(
  {
    children,
    variant = 'contained',
    size = 'medium',
    loading = false,
    disabled = false,
    startIcon,
    endIcon,
    fullWidth = false,
    color = 'primary',
    ...props
  },
  ref
) {
  const getHeight = () => {
    switch (size) {
      case 'small': return FIGMA_BUTTON.heightSmall
      case 'large': return FIGMA_BUTTON.heightLarge
      default: return FIGMA_BUTTON.height
    }
  }

  return (
    <MuiButton
      ref={ref}
      variant={variant}
      size={size}
      disabled={disabled || loading}
      startIcon={loading ? <CircularProgress size={16} color="inherit" /> : startIcon}
      endIcon={endIcon}
      fullWidth={fullWidth}
      color={color}
      sx={{
        // FIGMA Button Specs
        textTransform: 'none',
        fontWeight: FIGMA_BUTTON.fontWeight,
        fontSize: `${FIGMA_BUTTON.fontSize}px`,
        lineHeight: '16px',
        borderRadius: `${FIGMA_BUTTON.borderRadius}px`,
        minHeight: getHeight(),
        px: size === 'small' ? 1.5 : 2,
        py: size === 'small' ? 0.75 : 1,
        // No box-shadow on buttons (clean Figma style)
        boxShadow: 'none',
        '&:hover': {
          boxShadow: 'none',
        },
        '&.Mui-disabled': {
          bgcolor: variant === 'contained' ? 'action.disabledBackground' : 'transparent',
        },
        ...props.sx,
      }}
      {...props}
    >
      {children}
    </MuiButton>
  )
})


const IconButton = forwardRef(function IconButton(
  {
    children,
    tooltip,
    size = 'medium',
    color = 'default',
    disabled = false,
    'aria-label': ariaLabel,
    ...props
  },
  ref
) {
  const button = (
    <MuiIconButton
      ref={ref}
      size={size}
      color={color}
      disabled={disabled}
      aria-label={ariaLabel || tooltip}
      sx={{
        borderRadius: 1,  // Figma spec: 8px
        transition: 'all 150ms ease',
        '&:hover': {
          bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
        },
        ...props.sx,
      }}
      {...props}
    >
      {children}
    </MuiIconButton>
  )

  if (tooltip && !disabled) {
    return (
      <Tooltip title={tooltip} arrow>
        {button}
      </Tooltip>
    )
  }

  return button
})


/**
 * Input Component - Design System v4
 * Height: 40px, Border-radius: 8px
 * Background: Neutral 100, Border: Neutral 300, Focus: Primary 500
 * Placeholder: Neutral 500
 */

// FIGMA Input Constants (from searchInput specs)
const FIGMA_INPUT = {
  height: 40,             // 40px from Figma
  borderRadius: 8,        // 8px from Figma
  fontSize: 14,           // 14px from Figma
  iconSize: 20,           // 20px from Figma
  paddingHorizontal: 12,  // 12px from Figma
  paddingVertical: 8,     // 8px from Figma
}

const Input = forwardRef(function Input(
  {
    label,
    placeholder,
    value,
    onChange,
    onKeyDown,
    startIcon,
    endIcon,
    error,
    helperText,
    multiline = false,
    rows,
    maxRows,
    fullWidth = true,
    size = 'medium',
    disabled = false,
    autoFocus = false,
    type = 'text',
    ...props
  },
  ref
) {
  return (
    <TextField
      ref={ref}
      label={label}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      error={!!error}
      helperText={error || helperText}
      multiline={multiline}
      rows={rows}
      maxRows={maxRows}
      fullWidth={fullWidth}
      size={size}
      disabled={disabled}
      autoFocus={autoFocus}
      type={type}
      InputProps={{
        startAdornment: startIcon ? (
          <InputAdornment position="start" sx={{ '& svg': { fontSize: FIGMA_INPUT.iconSize } }}>
            {startIcon}
          </InputAdornment>
        ) : undefined,
        endAdornment: endIcon ? (
          <InputAdornment position="end" sx={{ '& svg': { fontSize: FIGMA_INPUT.iconSize } }}>
            {endIcon}
          </InputAdornment>
        ) : undefined,
      }}
      sx={{
        '& .MuiOutlinedInput-root': {
          borderRadius: `${FIGMA_INPUT.borderRadius}px`,
          minHeight: FIGMA_INPUT.height,
          fontSize: `${FIGMA_INPUT.fontSize}px`,
          bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.background.paper, 0.6) : neutral[100],
          transition: 'all 150ms ease',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[300],
          },
          '&:hover': {
            bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.background.paper, 0.7) : neutral[100],
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.2) : neutral[400],
            },
          },
          '&.Mui-focused': {
            bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.background.paper, 0.8) : neutral[100],
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.text.secondary : primary[500],
              borderWidth: 1,
            },
          },
          '& input::placeholder': {
            color: neutral[500],
            opacity: 1,
          },
        },
        ...props.sx,
      }}
      {...props}
    />
  )
})


const KEY_MAP = {
  cmd: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  enter: '↵',
  return: '↵',
  esc: 'esc',
  escape: 'esc',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  tab: '⇥',
  backspace: '⌫',
  delete: '⌦',
  space: '␣',
}

export function Kbd({ children, size = 'medium', sx, ...props }) {
  const text = String(children).toLowerCase()
  const display = KEY_MAP[text] || children

  const sizes = {
    small: { px: 0.5, py: 0.25, fontSize: '10px', minWidth: 16 },
    medium: { px: 0.75, py: 0.25, fontSize: '0.75rem', minWidth: 20 },
    large: { px: 1, py: 0.5, fontSize: '0.875rem', minWidth: 24 },
  }

  const sizeProps = sizes[size] || sizes.medium

  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...sizeProps,
        borderRadius: 0.75,
        bgcolor: (theme) => alpha(theme.palette.action.selected, 0.8),
        border: 1,
        borderColor: 'divider',
        fontFamily: 'inherit',
        fontWeight: 500,
        color: 'text.secondary',
        whiteSpace: 'nowrap',
        ...sx,
      }}
      {...props}
    >
      {display}
    </Box>
  )
}

