import { figmaSpacing, fontFamilyBody, fontFamilyDisplay, fontFamilyHeading, fontFamilyUI, neutral, palette, primary, secondary } from '@/app/theme'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { SHORTCUTS, getShortcutDisplay, useJobsList } from '@/hooks/hooks'
import { useAppStore } from '@/stores/app'
import { fadeIn } from '@/styles/styles'
import {
  CheckCircle as CheckCircleIcon,
  Download as DownloadIcon,
  ErrorOutline as ErrorOutlineIcon,
  HelpOutline as HelpOutlineIcon,
  Keyboard as KeyboardIcon,
  Logout as LogoutIcon,
  Menu as MenuIcon,
  OpenInNew as OpenInNewIcon,
  PersonOutline as PersonOutlineIcon,
  Search as SearchIcon,
  Settings as SettingsIcon,
  SmartToyOutlined as SmartToyOutlinedIcon,
  Work as WorkIcon,
} from '@mui/icons-material'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import AddIcon from '@mui/icons-material/Add'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import AssessmentIcon from '@mui/icons-material/Assessment'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import BarChartIcon from '@mui/icons-material/BarChart'
import BubbleChartIcon from '@mui/icons-material/BubbleChart'
import CableIcon from '@mui/icons-material/Cable'
import ChatIcon from '@mui/icons-material/Chat'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DashboardIcon from '@mui/icons-material/Dashboard'
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize'
import DescriptionIcon from '@mui/icons-material/Description'
import EditNoteIcon from '@mui/icons-material/EditNote'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import HistoryIcon from '@mui/icons-material/History'
import HomeIcon from '@mui/icons-material/Home'
import JoinInnerIcon from '@mui/icons-material/JoinInner'
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks'
import MergeIcon from '@mui/icons-material/Merge'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import PaletteIcon from '@mui/icons-material/Palette'
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer'
import ScheduleIcon from '@mui/icons-material/Schedule'
import SensorsIcon from '@mui/icons-material/Sensors'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import StorageIcon from '@mui/icons-material/Storage'
import SummarizeIcon from '@mui/icons-material/Summarize'
import TableChartIcon from '@mui/icons-material/TableChart'
import TimelineIcon from '@mui/icons-material/Timeline'
import WidgetsIcon from '@mui/icons-material/Widgets'
import { AppBar, Avatar, Badge, Box, Breadcrumbs as MuiBreadcrumbs, Button, Chip, CircularProgress, ClickAwayListener, Collapse, Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, Fade, IconButton, InputAdornment, LinearProgress, Link, List, ListItem, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Popper, Stack, TextField, Toolbar, Tooltip, Typography, Zoom, alpha, keyframes, styled, useMediaQuery, useTheme } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, Outlet, useLocation } from 'react-router-dom'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CheckIcon from '@mui/icons-material/Check'
const ROUTE_LABELS = {
  connections: 'Connections',
  templates: 'Templates',
  reports: 'Reports',
  jobs: 'Jobs',
  schedules: 'Schedules',
  analyze: 'Analyze',
  settings: 'Settings',
  setup: 'Setup',
  general: 'General',
  database: 'Database',
  notifications: 'Notifications',
  api: 'API',
  new: 'New',
  edit: 'Edit',
  wizard: 'New Report',
  history: 'History',
  design: 'Brand Kit',
  connectors: 'Connectors',
  ingestion: 'Ingestion',
  query: 'Query Builder',
  enrichment: 'Enrichment',
  federation: 'Federation',
  search: 'Search',
  docqa: 'Chat with Docs',
  agents: 'AI Agents',
  knowledge: 'Knowledge Base',
  summary: 'Summarize',
  synthesis: 'Synthesis',
  documents: 'Documents',
  spreadsheets: 'Spreadsheets',
  'dashboard-builder': 'Dashboard Builder',
  widgets: 'Widgets',
  visualization: 'Visualization',
  workflows: 'Workflows',
  activity: 'Activity',
  stats: 'Usage Stats',
  ops: 'Ops Console',
  legacy: 'Legacy',
  chat: 'Chat Create',
  dashboard: 'Dashboard',
}

export function Breadcrumbs() {
  const theme = useTheme()
  const location = useLocation()

  const crumbs = useMemo(() => {
    const pathnames = location.pathname.split('/').filter((x) => x)

    return pathnames.map((value, index) => {
      const to = `/${pathnames.slice(0, index + 1).join('/')}`
      const label = ROUTE_LABELS[value] || value
      const isLast = index === pathnames.length - 1

      return { to, label, isLast }
    })
  }, [location.pathname])

  if (crumbs.length === 0) {
    return (
      <Typography
        sx={{
          fontSize: '14px',
          fontWeight: 500,
          color: theme.palette.text.primary,
        }}
      >
        Dashboard
      </Typography>
    )
  }

  return (
    <MuiBreadcrumbs
      separator={
        <NavigateNextIcon
          sx={{
            fontSize: 14,
            color: theme.palette.text.disabled,
            mx: 0.25,
          }}
        />
      }
      aria-label="breadcrumb"
    >
      <Link
        component={RouterLink}
        to="/"
        underline="none"
        data-testid="breadcrumb-home-link"
        sx={{
          display: 'flex',
          alignItems: 'center',
          color: theme.palette.text.secondary,
          transition: 'color 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
          '&:hover': { color: theme.palette.text.primary },
        }}
      >
        <HomeIcon sx={{ fontSize: 16 }} />
      </Link>
      {crumbs.map((crumb) =>
        crumb.isLast ? (
          <Typography
            key={crumb.to}
            sx={{
              fontSize: '14px',
              fontWeight: 500,
              color: theme.palette.text.primary,
            }}
          >
            {crumb.label}
          </Typography>
        ) : (
          <Link
            key={crumb.to}
            component={RouterLink}
            to={crumb.to}
            underline="none"
            data-testid={`breadcrumb-link-${crumb.label.toLowerCase().replace(/\s+/g, '-')}`}
            sx={{
              fontSize: '14px',
              fontWeight: 400,
              color: theme.palette.text.secondary,
              transition: 'color 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
              '&:hover': { color: theme.palette.text.primary },
            }}
          >
            {crumb.label}
          </Link>
        )
      )}
    </MuiBreadcrumbs>
  )
}

// === From: GlobalSearch.jsx ===
/**
 * Premium Global Search
 * Command palette style search with theme-based styling
 */


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


const getTypeConfig = (theme, type) => {
  const configs = {
    template: { icon: DescriptionIcon, color: theme.palette.text.secondary, label: 'Template' },
    connection: { icon: StorageIcon, color: theme.palette.text.secondary, label: 'Connection' },
    job: { icon: WorkIcon, color: theme.palette.text.secondary, label: 'Job' },
  }
  return configs[type] || configs.template
}

const SEARCH_ROUTE_BY_TYPE = {
  template: (result) => (result?.id ? `/templates/${result.id}/edit` : '/templates'),
  connection: () => '/connections',
  job: () => '/jobs',
}


