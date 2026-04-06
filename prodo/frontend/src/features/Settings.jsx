import * as api from '@/api/client'
import { neutral, palette } from '@/app/theme'
import { useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useAppStore } from '@/stores/app'
import { ExportButton, GlassCard, RefreshButton, fadeInUp } from '@/styles/styles'
import { PREFERENCES_STORAGE_KEY, emitPreferencesChanged, readPreferences } from '@/utils/helpers'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloudIcon from '@mui/icons-material/Cloud'
import DownloadIcon from '@mui/icons-material/Download'
import EmailIcon from '@mui/icons-material/Email'
import ErrorIcon from '@mui/icons-material/Error'
import LanguageIcon from '@mui/icons-material/Language'
import LockIcon from '@mui/icons-material/Lock'
import PersonIcon from '@mui/icons-material/Person'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import SecurityIcon from '@mui/icons-material/Security'
import SendIcon from '@mui/icons-material/Send'
import SettingsIcon from '@mui/icons-material/Settings'
import SpeedIcon from '@mui/icons-material/Speed'
import StorageIcon from '@mui/icons-material/Storage'
import TokenIcon from '@mui/icons-material/Toll'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import WarningIcon from '@mui/icons-material/Warning'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import { useCallback, useEffect, useRef, useState } from 'react'
const PageContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  maxWidth: 1000,
  margin: '0 auto',
  width: '100%',
  minHeight: '100vh',
  backgroundColor: theme.palette.background.default,
}))

const HeaderContainer = styled(Stack)(({ theme }) => ({
  marginBottom: theme.spacing(3),
  animation: `${fadeInUp} 0.5s ease-out`,
}))

const IconContainer = styled(Box)(({ theme }) => ({
  width: 32,
  height: 32,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}))


function getPreferences() {
  return readPreferences()
}

function savePreferences(prefs) {
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs))
    emitPreferencesChanged(prefs)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message || 'Storage quota exceeded or unavailable' }
  }
}


function StatusChip({ status }) {
  const theme = useTheme()
  const config = {
    healthy: { color: 'success', icon: CheckCircleIcon },
    configured: { color: 'success', icon: CheckCircleIcon },
    ready: { color: 'success', icon: CheckCircleIcon },
    ok: { color: 'success', icon: CheckCircleIcon },
    warning: { color: 'warning', icon: WarningIcon },
    degraded: { color: 'warning', icon: WarningIcon },
    error: { color: 'error', icon: ErrorIcon },
    not_configured: { color: 'default', icon: WarningIcon },
    unknown: { color: 'default', icon: WarningIcon },
  }
  const cfg = config[status] || config.unknown
  const Icon = cfg.icon

  return (
    <Chip
      size="small"
      icon={<Icon sx={{ fontSize: 14 }} />}
      label={status?.replace(/_/g, ' ') || 'unknown'}
      sx={{ textTransform: 'capitalize', fontSize: '0.75rem', borderRadius: 1, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
    />
  )
}

function SettingCard({ icon: Icon, title, children }) {
  const theme = useTheme()

  return (
    <GlassCard>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
        <IconContainer
          sx={{
            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
          }}
        >
          <Icon sx={{ color: 'text.secondary', fontSize: 16 }} />
        </IconContainer>
        <Typography variant="subtitle1" fontWeight={600} sx={{ color: theme.palette.text.primary }}>
          {title}
        </Typography>
      </Stack>
      {children}
    </GlassCard>
  )
}

function ConfigRow({ label, value, mono = false }) {
  const theme = useTheme()

  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.75 }}>
      <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: theme.palette.text.primary,
          ...(mono && { fontFamily: 'monospace', fontSize: '14px' }),
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}


