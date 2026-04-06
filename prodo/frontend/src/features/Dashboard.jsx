import * as api from '@/api/client'
import * as recommendationsApi from '@/api/intelligence'
import { figmaSpacing, fontFamilyBody, fontFamilyHeading, neutral } from '@/app/theme'
import { SuccessCelebration, useCelebration, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { ReportGlossaryNotice } from '@/components/ux'
import { useAppStore } from '@/stores/app'
import { GlassCard, fadeInUp, glow, pulse, shimmer, spin } from '@/styles/styles'
import AddIcon from '@mui/icons-material/Add'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import AssessmentIcon from '@mui/icons-material/Assessment'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import BoltIcon from '@mui/icons-material/Bolt'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import DescriptionIcon from '@mui/icons-material/Description'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import InsightsIcon from '@mui/icons-material/Insights'
import KeyboardCommandKeyIcon from '@mui/icons-material/KeyboardCommandKey'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import RefreshIcon from '@mui/icons-material/Refresh'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import ScheduleIcon from '@mui/icons-material/Schedule'
import SpeedIcon from '@mui/icons-material/Speed'
import StarIcon from '@mui/icons-material/Star'
import StorageIcon from '@mui/icons-material/Storage'
import TableChartIcon from '@mui/icons-material/TableChart'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import WavingHandIcon from '@mui/icons-material/WavingHand'
import WorkIcon from '@mui/icons-material/Work'
import {
  Avatar,
  AvatarGroup,
  Box,
  Button,
  Chip,
  Collapse,
  Fade,
  Grow,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
const PageContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  maxWidth: 1600,
  margin: '0 auto',
  width: '100%',
  minHeight: '100vh',
  position: 'relative',

  // Subtle gradient background
  '&::before': {
    content: '""',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: theme.palette.mode === 'dark'
      ? `radial-gradient(ellipse at top left, ${alpha(theme.palette.text.primary, 0.04)} 0%, transparent 50%),
         radial-gradient(ellipse at bottom right, ${alpha(theme.palette.text.primary, 0.03)} 0%, transparent 50%)`
      : 'none',
    pointerEvents: 'none',
    zIndex: -1,
  },
}))

const StatCardStyled = styled(Box, {
  shouldForwardProp: (prop) => !['color', 'delay'].includes(prop),
})(({ theme, color = 'inherit', delay = 0 }) => ({
  position: 'relative',
  padding: theme.spacing(2.5),
  minHeight: 110,
  borderRadius: 8,
  // Figma: white cards, shadow-only, NO borders
  backgroundColor: theme.palette.mode === 'dark'
    ? alpha(theme.palette.background.paper, 0.6)
    : theme.palette.common.white,
  backdropFilter: 'none',
  border: 'none',
  boxShadow: theme.palette.mode === 'dark'
    ? 'none'
    : '0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.05)',
  cursor: 'pointer',
  overflow: 'hidden',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  animation: `${fadeInUp} 0.5s ease-out ${delay}ms both`,

  '&:hover': {
    boxShadow: theme.palette.mode === 'dark'
      ? '0 4px 12px rgba(0,0,0,0.3)'
      : '0 2px 8px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.06)',
  },
}))

const QuickActionCard = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1.5, 2),
  borderRadius: 8,
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',

  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : neutral[100],

    '& .action-arrow': {
      transform: 'translateX(4px)',
      opacity: 1,
    },

    '& .action-icon': {
      color: theme.palette.mode === 'dark' ? neutral[100] : neutral[900],
    },
  },
}))

const OnboardingStep = styled(Box, {
  shouldForwardProp: (prop) => !['completed', 'disabled'].includes(prop),
})(({ theme, completed, disabled }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  padding: theme.spacing(2),
  borderRadius: theme.shape.borderRadius * 1.5,
  backgroundColor: completed
    ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100])
    : alpha(theme.palette.action.hover, 0.3),
  border: `1px solid ${completed
    ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.15) : neutral[200])
    : alpha(theme.palette.divider, 0.1)}`,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',

  ...(!disabled && !completed && {
    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
      borderColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.15) : neutral[200],
      transform: 'translateX(4px)',
    },
  }),
}))