function SearchResult({ result, onSelect, isSelected, theme }) {
  const config = getTypeConfig(theme, result.type)
  const Icon = config.icon

  return (
    <ListItem
      onClick={() => onSelect(result)}
      data-testid={`search-result-${result.type}-${result.id}`}
      sx={{
        px: 2,
        py: 1.5,
        cursor: 'pointer',
        bgcolor: isSelected ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100]) : 'transparent',
        transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
        '&:hover': {
          bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
        },
      }}
    >
      <ListItemIcon sx={{ minWidth: 36 }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '8px',
            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon sx={{ fontSize: 14, color: 'text.secondary' }} />
        </Box>
      </ListItemIcon>
      <ListItemText
        primary={result.name}
        secondary={result.description}
        primaryTypographyProps={{
          fontSize: '14px',
          fontWeight: 500,
          color: theme.palette.text.primary,
        }}
        secondaryTypographyProps={{
          fontSize: '0.75rem',
          color: theme.palette.text.secondary,
        }}
      />
      <Chip
        label={config.label}
        size="small"
        sx={{
          bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
          color: 'text.secondary',
          fontSize: '0.625rem',
          height: 20,
          borderRadius: 1.5,
        }}
      />
    </ListItem>
  )
}


function GlobalSearch({
  variant = 'compact',
  enableShortcut = true,
  showShortcutHint = true,
  placeholder,
}) {
  const theme = useTheme()
  const { execute } = useInteraction()
  const navigate = useNavigateInteraction()
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { source: 'global-search', ...intent } }),
    [navigate]
  )
  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'global-search', ...intent },
      action,
    })
  }, [execute])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [hasSearched, setHasSearched] = useState(false)
  const inputRef = useRef(null)
  const anchorRef = useRef(null)
  const debounceRef = useRef(null)
  const inputPlaceholder = placeholder || (enableShortcut ? 'Search... (Ctrl+K)' : 'Search...')

  // Keyboard shortcut to focus search (Ctrl/Cmd + K)
  useEffect(() => {
    if (!enableShortcut) return undefined
    const handleKeyDown = (e) => {
      if (e.defaultPrevented) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enableShortcut, open])

  // Handle result selection
  const handleSelect = useCallback((result) => {
    setOpen(false)
    setQuery('')
    setResults([])
    if (result?.url) {
      handleNavigate(result.url, `Open ${result.label}`, { resultType: result.type, resultId: result.id })
      return
    }
    const typeKey = result?.type ? String(result.type).toLowerCase() : ''
    const routeBuilder = SEARCH_ROUTE_BY_TYPE[typeKey]
    if (routeBuilder) {
      const nextPath = routeBuilder(result)
      if (nextPath) {
        handleNavigate(nextPath, `Open ${result.label}`, { resultType: result.type, resultId: result.id })
      }
    }
  }, [handleNavigate])

  // Handle arrow key navigation
  const handleKeyDown = useCallback((e) => {
    if (!open || results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault()
      handleSelect(results[selectedIndex])
    }
  }, [open, results, selectedIndex, handleSelect])

  const handleSearch = useCallback((searchQuery) => {
    const normalizedQuery = searchQuery?.trim() || ''
    if (!normalizedQuery || normalizedQuery.length < 2) {
      setResults([])
      setOpen(false)
      setHasSearched(false)
      setSelectedIndex(-1)
      return
    }

    setLoading(true)
    setHasSearched(true)
    execute({
      type: InteractionType.EXECUTE,
      label: 'Search',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'global-search', query: normalizedQuery },
      action: async () => {
        try {
          const data = await api.globalSearch(normalizedQuery, { limit: 10 })
          const nextResults = data.results || []
          const isFocused =
            typeof document !== 'undefined' && document.activeElement === inputRef.current
          setResults(nextResults)
          setOpen(isFocused)
          setSelectedIndex(-1)
        } catch (err) {
          console.error('Search failed:', err)
          const isFocused =
            typeof document !== 'undefined' && document.activeElement === inputRef.current
          setResults([])
          setOpen(isFocused)
        }
      },
    }).finally(() => setLoading(false))
  }, [execute])

  const handleInputChange = useCallback((e) => {
    const value = e.target.value
    setQuery(value)

    // Debounce search
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      handleSearch(value)
    }, 300)
  }, [handleSearch])

  const handleFocus = useCallback(() => {
    if (hasSearched && query.trim().length >= 2) {
      executeUI('Open search results', () => setOpen(true))
    }
  }, [executeUI, hasSearched, query])

  const handleClickAway = useCallback(() => {
    executeUI('Close search results', () => setOpen(false))
  }, [executeUI])

  const isCompact = variant === 'compact'

  return (
    <ClickAwayListener onClickAway={handleClickAway}>
      <Box ref={anchorRef} sx={{ position: 'relative', width: isCompact ? 240 : 320 }}>
        <TextField
          inputRef={inputRef}
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder={inputPlaceholder}
          size="small"
          fullWidth
          data-testid="global-search-input"
          inputProps={{ 'aria-label': 'Search' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                {loading ? (
                  <CircularProgress size={16} sx={{ color: theme.palette.text.secondary }} />
                ) : (
                  <SearchIcon sx={{ fontSize: 18, color: theme.palette.text.secondary }} />
                )}
              </InputAdornment>
            ),
            endAdornment: isCompact && showShortcutHint && enableShortcut && (
              <InputAdornment position="end">
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.25,
                    px: 0.5,
                    py: 0.25,
                    bgcolor: alpha(theme.palette.text.primary, 0.08),
                    borderRadius: 1,  // Figma spec: 8px
                  }}
                >
                  <KeyboardIcon sx={{ fontSize: 12, color: theme.palette.text.disabled }} />
                  <Typography sx={{ fontSize: '0.625rem', color: theme.palette.text.disabled }}>K</Typography>
                </Box>
              </InputAdornment>
            ),
            sx: {
              bgcolor: alpha(theme.palette.background.paper, 0.5),
              borderRadius: 1,  // Figma spec: 8px
              transition: 'all 0.2s ease',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: alpha(theme.palette.divider, 0.15),
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: alpha(theme.palette.divider, 0.3),
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
              },
              '& input': {
                fontSize: '14px',
                color: theme.palette.text.primary,
                '&::placeholder': {
                  color: theme.palette.text.secondary,
                  opacity: 1,
                },
              },
            },
          }}
        />

        <Popper
          open={open}
          anchorEl={anchorRef.current}
          placement="bottom-start"
          style={{ width: anchorRef.current?.offsetWidth || 300, zIndex: 1300 }}
        >
          <Paper
            sx={{
              mt: 0.5,
              bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.background.paper, 0.92) : 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(12px)',
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
              borderRadius: 1,  // Figma spec: 8px
              boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.2)}`,
              maxHeight: 400,
              overflow: 'auto',
              animation: `${fadeInUp} 0.2s ease-out`,
            }}
          >
            {results.length === 0 ? (
              <Box sx={{ p: 2, textAlign: 'center' }}>
                <Typography sx={{ color: theme.palette.text.secondary, fontSize: '14px' }}>
                  No results found
                </Typography>
              </Box>
            ) : (
              <List disablePadding>
                {results.map((result, index) => (
                  <SearchResult
                    key={`${result.type}-${result.id}`}
                    result={result}
                    onSelect={handleSelect}
                    isSelected={index === selectedIndex}
                    theme={theme}
                  />
                ))}
              </List>
            )}
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  )
}

// === From: Sidebar.jsx ===
/**
 * Premium Sidebar Navigation
 * Sophisticated sidebar with glassmorphism, smooth animations, and modern interactions
 */

// Icons

// Import design tokens

const FIGMA_SIDEBAR = {
  width: figmaSpacing.sidebarWidth,  // 250px
  background: neutral[50],         // #F9F9F8
  padding: { horizontal: 16, vertical: 20 },
  borderRadius: 8,
  itemHeight: 40,
  itemGap: 12,
  iconSize: 20,
}


const slideIn = keyframes`
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
`

const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
`

