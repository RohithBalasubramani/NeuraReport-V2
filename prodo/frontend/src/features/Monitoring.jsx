import { api, discoverLoggerDatabases, listConnections, upsertConnection } from '@/api/client'
import { neutral, palette, primary } from '@/app/theme'
import {
  ConnectionSelector,
  PageHeader,
  SectionHeader,
  Surface,
  TemplateSelector,
  useToast,
} from '@/components/core'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { useAppStore } from '@/stores/app'
import { usePipelineRunStore } from '@/stores/workspace'
import { ExportButton, GlassCard, PaddedPageContainer as PageContainer, RefreshButton, StyledFormControl, fadeInUp, pulse } from '@/styles/styles'
import {
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  HourglassEmpty as PendingIcon,
  PlayArrow as RunningIcon,
  Refresh as RetryIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material'
import BarChartIcon from '@mui/icons-material/BarChart'
import DashboardIcon from '@mui/icons-material/Dashboard'
import DescriptionIcon from '@mui/icons-material/Description'
import DownloadIcon from '@mui/icons-material/Download'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PieChartIcon from '@mui/icons-material/PieChart'
import RadarIcon from '@mui/icons-material/Radar'
import RefreshIcon from '@mui/icons-material/Refresh'
import ScheduleIcon from '@mui/icons-material/Schedule'
import SensorsIcon from '@mui/icons-material/Sensors'
import StorageIcon from '@mui/icons-material/Storage'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import WorkIcon from '@mui/icons-material/Work'
import {
  Alert,
  Box,
  Button,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip as MuiTooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
const stageStatusConfig = {
  pending: { color: 'default', icon: PendingIcon, label: 'Pending' },
  running: { color: 'primary', icon: RunningIcon, label: 'Running' },
  completed: { color: 'success', icon: CheckCircleIcon, label: 'Complete' },
  failed: { color: 'error', icon: ErrorIcon, label: 'Failed' },
  retrying: { color: 'warning', icon: RetryIcon, label: 'Retrying' },
}

function formatDuration(ms) {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function StageIndicator({ stage }) {
  const config = stageStatusConfig[stage.status] || stageStatusConfig.pending
  const Icon = config.icon

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Icon
        sx={{
          fontSize: 20,
          color: `${config.color}.main`,
          ...(stage.status === 'running' && {
            animation: 'pulse 1.5s ease-in-out infinite',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.4 },
            },
          }),
        }}
      />
      <Typography variant="body2" sx={{ fontWeight: stage.status === 'running' ? 600 : 400 }}>
        {stage.label}
      </Typography>
      {stage.duration && (
        <Chip
          label={formatDuration(stage.duration)}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: '0.7rem' }}
        />
      )}
      {stage.retryCount > 0 && (
        <MuiTooltip title={`Retried ${stage.retryCount} time(s)`}>
          <Chip
            icon={<RetryIcon sx={{ fontSize: 14 }} />}
            label={stage.retryCount}
            size="small"
            color="warning"
            sx={{ height: 20, fontSize: '0.7rem' }}
          />
        </MuiTooltip>
      )}
      {stage.error && (
        <MuiTooltip title={stage.error}>
          <Chip label="Error" size="small" color="error" sx={{ height: 20, fontSize: '0.7rem' }} />
        </MuiTooltip>
      )}
    </Box>
  )
}

export function PipelineVisualization({ runId, compact = false }) {
  const run = usePipelineRunStore((s) => s.runs[runId])
  const [expanded, setExpanded] = React.useState(!compact)

  const activeStageIndex = useMemo(() => {
    if (!run) return -1
    return run.stages.findIndex((s) => s.status === 'running')
  }, [run])

  if (!run) {
    return null
  }

  const pipelineLabel = run.type === 'report' ? 'Report Pipeline' : 'Agent Workflow'

  if (compact && !expanded) {
    return (
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderRadius: 2,
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(true)}
      >
        <TimelineIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {pipelineLabel}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={run.progress}
          sx={{ flex: 1, height: 6, borderRadius: 3, mx: 1 }}
        />
        <Typography variant="caption" color="text.secondary">
          {run.progress}%
        </Typography>
        <ExpandMoreIcon sx={{ fontSize: 18 }} />
      </Paper>
    )
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 2,
        borderColor: run.status === 'running' ? 'primary.main' : undefined,
        borderWidth: run.status === 'running' ? 2 : 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <TimelineIcon sx={{ color: 'primary.main' }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {pipelineLabel}
          </Typography>
          <Chip
            label={run.status}
            size="small"
            color={
              run.status === 'running'
                ? 'primary'
                : run.status === 'completed'
                  ? 'success'
                  : run.status === 'failed'
                    ? 'error'
                    : 'default'
            }
            sx={{ height: 22, textTransform: 'capitalize' }}
          />
        </Stack>
        {compact && (
          <IconButton size="small" onClick={() => setExpanded(false)}>
            <ExpandLessIcon />
          </IconButton>
        )}
      </Box>

      <LinearProgress
        variant="determinate"
        value={run.progress}
        sx={{ mb: 2, height: 8, borderRadius: 4 }}
      />

      <Box sx={{ pl: 1 }}>
        {run.stages.map((stage, index) => (
          <StageIndicator key={stage.id} stage={stage} />
        ))}
      </Box>

      {run.error && (
        <Box
          sx={{
            mt: 2,
            p: 1.5,
            bgcolor: 'error.main',
            color: 'error.contrastText',
            borderRadius: 1,
            fontSize: '0.85rem',
          }}
        >
          {run.error}
        </Box>
      )}

      {run.checkpoints.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {run.checkpoints.length} checkpoint(s) saved
          </Typography>
        </Box>
      )}
    </Paper>
  )
}

// === From: logger.jsx ===

// Logger frontend URL — embedded as iframe plugin
const LOGGER_URL = 'http://localhost:9847?embedded=true'

