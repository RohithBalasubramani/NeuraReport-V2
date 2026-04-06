import { api, globalSearch } from '@/api/client'
import { neutral, palette } from '@/app/theme'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useAppStore } from '@/stores/app'
import { Kbd } from '@/styles/styles'
import {
  Close as CloseIcon,
  Edit as EditIcon,
  Send as SendIcon,
  Star as StarIcon,
  ThumbDown as ThumbDownIcon,
  ThumbDownOutlined as ThumbDownOutlinedIcon,
  ThumbUp as ThumbUpIcon,
  ThumbUpOutlined as ThumbUpOutlinedIcon,
} from '@mui/icons-material'
import AddIcon from '@mui/icons-material/Add'
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined'
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined'
import AutoFixHighOutlinedIcon from '@mui/icons-material/AutoFixHighOutlined'
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined'
import ChatOutlinedIcon from '@mui/icons-material/ChatOutlined'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined'
import DocumentScannerOutlinedIcon from '@mui/icons-material/DocumentScannerOutlined'
import HistoryIcon from '@mui/icons-material/History'
import JoinInnerOutlinedIcon from '@mui/icons-material/JoinInnerOutlined'
import MergeOutlinedIcon from '@mui/icons-material/MergeOutlined'
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined'
import QuestionAnswerOutlinedIcon from '@mui/icons-material/QuestionAnswerOutlined'
import ScheduleIcon from '@mui/icons-material/Schedule'
import SearchIcon from '@mui/icons-material/Search'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined'
import SummarizeOutlinedIcon from '@mui/icons-material/SummarizeOutlined'
import TimelineIcon from '@mui/icons-material/Timeline'
import WorkOutlineIcon from '@mui/icons-material/WorkOutline'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Rating,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
function ThumbsFeedback({ entityType, entityId, onSubmit, size = 'small' }) {
  const [value, setValue] = useState(null) // null | 'up' | 'down'
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleThumb = useCallback(
    async (thumbValue) => {
      if (submitted) return

      const newValue = value === thumbValue ? null : thumbValue
      setValue(newValue)

      if (newValue === 'down') {
        setShowComment(true)
        return
      }

      if (newValue === 'up') {
        try {
          const payload = {
            entity_type: entityType,
            entity_id: entityId,
            thumbs_up: true,
          }
          if (onSubmit) {
            await onSubmit(payload)
          }
          setSubmitted(true)
        } catch (err) {
          console.error('Failed to submit feedback:', err)
        }
      }
    },
    [value, entityType, entityId, submitted, onSubmit]
  )

  const handleSubmitComment = useCallback(async () => {
    try {
      const payload = {
        entity_type: entityType,
        entity_id: entityId,
        thumbs_up: false,
        comment,
      }
      if (onSubmit) {
        await onSubmit(payload)
      }
      setSubmitted(true)
      setShowComment(false)
    } catch (err) {
      console.error('Failed to submit feedback:', err)
    }
  }, [entityType, entityId, comment, onSubmit])

  if (submitted) {
    return (
      <Typography variant="caption" color="text.secondary">
        Thanks for your feedback!
      </Typography>
    )
  }

  return (
    <Box>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Tooltip title="Helpful">
          <IconButton
            size={size}
            onClick={() => handleThumb('up')}
            color={value === 'up' ? 'primary' : 'default'}
          >
            {value === 'up' ? <ThumbUpIcon fontSize="small" /> : <ThumbUpOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Not helpful">
          <IconButton
            size={size}
            onClick={() => handleThumb('down')}
            color={value === 'down' ? 'error' : 'default'}
          >
            {value === 'down' ? <ThumbDownIcon fontSize="small" /> : <ThumbDownOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>

      <Collapse in={showComment}>
        <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            placeholder="What could be improved?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            sx={{ flex: 1 }}
            multiline
            maxRows={3}
          />
          <Button
            variant="contained"
            size="small"
            onClick={handleSubmitComment}
            disabled={!comment.trim()}
            sx={{ minWidth: 0, px: 1.5 }}
          >
            <SendIcon fontSize="small" />
          </Button>
        </Box>
      </Collapse>
    </Box>
  )
}

/**
 * Star rating feedback widget.
 * Use for report quality ratings.
 */
function StarRating({ entityType, entityId, onSubmit }) {
  const [rating, setRating] = useState(null)
  const [hover, setHover] = useState(-1)
  const [submitted, setSubmitted] = useState(false)

  const handleRate = useCallback(
    async (event, newValue) => {
      setRating(newValue)
      if (newValue) {
        try {
          const payload = {
            entity_type: entityType,
            entity_id: entityId,
            rating: newValue / 5.0, // Normalize to 0-1
          }
          if (onSubmit) {
            await onSubmit(payload)
          }
          setSubmitted(true)
        } catch (err) {
          console.error('Failed to submit rating:', err)
        }
      }
    },
    [entityType, entityId, onSubmit]
  )

  if (submitted) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Rating value={rating} readOnly size="small" />
        <Typography variant="caption" color="text.secondary">
          Rated!
        </Typography>
      </Stack>
    )
  }

  return (
    <Rating
      value={rating}
      onChange={handleRate}
      onChangeActive={(event, newHover) => setHover(newHover)}
      size="small"
      emptyIcon={<StarIcon style={{ opacity: 0.3 }} fontSize="inherit" />}
    />
  )
}

