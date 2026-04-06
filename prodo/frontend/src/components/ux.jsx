import { neutral, palette } from '@/app/theme'
import { useNetworkStatus } from '@/hooks/hooks'
import { slideDown } from '@/styles/styles'
import {
  Add as CreateIcon,
  AutoAwesome as GenerateIcon,
  CheckCircle as SuccessIcon,
  CheckCircle as ValidIcon,
  ClearAll as ClearIcon,
  Close as CloseIcon,
  CloudDownload as DownloadIcon,
  CloudOff as ServerDownIcon,
  CloudUpload as UploadIcon,
  Delete as DeleteIcon,
  Edit as UpdateIcon,
  Error as ErrorIcon,
  ExpandLess as CollapseIcon,
  ExpandMore as ExpandIcon,
  History as HistoryIcon,
  HourglassEmpty as PendingIcon,
  Info as InfoIcon,
  InfoOutlined as InfoOutlinedIcon,
  PlayArrow as ExecuteIcon,
  Refresh as RetryIcon,
  Send as SendIcon,
  Undo as UndoIcon,
  Wifi as OnlineIcon,
  WifiOff as OfflineIcon,
} from '@mui/icons-material'
import ArticleIcon from '@mui/icons-material/Article'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import DescriptionIcon from '@mui/icons-material/Description'
import WorkOutlineIcon from '@mui/icons-material/WorkOutline'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  Drawer,
  Fade,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  keyframes,
  useTheme,
} from '@mui/material'
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
function formatTimeAgo(date) {
  const now = Date.now()
  const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime()
  const seconds = Math.floor((now - timestamp) / 1000)

  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// Operation type icons
const getOperationIcon = (type) => {
  const icons = {
    [OperationType.CREATE]: CreateIcon,
    [OperationType.UPDATE]: UpdateIcon,
    [OperationType.DELETE]: DeleteIcon,
    [OperationType.UPLOAD]: UploadIcon,
    [OperationType.DOWNLOAD]: DownloadIcon,
    [OperationType.GENERATE]: GenerateIcon,
    [OperationType.EXECUTE]: ExecuteIcon,
    [OperationType.SEND]: SendIcon,
  }
  return icons[type] || HistoryIcon
}

// Status configurations
const getStatusConfig = (status, theme) => {
  const configs = {
    [OperationStatus.PENDING]: {
      icon: PendingIcon,
      color: neutral[500],
      label: 'Pending',
    },
    [OperationStatus.IN_PROGRESS]: {
      icon: PendingIcon,
      color: theme.palette.text.secondary,
      label: 'In progress',
      showProgress: true,
    },
    [OperationStatus.COMPLETED]: {
      icon: SuccessIcon,
      color: theme.palette.text.secondary,
      label: 'Completed',
    },
    [OperationStatus.FAILED]: {
      icon: ErrorIcon,
      color: theme.palette.text.secondary,
      label: 'Failed',
    },
    [OperationStatus.UNDONE]: {
      icon: UndoIcon,
      color: theme.palette.text.secondary,
      label: 'Undone',
    },
  }
  return configs[status] || configs[OperationStatus.PENDING]
}

/**
 * Single Operation Item
 */
function OperationItem({ operation, onUndo }) {
  const theme = useTheme()
  const [expanded, setExpanded] = useState(false)
  const statusConfig = getStatusConfig(operation.status, theme)
  const Icon = getOperationIcon(operation.type)
  const StatusIcon = statusConfig.icon

  const timeAgo = useMemo(() => {
    const time = operation.completedAt || operation.startedAt
    return formatTimeAgo(time)
  }, [operation.completedAt, operation.startedAt])

  const canUndo = operation.status === OperationStatus.COMPLETED && operation.canUndo

  return (
    <ListItem
      sx={{
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 1,
        py: 1.5,
        px: 2,
        bgcolor: alpha(theme.palette.background.paper, 0.4),
        borderRadius: 1,  // Figma spec: 8px
        mb: 1,
        '&:hover': {
          bgcolor: alpha(theme.palette.background.paper, 0.6),
        },
      }}
    >
      {/* Main row */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, width: '100%' }}>
        {/* Type icon */}
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1,  // Figma spec: 8px
            bgcolor: alpha(statusConfig.color, 0.1),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon sx={{ fontSize: 18, color: statusConfig.color }} />
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={500} noWrap>
            {operation.label}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Chip
              size="small"
              icon={<StatusIcon sx={{ fontSize: '14px !important' }} />}
              label={statusConfig.label}
              sx={{
                height: 22,
                fontSize: '12px',
                bgcolor: alpha(statusConfig.color, 0.1),
                color: statusConfig.color,
                '& .MuiChip-icon': {
                  color: statusConfig.color,
                },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {timeAgo}
            </Typography>
          </Box>
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {canUndo && (
            <Tooltip title={operation.undoLabel || 'Undo'}>
              <IconButton
                size="small"
                onClick={() => onUndo(operation.id)}
                sx={{
                  color: theme.palette.text.secondary,
                  '&:hover': {
                    bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                  },
                }}
              >
                <UndoIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {(operation.description || operation.error) && (
            <IconButton size="small" onClick={() => setExpanded(!expanded)}>
              {expanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Progress bar for in-progress operations */}
      {statusConfig.showProgress && (
        <LinearProgress
          variant={operation.progress > 0 ? 'determinate' : 'indeterminate'}
          value={operation.progress}
          sx={{
            height: 4,
            borderRadius: 1,  // Figma spec: 8px
            bgcolor: alpha(statusConfig.color, 0.1),
            '& .MuiLinearProgress-bar': {
              bgcolor: statusConfig.color,
            },
          }}
        />
      )}

      {/* Expanded details */}
      <Collapse in={expanded}>
        <Box
          sx={{
            mt: 1,
            p: 1.5,
            bgcolor: alpha(theme.palette.background.default, 0.5),
            borderRadius: 1,
          }}
        >
          {operation.description && (
            <Typography variant="body2" color="text.secondary">
              {operation.description}
            </Typography>
          )}
          {operation.error && (
            <Typography variant="body2" color="text.secondary">
              Error: {operation.error}
            </Typography>
          )}
        </Box>
      </Collapse>
    </ListItem>
  )
}

/**
 * Activity Panel Component
 */
export function ActivityPanel({ open, onClose }) {
  const theme = useTheme()
  const {
    operations,
    activeCount,
    hasActiveOperations,
    undoOperation,
    clearCompleted,
  } = useOperationHistory()

  const completedCount = useMemo(() =>
    operations.filter((op) => op.status === OperationStatus.COMPLETED).length,
    [operations]
  )

  const failedCount = useMemo(() =>
    operations.filter((op) => op.status === OperationStatus.FAILED).length,
    [operations]
  )

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: 380,
          maxWidth: '100vw',
          bgcolor: alpha(theme.palette.background.default, 0.95),
          backdropFilter: 'blur(20px)',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <HistoryIcon sx={{ color: 'text.secondary' }} />
          <Typography variant="h6" fontWeight={600}>
            Activity
          </Typography>
          {hasActiveOperations && (
            <Chip
              size="small"
              label={`${activeCount} active`}
              sx={{ height: 22, fontSize: '12px', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
            />
          )}
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Summary bar */}
      {operations.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            p: 2,
            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.03) : neutral[50],
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          }}
        >
          <Box sx={{ flex: 1, display: 'flex', gap: 2 }}>
            <Typography variant="body2">
              <Box component="span" fontWeight={600}>{completedCount}</Box> completed
            </Typography>
            {failedCount > 0 && (
              <Typography variant="body2" color="text.secondary">
                <Box component="span" fontWeight={600}>{failedCount}</Box> failed
              </Typography>
            )}
          </Box>
          {completedCount > 0 && (
            <Button
              size="small"
              startIcon={<ClearIcon />}
              onClick={clearCompleted}
              sx={{ textTransform: 'none' }}
            >
              Clear completed
            </Button>
          )}
        </Box>
      )}

      {/* Operations list */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
        }}
      >
        {operations.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: 'text.secondary',
              textAlign: 'center',
              p: 4,
            }}
          >
            <HistoryIcon sx={{ fontSize: 48, mb: 2, opacity: 0.3 }} />
            <Typography variant="body1" fontWeight={500}>
              No recent activity
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, opacity: 0.7 }}>
              Your actions will appear here
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {operations.map((operation) => (
              <Fade in key={operation.id}>
                <div>
                  <OperationItem
                    operation={operation}
                    onUndo={undoOperation}
                  />
                </div>
              </Fade>
            ))}
          </List>
        )}
      </Box>
    </Drawer>
  )
}

