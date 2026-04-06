import * as api from '@/api/client'
import { neutral, palette } from '@/app/theme'
import { useToast } from '@/components/core'
import { DataTable } from '@/components/data'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { ConfirmModal } from '@/components/modals'
import { useAppStore } from '@/stores/app'
import { StyledFormControl, fadeInUp } from '@/styles/styles'
import {
  AccessTime as TimeIcon,
  Add as AddIcon,
  CalendarMonth as CalendarIcon,
  CheckCircle as CheckCircleIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Email as EmailIcon,
  Info as InfoIcon,
  MoreVert as MoreVertIcon,
  Pause as PauseIcon,
  PlayArrow as PlayArrowIcon,
  Schedule as ScheduleIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fade,
  FormControlLabel,
  IconButton,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  Zoom,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
const PageContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  animation: `${fadeInUp} 0.4s ease-out`,
}))

const StyledDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    borderRadius: 8,  // Figma spec: 8px
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    boxShadow: `0 24px 48px ${alpha(theme.palette.common.black, 0.2)}`,
  },
  '& .MuiBackdrop-root': {
    backgroundColor: alpha(theme.palette.common.black, 0.5),
    backdropFilter: 'blur(4px)',
  },
}))

const DialogHeader = styled(DialogTitle)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  padding: theme.spacing(3),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const DialogIconContainer = styled(Box)(({ theme }) => ({
  width: 48,
  height: 48,
  borderRadius: 14,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  '& svg': {
    fontSize: 24,
    color: theme.palette.text.secondary,
  },
}))

const StyledDialogContent = styled(DialogContent)(({ theme }) => ({
  padding: theme.spacing(3),
}))

const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
  padding: theme.spacing(2, 3),
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.3),
  gap: theme.spacing(1),
}))

const SectionLabel = styled(Typography)(({ theme }) => ({
  fontSize: '0.75rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: theme.palette.text.disabled,
  marginBottom: theme.spacing(2),
  marginTop: theme.spacing(3),
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  '&:first-of-type': {
    marginTop: 0,
  },
}))

const StyledTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: 12,
    transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.3) : neutral[300],
    },
    '&.Mui-focused': {
      '& .MuiOutlinedInput-notchedOutline': {
        borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
        borderWidth: 2,
      },
    },
  },
}))

const StatusChip = styled(Chip, {
  shouldForwardProp: (prop) => prop !== 'active',
})(({ theme, active }) => ({
  borderRadius: 8,
  fontWeight: 500,
  fontSize: '0.75rem',
  backgroundColor: active
    ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100])
    : (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.06) : neutral[50]),
  color: theme.palette.text.secondary,
  border: `1px solid ${active
    ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.15) : neutral[200])
    : alpha(theme.palette.divider, 0.2)}`,
}))

const FrequencyChip = styled(Chip)(({ theme }) => ({
  borderRadius: 8,
  fontWeight: 500,
  fontSize: '0.75rem',
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  color: theme.palette.text.secondary,
  border: `1px solid ${theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[200]}`,
}))

const StyledSwitch = styled(Switch)(({ theme }) => ({
  '& .MuiSwitch-switchBase.Mui-checked': {
    color: theme.palette.mode === 'dark' ? neutral[400] : neutral[400],
    '& + .MuiSwitch-track': {
      backgroundColor: theme.palette.mode === 'dark' ? neutral[400] : neutral[400],
    },
  },
}))

const StyledMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    borderRadius: 12,
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.15)}`,
    minWidth: 180,
  },
}))

const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
  borderRadius: 8,
  margin: theme.spacing(0.5, 1),
  padding: theme.spacing(1, 1.5),
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[50],
  },
}))

const SchedulerStatusBanner = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'status',
})(({ theme, status }) => {
  const neutralColor = theme.palette.mode === 'dark' ? neutral[500] : neutral[700]
  const neutralBg = theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100]
  const colors = {
    ok: { bg: neutralBg, border: neutralColor, text: neutralColor },
    warning: { bg: neutralBg, border: neutralColor, text: neutralColor },
    disabled: { bg: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.06) : neutral[50], border: alpha(theme.palette.divider, 0.3), text: theme.palette.text.secondary },
    error: { bg: neutralBg, border: neutralColor, text: neutralColor },
  }
  const colorScheme = colors[status] || colors.warning
  return {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5, 2),
    marginBottom: theme.spacing(2),
    borderRadius: 8,
    backgroundColor: colorScheme.bg,
    border: `1px solid ${colorScheme.border}`,
    color: colorScheme.text,
  }
})

const ActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 10,
  textTransform: 'none',
  fontWeight: 500,
  padding: theme.spacing(1, 2.5),
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
}))

const PrimaryButton = styled(ActionButton)(({ theme }) => ({
  background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  color: theme.palette.common.white,
  boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
  '&:hover': {
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
    transform: 'translateY(-1px)',
  },
  '&:disabled': {
    background: alpha(theme.palette.text.primary, 0.1),
    color: alpha(theme.palette.text.primary, 0.4),
    boxShadow: 'none',
  },
}))


const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const FREQUENCY_INTERVALS = {
  daily: 1440,
  weekly: 10080,
  monthly: 43200,
}


const extractDateOnly = (value) => {
  if (!value) return ''
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

const buildDateTime = (dateValue, endOfDay = false) => {
  if (!dateValue) return ''
  const time = endOfDay ? '23:59:59' : '00:00:00'
  return `${dateValue} ${time}`
}

const parseEmailList = (raw) => {
  if (!raw) return []
  return raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

const formatEmailList = (list) => {
  if (!Array.isArray(list)) return ''
  return list.filter(Boolean).join(', ')
}

const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Convert a local "HH:MM" time string to UTC "HH:MM".
 * E.g. "16:12" IST (UTC+5:30) → "10:42" UTC
 */
const localTimeToUtc = (hhmm) => {
  if (!hhmm || !hhmm.includes(':')) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  // Create a Date object for today at the given local time
  const d = new Date()
  d.setHours(h, m, 0, 0)
  const utcH = String(d.getUTCHours()).padStart(2, '0')
  const utcM = String(d.getUTCMinutes()).padStart(2, '0')
  return `${utcH}:${utcM}`
}

/**
 * Convert a UTC "HH:MM" time string to local "HH:MM".
 * E.g. "10:42" UTC → "16:12" IST (UTC+5:30)
 */
const utcTimeToLocal = (hhmm) => {
  if (!hhmm || !hhmm.includes(':')) return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  // Create a Date object for today with the given UTC time
  const d = new Date()
  d.setUTCHours(h, m, 0, 0)
  const localH = String(d.getHours()).padStart(2, '0')
  const localM = String(d.getMinutes()).padStart(2, '0')
  return `${localH}:${localM}`
}

const isSchedulableTemplate = (template) => {
  if (!template || typeof template !== 'object') return false
  const status = String(template.status || '').toLowerCase()
  return status === 'approved' || status === 'active'
}


function ScheduleDialog({
  open,
  onClose,
  schedule,
  templates,
  connections,
  defaultTemplateId,
  defaultConnectionId,
  onSave,
  onError,
}) {
  const theme = useTheme()
  const [form, setForm] = useState({
    name: '',
    templateId: '',
    connectionId: '',
    startDate: '',
    endDate: '',
    frequency: 'daily',
    runTime: '',
    emailRecipients: '',
    emailSubject: '',
    emailMessage: '',
    active: true,
  })
  const [saving, setSaving] = useState(false)
  const editing = Boolean(schedule)

  useEffect(() => {
    if (schedule) {
      setForm({
        name: schedule.name || '',
        templateId: schedule.template_id || '',
        connectionId: schedule.connection_id || '',
        startDate: extractDateOnly(schedule.start_date),
        endDate: extractDateOnly(schedule.end_date),
        frequency: schedule.frequency || 'daily',
        runTime: utcTimeToLocal(schedule.run_time) || '',
        emailRecipients: formatEmailList(schedule.email_recipients),
        emailSubject: schedule.email_subject || '',
        emailMessage: schedule.email_message || '',
        active: schedule.active !== false,
      })
      return
    }
    const fallbackTemplate = defaultTemplateId || templates[0]?.id || ''
    const fallbackConnection = defaultConnectionId || connections[0]?.id || ''
    setForm({
      name: '',
      templateId: fallbackTemplate,
      connectionId: fallbackConnection,
      startDate: '',
      endDate: '',
      frequency: 'daily',
      runTime: '',
      emailRecipients: '',
      emailSubject: '',
      emailMessage: '',
      active: true,
    })
  }, [schedule, templates, connections, open, defaultTemplateId, defaultConnectionId])

  const handleChange = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async () => {
    const intervalMinutes = FREQUENCY_INTERVALS[form.frequency] || FREQUENCY_INTERVALS.daily
    const emailRecipients = parseEmailList(form.emailRecipients)
    const startDate = buildDateTime(form.startDate)
    const endDate = buildDateTime(form.endDate, true)
    const templateAllowed = templates.some((tpl) => tpl.id === form.templateId)
    const connectionAvailable = connections.some((conn) => conn.id === form.connectionId)

    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      onError?.('End date must be on or after start date')
      return
    }

    if (!templateAllowed) {
      onError?.('Selected template is not approved for scheduling. Choose an approved template.')
      return
    }

    if (!connectionAvailable) {
      onError?.('Selected connection is no longer available. Choose another connection.')
      return
    }

    if (emailRecipients.length > 0) {
      const invalidEmail = emailRecipients.find((email) => !isValidEmail(email))
      if (invalidEmail) {
        onError?.(`Invalid email address: ${invalidEmail}`)
        return
      }
    }

    setSaving(true)
    try {
      await onSave({
        name: form.name,
        templateId: form.templateId,
        connectionId: form.connectionId,
        startDate,
        endDate,
        frequency: form.frequency,
        intervalMinutes,
        runTime: form.runTime ? localTimeToUtc(form.runTime) : undefined,
        emailRecipients: emailRecipients.length ? emailRecipients : undefined,
        emailSubject: form.emailSubject || undefined,
        emailMessage: form.emailMessage || undefined,
        active: form.active,
      })
      onClose()
    } catch {
      // Keep dialog open on save failure; the interaction layer already
      // reports the error message to the user.
    } finally {
      setSaving(false)
    }
  }

  const disableSave =
    saving || !form.name || !form.templateId || !form.connectionId || !form.startDate || !form.endDate

  return (
    <StyledDialog open={open} onClose={onClose} maxWidth="sm" fullWidth TransitionComponent={Fade}>
      <DialogHeader>
        <DialogIconContainer>
          <ScheduleIcon />
        </DialogIconContainer>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {editing ? 'Edit Schedule' : 'Create Schedule'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {editing ? 'Update the schedule configuration' : 'Set up automated report generation'}
          </Typography>
        </Box>
      </DialogHeader>

      <StyledDialogContent>
        <SectionLabel>
          <ScheduleIcon sx={{ fontSize: 16 }} />
          Basic Information
        </SectionLabel>
        <Stack spacing={2.5}>
          <StyledTextField
            label="Schedule Name"
            value={form.name}
            onChange={handleChange('name')}
            fullWidth
            required
            placeholder="e.g., Weekly Sales Report"
          />

          <StyledFormControl fullWidth required>
            <InputLabel>Template</InputLabel>
            <Select value={form.templateId} onChange={handleChange('templateId')} label="Template" disabled={editing}>
              {templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name || t.id}
                </MenuItem>
              ))}
            </Select>
          </StyledFormControl>

          <StyledFormControl fullWidth required>
            <InputLabel>Connection</InputLabel>
            <Select
              value={form.connectionId}
              onChange={handleChange('connectionId')}
              label="Connection"
              disabled={editing}
            >
              {connections.map((conn) => (
                <MenuItem key={conn.id} value={conn.id}>
                  {conn.name || conn.id}
                </MenuItem>
              ))}
            </Select>
          </StyledFormControl>
        </Stack>

        <SectionLabel>
          <CalendarIcon sx={{ fontSize: 16 }} />
          Schedule Timing
        </SectionLabel>
        <Stack spacing={2.5}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <StyledTextField
              label="Start Date"
              type="date"
              value={form.startDate}
              onChange={handleChange('startDate')}
              InputLabelProps={{ shrink: true }}
              fullWidth
              required
            />
            <StyledTextField
              label="End Date"
              type="date"
              value={form.endDate}
              onChange={handleChange('endDate')}
              InputLabelProps={{ shrink: true }}
              fullWidth
              required
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <StyledFormControl fullWidth>
              <InputLabel>Frequency</InputLabel>
              <Select value={form.frequency} onChange={handleChange('frequency')} label="Frequency">
                {FREQUENCY_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </StyledFormControl>
            <StyledTextField
              label="Run At"
              type="time"
              value={form.runTime}
              onChange={handleChange('runTime')}
              InputLabelProps={{ shrink: true }}
              fullWidth
              helperText="Time of day in your local time (leave blank for interval-based)"
            />
          </Stack>
        </Stack>

        <SectionLabel>
          <EmailIcon sx={{ fontSize: 16 }} />
          Email Notifications (Optional)
        </SectionLabel>
        <Stack spacing={2.5}>
          <StyledTextField
            label="Email recipients"
            value={form.emailRecipients}
            onChange={handleChange('emailRecipients')}
            placeholder="ops@example.com, finance@example.com"
            helperText="Comma or semicolon separated list"
            fullWidth
          />
          <StyledTextField
            label="Email subject"
            value={form.emailSubject}
            onChange={handleChange('emailSubject')}
            fullWidth
          />
          <StyledTextField
            label="Email message"
            value={form.emailMessage}
            onChange={handleChange('emailMessage')}
            multiline
            minRows={2}
            fullWidth
          />
        </Stack>

        <Box sx={{ mt: 3 }}>
          <FormControlLabel
            control={<StyledSwitch checked={form.active} onChange={handleChange('active')} />}
            label={
              <Box>
                <Typography variant="body2" fontWeight={500}>
                  Active
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Enable this schedule to run automatically
                </Typography>
              </Box>
            }
          />
        </Box>
      </StyledDialogContent>

      <StyledDialogActions>
        <ActionButton onClick={onClose}>Cancel</ActionButton>
        <PrimaryButton onClick={handleSubmit} disabled={disableSave}>
          {saving ? 'Saving...' : editing ? 'Update Schedule' : 'Create Schedule'}
        </PrimaryButton>
      </StyledDialogActions>
    </StyledDialog>
  )
}


export default function SchedulesPage() {
  const theme = useTheme()
  const toast = useToast()
  // UX Governance: Enforced interaction API - ALL user actions flow through this
  const { execute } = useInteraction()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const templates = useAppStore((s) => s.templates)
  const savedConnections = useAppStore((s) => s.savedConnections)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)

  const [schedules, setSchedules] = useState([])
  const [schedulableTemplates, setSchedulableTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingSchedule, setDeletingSchedule] = useState(null)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuSchedule, setMenuSchedule] = useState(null)
  const [togglingId, setTogglingId] = useState(null)
  const [schedulerStatus, setSchedulerStatus] = useState(null)
  const scheduleDeleteUndoRef = useRef(null)
  const didLoadSchedulesRef = useRef(false)
  const didLoadTemplatesRef = useRef(false)
  const templatesFromStore = useMemo(
    () => (Array.isArray(templates) ? templates.filter(isSchedulableTemplate) : []),
    [templates]
  )

  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    try {
      const schedulesData = await api.listSchedules()
      setSchedules(schedulesData || [])
    } catch (err) {
      toast.show(err.message || 'Failed to load schedules', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const fetchSchedulerStatus = useCallback(async () => {
    try {
      const status = await api.getSchedulerStatus()
      setSchedulerStatus(status)
    } catch (err) {
      // Silently fail - scheduler status is optional
      console.warn('Failed to fetch scheduler status:', err)
    }
  }, [])

  useEffect(() => {
    if (didLoadSchedulesRef.current) return
    didLoadSchedulesRef.current = true
    fetchSchedules()
    fetchSchedulerStatus()
  }, [fetchSchedules, fetchSchedulerStatus])

  const fetchTemplates = useCallback(async () => {
    try {
      const templatesData = await api.listApprovedTemplates()
      if (Array.isArray(templatesData) && templatesData.length > 0) {
        setSchedulableTemplates(templatesData)
        return
      }
      setSchedulableTemplates(templatesFromStore)
    } catch (err) {
      setSchedulableTemplates(templatesFromStore)
      toast.show(err.userMessage || err.message || 'Failed to load templates', 'error')
    }
  }, [templatesFromStore, toast])

  useEffect(() => {
    if (didLoadTemplatesRef.current) return
    didLoadTemplatesRef.current = true
    fetchTemplates()
  }, [fetchTemplates])

  useEffect(() => {
    if (schedulableTemplates.length > 0) return
    if (templatesFromStore.length > 0) {
      setSchedulableTemplates(templatesFromStore)
    }
  }, [schedulableTemplates.length, templatesFromStore])

  const templateParam = searchParams.get('template')
  const schedulableTemplateIds = useMemo(
    () => new Set(schedulableTemplates.map((template) => template.id)),
    [schedulableTemplates]
  )
  const defaultTemplateId = templateParam && schedulableTemplateIds.has(templateParam)
    ? templateParam
    : (schedulableTemplates[0]?.id || '')
  const defaultConnectionId = activeConnectionId || savedConnections[0]?.id || ''
  const canCreateSchedule = schedulableTemplates.length > 0 && savedConnections.length > 0

  useEffect(() => {
    if (!templateParam) return
    if (schedulableTemplates.length > 0 && !schedulableTemplateIds.has(templateParam)) {
      toast.show('Selected template is not approved for scheduling. Choose an approved template.', 'warning')
    }
    setEditingSchedule(null)
    setDialogOpen(true)
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('template')
    setSearchParams(nextParams, { replace: true })
  }, [templateParam, searchParams, schedulableTemplates, schedulableTemplateIds, setSearchParams, toast])

  const handleOpenMenu = useCallback((event, schedule) => {
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
    setMenuSchedule(schedule)
  }, [])

  const handleCloseMenu = useCallback(() => {
    setMenuAnchor(null)
    setMenuSchedule(null)
  }, [])

  const handleAddSchedule = useCallback(() => {
    if (schedulableTemplates.length === 0) {
      toast.show('No approved templates available. Approve a template first.', 'warning')
      return
    }
    if (savedConnections.length === 0) {
      toast.show('No connections available. Add a connection first.', 'warning')
      return
    }
    setEditingSchedule(null)
    setDialogOpen(true)
  }, [schedulableTemplates.length, savedConnections.length, toast])

  const handleEditSchedule = useCallback(() => {
    setEditingSchedule(menuSchedule)
    setDialogOpen(true)
    handleCloseMenu()
  }, [menuSchedule, handleCloseMenu])

  const handleDeleteClick = useCallback(() => {
    setDeletingSchedule(menuSchedule)
    setDeleteConfirmOpen(true)
    handleCloseMenu()
  }, [menuSchedule, handleCloseMenu])

  const handleToggleSchedule = useCallback(
    async (schedule, nextActive) => {
      if (!schedule) return

      // UX Governance: Update action with tracking
      execute({
        type: InteractionType.UPDATE,
        label: `${nextActive ? 'Enable' : 'Pause'} schedule "${schedule.name || schedule.id}"`,
        reversibility: Reversibility.FULLY_REVERSIBLE,
        successMessage: `Schedule ${nextActive ? 'enabled' : 'paused'}`,
        errorMessage: 'Failed to update schedule',
        action: async () => {
          setTogglingId(schedule.id)
          try {
            await api.updateSchedule(schedule.id, { active: nextActive })
            await fetchSchedules()
          } finally {
            setTogglingId(null)
          }
        },
      })
    },
    [fetchSchedules, execute]
  )

  const handleToggleEnabled = useCallback(async () => {
    if (!menuSchedule) return
    const currentActive = menuSchedule.active ?? menuSchedule.enabled ?? true
    const nextActive = !currentActive
    await handleToggleSchedule(menuSchedule, nextActive)
    handleCloseMenu()
  }, [menuSchedule, handleCloseMenu, handleToggleSchedule])

  const handleRunNow = useCallback(async () => {
    if (!menuSchedule) return
    handleCloseMenu()
    try {
      const result = await api.triggerSchedule(menuSchedule.id)
      if (result?.status === 'triggered') {
        toast.show(`Schedule "${menuSchedule.name}" triggered`, 'success')
        navigate('/jobs')
      } else {
        toast.show('Schedule triggered', 'success')
      }
    } catch (err) {
      toast.show(err?.response?.data?.detail?.message || 'Failed to trigger schedule', 'error')
    }
  }, [menuSchedule, handleCloseMenu, toast, navigate])

  const handleSaveSchedule = useCallback(
    async (data) => {
      const isEditing = !!editingSchedule

      // UX Governance: Create/Update action with tracking
      const result = await execute({
        type: isEditing ? InteractionType.UPDATE : InteractionType.CREATE,
        label: isEditing ? `Update schedule "${data.name}"` : `Create schedule "${data.name}"`,
        reversibility: Reversibility.FULLY_REVERSIBLE,
        successMessage: isEditing ? 'Schedule updated' : 'Schedule created',
        errorMessage: 'Failed to save schedule',
        action: async () => {
          if (isEditing) {
            await api.updateSchedule(editingSchedule.id, data)
          } else {
            await api.createSchedule(data)
          }
          await fetchSchedules()
        },
      })

      if (!result?.success) {
        throw result?.error || new Error('Failed to save schedule')
      }
    },
    [editingSchedule, fetchSchedules, execute]
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingSchedule) return
    const scheduleToDelete = deletingSchedule
    const scheduleIndex = schedules.findIndex((item) => item.id === scheduleToDelete.id)

    setDeleteConfirmOpen(false)
    setDeletingSchedule(null)

    if (scheduleDeleteUndoRef.current?.timeoutId) {
      clearTimeout(scheduleDeleteUndoRef.current.timeoutId)
      scheduleDeleteUndoRef.current = null
    }

    // UX Governance: Delete action with tracking
    execute({
      type: InteractionType.DELETE,
      label: `Delete schedule "${scheduleToDelete.name || scheduleToDelete.id}"`,
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      successMessage: 'Schedule removed',
      errorMessage: 'Failed to delete schedule',
      action: async () => {
        setSchedules((prev) => prev.filter((item) => item.id !== scheduleToDelete.id))

        let undone = false
        const timeoutId = setTimeout(async () => {
          if (undone) return
          try {
            await api.deleteSchedule(scheduleToDelete.id)
            fetchSchedules()
          } catch (err) {
            setSchedules((prev) => {
              if (prev.some((item) => item.id === scheduleToDelete.id)) return prev
              const next = [...prev]
              if (scheduleIndex >= 0 && scheduleIndex <= next.length) {
                next.splice(scheduleIndex, 0, scheduleToDelete)
              } else {
                next.push(scheduleToDelete)
              }
              return next
            })
            throw err
          } finally {
            scheduleDeleteUndoRef.current = null
          }
        }, 5000)

        scheduleDeleteUndoRef.current = { timeoutId, schedule: scheduleToDelete }

        toast.showWithUndo(
          `Schedule "${scheduleToDelete.name || scheduleToDelete.id}" removed`,
          () => {
            undone = true
            clearTimeout(timeoutId)
            scheduleDeleteUndoRef.current = null
            setSchedules((prev) => {
              if (prev.some((item) => item.id === scheduleToDelete.id)) return prev
              const next = [...prev]
              if (scheduleIndex >= 0 && scheduleIndex <= next.length) {
                next.splice(scheduleIndex, 0, scheduleToDelete)
              } else {
                next.push(scheduleToDelete)
              }
              return next
            })
            toast.show('Schedule restored', 'success')
          },
          { severity: 'info' }
        )
      },
    })
  }, [deletingSchedule, schedules, fetchSchedules, execute, toast])

  const columns = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Schedule',
        renderCell: (value, row) => (
          <Box>
            <Typography variant="body2" fontWeight={600}>
              {value || row.id}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {templates.find((t) => t.id === row.template_id)?.name || row.template_name || row.template_id}
            </Typography>
          </Box>
        ),
      },
      {
        field: 'frequency',
        headerName: 'Frequency',
        width: 120,
        renderCell: (value) => {
          const option = FREQUENCY_OPTIONS.find((opt) => opt.value === value)
          const label = option?.label || value || 'daily'
          return <FrequencyChip label={label} size="small" />
        },
      },
      {
        field: 'enabled',
        headerName: 'Status',
        width: 140,
        renderCell: (value, row) => {
          const active = row.active ?? value ?? true
          return (
            <Stack direction="row" alignItems="center" spacing={1}>
              <StyledSwitch
                size="small"
                checked={active}
                disabled={togglingId === row.id}
                onChange={(e) => {
                  e.stopPropagation()
                  handleToggleSchedule(row, e.target.checked)
                }}
              />
              <StatusChip label={active ? 'Active' : 'Paused'} size="small" active={active} />
            </Stack>
          )
        },
      },
      {
        field: 'last_run',
        headerName: 'Last Run',
        width: 180,
        renderCell: (value, row) => {
          const lastRun = value || row.last_run_at
          return (
            <Typography variant="body2" color={lastRun ? 'text.primary' : 'text.secondary'}>
              {lastRun ? new Date(lastRun).toLocaleString(undefined, { timeZoneName: 'short' }) : 'Never'}
            </Typography>
          )
        },
      },
      {
        field: 'next_run',
        headerName: 'Next Run',
        width: 220,
        renderCell: (value, row) => {
          const active = row.active ?? row.enabled ?? true
          const nextRun = value || row.next_run_at
          return (
            <Typography variant="body2" color={active && nextRun ? 'text.primary' : 'text.secondary'}>
              {active && nextRun ? new Date(nextRun).toLocaleString(undefined, { timeZoneName: 'short' }) : '-'}
            </Typography>
          )
        },
      },
    ],
    [templates, handleToggleSchedule, togglingId]
  )

  const filters = useMemo(
    () => [
      {
        key: 'frequency',
        label: 'Frequency',
        options: FREQUENCY_OPTIONS,
      },
      {
        key: 'active',
        label: 'Status',
        options: [
          { value: true, label: 'Active' },
          { value: false, label: 'Paused' },
        ],
      },
    ],
    []
  )

  const menuScheduleActive = menuSchedule?.active ?? menuSchedule?.enabled ?? true

  const renderSchedulerStatusBanner = () => {
    if (!schedulerStatus) return null

    const { scheduler, schedules: schedInfo } = schedulerStatus
    const isRunning = scheduler?.running
    const isEnabled = scheduler?.enabled

    let statusIcon = <InfoIcon />
    let statusText = ''
    let bannerStatus = 'warning'

    if (!isEnabled) {
      statusIcon = <WarningIcon />
      statusText = 'Scheduler is disabled. Schedules will not run automatically.'
      bannerStatus = 'disabled'
    } else if (!isRunning) {
      statusIcon = <WarningIcon />
      statusText = 'Scheduler is not running. Restart the server to enable automatic scheduling.'
      bannerStatus = 'warning'
    } else {
      statusIcon = <CheckCircleIcon />
      bannerStatus = 'ok'
      if (schedInfo?.next_run) {
        const nextRunTime = new Date(schedInfo.next_run.next_run_at).toLocaleString()
        statusText = `Scheduler running. Next: "${schedInfo.next_run.schedule_name}" at ${nextRunTime}`
      } else {
        statusText = `Scheduler running (polling every ${scheduler?.poll_interval_seconds || 60}s). ${schedInfo?.active || 0} active schedule(s).`
      }
    }

    return (
      <SchedulerStatusBanner status={bannerStatus}>
        {statusIcon}
        <Typography variant="body2" fontWeight={500}>
          {statusText}
        </Typography>
      </SchedulerStatusBanner>
    )
  }

  return (
    <PageContainer>
      <Container maxWidth="xl">
        {renderSchedulerStatusBanner()}
        <Alert severity="info" sx={{ mb: 2, borderRadius: 1 }}>
          Schedules create future report runs. Progress appears in Jobs and finished reports show up in History.
        </Alert>
        <DataTable
          title="Scheduled Reports"
          subtitle="Automate report generation on a schedule"
          columns={columns}
          data={schedules}
          loading={loading}
          searchPlaceholder="Search schedules..."
          filters={filters}
          actions={[
            {
              label: 'Create Schedule',
              icon: <AddIcon />,
              variant: 'contained',
              onClick: handleAddSchedule,
              disabled: !canCreateSchedule,
            },
          ]}
          rowActions={(row) => (
            <Tooltip title="More actions" arrow TransitionComponent={Zoom}>
              <IconButton size="small" onClick={(e) => handleOpenMenu(e, row)} aria-label="More actions">
                <MoreVertIcon />
              </IconButton>
            </Tooltip>
          )}
          emptyState={{
            icon: ScheduleIcon,
            title: 'No schedules yet',
            description: 'Create a schedule to automatically generate reports on a recurring basis.',
            actionLabel: 'Create Schedule',
            onAction: handleAddSchedule,
          }}
        />

        <StyledMenu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleCloseMenu} TransitionComponent={Fade}>
          <StyledMenuItem onClick={handleRunNow}>
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" sx={{ color: 'primary.main' }} />
            </ListItemIcon>
            <ListItemText>Run Now</ListItemText>
          </StyledMenuItem>
          <StyledMenuItem onClick={handleEditSchedule}>
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Edit</ListItemText>
          </StyledMenuItem>
          <StyledMenuItem onClick={handleToggleEnabled}>
            <ListItemIcon>
              {menuScheduleActive ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
            </ListItemIcon>
            <ListItemText>{menuScheduleActive ? 'Pause' : 'Enable'}</ListItemText>
          </StyledMenuItem>
          <StyledMenuItem onClick={handleDeleteClick} sx={{ color: 'error.main' }}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </StyledMenuItem>
        </StyledMenu>

        <ScheduleDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          schedule={editingSchedule}
          templates={schedulableTemplates}
          connections={savedConnections}
          defaultTemplateId={defaultTemplateId}
          defaultConnectionId={defaultConnectionId}
          onSave={handleSaveSchedule}
          onError={(msg) => toast.show(msg, 'error')}
        />

        <ConfirmModal
          open={deleteConfirmOpen}
          onClose={() => setDeleteConfirmOpen(false)}
          onConfirm={handleDeleteConfirm}
          title="Delete Schedule"
          message={`Remove "${deletingSchedule?.name || deletingSchedule?.id}"? You can undo within a few seconds. This stops future runs; past downloads remain in History.`}
          confirmLabel="Delete"
          severity="error"
        />
      </Container>
    </PageContainer>
  )
}