/**
 * Quality score display badge.
 */
function QualityBadge({ score, label = 'Quality' }) {
  const getColor = (s) => {
    if (s >= 0.8) return 'success'
    if (s >= 0.6) return 'warning'
    return 'error'
  }

  const getLabel = (s) => {
    if (s >= 0.8) return 'High'
    if (s >= 0.6) return 'Medium'
    return 'Low'
  }

  if (score === null || score === undefined) return null

  return (
    <Tooltip title={`${label}: ${(score * 100).toFixed(0)}%`}>
      <Chip
        label={`${getLabel(score)} (${(score * 100).toFixed(0)}%)`}
        size="small"
        color={getColor(score)}
        variant="outlined"
        sx={{ height: 22, fontSize: '0.7rem' }}
      />
    </Tooltip>
  )
}

/**
 * Full feedback panel — combines thumbs, rating, and correction tools.
 */
export function FeedbackPanel({
  entityType,
  entityId,
  showRating = true,
  showThumbs = true,
  showQuality = true,
  qualityScore = null,
  onFeedbackSubmit,
}) {
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' })

  const handleSubmit = useCallback(
    async (payload) => {
      try {
        if (onFeedbackSubmit) {
          await onFeedbackSubmit(payload)
        } else {
          // Default: POST directly to feedback API
          if (payload.thumbs_up !== undefined) {
            await api.post('/feedback/thumbs', payload)
          } else if (payload.rating !== undefined) {
            await api.post('/feedback/rating', payload)
          }
        }
        setToast({ open: true, message: 'Feedback submitted!', severity: 'success' })
      } catch (err) {
        setToast({ open: true, message: 'Failed to submit feedback', severity: 'error' })
      }
    },
    [onFeedbackSubmit]
  )

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
        {showQuality && qualityScore !== null && <QualityBadge score={qualityScore} />}

        {showThumbs && (
          <ThumbsFeedback
            entityType={entityType}
            entityId={entityId}
            onSubmit={handleSubmit}
          />
        )}

        {showRating && (
          <StarRating
            entityType={entityType}
            entityId={entityId}
            onSubmit={handleSubmit}
          />
        )}
      </Stack>

      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Paper>
  )
}

// === From: shell.jsx ===

const RECENT_KEY = 'neurareport_recent_commands'
const MAX_RECENT = 6

const ICON_MAP = {
  dashboard: DashboardOutlinedIcon,
  connections: StorageOutlinedIcon,
  templates: DescriptionOutlinedIcon,
  reports: AssessmentOutlinedIcon,
  jobs: WorkOutlineIcon,
  schedules: ScheduleIcon,
  analyze: DocumentScannerOutlinedIcon,
  history: HistoryIcon,
  activity: TimelineIcon,
  settings: SettingsOutlinedIcon,
  action: AddIcon,
  search: SearchIcon,
  recent: HistoryIcon,
  query: QuestionAnswerOutlinedIcon,
  enrichment: AutoFixHighOutlinedIcon,
  federation: JoinInnerOutlinedIcon,
  synthesis: MergeOutlinedIcon,
  docqa: ChatOutlinedIcon,
  summary: SummarizeOutlinedIcon,
  stats: BarChartOutlinedIcon,
  ops: AdminPanelSettingsOutlinedIcon,
  assistant: SmartToyOutlinedIcon,
}

