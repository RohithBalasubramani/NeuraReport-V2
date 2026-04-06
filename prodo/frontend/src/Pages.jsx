import { neutral, palette } from '@/app/theme'
import { useInteraction } from '@/components/governance'
import TemplateEditorContainer from '@/report-generator'
import SetupWizardContainer from '@/features/Setup.jsx'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import HomeIcon from '@mui/icons-material/Home'
import SearchOffIcon from '@mui/icons-material/SearchOff'
import { Box, Button, Stack, Typography, alpha } from '@mui/material'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
export function TemplateEditor() {
  useInteraction()
  return <TemplateEditorContainer />
}

// === From: SetupWizard.jsx ===

export function SetupWizard() {
  useInteraction()
  return <SetupWizardContainer />
}

// === From: NotFoundPage.jsx ===
/**
 * 404 Not Found Page
 * Displayed when a user navigates to an unknown route.
 */

export function NotFoundPage() {
  const navigate = useNavigate()

  const handleGoHome = useCallback(() => navigate('/'), [navigate])
  const handleGoBack = useCallback(() => navigate(-1), [navigate])

  return (
    <Box
      sx={{
        minHeight: 'calc(100vh - 64px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 3,
      }}
    >
      <Box
        sx={{
          maxWidth: 480,
          textAlign: 'center',
          p: 4,
          bgcolor: 'background.paper',
          borderRadius: 4,
          border: 1,
          borderColor: 'divider',
          boxShadow: (theme) => `0 8px 32px ${alpha(theme.palette.common.black, 0.15)}`,
        }}
      >
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? alpha(theme.palette.text.primary, 0.08)
                : neutral[100],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            mx: 'auto',
            mb: 3,
          }}
        >
          <SearchOffIcon sx={{ fontSize: 36, color: 'text.secondary' }} />
        </Box>

        <Typography
          variant="h4"
          sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5 }}
        >
          404
        </Typography>

        <Typography
          variant="h6"
          sx={{ fontWeight: 600, color: 'text.primary', mb: 1.5 }}
        >
          Page not found
        </Typography>

        <Typography
          sx={{ color: 'text.secondary', mb: 3, fontSize: '0.875rem' }}
        >
          The page you're looking for doesn't exist or has been moved.
        </Typography>

        <Stack direction="row" spacing={2} justifyContent="center">
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={handleGoBack}
            sx={{
              borderRadius: 1,
              textTransform: 'none',
              fontWeight: 500,
              borderColor: 'divider',
              color: 'text.secondary',
              '&:hover': {
                borderColor: 'text.primary',
                bgcolor: (theme) => alpha(theme.palette.text.primary, 0.05),
              },
            }}
          >
            Go Back
          </Button>
          <Button
            variant="contained"
            startIcon={<HomeIcon />}
            onClick={handleGoHome}
            sx={{
              borderRadius: 1,
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            Go to Dashboard
          </Button>
        </Stack>
      </Box>
    </Box>
  )
}