/**
 * Activity Button - Shows in header to indicate active operations
 */
// === From: DisabledTooltip.jsx ===
/**
 * Disabled Tooltip Component
 * Wraps buttons/actions to explain WHY they are disabled
 *
 * UX Laws Addressed:
 * - Make system state always visible
 * - Prevent errors before handling them
 * - Never leave the user guessing
 */

/**
 * DisabledTooltip - Wrapper that explains why an action is unavailable
 *
 * @param {Object} props
 * @param {boolean} props.disabled - Whether the wrapped element should be disabled
 * @param {string} props.reason - Human-readable reason why it's disabled
 * @param {string} props.hint - Optional hint on how to enable it
 * @param {React.ReactNode} props.children - The element to wrap
 * @param {string} props.placement - Tooltip placement (default: 'top')
 * @param {boolean} props.showIcon - Show info icon when disabled (default: false)
 */
const DisabledTooltip = forwardRef(function DisabledTooltip(
  {
    disabled = false,
    reason,
    hint,
    children,
    placement = 'top',
    showIcon = false,
    ...props
  },
  ref
) {
  const theme = useTheme()

  // If not disabled, just render children
  if (!disabled) {
    return children
  }

  // Build tooltip content
  const tooltipContent = (
    <Box sx={{ maxWidth: 240 }}>
      <Box sx={{ fontWeight: 500, mb: hint ? 0.5 : 0 }}>
        {reason || 'This action is currently unavailable'}
      </Box>
      {hint && (
        <Box sx={{
          fontSize: '14px',
          opacity: 0.85,
          color: alpha(theme.palette.common.white, 0.85),
        }}>
          {hint}
        </Box>
      )}
    </Box>
  )

  return (
    <Tooltip
      ref={ref}
      title={tooltipContent}
      placement={placement}
      arrow
      enterDelay={200}
      leaveDelay={0}
      componentsProps={{
        tooltip: {
          sx: {
            bgcolor: alpha(neutral[900], 0.95),
            backdropFilter: 'blur(8px)',
            borderRadius: '8px',
            px: 1.5,
            py: 1,
            boxShadow: `0 4px 20px ${alpha(theme.palette.common.black, 0.3)}`,
            '& .MuiTooltip-arrow': {
              color: alpha(neutral[900], 0.95),
            },
          },
        },
      }}
      {...props}
    >
      {/* Wrap in span to allow tooltip on disabled elements */}
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          cursor: 'not-allowed',
        }}
      >
        {/* Clone children with pointer-events: none so tooltip works */}
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            pointerEvents: 'none',
          }}
        >
          {children}
        </Box>
        {showIcon && (
          <InfoIcon
            sx={{
              fontSize: 14,
              color: theme.palette.text.disabled,
              ml: 0.25,
            }}
          />
        )}
      </Box>
    </Tooltip>
  )
})