const glow = keyframes`
  0%, 100% { box-shadow: 0 0 10px ${alpha(secondary.violet[500], 0.3)}; }
  50% { box-shadow: 0 0 20px ${alpha(secondary.violet[500], 0.5)}; }
`


// Full navigation structure — all pages visible
const NAV_ITEMS = [
  {
    section: 'Home',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: DashboardIcon, path: '/', description: 'Overview & quick actions' },
    ],
  },
  {
    section: 'Reports',
    items: [
      { key: 'reports', label: 'My Reports', icon: AssessmentIcon, path: '/reports', description: 'View and download reports' },
      { key: 'history', label: 'History', icon: HistoryIcon, path: '/history', description: 'Past report runs' },
      { key: 'templates', label: 'Templates', icon: DescriptionIcon, path: '/templates', description: 'Report designs & layouts' },
      { key: 'design', label: 'Brand Kit', icon: PaletteIcon, path: '/design', description: 'Colors, fonts & logos' },
      { key: 'jobs', label: 'Running Jobs', icon: WorkIcon, path: '/jobs', badge: true, description: 'Report generation progress' },
      { key: 'schedules', label: 'Schedules', icon: ScheduleIcon, path: '/schedules', description: 'Automated report runs' },
    ],
  },
  {
    section: 'Data',
    collapsible: true,
    items: [
      { key: 'connections', label: 'Data Sources', icon: StorageIcon, path: '/connections', description: 'Database connections' },
      { key: 'logger', label: 'Logger', icon: SensorsIcon, path: '/logger', description: 'PLC data logger' },
      { key: 'connectors', label: 'Connectors', icon: CableIcon, path: '/connectors', description: 'Cloud & DB connectors' },
      { key: 'ingestion', label: 'Ingestion', icon: CloudUploadIcon, path: '/ingestion', description: 'Import documents & data' },
      { key: 'query', label: 'Query Builder', icon: QuestionAnswerIcon, path: '/query', description: 'Natural language to SQL' },
      { key: 'enrichment', label: 'Enrichment', icon: AutoFixHighIcon, path: '/enrichment', description: 'AI data enrichment' },
      { key: 'federation', label: 'Combine Sources', icon: JoinInnerIcon, path: '/federation', description: 'Cross-database federation' },
      { key: 'search', label: 'Search', icon: SearchIcon, path: '/search', description: 'Find anything' },
    ],
  },
  {
    section: 'AI Assistant',
    collapsible: true,
    items: [
      { key: 'analyze', label: 'Analyze', icon: AutoAwesomeIcon, path: '/analyze', highlight: true, description: 'AI document analysis & charts' },
      { key: 'docqa', label: 'Chat with Docs', icon: ChatIcon, path: '/docqa', description: 'Ask questions about documents' },
      { key: 'agents', label: 'AI Agents', icon: SmartToyIcon, path: '/agents', description: 'Research, analyze, write' },
      { key: 'knowledge', label: 'Knowledge Base', icon: LibraryBooksIcon, path: '/knowledge', description: 'Document library' },
      { key: 'summary', label: 'Summarize', icon: SummarizeIcon, path: '/summary', description: 'Executive summaries' },
      { key: 'synthesis', label: 'Synthesis', icon: MergeIcon, path: '/synthesis', description: 'Multi-document synthesis' },
    ],
  },
  {
    section: 'Create',
    collapsible: true,
    items: [
      { key: 'documents', label: 'Documents', icon: EditNoteIcon, path: '/documents', description: 'Write with AI help' },
      { key: 'spreadsheets', label: 'Spreadsheets', icon: TableChartIcon, path: '/spreadsheets', description: 'Data & formulas' },
      { key: 'dashboard-builder', label: 'Dashboards', icon: DashboardCustomizeIcon, path: '/dashboard-builder', description: 'Visual analytics' },
      { key: 'widgets', label: 'Widgets', icon: WidgetsIcon, path: '/widgets', description: 'AI-powered widget catalog' },
      { key: 'visualization', label: 'Diagrams', icon: BubbleChartIcon, path: '/visualization', description: 'Flowcharts, mindmaps & more' },
      { key: 'workflows', label: 'Workflows', icon: AccountTreeIcon, path: '/workflows', description: 'Automation builder' },
    ],
  },
  {
    section: 'Admin',
    collapsible: true,
    items: [
      { key: 'settings', label: 'Settings', icon: SettingsIcon, path: '/settings', description: 'Preferences & account' },
      { key: 'activity', label: 'Activity Log', icon: TimelineIcon, path: '/activity', description: 'User & system events' },
      { key: 'stats', label: 'Usage Stats', icon: BarChartIcon, path: '/stats', description: 'Analytics & metrics' },
      { key: 'ops', label: 'Ops Console', icon: AdminPanelSettingsIcon, path: '/ops', description: 'System administration' },
    ],
  },
]

// No legacy routes — all pages are now in the sidebar


const SidebarContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: FIGMA_SIDEBAR.width,  // 250px from Figma
  // Sidebar background from Figma - Grey/200
  backgroundColor: theme.palette.mode === 'dark' ? palette.scale[1000] : neutral[50],
  borderRight: 'none',  // No border per Figma design
  borderRadius: FIGMA_SIDEBAR.borderRadius,  // 8px from Figma
  padding: `${FIGMA_SIDEBAR.padding.vertical}px ${FIGMA_SIDEBAR.padding.horizontal}px`,
  position: 'relative',
}))

const LogoContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'collapsed',
})(({ theme, collapsed }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: collapsed ? 'center' : 'space-between',
  padding: theme.spacing(2.5, 2),
  minHeight: 64,
  borderBottom: 'none',
}))

const LogoBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 6,
  overflow: 'hidden',
  '& img': {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
}))

const NewReportButton = styled(Box)(({ theme }) => ({
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  padding: theme.spacing(1, 1.5),
  borderRadius: 0,
  height: 40,
  // Match nav item style from Figma
  backgroundColor: 'transparent',
  color: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
  cursor: 'pointer',
  transition: 'background-color 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  width: '100%',
  textAlign: 'left',
  font: 'inherit',

  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.04)
      : neutral[100],  // Grey/300
  },

  '&:focus-visible': {
    outline: `2px solid ${alpha(theme.palette.text.primary, 0.35)}`,
    outlineOffset: 2,
  },
}))

const SectionHeader = styled(Box, {
  shouldForwardProp: (prop) => !['collapsed', 'collapsible'].includes(prop),
})(({ theme, collapsed, collapsible }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(1.5, 2, 0.75),
  cursor: collapsible ? 'pointer' : 'default',

  ...(collapsible && {
    '&:hover': {
      '& .expand-icon': {
        color: theme.palette.text.secondary,
      },
    },
  }),
}))

