import * as api from '@/api/client'
import { neutral, palette, secondary } from '@/app/theme'
import { useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { Drawer } from '@/components/modals'
import { ReportGlossaryNotice } from '@/components/ux'
import { ConnectionForm } from '@/features/Connections'
import { WizardLayout } from '@/Navigation'
import { useAppStore } from '@/stores/app'
import AddIcon from '@mui/icons-material/Add'
import AssessmentIcon from '@mui/icons-material/Assessment'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloudIcon from '@mui/icons-material/Cloud'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DescriptionIcon from '@mui/icons-material/Description'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import ScienceIcon from '@mui/icons-material/Science'
import StorageIcon from '@mui/icons-material/Storage'
import SummarizeIcon from '@mui/icons-material/Summarize'
import TableChartIcon from '@mui/icons-material/TableChart'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Collapse,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Radio,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
const DEMO_CONNECTION = {
  id: 'demo-connection',
  name: 'Sample Database (Demo)',
  db_type: 'demo',
  database: 'sample_data',
  status: 'connected',
  summary: 'Pre-loaded sample data for testing',
  isDemo: true,
}

function StepConnection({ wizardState, updateWizardState, onComplete, setLoading }) {
  const toast = useToast()
  const { execute } = useInteraction()
  const savedConnections = useAppStore((s) => s.savedConnections)
  const setSavedConnections = useAppStore((s) => s.setSavedConnections)
  const addSavedConnection = useAppStore((s) => s.addSavedConnection)
  const setActiveConnectionId = useAppStore((s) => s.setActiveConnectionId)
  const activeConnection = useAppStore((s) => s.activeConnection)

  const [selectedId, setSelectedId] = useState(wizardState.connectionId || activeConnection?.id || null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const normalizedConnections = Array.isArray(savedConnections)
    ? savedConnections.filter((conn) => conn && typeof conn === 'object' && conn.id)
    : []

  useEffect(() => {
    const fetchConnections = async () => {
      try {
        const state = await api.bootstrapState()
        if (state?.connections) {
          setSavedConnections(state.connections)
        }
      } catch (err) {
        console.error('Failed to fetch connections:', err)
        toast.show('Failed to load saved connections', 'warning')
      }
    }
    if (normalizedConnections.length === 0) {
      fetchConnections()
    }
  }, [normalizedConnections.length, setSavedConnections, toast])

  const handleSelect = useCallback((connectionId) => {
    setSelectedId(connectionId)
    updateWizardState({ connectionId })
    setActiveConnectionId(connectionId)
  }, [updateWizardState, setActiveConnectionId])

  const handleAddConnection = useCallback(() => {
    setDrawerOpen(true)
  }, [])

  const handleSaveConnection = useCallback(async (connectionData) => {
    setFormLoading(true)
    try {
      await execute({
        type: InteractionType.CREATE,
        label: `Add connection "${connectionData?.name || connectionData?.db_url || 'connection'}"`,
        reversibility: Reversibility.FULLY_REVERSIBLE,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        blocksNavigation: false,
        intent: {
          connectionName: connectionData?.name,
          dbType: connectionData?.db_type,
        },
        action: async () => {
          try {
            const result = await api.testConnection(connectionData)
            if (!result.ok) {
              throw new Error(result.detail || 'Connection test failed')
            }

            const savedConnection = await api.upsertConnection({
              id: result.connection_id,
              name: connectionData.name,
              dbType: connectionData.db_type,
              dbUrl: connectionData.db_url,
              database: connectionData.database,
              status: 'connected',
              latencyMs: result.latency_ms,
            })

            addSavedConnection(savedConnection)
            handleSelect(savedConnection.id)
            toast.show('Connection added', 'success')
            setDrawerOpen(false)
            return savedConnection
          } catch (err) {
            toast.show(err.message || 'Failed to save connection', 'error')
            throw err
          }
        },
      })
    } finally {
      setFormLoading(false)
    }
  }, [addSavedConnection, handleSelect, toast, execute])

  const handleContinue = useCallback(() => {
    if (selectedId) {
      onComplete()
    }
  }, [selectedId, onComplete])

  const handleSelectDemo = useCallback(() => {
    setSelectedId(DEMO_CONNECTION.id)
    updateWizardState({ connectionId: DEMO_CONNECTION.id, isDemo: true })
    // Add demo connection to store temporarily
    if (!normalizedConnections.find(c => c.id === DEMO_CONNECTION.id)) {
      addSavedConnection(DEMO_CONNECTION)
    }
    setActiveConnectionId(DEMO_CONNECTION.id)
    toast.show('Demo mode activated! Using sample data.', 'success')
  }, [updateWizardState, normalizedConnections, addSavedConnection, setActiveConnectionId, toast])

  const handleSkipConnection = useCallback(() => {
    // Allow users to skip if they just want to explore
    updateWizardState({ connectionId: null, skippedConnection: true })
    onComplete()
  }, [updateWizardState, onComplete])

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
        Connect Your Data
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Choose where your report data comes from. You can always change this later.
      </Typography>

      {/* Quick Start Options */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="subtitle2" fontWeight={600} color="text.secondary" sx={{ mb: 2, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>
          Quick Start
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Card
            variant="outlined"
            sx={{
              flex: 1,
              border: 2,
              borderColor: selectedId === DEMO_CONNECTION.id ? (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700] : 'divider',
              bgcolor: selectedId === DEMO_CONNECTION.id ? (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50] : 'transparent',
              transition: 'all 0.2s',
              '&:hover': {
                borderColor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
              },
            }}
          >
            <CardActionArea onClick={handleSelectDemo} sx={{ height: '100%' }}>
              <CardContent sx={{ textAlign: 'center', py: 3 }}>
                <ScienceIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Try Demo Mode
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Explore with sample data — no setup needed
                </Typography>
                <Chip label="Recommended for first-time users" size="small" variant="outlined" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
              </CardContent>
            </CardActionArea>
          </Card>

          <Card
            variant="outlined"
            sx={{
              flex: 1,
              border: 2,
              borderColor: 'divider',
              transition: 'all 0.2s',
              '&:hover': {
                borderColor: 'secondary.main',
              },
            }}
          >
            <CardActionArea onClick={handleSkipConnection} sx={{ height: '100%' }}>
              <CardContent sx={{ textAlign: 'center', py: 3 }}>
                <CloudIcon sx={{ fontSize: 40, color: 'text.secondary', mb: 1 }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Skip for Now
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Set up data source later and explore templates first
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Stack>
      </Box>

      <Divider sx={{ my: 3 }}>
        <Chip label="Or connect your own data" size="small" />
      </Divider>

      {normalizedConnections.length === 0 || normalizedConnections.every((c) => c.isDemo) ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          No database connections yet. Add one below or try demo mode above.
        </Alert>
      ) : (
        <Stack spacing={2} sx={{ mb: 3 }}>
          {normalizedConnections.map((conn) => (
            <Card
              key={conn.id}
              variant="outlined"
              sx={{
                border: 2,
                borderColor: selectedId === conn.id ? (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700] : 'divider',
                transition: 'border-color 0.2s',
              }}
            >
              <CardActionArea onClick={() => handleSelect(conn.id)}>
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Radio
                    checked={selectedId === conn.id}
                    sx={{ p: 0 }}
                  />
                  <StorageIcon sx={{ color: 'text.secondary' }} />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle1" fontWeight={500}>
                      {conn.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {conn.db_type} • {conn.summary || conn.database}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      size="small"
                      label={conn.status === 'connected' ? 'Connected' : 'Disconnected'}
                      variant="outlined"
                      sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                    />
                    {selectedId === conn.id && (
                      <CheckCircleIcon sx={{ color: 'text.secondary' }} />
                    )}
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}

      <Divider sx={{ my: 3 }} />

      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={handleAddConnection}
        fullWidth
        sx={{
          py: 1.5,
          borderStyle: 'dashed',
        }}
      >
        Add New Connection
      </Button>

      {/* Connection Form Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="New Connection"
        subtitle="Configure your database connection"
        width={520}
      >
        <ConnectionForm
          onSave={handleSaveConnection}
          onCancel={() => setDrawerOpen(false)}
          loading={formLoading}
        />
      </Drawer>
    </Box>
  )
}


function StepMapping({ wizardState, updateWizardState, onComplete, setLoading }) {
  const toast = useToast()
  const { execute } = useInteraction()

  const templateId = useAppStore((s) => s.templateId) || wizardState.templateId
  const activeConnection = useAppStore((s) => s.activeConnection)
  const setLastApprovedTemplate = useAppStore((s) => s.setLastApprovedTemplate)

  const [loading, setLocalLoading] = useState(false)
  const [mapping, setMapping] = useState(wizardState.mapping || {})
  const [keys, setKeys] = useState(wizardState.keys || [])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    const fetchMapping = async () => {
      if (!templateId) return

      setLocalLoading(true)
      try {
        const connectionId = wizardState.connectionId || activeConnection?.id
        await execute({
          type: InteractionType.ANALYZE,
          label: 'Load mapping preview',
          reversibility: Reversibility.SYSTEM_MANAGED,
          suppressSuccessToast: true,
          suppressErrorToast: true,
          blocksNavigation: false,
          intent: {
            connectionId,
            templateId,
            templateKind: wizardState.templateKind || 'pdf',
            action: 'mapping_preview',
          },
          action: async () => {
            try {
              const result = await api.mappingPreview(templateId, connectionId, {
                kind: wizardState.templateKind || 'pdf',
              })

              if (!cancelled) {
                if (result.mapping) {
                  setMapping(result.mapping)
                  updateWizardState({ mapping: result.mapping })
                }
                if (result.keys) {
                  setKeys(result.keys)
                  updateWizardState({ keys: result.keys })
                }
              }
              return result
            } catch (err) {
              if (!cancelled) {
                setError(err.message || 'Failed to load mapping')
              }
              throw err
            }
          },
        })
      } finally {
        if (!cancelled) {
          setLocalLoading(false)
        }
      }
    }

    if (!wizardState.mapping) {
      fetchMapping()
    }

    return () => { cancelled = true }
  }, [templateId, wizardState.connectionId, wizardState.templateKind, wizardState.mapping, activeConnection?.id, updateWizardState, execute])

  const handleMappingChange = useCallback((token, field, value) => {
    setMapping((prev) => ({
      ...prev,
      [token]: {
        ...prev[token],
        [field]: value,
      },
    }))
  }, [])

  const handleApprove = useCallback(async () => {
    setApproving(true)
    setError(null)

    try {
      const connectionId = wizardState.connectionId || activeConnection?.id

      await execute({
        type: InteractionType.UPDATE,
        label: 'Approve template mapping',
        reversibility: Reversibility.SYSTEM_MANAGED,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        blocksNavigation: true,
        intent: {
          connectionId,
          templateId,
          templateKind: wizardState.templateKind || 'pdf',
          action: 'mapping_approve',
        },
        action: async () => {
          try {
            const result = await api.mappingApprove(templateId, mapping, {
              connectionId,
              keys,
              kind: wizardState.templateKind || 'pdf',
              onProgress: () => {
                // Handle progress events
              },
            })

            if (result.ok) {
              setApproved(true)
              setLastApprovedTemplate({
                id: templateId,
                name: wizardState.templateName,
                kind: wizardState.templateKind,
              })
              toast.show('Template approved and ready to use!', 'success')
            }
            return result
          } catch (err) {
            setError(err.message || 'Failed to approve mapping')
            toast.show(err.message || 'Failed to approve mapping', 'error')
            throw err
          }
        },
      })
    } finally {
      setApproving(false)
    }
  }, [templateId, mapping, keys, wizardState, activeConnection?.id, setLastApprovedTemplate, toast, execute])

  const mappingEntries = Object.entries(mapping)

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
        Configure Field Mapping
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Map template placeholders to your database columns for automatic data insertion.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {approved && (
        <Alert
          severity="success"
          icon={<CheckCircleIcon />}
          sx={{ mb: 3 }}
        >
          Template mapping approved! You can now generate reports.
        </Alert>
      )}

      {loading ? (
        <Box sx={{ py: 4 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
            Loading mapping configuration...
          </Typography>
          <LinearProgress />
        </Box>
      ) : mappingEntries.length === 0 ? (
        <Alert severity="info">
          No mappings found. The template may not have any placeholder tokens.
        </Alert>
      ) : (
        <>
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell sx={{ fontWeight: 600 }}>Template Field</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Database Column</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mappingEntries.map(([token, config]) => (
                  <TableRow key={token}>
                    <TableCell>
                      <Chip
                        label={token}
                        size="small"
                        variant="outlined"
                        sx={{ fontFamily: 'monospace' }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={config?.column || config?.expression || ''}
                        onChange={(e) => handleMappingChange(token, 'column', e.target.value)}
                        placeholder="Enter column name"
                        fullWidth
                        disabled={approved}
                      />
                    </TableCell>
                    <TableCell>
                      {config?.column || config?.expression ? (
                        <Chip label="Mapped" size="small" variant="outlined" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
                      ) : (
                        <Chip label="Unmapped" size="small" variant="outlined" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          {/* Advanced Settings */}
          <Box sx={{ mt: 3 }}>
            <Button
              variant="text"
              size="small"
              onClick={() => setShowAdvanced((prev) => !prev)}
              endIcon={showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ textTransform: 'none', fontWeight: 500 }}
            >
              Advanced Settings
            </Button>

            <Collapse in={showAdvanced}>
              <Paper sx={{ mt: 2, p: 2, bgcolor: 'action.hover' }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 2 }}>
                  Key Fields
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Select fields that will be used as filter keys when generating reports.
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" gap={1}>
                  {mappingEntries.map(([token]) => (
                    <Chip
                      key={token}
                      label={token}
                      size="small"
                      variant={keys.includes(token) ? 'filled' : 'outlined'}
                      sx={keys.includes(token) ? { bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' } : {}}
                      onClick={() => {
                        if (keys.includes(token)) {
                          setKeys((prev) => prev.filter((k) => k !== token))
                        } else {
                          setKeys((prev) => [...prev, token])
                        }
                      }}
                      disabled={approved}
                    />
                  ))}
                </Stack>
              </Paper>
            </Collapse>
          </Box>

          {/* Approve Button */}
          {!approved && (
            <Box sx={{ mt: 4, textAlign: 'center' }}>
              <Button
                variant="contained"
                size="large"
                onClick={handleApprove}
                disabled={approving}
                startIcon={<AutoFixHighIcon />}
              >
                {approving ? 'Approving...' : 'Approve Mapping'}
              </Button>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}


// Pre-built template gallery for users who don't have their own
const TEMPLATE_GALLERY = [
  {
    id: 'gallery-invoice',
    name: 'Invoice Report',
    description: 'Professional invoice template with line items, totals, and company branding',
    kind: 'pdf',
    icon: ReceiptLongIcon,
    popular: true,
  },
  {
    id: 'gallery-sales',
    name: 'Sales Summary',
    description: 'Weekly/monthly sales report with charts, metrics, and trends',
    kind: 'excel',
    icon: AssessmentIcon,
    popular: true,
  },
  {
    id: 'gallery-inventory',
    name: 'Inventory Report',
    description: 'Stock levels, reorder points, and inventory movement tracking',
    kind: 'excel',
    icon: TableChartIcon,
    popular: false,
  },
  {
    id: 'gallery-executive',
    name: 'Executive Summary',
    description: 'High-level business metrics and KPIs for leadership review',
    kind: 'pdf',
    icon: SummarizeIcon,
    popular: false,
  },
  {
    id: 'gallery-blank-pdf',
    name: 'Blank PDF Template',
    description: 'Start from scratch with a customizable PDF layout',
    kind: 'pdf',
    icon: DescriptionIcon,
    popular: false,
  },
  {
    id: 'gallery-blank-excel',
    name: 'Blank Excel Template',
    description: 'Start from scratch with a customizable spreadsheet',
    kind: 'excel',
    icon: TableChartIcon,
    popular: false,
  },
]

function StepTemplate({ wizardState, updateWizardState, onComplete, setLoading }) {
  const toast = useToast()
  const { execute } = useInteraction()
  const navigate = useNavigateInteraction()
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { from: 'setup-step-template', ...intent } }),
    [navigate]
  )
  const fileInputRef = useRef(null)

  const activeConnection = useAppStore((s) => s.activeConnection)
  const setTemplateId = useAppStore((s) => s.setTemplateId)
  const setVerifyArtifacts = useAppStore((s) => s.setVerifyArtifacts)
  const addTemplate = useAppStore((s) => s.addTemplate)

  const [templateKind, setTemplateKind] = useState(wizardState.templateKind || 'pdf')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [verifyResult, setVerifyResult] = useState(null)
  const [error, setError] = useState(null)
  const [queueInBackground, setQueueInBackground] = useState(false)
  const [queuedJobId, setQueuedJobId] = useState(null)
  const [selectedGalleryTemplate, setSelectedGalleryTemplate] = useState(null)
  const [showUpload, setShowUpload] = useState(false)

  useEffect(() => {
    if (!queuedJobId) return
    let cancelled = false

    const pollJob = async () => {
      try {
        const job = await api.getJob(queuedJobId)
        if (cancelled || !job) return

        if (typeof job.progress === 'number') {
          setUploadProgress(Math.round(job.progress))
        }

        if (job.status === 'completed') {
          const result = job.result || {}
          const templateId = result.template_id || result.templateId
          if (!templateId) {
            setError('Template verification completed but no template ID was returned.')
            toast.show('Template verification completed without a template ID.', 'error')
            setQueuedJobId(null)
            return
          }

          setVerifyResult(result)
          setTemplateId(templateId)
          setVerifyArtifacts(result.artifacts)
          updateWizardState({ templateId })

          addTemplate({
            id: templateId,
            name: uploadedFile?.name || `Template ${templateId}`,
            kind: templateKind,
            status: 'pending',
            created_at: new Date().toISOString(),
          })

          toast.show('Template verified successfully', 'success')
          setQueuedJobId(null)
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          const message = job.error || 'Template verification failed'
          setError(message)
          toast.show(message, 'error')
          setQueuedJobId(null)
        }
      } catch (err) {
        if (cancelled) return
        const message = err.message || 'Failed to load queued job status'
        setError(message)
        toast.show(message, 'error')
        setQueuedJobId(null)
      }
    }

    pollJob()
    const intervalId = setInterval(pollJob, 3000)
    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [
    queuedJobId,
    templateKind,
    uploadedFile,
    setTemplateId,
    setVerifyArtifacts,
    updateWizardState,
    addTemplate,
    toast,
  ])

  const handleKindChange = useCallback((_, newKind) => {
    if (newKind) {
      setTemplateKind(newKind)
      updateWizardState({ templateKind: newKind })
    }
  }, [updateWizardState])

  const handleFile = useCallback(async (file) => {
    setError(null)
    setUploadedFile(file)
    setUploading(true)
    setUploadProgress(0)
    setQueuedJobId(null)

    try {
      const connectionId = wizardState.connectionId || activeConnection?.id
      if (!connectionId) {
        const msg = 'Please connect to a database before verifying templates.'
        setError(msg)
        toast.show(msg, 'warning')
        setUploading(false)
        setUploadProgress(0)
        return
      }

      await execute({
        type: InteractionType.UPLOAD,
        label: `Verify ${templateKind.toUpperCase()} template`,
        reversibility: Reversibility.SYSTEM_MANAGED,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        blocksNavigation: true,
        intent: {
          connectionId,
          templateKind,
          fileName: file?.name,
          action: 'verify_template',
        },
        action: async () => {
          try {
            const result = await api.verifyTemplate({
              file,
              connectionId,
              kind: templateKind,
              background: queueInBackground,
              onProgress: (event) => {
                if (event.event === 'stage') {
                  const progress = event.progress || 0
                  setUploadProgress(progress)
                }
              },
              onUploadProgress: (percent) => {
                setUploadProgress(percent)
              },
            })

            if (queueInBackground) {
              const jobId = result?.job_id || result?.jobId || null
              setQueuedJobId(jobId)
              toast.show('Template verification queued. Track progress in Jobs.', 'success')
              return result
            }

            setVerifyResult(result)
            setTemplateId(result.template_id)
            setVerifyArtifacts(result.artifacts)
            updateWizardState({ templateId: result.template_id })

            // Add to templates list
            addTemplate({
              id: result.template_id,
              name: file.name,
              kind: templateKind,
              status: 'pending',
              created_at: new Date().toISOString(),
            })

            toast.show('Template verified successfully', 'success')
            return result
          } catch (err) {
            setError(err.message || 'Failed to verify template')
            toast.show(err.message || 'Failed to verify template', 'error')
            throw err
          }
        },
      })
    } finally {
      setUploading(false)
      setUploadProgress(100)
    }
  }, [
    wizardState.connectionId,
    activeConnection?.id,
    templateKind,
    queueInBackground,
    setTemplateId,
    setVerifyArtifacts,
    updateWizardState,
    addTemplate,
    toast,
    execute,
  ])

  const handleDrop = useCallback((event) => {
    event.preventDefault()
    const files = event.dataTransfer?.files
    if (files?.length > 0) {
      handleFile(files[0])
    }
  }, [handleFile])

  const handleDragOver = useCallback((event) => {
    event.preventDefault()
  }, [])

  const handleFileSelect = useCallback((event) => {
    const files = event.target.files
    if (files?.length > 0) {
      handleFile(files[0])
    }
  }, [handleFile])

  const handleBrowseClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const acceptedTypes = templateKind === 'pdf'
    ? '.pdf'
    : '.xlsx,.xls'

  const handleSelectGalleryTemplate = useCallback((template) => {
    setSelectedGalleryTemplate(template)
    setTemplateKind(template.kind)
    updateWizardState({ templateKind: template.kind, galleryTemplate: template })
  }, [updateWizardState])

  const handleUseGalleryTemplate = useCallback(async () => {
    if (!selectedGalleryTemplate) return

    await execute({
      type: InteractionType.CREATE,
      label: `Use "${selectedGalleryTemplate.name}" template`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: {
        galleryId: selectedGalleryTemplate.id,
        kind: selectedGalleryTemplate.kind,
        action: 'use_gallery_template',
      },
      action: async () => {
        setLoading(true)
        try {
          // For gallery templates, we create a template based on the selected type
          const result = await api.createTemplateFromGallery?.({
            galleryId: selectedGalleryTemplate.id,
            kind: selectedGalleryTemplate.kind,
            connectionId: wizardState.connectionId,
          }).catch(() => ({
            // Fallback if API not available - create a placeholder template
            template_id: `template-${selectedGalleryTemplate.id}-${Date.now()}`,
            name: selectedGalleryTemplate.name,
          }))

          const templateId = result.template_id || result.templateId || `gallery-${selectedGalleryTemplate.id}`

          setTemplateId(templateId)
          updateWizardState({ templateId, galleryTemplate: selectedGalleryTemplate })

          addTemplate({
            id: templateId,
            name: selectedGalleryTemplate.name,
            kind: selectedGalleryTemplate.kind,
            status: 'approved',
            created_at: new Date().toISOString(),
            isGalleryTemplate: true,
          })

          toast.show(`"${selectedGalleryTemplate.name}" template ready!`, 'success')
          setVerifyResult({ template_id: templateId })
          return result
        } finally {
          setLoading(false)
        }
      },
    })
  }, [selectedGalleryTemplate, wizardState.connectionId, setTemplateId, updateWizardState, addTemplate, toast, setLoading, execute])

  const filteredGalleryTemplates = TEMPLATE_GALLERY.filter(t =>
    templateKind === 'all' || t.kind === templateKind
  )

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
        Choose a Report Template
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Create with AI, pick from our gallery, or upload your own design.
      </Typography>

      {/* Template Type Filter */}
      <Box sx={{ mb: 3 }}>
        <ToggleButtonGroup
          value={templateKind}
          exclusive
          onChange={handleKindChange}
          size="small"
        >
          <ToggleButton value="pdf" sx={{ px: 3 }}>
            <PictureAsPdfIcon sx={{ mr: 1, fontSize: 18 }} />
            PDF Reports
          </ToggleButton>
          <ToggleButton value="excel" sx={{ px: 3 }}>
            <TableChartIcon sx={{ mr: 1, fontSize: 18 }} />
            Excel Reports
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Template Gallery */}
      {!showUpload && !verifyResult && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} color="text.secondary" sx={{ mb: 2, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>
            <AutoAwesomeIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
            Template Gallery
          </Typography>

          <Grid container spacing={2}>
            {filteredGalleryTemplates.map((template) => {
              const IconComponent = template.icon
              const isSelected = selectedGalleryTemplate?.id === template.id

              return (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={template.id}>
                  <Card
                    variant="outlined"
                    sx={{
                      height: '100%',
                      border: 2,
                      borderColor: isSelected ? (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700] : 'divider',
                      bgcolor: isSelected ? (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50] : 'transparent',
                      transition: 'all 0.2s',
                      '&:hover': {
                        borderColor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                        transform: 'translateY(-2px)',
                        boxShadow: 2,
                      },
                    }}
                  >
                    <CardActionArea
                      onClick={() => handleSelectGalleryTemplate(template)}
                      sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
                    >
                      <CardContent sx={{ flex: 1 }}>
                        <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
                          <Radio checked={isSelected} size="small" sx={{ p: 0, mr: 0.5 }} />
                          <IconComponent sx={{
                            fontSize: 24,
                            color: 'text.secondary'
                          }} />
                          <Box sx={{ flex: 1 }}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <Typography variant="subtitle2" fontWeight={600}>
                                {template.name}
                              </Typography>
                              {template.popular && (
                                <Chip label="Popular" size="small" sx={{ height: 18, fontSize: '10px', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
                              )}
                            </Stack>
                            <Chip
                              label={template.kind.toUpperCase()}
                              size="small"
                              variant="outlined"
                              sx={{ height: 18, fontSize: '10px', mt: 0.5, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                            />
                          </Box>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {template.description}
                        </Typography>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                </Grid>
              )
            })}
          </Grid>

          {selectedGalleryTemplate && (
            <Box sx={{ mt: 2 }}>
              <Button
                variant="contained"
                onClick={handleUseGalleryTemplate}
                startIcon={<CheckCircleIcon />}
                sx={{ mr: 2 }}
              >
                Use "{selectedGalleryTemplate.name}"
              </Button>
              <Button variant="text" onClick={() => setSelectedGalleryTemplate(null)}>
                Clear Selection
              </Button>
            </Box>
          )}

          <Divider sx={{ my: 3 }}>
            <Chip label="Or start your own" size="small" />
          </Divider>

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              startIcon={<AutoAwesomeIcon />}
              onClick={() => handleNavigate(`/templates/new/chat?from=wizard&connectionId=${encodeURIComponent(wizardState.connectionId || '')}`, 'Create template with AI')}
              sx={{
                bgcolor: neutral[900],
                '&:hover': { bgcolor: neutral[700] },
              }}
            >
              Create with AI
            </Button>
            <Button
              variant="outlined"
              startIcon={<CloudUploadIcon />}
              onClick={() => setShowUpload(true)}
              sx={{ borderStyle: 'dashed' }}
            >
              Upload Custom Template
            </Button>
          </Stack>
        </Box>
      )}

      {/* Upload Section - shown when user chooses to upload */}
      {(showUpload || verifyResult) && (
        <>
          {showUpload && !verifyResult && (
            <Button
              variant="text"
              onClick={() => setShowUpload(false)}
              sx={{ mb: 2 }}
            >
              ← Back to Gallery
            </Button>
          )}

          {error && (
            <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {queuedJobId && (
        <Alert
          severity="info"
          sx={{ mb: 3 }}
          action={(
            <Button size="small" onClick={() => handleNavigate('/jobs', 'Open jobs')} sx={{ textTransform: 'none' }}>
              View Jobs
            </Button>
          )}
        >
          Template verification queued. Job ID: {queuedJobId}
        </Alert>
      )}

      {verifyResult ? (
        <Paper
          sx={{
            p: 3,
            border: 2,
            borderColor: (theme) => alpha(theme.palette.divider, 0.3),
            bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
          }}
        >
          <Stack direction="row" alignItems="center" spacing={2}>
            <CheckCircleIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                Template Verified
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {uploadedFile?.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                ID: {verifyResult.template_id}
              </Typography>
            </Box>
          </Stack>
        </Paper>
      ) : (
        <Paper
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          sx={{
            p: 4,
            border: 2,
            borderStyle: 'dashed',
            borderColor: 'divider',
            bgcolor: 'action.hover',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.2s, background-color 0.2s',
            '&:hover': {
              borderColor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
              bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
            },
          }}
          onClick={handleBrowseClick}
        >
          <Stack direction="row" justifyContent="center" sx={{ mb: 2 }}>
            <Button
              variant={queueInBackground ? 'contained' : 'outlined'}
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                setQueueInBackground((prev) => !prev)
              }}
              sx={{ textTransform: 'none' }}
            >
              {queueInBackground ? 'Queue in background: On' : 'Queue in background: Off'}
            </Button>
          </Stack>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedTypes}
            onChange={handleFileSelect}
            hidden
          />

          {uploading ? (
            <Box>
              <Typography variant="body1" sx={{ mb: 2 }}>
                Uploading and verifying...
              </Typography>
              <LinearProgress
                variant="determinate"
                value={uploadProgress}
                sx={{ maxWidth: 300, mx: 'auto', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], '& .MuiLinearProgress-bar': { bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700] } }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                {uploadProgress}%
              </Typography>
            </Box>
          ) : (
            <>
              <CloudUploadIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
              <Typography variant="body1" sx={{ mb: 1 }}>
                Drag and drop your {templateKind.toUpperCase()} file here
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                or click to browse
              </Typography>
              <Button variant="outlined" size="small">
                Browse Files
              </Button>
            </>
          )}
        </Paper>
      )}

          {/* Preview */}
          {verifyResult?.artifacts?.png_url && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                Preview
              </Typography>
              <Paper sx={{ p: 2, bgcolor: 'background.default' }}>
                <img
                  src={verifyResult.artifacts.png_url}
                  alt="Template preview"
                  style={{ maxWidth: '100%', height: 'auto', borderRadius: 4 }}
                />
              </Paper>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

// === From: SetupWizardContainer.jsx ===

const WIZARD_STORAGE_KEY = 'neurareport_wizard_state'

const saveWizardState = (state) => {
  try {
    sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    // Ignore storage errors
  }
}

const loadWizardState = () => {
  try {
    const stored = sessionStorage.getItem(WIZARD_STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch (e) {
    return null
  }
}

const clearWizardState = () => {
  try {
    sessionStorage.removeItem(WIZARD_STORAGE_KEY)
  } catch (e) {
    // Ignore storage errors
  }
}

const WIZARD_STEPS = [
  {
    key: 'connection',
    label: 'Connect Data Source',
    description: 'Select or create a data source for reports',
  },
  {
    key: 'template',
    label: 'Upload Report Design',
    description: 'Upload a PDF or Excel design',
  },
  {
    key: 'mapping',
    label: 'Map Fields',
    description: 'Match design fields to data columns (no SQL required)',
  },
]

const STEP_MAP = { connection: 0, template: 1, mapping: 2 }
const STEP_KEYS = ['connection', 'template', 'mapping']

export default function SetupWizard() {
  const navigate = useNavigateInteraction()
  const [searchParams, setSearchParams] = useSearchParams()
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { from: 'setup-wizard', ...intent } }),
    [navigate]
  )
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  // Get step from URL or default to 0
  const stepParam = searchParams.get('step') || 'connection'
  const [currentStep, setCurrentStep] = useState(() => STEP_MAP[stepParam] ?? 0)

  // Load wizard state from sessionStorage on mount
  const [wizardState, setWizardState] = useState(() => {
    const stored = loadWizardState()
    return stored || {
      connectionId: null,
      templateId: null,
      templateKind: 'pdf',
      mapping: null,
      keys: [],
    }
  })

  const activeConnection = useAppStore((s) => s.activeConnection)
  const templateId = useAppStore((s) => s.templateId)

  // Persist wizard state to sessionStorage whenever it changes
  useEffect(() => {
    saveWizardState(wizardState)
  }, [wizardState])

  // Update URL when step changes
  useEffect(() => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)
      newParams.set('step', STEP_KEYS[currentStep])
      return newParams
    }, { replace: true })
  }, [currentStep, setSearchParams])

  const updateWizardState = useCallback((updates) => {
    setWizardState((prev) => ({ ...prev, ...updates }))
  }, [])

  const handleNext = useCallback(() => {
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1)
    }
  }, [currentStep])

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }, [currentStep])

  const handleComplete = useCallback(() => {
    clearWizardState()
    toast.show('Report design ready. You can run it from Reports.', 'success')
    handleNavigate('/reports', 'Open reports')
  }, [handleNavigate, toast])

  const handleCancel = useCallback(() => {
    clearWizardState()
    handleNavigate('/', 'Exit wizard')
  }, [handleNavigate])

  const getStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <StepConnection
            wizardState={wizardState}
            updateWizardState={updateWizardState}
            onComplete={handleNext}
            setLoading={setLoading}
          />
        )
      case 1:
        return (
          <StepTemplate
            wizardState={wizardState}
            updateWizardState={updateWizardState}
            onComplete={handleNext}
            setLoading={setLoading}
          />
        )
      case 2:
        return (
          <StepMapping
            wizardState={wizardState}
            updateWizardState={updateWizardState}
            onComplete={handleComplete}
            setLoading={setLoading}
          />
        )
      default:
        return null
    }
  }

  const isNextDisabled = () => {
    switch (currentStep) {
      case 0:
        return !wizardState.connectionId && !activeConnection?.id
      case 1:
        return !wizardState.templateId && !templateId
      case 2:
        return false
      default:
        return false
    }
  }

  return (
    <WizardLayout
      title="Set Up Report Design"
      subtitle="Connect your data source and prepare a report design for runs"
      steps={WIZARD_STEPS}
      currentStep={currentStep}
      onNext={handleNext}
      onPrev={handlePrev}
      onComplete={handleComplete}
      onCancel={handleCancel}
      nextDisabled={isNextDisabled()}
      loading={loading}
    >
      <Stack spacing={2}>
        <ReportGlossaryNotice dense showChips={false} />
        {getStepContent()}
      </Stack>
    </WizardLayout>
  )
}
