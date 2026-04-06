import { neutral } from '@/app/theme'
import { bounce, shake } from '@/styles/styles'
import {
  CheckCircleOutline as SuccessIcon,
  ErrorOutline as ErrorIcon,
  HelpOutline as QuestionIcon,
  InfoOutlined as InfoIcon,
  WarningAmber as WarningIcon,
} from '@mui/icons-material'
import {
  Box,
  Stack,
  Typography,
  alpha,
  keyframes,
  useTheme,
} from '@mui/material'
import { useEffect, useRef } from 'react'
import { Modal } from '@/shared/organisms/ModalShell'

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.2); opacity: 0.8; }
`

const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`

const IconContainer = Box

const MessageText = Typography

const getSeverityConfig = (theme, severity) => {
  const neutralColor = theme.palette.text.secondary
  const neutralBg = theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100]
  const configs = {
    warning: {
      icon: WarningIcon,
      color: neutralColor,
      bgColor: neutralBg,
    },
    error: {
      icon: ErrorIcon,
      color: neutralColor,
      bgColor: neutralBg,
    },
    info: {
      icon: InfoIcon,
      color: neutralColor,
      bgColor: neutralBg,
    },
    success: {
      icon: SuccessIcon,
      color: neutralColor,
      bgColor: neutralBg,
    },
    question: {
      icon: QuestionIcon,
      color: neutralColor,
      bgColor: neutralBg,
    },
  }
  return configs[severity] || configs.warning
}

const PREF_KEY = 'neurareport_preferences'

const getDeletePreference = () => {
  if (typeof window === 'undefined') return { confirmDelete: true }
  try {
    const raw = window.localStorage.getItem(PREF_KEY)
    if (!raw) return { confirmDelete: true }
    const parsed = JSON.parse(raw)
    return { confirmDelete: parsed?.confirmDelete ?? true }
  } catch {
    return { confirmDelete: true }
  }
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  severity = 'warning',
  loading = false,
}) {
  const theme = useTheme()
  const config = getSeverityConfig(theme, severity)
  const Icon = config.icon
  const confirmColor = severity === 'error' ? 'error' : 'primary'
  const autoConfirmRef = useRef(false)
  const isDeleteAction = `${title} ${confirmLabel}`.toLowerCase().includes('delete')

  useEffect(() => {
    if (!open) {
      autoConfirmRef.current = false
      return
    }
    if (!isDeleteAction || autoConfirmRef.current) return
    const prefs = getDeletePreference()
    if (prefs.confirmDelete === false) {
      autoConfirmRef.current = true
      onConfirm?.()
      onClose?.()
    }
  }, [open, isDeleteAction, onConfirm, onClose])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="xs"
      onConfirm={onConfirm}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      confirmColor={confirmColor}
      loading={loading}
      dividers={false}
    >
      <Stack spacing={3} alignItems="center" textAlign="center" sx={{ py: 2 }}>
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: '20px',
            backgroundColor: config.bgColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            animation: severity === 'error' ? `${shake} 0.5s ease-in-out` : `${bounce} 0.5s ease-in-out`,
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: -8,
              borderRadius: '28px',
              background: config.bgColor,
              opacity: 0.3,
              animation: `${pulse} 2s infinite ease-in-out`,
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              inset: -1,
              borderRadius: '21px',
              padding: 1,
              background: `linear-gradient(135deg, ${alpha(theme.palette.common.white, 0.2)}, transparent)`,
              WebkitMask: `linear-gradient(${theme.palette.common.white} 0 0) content-box, linear-gradient(${theme.palette.common.white} 0 0)`,
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
              pointerEvents: 'none',
            },
          }}
        >
          <Icon sx={{ fontSize: 32, color: config.color, position: 'relative', zIndex: 1 }} />
        </Box>
        <Typography
          sx={{
            fontSize: '0.875rem',
            color: theme.palette.text.secondary,
            lineHeight: 1.6,
            maxWidth: 320,
            animation: `${fadeInUp} 0.4s ease-out 0.1s both`,
          }}
        >
          {message}
        </Typography>
      </Stack>
    </Modal>
  )
}
