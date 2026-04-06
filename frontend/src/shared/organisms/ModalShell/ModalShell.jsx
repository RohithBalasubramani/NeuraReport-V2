import { neutral } from '@/app/theme'
import { slideUp } from '@/styles/styles'
import {
  Close as CloseIcon,
} from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer as MuiDrawer,
  Fade,
  IconButton,
  Stack,
  Typography,
  alpha,
  keyframes,
  styled,
  useTheme,
} from '@mui/material'

const StyledDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiBackdrop-root': {
    backgroundColor: alpha(theme.palette.common.black, 0.6),
    backdropFilter: 'blur(8px)',
  },
}))

const DialogPaper = styled(Box)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.95),
  backdropFilter: 'blur(20px)',
  border: `1px solid ${alpha(theme.palette.divider, 0.25)}`,
  borderRadius: 8,
  boxShadow: `
    0 0 0 1px ${alpha(theme.palette.common.white, 0.05)} inset,
    0 24px 64px ${alpha(theme.palette.common.black, 0.25)},
    0 8px 32px ${alpha(theme.palette.common.black, 0.15)}
  `,
  animation: `${slideUp} 0.3s ease-out`,
  overflow: 'hidden',
  position: 'relative',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    background: `linear-gradient(180deg, ${alpha(theme.palette.text.primary, 0.02)} 0%, transparent 100%)`,
    pointerEvents: 'none',
  },
}))

const StyledDialogTitle = styled(DialogTitle)(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: theme.spacing(3),
  position: 'relative',
  zIndex: 1,
}))

const TitleText = styled(Typography)(({ theme }) => ({
  fontSize: '1.25rem',
  fontWeight: 600,
  color: theme.palette.text.primary,
  letterSpacing: '-0.02em',
}))

const SubtitleText = styled(Typography)(({ theme }) => ({
  fontSize: '0.875rem',
  color: theme.palette.text.secondary,
  marginTop: theme.spacing(0.5),
}))

const CloseButton = styled(IconButton)(({ theme }) => ({
  width: 32,
  height: 32,
  borderRadius: 8,
  color: theme.palette.text.secondary,
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
    color: theme.palette.text.primary,
    transform: 'rotate(90deg)',
  },
}))

const StyledDialogContent = styled(DialogContent)(({ theme }) => ({
  padding: theme.spacing(0, 3, 3),
  position: 'relative',
  zIndex: 1,
}))

const StyledDivider = styled(Divider)(({ theme }) => ({
  borderColor: alpha(theme.palette.divider, 0.25),
  margin: theme.spacing(0, 3),
}))

const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
  padding: theme.spacing(2.5, 3),
  gap: theme.spacing(1.5),
  backgroundColor: alpha(theme.palette.background.paper, 0.3),
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
}))

const CancelButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.875rem',
  padding: theme.spacing(1, 2.5),
  color: theme.palette.text.secondary,
  borderColor: alpha(theme.palette.divider, 0.2),
  transition: 'all 0.2s ease',
  '&:hover': {
    borderColor: alpha(theme.palette.text.primary, 0.3),
    backgroundColor: alpha(theme.palette.text.primary, 0.04),
  },
}))

const ConfirmButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 600,
  fontSize: '0.875rem',
  padding: theme.spacing(1, 2.5),
  transition: 'all 0.2s ease',
  '&.primary': {
    background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
    color: theme.palette.common.white,
    boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
    '&:hover': {
      background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
      boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
      transform: 'translateY(-1px)',
    },
    '&:active': {
      transform: 'translateY(0)',
    },
  },
  '&.error': {
    background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
    color: theme.palette.common.white,
    boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
    '&:hover': {
      background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
      boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
      transform: 'translateY(-1px)',
    },
  },
}))