export { DisabledTooltip }

/**
 * Common disabled reasons - use these for consistency
 */
export const DisabledReasons = {
  // Input requirements
  FIELD_REQUIRED: 'Please fill in the required field',
  MIN_LENGTH: (min) => `Please enter at least ${min} characters`,
  MAX_LENGTH: (max) => `Maximum ${max} characters allowed`,
  INVALID_FORMAT: 'Please enter a valid format',

  // Selection requirements
  SELECT_ITEM: 'Please select an item first',
  SELECT_CONNECTION: 'Please select a database connection first',
  SELECT_TEMPLATE: 'Please select a template first',
  SELECT_DOCUMENT: 'Please add at least one document',

  // State requirements
  LOADING: 'Please wait for the current operation to complete',
  PROCESSING: 'Processing in progress...',
  SAVING: 'Saving changes...',

  // Permission/access
  NO_PERMISSION: 'You do not have permission for this action',
  FEATURE_UNAVAILABLE: 'This feature is not available',

  // Prerequisite actions
  COMPLETE_PREVIOUS: 'Please complete the previous step first',
  FIX_ERRORS: 'Please fix the errors above first',

  // Connection/network
  OFFLINE: 'No internet connection',
  SERVER_UNAVAILABLE: 'Server is temporarily unavailable',
}

/**
 * Helper to get hint text for common reasons
 */
// === From: InlineValidator.jsx ===
/**
 * Inline Validator Components
 * Real-time validation feedback that prevents errors before they happen
 *
 * UX Laws Addressed:
 * - Prevent errors before handling them
 * - Immediate feedback (within 100ms)
 * - Make system state always visible
 */