const JobListItem = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'status',
})(({ theme, status }) => {
  const statusColors = {
    completed: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    running: theme.palette.mode === 'dark' ? neutral[500] : neutral[500],
    pending: theme.palette.mode === 'dark' ? neutral[300] : neutral[500],
    failed: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  }

  return {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(1.5, 0),
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
    transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
    cursor: 'pointer',

    '&:last-child': {
      borderBottom: 'none',
    },

    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.02) : neutral[50],
      paddingLeft: theme.spacing(1),
      paddingRight: theme.spacing(1),
      marginLeft: theme.spacing(-1),
      marginRight: theme.spacing(-1),
      borderRadius: theme.shape.borderRadius,

      '& .job-arrow': {
        opacity: 1,
        transform: 'translateX(0)',
      },
    },

    '& .status-dot': {
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: statusColors[status] || neutral[500],
      boxShadow: `0 0 8px ${alpha(statusColors[status] || neutral[500], 0.3)}`,
    },
  }
})

const RecommendationCard = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2.5),
  borderRadius: theme.shape.borderRadius * 1.5,
  backgroundColor: theme.palette.mode === 'dark'
    ? alpha(theme.palette.background.paper, 0.4)
    : alpha(theme.palette.background.paper, 0.8),
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  cursor: 'pointer',
  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
  position: 'relative',
  overflow: 'hidden',

  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: theme.palette.mode === 'dark'
      ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.03)} 0%, transparent 50%)`
      : `linear-gradient(135deg, rgba(0,0,0,0.02) 0%, transparent 50%)`,
    opacity: 0,
    transition: 'opacity 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
  },

  '&:hover': {
    transform: 'translateY(-4px) scale(1.02)',
    boxShadow: theme.palette.mode === 'dark'
      ? `0 12px 24px ${alpha(theme.palette.common.black, 0.3)}`
      : '0 12px 24px rgba(0,0,0,0.08)',
    borderColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.15) : neutral[200],

    '&::before': {
      opacity: 1,
    },
  },
}))

const MiniChart = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-end',
  gap: 4,
  height: 50,
  padding: theme.spacing(1, 0),
}))

const ChartBar = styled(Box, {
  shouldForwardProp: (prop) => !['height', 'color', 'delay'].includes(prop),
})(({ theme, height, color, delay = 0 }) => ({
  flex: 1,
  height: `${height}%`,
  minHeight: 4,
  backgroundColor: color || (theme.palette.mode === 'dark' ? neutral[500] : neutral[700]),
  borderRadius: 1,  // Figma spec: 8px
  transition: 'height 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
  transitionDelay: `${delay}ms`,
}))


function StatCard({ title, value, subtitle, icon: Icon, color = 'inherit', onClick, trend, delay = 0 }) {
  const theme = useTheme()

  return (
    <StatCardStyled color={color} delay={delay} onClick={onClick}>
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
        <Box sx={{ flex: 1 }}>
          <Typography
            sx={{
              color: theme.palette.mode === 'dark' ? neutral[500] : neutral[400],  // Grey from Figma
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontSize: '12px',
            }}
          >
            {title}
          </Typography>
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: '1.5rem',
              mt: 0.5,
              mb: 0.5,
              // Solid dark color - NO gradient
              color: theme.palette.mode === 'dark' ? neutral[100] : neutral[900],
            }}
          >
            {value}
          </Typography>
          {subtitle && (
            <Typography sx={{ fontSize: '12px', color: theme.palette.mode === 'dark' ? neutral[500] : neutral[300] }}>
              {subtitle}
            </Typography>
          )}
          {trend !== undefined && (
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
              {trend >= 0 ? (
                <TrendingUpIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              ) : (
                <TrendingDownIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              )}
              <Typography
                sx={{
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  color: 'text.secondary',
                }}
              >
                {trend >= 0 ? '+' : ''}{trend}%
              </Typography>
            </Stack>
          )}
        </Box>
        <Box
          className="stat-icon"
          sx={{
            width: 48,
            height: 48,
            borderRadius: 1,  // Figma spec: 8px
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // Muted grey/neutral background for ALL icons - from Figma
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : neutral[100],
            color: theme.palette.mode === 'dark' ? neutral[500] : neutral[300],  // Muted grey icon
          }}
        >
          <Icon sx={{ fontSize: 24 }} />
        </Box>
      </Stack>
    </StatCardStyled>
  )
}

function getStatusIcon(status) {
  const iconProps = { sx: { fontSize: 18 } }
  switch (status) {
    case 'completed':
      return <CheckCircleOutlineIcon {...iconProps} sx={{ ...iconProps.sx, color: 'text.secondary' }} />
    case 'running':
      return <PlayArrowIcon {...iconProps} sx={{ ...iconProps.sx, color: 'text.secondary' }} />
    case 'pending':
      return <HourglassEmptyIcon {...iconProps} sx={{ ...iconProps.sx, color: 'text.secondary' }} />
    case 'failed':
      return <ErrorOutlineIcon {...iconProps} sx={{ ...iconProps.sx, color: 'text.secondary' }} />
    default:
      return <HourglassEmptyIcon {...iconProps} sx={{ ...iconProps.sx, color: 'text.secondary' }} />
  }
}


export default function DashboardPage() {
  const { execute } = useInteraction()
  const navigate = useNavigateInteraction()
  const toast = useToast()
  const theme = useTheme()
  const didLoadRef = useRef(false)
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { from: 'dashboard', ...intent } }),
    [navigate]
  )

  const templates = useAppStore((s) => s.templates)
  const savedConnections = useAppStore((s) => s.savedConnections)
  const activeConnection = useAppStore((s) => s.activeConnection)

  const [jobs, setJobs] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [favorites, setFavorites] = useState({ templates: [], connections: [] })
  const [recommendations, setRecommendations] = useState([])
  const [recLoading, setRecLoading] = useState(false)
  const [recFromAI, setRecFromAI] = useState(true)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('neurareport_onboarding_dismissed') !== 'true'
  })

  const { celebrating, celebrate, onComplete: onCelebrationComplete } = useCelebration()
  const celebratedRef = useRef(false)

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const [state, jobsData, analyticsData, favData] = await Promise.all([
        api.bootstrapState().catch(() => null),
        api.listJobs({ limit: 5 }).catch(() => ({ jobs: [] })),
        api.getDashboardAnalytics().catch(() => null),
        api.getFavorites().catch(() => ({ templates: [], connections: [] })),
      ])

      if (state?.templates) useAppStore.setState({ templates: state.templates })
      if (state?.connections) useAppStore.setState({ savedConnections: state.connections })

      setJobs(jobsData?.jobs || [])
      setAnalytics(analyticsData)
      setFavorites(favData)

      if (!state) toast.show('Failed to load some dashboard data. Try refreshing.', 'warning')
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err)
      toast.show('Failed to load dashboard data. Please try again.', 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [toast])

  useEffect(() => {
    if (didLoadRef.current) return
    didLoadRef.current = true
    fetchData()
  }, [fetchData])

  const handleRefresh = useCallback(
    () =>
      execute({
        type: InteractionType.EXECUTE,
        label: 'Refresh dashboard',
        reversibility: Reversibility.FULLY_REVERSIBLE,
        suppressSuccessToast: true,
        intent: { source: 'dashboard' },
        action: () => fetchData(true),
      }),
    [execute, fetchData]
  )

  const recAttemptedRef = useRef(false)

  const fetchRecommendations = useCallback(async () => {
    if (recLoading) return
    setRecLoading(true)
    recAttemptedRef.current = true

    const fallbackToLocal = () => {
      const topTpls = templates.slice(0, 4).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description || `${t.kind?.toUpperCase() || 'PDF'} design`,
        kind: t.kind,
        matchScore: 0.85,
      }))
      setRecommendations(topTpls)
      setRecFromAI(false)
    }

    try {
      const catalog = await recommendationsApi.getCatalog()
      const tpls = catalog?.catalog || catalog?.templates || catalog?.recommendations || []
      if (tpls.length > 0) {
        setRecommendations(tpls.slice(0, 4))
        setRecFromAI(true)
      } else if (templates.length > 0) {
        fallbackToLocal()
      }
    } catch {
      if (templates.length > 0) {
        fallbackToLocal()
      }
    } finally {
      setRecLoading(false)
    }
  }, [recLoading, templates])

  const handleRefreshRecommendations = useCallback(
    () =>
      execute({
        type: InteractionType.EXECUTE,
        label: 'Refresh recommendations',
        reversibility: Reversibility.FULLY_REVERSIBLE,
        suppressSuccessToast: true,
        intent: { source: 'dashboard', recFromAI },
        action: () => {
          recAttemptedRef.current = false
          return fetchRecommendations()
        },
      }),
    [execute, fetchRecommendations, recFromAI]
  )

  const handleOpenCommandPalette = useCallback(() => {
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Open command palette',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'dashboard' },
      action: () => {
        if (typeof window === 'undefined') return
        window.dispatchEvent(new CustomEvent('neura:open-command-palette'))
      },
    })
  }, [execute])

  useEffect(() => {
    if (recommendations.length === 0 && templates.length > 0 && !recLoading && !recAttemptedRef.current) {
      fetchRecommendations()
    }
  }, [templates.length, recommendations.length, recLoading, fetchRecommendations])

  const summary = analytics?.summary || {}
  const metrics = analytics?.metrics || {}
  const topTemplates = analytics?.topTemplates || []
  const jobsTrend = analytics?.jobsTrend || []
  const needsOnboarding = showOnboarding && (templates.length === 0 || savedConnections.length === 0)

  const allStepsComplete = savedConnections.length > 0 && templates.length > 0 && (metrics.jobsToday ?? 0) > 0
  useEffect(() => {
    if (allStepsComplete && showOnboarding && !celebratedRef.current) {
      celebratedRef.current = true
      celebrate()
    }
  }, [allStepsComplete, showOnboarding, celebrate])

  const handleDismissOnboarding = useCallback(() => {
    return execute({
      type: InteractionType.UPDATE,
      label: 'Dismiss onboarding',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'dashboard' },
      action: () => {
        setShowOnboarding(false)
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('neurareport_onboarding_dismissed', 'true')
        }
      },
    })
  }, [execute])

  const maxTrend = Math.max(...jobsTrend.map(d => d.total || 0), 1)

  return (
    <PageContainer>
      <SuccessCelebration trigger={celebrating} onComplete={onCelebrationComplete} />

      {/* ========== HEADER ========== */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
        spacing={3}
        sx={{ mb: 4 }}
      >
        <Box sx={{ animation: `${fadeInUp} 0.4s ease-out` }}>
          <Typography
            sx={{
              // FIGMA: Page Title - Tomorrow Medium 24px
              fontFamily: fontFamilyHeading,
              fontWeight: 500,
              fontSize: '24px',
              lineHeight: 'normal',
              letterSpacing: 0,
              mb: 0.5,
              color: theme.palette.mode === 'dark' ? neutral[100] : neutral[900],
            }}
          >
            Welcome back
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Generate intelligent reports from your data with AI-powered insights
          </Typography>
        </Box>

        <Stack
          direction="row"
          spacing={1.5}
          sx={{ animation: `${fadeInUp} 0.5s ease-out 100ms both` }}
        >
          <Tooltip title="Press ⌘K for quick actions">
            <IconButton
              onClick={handleOpenCommandPalette}
              aria-label="Open command palette"
              sx={{
                border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                bgcolor: alpha(theme.palette.background.paper, 0.5),
                backdropFilter: 'blur(8px)',
              }}
            >
              <KeyboardCommandKeyIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>

          <IconButton
            onClick={handleRefresh}
            disabled={refreshing}
            sx={{
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
              bgcolor: alpha(theme.palette.background.paper, 0.5),
              backdropFilter: 'blur(8px)',
            }}
          >
            <RefreshIcon
              sx={{
                fontSize: 20,
                animation: refreshing ? `${spin} 1s linear infinite` : 'none',
              }}
            />
          </IconButton>

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleNavigate('/pipeline', 'Open setup wizard')}
            sx={{
              px: 3,
              py: 1,
              borderRadius: '8px',
              fontWeight: 500,
              fontSize: '0.875rem',
              boxShadow: 'none',
              '&:hover': {
                boxShadow: 'none',
              },
            }}
          >
            New Report
          </Button>
        </Stack>
      </Stack>

      <ReportGlossaryNotice dense showChips={false} sx={{ mb: 3 }} />

      {/* ========== ONBOARDING ========== */}
      <Collapse in={needsOnboarding}>
        <GlassCard
          sx={{
            mb: 4,
            background: theme.palette.mode === 'dark'
              ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.05)} 0%, ${alpha(theme.palette.background.paper, 0.6)} 100%)`
              : undefined,
            animation: `${glow} 3s ease-in-out infinite`,
          }}
        >
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
            <Box
              sx={{
                width: { xs: '100%', md: 64 },
                height: 64,
                borderRadius: 1,  // Figma spec: 8px
                background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <RocketLaunchIcon sx={{ fontSize: 32, color: 'white' }} />
            </Box>

            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Welcome! Let's create your first report
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Complete these quick steps to get started with NeuraReport
              </Typography>

              <Stack spacing={1.5}>
                <OnboardingStep
                  completed={savedConnections.length > 0}
                  onClick={() => handleNavigate('/connections', 'Open connections')}
                >
                  {savedConnections.length > 0 ? (
                    <CheckCircleIcon sx={{ fontSize: 24, color: 'text.secondary' }} />
                  ) : (
                    <RadioButtonUncheckedIcon sx={{ fontSize: 24, color: 'text.secondary' }} />
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Add a data source
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Connect to where your data lives (database, spreadsheet)
                    </Typography>
                  </Box>
                  {savedConnections.length > 0 && (
                    <Chip label="Done" size="small" sx={{ fontWeight: 600, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }} />
                  )}
                </OnboardingStep>

                <OnboardingStep
                  completed={templates.length > 0}
                  onClick={() => handleNavigate('/templates', 'Open templates')}
                >
                  {templates.length > 0 ? (
                    <CheckCircleIcon sx={{ fontSize: 24, color: 'text.secondary' }} />
                  ) : (
                    <RadioButtonUncheckedIcon sx={{ fontSize: 24, color: 'text.secondary' }} />
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Add a report design
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Upload a PDF or Excel design that shows how reports should look
                    </Typography>
                  </Box>
                  {templates.length > 0 && (
                    <Chip label="Done" size="small" sx={{ fontWeight: 600, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }} />
                  )}
                </OnboardingStep>

                <OnboardingStep
                  completed={(metrics.jobsToday ?? 0) > 0}
                  disabled={savedConnections.length === 0 || templates.length === 0}
                  onClick={() => {
                    if (savedConnections.length > 0 && templates.length > 0) {
                      handleNavigate('/reports', 'Open reports')
                    }
                  }}
                >
                  {(metrics.jobsToday ?? 0) > 0 ? (
                    <CheckCircleIcon sx={{ fontSize: 24, color: 'text.secondary' }} />
                  ) : (
                    <RadioButtonUncheckedIcon sx={{ fontSize: 24, color: 'text.secondary' }} />
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle2" fontWeight={600}>
                      Create your first report
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Generate a report using your data and design
                    </Typography>
                  </Box>
                  {(metrics.jobsToday ?? 0) > 0 && (
                    <Chip label="Done" size="small" sx={{ fontWeight: 600, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }} />
                  )}
                </OnboardingStep>
              </Stack>

              <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
                <Button
                  variant="contained"
                  onClick={() => handleNavigate('/pipeline', 'Open setup wizard')}
                  startIcon={<BoltIcon />}
                  sx={{ borderRadius: 1 }}
                >
                  Run Setup Wizard
                </Button>
                <Button
                  variant="text"
                  onClick={handleDismissOnboarding}
                  sx={{ color: 'text.secondary' }}
                >
                  Dismiss
                </Button>
              </Stack>
            </Box>
          </Stack>
        </GlassCard>
      </Collapse>

      {/* ========== STATS GRID ========== */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            md: 'repeat(3, 1fr)',
            lg: 'repeat(5, 1fr)',
          },
          gap: 2.5,
          mb: 4,
        }}
      >
        <StatCard
          title="Connections"
          value={summary.totalConnections ?? savedConnections.length}
          subtitle={`${summary.activeConnections ?? 0} active`}
          icon={StorageIcon}
          onClick={() => handleNavigate('/connections', 'Open connections')}
          delay={0}
        />
        <StatCard
          title="Templates"
          value={summary.totalTemplates ?? templates.length}
          subtitle={`${summary.pdfTemplates ?? 0} PDF, ${summary.excelTemplates ?? 0} Excel`}
          icon={DescriptionIcon}
          onClick={() => handleNavigate('/templates', 'Open templates')}
          delay={50}
        />
        <StatCard
          title="Jobs Today"
          value={metrics.jobsToday ?? 0}
          subtitle={`${metrics.jobsThisWeek ?? 0} this week`}
          icon={WorkIcon}
          onClick={() => handleNavigate('/jobs', 'Open jobs')}
          delay={100}
        />
        <StatCard
          title="Success Rate"
          value={`${metrics.successRate ?? 0}%`}
          subtitle={`${summary.completedJobs ?? 0} completed`}
          icon={SpeedIcon}
          onClick={() => handleNavigate('/stats', 'Open usage stats')}
          trend={metrics.successRateTrend}
          delay={150}
        />
        <StatCard
          title="Schedules"
          value={summary.totalSchedules ?? 0}
          subtitle={`${summary.activeSchedules ?? 0} active`}
          icon={ScheduleIcon}
          onClick={() => handleNavigate('/schedules', 'Open schedules')}
          delay={200}
        />
      </Box>

      {/* ========== MAIN CONTENT GRID ========== */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '320px 1fr 300px' },
          gap: 3,
        }}
      >
        {/* Quick Actions */}
        <GlassCard sx={{ animationDelay: '200ms' }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2.5 }}>
            Quick Actions
          </Typography>
          <Stack spacing={1}>
            {[
              { label: 'Manage Connections', icon: StorageIcon, path: '/connections' },
              { label: 'Report Designs', icon: DescriptionIcon, path: '/templates' },
              { label: 'Run Reports', icon: AssessmentIcon, path: '/reports' },
              { label: 'Manage Schedules', icon: ScheduleIcon, path: '/schedules' },
            ].map((action) => (
              <QuickActionCard key={action.path} onClick={() => handleNavigate(action.path, `Open ${action.label}`)}>
                <action.icon className="action-icon" sx={{ fontSize: 20, color: 'text.secondary', transition: 'color 0.2s cubic-bezier(0.22, 1, 0.36, 1)' }} />
                <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>
                  {action.label}
                </Typography>
                <ArrowForwardIcon
                  className="action-arrow"
                  sx={{
                    fontSize: 16,
                    color: 'text.tertiary',
                    opacity: 0,
                    transform: 'translateX(-4px)',
                    transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                />
              </QuickActionCard>
            ))}
          </Stack>

          {/* Mini Chart */}
          {jobsTrend.length > 0 && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Jobs This Week
              </Typography>
              <MiniChart sx={{ mt: 1 }}>
                {jobsTrend.map((item, idx) => (
                  <Tooltip key={idx} title={`${item.label}: ${item.total} jobs`} arrow>
                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <ChartBar
                        height={Math.max(10, (item.total / maxTrend) * 100)}
                        color={item.failed > 0
                          ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900])
                          : (theme.palette.mode === 'dark' ? neutral[500] : neutral[700])}
                        delay={idx * 50}
                      />
                      <Typography variant="caption" sx={{ fontSize: '10px', color: 'text.tertiary', mt: 0.5 }}>
                        {item.label}
                      </Typography>
                    </Box>
                  </Tooltip>
                ))}
              </MiniChart>
            </Box>
          )}
        </GlassCard>

        {/* Recent Jobs */}
        <GlassCard sx={{ animationDelay: '250ms' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              Recent Jobs
            </Typography>
            <Button
              size="small"
              onClick={() => handleNavigate('/jobs', 'Open jobs')}
              sx={{ fontWeight: 600, fontSize: '0.75rem' }}
            >
              View All
            </Button>
          </Stack>

          {loading ? (
            <Stack spacing={1.5}>
              {[1, 2, 3, 4, 5].map((i) => (
                <Box
                  key={i}
                  sx={{
                    height: 48,
                    borderRadius: 1.5,
                    background: `linear-gradient(90deg, ${alpha(theme.palette.action.hover, 0.5)} 25%, ${alpha(theme.palette.action.hover, 0.8)} 50%, ${alpha(theme.palette.action.hover, 0.5)} 75%)`,
                    backgroundSize: '200% 100%',
                    animation: `${shimmer} 1.5s ease-in-out infinite`,
                  }}
                />
              ))}
            </Stack>
          ) : jobs.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Box
                sx={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mx: 'auto',
                  mb: 2,
                }}
              >
                <WorkIcon sx={{ fontSize: 28, color: 'text.secondary' }} />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No jobs yet. Run your first report to get started.
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={() => handleNavigate('/pipeline', 'Open setup wizard')}
                sx={{ borderRadius: 1 }}
              >
                Run First Report
              </Button>
            </Box>
          ) : (
            <Stack>
              {jobs.slice(0, 5).map((job, index) => (
                <Grow key={job.id} in timeout={300 + index * 100}>
                  <JobListItem
                    status={job.status}
                    data-testid={`dashboard-job-${job.id}`}
                    onClick={() =>
                      handleNavigate('/jobs', 'Open jobs', { jobId: job.id })
                    }
                  >
                    <Box className="status-dot" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {job.template_name || job.templateName || job.template_id?.slice(0, 12)}
                      </Typography>
                      <Typography variant="caption" color="text.tertiary">
                        {new Date(job.created_at || job.createdAt).toLocaleString()}
                      </Typography>
                    </Box>
                    <Chip
                      label={job.status}
                      size="small"
                      data-testid={`job-status-${job.status}`}
                      sx={{
                        height: 24,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        fontSize: '12px',
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
                        color: 'text.secondary',
                      }}
                    />
                    <ArrowForwardIcon
                      className="job-arrow"
                      sx={{
                        fontSize: 16,
                        color: 'text.tertiary',
                        opacity: 0,
                        transform: 'translateX(-4px)',
                        transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    />
                  </JobListItem>
                </Grow>
              ))}
            </Stack>
          )}
        </GlassCard>

        {/* Right Sidebar */}
        <Stack spacing={3}>
          {/* Top Designs */}
          <GlassCard sx={{ animationDelay: '300ms' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <InsightsIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Typography variant="subtitle2" fontWeight={600}>
                Top Designs
              </Typography>
            </Stack>

            {topTemplates.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No design usage data yet
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {topTemplates.slice(0, 4).map((tpl, idx) => (
                  <Stack
                    key={tpl.id}
                    direction="row"
                    alignItems="center"
                    spacing={1.5}
                    onClick={() =>
                      handleNavigate(`/reports?template=${tpl.id}`, 'Open reports', { templateId: tpl.id })
                    }
                    sx={{
                      cursor: 'pointer',
                      p: 1,
                      mx: -1,
                      borderRadius: 1.5,
                      transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
                      '&:hover': {
                        bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[100],
                      },
                    }}
                  >
                    <Avatar
                      sx={{
                        width: 32,
                        height: 32,
                        bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                        fontSize: '0.75rem',
                      }}
                    >
                      {tpl.kind === 'excel' ? (
                        <TableChartIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      ) : (
                        <PictureAsPdfIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      )}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {tpl.name}
                      </Typography>
                      <Typography variant="caption" color="text.tertiary">
                        {tpl.runCount} runs
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            )}
          </GlassCard>

          {/* Favorites */}
          <GlassCard sx={{ animationDelay: '350ms' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <StarIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Typography variant="subtitle2" fontWeight={600}>
                Favorites
              </Typography>
            </Stack>

            {favorites.templates.length === 0 && favorites.connections.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No favorites yet. Star designs or connections for quick access.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {favorites.templates.slice(0, 3).map((tpl) => (
                  <Stack
                    key={tpl.id}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                      cursor: 'pointer',
                      p: 0.75,
                      mx: -0.75,
                      borderRadius: 1,
                      '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.5) },
                    }}
                    onClick={() =>
                      handleNavigate(`/reports?template=${tpl.id}`, 'Open reports', { templateId: tpl.id })
                    }
                  >
                    <DescriptionIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                      {tpl.name}
                    </Typography>
                  </Stack>
                ))}
                {favorites.connections.slice(0, 2).map((conn) => (
                  <Stack
                    key={conn.id}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                      cursor: 'pointer',
                      p: 0.75,
                      mx: -0.75,
                      borderRadius: 1,
                      '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.5) },
                    }}
                    onClick={() => handleNavigate('/connections', 'Open connections')}
                  >
                    <StorageIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                      {conn.name}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </GlassCard>
        </Stack>
      </Box>

      {/* ========== AI RECOMMENDATIONS ========== */}
      <GlassCard
        sx={{
          mt: 4,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.04)} 0%, ${alpha(theme.palette.background.paper, 0.6)} 100%)`
            : undefined,
          animationDelay: '400ms',
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 1,  // Figma spec: 8px
                background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AutoAwesomeIcon sx={{ fontSize: 24, color: 'white' }} />
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                {recFromAI ? 'AI Recommendations' : 'Recent Designs'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {recFromAI ? 'Smart design suggestions based on your data' : 'Showing your recent designs (AI unavailable)'}
              </Typography>
            </Box>
          </Stack>
          <Button
            size="small"
            startIcon={<LightbulbIcon sx={{ fontSize: 16 }} />}
            onClick={handleRefreshRecommendations}
            disabled={recLoading}
            sx={{ fontWeight: 600 }}
          >
            {recLoading ? 'Loading...' : recFromAI ? 'Refresh' : 'Try AI Again'}
          </Button>
        </Stack>

        {recLoading ? (
          <Box
            sx={{
              height: 120,
              borderRadius: 1,  // Figma spec: 8px
              background: `linear-gradient(90deg, ${alpha(theme.palette.action.hover, 0.5)} 25%, ${alpha(theme.palette.action.hover, 0.8)} 50%, ${alpha(theme.palette.action.hover, 0.5)} 75%)`,
              backgroundSize: '200% 100%',
              animation: `${shimmer} 1.5s ease-in-out infinite`,
            }}
          />
        ) : recommendations.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
              }}
            >
              <LightbulbIcon sx={{ fontSize: 28, color: 'text.secondary' }} />
            </Box>
            {templates.length === 0 ? (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Upload a report design to unlock AI recommendations
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => handleNavigate('/templates', 'Open templates')}
                  startIcon={<AddIcon />}
                  sx={{ borderRadius: 1 }}
                >
                  Add Report Design
                </Button>
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  No recommendations yet
                </Typography>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleRefreshRecommendations}
                  sx={{ borderRadius: 1 }}
                >
                  Get AI Recommendations
                </Button>
              </>
            )}
          </Box>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
              gap: 2,
            }}
          >
            {recommendations.map((rec, idx) => (
              <Grow key={rec.id} in timeout={400 + idx * 100}>
                <RecommendationCard
                  onClick={() =>
                    handleNavigate(`/reports?template=${rec.id}`, 'Open reports', { templateId: rec.id })
                  }
                >
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                    <Avatar
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                      }}
                    >
                      {rec.kind === 'excel' ? (
                        <TableChartIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      ) : (
                        <PictureAsPdfIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                      )}
                    </Avatar>
                    {rec.matchScore && (
                      <Chip
                        label={`${Math.round((rec.matchScore || 0) * 100)}% match`}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '10px',
                          fontWeight: 600,
                          bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
                          color: 'text.secondary',
                        }}
                      />
                    )}
                  </Stack>
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ mb: 0.5 }}>
                    {rec.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      lineHeight: 1.4,
                    }}
                  >
                    {rec.description}
                  </Typography>
                </RecommendationCard>
              </Grow>
            ))}
          </Box>
        )}
      </GlassCard>

      {/* ========== ACTIVE CONNECTION ========== */}
      {activeConnection && (
        <Fade in>
          <GlassCard sx={{ mt: 3, animationDelay: '450ms' }}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Avatar
                sx={{
                  width: 48,
                  height: 48,
                  bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                }}
              >
                <StorageIcon sx={{ color: 'text.secondary' }} />
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle2" fontWeight={600}>
                  Connected to {activeConnection.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {activeConnection.db_type}
                  {activeConnection.summary && ` • ${activeConnection.summary}`}
                </Typography>
              </Box>
              <Chip
                label="Active"
                size="small"
                sx={{
                  fontWeight: 600,
                  animation: `${pulse} 2s ease-in-out infinite`,
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
                  color: 'text.secondary',
                }}
              />
            </Stack>
          </GlassCard>
        </Fade>
      )}
    </PageContainer>
  )
}