const LoadingSpinner = styled(CircularProgress)(() => ({
  color: 'inherit',
}))

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions,
  maxWidth = 'sm',
  fullWidth = true,
  loading = false,
  hideCloseButton = false,
  dividers = true,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  confirmDisabled = false,
  confirmColor = 'primary',
  confirmVariant = 'contained',
}) {
  const theme = useTheme()

  const handleCancel = () => {
    onCancel?.()
    onClose()
  }

  return (
    <StyledDialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      TransitionComponent={Fade}
      TransitionProps={{ timeout: 200 }}
      PaperComponent={DialogPaper}
    >
      <StyledDialogTitle>
        <Box>
          <TitleText>{title}</TitleText>
          {subtitle && <SubtitleText>{subtitle}</SubtitleText>}
        </Box>
        {!hideCloseButton && (
          <CloseButton onClick={onClose} size="small" aria-label="Close dialog">
            <CloseIcon sx={{ fontSize: 18 }} />
          </CloseButton>
        )}
      </StyledDialogTitle>

      {dividers && <StyledDivider />}

      <StyledDialogContent>{children}</StyledDialogContent>

      {(actions || onConfirm) && (
        <StyledDialogActions>
          {actions || (
            <>
              <CancelButton variant="outlined" onClick={handleCancel} disabled={loading}>
                {cancelLabel}
              </CancelButton>
              <ConfirmButton
                variant={confirmVariant}
                className={confirmColor}
                onClick={onConfirm}
                disabled={confirmDisabled || loading}
                startIcon={loading ? <LoadingSpinner size={16} /> : null}
              >
                {confirmLabel}
              </ConfirmButton>
            </>
          )}
        </StyledDialogActions>
      )}
    </StyledDialog>
  )
}

// Drawer component

const drawerFadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  anchor = 'right',
  width = 480,
  actions,
  loading = false,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  confirmDisabled = false,
}) {
  const theme = useTheme()

  const handleCancel = () => {
    onCancel?.()
    onClose()
  }

  return (
    <MuiDrawer
      anchor={anchor}
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: width },
          maxWidth: '100%',
          bgcolor: alpha(theme.palette.background.paper, 0.98),
          backdropFilter: 'blur(20px)',
          borderLeft: `1px solid ${alpha(theme.palette.divider, 0.25)}`,
          boxShadow: `0 0 64px ${alpha(theme.palette.common.black, 0.25)}`,
        },
      }}
      slotProps={{
        backdrop: {
          sx: {
            bgcolor: alpha(theme.palette.common.black, 0.5),
            backdropFilter: 'blur(4px)',
          },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          animation: `${drawerFadeIn} 0.3s ease-out`,
        }}
      >
        {/* Header */}
        <Box
          sx={{
            px: 3,
            py: 2.5,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
          }}
        >
          <Box>
            <Typography
              sx={{
                fontSize: '1.125rem',
                fontWeight: 600,
                color: theme.palette.text.primary,
                letterSpacing: '-0.01em',
              }}
            >
              {title}
            </Typography>
            {subtitle && (
              <Typography
                sx={{
                  fontSize: '14px',
                  color: theme.palette.text.secondary,
                  mt: 0.5,
                }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>
          <IconButton
            onClick={onClose}
            size="small"
            sx={{
              color: theme.palette.text.secondary,
              borderRadius: 1,
              transition: 'all 0.2s ease',
              '&:hover': {
                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                color: theme.palette.text.primary,
                transform: 'rotate(90deg)',
              },
            }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        {/* Content */}
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            p: 3,
            bgcolor: alpha(theme.palette.background.default, 0.5),
          }}
        >
          {children}
        </Box>

        {/* Footer Actions */}
        {(actions || onConfirm) && (
          <Box
            sx={{
              px: 3,
              py: 2.5,
              borderTop: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
              bgcolor: theme.palette.background.paper,
            }}
          >
            {actions || (
              <Stack direction="row" spacing={1.5} justifyContent="flex-end">
                <Button
                  variant="outlined"
                  onClick={handleCancel}
                  disabled={loading}
                  sx={{
                    borderRadius: 1,
                    textTransform: 'none',
                    fontWeight: 500,
                    color: theme.palette.text.secondary,
                    borderColor: alpha(theme.palette.divider, 0.2),
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      borderColor: alpha(theme.palette.text.primary, 0.3),
                      bgcolor: alpha(theme.palette.text.primary, 0.05),
                    },
                  }}
                >
                  {cancelLabel}
                </Button>
                <Button
                  variant="contained"
                  onClick={onConfirm}
                  disabled={confirmDisabled || loading}
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
                  sx={{
                    borderRadius: 1,
                    textTransform: 'none',
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                    boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                      boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
                      transform: 'translateY(-1px)',
                    },
                    '&:active': {
                      transform: 'translateY(0)',
                    },
                  }}
                >
                  {confirmLabel}
                </Button>
              </Stack>
            )}
          </Box>
        )}
      </Box>
    </MuiDrawer>
  )
}