export function LoggerPageContainer() {
  const [viewMode, setViewMode] = useState('plugin') // 'plugin' | 'data'
  const [loggerConnections, setLoggerConnections] = useState([])
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState(null)
  const [loggerStatus, setLoggerStatus] = useState('checking') // 'checking' | 'online' | 'offline'
  const iframeRef = useRef(null)

  const setActiveConnectionId = useAppStore((s) => s.setActiveConnectionId)

  // Check if Logger frontend is accessible
  useEffect(() => {
    setLoggerStatus('checking')
    const img = new Image()
    const timeout = setTimeout(() => {
      setLoggerStatus('offline')
    }, 5000)
    // Try fetching the Logger frontend to check if it's up
    fetch(LOGGER_URL, { mode: 'no-cors' })
      .then(() => {
        clearTimeout(timeout)
        setLoggerStatus('online')
      })
      .catch(() => {
        clearTimeout(timeout)
        setLoggerStatus('offline')
      })
    return () => clearTimeout(timeout)
  }, [])

  // Load existing PostgreSQL connections
  useEffect(() => {
    listConnections().then((res) => {
      const conns = (res?.connections || []).filter(
        (c) => c.db_type === 'postgresql' || c.db_type === 'postgres'
      )
      setLoggerConnections(conns)
      if (conns.length > 0 && !selectedConnectionId) {
        setSelectedConnectionId(conns[0].id)
      }
    }).catch(() => {})
  }, [])

  const handleDiscover = useCallback(async () => {
    setDiscovering(true)
    setDiscoveryError(null)
    try {
      const result = await discoverLoggerDatabases()
      const databases = result?.databases || []
      if (databases.length === 0) {
        setDiscoveryError('No Logger databases found on the network.')
        return
      }
      for (const db of databases) {
        try {
          await upsertConnection({
            name: db.name,
            dbType: 'postgresql',
            dbUrl: db.db_url,
            database: db.database,
            status: 'connected',
          })
        } catch {
          // already exists or failed
        }
      }
      const res = await listConnections()
      const conns = (res?.connections || []).filter(
        (c) => c.db_type === 'postgresql' || c.db_type === 'postgres'
      )
      setLoggerConnections(conns)
      if (conns.length > 0 && !selectedConnectionId) {
        setSelectedConnectionId(conns[0].id)
      }
    } catch (err) {
      setDiscoveryError(err?.message || 'Discovery failed')
    } finally {
      setDiscovering(false)
    }
  }, [selectedConnectionId])

  const handleRefreshIframe = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
    }
  }, [])

  const handleConnectionSelect = useCallback((connId) => {
    setSelectedConnectionId(connId)
    setActiveConnectionId(connId)
  }, [setActiveConnectionId])

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Logger"
        subtitle="PLC data logger — device management, schemas, and data pipeline"
        icon={<SensorsIcon />}
      />

      <Box sx={{ px: 4, py: 2, maxWidth: 1400, mx: 'auto', width: '100%', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Toolbar */}
        <GlassCard sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', py: 1.5 }}>
          {/* View toggle */}
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            size="small"
          >
            <ToggleButton value="plugin">
              <MuiTooltip title="Logger Dashboard — full device management UI">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <DashboardIcon sx={{ fontSize: 18 }} />
                  <span>Dashboard</span>
                </Box>
              </MuiTooltip>
            </ToggleButton>
            <ToggleButton value="data">
              <MuiTooltip title="Data Pipeline — select Logger database for reports & templates">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <StorageIcon sx={{ fontSize: 18 }} />
                  <span>Data Pipeline</span>
                </Box>
              </MuiTooltip>
            </ToggleButton>
          </ToggleButtonGroup>

          {viewMode === 'plugin' && (
            <>
              <Chip
                size="small"
                label={loggerStatus === 'online' ? 'Logger Online' : loggerStatus === 'checking' ? 'Checking...' : 'Logger Offline'}
                color={loggerStatus === 'online' ? 'success' : loggerStatus === 'checking' ? 'default' : 'error'}
                variant="outlined"
              />
              <Button
                variant="text"
                startIcon={<RefreshIcon />}
                onClick={handleRefreshIframe}
                size="small"
                disabled={loggerStatus !== 'online'}
              >
                Refresh
              </Button>
              <Button
                variant="text"
                startIcon={<OpenInNewIcon />}
                onClick={() => window.open(LOGGER_URL, '_blank')}
                size="small"
              >
                Open in New Tab
              </Button>
            </>
          )}

          {viewMode === 'data' && (
            <>
              <FormControl size="small" sx={{ minWidth: 300 }}>
                <InputLabel>Logger Database</InputLabel>
                <Select
                  value={selectedConnectionId}
                  label="Logger Database"
                  onChange={(e) => handleConnectionSelect(e.target.value)}
                >
                  {loggerConnections.length === 0 && (
                    <MenuItem value="" disabled>No PostgreSQL connections</MenuItem>
                  )}
                  {loggerConnections.map((c) => (
                    <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Button
                variant="outlined"
                startIcon={discovering ? <CircularProgress size={16} /> : <RadarIcon />}
                onClick={handleDiscover}
                disabled={discovering}
                size="small"
              >
                {discovering ? 'Discovering...' : 'Discover Logger'}
              </Button>
            </>
          )}
        </GlassCard>

        {discoveryError && (
          <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setDiscoveryError(null)}>
            {discoveryError}
          </Alert>
        )}

        {/* Plugin View — embedded Logger frontend */}
        {viewMode === 'plugin' && (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {loggerStatus === 'checking' && (
              <GlassCard sx={{ textAlign: 'center', py: 6, flex: 1 }}>
                <CircularProgress sx={{ mb: 2 }} />
                <Typography variant="body1" color="text.secondary">
                  Connecting to Logger...
                </Typography>
              </GlassCard>
            )}
            {loggerStatus === 'offline' && (
              <GlassCard sx={{ textAlign: 'center', py: 6, flex: 1 }}>
                <SensorsIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  Logger Not Available
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 500, mx: 'auto' }}>
                  The Logger frontend at <strong>{LOGGER_URL}</strong> is not reachable.
                  Make sure the Logger service is running.
                </Typography>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setLoggerStatus('checking')
                    fetch(LOGGER_URL, { mode: 'no-cors' })
                      .then(() => setLoggerStatus('online'))
                      .catch(() => setLoggerStatus('offline'))
                  }}
                >
                  Retry Connection
                </Button>
              </GlassCard>
            )}
            {loggerStatus === 'online' && (
              <Box
                sx={{
                  flex: 1,
                  minHeight: 600,
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <iframe
                  ref={iframeRef}
                  src={LOGGER_URL}
                  title="Logger Dashboard"
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    display: 'block',
                    minHeight: 600,
                  }}
                />
              </Box>
            )}
          </Box>
        )}

        {/* Data Pipeline View — connection-based integration for reports/templates */}
        {viewMode === 'data' && (
          <>
            {!selectedConnectionId ? (
              <GlassCard sx={{ textAlign: 'center', py: 6 }}>
                <SensorsIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No Logger Database Selected
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Select an existing PostgreSQL connection or click "Discover Logger" to find Logger databases.
                  Once connected, you can use Logger data in templates and reports.
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<RadarIcon />}
                  onClick={handleDiscover}
                  disabled={discovering}
                >
                  Discover Logger Databases
                </Button>
              </GlassCard>
            ) : (
              <GlassCard>
                <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
                  Data Pipeline Integration
                </Typography>
                <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
                  This Logger database is available as a data source throughout NeuraReport.
                  You can select it in the <strong>Reports</strong> page, <strong>Template Creator</strong>,
                  and any feature that uses the Data Source selector.
                </Alert>

                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
                  {loggerConnections.filter(c => c.id === selectedConnectionId).map(c => (
                    <GlassCard key={c.id} sx={{ '&:hover': { transform: 'none' } }}>
                      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                        {c.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.75rem', mb: 1 }}>
                        {c.db_type}
                      </Typography>
                      <Chip
                        size="small"
                        label={c.status || 'connected'}
                        color={c.status === 'connected' || !c.status ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </GlassCard>
                  ))}
                </Box>

                <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={() => window.location.href = '/neurareport/reports'}
                    size="small"
                  >
                    Go to Reports
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => window.location.href = '/neurareport/templates/create'}
                    size="small"
                  >
                    Create Template
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => window.location.href = '/neurareport/connections'}
                    size="small"
                  >
                    Manage Connections
                  </Button>
                </Box>
              </GlassCard>
            )}
          </>
        )}
      </Box>
    </Box>
  )
}