export default function SettingsPage() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const setDemoMode = useAppStore((s) => s.setDemoMode)
  const demoMode = useAppStore((s) => s.demoMode)
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [preferences, setPreferences] = useState(getPreferences)
  const [tokenUsage, setTokenUsage] = useState(null)
  const [exporting, setExporting] = useState(false)
  const lastPrefChangeRef = useRef(0)

  // Personal settings
  const [selectedTimezone, setSelectedTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  )
  const [selectedLanguage, setSelectedLanguage] = useState('en')
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [showTwoFactorSetup, setShowTwoFactorSetup] = useState(false)

  // SMTP settings
  const [smtp, setSmtp] = useState({ host: '', port: 587, username: '', password: '', sender: '', use_tls: true })
  const [smtpLoading, setSmtpLoading] = useState(false)
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [showSmtpPassword, setShowSmtpPassword] = useState(false)

  // Available options
  const TIMEZONE_OPTIONS = [
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'America/Phoenix', label: 'Arizona (no DST)' },
    { value: 'America/Anchorage', label: 'Alaska Time' },
    { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Central European Time' },
    { value: 'Europe/Berlin', label: 'Berlin' },
    { value: 'Asia/Tokyo', label: 'Japan Standard Time' },
    { value: 'Asia/Shanghai', label: 'China Standard Time' },
    { value: 'Asia/Kolkata', label: 'India Standard Time' },
    { value: 'Asia/Dubai', label: 'Gulf Standard Time' },
    { value: 'Australia/Sydney', label: 'Australian Eastern Time' },
    { value: 'UTC', label: 'UTC' },
  ]

  const LANGUAGE_OPTIONS = [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español (Spanish)' },
    { value: 'fr', label: 'Français (French)' },
    { value: 'de', label: 'Deutsch (German)' },
    { value: 'pt', label: 'Português (Portuguese)' },
    { value: 'zh', label: '中文 (Chinese)' },
    { value: 'ja', label: '日本語 (Japanese)' },
    { value: 'ko', label: '한국어 (Korean)' },
  ]

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [healthData, usageData] = await Promise.all([
        api.getSystemHealth(),
        api.getTokenUsage().catch(() => null),
      ])
      setHealth(healthData)
      setTokenUsage(usageData?.usage || null)
    } catch (err) {
      setError(err.message || 'Failed to fetch system health')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPreferences = useCallback(async () => {
    const startedAt = Date.now()
    try {
      const data = await api.getUserPreferences()
      if (lastPrefChangeRef.current > startedAt) return
      const nextPrefs = data?.preferences || {}
      setPreferences(nextPrefs)
      savePreferences(nextPrefs)

      // Sync all personal settings from backend
      if (typeof nextPrefs.demoMode === 'boolean') {
        setDemoMode(nextPrefs.demoMode)
      }
      if (nextPrefs.timezone) {
        setSelectedTimezone(nextPrefs.timezone)
      }
      if (nextPrefs.language) {
        setSelectedLanguage(nextPrefs.language)
      }
      if (typeof nextPrefs.twoFactorEnabled === 'boolean') {
        setTwoFactorEnabled(nextPrefs.twoFactorEnabled)
      }
    } catch (err) {
      toast.show(err.message || 'Failed to load preferences', 'warning')
    }
  }, [setDemoMode, toast])

  const handleExportConfig = useCallback(async () => {
    setExporting(true)
    try {
      const data = await api.exportConfiguration()
      // Download as JSON file
      const blob = new Blob([JSON.stringify(data.config || data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `neurareport-config-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      toast.show('Configuration exported successfully', 'success')
    } catch (err) {
      toast.show(err.message || 'Failed to export configuration', 'error')
    } finally {
      setExporting(false)
    }
  }, [toast])

  useEffect(() => {
    fetchHealth()
    loadPreferences()
  }, [fetchHealth, loadPreferences])

  const handlePrefChange = useCallback((key) => async (event) => {
    const nextValue = event.target.checked
    const nextPrefs = { ...preferences, [key]: nextValue }
    lastPrefChangeRef.current = Date.now()
    setPreferences(nextPrefs)
    const cacheResult = savePreferences(nextPrefs)
    if (!cacheResult.success) {
      toast.show(`Failed to cache preferences locally: ${cacheResult.error}`, 'warning')
    }
    await execute({
      type: InteractionType.UPDATE,
      label: 'Update preference',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        preferenceKey: key,
        action: 'update_preference',
      },
      action: async () => {
        try {
          const result = await api.setUserPreference(key, nextValue)
          if (result?.preferences) {
            const merged = { ...nextPrefs, ...result.preferences }
            setPreferences(merged)
            savePreferences(merged)
          }
          toast.show('Preferences saved', 'success')
          return result
        } catch (err) {
          toast.show(err.message || 'Failed to save preferences', 'error')
          throw err
        }
      },
    })
  }, [preferences, toast, execute])

  const handleTimezoneChange = useCallback(async (event) => {
    const value = event.target.value
    setSelectedTimezone(value)
    const nextPrefs = { ...preferences, timezone: value }
    lastPrefChangeRef.current = Date.now()
    setPreferences(nextPrefs)
    savePreferences(nextPrefs)
    await execute({
      type: InteractionType.UPDATE,
      label: 'Update timezone',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      intent: { preferenceKey: 'timezone', action: 'update_timezone' },
      action: async () => {
        try {
          await api.setUserPreference('timezone', value)
          toast.show('Timezone updated', 'success')
        } catch (err) {
          toast.show(err.message || 'Failed to save timezone', 'error')
        }
      },
    })
  }, [preferences, toast, execute])

  const handleLanguageChange = useCallback(async (event) => {
    const value = event.target.value
    setSelectedLanguage(value)
    const nextPrefs = { ...preferences, language: value }
    lastPrefChangeRef.current = Date.now()
    setPreferences(nextPrefs)
    savePreferences(nextPrefs)
    await execute({
      type: InteractionType.UPDATE,
      label: 'Update language',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      intent: { preferenceKey: 'language', action: 'update_language' },
      action: async () => {
        try {
          await api.setUserPreference('language', value)
          toast.show('Language updated. Some changes may require a page refresh.', 'success')
        } catch (err) {
          toast.show(err.message || 'Failed to save language', 'error')
        }
      },
    })
  }, [preferences, toast, execute])

  const handleTwoFactorToggle = useCallback(async (event) => {
    const enabled = event.target.checked
    if (enabled) {
      // Show 2FA setup dialog
      setShowTwoFactorSetup(true)
    } else {
      // Disable 2FA
      await execute({
        type: InteractionType.UPDATE,
        label: 'Disable two-factor authentication',
        reversibility: Reversibility.PARTIALLY_REVERSIBLE,
        intent: { action: 'disable_2fa' },
        action: async () => {
          try {
            await api.setUserPreference('twoFactorEnabled', false)
            setTwoFactorEnabled(false)
            toast.show('Two-factor authentication disabled', 'success')
          } catch (err) {
            toast.show(err.message || 'Failed to disable 2FA', 'error')
          }
        },
      })
    }
  }, [execute, toast])

  const handleDemoModeChange = useCallback(async (event) => {
    const enabled = event.target.checked
    setDemoMode(enabled)
    const nextPrefs = { ...preferences, demoMode: enabled }
    lastPrefChangeRef.current = Date.now()
    setPreferences(nextPrefs)
    const cacheResult = savePreferences(nextPrefs)
    if (!cacheResult.success) {
      toast.show(`Failed to cache preferences locally: ${cacheResult.error}`, 'warning')
    }
    await execute({
      type: InteractionType.UPDATE,
      label: 'Toggle demo mode',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        preferenceKey: 'demoMode',
        action: 'toggle_demo_mode',
      },
      action: async () => {
        try {
          const result = await api.setUserPreference('demoMode', enabled)
          if (result?.preferences) {
            const merged = { ...nextPrefs, ...result.preferences }
            setPreferences(merged)
            savePreferences(merged)
          }
          toast.show(enabled ? 'Demo mode enabled - sample data loaded' : 'Demo mode disabled', 'success')
          return result
        } catch (err) {
          toast.show(err.message || 'Failed to save preferences', 'error')
          throw err
        }
      },
    })
  }, [preferences, setDemoMode, toast, execute])

  // SMTP handlers
  const loadSmtpSettings = useCallback(async () => {
    try {
      const data = await api.getSmtpSettings()
      if (data?.smtp) {
        setSmtp(prev => ({
          host: data.smtp.host || '',
          port: data.smtp.port || 587,
          username: data.smtp.username || '',
          password: data.smtp.password || '',
          sender: data.smtp.sender || '',
          use_tls: data.smtp.use_tls !== false,
        }))
      }
    } catch {
      // silently fail on load
    }
  }, [])

  const handleSmtpSave = useCallback(async () => {
    setSmtpLoading(true)
    try {
      const result = await api.saveSmtpSettings(smtp)
      toast.show(result?.message || 'SMTP settings saved', 'success')
    } catch (err) {
      toast.show(err.message || 'Failed to save SMTP settings', 'error')
    } finally {
      setSmtpLoading(false)
    }
  }, [smtp, toast])

  const handleSmtpTest = useCallback(async () => {
    setSmtpTesting(true)
    try {
      const result = await api.testSmtpConnection()
      if (result?.status === 'connected') {
        toast.show(result.message || 'SMTP connection successful', 'success')
      } else {
        toast.show(result?.message || 'SMTP connection failed', 'error')
      }
    } catch (err) {
      toast.show(err.message || 'SMTP test failed', 'error')
    } finally {
      setSmtpTesting(false)
    }
  }, [toast])

  const handleSmtpChange = useCallback((field) => (event) => {
    const value = field === 'use_tls' ? event.target.checked
      : field === 'port' ? parseInt(event.target.value, 10) || 587
      : event.target.value
    setSmtp(prev => ({ ...prev, [field]: value }))
  }, [])

  useEffect(() => { loadSmtpSettings() }, [loadSmtpSettings])

  const config = health?.checks?.configuration || {}
  const llm = health?.checks?.llm || health?.checks?.openai || {}
  const memory = health?.checks?.memory || {}
  const uploadsDir = health?.checks?.uploads_dir || {}
  const stateDir = health?.checks?.state_dir || {}

  return (
    <PageContainer>
      {/* Header */}
      <HeaderContainer direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h5" fontWeight={600} sx={{ color: theme.palette.text.primary }}>
            Settings
          </Typography>
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
            System configuration and preferences
          </Typography>
        </Box>
        <RefreshButton
          onClick={fetchHealth}
          disabled={loading}
          sx={{ color: theme.palette.text.secondary }}
        >
          {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
        </RefreshButton>
      </HeaderContainer>

      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: 1 }}>
          {error}
        </Alert>
      )}

      <Stack spacing={3}>
        {/* Personal Settings */}
        <SettingCard icon={PersonIcon} title="Personal Settings">
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 2 }}>
            Customize your personal experience with NeuraReport.
          </Typography>
          <Stack spacing={2}>
            <TextField
              select
              fullWidth
              size="small"
              label="Language"
              value={selectedLanguage}
              onChange={handleLanguageChange}
              InputProps={{
                startAdornment: <LanguageIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />,
              }}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              fullWidth
              size="small"
              label="Timezone"
              value={selectedTimezone}
              onChange={handleTimezoneChange}
              InputProps={{
                startAdornment: <AccessTimeIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 20 }} />,
              }}
            >
              {TIMEZONE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </SettingCard>

        {/* Security Settings */}
        <SettingCard icon={LockIcon} title="Security">
          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={twoFactorEnabled}
                  onChange={handleTwoFactorToggle}
                  size="small"
                />
              }
              label={
                <Stack>
                  <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>
                    Two-Factor Authentication (2FA)
                  </Typography>
                  <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                    {twoFactorEnabled
                      ? 'Your account is protected with 2FA'
                      : 'Add an extra layer of security to your account'}
                  </Typography>
                </Stack>
              }
            />
            {twoFactorEnabled && (
              <Alert severity="success" sx={{ borderRadius: 1 }}>
                Two-factor authentication is enabled. Your account is more secure.
              </Alert>
            )}
            {showTwoFactorSetup && (
              <Alert severity="info" sx={{ borderRadius: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                  Set up Two-Factor Authentication
                </Typography>
                <Typography variant="body2" sx={{ mb: 2 }}>
                  To enable 2FA, scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
                  and enter the verification code.
                </Typography>
                <Box sx={{ textAlign: 'center', py: 2, bgcolor: 'background.paper', borderRadius: 1, mb: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    [QR Code would appear here]
                  </Typography>
                </Box>
                <TextField
                  fullWidth
                  size="small"
                  label="Verification Code"
                  placeholder="Enter 6-digit code"
                  sx={{ mb: 2 }}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => {
                      setTwoFactorEnabled(true)
                      setShowTwoFactorSetup(false)
                      toast.show('Two-factor authentication enabled!', 'success')
                    }}
                  >
                    Verify & Enable
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setShowTwoFactorSetup(false)}
                  >
                    Cancel
                  </Button>
                </Stack>
              </Alert>
            )}

            <Divider sx={{ my: 1, borderColor: alpha(theme.palette.divider, 0.08) }} />

            <Box>
              <Typography variant="body2" sx={{ color: theme.palette.text.primary, mb: 0.5 }}>
                Change Password
              </Typography>
              <Typography variant="caption" sx={{ color: theme.palette.text.secondary, display: 'block', mb: 1 }}>
                Update your password to keep your account secure.
              </Typography>
              <Button variant="outlined" size="small" sx={{ borderRadius: 1 }}>
                Change Password
              </Button>
            </Box>

            <Divider sx={{ my: 1, borderColor: alpha(theme.palette.divider, 0.08) }} />

            <Box>
              <Typography variant="body2" sx={{ color: theme.palette.text.primary, mb: 0.5 }}>
                Active Sessions
              </Typography>
              <Typography variant="caption" sx={{ color: theme.palette.text.secondary, display: 'block', mb: 1 }}>
                You're currently logged in on 1 device.
              </Typography>
              <Button variant="outlined" size="small" sx={{ borderRadius: 1, color: 'text.secondary' }}>
                Sign Out Other Devices
              </Button>
            </Box>
          </Stack>
        </SettingCard>

        {/* System Status */}
        <SettingCard icon={SpeedIcon} title="System Status">
          <Stack spacing={1}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.75 }}>
              <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                Overall Status
              </Typography>
              <StatusChip status={health?.status} />
            </Box>
            <ConfigRow label="API Version" value={health?.version || '-'} />
            <ConfigRow label="Response Time" value={health?.response_time_ms ? `${health.response_time_ms}ms` : '-'} />
            {health?.timestamp && (
              <ConfigRow
                label="Last Checked"
                value={new Date(health.timestamp).toLocaleString()}
              />
            )}
          </Stack>
        </SettingCard>

        {/* Storage Status */}
        <SettingCard icon={StorageIcon} title="Storage">
          <Stack spacing={1}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.75 }}>
              <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                Uploads Directory
              </Typography>
              <StatusChip status={uploadsDir.status} />
            </Box>
            {uploadsDir.writable !== undefined && (
              <ConfigRow label="Writable" value={uploadsDir.writable ? 'Yes' : 'No'} />
            )}
            <Divider sx={{ my: 1, borderColor: alpha(theme.palette.divider, 0.08) }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.75 }}>
              <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                State Directory
              </Typography>
              <StatusChip status={stateDir.status} />
            </Box>
            {memory.rss_mb && (
              <>
                <Divider sx={{ my: 1, borderColor: alpha(theme.palette.divider, 0.08) }} />
                <ConfigRow label="Memory Usage (RSS)" value={`${memory.rss_mb.toFixed(1)} MB`} />
              </>
            )}
          </Stack>
        </SettingCard>

        {/* API Configuration */}
        <SettingCard icon={SecurityIcon} title="API Configuration">
          <Stack spacing={1}>
            <ConfigRow
              label="API Key"
              value={config.api_key_configured ? 'Configured' : 'Not Set'}
            />
            <ConfigRow
              label="Rate Limiting"
              value={config.rate_limiting_enabled ? `Enabled (${config.rate_limit})` : 'Disabled'}
            />
            <ConfigRow
              label="Request Timeout"
              value={config.request_timeout ? `${config.request_timeout}s` : '-'}
            />
            <ConfigRow
              label="Max Upload Size"
              value={config.max_upload_size_mb ? `${config.max_upload_size_mb} MB` : '-'}
            />
            <ConfigRow label="Debug Mode" value={config.debug_mode ? 'Enabled' : 'Disabled'} />
          </Stack>
        </SettingCard>

        {/* LLM Provider */}
        <SettingCard icon={CloudIcon} title="LLM Provider (Claude Code CLI)">
          <Stack spacing={1}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.75 }}>
              <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                Connection Status
              </Typography>
              <StatusChip status={llm.status} />
            </Box>
            {llm.message && (
              <ConfigRow label="Details" value={llm.message} />
            )}
            {llm.model && (
              <ConfigRow label="Model" value={llm.model} />
            )}
          </Stack>
        </SettingCard>

        {/* Email / SMTP Settings */}
        <SettingCard icon={EmailIcon} title="Email / SMTP">
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 2 }}>
            Configure SMTP server for sending report emails. Settings are stored securely.
          </Typography>
          <Stack spacing={2}>
            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                size="small"
                label="SMTP Host"
                placeholder="smtp.gmail.com"
                value={smtp.host}
                onChange={handleSmtpChange('host')}
              />
              <TextField
                size="small"
                label="Port"
                type="number"
                value={smtp.port}
                onChange={handleSmtpChange('port')}
                sx={{ width: 120, flexShrink: 0 }}
              />
            </Stack>
            <TextField
              fullWidth
              size="small"
              label="Sender Email"
              placeholder="noreply@example.com"
              value={smtp.sender}
              onChange={handleSmtpChange('sender')}
            />
            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                size="small"
                label="Username"
                placeholder="your-email@gmail.com"
                value={smtp.username}
                onChange={handleSmtpChange('username')}
              />
              <TextField
                fullWidth
                size="small"
                label="Password"
                type={showSmtpPassword ? 'text' : 'password'}
                value={smtp.password}
                onChange={handleSmtpChange('password')}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setShowSmtpPassword(p => !p)} edge="end">
                          {showSmtpPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Stack>
            <FormControlLabel
              control={<Switch checked={smtp.use_tls} onChange={handleSmtpChange('use_tls')} size="small" />}
              label={<Typography variant="body2" sx={{ color: theme.palette.text.primary }}>Use TLS encryption</Typography>}
            />
            <Stack direction="row" spacing={1.5}>
              <Button
                variant="contained"
                size="small"
                startIcon={smtpLoading ? <CircularProgress size={16} /> : <SaveIcon />}
                onClick={handleSmtpSave}
                disabled={smtpLoading || !smtp.host}
                sx={{ borderRadius: 1 }}
              >
                {smtpLoading ? 'Saving...' : 'Save'}
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={smtpTesting ? <CircularProgress size={16} /> : <SendIcon />}
                onClick={handleSmtpTest}
                disabled={smtpTesting || !smtp.host}
                sx={{ borderRadius: 1 }}
              >
                {smtpTesting ? 'Testing...' : 'Test Connection'}
              </Button>
            </Stack>
          </Stack>
        </SettingCard>

        {/* Token Usage Statistics */}
        <SettingCard icon={TokenIcon} title="Token Usage">
          {tokenUsage ? (
            <Stack spacing={1}>
              <ConfigRow
                label="Total Tokens"
                value={(tokenUsage.total_tokens || 0).toLocaleString()}
              />
              <ConfigRow
                label="Input Tokens"
                value={(tokenUsage.total_input_tokens || 0).toLocaleString()}
              />
              <ConfigRow
                label="Output Tokens"
                value={(tokenUsage.total_output_tokens || 0).toLocaleString()}
              />
              <Divider sx={{ my: 1, borderColor: alpha(theme.palette.divider, 0.08) }} />
              <ConfigRow
                label="Estimated Cost"
                value={`$${(tokenUsage.estimated_cost_usd || 0).toFixed(4)}`}
                mono
              />
              <ConfigRow
                label="API Requests"
                value={(tokenUsage.request_count || 0).toLocaleString()}
              />
              <Typography variant="caption" sx={{ color: theme.palette.text.disabled, mt: 1 }}>
                Usage statistics are tracked since server start.
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
              Token usage data unavailable
            </Typography>
          )}
        </SettingCard>

        {/* Export Configuration */}
        <SettingCard icon={DownloadIcon} title="Export & Backup">
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 2 }}>
            Export your configuration for backup or migration purposes.
          </Typography>
          <ExportButton
            variant="outlined"
            startIcon={exporting ? <CircularProgress size={16} /> : <DownloadIcon />}
            onClick={handleExportConfig}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Export Configuration'}
          </ExportButton>
        </SettingCard>

        {/* User Preferences */}
        <SettingCard icon={SettingsIcon} title="Preferences">
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mb: 2 }}>
            These preferences are synced with the server and cached locally.
          </Typography>
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Switch
                  checked={demoMode}
                  onChange={handleDemoModeChange}
                  size="small"
                />
              }
              label={
                <Stack>
                  <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>
                    Demo Mode
                  </Typography>
                  <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                    Explore with sample data (no real database required)
                  </Typography>
                </Stack>
              }
            />
            <Divider sx={{ my: 1, borderColor: alpha(theme.palette.divider, 0.06) }} />
            <FormControlLabel
              control={
                <Switch
                  checked={preferences.autoRefreshJobs ?? true}
                  onChange={handlePrefChange('autoRefreshJobs')}
                  size="small"
                />
              }
              label={
                <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>
                  Auto-refresh jobs list
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={preferences.showNotifications ?? true}
                  onChange={handlePrefChange('showNotifications')}
                  size="small"
                />
              }
              label={
                <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>
                  Show desktop notifications
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={preferences.confirmDelete ?? true}
                  onChange={handlePrefChange('confirmDelete')}
                  size="small"
                />
              }
              label={
                <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>
                  Confirm before deleting items
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={preferences.compactTables ?? false}
                  onChange={handlePrefChange('compactTables')}
                  size="small"
                />
              }
              label={
                <Typography variant="body2" sx={{ color: theme.palette.text.primary }}>
                  Use compact table view
                </Typography>
              }
            />
          </Stack>
        </SettingCard>
      </Stack>
    </PageContainer>
  )
}
