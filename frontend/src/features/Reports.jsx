import * as api from '@/api/client'
import * as summaryApi from '@/api/intelligence'
import { queueRecommendTemplates, recommendTemplates } from '@/api/client'
import { neutral, palette } from '@/app/theme'
import { ConnectionSelector, PageHeader, SuccessCelebration, useCelebration, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { AiUsageNotice } from '@/components/ux'
import { FeedbackPanel } from '@/features/Utility'
import { PipelineVisualization } from '@/features/Monitoring'
import { useAppStore } from '@/stores/app'
import { usePipelineRunStore } from '@/stores/workspace'
import { GlassCard, StyledFormControl, fadeInUp } from '@/styles/styles'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import ArticleIcon from '@mui/icons-material/Article'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import CheckIcon from '@mui/icons-material/Check'
import DateRangeIcon from '@mui/icons-material/DateRange'
import DescriptionIcon from '@mui/icons-material/Description'
import DownloadIcon from '@mui/icons-material/Download'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FilterListIcon from '@mui/icons-material/FilterList'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import ScheduleIcon from '@mui/icons-material/Schedule'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import TableChartIcon from '@mui/icons-material/TableChart'
import TodayIcon from '@mui/icons-material/Today'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Container,
  Divider,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
/** Compose date+time for the API. Returns "YYYY-MM-DD HH:MM" when time is set, "YYYY-MM-DD" otherwise. */
const composeDateTimeString = (dateStr, timeStr) => {
  if (!dateStr) return ''
  if (!timeStr) return dateStr
  return `${dateStr} ${timeStr}`
}

const KIND_ICONS = {
  pdf: PictureAsPdfIcon,
  excel: TableChartIcon,
}

const KIND_COLORS = {
  pdf: 'error',
  excel: 'success',
}

function TemplateRecommender({ onSelectTemplate }) {
  const { execute } = useInteraction()
  const [expanded, setExpanded] = useState(false)
  const [requirement, setRequirement] = useState('')
  const [loading, setLoading] = useState(false)
  const [queueing, setQueueing] = useState(false)
  const [recommendations, setRecommendations] = useState([])
  const [error, setError] = useState(null)
  const toast = useToast()

  const executeUI = useCallback(
    (label, action, intent = {}) =>
      execute({
        type: InteractionType.EXECUTE,
        label,
        reversibility: Reversibility.FULLY_REVERSIBLE,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: { source: 'template_recommender', ...intent },
        action,
      }),
    [execute]
  )

  const handleSearch = useCallback(() => {
    const trimmed = requirement.trim()
    if (!trimmed) return undefined

    return execute({
      type: InteractionType.ANALYZE,
      label: 'Recommend templates',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'template_recommender', action: 'recommend_templates', requirement: trimmed },
      action: async () => {
        setLoading(true)
        setError(null)
        setRecommendations([])

        try {
          const results = await recommendTemplates({
            requirement: trimmed,
            limit: 5,
          })
          const normalized = Array.isArray(results) ? results : []
          setRecommendations(normalized)
          if (!normalized.length) {
            setError('No matching templates found. Try a different description.')
          }
          return normalized
        } catch (err) {
          setError(err.message || 'Failed to get recommendations')
          throw err
        } finally {
          setLoading(false)
        }
      },
    })
  }, [execute, requirement])

  const handleQueue = useCallback(() => {
    const trimmed = requirement.trim()
    if (!trimmed) return undefined

    return execute({
      type: InteractionType.GENERATE,
      label: 'Queue template recommendations',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'template_recommender', action: 'queue_recommendations', requirement: trimmed },
      action: async () => {
        setQueueing(true)
        setError(null)
        try {
          const response = await queueRecommendTemplates({
            requirement: trimmed,
            limit: 5,
          })
          if (response?.job_id) {
            toast.show('Recommendation job queued. Track it in Jobs.', 'success')
          } else {
            toast.show('Failed to queue recommendation job.', 'error')
          }
          return response
        } catch (err) {
          toast.show(err.message || 'Failed to queue recommendations', 'error')
          throw err
        } finally {
          setQueueing(false)
        }
      },
    })
  }, [execute, requirement, toast])

  const handleSelect = useCallback(
    (template) =>
      executeUI(
        'Select recommended template',
        () => {
          onSelectTemplate?.(template)
          setExpanded(false)
        },
        { templateId: template?.id }
      ),
    [executeUI, onSelectTemplate]
  )

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSearch()
      }
    },
    [handleSearch]
  )

  return (
    <Paper
      sx={{
        border: 1,
        borderColor: 'divider',
        borderStyle: expanded ? 'solid' : 'dashed',
        transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          bgcolor: expanded ? 'action.selected' : 'transparent',
          '&:hover': {
            bgcolor: 'action.hover',
          },
        }}
      onClick={() => executeUI('Toggle template recommender', () => setExpanded((prev) => !prev))}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Avatar
            sx={{
              width: 32,
              height: 32,
              bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : neutral[100],
            }}
          >
            <AutoAwesomeIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
          </Avatar>
          <Box>
            <Typography variant="subtitle2" fontWeight={600}>
              AI Template Picker
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Describe what you need and let AI find the best template
            </Typography>
          </Box>
        </Stack>
        <Tooltip title={expanded ? 'Collapse' : 'Expand'}>
          <IconButton size="small" aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* Expanded Content */}
      <Collapse in={expanded}>
        <Box sx={{ px: 2, pb: 2 }}>
          <Stack spacing={2}>
            {/* Search Input */}
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                size="small"
                placeholder="e.g., monthly sales report with charts, inventory tracking spreadsheet..."
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: 'background.paper',
                  },
                }}
              />
              <Button
                variant="contained"
                onClick={handleSearch}
                disabled={loading || queueing || !requirement.trim()}
                startIcon={
                  loading ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <AutoAwesomeIcon />
                  )
                }
                sx={{ minWidth: 120, textTransform: 'none' }}
              >
                {loading ? 'Searching...' : 'Find'}
              </Button>
              <Button
                variant="outlined"
                onClick={handleQueue}
                disabled={loading || queueing || !requirement.trim()}
                startIcon={
                  queueing ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <ScheduleIcon />
                  )
                }
                sx={{ minWidth: 120, textTransform: 'none' }}
              >
                {queueing ? 'Queueing...' : 'Queue'}
              </Button>
            </Stack>

            {/* Loading */}
            {loading && <LinearProgress />}

            {/* Error */}
            {error && (
              <Alert severity="info" onClose={() => executeUI('Dismiss recommendations error', () => setError(null))}>
                {error}
              </Alert>
            )}

            {/* Results */}
            {recommendations.length > 0 && (
              <Stack spacing={1.5}>
                <Typography variant="caption" color="text.secondary">
                  {recommendations.length} template{recommendations.length !== 1 ? 's' : ''} found
                </Typography>
                {recommendations.map((rec, idx) => {
                  const template = rec.template || rec
                  const kind = template.kind || 'pdf'
                  const Icon = KIND_ICONS[kind] || PictureAsPdfIcon
                  const score = typeof rec.score === 'number' ? rec.score : null

                  return (
                    <Paper
                      key={template.id || idx}
                      variant="outlined"
                      sx={{
                        p: 2,
                        cursor: 'pointer',
                        transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
                        '&:hover': {
                          borderColor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                          bgcolor: 'action.hover',
                        },
                      }}
                      onClick={() => handleSelect(template)}
                    >
                      <Stack
                        direction="row"
                        alignItems="flex-start"
                        spacing={2}
                      >
                        <Avatar
                          variant="rounded"
                          sx={{
                            width: 40,
                            height: 40,
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                          }}
                        >
                          <Icon
                            sx={{
                              color: 'text.secondary',
                            }}
                          />
                        </Avatar>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={1}
                            sx={{ mb: 0.5 }}
                          >
                            <Typography variant="subtitle2" fontWeight={600}>
                              {template.name || template.id}
                            </Typography>
                            <Chip
                              label={kind.toUpperCase()}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: '10px', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                            />
                            {score !== null && (
                              <Chip
                                label={`${Math.round(score * 100)}% match`}
                                size="small"
                                sx={{ height: 20, fontSize: '10px', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                              />
                            )}
                          </Stack>
                          {rec.explanation && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {rec.explanation}
                            </Typography>
                          )}
                          {!rec.explanation && template.description && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {template.description}
                            </Typography>
                          )}
                        </Box>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<CheckIcon />}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSelect(template)
                      }}
                          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                        >
                          Select
                        </Button>
                      </Stack>
                    </Paper>
                  )
                })}
              </Stack>
            )}

            {/* Quick Examples */}
            {!loading && recommendations.length === 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Try these examples:
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {[
                    'monthly financial report',
                    'inventory tracking',
                    'sales summary with charts',
                    'equipment status report',
                  ].map((example) => (
                    <Chip
                      key={example}
                      label={example}
                      size="small"
                      variant="outlined"
                      onClick={() => executeUI('Set example requirement', () => setRequirement(example), { example })}
                      sx={{ cursor: 'pointer' }}
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  )
}

// === From: ReportsPageContainer.jsx ===
/**
 * Reports Page — Clean workflow for report generation
 * Single-column layout: Design & Source → Time Period → Generate → Recent Runs
 */
const isTauri = () => false

// V2: Pipeline visualization and feedback components

/** Download a file by URL — fetch as blob and trigger browser save dialog. */
function downloadFile(url, filename, toast) {
  const label = filename || 'file'
  if (toast) toast.show(`Downloading ${label}…`, 'info')
  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      return res.blob()
    })
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename || 'download'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      if (toast) toast.show(`Downloaded ${label}`, 'success')
    })
    .catch((err) => {
      console.error('[download]', err)
      if (toast) toast.show(`Download failed: ${err.message}`, 'error')
    })
}