const loadRecentCommands = () => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const persistRecentCommands = (items) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(items))
  } catch {
    // ignore storage failures
  }
}

const fuzzyScore = (query, text) => {
  if (!query || !text) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let score = 0
  let qi = 0
  let streak = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) {
      qi += 1
      streak += 1
      score += 5 + streak * 2
    } else {
      streak = 0
      score -= 1
    }
  }
  if (qi < q.length) return 0
  if (t.startsWith(q)) score += 8
  return score
}

const COMMANDS = [
  {
    id: 'nav-dashboard',
    label: 'Go to Dashboard',
    description: 'View overview and analytics',
    icon: DashboardOutlinedIcon,
    iconKey: 'dashboard',
    action: 'navigate',
    path: '/',
    group: 'Navigation',
  },
  {
    id: 'nav-connections',
    label: 'Go to Connections',
    description: 'Manage database connections',
    icon: StorageOutlinedIcon,
    iconKey: 'connections',
    action: 'navigate',
    path: '/connections',
    group: 'Navigation',
  },
  {
    id: 'nav-templates',
    label: 'Go to Templates',
    description: 'Browse and manage templates',
    icon: DescriptionOutlinedIcon,
    iconKey: 'templates',
    action: 'navigate',
    path: '/templates',
    group: 'Navigation',
  },
  {
    id: 'nav-reports',
    label: 'Go to Reports',
    description: 'Generate reports',
    icon: AssessmentOutlinedIcon,
    iconKey: 'reports',
    action: 'navigate',
    path: '/reports',
    group: 'Navigation',
  },
  {
    id: 'nav-jobs',
    label: 'Go to Jobs',
    description: 'View job status',
    icon: WorkOutlineIcon,
    iconKey: 'jobs',
    action: 'navigate',
    path: '/jobs',
    group: 'Navigation',
  },
  {
    id: 'nav-schedules',
    label: 'Go to Schedules',
    description: 'Manage scheduled reports',
    icon: ScheduleIcon,
    iconKey: 'schedules',
    action: 'navigate',
    path: '/schedules',
    group: 'Navigation',
  },
  {
    id: 'nav-analyze',
    label: 'Go to Analyze',
    description: 'AI document analysis',
    icon: DocumentScannerOutlinedIcon,
    iconKey: 'analyze',
    action: 'navigate',
    path: '/analyze',
    group: 'Navigation',
  },
  {
    id: 'nav-history',
    label: 'Go to History',
    description: 'View report history',
    icon: HistoryIcon,
    iconKey: 'history',
    action: 'navigate',
    path: '/history',
    group: 'Navigation',
  },
  {
    id: 'nav-activity',
    label: 'Go to Activity',
    description: 'View activity log',
    icon: TimelineIcon,
    iconKey: 'activity',
    action: 'navigate',
    path: '/activity',
    group: 'Navigation',
  },
  {
    id: 'nav-settings',
    label: 'Go to Settings',
    description: 'Application settings',
    icon: SettingsOutlinedIcon,
    iconKey: 'settings',
    action: 'navigate',
    path: '/settings',
    group: 'Navigation',
  },
  {
    id: 'nav-query',
    label: 'Go to Query Builder',
    description: 'Build queries with natural language',
    icon: QuestionAnswerOutlinedIcon,
    iconKey: 'query',
    action: 'navigate',
    path: '/query',
    group: 'Setup',
  },
  {
    id: 'nav-enrichment',
    label: 'Go to Data Enrichment',
    description: 'Enrich data with AI-powered sources',
    icon: AutoFixHighOutlinedIcon,
    iconKey: 'enrichment',
    action: 'navigate',
    path: '/enrichment',
    group: 'Setup',
  },
  {
    id: 'nav-federation',
    label: 'Go to Combine Sources',
    description: 'Federate multiple data sources',
    icon: JoinInnerOutlinedIcon,
    iconKey: 'federation',
    action: 'navigate',
    path: '/federation',
    group: 'Setup',
  },
  {
    id: 'nav-synthesis',
    label: 'Go to Document Synthesis',
    description: 'Combine and synthesize documents',
    icon: MergeOutlinedIcon,
    iconKey: 'synthesis',
    action: 'navigate',
    path: '/synthesis',
    group: 'AI Tools',
  },
  {
    id: 'nav-docqa',
    label: 'Go to Ask Documents',
    description: 'Ask questions about your documents',
    icon: ChatOutlinedIcon,
    iconKey: 'docqa',
    action: 'navigate',
    path: '/docqa',
    group: 'AI Tools',
  },
  {
    id: 'nav-summary',
    label: 'Go to Summarize',
    description: 'Generate AI summaries of content',
    icon: SummarizeOutlinedIcon,
    iconKey: 'summary',
    action: 'navigate',
    path: '/summary',
    group: 'AI Tools',
  },
  {
    id: 'nav-stats',
    label: 'Go to Usage Stats',
    description: 'View usage statistics',
    icon: BarChartOutlinedIcon,
    iconKey: 'stats',
    action: 'navigate',
    path: '/stats',
    group: 'System',
  },
  {
    id: 'nav-ops',
    label: 'Go to Ops Console',
    description: 'Access health, auth, and job utilities',
    icon: AdminPanelSettingsOutlinedIcon,
    iconKey: 'ops',
    action: 'navigate',
    path: '/ops',
    group: 'System',
  },
  {
    id: 'new-report',
    label: 'New Report',
    description: 'Start a new report generation',
    icon: AddIcon,
    iconKey: 'action',
    action: 'navigate',
    path: '/pipeline',
    group: 'Actions',
    shortcut: '⌘N',
  },
  {
    id: 'open-assistant',
    label: 'Open Assistant',
    description: 'Ask for help with NeuraReport',
    icon: SmartToyOutlinedIcon,
    iconKey: 'assistant',
    action: 'event',
    event: 'neura:open-assistant',
    group: 'Actions',
    shortcut: '⌘/',
  },
]