// Validation states
const ValidationState = {
  IDLE: 'idle',
  VALIDATING: 'validating',
  VALID: 'valid',
  INVALID: 'invalid',
  WARNING: 'warning',
}

/**
 * Common validation rules
 */
export const ValidationRules = {
  required: (message = 'This field is required') => ({
    validate: (value) => {
      const trimmed = typeof value === 'string' ? value.trim() : value
      return trimmed && trimmed.length > 0
    },
    message,
  }),

  minLength: (min, message) => ({
    validate: (value) => !value || value.length >= min,
    message: message || `Must be at least ${min} characters`,
  }),

  maxLength: (max, message) => ({
    validate: (value) => !value || value.length <= max,
    message: message || `Must be ${max} characters or less`,
  }),

  pattern: (regex, message = 'Invalid format') => ({
    validate: (value) => !value || regex.test(value),
    message,
  }),

  email: (message = 'Please enter a valid email address') => ({
    validate: (value) => {
      if (!value) return true
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      return emailRegex.test(value)
    },
    message,
  }),

  url: (message = 'Please enter a valid URL') => ({
    validate: (value) => {
      if (!value) return true
      try {
        new URL(value)
        return true
      } catch {
        return false
      }
    },
    message,
  }),

  noSpecialChars: (message = 'Special characters are not allowed') => ({
    validate: (value) => {
      if (!value) return true
      return /^[a-zA-Z0-9_\-\s]+$/.test(value)
    },
    message,
  }),

  custom: (validateFn, message) => ({
    validate: validateFn,
    message,
  }),
}

/**
 * Hook for field validation
 */
/**
 * Validated TextField Component
 * Drop-in replacement for TextField with built-in validation
 */
export function ValidatedTextField({
  rules = [],
  value,
  onChange,
  onBlur,
  showValidIcon = true,
  showCharCount = false,
  maxLength,
  validateOnMount = false,
  hint,
  ...props
}) {
  const theme = useTheme()
  const [localValue, setLocalValue] = useState(value || '')
  const [touched, setTouched] = useState(validateOnMount)
  const [validationState, setValidationState] = useState(ValidationState.IDLE)
  const [errorMessage, setErrorMessage] = useState(null)

  // Sync with external value
  useEffect(() => {
    if (value !== undefined) {
      setLocalValue(value)
    }
  }, [value])

  // Auto-add maxLength rule if specified
  const allRules = useMemo(() => {
    const r = [...rules]
    if (maxLength && !r.some((rule) => rule.message?.includes('characters or less'))) {
      r.push(ValidationRules.maxLength(maxLength))
    }
    return r
  }, [rules, maxLength])

  // Validate
  const validate = useCallback((val) => {
    for (const rule of allRules) {
      if (!rule.validate(val)) {
        setValidationState(ValidationState.INVALID)
        setErrorMessage(rule.message)
        return false
      }
    }
    setValidationState(val ? ValidationState.VALID : ValidationState.IDLE)
    setErrorMessage(null)
    return true
  }, [allRules])

  // Handle change
  const validateTimerRef = useRef(null)

  useEffect(() => {
    return () => {
      if (validateTimerRef.current) {
        clearTimeout(validateTimerRef.current)
      }
    }
  }, [])

  const handleChange = useCallback((e) => {
    const newValue = e.target.value

    // Enforce maxLength at input level
    if (maxLength && newValue.length > maxLength) {
      return
    }

    setLocalValue(newValue)
    onChange?.(e)

    // Validate with slight delay for perceived performance
    if (touched) {
      if (validateTimerRef.current) {
        clearTimeout(validateTimerRef.current)
      }
      validateTimerRef.current = setTimeout(() => validate(newValue), 50)
    }
  }, [onChange, touched, validate, maxLength])

  // Handle blur
  const handleBlur = useCallback((e) => {
    setTouched(true)
    validate(localValue)
    onBlur?.(e)
  }, [onBlur, localValue, validate])

  // Determine helper text
  const helperText = useMemo(() => {
    if (touched && errorMessage) {
      return errorMessage
    }
    if (hint && !touched) {
      return hint
    }
    if (showCharCount && maxLength) {
      return `${localValue.length}/${maxLength}`
    }
    return props.helperText
  }, [touched, errorMessage, hint, showCharCount, maxLength, localValue.length, props.helperText])

  // Determine end adornment
  const endAdornment = useMemo(() => {
    if (!showValidIcon || !touched) {
      return props.InputProps?.endAdornment
    }

    let icon = null
    if (validationState === ValidationState.VALID) {
      icon = <ValidIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
    } else if (validationState === ValidationState.INVALID) {
      icon = <ErrorIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
    }

    if (!icon) {
      return props.InputProps?.endAdornment
    }

    return (
      <InputAdornment position="end">
        <Fade in>
          {icon}
        </Fade>
        {props.InputProps?.endAdornment}
      </InputAdornment>
    )
  }, [showValidIcon, touched, validationState, props.InputProps?.endAdornment])

  return (
    <TextField
      {...props}
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      error={touched && validationState === ValidationState.INVALID}
      helperText={helperText}
      inputProps={{
        ...props.inputProps,
        maxLength: maxLength,
      }}
      InputProps={{
        ...props.InputProps,
        endAdornment,
      }}
      FormHelperTextProps={{
        ...props.FormHelperTextProps,
        sx: {
          ...props.FormHelperTextProps?.sx,
          display: 'flex',
          justifyContent: 'space-between',
        },
      }}
    />
  )
}