const SectionLabel = styled(Typography)(({ theme }) => ({
  fontSize: '0.8125rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: theme.palette.text.primary,
  marginBottom: theme.spacing(1.5),
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  '&::after': {
    content: '""',
    flex: 1,
    height: 1,
    backgroundColor: alpha(theme.palette.divider, 0.3),
  },
}))

const StyledTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: 12,
    backgroundColor: alpha(theme.palette.background.paper, 0.6),
    transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
    '&:hover': {
      backgroundColor: alpha(theme.palette.background.paper, 0.8),
    },
    '&.Mui-focused': {
      backgroundColor: theme.palette.background.paper,
      boxShadow: `0 0 0 3px ${alpha(theme.palette.text.primary, 0.08)}`,
    },
  },
}))

const PresetChip = styled(Chip, {
  shouldForwardProp: (prop) => prop !== 'selected',
})(({ theme, selected }) => ({
  borderRadius: 10,
  fontWeight: 500,
  fontSize: '0.75rem',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  cursor: 'pointer',
  ...(selected && {
    background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
    color: theme.palette.common.white,
    boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.15)}`,
    '& .MuiChip-icon': {
      color: theme.palette.common.white,
    },
  }),
  ...(!selected && {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    color: theme.palette.text.primary,
    border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
    '& .MuiChip-icon': {
      color: theme.palette.text.secondary,
    },
    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.14) : neutral[200],
      transform: 'translateY(-1px)',
    },
  }),
}))

const DiscoveryChip = styled(Chip)(({ theme }) => ({
  borderRadius: 8,
  fontWeight: 600,
  fontSize: '0.75rem',
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  color: theme.palette.text.secondary,
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
}))

const BatchListContainer = styled(Box)(({ theme }) => ({
  maxHeight: 200,
  overflow: 'auto',
  borderRadius: 12,
  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.4),
  '&::-webkit-scrollbar': {
    width: 6,
  },
  '&::-webkit-scrollbar-track': {
    background: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    background: alpha(theme.palette.text.primary, 0.2),
    borderRadius: 8,
  },
}))

const BatchListItem = styled(ListItem, {
  shouldForwardProp: (prop) => prop !== 'selected',
})(({ theme, selected }) => ({
  padding: theme.spacing(1, 1.5),
  cursor: 'pointer',
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  ...(selected && {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  }),
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  },
  '&:last-child': {
    borderBottom: 'none',
  },
}))

const PrimaryButton = styled(Button)(({ theme }) => ({
  borderRadius: 12,
  textTransform: 'none',
  fontWeight: 600,
  fontSize: '0.875rem',
  padding: theme.spacing(1.25, 3),
  background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  color: theme.palette.common.white,
  boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
    transform: 'translateY(-2px)',
  },
  '&:active': {
    transform: 'translateY(0)',
  },
  '&:disabled': {
    background: theme.palette.action.disabledBackground,
    color: theme.palette.action.disabled,
    boxShadow: 'none',
  },
}))

const SecondaryButton = styled(Button)(({ theme }) => ({
  borderRadius: 12,
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.875rem',
  padding: theme.spacing(1.25, 2.5),
  borderColor: alpha(theme.palette.divider, 0.3),
  color: theme.palette.text.primary,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
    transform: 'translateY(-1px)',
  },
}))

const TextButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.75rem',
  padding: theme.spacing(0.5, 1.5),
  color: theme.palette.text.secondary,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    color: theme.palette.text.primary,
  },
}))

const RunHistoryCard = styled(Paper, {
  shouldForwardProp: (prop) => prop !== 'selected',
})(({ theme, selected }) => ({
  padding: theme.spacing(2),
  borderRadius: 12,
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  border: `1px solid ${selected ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700]) : alpha(theme.palette.divider, 0.2)}`,
  backgroundColor: selected ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50]) : 'transparent',
  '&:hover': {
    borderColor: alpha(theme.palette.divider, 0.4),
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.03) : neutral[50],
    '& .view-summary-hint': {
      opacity: 1,
      color: theme.palette.text.primary,
    },
  },
}))

const StyledLinearProgress = styled(LinearProgress)(({ theme }) => ({
  borderRadius: 4,
  height: 6,
  backgroundColor: alpha(theme.palette.text.primary, 0.1),
  '& .MuiLinearProgress-bar': {
    borderRadius: 4,
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[900],
  },
}))

const DownloadButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.75rem',
  padding: theme.spacing(0.5, 1.5),
  borderColor: alpha(theme.palette.divider, 0.3),
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
  },
}))

const AdvancedToggle = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(1.5, 0),
  cursor: 'pointer',
  color: theme.palette.text.secondary,
  transition: 'color 0.2s ease',
  '&:hover': {
    color: theme.palette.text.primary,
  },
}))


const formatDateForInput = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const getDatePresets = () => {
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0)

  return {
    today: {
      label: 'Today',
      start: formatDateForInput(today),
      end: formatDateForInput(today),
    },
    thisWeek: {
      label: 'This Week',
      start: formatDateForInput(startOfWeek),
      end: formatDateForInput(today),
    },
    thisMonth: {
      label: 'This Month',
      start: formatDateForInput(startOfMonth),
      end: formatDateForInput(today),
    },
    lastMonth: {
      label: 'Last Month',
      start: formatDateForInput(startOfLastMonth),
      end: formatDateForInput(endOfLastMonth),
    },
  }
}


export default function ReportsPage() {
  const theme = useTheme()
  const [searchParams] = useSearchParams()
  const navigate = useNavigateInteraction()
  const toast = useToast()
  const { execute } = useInteraction()
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { from: 'reports', ...intent } }),
    [navigate]
  )

  const templates = useAppStore((s) => s.templates)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const setActiveConnectionId = useAppStore((s) => s.setActiveConnectionId)
  const setTemplates = useAppStore((s) => s.setTemplates)

  const [selectedTemplate, setSelectedTemplate] = useState(searchParams.get('template') || '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [datePreset, setDatePreset] = useState('thisMonth')
  const [keyValues, setKeyValues] = useState({})
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [keyOptions, setKeyOptions] = useState({})
  const [discovering, setDiscovering] = useState(false)
  const [discovery, setDiscovery] = useState(null)
  const [selectedBatches, setSelectedBatches] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [runHistory, setRunHistory] = useState([])
  const [generatingDocx, setGeneratingDocx] = useState(null) // run ID currently generating
  const [selectedRun, setSelectedRun] = useState(null)
  const [runSummary, setRunSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [queueingSummary, setQueueingSummary] = useState(false)
  const [batchDiscoveryOpen, setBatchDiscoveryOpen] = useState(false)
  const [expandedRunId, setExpandedRunId] = useState(null)

  const selectedTemplateInfo = templates.find((t) => t.id === selectedTemplate)
  const outputLabel = selectedTemplateInfo?.kind?.toUpperCase() || 'PDF'

  // Success celebration
  const { celebrating, celebrate, onComplete: onCelebrationComplete } = useCelebration()

  // Refs to prevent race conditions
  const keyOptionsRequestIdRef = useRef(0)
  const summaryRequestIdRef = useRef(0)

  // Auto-select first template when templates are loaded but none selected
  useEffect(() => {
    if (!selectedTemplate && templates.length > 0) {
      setSelectedTemplate(templates[0].id)
    }
  }, [templates, selectedTemplate])

  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true)
      try {
        const data = await api.listApprovedTemplates()
        setTemplates(data)
      } catch (err) {
        toast.show(err.message || 'Failed to load designs', 'error')
      } finally {
        setLoading(false)
      }
    }
    if (templates.length === 0) {
      fetchTemplates()
    }
  }, [templates.length, setTemplates, toast])

  useEffect(() => {
    const fetchKeyOptions = async () => {
      if (!selectedTemplate || !activeConnection?.id) return

      const requestId = ++keyOptionsRequestIdRef.current

      try {
        const template = templates.find((t) => t.id === selectedTemplate)
        const result = await api.fetchTemplateKeyOptions(selectedTemplate, {
          connectionId: activeConnection.id,
          kind: template?.kind || 'pdf',
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        })

        if (requestId === keyOptionsRequestIdRef.current) {
          setKeyOptions(result.keys || {})
          // Clear any key selections that are no longer valid for this date range
          setKeyValues((prev) => {
            const validKeys = result.keys || {}
            const updated = {}
            for (const [key, val] of Object.entries(prev)) {
              if (!(key in validKeys)) continue
              const available = validKeys[key] || []
              if (Array.isArray(val)) {
                const filtered = val.filter((v) => available.includes(v))
                if (filtered.length > 0) updated[key] = filtered
              } else if (available.includes(val)) {
                updated[key] = val
              }
            }
            return updated
          })
        }
      } catch (err) {
        if (requestId === keyOptionsRequestIdRef.current) {
          console.error('Failed to fetch key options:', err)
          toast.show('Could not load filter options. You can still generate reports.', 'warning')
        }
      }
    }
    fetchKeyOptions()
  }, [selectedTemplate, activeConnection?.id, templates, toast, startDate, endDate])

  const handleTemplateChange = useCallback((event) => {
    setSelectedTemplate(event.target.value)
    setKeyValues({})
    setResult(null)
    setDiscovery(null)
    setSelectedBatches([])
  }, [])

  const handleAiSelectTemplate = useCallback((template) => {
    if (template?.id) {
      setSelectedTemplate(template.id)
      setKeyValues({})
      setResult(null)
      toast.show(`Selected: ${template.name || template.id}`, 'success')
    }
  }, [toast])

  const handleKeyValueChange = useCallback((key, value, allOptions) => {
    if (Array.isArray(value) && value.includes('__all__')) {
      const opts = allOptions || []
      const prev = Array.isArray(value) ? value.filter(v => v !== '__all__') : []
      const allSelected = prev.length >= opts.length
      setKeyValues((p) => ({ ...p, [key]: allSelected ? [] : [...opts] }))
    } else {
      setKeyValues((prev) => ({ ...prev, [key]: value }))
    }
  }, [])

  const handleDatePreset = useCallback((presetKey) => {
    setDatePreset(presetKey)
    if (presetKey !== 'custom') {
      const presets = getDatePresets()
      const preset = presets[presetKey]
      if (preset) {
        setStartDate(preset.start)
        setEndDate(preset.end)
        setStartTime('')
        setEndTime('')
      }
    }
  }, [])

  // Initialize dates on first render
  useEffect(() => {
    if (!startDate && !endDate && datePreset !== 'custom') {
      const presets = getDatePresets()
      const preset = presets[datePreset]
      if (preset) {
        setStartDate(preset.start)
        setEndDate(preset.end)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = useCallback(async () => {
    if (!selectedTemplate || !activeConnection?.id) {
      toast.show('Please select a design and connect to a data source first', 'error')
      return
    }
    if (discovery && selectedBatches.length === 0) {
      toast.show('Select at least one batch to run', 'error')
      return
    }
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      toast.show('Start date must be before or equal to end date', 'error')
      return
    }

    await execute({
      type: InteractionType.EXECUTE,
      label: 'Generate report',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        templateId: selectedTemplate,
        connectionId: activeConnection?.id,
        action: 'run_report',
      },
      action: async () => {
        setGenerating(true)
        setError(null)
        setResult(null)

        try {
          const template = templates.find((t) => t.id === selectedTemplate)

          const batches = discovery?.batches || []
          const allSelected = batches.length > 0 && selectedBatches.length === batches.length
          const useSelectedBatches = batches.length > 0 && selectedBatches.length > 0 && !allSelected

          const reportResult = await api.runReportAsJob({
            templateId: selectedTemplate,
            templateName: template?.name,
            connectionId: activeConnection.id,
            startDate: composeDateTimeString(startDate, startTime) || undefined,
            endDate: composeDateTimeString(endDate, endTime) || undefined,
            keyValues: (() => { const kv = Object.fromEntries(Object.entries(keyValues).filter(([, v]) => Array.isArray(v) ? v.length > 0 : !!v)); return Object.keys(kv).length > 0 ? kv : undefined })(),
            batchIds: useSelectedBatches ? selectedBatches : undefined,
            kind: template?.kind || 'pdf',
            xlsx: template?.kind === 'excel',
          })

          setResult(reportResult)
          toast.show('Report generation started!', 'success')
          celebrate()
          return reportResult
        } catch (err) {
          setError(err.message || 'Failed to generate report')
          toast.show(err.message || 'Failed to generate report', 'error')
          throw err
        } finally {
          setGenerating(false)
        }
      },
    })
  }, [selectedTemplate, activeConnection?.id, templates, startDate, endDate, startTime, endTime, keyValues, discovery, selectedBatches, toast, celebrate, execute])

  const keyFields = Object.keys(keyOptions)

  const handleDiscover = useCallback(async () => {
    if (!selectedTemplate || !activeConnection?.id) {
      toast.show('Select a design and data source first', 'error')
      return
    }
    if (!startDate || !endDate) {
      toast.show('Provide a start and end date to discover batches', 'error')
      return
    }
    if (new Date(startDate) > new Date(endDate)) {
      toast.show('Start date must be before or equal to end date', 'error')
      return
    }
    await execute({
      type: InteractionType.ANALYZE,
      label: 'Discover batches',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        templateId: selectedTemplate,
        connectionId: activeConnection?.id,
        action: 'discover_batches',
      },
      action: async () => {
        setDiscovering(true)
        setDiscovery(null)
        try {
          const template = templates.find((t) => t.id === selectedTemplate)
          const data = await api.discoverReports({
            templateId: selectedTemplate,
            connectionId: activeConnection.id,
            startDate: composeDateTimeString(startDate, startTime),
            endDate: composeDateTimeString(endDate, endTime),
            keyValues: (() => { const kv = Object.fromEntries(Object.entries(keyValues).filter(([, v]) => Array.isArray(v) ? v.length > 0 : !!v)); return Object.keys(kv).length > 0 ? kv : undefined })(),
            kind: template?.kind || 'pdf',
          })
          setDiscovery(data)
          const batchIds = Array.isArray(data?.batches) ? data.batches.map((batch) => batch.id) : []
          setSelectedBatches(batchIds)
          return data
        } catch (err) {
          toast.show(err.message || 'Failed to discover batches', 'error')
          throw err
        } finally {
          setDiscovering(false)
        }
      },
    })
  }, [selectedTemplate, activeConnection?.id, startDate, endDate, startTime, endTime, keyValues, templates, toast, execute])

  const fetchRunHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const runs = await api.listReportRuns({ limit: 10 })
      setRunHistory(runs)
    } catch (err) {
      console.error('Failed to load run history:', err)
      toast.show('Failed to load run history', 'warning')
    } finally {
      setHistoryLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchRunHistory()
  }, [fetchRunHistory])

  const handleGenerateDocx = useCallback(async (runId) => {
    setGeneratingDocx(runId)
    try {
      const result = await api.generateDocxJob(runId)
      if (result.status === 'already_exists') {
        toast.show('DOCX already available', 'success')
        fetchRunHistory()
      } else {
        toast.show('DOCX conversion queued — track progress in Report Progress', 'success')
      }
    } catch (err) {
      console.error('DOCX generation failed:', err)
      toast.show('DOCX generation failed — check backend logs', 'error')
    } finally {
      setGeneratingDocx(null)
    }
  }, [toast, fetchRunHistory])

  const toggleBatch = useCallback((batchId) => {
    setSelectedBatches((prev) => {
      if (prev.includes(batchId)) {
        return prev.filter((id) => id !== batchId)
      }
      return [...prev, batchId]
    })
  }, [])

  const handleSelectRun = useCallback(async (run) => {
    // Toggle: clicking the same run collapses it
    if (selectedRun?.id === run.id) {
      setSelectedRun(null)
      setExpandedRunId(null)
      setRunSummary(null)
      return
    }

    setSelectedRun(run)
    setExpandedRunId(run.id)
    setRunSummary(null)

    if (run?.id) {
      const requestId = ++summaryRequestIdRef.current

      setSummaryLoading(true)
      try {
        const summaryData = await summaryApi.getReportSummary(run.id)

        if (requestId === summaryRequestIdRef.current) {
          setRunSummary(summaryData.summary || summaryData)
        }
      } catch (err) {
        if (requestId === summaryRequestIdRef.current) {
          console.error('Failed to fetch summary:', err)
          setRunSummary(null)
        }
      } finally {
        if (requestId === summaryRequestIdRef.current) {
          setSummaryLoading(false)
        }
      }
    }
  }, [selectedRun?.id])

  const handleQueueSummary = useCallback(async () => {
    if (!selectedRun?.id) return
    await execute({
      type: InteractionType.GENERATE,
      label: 'Queue summary',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        runId: selectedRun?.id,
        action: 'queue_report_summary',
      },
      action: async () => {
        setQueueingSummary(true)
        try {
          const response = await summaryApi.queueReportSummary(selectedRun.id)
          const jobId = response?.job_id || response?.jobId || null
          if (jobId) {
            toast.show('Summary queued. Track progress in Report Progress.', 'success')
          } else {
            toast.show('Failed to queue summary.', 'error')
          }
          return response
        } catch (err) {
          toast.show(err?.message || 'Failed to queue summary.', 'error')
          throw err
        } finally {
          setQueueingSummary(false)
        }
      },
    })
  }, [selectedRun?.id, toast, execute])

  const handleSelectAllBatches = useCallback(() => {
    const allIds = Array.isArray(discovery?.batches) ? discovery.batches.map((batch) => batch.id) : []
    setSelectedBatches(allIds)
  }, [discovery])

  const handleClearBatches = useCallback(() => {
    setSelectedBatches([])
  }, [])

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <Box sx={{ minHeight: '100vh', p: 3, bgcolor: 'background.default' }}>
      <SuccessCelebration trigger={celebrating} onComplete={onCelebrationComplete} />
      <Container maxWidth="lg">
        <PageHeader
          title="Run a Report"
          description="Choose a design, set your date range, and generate a report."
          actions={
            <SecondaryButton
              variant="outlined"
              startIcon={<ScheduleIcon />}
              disabled={!selectedTemplate || generating}
              onClick={() =>
                handleNavigate(`/schedules?template=${selectedTemplate}`, 'Open schedules', {
                  templateId: selectedTemplate,
                })
              }
            >
              Schedule
            </SecondaryButton>
          }
        />

        <Stack spacing={3}>

          {/* ── CARD 1: Design & Data Source ── */}
          <GlassCard>
            <SectionLabel>
              <DescriptionIcon sx={{ fontSize: 14 }} />
              Design & Data Source
            </SectionLabel>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              {/* Report Design */}
              <Box sx={{ flex: 1 }}>
                <StyledFormControl fullWidth>
                  <InputLabel>Report Design</InputLabel>
                  <Select
                    value={selectedTemplate}
                    onChange={handleTemplateChange}
                    label="Report Design"
                  >
                    {templates.map((template) => (
                      <MenuItem key={template.id} value={template.id}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <span>{template.name || template.id}</span>
                          <Chip
                            label={template.kind?.toUpperCase() || 'PDF'}
                            size="small"
                            variant="outlined"
                            sx={{ borderRadius: 6, fontSize: '10px', height: 20 }}
                          />
                        </Stack>
                      </MenuItem>
                    ))}
                  </Select>
                </StyledFormControl>
              </Box>

              {/* Data Source */}
              <Box sx={{ flex: 1 }}>
                <ConnectionSelector
                  value={activeConnection?.id || ''}
                  onChange={(connId) => setActiveConnectionId(connId)}
                  label="Data Source"
                  showStatus
                />
                {!activeConnection && (
                  <Typography variant="caption" color="warning.main" sx={{ mt: 0.75, display: 'block' }}>
                    No data source selected.{' '}
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ color: 'primary.main', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => handleNavigate('/connections', 'Open connections')}
                    >
                      Add one
                    </Typography>
                  </Typography>
                )}
              </Box>
            </Stack>

            {/* AI Template Picker — tucked inside, not top-level */}
            <Box sx={{ mt: 2 }}>
              <TemplateRecommender onSelectTemplate={handleAiSelectTemplate} />
            </Box>
          </GlassCard>

          {/* ── CARD 2: Time Period & Filters ── */}
          <GlassCard>
            <SectionLabel>
              <TodayIcon sx={{ fontSize: 14 }} />
              Time Period
            </SectionLabel>

            {/* Date preset chips */}
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
              {Object.entries(getDatePresets()).map(([key, preset]) => (
                <PresetChip
                  key={key}
                  label={preset.label}
                  icon={<TodayIcon sx={{ fontSize: 14 }} />}
                  onClick={() => handleDatePreset(key)}
                  selected={datePreset === key}
                  variant={datePreset === key ? 'filled' : 'outlined'}
                />
              ))}
              <PresetChip
                label="Custom"
                icon={<DateRangeIcon sx={{ fontSize: 14 }} />}
                onClick={() => handleDatePreset('custom')}
                selected={datePreset === 'custom'}
                variant={datePreset === 'custom' ? 'filled' : 'outlined'}
              />
            </Stack>

            {/* Date inputs */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <StyledTextField
                label="Start Date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  setDatePreset('custom')
                }}
                InputLabelProps={{ shrink: true }}
                fullWidth
                size="small"
              />
              <StyledTextField
                label="Start Time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 130 }}
                size="small"
              />
              <StyledTextField
                label="End Date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setDatePreset('custom')
                }}
                InputLabelProps={{ shrink: true }}
                fullWidth
                size="small"
              />
              <StyledTextField
                label="End Time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 130 }}
                size="small"
              />
            </Stack>

            {/* Key field filters (conditional) */}
            {keyFields.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Divider sx={{ mb: 2, borderColor: alpha(theme.palette.divider, 0.2) }} />
                <SectionLabel>
                  <FilterListIcon sx={{ fontSize: 14 }} />
                  Filter Parameters
                </SectionLabel>
                <Stack spacing={2}>
                  {keyFields.map((key) => (
                    <StyledFormControl key={key} fullWidth size="small">
                      <InputLabel>{key}</InputLabel>
                      <Select
                        value={keyValues[key] || ''}
                        onChange={(e) => handleKeyValueChange(key, e.target.value)}
                        label={key}
                      >
                        <MenuItem value="">
                          <em>All</em>
                        </MenuItem>
                        {(keyOptions[key] || []).map((option) => (
                          <MenuItem key={option} value={option}>
                            {option}
                          </MenuItem>
                        ))}
                      </Select>
                    </StyledFormControl>
                  ))}
                </Stack>
              </Box>
            )}
          </GlassCard>

          {/* ── ACTION BAR ── */}
          <Box>
            {/* Error alert */}
            {error && (
              <Alert
                severity="error"
                sx={{ mb: 2, borderRadius: 1 }}
                onClose={() => setError(null)}
                action={
                  <TextButton color="inherit" size="small" onClick={handleGenerate} disabled={generating}>
                    Try Again
                  </TextButton>
                }
              >
                {error}
              </Alert>
            )}

            {/* Generating progress */}
            {generating && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Generating report...
                </Typography>
                <StyledLinearProgress />
              </Box>
            )}

            {/* V2: Pipeline visualization during generation */}
            {generating && usePipelineRunStore.getState().currentRun && (
              <Box sx={{ mb: 2 }}>
                <PipelineVisualization compact />
              </Box>
            )}

            {/* Success result */}
            {result && (
              <Alert severity="success" sx={{ mb: 2, borderRadius: 1 }}>
                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                  <Typography variant="body2">
                    Report started! ID: {result.job_id?.slice(0, 8)}...
                  </Typography>
                  <SecondaryButton
                    size="small"
                    variant="outlined"
                    onClick={() => handleNavigate('/jobs', 'Open jobs')}
                  >
                    View Progress
                  </SecondaryButton>
                </Stack>
              </Alert>
            )}

            {/* V2: Feedback panel after report completion */}
            {result && result.job_id && (
              <Box sx={{ mb: 2 }}>
                <FeedbackPanel
                  entityType="report"
                  entityId={result.job_id}
                  showRating
                  showThumbs
                  qualityScore={result.quality_score || null}
                />
              </Box>
            )}

            {/* Primary action row */}
            <Stack direction="row" spacing={2} alignItems="center" justifyContent="flex-end">
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                Reports run in the background.{' '}
                <Typography
                  component="span"
                  variant="caption"
                  sx={{ color: 'primary.main', cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => handleNavigate('/jobs', 'Open jobs')}
                >
                  Track progress
                </Typography>
              </Typography>
              <PrimaryButton
                startIcon={<PlayArrowIcon />}
                onClick={handleGenerate}
                disabled={!selectedTemplate || !activeConnection || generating}
                sx={{ px: 4, py: 1.5 }}
              >
                Generate Report
              </PrimaryButton>
            </Stack>
          </Box>

          {/* ── ADVANCED: Batch Discovery (collapsed by default) ── */}
          <Box>
            <AdvancedToggle onClick={() => setBatchDiscoveryOpen((prev) => !prev)}>
              <Stack direction="row" spacing={1} alignItems="center">
                <FilterListIcon sx={{ fontSize: 16 }} />
                <Typography variant="subtitle2" fontWeight={500}>
                  Advanced: Find Data Batches
                </Typography>
              </Stack>
              {batchDiscoveryOpen ? (
                <ExpandLessIcon sx={{ fontSize: 20 }} />
              ) : (
                <ExpandMoreIcon sx={{ fontSize: 20 }} />
              )}
            </AdvancedToggle>

            <Collapse in={batchDiscoveryOpen}>
              <GlassCard sx={{ mt: 1 }}>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Discover available data batches for the selected design and date range.
                    </Typography>
                    <SecondaryButton
                      variant="outlined"
                      size="small"
                      onClick={handleDiscover}
                      disabled={discovering || !selectedTemplate || !activeConnection}
                    >
                      {discovering ? 'Searching...' : 'Find Batches'}
                    </SecondaryButton>
                  </Stack>

                  {discovering && <StyledLinearProgress />}

                  {!discovering && discovery && (
                    <Stack spacing={2}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <DiscoveryChip label={`${discovery.batches_count || discovery.batches?.length || 0} batches`} />
                        <DiscoveryChip label={`${discovery.rows_total || 0} rows`} />
                      </Stack>
                      <Stack direction="row" spacing={1}>
                        <TextButton size="small" onClick={handleSelectAllBatches}>Select all</TextButton>
                        <TextButton size="small" onClick={handleClearBatches}>Clear</TextButton>
                      </Stack>
                      <BatchListContainer>
                        <List dense disablePadding>
                          {(discovery.batches || []).map((batch) => (
                            <BatchListItem
                              key={batch.id}
                              disableGutters
                              onClick={() => toggleBatch(batch.id)}
                              selected={selectedBatches.includes(batch.id)}
                            >
                              <Checkbox
                                checked={selectedBatches.includes(batch.id)}
                                sx={{ p: 0.5, mr: 1 }}
                              />
                              <ListItemText
                                primary={`${batch.id}`}
                                secondary={`${batch.rows || 0} rows`}
                                primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                                secondaryTypographyProps={{ variant: 'caption' }}
                              />
                            </BatchListItem>
                          ))}
                        </List>
                      </BatchListContainer>
                    </Stack>
                  )}
                </Stack>
              </GlassCard>
            </Collapse>
          </Box>

          {/* ── RECENT RUNS (full-width) ── */}
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
              <SectionLabel sx={{ mb: 0, flex: 1 }}>
                <RefreshIcon sx={{ fontSize: 14 }} />
                Recent Runs
              </SectionLabel>
              <TextButton
                size="small"
                onClick={fetchRunHistory}
                disabled={historyLoading}
                startIcon={<RefreshIcon sx={{ fontSize: 14 }} />}
              >
                Refresh
              </TextButton>
            </Stack>

            {historyLoading && <StyledLinearProgress sx={{ mb: 2 }} />}

            {!historyLoading && runHistory.length === 0 && (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <DescriptionIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                <Typography variant="body2" color="text.secondary">
                  No report runs yet. Generate a report to get started.
                </Typography>
              </Box>
            )}

            {/* Run history grid: 2 per row on desktop, 1 on mobile */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: 2,
              }}
            >
              {runHistory.map((run) => (
                <Box key={run.id}>
                  <RunHistoryCard
                    selected={selectedRun?.id === run.id}
                    onClick={() => handleSelectRun(run)}
                    title="Click to view summary"
                  >
                    <Stack spacing={0.5}>
                      <Stack direction="row" alignItems="center" justifyContent="space-between">
                        <Typography variant="body2" fontWeight={600}>
                          {run.templateName || run.templateId}
                        </Typography>
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={0.5}
                          className="view-summary-hint"
                          sx={{ opacity: 0.6, transition: 'all 0.2s' }}
                        >
                          <Typography variant="caption" color="text.secondary">
                            {selectedRun?.id === run.id ? 'Collapse' : 'Summary'}
                          </Typography>
                          <ArrowForwardIcon
                            sx={{
                              fontSize: 12,
                              transform: selectedRun?.id === run.id ? 'rotate(90deg)' : 'none',
                              transition: 'transform 0.2s',
                            }}
                          />
                        </Stack>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(run.createdAt).toLocaleString()} &middot; {run.startDate} to {run.endDate}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                        {run.artifacts?.pdf_url && (
                          <DownloadButton
                            size="small"
                            variant="outlined"
                            startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => { e.stopPropagation(); downloadFile(api.withBase(run.artifacts.pdf_url), `${run.templateName || 'report'}.pdf`, toast) }}
                          >
                            PDF
                          </DownloadButton>
                        )}
                        {run.artifacts?.html_url && (
                          <DownloadButton
                            size="small"
                            variant="outlined"
                            startIcon={<DownloadIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => { e.stopPropagation(); downloadFile(api.withBase(run.artifacts.html_url), `${run.templateName || 'report'}.html`, toast) }}
                          >
                            HTML
                          </DownloadButton>
                        )}
                        {run.artifacts?.xlsx_url && (
                          <DownloadButton
                            size="small"
                            variant="outlined"
                            startIcon={<TableChartIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => { e.stopPropagation(); downloadFile(api.withBase(run.artifacts.xlsx_url), `${run.templateName || 'report'}.xlsx`, toast) }}
                          >
                            XLSX
                          </DownloadButton>
                        )}
                        {run.artifacts?.docx_url ? (
                          <DownloadButton
                            size="small"
                            variant="outlined"
                            startIcon={<ArticleIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => { e.stopPropagation(); downloadFile(api.withBase(run.artifacts.docx_url), `${run.templateName || 'report'}.docx`, toast) }}
                          >
                            DOCX
                          </DownloadButton>
                        ) : run.artifacts?.pdf_url ? (
                          <DownloadButton
                            size="small"
                            variant="outlined"
                            disabled={generatingDocx === run.id}
                            startIcon={generatingDocx === run.id
                              ? <Box component="span" sx={{ width: 14, height: 14, border: '2px solid', borderColor: 'text.disabled', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', '@keyframes spin': { to: { transform: 'rotate(360deg)' } } }} />
                              : <ArticleIcon sx={{ fontSize: 14 }} />}
                            onClick={(e) => { e.stopPropagation(); handleGenerateDocx(run.id) }}
                            title="DOCX conversion may take several minutes for large reports"
                          >
                            {generatingDocx === run.id ? 'Generating...' : 'Generate DOCX'}
                          </DownloadButton>
                        ) : null}
                        <DownloadButton
                          size="small"
                          variant="outlined"
                          startIcon={<SmartToyIcon sx={{ fontSize: 14 }} />}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleNavigate(`/agents?analyzeRunId=${run.id}`, 'Analyze with AI', { runId: run.id })
                          }}
                          data-testid={`analyze-ai-${run.id}`}
                        >
                          Analyze
                        </DownloadButton>
                      </Stack>
                    </Stack>
                  </RunHistoryCard>

                  {/* Expanded inline AI summary */}
                  <Collapse in={expandedRunId === run.id}>
                    <Box sx={{ mt: 1, ml: 2, pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                      <AiUsageNotice
                        title="AI summary"
                        description="Summaries are generated from the selected report run. Review before sharing."
                        chips={[
                          { label: 'Source: Selected run', color: 'info', variant: 'outlined' },
                          { label: 'Confidence: Review required', color: 'warning', variant: 'outlined' },
                        ]}
                        dense
                        sx={{ mb: 1.5 }}
                      />
                      {summaryLoading && <StyledLinearProgress sx={{ mb: 1 }} />}
                      {!summaryLoading && runSummary ? (
                        <Paper
                          sx={{
                            p: 2,
                            borderRadius: 1.5,
                            bgcolor: theme.palette.mode === 'dark'
                              ? alpha(theme.palette.text.primary, 0.04)
                              : neutral[50],
                            border: 1,
                            borderColor: 'divider',
                          }}
                        >
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                            {typeof runSummary === 'string'
                              ? runSummary
                              : runSummary.text || runSummary.content || 'No summary available'}
                          </Typography>
                          {runSummary.key_points && (
                            <Box sx={{ mt: 1.5 }}>
                              <Typography variant="caption" fontWeight={600} color="text.primary">
                                Key Points:
                              </Typography>
                              <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                                {runSummary.key_points.map((point, idx) => (
                                  <li key={idx}>
                                    <Typography variant="caption">{point}</Typography>
                                  </li>
                                ))}
                              </ul>
                            </Box>
                          )}
                        </Paper>
                      ) : !summaryLoading && (
                        <Stack spacing={1}>
                          <Typography variant="body2" color="text.secondary">
                            No summary available for this run.
                          </Typography>
                          <SecondaryButton
                            size="small"
                            variant="outlined"
                            startIcon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
                            onClick={handleQueueSummary}
                            disabled={queueingSummary}
                            sx={{ alignSelf: 'flex-start' }}
                          >
                            {queueingSummary ? 'Queueing...' : 'Generate summary'}
                          </SecondaryButton>
                        </Stack>
                      )}
                    </Box>
                  </Collapse>
                </Box>
              ))}
            </Box>
          </Box>

        </Stack>
      </Container>
    </Box>
  )
}