// FIGMA NAV ITEM BUTTON (EXACT from Figma sidebar navigation specs)
// Height: 40px, Gap: 8px (icon to text), Border-radius: 8px
// Active: #E9E8E6 background, Text: Inter Medium 16px
const NavItemButton = styled(Box, {
  shouldForwardProp: (prop) => !['active', 'collapsed', 'highlight'].includes(prop),
})(({ theme, active, collapsed, highlight }) => ({
  border: 'none',
  backgroundColor: 'transparent',
  display: 'flex',
  alignItems: 'center',
  gap: 8,  // 8px gap from Figma
  padding: '10px 12px',
  margin: 0,
  borderRadius: 8,  // 8px from Figma
  cursor: 'pointer',
  position: 'relative',
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  justifyContent: collapsed ? 'center' : 'flex-start',
  height: FIGMA_SIDEBAR.itemHeight,  // 40px from Figma
  fontFamily: fontFamilyUI,  // Inter from Figma
  width: '100%',
  textAlign: 'left',
  font: 'inherit',

  // Active state from Figma - Grey/400 background
  ...(active && {
    backgroundColor: theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.08)
      : neutral[200],  // #E9E8E6 from Figma
    color: theme.palette.mode === 'dark'
      ? neutral[100]
      : neutral[900],  // #21201C from Figma
  }),

  // Inactive state - Grey/1100 text
  ...(!active && {
    color: theme.palette.mode === 'dark'
      ? neutral[500]  // #8D8D86
      : neutral[700],  // #63635E from Figma

    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark'
        ? alpha(theme.palette.common.white, 0.04)
        : neutral[100],  // #F1F0EF on hover
      color: theme.palette.mode === 'dark'
        ? neutral[100]
        : neutral[900],  // #21201C on hover
    },
  }),

  // Highlight items - same as regular, no special treatment
  ...(highlight && !active && {
    backgroundColor: 'transparent',

    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark'
        ? alpha(theme.palette.common.white, 0.04)
        : neutral[100],
    },
  }),

  '&:focus-visible': {
    outline: `2px solid ${alpha(theme.palette.text.primary, 0.35)}`,
    outlineOffset: 2,
  },
}))

// FIGMA NAV ICON (EXACT from Figma: 20x20px)
const NavIcon = styled(Box, {
  shouldForwardProp: (prop) => !['active', 'highlight'].includes(prop),
})(({ theme, active, highlight }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: FIGMA_SIDEBAR.iconSize,  // 20px from Figma
  height: FIGMA_SIDEBAR.iconSize,  // 20px from Figma
  flexShrink: 0,
  transition: 'transform 0.2s ease',

  '& svg': {
    fontSize: FIGMA_SIDEBAR.iconSize,  // 20px from Figma
    // Icon color from Figma - Grey/900 for inactive, Grey/1100 for active
    color: active
      ? (theme.palette.mode === 'dark' ? neutral[100] : neutral[700])
      : (theme.palette.mode === 'dark' ? neutral[500] : neutral[500]),
  },
}))

const CollapseButton = styled(IconButton)(({ theme }) => ({
  position: 'absolute',
  right: -14,
  top: 72,
  width: 28,
  height: 28,
  backgroundColor: theme.palette.mode === 'dark' ? neutral[900] : theme.palette.common.white,
  border: `1px solid ${theme.palette.mode === 'dark' ? neutral[700] : neutral[200]}`,
  boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  transition: 'all 0.2s ease',
  zIndex: 1,
  color: theme.palette.mode === 'dark' ? neutral[400] : neutral[600],
  opacity: 1,

  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? neutral[700] : neutral[100],
    color: theme.palette.mode === 'dark' ? neutral[100] : neutral[900],
    transform: 'scale(1.1)',
  },

  '& svg': {
    fontSize: 16,
  },
}))