// Map search result types to icons and paths
const SEARCH_TYPE_CONFIG = {
  template: {
    icon: DescriptionOutlinedIcon,
    iconKey: 'templates',
    pathBuilder: (item) => `/templates/${item.id}/edit`,
    label: 'Template',
  },
  connection: {
    icon: StorageOutlinedIcon,
    iconKey: 'connections',
    pathBuilder: () => '/connections',
    label: 'Connection',
  },
  job: {
    icon: WorkOutlineIcon,
    iconKey: 'jobs',
    pathBuilder: () => '/jobs',
    label: 'Job',
  },
  schedule: {
    icon: ScheduleIcon,
    iconKey: 'schedules',
    pathBuilder: () => '/schedules',
    label: 'Schedule',
  },
}

export function CommandPalette({ open, onClose }) {
  const navigate = useNavigate()
  const { execute } = useInteraction()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [recentCommands, setRecentCommands] = useState([])
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const searchTimeoutRef = useRef(null)

  const templates = useAppStore((s) => s.templates)
  const approvedTemplates = templates.filter((t) => t.status === 'approved')

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'command-palette', ...intent },
      action,
    })
  }, [execute])

  const handleClose = useCallback(() => {
    return executeUI('Close command palette', () => onClose?.())
  }, [executeUI, onClose])

  const updateRecentCommands = useCallback((entry) => {
    setRecentCommands((prev) => {
      const next = [entry, ...prev.filter((item) => item.id !== entry.id)].slice(0, MAX_RECENT)
      persistRecentCommands(next)
      return next
    })
  }, [])

  // Debounced search effect
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed || trimmed.length < 2) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    // Cap query length to prevent oversized requests
    const cappedQuery = trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed

    setIsSearching(true)

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Debounce search
    searchTimeoutRef.current = setTimeout(() => {
      execute({
        type: InteractionType.EXECUTE,
        label: 'Search command palette',
        reversibility: Reversibility.FULLY_REVERSIBLE,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: { source: 'command-palette', query: cappedQuery },
        action: async () => {
          try {
            const result = await globalSearch(cappedQuery, { limit: 10 })
            setSearchResults(result.results || [])
          } catch (err) {
            console.error('Search failed:', err)
            setSearchResults([])
          }
        },
      }).finally(() => setIsSearching(false))
    }, 200)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [execute, query])

  // Build full command list including templates and search results
  const allCommands = useMemo(() => {
    const templateCommands = approvedTemplates.slice(0, 5).map((t) => ({
      id: `template-${t.id}`,
      label: t.name,
      description: 'Edit template',
      icon: DescriptionOutlinedIcon,
      iconKey: 'templates',
      action: 'navigate',
      path: `/templates/${t.id}/edit`,
      group: 'Recent Templates',
    }))

    // Convert search results to command format
    const searchCommands = searchResults.map((result) => {
      const config = SEARCH_TYPE_CONFIG[result.type] || {
        icon: DescriptionOutlinedIcon,
        iconKey: 'templates',
        pathBuilder: () => '/',
        label: 'Item',
      }
      return {
        id: `search-${result.type}-${result.id}`,
        label: result.name,
        description: result.description || `${config.label}`,
        icon: config.icon,
        iconKey: config.iconKey,
        action: 'navigate',
        path: config.pathBuilder(result),
        group: 'Search Results',
        type: result.type,
        score: result.score,
      }
    })

    const recent = recentCommands.map((entry) => ({
      ...entry,
      icon: ICON_MAP[entry.iconKey] || HistoryIcon,
      action: 'navigate',
      group: 'Recent',
    }))

    return [...recent, ...searchCommands, ...COMMANDS, ...templateCommands]
  }, [approvedTemplates, searchResults, recentCommands])

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return allCommands
    const q = query.trim()
    const searchCommands = allCommands.filter((cmd) => cmd.group === 'Search Results')
    const otherCommands = allCommands.filter((cmd) => cmd.group !== 'Search Results')
    const rankedOthers = otherCommands
      .map((cmd) => {
        const labelScore = fuzzyScore(q, cmd.label || '')
        const descScore = fuzzyScore(q, cmd.description || '')
        const groupScore = fuzzyScore(q, cmd.group || '')
        const score = Math.max(labelScore, descScore, groupScore)
        return { cmd, score }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.cmd)
    return searchCommands.length
      ? [...searchCommands, ...rankedOthers.slice(0, 8)]
      : rankedOthers
  }, [allCommands, query])

  // Group commands
  const groupedCommands = useMemo(() => {
    const groups = {}
    filteredCommands.forEach((cmd) => {
      const group = cmd.group || 'Other'
      if (!groups[group]) groups[group] = []
      groups[group].push(cmd)
    })
    return groups
  }, [filteredCommands])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setSearchResults([])
      setIsSearching(false)
      setRecentCommands(loadRecentCommands())
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= filteredCommands.length) {
      setSelectedIndex(Math.max(0, filteredCommands.length - 1))
    }
  }, [filteredCommands.length, selectedIndex])

  // Execute command
  const executeCommand = useCallback(
    (cmd) => {
      if (!cmd) return undefined
      return execute({
        type: cmd.action === 'navigate' ? InteractionType.NAVIGATE : InteractionType.EXECUTE,
        label: cmd.label || 'Run command',
        reversibility: Reversibility.FULLY_REVERSIBLE,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: {
          source: 'command-palette',
          commandId: cmd.id,
          action: cmd.action,
          path: cmd.path,
          group: cmd.group,
        },
        action: async () => {
          if (cmd?.action === 'navigate' && cmd?.path) {
            updateRecentCommands({
              id: cmd.id,
              label: cmd.label,
              description: cmd.description,
              path: cmd.path,
              iconKey: cmd.iconKey || cmd.type || 'recent',
            })
            navigate(cmd.path)
          } else if (cmd?.action === 'event' && cmd?.event) {
            window.dispatchEvent(new Event(cmd.event))
          } else if (typeof cmd.action === 'function') {
            await cmd.action()
          }
          onClose?.()
        },
      })
    },
    [execute, navigate, onClose, updateRecentCommands]
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            executeCommand(filteredCommands[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          handleClose()
          break
      }
    },
    [filteredCommands, selectedIndex, executeCommand, handleClose]
  )

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`)
      selectedEl?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Pre-compute flat index mapping for concurrent-mode safe rendering
  const flatIndexMap = useMemo(() => {
    const map = new Map()
    let idx = 0
    Object.entries(groupedCommands).forEach(([, commands]) => {
      commands.forEach((cmd) => {
        map.set(cmd.id, idx++)
      })
    })
    return map
  }, [groupedCommands])

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: (theme) => ({
          borderRadius: 1,  // Figma spec: 8px
          overflow: 'hidden',
          maxHeight: '70vh',
          background: theme.palette.mode === 'dark'
            ? 'rgba(30, 30, 30, 0.92)'
            : 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(12px)',
          border: '2px solid',
          borderColor: theme.palette.common.black,
        }),
      }}
      slotProps={{
        backdrop: {
          sx: {
            bgcolor: (theme) => alpha(theme.palette.background.default, 0.8),
            backdropFilter: 'blur(4px)',
          },
        },
      }}
    >
      {/* Search Input */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <TextField
          ref={inputRef}
          fullWidth
          placeholder="Search commands, templates, connections..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                {isSearching ? (
                  <CircularProgress size={20} sx={{ color: 'text.secondary' }} />
                ) : (
                  <SearchIcon sx={{ color: 'text.secondary' }} />
                )}
              </InputAdornment>
            ),
            sx: {
              '& .MuiOutlinedInput-notchedOutline': {
                border: 'none',
              },
            },
          }}
          sx={{
            '& .MuiInputBase-root': {
              bgcolor: 'action.hover',
              borderRadius: 1,  // Figma spec: 8px
            },
          }}
        />
      </Box>

      {/* Command List */}
      <Box ref={listRef} sx={{ overflow: 'auto', maxHeight: 400 }}>
        {Object.entries(groupedCommands).map(([groupName, commands], groupIdx) => (
          <Box key={groupName}>
            {groupIdx > 0 && <Divider />}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ px: 2, py: 1, display: 'block', fontWeight: 600 }}
            >
              {groupName}
            </Typography>
            <List dense disablePadding sx={{ pb: 1 }}>
              {commands.map((cmd) => {
                const index = flatIndexMap.get(cmd.id) ?? 0
                const Icon = cmd.icon || ICON_MAP[cmd.iconKey] || DescriptionOutlinedIcon
                const isSelected = index === selectedIndex

                return (
                  <ListItem key={cmd.id} disablePadding data-index={index}>
                    <ListItemButton
                      selected={isSelected}
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      sx={{
                        mx: 1,
                        borderRadius: 1,  // Figma spec: 8px
                        '&.Mui-selected': {
                          bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                          color: 'primary.contrastText',
                          '&:hover': {
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                          },
                          '& .MuiListItemIcon-root': {
                            color: 'inherit',
                          },
                          '& .MuiTypography-root': {
                            color: 'inherit',
                          },
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Icon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={cmd.label}
                        secondary={cmd.description}
                        primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: 500 }}
                        secondaryTypographyProps={{
                          fontSize: '0.75rem',
                          sx: { opacity: isSelected ? 0.8 : 0.6 },
                        }}
                      />
                      {cmd.type && (
                        <Chip
                          label={cmd.type}
                          size="small"
                          sx={{
                            ml: 1,
                            height: 20,
                            fontSize: '10px',
                            textTransform: 'capitalize',
                            bgcolor: isSelected ? (theme) => alpha(theme.palette.common.white, 0.2) : 'action.selected',
                          }}
                        />
                      )}
                      {cmd.shortcut && (
                        <Kbd size="small" sx={{ opacity: isSelected ? 1 : 0.5 }}>
                          {cmd.shortcut}
                        </Kbd>
                      )}
                    </ListItemButton>
                  </ListItem>
                )
              })}
            </List>
          </Box>
        ))}

        {filteredCommands.length === 0 && !isSearching && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">
              {query.trim() ? 'No results found' : 'Type to search commands, templates, and connections'}
            </Typography>
          </Box>
        )}
        {isSearching && filteredCommands.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <CircularProgress size={24} />
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Searching...
            </Typography>
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Box
        sx={{
          p: 1.5,
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'action.hover',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            <Typography variant="caption" color="text.secondary">
              navigate
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Kbd>↵</Kbd>
            <Typography variant="caption" color="text.secondary">
              select
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Kbd>esc</Kbd>
            <Typography variant="caption" color="text.secondary">
              close
            </Typography>
          </Box>
        </Box>
      </Box>
    </Dialog>
  )
}