// === From: ops.jsx ===

const parseJsonInput = (value, toast, label) => {
  const trimmed = (value || '').trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch (error) {
    toast.show(`Invalid ${label} JSON`, 'error')
    return null
  }
}

const splitList = (value) => (
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
)

export function OpsConsolePage() {
  const toast = useToast()
  const { execute } = useInteraction()
  const [busy, setBusy] = useState(false)
  const [lastResponse, setLastResponse] = useState(null)

  const [apiKey, setApiKey] = useState('')
  const [bearerToken, setBearerToken] = useState('')

  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerName, setRegisterName] = useState('')

  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const [userId, setUserId] = useState('')

  const [jobTemplateId, setJobTemplateId] = useState('')
  const [jobConnectionId, setJobConnectionId] = useState('')
  const [jobStartDate, setJobStartDate] = useState('')
  const [jobEndDate, setJobEndDate] = useState('')
  const [jobDocx, setJobDocx] = useState(false)
  const [jobXlsx, setJobXlsx] = useState(false)
  const [jobKeyValues, setJobKeyValues] = useState('')
  const [jobBatchIds, setJobBatchIds] = useState('')
  const [jobLimit, setJobLimit] = useState(20)

  const [scheduleId, setScheduleId] = useState('')

  const [compareId1, setCompareId1] = useState('')
  const [compareId2, setCompareId2] = useState('')

  const [commentAnalysisId, setCommentAnalysisId] = useState('')
  const [commentUserId, setCommentUserId] = useState('')
  const [commentUserName, setCommentUserName] = useState('')
  const [commentContent, setCommentContent] = useState('')
  const [commentElementType, setCommentElementType] = useState('')
  const [commentElementId, setCommentElementId] = useState('')

  const [shareAnalysisId, setShareAnalysisId] = useState('')
  const [shareAccessLevel, setShareAccessLevel] = useState('view')
  const [shareExpiresHours, setShareExpiresHours] = useState('')
  const [shareAllowedEmails, setShareAllowedEmails] = useState('')
  const [sharePasswordProtected, setSharePasswordProtected] = useState(false)

  const [enrichmentSourceId, setEnrichmentSourceId] = useState('')

  const [chartData, setChartData] = useState('[{"month":"Jan","value":120},{"month":"Feb","value":140}]')
  const [chartType, setChartType] = useState('bar')
  const [chartXField, setChartXField] = useState('month')
  const [chartYFields, setChartYFields] = useState('value')
  const [chartTitle, setChartTitle] = useState('')
  const [chartMaxSuggestions, setChartMaxSuggestions] = useState(3)

  const authHeaders = useMemo(() => {
    const headers = {}
    const trimmedKey = apiKey.trim()
    const trimmedToken = bearerToken.trim()
    if (trimmedKey) headers['X-API-Key'] = trimmedKey
    if (trimmedToken) headers.Authorization = `Bearer ${trimmedToken}`
    return headers
  }, [apiKey, bearerToken])

  const runRequest = async ({ method = 'get', url, data, headers = {}, onSuccess } = {}) => {
    const verb = method.toLowerCase()
    const interactionType = verb === 'delete'
      ? InteractionType.DELETE
      : verb === 'put' || verb === 'patch'
        ? InteractionType.UPDATE
        : verb === 'post'
          ? InteractionType.CREATE
          : InteractionType.EXECUTE
    const reversibility = verb === 'delete' ? Reversibility.IRREVERSIBLE : Reversibility.SYSTEM_MANAGED

    return execute({
      type: interactionType,
      label: `${verb.toUpperCase()} ${url}`,
      reversibility,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      blocksNavigation: false,
      intent: {
        method: verb,
        url,
      },
      action: async () => {
        setBusy(true)
        setLastResponse({
          pending: true,
          method: verb,
          url,
          timestamp: new Date().toISOString(),
        })
        try {
          const response = await api.request({
            method: verb,
            url,
            data,
            headers: {
              ...authHeaders,
              ...headers,
            },
          })
          const payload = response.data
          setLastResponse({
            method: verb,
            url,
            status: response.status,
            data: payload,
            timestamp: new Date().toISOString(),
          })
          if (onSuccess) onSuccess(payload)
          toast.show(`Success: ${verb.toUpperCase()} ${url}`, 'success')
          return payload
        } catch (error) {
          const status = error.response?.status
          const payload = error.response?.data || { message: error.userMessage || error.message }
          setLastResponse({
            method: verb,
            url,
            status,
            error: payload,
            timestamp: new Date().toISOString(),
          })
          toast.show(`Failed: ${verb.toUpperCase()} ${url}`, 'error')
          throw error
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const responseBody = useMemo(() => {
    if (!lastResponse) return 'Run an action to view the response payload.'
    if (lastResponse.pending) return 'Waiting for response...'
    const payload = lastResponse.data || lastResponse.error || {}
    return JSON.stringify(payload, null, 2)
  }, [lastResponse])

  return (
    <Box sx={{ py: 3, px: { xs: 2, md: 3 } }}>
      <Stack spacing={3}>
        <PageHeader
          eyebrow="Operations"
          title="Ops Console"
          description="Direct access to health checks, auth, jobs, schedules, and AI utilities that are not surfaced elsewhere."
        />

        <Surface>
          <SectionHeader
            title="Request Context"
            subtitle="Provide API key or bearer token to authorize protected endpoints."
          />
          <Grid container spacing={2}>
            <Grid item xs={12} md={4}>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  API Base
                </Typography>
                <Chip label={API_BASE} variant="outlined" />
              </Stack>
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="X-API-Key"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                size="small"
                placeholder="Optional"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                fullWidth
                label="Bearer Token"
                value={bearerToken}
                onChange={(event) => setBearerToken(event.target.value)}
                size="small"
                placeholder="Paste access token"
              />
            </Grid>
          </Grid>
        </Surface>

        <Surface>
          <SectionHeader
            title="Auth & Users"
            subtitle="Register users, obtain tokens, and manage user records."
          />
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Register</Typography>
                <TextField
                  fullWidth
                  label="Email"
                  value={registerEmail}
                  onChange={(event) => setRegisterEmail(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Password"
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  size="small"
                  type="password"
                />
                <TextField
                  fullWidth
                  label="Full Name (optional)"
                  value={registerName}
                  onChange={(event) => setRegisterName(event.target.value)}
                  size="small"
                />
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => {
                    if (!registerEmail || !registerPassword) {
                      toast.show('Email and password are required', 'warning')
                      return
                    }
                    const payload = {
                      email: registerEmail,
                      password: registerPassword,
                    }
                    if (registerName) payload.full_name = registerName
                    runRequest({ method: 'post', url: '/auth/register', data: payload })
                  }}
                >
                  Register User
                </Button>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Login</Typography>
                <TextField
                  fullWidth
                  label="Email / Username"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  size="small"
                  type="password"
                />
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => {
                    if (!loginEmail || !loginPassword) {
                      toast.show('Login requires email and password', 'warning')
                      return
                    }
                    const params = new URLSearchParams()
                    params.append('username', loginEmail)
                    params.append('password', loginPassword)
                    runRequest({
                      method: 'post',
                      url: '/auth/jwt/login',
                      data: params,
                      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                      onSuccess: (payload) => {
                        if (payload?.access_token) {
                          setBearerToken(payload.access_token)
                          toast.show('Token saved to bearer field', 'info')
                        }
                      },
                    })
                  }}
                >
                  Get Access Token
                </Button>
              </Stack>
            </Grid>
            <Grid item xs={12}>
              <Divider />
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">User Management</Typography>
                <TextField
                  fullWidth
                  label="User ID"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  size="small"
                  placeholder="UUID"
                />
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() => runRequest({ url: '/users' })}
                  >
                    List Users
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() => {
                      if (!userId) {
                        toast.show('User ID required', 'warning')
                        return
                      }
                      runRequest({ url: `/users/${encodeURIComponent(userId)}` })
                    }}
                  >
                    Get User
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() => {
                      if (!userId) {
                        toast.show('User ID required', 'warning')
                        return
                      }
                      runRequest({ method: 'delete', url: `/users/${encodeURIComponent(userId)}` })
                    }}
                    sx={{ color: 'text.secondary' }}
                  >
                    Delete User
                  </Button>
                </Stack>
              </Stack>
            </Grid>
          </Grid>
        </Surface>

        <Surface>
          <SectionHeader
            title="Health & Ops"
            subtitle="Run service health checks and diagnostics."
          />
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/health' })}>/health</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/healthz' })}>/healthz</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/ready' })}>/ready</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/readyz' })}>/readyz</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/health/detailed' })}>/health/detailed</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/health/token-usage' })}>/health/token-usage</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/health/email' })}>/health/email</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/health/email/test' })}>/health/email/test</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ method: 'post', url: '/health/email/refresh' })}>/health/email/refresh</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/health/scheduler' })}>/health/scheduler</Button>
            </Stack>
          </Stack>
        </Surface>
        <Surface>
          <SectionHeader
            title="Jobs & Schedules"
            subtitle="Trigger job runs, inspect active jobs, and manage schedules."
          />
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Run Report Job</Typography>
                <TemplateSelector
                  value={jobTemplateId}
                  onChange={setJobTemplateId}
                  label="Template"
                  size="small"
                  fullWidth
                  showAll
                />
                <ConnectionSelector
                  value={jobConnectionId}
                  onChange={setJobConnectionId}
                  label="Connection (optional)"
                  size="small"
                  fullWidth
                  showStatus
                />
                <Grid container spacing={1}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="Start Date"
                      value={jobStartDate}
                      onChange={(event) => setJobStartDate(event.target.value)}
                      size="small"
                      placeholder="YYYY-MM-DD"
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="End Date"
                      value={jobEndDate}
                      onChange={(event) => setJobEndDate(event.target.value)}
                      size="small"
                      placeholder="YYYY-MM-DD"
                    />
                  </Grid>
                </Grid>
                <Stack direction="row" spacing={2}>
                  <FormControlLabel
                    control={<Switch checked={jobDocx} onChange={(event) => setJobDocx(event.target.checked)} />}
                    label="DOCX"
                  />
                  <FormControlLabel
                    control={<Switch checked={jobXlsx} onChange={(event) => setJobXlsx(event.target.checked)} />}
                    label="XLSX"
                  />
                </Stack>
                <TextField
                  fullWidth
                  label="Key Values (JSON)"
                  value={jobKeyValues}
                  onChange={(event) => setJobKeyValues(event.target.value)}
                  size="small"
                  multiline
                  minRows={3}
                  placeholder='{"PARAM:region":"US"}'
                />
                <TextField
                  fullWidth
                  label="Batch IDs (comma separated)"
                  value={jobBatchIds}
                  onChange={(event) => setJobBatchIds(event.target.value)}
                  size="small"
                />
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => {
                    if (!jobTemplateId || !jobStartDate || !jobEndDate) {
                      toast.show('Template ID, start date, and end date are required', 'warning')
                      return
                    }
                    const keyValues = parseJsonInput(jobKeyValues, toast, 'key values')
                    if (keyValues === null) return
                    const payload = {
                      template_id: jobTemplateId,
                      connection_id: jobConnectionId || undefined,
                      start_date: jobStartDate,
                      end_date: jobEndDate,
                      docx: jobDocx,
                      xlsx: jobXlsx,
                      key_values: keyValues,
                      batch_ids: splitList(jobBatchIds),
                    }
                    runRequest({ method: 'post', url: '/jobs/run-report', data: payload })
                  }}
                >
                  Queue Job
                </Button>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Active Jobs</Typography>
                <TextField
                  fullWidth
                  label="Limit"
                  type="number"
                  value={jobLimit}
                  onChange={(event) => setJobLimit(Number(event.target.value) || 0)}
                  size="small"
                  inputProps={{ min: 1, max: 200 }}
                />
                <Button
                  variant="outlined"
                  disabled={busy}
                  onClick={() => {
                    const limit = jobLimit > 0 ? jobLimit : 20
                    runRequest({ url: `/jobs/active?limit=${limit}` })
                  }}
                >
                  List Active Jobs
                </Button>
                <Divider />
                <Typography variant="subtitle2">Schedule Controls</Typography>
                <TextField
                  fullWidth
                  label="Schedule ID"
                  value={scheduleId}
                  onChange={(event) => setScheduleId(event.target.value)}
                  size="small"
                />
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() => {
                      if (!scheduleId) {
                        toast.show('Schedule ID required', 'warning')
                        return
                      }
                      runRequest({ method: 'post', url: `/reports/schedules/${encodeURIComponent(scheduleId)}/trigger` })
                    }}
                  >
                    Trigger
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() => {
                      if (!scheduleId) {
                        toast.show('Schedule ID required', 'warning')
                        return
                      }
                      runRequest({ method: 'post', url: `/reports/schedules/${encodeURIComponent(scheduleId)}/pause` })
                    }}
                  >
                    Pause
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() => {
                      if (!scheduleId) {
                        toast.show('Schedule ID required', 'warning')
                        return
                      }
                      runRequest({ method: 'post', url: `/reports/schedules/${encodeURIComponent(scheduleId)}/resume` })
                    }}
                  >
                    Resume
                  </Button>
                </Stack>
              </Stack>
            </Grid>
          </Grid>
        </Surface>
        <Surface>
          <SectionHeader
            title="Analyze v2 Extras"
            subtitle="Compare analyses, manage comments, create share links, and load config values."
          />
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Compare Analyses</Typography>
                <TextField
                  fullWidth
                  label="Analysis ID 1"
                  value={compareId1}
                  onChange={(event) => setCompareId1(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Analysis ID 2"
                  value={compareId2}
                  onChange={(event) => setCompareId2(event.target.value)}
                  size="small"
                />
                <Button
                  variant="outlined"
                  disabled={busy}
                  onClick={() => {
                    if (!compareId1 || !compareId2) {
                      toast.show('Both analysis IDs are required', 'warning')
                      return
                    }
                    runRequest({
                      method: 'post',
                      url: '/analyze/v2/compare',
                      data: {
                        analysis_id_1: compareId1,
                        analysis_id_2: compareId2,
                      },
                    })
                  }}
                >
                  Compare
                </Button>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Comments</Typography>
                <TextField
                  fullWidth
                  label="Analysis ID"
                  value={commentAnalysisId}
                  onChange={(event) => setCommentAnalysisId(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="User ID"
                  value={commentUserId}
                  onChange={(event) => setCommentUserId(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="User Name"
                  value={commentUserName}
                  onChange={(event) => setCommentUserName(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Element Type (optional)"
                  value={commentElementType}
                  onChange={(event) => setCommentElementType(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Element ID (optional)"
                  value={commentElementId}
                  onChange={(event) => setCommentElementId(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Comment"
                  value={commentContent}
                  onChange={(event) => setCommentContent(event.target.value)}
                  size="small"
                  multiline
                  minRows={2}
                />
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button
                    variant="outlined"
                    disabled={busy}
                    onClick={() => {
                      if (!commentAnalysisId) {
                        toast.show('Analysis ID is required', 'warning')
                        return
                      }
                      runRequest({ url: `/analyze/v2/${encodeURIComponent(commentAnalysisId)}/comments` })
                    }}
                  >
                    List Comments
                  </Button>
                  <Button
                    variant="contained"
                    disabled={busy}
                    onClick={() => {
                      if (!commentAnalysisId || !commentContent) {
                        toast.show('Analysis ID and comment content are required', 'warning')
                        return
                      }
                      runRequest({
                        method: 'post',
                        url: `/analyze/v2/${encodeURIComponent(commentAnalysisId)}/comments`,
                        data: {
                          content: commentContent,
                          user_id: commentUserId || undefined,
                          user_name: commentUserName || undefined,
                          element_type: commentElementType || undefined,
                          element_id: commentElementId || undefined,
                        },
                      })
                    }}
                  >
                    Add Comment
                  </Button>
                </Stack>
              </Stack>
            </Grid>
            <Grid item xs={12}>
              <Divider />
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Share Links</Typography>
                <TextField
                  fullWidth
                  label="Analysis ID"
                  value={shareAnalysisId}
                  onChange={(event) => setShareAnalysisId(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  select
                  label="Access Level"
                  value={shareAccessLevel}
                  onChange={(event) => setShareAccessLevel(event.target.value)}
                  size="small"
                >
                  <MenuItem value="view">View</MenuItem>
                  <MenuItem value="comment">Comment</MenuItem>
                  <MenuItem value="edit">Edit</MenuItem>
                </TextField>
                <TextField
                  fullWidth
                  label="Expires in Hours (optional)"
                  value={shareExpiresHours}
                  onChange={(event) => setShareExpiresHours(event.target.value)}
                  size="small"
                  type="number"
                />
                <TextField
                  fullWidth
                  label="Allowed Emails (comma separated)"
                  value={shareAllowedEmails}
                  onChange={(event) => setShareAllowedEmails(event.target.value)}
                  size="small"
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={sharePasswordProtected}
                      onChange={(event) => setSharePasswordProtected(event.target.checked)}
                    />
                  }
                  label="Password Protected"
                />
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => {
                    if (!shareAnalysisId) {
                      toast.show('Analysis ID is required', 'warning')
                      return
                    }
                    const expires = shareExpiresHours ? Number(shareExpiresHours) : undefined
                    runRequest({
                      method: 'post',
                      url: `/analyze/v2/${encodeURIComponent(shareAnalysisId)}/share`,
                      data: {
                        access_level: shareAccessLevel,
                        expires_hours: Number.isFinite(expires) ? expires : undefined,
                        password_protected: sharePasswordProtected,
                        allowed_emails: splitList(shareAllowedEmails),
                      },
                    })
                  }}
                >
                  Create Share Link
                </Button>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Config Endpoints</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/analyze/v2/config/industries' })}>Industries</Button>
                  <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/analyze/v2/config/export-formats' })}>Export Formats</Button>
                  <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/analyze/v2/config/chart-types' })}>Chart Types</Button>
                  <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/analyze/v2/config/summary-modes' })}>Summary Modes</Button>
                </Stack>
              </Stack>
            </Grid>
          </Grid>
        </Surface>
        <Surface>
          <SectionHeader
            title="Enrichment Extras"
            subtitle="Legacy source-type endpoints and source lookups."
          />
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/enrichment/source-types' })}>/enrichment/source-types</Button>
              <Button variant="outlined" disabled={busy} onClick={() => runRequest({ url: '/enrichment/sources' })}>/enrichment/sources</Button>
            </Stack>
            <TextField
              fullWidth
              label="Source ID"
              value={enrichmentSourceId}
              onChange={(event) => setEnrichmentSourceId(event.target.value)}
              size="small"
            />
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => {
                if (!enrichmentSourceId) {
                  toast.show('Source ID required', 'warning')
                  return
                }
                runRequest({ url: `/enrichment/sources/${encodeURIComponent(enrichmentSourceId)}` })
              }}
            >
              Get Source
            </Button>
          </Stack>
        </Surface>

        <Surface>
          <SectionHeader
            title="Charts API"
            subtitle="Request chart analysis and generation directly."
          />
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Analyze Data</Typography>
                <TextField
                  fullWidth
                  label="Data (JSON array)"
                  value={chartData}
                  onChange={(event) => setChartData(event.target.value)}
                  size="small"
                  multiline
                  minRows={4}
                />
                <TextField
                  fullWidth
                  label="Max Suggestions"
                  type="number"
                  value={chartMaxSuggestions}
                  onChange={(event) => setChartMaxSuggestions(Number(event.target.value) || 0)}
                  size="small"
                  inputProps={{ min: 1, max: 10 }}
                />
                <Button
                  variant="outlined"
                  disabled={busy}
                  onClick={() => {
                    const data = parseJsonInput(chartData, toast, 'chart data')
                    if (data === null) return
                    runRequest({
                      method: 'post',
                      url: '/charts/analyze?background=true',
                      data: {
                        data,
                        max_suggestions: chartMaxSuggestions || 3,
                      },
                    })
                  }}
                >
                  Analyze Charts
                </Button>
              </Stack>
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Generate Chart</Typography>
                <TextField
                  fullWidth
                  label="Chart Type"
                  value={chartType}
                  onChange={(event) => setChartType(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="X Field"
                  value={chartXField}
                  onChange={(event) => setChartXField(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Y Fields (comma separated)"
                  value={chartYFields}
                  onChange={(event) => setChartYFields(event.target.value)}
                  size="small"
                />
                <TextField
                  fullWidth
                  label="Title (optional)"
                  value={chartTitle}
                  onChange={(event) => setChartTitle(event.target.value)}
                  size="small"
                />
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => {
                    const data = parseJsonInput(chartData, toast, 'chart data')
                    if (data === null) return
                    runRequest({
                      method: 'post',
                      url: '/charts/generate?background=true',
                      data: {
                        data,
                        chart_type: chartType || 'bar',
                        x_field: chartXField,
                        y_fields: splitList(chartYFields),
                        title: chartTitle || undefined,
                      },
                    })
                  }}
                >
                  Generate Chart
                </Button>
              </Stack>
            </Grid>
          </Grid>
        </Surface>

        <Surface>
          <SectionHeader
            title="Latest Response"
            subtitle="Most recent API payload and status metadata."
          />
          <Stack spacing={1.5}>
            {lastResponse ? (
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip label={`${(lastResponse.method || 'GET').toUpperCase()} ${lastResponse.url || ''}`} />
                {lastResponse.status && (
                  <Chip
                    label={`Status ${lastResponse.status}`}
                    color={lastResponse.status >= 200 && lastResponse.status < 300 ? 'success' : 'error'}
                    variant="outlined"
                  />
                )}
                {lastResponse.timestamp && (
                  <Chip label={new Date(lastResponse.timestamp).toLocaleTimeString()} variant="outlined" />
                )}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No requests yet.
              </Typography>
            )}
            <Box
              component="pre"
              sx={{
                mt: 1,
                p: 2,
                borderRadius: 1,  // Figma spec: 8px
                backgroundColor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
                fontSize: '12px',
                overflow: 'auto',
                maxHeight: 320,
              }}
            >
              {responseBody}
            </Box>
          </Stack>
        </Surface>
      </Stack>
    </Box>
  )
}

// === From: stats.jsx ===
/**
 * Premium Usage Statistics Page
 * Beautiful analytics dashboard with charts and theme-based styling
 */



const HeaderContainer = styled(Stack)(({ theme }) => ({
  marginBottom: theme.spacing(3),
  animation: `${fadeInUp} 0.5s ease-out`,
}))

const StyledTabs = styled(Tabs)(({ theme }) => ({
  marginBottom: theme.spacing(3),
  '& .MuiTab-root': {
    // Figma spec: Inactive tab - #374151 text, transparent bg
    color: theme.palette.mode === 'dark' ? theme.palette.text.secondary : neutral[700],
    textTransform: 'none',
    minWidth: 100,
    fontWeight: 500,
    transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
    padding: '8px 32px',  // Figma spec
    '&.Mui-selected': {
      // Figma spec: Active tab - #02634E text, #EBFEF6 bg
      color: theme.palette.mode === 'dark' ? theme.palette.text.primary : neutral[900],
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    },
    '&:hover': {
      color: theme.palette.mode === 'dark' ? theme.palette.text.primary : neutral[700],
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
    },
  },
  '& .MuiTabs-indicator': {
    backgroundColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[900],
    height: 2,
  },
}))

const StatCardContent = styled(CardContent)(({ theme }) => ({
  padding: theme.spacing(2.5),
  '&:last-child': {
    paddingBottom: theme.spacing(2.5),
  },
}))


const PERIOD_OPTIONS = [
  { value: 'day', label: 'Last 24 hours' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
]

const getChartColors = (theme) => [
  theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
  theme.palette.mode === 'dark' ? neutral[500] : neutral[500],
  theme.palette.mode === 'dark' ? neutral[300] : neutral[500],
  theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  theme.palette.mode === 'dark' ? neutral[300] : neutral[300],
  theme.palette.text.secondary,
]

const getStatusColors = (theme) => ({
  completed: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
  failed: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  pending: theme.palette.mode === 'dark' ? neutral[300] : neutral[500],
  running: theme.palette.mode === 'dark' ? neutral[500] : neutral[500],
  cancelled: theme.palette.text.secondary,
})


function StatCard({ title, value, subtitle, icon: Icon, trend, color, onClick }) {
  const theme = useTheme()
  const trendPositive = trend > 0
  const TrendIcon = trendPositive ? TrendingUpIcon : TrendingDownIcon
  const trendColor = theme.palette.text.secondary
  const accentColor = color || (theme.palette.mode === 'dark' ? neutral[500] : neutral[700])

  return (
    <GlassCard
      onClick={onClick}
      sx={{
        height: '100%',
        cursor: onClick ? 'pointer' : 'default',
        animation: `${fadeInUp} 0.5s ease-out`,
        '&:active': onClick ? { transform: 'scale(0.98)' } : {},
      }}
    >
      <StatCardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
          <Box>
            <Typography
              sx={{
                fontSize: '0.75rem',
                fontWeight: 500,
                color: theme.palette.text.secondary,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                mb: 0.5,
              }}
            >
              {title}
            </Typography>
            <Typography
              sx={{
                fontSize: '1.75rem',
                fontWeight: 600,
                color: theme.palette.text.primary,
                lineHeight: 1.2,
              }}
            >
              {value}
            </Typography>
            {subtitle && (
              <Typography
                sx={{
                  fontSize: '0.75rem',
                  color: theme.palette.text.secondary,
                  mt: 0.5,
                }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2.5,
              bgcolor: alpha(accentColor, 0.15),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon sx={{ fontSize: 20, color: accentColor }} />
          </Box>
        </Stack>
        {trend !== undefined && trend !== null && (
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 1.5 }}>
            <TrendIcon sx={{ fontSize: 14, color: trendColor }} />
            <Typography sx={{ fontSize: '0.75rem', color: trendColor, fontWeight: 500 }}>
              {Math.abs(trend)}%
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: theme.palette.text.secondary }}>
              vs previous period
            </Typography>
          </Stack>
        )}
      </StatCardContent>
    </GlassCard>
  )
}


function ChartCard({ title, subtitle, children, height = 280, actions }) {
  const theme = useTheme()

  return (
    <GlassCard sx={{ height: '100%', animation: `${fadeInUp} 0.5s ease-out 0.2s both` }}>
      <CardContent sx={{ p: 2.5, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box>
            <Typography
              sx={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: theme.palette.text.primary,
              }}
            >
              {title}
            </Typography>
            {subtitle && (
              <Typography
                sx={{
                  fontSize: '0.75rem',
                  color: theme.palette.text.secondary,
                  mt: 0.25,
                }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>
          {actions}
        </Stack>
        <Box sx={{ flex: 1, minHeight: height }}>
          {children}
        </Box>
      </CardContent>
    </GlassCard>
  )
}


function CustomTooltip({ active, payload, label }) {
  const theme = useTheme()
  if (!active || !payload?.length) return null

  return (
    <Box
      sx={{
        bgcolor: alpha(theme.palette.background.paper, 0.95),
        backdropFilter: 'blur(8px)',
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        borderRadius: 1,  // Figma spec: 8px
        p: 1.5,
        boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.15)}`,
      }}
    >
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: theme.palette.text.primary, mb: 0.5 }}>
        {label}
      </Typography>
      {payload.map((entry, index) => (
        <Stack key={index} direction="row" alignItems="center" spacing={1}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: entry.color,
            }}
          />
          <Typography sx={{ fontSize: '12px', color: theme.palette.text.secondary }}>
            {entry.name}: {entry.value}
          </Typography>
        </Stack>
      ))}
    </Box>
  )
}


const TAB_MAP = { overview: 0, jobs: 1, templates: 2 }
const TAB_NAMES = ['overview', 'jobs', 'templates']

export function UsageStatsPage() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const navigate = useNavigateInteraction()
  const [searchParams, setSearchParams] = useSearchParams()
  const didLoadRef = useRef(false)
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { from: 'stats', ...intent } }),
    [navigate]
  )

  // Get tab from URL or default to 0
  const tabParam = searchParams.get('tab') || 'overview'
  const activeTab = TAB_MAP[tabParam] ?? 0

  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(searchParams.get('period') || 'week')

  const [dashboardData, setDashboardData] = useState(null)
  const [usageData, setUsageData] = useState(null)
  const [historyData, setHistoryData] = useState(null)

  // Chart colors based on theme
  const CHART_COLORS = useMemo(() => getChartColors(theme), [theme])
  const STATUS_COLORS = useMemo(() => getStatusColors(theme), [theme])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [dashboard, usage, history] = await Promise.all([
        api.getDashboardAnalytics(),
        api.getUsageStatistics(period),
        api.getReportHistory({ limit: 100 }),
      ])
      setDashboardData(dashboard)
      setUsageData(usage)
      setHistoryData(history)
    } catch (err) {
      toast.show(err.message || 'Failed to load statistics', 'error')
    } finally {
      setLoading(false)
    }
  }, [period, toast])

  const handleRefresh = useCallback(
    () =>
      execute({
        type: InteractionType.EXECUTE,
        label: 'Refresh usage statistics',
        reversibility: Reversibility.FULLY_REVERSIBLE,
        suppressSuccessToast: true,
        intent: { period },
        action: fetchData,
      }),
    [execute, fetchData, period]
  )

  useEffect(() => {
    if (didLoadRef.current) return
    didLoadRef.current = true
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!didLoadRef.current) return
    fetchData()
  }, [period, fetchData])

  const summary = dashboardData?.summary || {}
  const metrics = dashboardData?.metrics || {}
  const jobsTrend = dashboardData?.jobsTrend || []
  const topTemplates = dashboardData?.topTemplates || []

  const statusData = useMemo(() => {
    const byStatus = usageData?.byStatus || {}
    return Object.entries(byStatus).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: STATUS_COLORS[name] || theme.palette.text.secondary,
    }))
  }, [usageData, STATUS_COLORS, theme])

  const kindData = useMemo(() => {
    const byKind = usageData?.byKind || {}
    return Object.entries(byKind).map(([name, value]) => ({
      name: name.toUpperCase(),
      value,
      color: name === 'pdf'
        ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900])
        : (theme.palette.mode === 'dark' ? neutral[500] : neutral[700]),
    }))
  }, [usageData, theme])

  const templateBreakdown = useMemo(() => {
    const breakdown = usageData?.templateBreakdown || []
    if (breakdown.length > 0) return breakdown
    return topTemplates.slice(0, 6).map((t) => ({
      name: t.name || t.id?.slice(0, 12),
      count: t.runCount || 0,
      kind: t.kind || 'pdf',
    }))
  }, [usageData, topTemplates])

  const historyByDay = useMemo(() => {
    const history = historyData?.history || []
    const byDay = {}
    history.forEach((item) => {
      const date = item.createdAt?.split('T')[0]
      if (!date) return
      if (!byDay[date]) {
        byDay[date] = { date, completed: 0, failed: 0, total: 0 }
      }
      byDay[date].total += 1
      if (item.status === 'completed') byDay[date].completed += 1
      else if (item.status === 'failed') byDay[date].failed += 1
    })
    return Object.values(byDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14)
  }, [historyData])

  const handleExportStats = useCallback(
    () =>
      execute({
        type: InteractionType.DOWNLOAD,
        label: 'Export usage statistics',
        reversibility: Reversibility.FULLY_REVERSIBLE,
        intent: { period },
        action: async () => {
          const exportData = {
            exportedAt: new Date().toISOString(),
            period,
            dashboard: dashboardData,
            usage: usageData,
            historyCount: historyData?.total || 0,
          }
          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `neurareport-stats-${period}-${Date.now()}.json`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)
        },
      }),
    [execute, period, dashboardData, usageData, historyData]
  )

  if (loading && !dashboardData) {
    return (
      <PageContainer>
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <CircularProgress size={40} />
          <Typography sx={{ mt: 2, color: theme.palette.text.secondary }}>
            Loading statistics...
          </Typography>
        </Box>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      {/* Header */}
      <HeaderContainer direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h5" fontWeight={600} sx={{ color: theme.palette.text.primary }}>
            Usage Statistics
          </Typography>
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
            Detailed analytics and insights for your workspace
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center">
          <StyledFormControl size="small">
            <InputLabel>Time Period</InputLabel>
            <Select
              value={period}
              onChange={(e) => {
                const newPeriod = e.target.value
                setPeriod(newPeriod)
                const newParams = new URLSearchParams(searchParams)
                newParams.set('period', newPeriod)
                setSearchParams(newParams, { replace: true })
              }}
              label="Time Period"
            >
              {PERIOD_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </StyledFormControl>
          <ExportButton
            variant="outlined"
            size="small"
            startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
            onClick={handleExportStats}
          >
            Export
          </ExportButton>
          <RefreshButton
            onClick={handleRefresh}
            disabled={loading}
            sx={{ color: theme.palette.text.secondary }}
          >
            {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
          </RefreshButton>
        </Stack>
      </HeaderContainer>

      {/* Overview Stats */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Total Jobs"
            value={summary.totalJobs || 0}
            subtitle={`${metrics.jobsThisWeek || 0} this week`}
            icon={WorkIcon}
            color={theme.palette.mode === 'dark' ? neutral[500] : neutral[500]}
            onClick={() => handleNavigate('/jobs', 'Open jobs')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Success Rate"
            value={`${(metrics.successRate || 0).toFixed(1)}%`}
            subtitle={`${summary.completedJobs || 0} completed`}
            icon={CheckCircleIcon}
            color={theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}
            onClick={() => handleNavigate('/history', 'Open history')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Templates"
            value={summary.totalTemplates || 0}
            subtitle={`${summary.approvedTemplates || 0} approved`}
            icon={DescriptionIcon}
            color={theme.palette.mode === 'dark' ? neutral[300] : neutral[500]}
            onClick={() => handleNavigate('/templates', 'Open templates')}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="Connections"
            value={summary.totalConnections || 0}
            subtitle={`${summary.activeConnections || 0} active`}
            icon={StorageIcon}
            color={theme.palette.mode === 'dark' ? neutral[300] : neutral[300]}
            onClick={() => handleNavigate('/connections', 'Open connections')}
          />
        </Grid>
      </Grid>

      {/* Tabs */}
      <StyledTabs
        value={activeTab}
        onChange={(e, v) => {
          const newParams = new URLSearchParams(searchParams)
          newParams.set('tab', TAB_NAMES[v])
          setSearchParams(newParams, { replace: true })
        }}
      >
        <Tab label="Overview" icon={<BarChartIcon sx={{ fontSize: 18 }} />} iconPosition="start" />
        <Tab label="Jobs" icon={<WorkIcon sx={{ fontSize: 18 }} />} iconPosition="start" />
        <Tab label="Templates" icon={<DescriptionIcon sx={{ fontSize: 18 }} />} iconPosition="start" />
      </StyledTabs>

      {/* Tab Content */}
      {activeTab === 0 && (
        <Grid container spacing={2}>
          {/* Jobs Trend Chart */}
          <Grid size={{ xs: 12, lg: 8 }}>
            <ChartCard title="Jobs Trend" subtitle="Daily job completions over the past week">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={jobsTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.3)} />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                    axisLine={{ stroke: alpha(theme.palette.divider, 0.3) }}
                  />
                  <YAxis
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                    axisLine={{ stroke: alpha(theme.palette.divider, 0.3) }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="completed" name="Completed" fill={theme.palette.mode === 'dark' ? neutral[500] : neutral[700]} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="failed" name="Failed" fill={theme.palette.mode === 'dark' ? neutral[700] : neutral[900]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </Grid>

          {/* Status Distribution */}
          <Grid size={{ xs: 12, lg: 4 }}>
            <ChartCard title="Job Status" subtitle="Distribution by status">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    formatter={(value) => (
                      <span style={{ color: theme.palette.text.secondary, fontSize: '0.75rem' }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          </Grid>

          {/* Template Type Distribution */}
          <Grid size={{ xs: 12, md: 6 }}>
            <ChartCard title="Template Types" subtitle="PDF vs Excel usage">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={kindData}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: theme.palette.text.secondary }}
                  >
                    {kindData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          </Grid>

          {/* Top Templates */}
          <Grid size={{ xs: 12, md: 6 }}>
            <ChartCard title="Top Templates" subtitle="Most used templates">
              {templateBreakdown.length === 0 ? (
                <Box sx={{ py: 6, textAlign: 'center' }}>
                  <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.875rem' }}>
                    No template usage data
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={1.5}>
                  {templateBreakdown.map((template, index) => (
                    <Box key={index}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Typography sx={{ fontSize: '14px', color: theme.palette.text.primary }}>
                            {template.name}
                          </Typography>
                          <Chip
                            label={template.kind?.toUpperCase()}
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: '10px',
                              bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                              color: 'text.secondary',
                              borderRadius: 1,
                            }}
                          />
                        </Stack>
                        <Typography sx={{ fontSize: '0.75rem', color: theme.palette.text.secondary }}>
                          {template.count} runs
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={
                          templateBreakdown[0]?.count
                            ? (template.count / templateBreakdown[0].count) * 100
                            : 0
                        }
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          bgcolor: alpha(theme.palette.divider, 0.15),
                          '& .MuiLinearProgress-bar': {
                            bgcolor: CHART_COLORS[index % CHART_COLORS.length],
                            borderRadius: 3,
                          },
                        }}
                      />
                    </Box>
                  ))}
                </Stack>
              )}
            </ChartCard>
          </Grid>
        </Grid>
      )}

      {activeTab === 1 && (
        <Grid container spacing={2}>
          {/* Jobs Over Time */}
          <Grid size={12}>
            <ChartCard title="Jobs History" subtitle="Job executions over the past 2 weeks" height={320}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historyByDay}>
                  <defs>
                    <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={theme.palette.mode === 'dark' ? neutral[500] : neutral[700]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={theme.palette.mode === 'dark' ? neutral[500] : neutral[700]} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={theme.palette.mode === 'dark' ? neutral[700] : neutral[900]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={theme.palette.mode === 'dark' ? neutral[700] : neutral[900]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.3)} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: theme.palette.text.secondary, fontSize: 10 }}
                    axisLine={{ stroke: alpha(theme.palette.divider, 0.3) }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                    axisLine={{ stroke: alpha(theme.palette.divider, 0.3) }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="completed"
                    name="Completed"
                    stroke={theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}
                    fill="url(#colorCompleted)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="failed"
                    name="Failed"
                    stroke={theme.palette.mode === 'dark' ? neutral[700] : neutral[900]}
                    fill="url(#colorFailed)"
                    strokeWidth={2}
                  />
                  <Legend
                    verticalAlign="top"
                    height={36}
                    formatter={(value) => (
                      <span style={{ color: theme.palette.text.secondary, fontSize: '0.75rem' }}>{value}</span>
                    )}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </Grid>

          {/* Job Stats Cards */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Jobs Today"
              value={metrics.jobsToday || 0}
              icon={ScheduleIcon}
              color={theme.palette.mode === 'dark' ? neutral[500] : neutral[500]}
              onClick={() => handleNavigate('/jobs', 'Open jobs')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Jobs This Week"
              value={metrics.jobsThisWeek || 0}
              icon={WorkIcon}
              color={theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}
              onClick={() => handleNavigate('/jobs', 'Open jobs')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Jobs This Month"
              value={metrics.jobsThisMonth || 0}
              icon={BarChartIcon}
              color={theme.palette.mode === 'dark' ? neutral[300] : neutral[500]}
              onClick={() => handleNavigate('/jobs', 'Open jobs')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Failed Jobs"
              value={summary.failedJobs || 0}
              icon={ErrorIcon}
              color={theme.palette.mode === 'dark' ? neutral[700] : neutral[900]}
              onClick={() =>
                handleNavigate('/history?status=failed', 'Open failed history', { status: 'failed' })
              }
            />
          </Grid>
        </Grid>
      )}

      {activeTab === 2 && (
        <Grid container spacing={2}>
          {/* Template Stats */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Total Templates"
              value={summary.totalTemplates || 0}
              icon={DescriptionIcon}
              color={theme.palette.mode === 'dark' ? neutral[500] : neutral[500]}
              onClick={() => handleNavigate('/templates', 'Open templates')}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="PDF Templates"
              value={summary.pdfTemplates || 0}
              icon={DescriptionIcon}
              color={theme.palette.mode === 'dark' ? neutral[700] : neutral[900]}
              onClick={() =>
                handleNavigate('/templates?kind=pdf', 'Open PDF templates', { kind: 'pdf' })
              }
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Excel Templates"
              value={summary.excelTemplates || 0}
              icon={DescriptionIcon}
              color={theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}
              onClick={() =>
                handleNavigate('/templates?kind=excel', 'Open Excel templates', { kind: 'excel' })
              }
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <StatCard
              title="Active Schedules"
              value={summary.activeSchedules || 0}
              icon={ScheduleIcon}
              color={theme.palette.mode === 'dark' ? neutral[300] : neutral[500]}
              onClick={() => handleNavigate('/schedules', 'Open schedules')}
            />
          </Grid>

          {/* Template Usage */}
          <Grid size={12}>
            <ChartCard title="Template Usage Breakdown" subtitle="Jobs per template" height={400}>
              {templateBreakdown.length === 0 ? (
                <Box sx={{ py: 8, textAlign: 'center' }}>
                  <DescriptionIcon sx={{ fontSize: 48, color: theme.palette.text.disabled, mb: 2 }} />
                  <Typography sx={{ color: theme.palette.text.secondary, fontSize: '0.875rem' }}>
                    No template usage data available
                  </Typography>
                </Box>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={templateBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.3)} />
                    <XAxis
                      type="number"
                      tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                      axisLine={{ stroke: alpha(theme.palette.divider, 0.3) }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                      axisLine={{ stroke: alpha(theme.palette.divider, 0.3) }}
                      width={120}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" name="Jobs" fill={theme.palette.mode === 'dark' ? neutral[500] : neutral[700]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </Grid>
        </Grid>
      )}
    </PageContainer>
  )
}