export function Sidebar({ width, collapsed, mobileOpen, onClose, onToggle }) {
  const { execute } = useInteraction()
  const navigate = useNavigateInteraction()
  const location = useLocation()
  const theme = useTheme()
  const [expandedSections, setExpandedSections] = useState({
    Data: true,
    'AI Assistant': true,
    Create: true,
    Admin: false,
  })

  const activeJobs = useAppStore((s) => {
    const jobs = s.jobs || []
    return jobs.filter((j) => j.status === 'running' || j.status === 'pending').length
  })

  const handleNavigate = useCallback((path, label) => {
    const resolvedLabel = label || `Open ${path}`
    navigate(path, {
      label: resolvedLabel,
      intent: { source: 'sidebar', path },
    })
    onClose?.()
  }, [navigate, onClose])

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'sidebar', ...intent },
      action,
    })
  }, [execute])

  const handleToggleSection = useCallback((section) => {
    const isExpanded = expandedSections[section] !== false
    const nextLabel = isExpanded ? 'Collapse' : 'Expand'
    return executeUI(
      `${nextLabel} ${section} section`,
      () => setExpandedSections(prev => ({
        ...prev,
        [section]: !prev[section],
      })),
      { section, expanded: !isExpanded }
    )
  }, [executeUI, expandedSections])

  const handleToggleSidebar = useCallback(() => {
    return executeUI(
      collapsed ? 'Expand sidebar' : 'Collapse sidebar',
      () => onToggle?.(),
      { collapsed: !collapsed }
    )
  }, [executeUI, collapsed, onToggle])

  const handleCloseSidebar = useCallback(() => {
    return executeUI('Close sidebar', () => onClose?.())
  }, [executeUI, onClose])

  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/' || location.pathname === '/dashboard'
    }
    return location.pathname.startsWith(path)
  }

  const sidebarContent = (
    <SidebarContainer>
      {/* Logo/Header */}
      <LogoContainer collapsed={collapsed}>
        {!collapsed && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              cursor: 'pointer',
            }}
            onClick={() => handleNavigate('/')}
          >
            <LogoBox>
              <img src={`${import.meta.env.BASE_URL}logo.png`} alt="NeuraReport" />
            </LogoBox>
            <Typography
              sx={{
                // Display font for logo text (Space Grotesk)
                fontFamily: fontFamilyDisplay,
                fontSize: '20px',
                fontWeight: 500,
                lineHeight: 'normal',
                letterSpacing: 0,
                color: theme.palette.mode === 'dark' ? neutral[100] : neutral[900],
              }}
            >
              NeuraReport
            </Typography>
          </Box>
        )}

        {collapsed && (
          <LogoBox onClick={() => handleNavigate('/')} sx={{ cursor: 'pointer' }}>
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="NeuraReport" />
          </LogoBox>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} />
      </LogoContainer>

      {/* Collapse Button */}
      <CollapseButton
        size="small"
        onClick={handleToggleSidebar}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        data-testid="sidebar-collapse-button"
      >
        {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
      </CollapseButton>

      {/* New Report Button */}
      <Box sx={{ p: 1.5, pt: 2 }}>
        <Tooltip title={collapsed ? 'New Report' : ''} placement="right" arrow>
          <NewReportButton
            component="button"
            type="button"
            onClick={() => handleNavigate('/pipeline')}
            sx={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
          >
            <AddIcon sx={{ fontSize: 18 }} />
            {!collapsed && (
              <Typography variant="body2" fontWeight={500}>
                New Report
              </Typography>
            )}
          </NewReportButton>
        </Tooltip>
      </Box>

      {/* Navigation */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          py: 1,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: alpha(theme.palette.text.primary, 0.1),
            borderRadius: 1,  // Figma spec: 8px
          },
        }}
      >
        {NAV_ITEMS.map((section, sectionIndex) => {
          const isExpanded = expandedSections[section.section] !== false

          return (
            <Box key={section.section}>
              {/* Section Header */}
              {!collapsed && (
                  <SectionHeader
                    collapsed={collapsed}
                    collapsible={section.collapsible}
                    onClick={() => section.collapsible && handleToggleSection(section.section)}
                  >
                  <Typography
                    sx={{
                      // FIGMA: Small Text style - Inter Medium
                      fontFamily: fontFamilyUI,
                      fontSize: '10px',
                      fontWeight: 600,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                    }}
                  >
                    {section.section}
                  </Typography>
                  {section.collapsible && (
                    <ExpandMoreIcon
                      className="expand-icon"
                      sx={{
                        fontSize: 16,
                        color: 'text.disabled',
                        transition: 'transform 0.2s ease',
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  )}
                </SectionHeader>
              )}

              {/* Section Items */}
              <Collapse in={collapsed || isExpanded}>
                <Box sx={{ py: 0.5 }}>
                  {section.items.map((item, itemIndex) => {
                    const Icon = item.icon
                    const active = isActive(item.path)
                    const badgeContent = item.badge ? activeJobs : 0

                    return (
                      <Tooltip
                        key={item.key}
                        title={collapsed ? item.label : ''}
                        placement="right"
                        arrow
                      >
                        <NavItemButton
                          active={active}
                          collapsed={collapsed}
                          highlight={item.highlight}
                          component="button"
                          type="button"
                          aria-current={active ? 'page' : undefined}
                          onClick={() => handleNavigate(item.path)}
                          sx={{
                            animation: `${slideIn} 0.2s ease-out ${itemIndex * 30}ms both`,
                          }}
                        >
                          <NavIcon active={active} highlight={item.highlight}>
                            <Badge
                              badgeContent={badgeContent}
                              invisible={!badgeContent}
                              sx={{
                                '& .MuiBadge-badge': {
                                  bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
                                  color: 'text.secondary',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  minWidth: 14,
                                  height: 14,
                                  padding: '0 3px',
                                },
                              }}
                            >
                              <Icon />
                            </Badge>
                          </NavIcon>

                          {!collapsed && (
                            <Typography
                              sx={{
                                // FIGMA: Navigation Item - Inter Medium 16px
                                fontFamily: fontFamilyUI,
                                fontSize: '16px',
                                fontWeight: 500,
                                lineHeight: 'normal',
                                flex: 1,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {item.label}
                            </Typography>
                          )}

                          {/* Removed sparkle icons - not in Figma design */}
                        </NavItemButton>
                      </Tooltip>
                    )
                  })}
                </Box>
              </Collapse>

              {/* Section Divider */}
              {sectionIndex < NAV_ITEMS.length - 1 && (
                <Box
                  sx={{
                    height: 1,
                    mx: 2,
                    my: 1.5,
                    bgcolor: alpha(theme.palette.divider, 0.3),
                  }}
                />
              )}
            </Box>
          )
        })}
      </Box>

      {/* Footer */}
      <Box
        sx={{
          p: 2,
          borderTop: 'none',
        }}
      >
        {!collapsed ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1,
              borderRadius: 1,
              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : neutral[200],
            }}
          >
            <Avatar
              sx={{
                width: 32,
                height: 32,
                bgcolor: theme.palette.mode === 'dark' ? neutral[700] : neutral[500],
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
            >
              U
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: theme.palette.mode === 'dark' ? neutral[100] : neutral[900],
                }}
                noWrap
              >
                NeuraReport
              </Typography>
              <Typography
                sx={{
                  fontSize: '10px',
                  color: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                  display: 'block'
                }}
              >
                v1.0
              </Typography>
            </Box>
          </Box>
        ) : (
          <Avatar
            sx={{
              width: 32,
              height: 32,
              bgcolor: theme.palette.mode === 'dark' ? neutral[700] : neutral[500],
              fontSize: '0.75rem',
              fontWeight: 600,
              mx: 'auto',
            }}
          >
            U
          </Avatar>
        )}
      </Box>
    </SidebarContainer>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width,
          flexShrink: 0,
          transition: (theme) => theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: 200,
          }),
          '& .MuiDrawer-paper': {
            width,
            boxSizing: 'border-box',
            borderRight: 'none',
            bgcolor: 'transparent',
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: 200,
            }),
          },
        }}
        open
      >
        {sidebarContent}
      </Drawer>

      {/* Mobile Drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={handleCloseSidebar}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: 280,
            boxSizing: 'border-box',
            bgcolor: 'transparent',
          },
        }}
      >
        {sidebarContent}
      </Drawer>
    </>
  )
}

// === From: TopNav.jsx ===
/**
 * Premium Top Navigation
 * Sophisticated header with glassmorphism, animations, and refined interactions
 */


const topnavPulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
`

const topnavFadeIn = keyframes`
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
`

const topnavShimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`


const StyledAppBar = styled(AppBar)(({ theme }) => ({
  // Glass effect header with warm paper tones
  backgroundColor: theme.palette.mode === 'dark' ? neutral[900] : 'rgba(255, 255, 255, 0.85)',
  backdropFilter: 'blur(12px)',
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? neutral[700] : neutral[200]}`,
  boxShadow: 'none',
}))

const StyledToolbar = styled(Toolbar)(({ theme }) => ({
  gap: theme.spacing(2),
  minHeight: 60,
  padding: theme.spacing(0, 3),
  [theme.breakpoints.down('sm')]: {
    padding: theme.spacing(0, 2),
  },
}))

const NavIconButton = styled(IconButton)(({ theme }) => ({
  width: 36,
  height: 36,
  borderRadius: 8,
  // Muted grey icons from Figma
  color: theme.palette.mode === 'dark' ? neutral[500] : neutral[300],
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : neutral[100],
    color: theme.palette.mode === 'dark' ? neutral[100] : neutral[900],
  },
  '&:active': {
    transform: 'none',
  },
}))

const ConnectionChip = styled(Chip, {
  shouldForwardProp: (prop) => prop !== 'connected',
})(({ theme, connected }) => ({
  height: 30,
  borderRadius: 8,  // Figma spec: 8px
  // Prevent long connection names from forcing horizontal overflow on small screens.
  flexShrink: 1,
  minWidth: 0,
  maxWidth: 240,
  [theme.breakpoints.down('sm')]: {
    maxWidth: 140,
  },
  backgroundColor: connected
    ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100])
    : (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.06) : neutral[50]),
  border: `1px solid ${connected
    ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.15) : neutral[200])
    : alpha(theme.palette.divider, 0.2)}`,
  color: theme.palette.text.secondary,
  fontWeight: 500,
  fontSize: '0.75rem',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '& .MuiChip-icon': {
    marginLeft: 6,
  },
  '& .MuiChip-label': {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[200],
  },
}))

const StatusDot = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'connected',
})(({ theme, connected }) => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: connected
    ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700])
    : (theme.palette.mode === 'dark' ? neutral[300] : neutral[500]),
  boxShadow: connected
    ? `0 0 0 3px ${theme.palette.mode === 'dark' ? alpha(neutral[500], 0.2) : alpha(neutral[700], 0.2)}`
    : 'none',
  animation: connected ? `${topnavPulse} 2s infinite ease-in-out` : 'none',
}))

const StyledBadge = styled(Badge)(({ theme }) => ({
  '& .MuiBadge-badge': {
    // Neutral badge color - not green
    backgroundColor: theme.palette.mode === 'dark' ? neutral[700] : neutral[400],
    color: 'common.white',
    fontSize: '10px',
    fontWeight: 600,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    boxShadow: 'none',
    animation: `${topnavFadeIn} 0.3s ease-out`,
  },
}))

const StyledMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    borderRadius: 14,
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    boxShadow: `0 12px 40px ${alpha(theme.palette.common.black, 0.15)}`,
    marginTop: theme.spacing(1),
    minWidth: 200,
  },
}))

const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
  borderRadius: 8,
  margin: theme.spacing(0.5, 1),
  padding: theme.spacing(1, 1.5),
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
}))

const MenuHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(1.5, 2, 1),
}))

const MenuLabel = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: theme.palette.text.disabled,
}))

const ShortcutChip = styled(Chip)(({ theme }) => ({
  height: 24,
  fontSize: '12px',
  fontFamily: 'var(--font-mono, monospace)',
  fontWeight: 500,
  backgroundColor: alpha(theme.palette.text.primary, 0.06),
  color: theme.palette.text.secondary,
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  borderRadius: 6,
}))

const HelpCard = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: theme.spacing(2),
  padding: theme.spacing(2),
  borderRadius: 8,  // Figma spec: 8px
  backgroundColor: alpha(theme.palette.background.paper, 0.5),
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
    borderColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[200],
  },
}))

const StyledDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    borderRadius: 8,  // Figma spec: 8px
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  },
  '& .MuiBackdrop-root': {
    backgroundColor: alpha(theme.palette.common.black, 0.5),
    backdropFilter: 'blur(4px)',
  },
}))


function TopNav({ onMenuClick, showMenuButton, connection }) {
  const theme = useTheme()
  const { execute } = useInteraction()
  const navigate = useNavigateInteraction()
  const [anchorEl, setAnchorEl] = useState(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [notificationsAnchorEl, setNotificationsAnchorEl] = useState(null)
  const downloads = useAppStore((state) => state.downloads)
  const jobsQuery = useJobsList({ limit: 5 })
  const jobs = jobsQuery?.data?.jobs || []

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'topnav', ...intent },
      action,
    })
  }, [execute])

  const openMenu = useCallback((anchor) => {
    setAnchorEl(anchor)
  }, [])

  const closeMenu = useCallback(() => {
    setAnchorEl(null)
  }, [])

  const handleOpenMenu = useCallback((event) => {
    const anchor = event.currentTarget
    return executeUI('Open user menu', () => openMenu(anchor))
  }, [executeUI, openMenu])

  const handleCloseMenu = useCallback(() => {
    return executeUI('Close user menu', () => closeMenu())
  }, [executeUI, closeMenu])

  const handleNavigate = useCallback((path, label) => {
    navigate(path, {
      label: label || `Open ${path}`,
      intent: { source: 'topnav', path },
    })
    closeMenu()
  }, [navigate, closeMenu])

  const handleMenuButtonClick = useCallback(() => {
    return executeUI('Open navigation menu', () => onMenuClick?.(), { target: 'sidebar' })
  }, [executeUI, onMenuClick])

  const handleOpenCommandPalette = useCallback(() => {
    return executeUI('Open command palette', () => {
      if (typeof window === 'undefined') return
      window.dispatchEvent(new CustomEvent('neura:open-command-palette'))
    })
  }, [executeUI])

  const handleOpenShortcuts = useCallback(() => executeUI('Open shortcuts', () => setShortcutsOpen(true)), [executeUI])
  const handleCloseShortcuts = useCallback(() => executeUI('Close shortcuts', () => setShortcutsOpen(false)), [executeUI])

  const handleOpenHelp = useCallback(() => executeUI('Open help', () => setHelpOpen(true)), [executeUI])
  const handleCloseHelp = useCallback(() => executeUI('Close help', () => setHelpOpen(false)), [executeUI])

  const closeNotifications = useCallback(() => {
    setNotificationsAnchorEl(null)
  }, [])

  const handleOpenNotifications = useCallback((event) => {
    const anchor = event.currentTarget
    return executeUI('Open notifications', () => setNotificationsAnchorEl(anchor))
  }, [executeUI])

  const handleCloseNotifications = useCallback(() => {
    return executeUI('Close notifications', () => closeNotifications())
  }, [executeUI, closeNotifications])

  const handleOpenJobsPanel = useCallback(() => {
    return executeUI('Open jobs panel', () => {
      if (typeof window === 'undefined') return
      window.dispatchEvent(new CustomEvent('neura:open-jobs-panel'))
      closeNotifications()
    })
  }, [executeUI, closeNotifications])

  const handleOpenAssistant = useCallback(() => {
    return executeUI('Open AI assistant', () => {
      if (typeof window === 'undefined') return
      window.dispatchEvent(new CustomEvent('neura:open-assistant'))
    })
  }, [executeUI])

  const handleOpenDownload = useCallback((download) => {
    return executeUI('Open download', () => {
      const rawUrl = download?.pdfUrl || download?.docxUrl || download?.xlsxUrl || download?.htmlUrl || download?.url
      if (!rawUrl || typeof window === 'undefined') return
      const href = typeof rawUrl === 'string' ? withBase(rawUrl) : rawUrl
      window.open(href, '_blank', 'noopener')
      closeNotifications()
    }, { downloadId: download?.id })
  }, [executeUI, closeNotifications])

  const clearAppStorage = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      Object.keys(window.localStorage).forEach((key) => {
        if (key.startsWith('neura') || key.startsWith('neurareport')) {
          window.localStorage.removeItem(key)
        }
      })
    } catch {
      // Ignore storage cleanup failures
    }
  }, [])

  const handleSignOut = useCallback(() => {
    return execute({
      type: InteractionType.LOGOUT,
      label: 'Sign out',
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'topnav' },
      action: () => {
        closeMenu()
        clearAppStorage()
        if (typeof window !== 'undefined') {
          window.location.assign('/')
        }
      },
    })
  }, [execute, closeMenu, clearAppStorage])

  const jobNotifications = useMemo(() => (
    Array.isArray(jobs) ? jobs.slice(0, 3) : []
  ), [jobs])
  const downloadNotifications = useMemo(() => (
    Array.isArray(downloads) ? downloads.slice(0, 3) : []
  ), [downloads])
  const notificationsCount = jobNotifications.length + downloadNotifications.length

  const shortcutItems = [
    { label: 'Command Palette', keys: getShortcutDisplay(SHORTCUTS.COMMAND_PALETTE).join(' + ') },
    { label: 'AI Assistant', keys: getShortcutDisplay(SHORTCUTS.ASSISTANT).join(' + ') },
    { label: 'Close dialogs', keys: getShortcutDisplay(SHORTCUTS.CLOSE).join(' + ') },
  ]

  const helpActions = [
    { label: 'Open Setup Wizard', description: 'Connect a data source and upload templates.', path: '/pipeline' },
    { label: 'Manage Templates', description: 'Edit, duplicate, or export templates.', path: '/templates' },
    { label: 'Generate Reports', description: 'Run report jobs and download outputs.', path: '/reports' },
    { label: 'Analyze Documents', description: 'Extract tables and charts from files.', path: '/analyze' },
    { label: 'System Settings', description: 'View health checks and preferences.', path: '/settings' },
  ]

  const isConnected = connection?.status === 'connected'

  return (
    <StyledAppBar position="sticky" elevation={0}>
      <StyledToolbar>
        {/* Menu Button (Mobile) */}
        {showMenuButton && (
          <NavIconButton edge="start" onClick={handleMenuButtonClick} aria-label="Open menu" data-testid="mobile-menu-button">
            <MenuIcon sx={{ fontSize: 20 }} />
          </NavIconButton>
        )}

        {/* Breadcrumbs + Global Search */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 2 }} data-testid="topnav-breadcrumb-search-container">
          <Box sx={{ flex: 1, minWidth: 0 }} data-testid="topnav-breadcrumb-wrapper">
            <Breadcrumbs />
          </Box>
          <Box sx={{ display: { xs: 'none', md: 'block' } }} data-testid="topnav-global-search-wrapper">
            <GlobalSearch variant="compact" enableShortcut={false} showShortcutHint={false} />
          </Box>
        </Box>

        {/* Connection Status */}
        {connection && (
          <Tooltip
            title={isConnected ? 'Database connected' : 'Connection issue'}
            arrow
            TransitionComponent={Zoom}
          >
            <ConnectionChip
              connected={isConnected}
              icon={<StatusDot connected={isConnected} data-testid="connection-status-dot" />}
              label={connection.name || (isConnected ? 'Connected' : 'Disconnected')}
              size="small"
              data-testid="connection-status-chip"
            />
          </Tooltip>
        )}

        {/* Actions */}
        <Stack direction="row" spacing={0.5} alignItems="center" data-testid="topnav-actions-container">
          <Tooltip
            title={`Search (${getShortcutDisplay(SHORTCUTS.COMMAND_PALETTE).join(' + ')})`}
            arrow
            TransitionComponent={Zoom}
          >
            <NavIconButton size="small" onClick={handleOpenCommandPalette} aria-label="Open search" data-testid="search-button">
              <SearchIcon sx={{ fontSize: 18 }} />
            </NavIconButton>
          </Tooltip>

          <Tooltip title="Keyboard Shortcuts" arrow TransitionComponent={Zoom}>
            <NavIconButton size="small" onClick={handleOpenShortcuts} aria-label="View shortcuts" data-testid="keyboard-shortcuts-button">
              <KeyboardIcon sx={{ fontSize: 18 }} />
            </NavIconButton>
          </Tooltip>

          <Tooltip title="Jobs & downloads" arrow TransitionComponent={Zoom}>
            <NavIconButton size="small" onClick={handleOpenNotifications} aria-label="View notifications" data-testid="notifications-button">
              <StyledBadge badgeContent={notificationsCount} invisible={!notificationsCount}>
                <WorkIcon sx={{ fontSize: 18 }} />
              </StyledBadge>
            </NavIconButton>
          </Tooltip>

          <Tooltip title={`AI Assistant (${getShortcutDisplay(SHORTCUTS.ASSISTANT).join(' + ')})`} arrow TransitionComponent={Zoom}>
            <NavIconButton size="small" onClick={handleOpenAssistant} aria-label="Open AI Assistant" data-testid="assistant-button">
              <SmartToyOutlinedIcon sx={{ fontSize: 18 }} />
            </NavIconButton>
          </Tooltip>

          <Tooltip title="Help" arrow TransitionComponent={Zoom}>
            <NavIconButton size="small" onClick={handleOpenHelp} aria-label="Open help" data-testid="help-button">
              <HelpOutlineIcon sx={{ fontSize: 18 }} />
            </NavIconButton>
          </Tooltip>

          <NavIconButton
            size="small"
            onClick={handleOpenMenu}
            aria-label="User menu"
            data-testid="user-menu-button"
            sx={{ ml: 0.5 }}
          >
            <PersonOutlineIcon sx={{ fontSize: 18 }} />
          </NavIconButton>
        </Stack>

        {/* User Menu */}
        <StyledMenu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleCloseMenu}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          TransitionComponent={Fade}
        >
          <StyledMenuItem onClick={() => handleNavigate('/settings')}>
            <ListItemIcon>
              <SettingsIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            </ListItemIcon>
            <ListItemText
              primary="Settings"
              primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: 500 }}
            />
          </StyledMenuItem>
          <Divider sx={{ my: 0.5, mx: 1, borderColor: alpha(theme.palette.divider, 0.1) }} />
          <StyledMenuItem onClick={handleSignOut}>
            <ListItemIcon>
              <LogoutIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            </ListItemIcon>
            <ListItemText
              primary="Sign Out"
              primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: 500 }}
            />
          </StyledMenuItem>
        </StyledMenu>

        {/* Notifications Menu */}
        <StyledMenu
          anchorEl={notificationsAnchorEl}
          open={Boolean(notificationsAnchorEl)}
          onClose={handleCloseNotifications}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          TransitionComponent={Fade}
          slotProps={{ paper: { sx: { width: 320 } } }}
        >
          <MenuHeader>
            <MenuLabel>Jobs</MenuLabel>
          </MenuHeader>
          {jobNotifications.length ? jobNotifications.map((job) => (
            <StyledMenuItem
              key={job.id}
              onClick={() => {
                handleCloseNotifications()
                handleNavigate('/jobs', 'Open jobs')
              }}
            >
              <ListItemIcon>
                <WorkIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              </ListItemIcon>
              <ListItemText
                primary={job.template_name || job.template_id || job.id}
                secondary={`Status: ${(job.status || 'unknown').toString()}`}
                primaryTypographyProps={{ fontSize: '14px' }}
                secondaryTypographyProps={{ fontSize: '0.75rem' }}
              />
            </StyledMenuItem>
          )) : (
            <MenuItem disabled sx={{ opacity: 0.5, mx: 1 }}>
              <ListItemText
                primary="No job updates yet"
                primaryTypographyProps={{ fontSize: '14px', color: 'text.secondary' }}
              />
            </MenuItem>
          )}

          <Divider sx={{ my: 1, mx: 1, borderColor: alpha(theme.palette.divider, 0.1) }} />

          <MenuHeader>
            <MenuLabel>Downloads</MenuLabel>
          </MenuHeader>
          {downloadNotifications.length ? downloadNotifications.map((download, index) => (
            <StyledMenuItem
              key={`${download.filename || download.template || 'download'}-${index}`}
              onClick={() => handleOpenDownload(download)}
            >
              <ListItemIcon>
                <DownloadIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
              </ListItemIcon>
              <ListItemText
                primary={download.filename || download.template || 'Recent download'}
                secondary={download.format ? download.format.toUpperCase() : 'Open file'}
                primaryTypographyProps={{ fontSize: '14px' }}
                secondaryTypographyProps={{ fontSize: '0.75rem' }}
              />
            </StyledMenuItem>
          )) : (
            <MenuItem disabled sx={{ opacity: 0.5, mx: 1 }}>
              <ListItemText
                primary="No downloads yet"
                primaryTypographyProps={{ fontSize: '14px', color: 'text.secondary' }}
              />
            </MenuItem>
          )}

          <Divider sx={{ my: 1, mx: 1, borderColor: alpha(theme.palette.divider, 0.1) }} />

          <StyledMenuItem onClick={handleOpenJobsPanel}>
            <ListItemIcon>
              <OpenInNewIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            </ListItemIcon>
            <ListItemText
              primary="Open Jobs Panel"
              primaryTypographyProps={{ fontSize: '14px', fontWeight: 500 }}
            />
          </StyledMenuItem>
        </StyledMenu>

        {/* Keyboard Shortcuts Dialog */}
        <StyledDialog
          open={shortcutsOpen}
          onClose={handleCloseShortcuts}
          maxWidth="xs"
          fullWidth
          TransitionComponent={Fade}
        >
          <DialogTitle sx={{ fontWeight: 600 }}>Keyboard Shortcuts</DialogTitle>
          <DialogContent dividers sx={{ borderColor: alpha(theme.palette.divider, 0.1) }}>
            <Stack spacing={2}>
              {shortcutItems.map((item) => (
                <Box
                  key={item.label}
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography sx={{ fontSize: '0.875rem' }}>
                    {item.label}
                  </Typography>
                  <ShortcutChip label={item.keys} size="small" />
                </Box>
              ))}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`, p: 2 }}>
            <Button
              onClick={handleCloseShortcuts}
              sx={{ borderRadius: 1, textTransform: 'none', fontWeight: 500 }}
            >
              Close
            </Button>
          </DialogActions>
        </StyledDialog>

        {/* Help Dialog */}
        <StyledDialog
          open={helpOpen}
          onClose={handleCloseHelp}
          maxWidth="sm"
          fullWidth
          TransitionComponent={Fade}
        >
          <DialogTitle sx={{ fontWeight: 600 }}>Help Center</DialogTitle>
          <DialogContent dividers sx={{ borderColor: alpha(theme.palette.divider, 0.1) }}>
            <Typography sx={{ fontSize: '0.875rem', color: 'text.secondary', mb: 3 }}>
              Jump to common workflows or explore system settings.
            </Typography>
            <Stack spacing={1.5}>
              {helpActions.map((action) => (
                <HelpCard key={action.label}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, mb: 0.25 }}>
                      {action.label}
                    </Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                      {action.description}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      handleCloseHelp()
                      handleNavigate(action.path, `Open ${action.label}`)
                    }}
                    sx={{
                      borderRadius: 1,  // Figma spec: 8px
                      textTransform: 'none',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      minWidth: 64,
                    }}
                  >
                    Open
                  </Button>
                </HelpCard>
              ))}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`, p: 2 }}>
            <Button
              onClick={handleCloseHelp}
              sx={{ borderRadius: 1, textTransform: 'none', fontWeight: 500 }}
            >
              Close
            </Button>
          </DialogActions>
        </StyledDialog>
      </StyledToolbar>
    </StyledAppBar>
  )
}


/**
 * Layout Components (merged)
 */


/**
 * Premium Project Layout
 * Sophisticated shell with glassmorphism effects and smooth transitions
 */


// FIGMA SPEC: Sidebar width = 250px
const SIDEBAR_WIDTH = 250
const SIDEBAR_COLLAPSED_WIDTH = 64


const LayoutRoot = styled(Box)(({ theme }) => ({
  display: 'flex',
  minHeight: '100vh',
  // Clean, flat background - NO gradients
  backgroundColor: theme.palette.background.default,
  position: 'relative',
}))

const MainContent = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isMobile',
})(({ theme, isMobile }) => ({
  flexGrow: 1,
  minWidth: 0, // allow flex children to shrink instead of forcing horizontal overflow
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  // The permanent MUI Drawer already reserves layout space; avoid double-offsetting.
  marginLeft: 0,
  position: 'relative',
  zIndex: 1,
}))

const PageContent = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'auto',
  backgroundColor: 'transparent',
  // Warm chart-paper grid overlay (webshell desktop UI pattern)
  backgroundImage: theme.palette.mode === 'dark'
    ? 'none'
    : `repeating-linear-gradient(to right, rgba(59, 130, 246, 0.02) 0, rgba(59, 130, 246, 0.02) 1px, transparent 1px, transparent 60px), repeating-linear-gradient(to bottom, rgba(59, 130, 246, 0.02) 0, rgba(59, 130, 246, 0.02) 1px, transparent 1px, transparent 60px)`,
  animation: `${fadeIn} 0.3s cubic-bezier(0.22, 1, 0.36, 1)`,

  // Custom scrollbar styling
  '&::-webkit-scrollbar': {
    width: 8,
  },
  '&::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: alpha(theme.palette.text.primary, 0.1),
    borderRadius: 4,
    '&:hover': {
      backgroundColor: alpha(theme.palette.text.primary, 0.2),
    },
  },
}))


export function ProjectLayout({ children }) {
  useInteraction()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const activeConnection = useAppStore((s) => s.activeConnection)

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileOpen((prev) => !prev)
    } else {
      setSidebarCollapsed((prev) => !prev)
    }
  }, [isMobile])

  const handleCloseMobile = useCallback(() => {
    setMobileOpen(false)
  }, [])

  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH

  return (
    <LayoutRoot>
      {/* Sidebar */}
      <Sidebar
        width={sidebarWidth}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileOpen}
        onClose={handleCloseMobile}
        onToggle={handleToggleSidebar}
      />

      {/* Main Content */}
      <MainContent isMobile={isMobile}>
        {/* Offline Banner — stubbed */}

        {/* Top Navigation */}
        <TopNav
          onMenuClick={handleToggleSidebar}
          showMenuButton={isMobile}
          connection={activeConnection}
        />

        {/* Page Content */}
        <PageContent>
          {children || <Outlet />}
        </PageContent>
      </MainContent>
    </LayoutRoot>
  )
}

export { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED_WIDTH }


export function WizardLayout({
  title,
  subtitle,
  steps,
  currentStep,
  onNext,
  onPrev,
  onComplete,
  onCancel,
  nextLabel = 'Next',
  prevLabel = 'Back',
  completeLabel = 'Complete',
  cancelLabel = 'Exit',
  nextDisabled = false,
  loading = false,
  children,
}) {
  const progress = ((currentStep + 1) / steps.length) * 100
  const isLastStep = currentStep === steps.length - 1
  const isFirstStep = currentStep === 0

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          py: 2,
        }}
      >
        <Container maxWidth="md">
          <Typography variant="h5" fontWeight={600}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Container>
      </Box>

      {/* Progress Bar */}
      <LinearProgress
        variant="determinate"
        value={progress}
        sx={{
          height: 4,
          bgcolor: 'action.hover',
          '& .MuiLinearProgress-bar': {
            bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[900],
          },
        }}
      />

      {/* Step Indicators */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Container maxWidth="md">
          <Stack direction="row" spacing={0} sx={{ py: 2 }}>
            {steps.map((step, index) => (
              <Box
                key={step.key}
                sx={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                }}
              >
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: (theme) => index < currentStep
                      ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900])
                      : index === currentStep
                        ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700])
                        : 'action.disabledBackground',
                    color: index <= currentStep ? 'white' : 'text.disabled',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                  }}
                >
                  {index < currentStep ? <CheckIcon sx={{ fontSize: 16 }} /> : index + 1}
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography
                    variant="body2"
                    fontWeight={index === currentStep ? 600 : 400}
                    color={index === currentStep ? 'text.primary' : 'text.secondary'}
                  >
                    {step.label}
                  </Typography>
                  {step.description && (
                    <Typography variant="caption" color="text.disabled">
                      {step.description}
                    </Typography>
                  )}
                </Box>
                {index < steps.length - 1 && (
                  <Box
                    sx={{
                      width: 40,
                      height: 2,
                      bgcolor: (theme) => index < currentStep ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900]) : theme.palette.divider,
                      mx: 1,
                    }}
                  />
                )}
              </Box>
            ))}
          </Stack>
        </Container>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, py: 4 }}>
        <Container maxWidth="md">
          <Paper
            elevation={0}
            sx={{
              p: 4,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,  // Figma spec: 8px
            }}
          >
            {children}
          </Paper>
        </Container>
      </Box>

      {/* Footer Actions */}
      <Box
        sx={{
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          py: 2,
        }}
      >
        <Container maxWidth="md">
          <Stack direction="row" justifyContent="space-between">
            <Stack direction="row" spacing={1}>
              {onCancel && (
                <Button
                  variant="text"
                  onClick={onCancel}
                  disabled={loading}
                  sx={{ color: 'text.secondary' }}
                >
                  {cancelLabel}
                </Button>
              )}
              <Button
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                onClick={onPrev}
                disabled={isFirstStep || loading}
              >
                {prevLabel}
              </Button>
            </Stack>
            <Button
              variant="contained"
              endIcon={isLastStep ? <CheckIcon /> : <ArrowForwardIcon />}
              onClick={isLastStep ? onComplete : onNext}
              disabled={nextDisabled || loading}
            >
              {isLastStep ? completeLabel : nextLabel}
            </Button>
          </Stack>
        </Container>
      </Box>
    </Box>
  )
}