/**
 * Validation Feedback Component
 * Shows validation state with animation
 */
/**
 * Character Counter Component
 */
export function CharacterCounter({ current, max, warningThreshold = 0.9 }) {
  const theme = useTheme()
  const ratio = current / max

  const color = useMemo(() => {
    if (current >= max) return theme.palette.text.secondary
    if (ratio >= warningThreshold) return theme.palette.text.secondary
    return theme.palette.text.secondary
  }, [current, max, ratio, warningThreshold, theme])

  return (
    <Typography
      variant="caption"
      sx={{
        color,
        fontWeight: current >= max ? 600 : 400,
      }}
    >
      {current}/{max}
    </Typography>
  )
}

// === From: NetworkStatusBanner.jsx ===
/**
 * Network Status Banner
 * Shows when the user is offline or has connectivity issues
 *
 * UX Laws Addressed:
 * - Make system state always visible
 * - Never leave the user guessing
 * - Safe defaults (user can do nothing and be fine)
 */

// Local pulse — differs from shared version (opacity-based, not scale-based)
const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
`

// Status types
const NetworkStatus = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  RECONNECTING: 'reconnecting',
  SERVER_DOWN: 'server_down',
}

/**
 * Network Status Banner
 * Displays at the top of the page when there are connectivity issues
 */
export function NetworkStatusBanner({ onRetry }) {
  const theme = useTheme()
  const { isOnline, checkConnectivity, checkServer } = useNetworkStatus()
  const [status, setStatus] = useState(NetworkStatus.ONLINE)
  const [isRetrying, setIsRetrying] = useState(false)
  const [showBanner, setShowBanner] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)
  const successTimeoutRef = useRef(null)
  const prevOnlineRef = useRef(isOnline)
  // Server connectivity check is provided by the network hook

  // Handle retry
  const handleRetry = useCallback(async () => {
    setIsRetrying(true)
    setStatus(NetworkStatus.RECONNECTING)

    try {
      const browserOnline = await checkConnectivity()

      if (browserOnline) {
        const serverUp = await checkServer()

        if (serverUp) {
          setStatus(NetworkStatus.ONLINE)
          setWasOffline(true)
          // Keep banner briefly to show success
          clearTimeout(successTimeoutRef.current)
          successTimeoutRef.current = setTimeout(() => {
            setShowBanner(false)
            setWasOffline(false)
          }, 2000)
        } else {
          setStatus(NetworkStatus.SERVER_DOWN)
        }
      } else {
        setStatus(NetworkStatus.OFFLINE)
      }
    } finally {
      setIsRetrying(false)
    }

    onRetry?.()
  }, [checkConnectivity, checkServer, onRetry])

  // Monitor network status - only retry on actual offline-to-online transitions
  useEffect(() => {
    if (!isOnline) {
      setStatus(NetworkStatus.OFFLINE)
      setShowBanner(true)
    } else if (!prevOnlineRef.current) {
      // Transitioning from offline to online, verify with server
      handleRetry()
    }
    prevOnlineRef.current = isOnline
  }, [isOnline, handleRetry])

  // Periodic check when offline
  useEffect(() => {
    if (status === NetworkStatus.OFFLINE || status === NetworkStatus.SERVER_DOWN) {
      const interval = setInterval(handleRetry, 30000) // Check every 30s
      return () => clearInterval(interval)
    }
  }, [status, handleRetry])

  // Cleanup success timeout on unmount
  useEffect(() => {
    return () => clearTimeout(successTimeoutRef.current)
  }, [])

  // Get banner configuration based on status
  const getBannerConfig = () => {
    const neutralColor = theme.palette.mode === 'dark' ? neutral[500] : neutral[700]
    const neutralBgColor = theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100]
    switch (status) {
      case NetworkStatus.OFFLINE:
        return {
          icon: <OfflineIcon />,
          message: "You're offline",
          description: 'Check your internet connection. Changes will sync when you reconnect.',
          color: neutralColor,
          bgColor: neutralBgColor,
          showRetry: true,
        }
      case NetworkStatus.SERVER_DOWN:
        return {
          icon: <ServerDownIcon />,
          message: 'Server temporarily unavailable',
          description: 'We\'re working on it. Your work is saved locally.',
          color: neutralColor,
          bgColor: neutralBgColor,
          showRetry: true,
        }
      case NetworkStatus.RECONNECTING:
        return {
          icon: <RetryIcon sx={{ animation: `spin 1s linear infinite`, '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } } }} />,
          message: 'Reconnecting...',
          description: 'Attempting to restore connection',
          color: neutralColor,
          bgColor: neutralBgColor,
          showRetry: false,
        }
      case NetworkStatus.ONLINE:
      default:
        if (wasOffline) {
          return {
            icon: <OnlineIcon />,
            message: 'Back online',
            description: 'Connection restored',
            color: neutralColor,
            bgColor: neutralBgColor,
            showRetry: false,
          }
        }
        return null
    }
  }

  const config = getBannerConfig()

  if (!showBanner || !config) {
    return null
  }

  return (
    <Collapse in={showBanner}>
      <Box
        sx={{
          bgcolor: config.bgColor,
          borderBottom: `1px solid ${alpha(config.color, 0.2)}`,
          animation: `${slideDown} 0.3s ease-out`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {isRetrying && (
          <LinearProgress
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              bgcolor: alpha(config.color, 0.1),
              '& .MuiLinearProgress-bar': {
                bgcolor: config.color,
              },
            }}
          />
        )}

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            py: 1.5,
            px: 3,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              color: config.color,
              animation: status === NetworkStatus.OFFLINE ? `${pulse} 2s infinite` : 'none',
            }}
          >
            {config.icon}
            <Typography variant="body2" fontWeight={600}>
              {config.message}
            </Typography>
          </Box>

          <Typography
            variant="body2"
            sx={{
              color: alpha(theme.palette.text.primary, 0.7),
              display: { xs: 'none', sm: 'block' },
            }}
          >
            {config.description}
          </Typography>

          {config.showRetry && !isRetrying && (
            <Button
              size="small"
              variant="outlined"
              onClick={handleRetry}
              startIcon={<RetryIcon />}
              sx={{
                ml: 2,
                borderColor: alpha(config.color, 0.3),
                color: config.color,
                '&:hover': {
                  borderColor: config.color,
                  bgcolor: alpha(config.color, 0.1),
                },
              }}
            >
              Retry
            </Button>
          )}
        </Box>
      </Box>
    </Collapse>
  )
}

/**
 * Compact inline network indicator for headers/footers
 */
// === From: OperationHistoryProvider.jsx ===
/**
 * Operation History Provider
 * Tracks all user operations for visibility, undo, and recovery
 *
 * UX Laws Addressed:
 * - Make system state always visible
 * - Make every action reversible where possible
 * - Never leave the user guessing
 */

// Operation states
export const OperationStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  UNDONE: 'undone',
}

// Operation types for consistent terminology
export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  UPLOAD: 'upload',
  DOWNLOAD: 'download',
  GENERATE: 'generate',
  EXECUTE: 'execute',
  SEND: 'send',
}

// Action types
const ACTIONS = {
  ADD_OPERATION: 'ADD_OPERATION',
  UPDATE_OPERATION: 'UPDATE_OPERATION',
  COMPLETE_OPERATION: 'COMPLETE_OPERATION',
  FAIL_OPERATION: 'FAIL_OPERATION',
  UNDO_OPERATION: 'UNDO_OPERATION',
  CLEAR_COMPLETED: 'CLEAR_COMPLETED',
  CLEAR_ALL: 'CLEAR_ALL',
}

// Reducer
function operationReducer(state, action) {
  switch (action.type) {
    case ACTIONS.ADD_OPERATION:
      return {
        ...state,
        operations: [action.payload, ...state.operations].slice(0, 100), // Keep last 100
        activeCount: state.activeCount + 1,
      }

    case ACTIONS.UPDATE_OPERATION:
      return {
        ...state,
        operations: state.operations.map((op) =>
          op.id === action.payload.id ? { ...op, ...action.payload.updates } : op
        ),
      }

    case ACTIONS.COMPLETE_OPERATION:
      return {
        ...state,
        operations: state.operations.map((op) =>
          op.id === action.payload.id
            ? {
                ...op,
                status: OperationStatus.COMPLETED,
                completedAt: Date.now(),
                result: action.payload.result,
              }
            : op
        ),
        activeCount: Math.max(0, state.activeCount - 1),
      }

    case ACTIONS.FAIL_OPERATION:
      return {
        ...state,
        operations: state.operations.map((op) =>
          op.id === action.payload.id
            ? {
                ...op,
                status: OperationStatus.FAILED,
                completedAt: Date.now(),
                error: action.payload.error,
              }
            : op
        ),
        activeCount: Math.max(0, state.activeCount - 1),
      }

    case ACTIONS.UNDO_OPERATION:
      return {
        ...state,
        operations: state.operations.map((op) =>
          op.id === action.payload.id
            ? { ...op, status: OperationStatus.UNDONE, undoneAt: Date.now() }
            : op
        ),
      }

    case ACTIONS.CLEAR_COMPLETED:
      return {
        ...state,
        operations: state.operations.filter(
          (op) => op.status === OperationStatus.PENDING || op.status === OperationStatus.IN_PROGRESS
        ),
      }

    case ACTIONS.CLEAR_ALL:
      return { ...state, operations: [], activeCount: 0 }

    default:
      return state
  }
}

// Initial state
const initialState = {
  operations: [],
  activeCount: 0,
}

// Context
const OperationHistoryContext = createContext(null)

// Generate unique operation ID
let operationIdCounter = 0
const generateOperationId = () => `op_${Date.now()}_${++operationIdCounter}`

/**
 * Operation History Provider
 * Wraps app to provide operation tracking
 */
export function OperationHistoryProvider({ children }) {
  const [state, dispatch] = useReducer(operationReducer, initialState)

  // Start a new operation
  const startOperation = useCallback((config) => {
    const operation = {
      id: generateOperationId(),
      type: config.type || OperationType.UPDATE,
      label: config.label,
      description: config.description,
      status: OperationStatus.IN_PROGRESS,
      startedAt: Date.now(),
      completedAt: null,
      progress: 0,
      canUndo: config.canUndo || false,
      undoFn: config.undoFn || null,
      undoLabel: config.undoLabel || 'Undo',
      metadata: config.metadata || {},
    }

    dispatch({ type: ACTIONS.ADD_OPERATION, payload: operation })
    return operation.id
  }, [])

  // Update operation progress
  const updateProgress = useCallback((operationId, progress, description) => {
    dispatch({
      type: ACTIONS.UPDATE_OPERATION,
      payload: {
        id: operationId,
        updates: { progress, ...(description && { description }) },
      },
    })
  }, [])

  // Complete an operation successfully
  const completeOperation = useCallback((operationId, result) => {
    dispatch({
      type: ACTIONS.COMPLETE_OPERATION,
      payload: { id: operationId, result },
    })
  }, [])

  // Mark operation as failed
  const failOperation = useCallback((operationId, error) => {
    dispatch({
      type: ACTIONS.FAIL_OPERATION,
      payload: { id: operationId, error: typeof error === 'string' ? error : error?.message || 'Unknown error' },
    })
  }, [])

  // Undo an operation
  const undoOperation = useCallback(async (operationId) => {
    const operation = state.operations.find((op) => op.id === operationId)
    if (!operation || !operation.canUndo || !operation.undoFn) {
      return false
    }

    try {
      await operation.undoFn()
      dispatch({ type: ACTIONS.UNDO_OPERATION, payload: { id: operationId } })
      return true
    } catch (err) {
      console.error('Failed to undo operation:', err)
      return false
    }
  }, [state.operations])

  // Clear completed operations
  const clearCompleted = useCallback(() => {
    dispatch({ type: ACTIONS.CLEAR_COMPLETED })
  }, [])

  // Clear all operations
  const clearAll = useCallback(() => {
    dispatch({ type: ACTIONS.CLEAR_ALL })
  }, [])

  // Get recent operations (for display)
  const getRecentOperations = useCallback((limit = 10) => {
    return state.operations.slice(0, limit)
  }, [state.operations])

  // Get active operations
  const getActiveOperations = useCallback(() => {
    return state.operations.filter(
      (op) => op.status === OperationStatus.PENDING || op.status === OperationStatus.IN_PROGRESS
    )
  }, [state.operations])

  // Utility: wrap an async function with operation tracking
  const trackOperation = useCallback(async (config, asyncFn) => {
    const operationId = startOperation(config)

    try {
      const result = await asyncFn((progress, description) => {
        updateProgress(operationId, progress, description)
      })
      completeOperation(operationId, result)
      return { success: true, result, operationId }
    } catch (error) {
      failOperation(operationId, error)
      return { success: false, error, operationId }
    }
  }, [startOperation, updateProgress, completeOperation, failOperation])

  const contextValue = useMemo(() => ({
    operations: state.operations,
    activeCount: state.activeCount,
    hasActiveOperations: state.activeCount > 0,
    startOperation,
    updateProgress,
    completeOperation,
    failOperation,
    undoOperation,
    clearCompleted,
    clearAll,
    getRecentOperations,
    getActiveOperations,
    trackOperation,
  }), [
    state.operations,
    state.activeCount,
    startOperation,
    updateProgress,
    completeOperation,
    failOperation,
    undoOperation,
    clearCompleted,
    clearAll,
    getRecentOperations,
    getActiveOperations,
    trackOperation,
  ])

  return (
    <OperationHistoryContext.Provider value={contextValue}>
      {children}
    </OperationHistoryContext.Provider>
  )
}

/**
 * Hook to access operation history
 */
export function useOperationHistory() {
  const context = useContext(OperationHistoryContext)
  if (!context) {
    throw new Error('useOperationHistory must be used within OperationHistoryProvider')
  }
  return context
}

/**
 * Hook for simplified operation tracking
 * Returns a function to track async operations
 */
// === From: ReportGlossaryNotice.jsx ===

export function ReportGlossaryNotice({
  dense = false,
  showChips = true,
  sx,
}) {
  return (
    <Alert severity="info" sx={{ borderRadius: 1, ...sx }}>  {/* Figma spec: 8px */}
      <Stack spacing={dense ? 0.5 : 0.75}>
        <Typography variant={dense ? 'subtitle2' : 'subtitle1'} fontWeight={600}>
          Report designs vs reports
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Report designs are the blueprints. Reports are the generated outputs. Runs happen in the
          background; track progress in Jobs and download finished files in History.
        </Typography>
        {showChips && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              variant="outlined"
              icon={<DescriptionIcon fontSize="small" />}
              label="Designs = blueprint"
            />
            <Chip
              size="small"
              variant="outlined"
              icon={<WorkOutlineIcon fontSize="small" />}
              label="Jobs = progress"
            />
            <Chip
              size="small"
              variant="outlined"
              icon={<ArticleIcon fontSize="small" />}
              label="History = downloads"
            />
          </Stack>
        )}
      </Stack>
    </Alert>
  )
}

// === From: AiUsageNotice.jsx ===

export function AiUsageNotice({
  title = 'AI output',
  description,
  chips = [],
  severity = 'info',
  dense = false,
  sx,
}) {
  return (
    <Alert
      icon={<AutoAwesomeIcon fontSize="small" />}
      severity={severity}
      sx={{
        borderRadius: 1,  // Figma spec: 8px
        alignItems: 'flex-start',
        '& .MuiAlert-message': { width: '100%' },
        ...sx,
      }}
    >
      <Stack spacing={dense ? 0.5 : 0.75}>
        {title && (
          <Typography variant={dense ? 'subtitle2' : 'subtitle1'} fontWeight={600}>
            {title}
          </Typography>
        )}
        {description && (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        )}
        {chips.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {chips.map((chip, idx) => (
              <Chip
                key={`${chip.label}-${idx}`}
                size="small"
                label={chip.label}
                color={chip.color}
                variant={chip.variant || (chip.color ? 'filled' : 'outlined')}
                sx={chip.sx}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Alert>
  )
}
