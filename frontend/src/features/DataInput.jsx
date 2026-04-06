import { neutral, palette, secondary } from '@/app/theme'
import { ActionButton, FullHeightPageContainer as PageContainer } from '@/styles/styles'
import { ConnectionSelector, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useSharedData } from '@/hooks/hooks'
import { useAppStore } from '@/stores/app'
import { useConnectorStore, useIngestionStore } from '@/stores/workspace'
import {
  Add as AddIcon,
  CheckCircle as ConnectedIcon,
  CheckCircle as SuccessIcon,
  Cloud as CloudIcon,
  CloudUpload as UploadIcon,
  Code as QueryIcon,
  ContentPaste as ClipIcon,
  Delete as DeleteIcon,
  Description as DocIcon,
  Email as EmailIcon,
  Error as ErrorIcon,
  Folder as FolderIcon,
  FolderOpen as WatcherIcon,
  Link as UrlIcon,
  Mic as MicIcon,
  PlayArrow as PlayArrowIcon,
  PlayArrow as StartIcon,
  Refresh as RefreshIcon,
  Refresh as SyncIcon,
  Schedule as PendingIcon,
  Schema as SchemaIcon,
  Stop as StopIcon,
  Storage as DatabaseIcon,
  Storage as DatabaseImportIcon,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Paper,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import React, { useCallback, useEffect, useRef, useState } from 'react'
const Header = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2, 3),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
}))

const ContentArea = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(3),
  overflow: 'auto',
}))

const DropZone = styled(Paper, { shouldForwardProp: (prop) => prop !== 'isDragging' })(({ theme, isDragging }) => ({
  padding: theme.spacing(6),
  border: `2px dashed ${isDragging ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700]) : alpha(theme.palette.divider, 0.3)}`,
  backgroundColor: isDragging ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50]) : 'transparent',
  borderRadius: 8,  // Figma spec: 8px
  textAlign: 'center',
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.02) : neutral[50],
  },
}))

const MethodCard = styled(Card, { shouldForwardProp: (prop) => prop !== 'selected' })(({ theme, selected }) => ({
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  border: selected ? `2px solid ${theme.palette.mode === 'dark' ? neutral[500] : neutral[900]}` : `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.1)}`,
  },
}))

const UploadItem = styled(Paper, { shouldForwardProp: (prop) => prop !== 'status' })(({ theme, status }) => ({
  padding: theme.spacing(2),
  marginBottom: theme.spacing(1),
  borderLeft: `4px solid ${
    status === 'completed'
      ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700])
      : status === 'error'
      ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900])
      : (theme.palette.mode === 'dark' ? neutral[500] : neutral[500])
  }`,
}))

const WatcherCard = styled(Paper, { shouldForwardProp: (prop) => prop !== 'isRunning' })(({ theme, isRunning }) => ({
  padding: theme.spacing(2),
  marginBottom: theme.spacing(1),
  border: `1px solid ${isRunning ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700]) : alpha(theme.palette.divider, 0.2)}`,
}))

const INGESTION_METHODS = [
  { id: 'upload', name: 'File Upload', description: 'Upload files from your computer', icon: UploadIcon, color: 'primary' },
  { id: 'url', name: 'URL Import', description: 'Import from a web URL', icon: UrlIcon, color: 'info' },
  { id: 'clip', name: 'Web Clipper', description: 'Clip content from web pages', icon: ClipIcon, color: 'secondary' },
  { id: 'watcher', name: 'Folder Watcher', description: 'Auto-import from folders', icon: WatcherIcon, color: 'warning' },
  { id: 'email', name: 'Email Import', description: 'Import from email accounts', icon: EmailIcon, color: 'error' },
  { id: 'transcribe', name: 'Transcription', description: 'Transcribe audio/video', icon: MicIcon, color: 'success' },
  { id: 'database', name: 'Database Import', description: 'Import from a database connection', icon: DatabaseImportIcon, color: 'primary' },
]


export function IngestionPageContainer() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const fileInputRef = useRef(null)
  const { connections, activeConnectionId } = useSharedData()
  const {
    uploads,
    watchers,
    transcriptionJobs,
    imapAccounts,
    uploadProgress,
    loading,
    uploading,
    error,
    uploadFile,
    uploadBulk,
    uploadZip,
    importFromUrl,
    clipUrl,
    createWatcher,
    fetchWatchers,
    startWatcher,
    stopWatcher,
    deleteWatcher,
    transcribeFile,
    connectImapAccount,
    fetchImapAccounts,
    syncImapAccount,
    reset,
  } = useIngestionStore()

  const [activeMethod, setActiveMethod] = useState('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [watcherPath, setWatcherPath] = useState('')
  const [createWatcherOpen, setCreateWatcherOpen] = useState(false)
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId || '')

  useEffect(() => {
    fetchWatchers()
    fetchImapAccounts()
    return () => reset()
  }, [fetchImapAccounts, fetchWatchers, reset])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    return execute({
      type: InteractionType.CREATE,
      label: `Upload ${files.length} file(s)`,
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      intent: { source: 'ingestion', fileCount: files.length },
      action: async () => {
        if (files.length === 1) {
          await uploadFile(files[0])
        } else {
          await uploadBulk(files)
        }
        toast.show(`${files.length} file(s) uploaded`, 'success')
      },
    })
  }, [execute, toast, uploadBulk, uploadFile])

  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files)
    if (files.length === 0) return

    return execute({
      type: InteractionType.CREATE,
      label: `Upload ${files.length} file(s)`,
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      intent: { source: 'ingestion', fileCount: files.length },
      action: async () => {
        if (files.length === 1) {
          const isZip = files[0].name.endsWith('.zip')
          if (isZip) {
            await uploadZip(files[0])
          } else {
            await uploadFile(files[0])
          }
        } else {
          await uploadBulk(files)
        }
        toast.show(`${files.length} file(s) uploaded`, 'success')
      },
    })
  }, [execute, toast, uploadBulk, uploadFile, uploadZip])

  const handleUrlImport = useCallback(async () => {
    if (!urlInput.trim()) return

    return execute({
      type: InteractionType.CREATE,
      label: 'Import from URL',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      intent: { source: 'ingestion', url: urlInput },
      action: async () => {
        await importFromUrl(urlInput)
        toast.show('URL imported', 'success')
        setUrlInput('')
      },
    })
  }, [execute, importFromUrl, toast, urlInput])

  const handleClipUrl = useCallback(async () => {
    if (!urlInput.trim()) return

    return execute({
      type: InteractionType.CREATE,
      label: 'Clip web page',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      intent: { source: 'ingestion', url: urlInput },
      action: async () => {
        await clipUrl(urlInput)
        toast.show('Page clipped', 'success')
        setUrlInput('')
      },
    })
  }, [clipUrl, execute, toast, urlInput])

  const handleCreateWatcher = useCallback(async () => {
    if (!watcherPath.trim()) return

    return execute({
      type: InteractionType.CREATE,
      label: 'Create folder watcher',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'ingestion', path: watcherPath },
      action: async () => {
        await createWatcher(watcherPath)
        toast.show('Watcher created', 'success')
        setWatcherPath('')
        setCreateWatcherOpen(false)
      },
    })
  }, [createWatcher, execute, toast, watcherPath])

  const handleToggleWatcher = useCallback(async (watcher) => {
    const isRunning = watcher.status === 'running'
    return execute({
      type: InteractionType.UPDATE,
      label: isRunning ? 'Stop watcher' : 'Start watcher',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      intent: { source: 'ingestion', watcherId: watcher.id },
      action: async () => {
        if (isRunning) {
          await stopWatcher(watcher.id)
          toast.show('Watcher stopped', 'info')
        } else {
          await startWatcher(watcher.id)
          toast.show('Watcher started', 'success')
        }
      },
    })
  }, [execute, startWatcher, stopWatcher, toast])

  const handleDeleteWatcher = useCallback(async (watcherId) => {
    return execute({
      type: InteractionType.DELETE,
      label: 'Delete watcher',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'ingestion', watcherId },
      action: async () => {
        await deleteWatcher(watcherId)
        toast.show('Watcher deleted', 'success')
      },
    })
  }, [deleteWatcher, execute, toast])

  const handleTranscribe = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    return execute({
      type: InteractionType.CREATE,
      label: 'Transcribe file',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      intent: { source: 'ingestion', filename: file.name },
      action: async () => {
        await transcribeFile(file)
        toast.show('Transcription started', 'success')
      },
    })
  }, [execute, toast, transcribeFile])

  const renderMethodContent = () => {
    switch (activeMethod) {
      case 'upload':
        return (
          <Box>
            <DropZone
              isDragging={isDragging}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={handleFileSelect}
              />
              <UploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" sx={{ mb: 1 }}>
                Drag & drop files here
              </Typography>
              <Typography variant="body2" color="text.secondary">
                or click to browse (PDF, DOCX, XLSX, TXT, ZIP)
              </Typography>
            </DropZone>
          </Box>
        )

      case 'url':
      case 'clip':
        return (
          <Paper sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
              {activeMethod === 'url' ? 'Import from URL' : 'Clip Web Page'}
            </Typography>
            <TextField
              fullWidth
              placeholder="https://example.com/document"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              sx={{ mb: 2 }}
            />
            <ActionButton
              variant="contained"
              onClick={activeMethod === 'url' ? handleUrlImport : handleClipUrl}
              disabled={!urlInput.trim() || loading}
              startIcon={loading ? <CircularProgress size={20} /> : activeMethod === 'url' ? <UrlIcon /> : <ClipIcon />}
            >
              {activeMethod === 'url' ? 'Import' : 'Clip Page'}
            </ActionButton>
          </Paper>
        )

      case 'watcher':
        return (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Folder Watchers
              </Typography>
              <ActionButton
                variant="contained"
                size="small"
                startIcon={<WatcherIcon />}
                onClick={() => setCreateWatcherOpen(true)}
              >
                Add Watcher
              </ActionButton>
            </Box>
            {watchers.length > 0 ? (
              watchers.map((watcher) => (
                <WatcherCard key={watcher.id} isRunning={watcher.status === 'running'}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <FolderIcon color={watcher.status === 'running' ? 'success' : 'action'} />
                      <Box>
                        <Typography variant="body1" sx={{ fontWeight: 500 }}>
                          {watcher.folder_path}
                        </Typography>
                        <Chip
                          size="small"
                          label={watcher.status}
                          color={watcher.status === 'running' ? 'success' : 'default'}
                        />
                      </Box>
                    </Box>
                    <Box>
                      <IconButton onClick={() => handleToggleWatcher(watcher)}>
                        {watcher.status === 'running' ? <StopIcon /> : <StartIcon />}
                      </IconButton>
                      <IconButton onClick={() => handleDeleteWatcher(watcher.id)}>
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                  </Box>
                </WatcherCard>
              ))
            ) : (
              <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                No folder watchers configured
              </Typography>
            )}
          </Box>
        )

      case 'transcribe':
        return (
          <Paper sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
              Audio/Video Transcription
            </Typography>
            <DropZone
              onClick={() => document.getElementById('transcribe-input')?.click()}
            >
              <input
                id="transcribe-input"
                type="file"
                accept="audio/*,video/*"
                hidden
                onChange={handleTranscribe}
              />
              <MicIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" sx={{ mb: 1 }}>
                Upload audio or video file
              </Typography>
              <Typography variant="body2" color="text.secondary">
                MP3, WAV, MP4, WebM supported
              </Typography>
            </DropZone>

            {transcriptionJobs.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Transcription Jobs
                </Typography>
                {transcriptionJobs.map((job) => (
                  <UploadItem key={job.id} status={job.status}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="body2">{job.filename}</Typography>
                      <Chip size="small" label={job.status} />
                    </Box>
                    {job.status === 'processing' && <LinearProgress sx={{ mt: 1 }} />}
                  </UploadItem>
                ))}
              </Box>
            )}
          </Paper>
        )

      case 'database':
        return (
          <Paper sx={{ p: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
              Import from Database
            </Typography>
            <ConnectionSelector
              value={selectedConnectionId}
              onChange={setSelectedConnectionId}
              label="Select Connection"
              showStatus
              sx={{ mb: 2 }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Select a database connection to import tables and data.
            </Typography>
            <ActionButton
              variant="contained"
              disabled={!selectedConnectionId || loading}
              startIcon={loading ? <CircularProgress size={20} /> : <StartIcon />}
            >
              Import Data
            </ActionButton>
          </Paper>
        )

      default:
        return null
    }
  }

  return (
    <PageContainer>
      <Header>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <UploadIcon sx={{ color: 'text.secondary', fontSize: 28 }} />
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Document Ingestion
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Import documents from various sources
            </Typography>
          </Box>
        </Box>
      </Header>

      <ContentArea>
        {/* Method Selection */}
        <Grid container spacing={2} sx={{ mb: 4 }}>
          {INGESTION_METHODS.map((method) => (
            <Grid item xs={6} sm={4} md={2} key={method.id}>
              <MethodCard
                selected={activeMethod === method.id}
                onClick={() => setActiveMethod(method.id)}
              >
                <CardContent sx={{ textAlign: 'center', py: 2 }}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 1,  // Figma spec: 8px
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
                      mx: 'auto',
                      mb: 1,
                    }}
                  >
                    <method.icon sx={{ color: 'text.secondary' }} />
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {method.name}
                  </Typography>
                </CardContent>
              </MethodCard>
            </Grid>
          ))}
        </Grid>

        <Divider sx={{ mb: 3 }} />

        {/* Method Content */}
        {renderMethodContent()}

        {/* Recent Uploads */}
        {uploads.length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
              Recent Uploads
            </Typography>
            {uploads.slice(0, 10).map((upload) => (
              <UploadItem key={upload.id} status={upload.status || 'completed'}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <DocIcon sx={{ color: 'text.secondary' }} />
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {upload.filename || upload.title || 'Untitled'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {upload.file_type?.toUpperCase()} - {new Date(upload.created_at).toLocaleString()}
                    </Typography>
                  </Box>
                  {upload.status === 'completed' && <SuccessIcon sx={{ color: 'text.secondary' }} />}
                  {upload.status === 'error' && <ErrorIcon sx={{ color: 'text.secondary' }} />}
                  {upload.status === 'processing' && <CircularProgress size={20} />}
                </Box>
                {uploadProgress[upload.id] !== undefined && uploadProgress[upload.id] < 100 && (
                  <LinearProgress
                    variant="determinate"
                    value={uploadProgress[upload.id]}
                    sx={{ mt: 1 }}
                  />
                )}
              </UploadItem>
            ))}
          </Box>
        )}
      </ContentArea>

      {/* Create Watcher Dialog */}
      <Dialog open={createWatcherOpen} onClose={() => setCreateWatcherOpen(false)}>
        <DialogTitle>Add Folder Watcher</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Folder Path"
            placeholder="/path/to/folder"
            value={watcherPath}
            onChange={(e) => setWatcherPath(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateWatcherOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateWatcher}>Create</Button>
        </DialogActions>
      </Dialog>

      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          {error}
        </Alert>
      )}
    </PageContainer>
  )
}

// === From: connectors.jsx ===
/**
 * Connectors Page Container
 * Database and cloud storage connector management.
 */


const ConnPageContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: 'calc(100vh - 64px)',
  backgroundColor: theme.palette.background.default,
}))

const ConnHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
}))

const Content = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(3),
}))

const ConnectorCard = styled(Card)(({ theme }) => ({
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    transform: 'translateY(-4px)',
    boxShadow: `0 8px 30px ${alpha(theme.palette.text.primary, 0.15)}`,
  },
}))

const ConnectorIcon = styled(Box)(({ theme }) => ({
  width: 48,
  height: 48,
  borderRadius: 8,  // Figma spec: 8px
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: theme.spacing(2),
}))

const StatusChip = styled(Chip)(({ theme, status }) => ({
  borderRadius: 6,
  fontWeight: 500,
  ...(status === 'connected' && {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
    color: theme.palette.text.secondary,
  }),
  ...(status === 'error' && {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    color: theme.palette.text.secondary,
  }),
}))

const ConnActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
}))


const CONNECTOR_CATEGORIES = {
  database: {
    label: 'Databases',
    icon: DatabaseIcon,
    connectors: [
      { id: 'postgresql', name: 'PostgreSQL', color: secondary.slate[600] },
      { id: 'mysql', name: 'MySQL', color: secondary.cyan[700] },
      { id: 'mongodb', name: 'MongoDB', color: secondary.emerald[500] },
      { id: 'sqlserver', name: 'SQL Server', color: secondary.rose[600] },
      { id: 'bigquery', name: 'BigQuery', color: secondary.cyan[500] },
      { id: 'snowflake', name: 'Snowflake', color: secondary.cyan[400] },
    ],
  },
  cloud_storage: {
    label: 'Cloud Storage',
    icon: CloudIcon,
    connectors: [
      { id: 'google_drive', name: 'Google Drive', color: secondary.cyan[500] },
      { id: 'dropbox', name: 'Dropbox', color: secondary.violet[500] },
      { id: 's3', name: 'Amazon S3', color: secondary.fuchsia[500] },
      { id: 'azure_blob', name: 'Azure Blob', color: secondary.teal[500] },
      { id: 'onedrive', name: 'OneDrive', color: secondary.slate[500] },
    ],
  },
}


export function ConnectorsPage() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const addSavedConnection = useAppStore((s) => s.addSavedConnection)
  const setSavedConnections = useAppStore((s) => s.setSavedConnections)
  const removeSavedConnection = useAppStore((s) => s.removeSavedConnection)
  const {
    connectorTypes,
    connections,
    currentConnection,
    schema,
    queryResult,
    loading,
    testing,
    querying,
    error,
    fetchConnectorTypes,
    fetchConnections,
    testConnection,
    createConnection,
    deleteConnection,
    checkHealth,
    fetchSchema,
    executeQuery,
    reset,
  } = useConnectorStore()

  const [activeTab, setActiveTab] = useState(0)
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [selectedConnector, setSelectedConnector] = useState(null)
  const [connectionName, setConnectionName] = useState('')
  const [connectionConfig, setConnectionConfig] = useState({})
  const [queryDialogOpen, setQueryDialogOpen] = useState(false)
  const [queryText, setQueryText] = useState('')
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false)

  useEffect(() => {
    fetchConnectorTypes()
    fetchConnections().then(() => {
      // Sync to global app store so other pages see the connections
      const connectorConnections = useConnectorStore.getState().connections
      if (connectorConnections?.length > 0 && setSavedConnections) {
        setSavedConnections(connectorConnections)
      }
    })
    return () => reset()
  }, [fetchConnectorTypes, fetchConnections, reset, setSavedConnections])

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'connectors', ...intent },
      action,
    })
  }, [execute])

  const handleOpenConnect = useCallback((connector) => {
    return executeUI('Open connector setup', () => {
      setSelectedConnector(connector)
      setConnectionName('')
      setConnectionConfig({})
      setConnectDialogOpen(true)
    }, { connectorId: connector?.id })
  }, [executeUI])

  const handleCloseConnect = useCallback(() => {
    return executeUI('Close connector setup', () => setConnectDialogOpen(false))
  }, [executeUI])

  const handleTestConnection = useCallback(() => {
    if (!selectedConnector) return undefined
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Test connection',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'connectors', connectorId: selectedConnector.id },
      action: async () => {
        const result = await testConnection(selectedConnector.id, connectionConfig)
        if (result?.success) {
          toast.show('Connection successful!', 'success')
        } else {
          toast.show(`Connection failed: ${result?.error || 'Unknown error'}`, 'error')
        }
        return result
      },
    })
  }, [connectionConfig, execute, selectedConnector, testConnection, toast])

  const handleCreateConnection = useCallback(() => {
    if (!selectedConnector || !connectionName) return undefined
    return execute({
      type: InteractionType.CREATE,
      label: 'Create connection',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'connectors', connectorId: selectedConnector.id, name: connectionName },
      action: async () => {
        const connection = await createConnection(
          selectedConnector.id,
          connectionName,
          connectionConfig
        )
        if (connection) {
          // Sync to global app store so other pages see the new connection
          if (addSavedConnection) {
            addSavedConnection(connection)
          }
          setConnectDialogOpen(false)
          setSelectedConnector(null)
          toast.show('Connection created successfully', 'success')
        }
        return connection
      },
    })
  }, [addSavedConnection, connectionConfig, connectionName, createConnection, execute, selectedConnector, toast])

  const handleDeleteConnection = useCallback((connectionId) => {
    return execute({
      type: InteractionType.DELETE,
      label: 'Delete connection',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'connectors', connectionId },
      action: async () => {
        const success = await deleteConnection(connectionId)
        if (success) {
          // Sync deletion to global app store so other pages reflect the change
          if (removeSavedConnection) {
            removeSavedConnection(connectionId)
          }
          toast.show('Connection deleted', 'success')
        }
        return success
      },
    })
  }, [deleteConnection, execute, removeSavedConnection, toast])

  const handleCheckHealth = useCallback((connectionId) => {
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Check connection health',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'connectors', connectionId },
      action: async () => {
        const result = await checkHealth(connectionId)
        if (result?.success) {
          toast.show('Connection is healthy', 'success')
        } else {
          toast.show(`Health check failed: ${result?.error}`, 'error')
        }
        return result
      },
    })
  }, [checkHealth, execute, toast])

  const handleViewSchema = useCallback((connectionId) => {
    return executeUI('View schema', async () => {
      await fetchSchema(connectionId)
      setSchemaDialogOpen(true)
    }, { connectionId })
  }, [executeUI, fetchSchema])

  const handleCloseSchema = useCallback(() => {
    return executeUI('Close schema', () => setSchemaDialogOpen(false))
  }, [executeUI])

  const handleOpenQuery = useCallback((connection) => {
    return executeUI('Open query runner', () => {
      setSelectedConnector(connection)
      setQueryText('')
      setQueryDialogOpen(true)
    }, { connectionId: connection?.id })
  }, [executeUI])

  const handleCloseQuery = useCallback(() => {
    return executeUI('Close query runner', () => setQueryDialogOpen(false))
  }, [executeUI])

  const handleExecuteQuery = useCallback(() => {
    if (!selectedConnector || !queryText) return undefined
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Execute query',
      reversibility: Reversibility.IRREVERSIBLE,
      requiresConfirmation: false,
      blocksNavigation: true,
      intent: { source: 'connectors', connectionId: selectedConnector.id },
      action: async () => {
        const result = await executeQuery(selectedConnector.id, queryText)
        if (result?.error) {
          toast.show(`Query error: ${result.error}`, 'error')
        } else {
          toast.show(`Query executed: ${result?.row_count || 0} rows`, 'success')
        }
        return result
      },
    })
  }, [execute, executeQuery, queryText, selectedConnector, toast])

  const handleTabChange = useCallback((value) => {
    return executeUI('Switch connector tab', () => setActiveTab(value), { tab: value })
  }, [executeUI])

  const handleDismissError = useCallback(() => {
    return executeUI('Dismiss connector error', () => reset())
  }, [executeUI, reset])

  const categoryKeys = Object.keys(CONNECTOR_CATEGORIES)

  return (
    <ConnPageContainer>
      <ConnHeader>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              Data Connectors
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Connect to databases and cloud storage services
            </Typography>
          </Box>
          <Chip
            label={`${connections.length} connections`}
            variant="outlined"
            sx={{ borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700], color: 'text.secondary' }}
          />
        </Box>

        <Tabs
          value={activeTab}
          onChange={(e, v) => handleTabChange(v)}
          sx={{ mt: 2 }}
        >
          <Tab label="Available Connectors" />
          <Tab label={`My Connections (${connections.length})`} />
        </Tabs>
      </ConnHeader>

      <Content>
        {activeTab === 0 ? (
          // Available Connectors
          <Box>
            {categoryKeys.map((catKey) => {
              const category = CONNECTOR_CATEGORIES[catKey]
              const CategoryIcon = category.icon
              return (
                <Box key={catKey} sx={{ mb: 4 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <CategoryIcon color="inherit" sx={{ color: 'text.secondary' }} />
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      {category.label}
                    </Typography>
                  </Box>
                  <Grid container spacing={2}>
                    {category.connectors.map((connector) => (
                      <Grid item xs={12} sm={6} md={4} lg={3} key={connector.id}>
                        <ConnectorCard variant="outlined">
                          <CardContent>
                            <ConnectorIcon
                              sx={{ bgcolor: alpha(connector.color, 0.1) }}
                            >
                              {catKey === 'database' ? (
                                <DatabaseIcon sx={{ color: connector.color }} />
                              ) : (
                                <CloudIcon sx={{ color: connector.color }} />
                              )}
                            </ConnectorIcon>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                              {connector.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {catKey === 'database' ? 'Database' : 'Cloud Storage'}
                            </Typography>
                          </CardContent>
                          <CardActions sx={{ mt: 'auto', p: 2, pt: 0 }}>
                            <ConnActionButton
                              fullWidth
                              variant="outlined"
                              size="small"
                              onClick={() => handleOpenConnect(connector)}
                              data-testid="connector-connect-button"
                            >
                              Connect
                            </ConnActionButton>
                          </CardActions>
                        </ConnectorCard>
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              )
            })}
          </Box>
        ) : (
          // My Connections
          <Box>
            {connections.length > 0 ? (
              <Grid container spacing={2}>
                {connections.map((conn) => (
                  <Grid item xs={12} sm={6} md={4} key={conn.id}>
                    <ConnectorCard>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                          <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                              {conn.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {conn.connector_type}
                            </Typography>
                          </Box>
                          <StatusChip
                            size="small"
                            status={conn.status}
                            label={conn.status}
                            icon={conn.status === 'connected' ? <ConnectedIcon /> : <ErrorIcon />}
                          />
                        </Box>
                        {conn.latency_ms && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            Latency: {conn.latency_ms.toFixed(0)}ms
                          </Typography>
                        )}
                      </CardContent>
                      <CardActions sx={{ p: 2, pt: 0, gap: 1 }}>
                        <Tooltip title="Test connection">
                          <IconButton
                            size="small"
                            onClick={() => handleCheckHealth(conn.id)}
                          >
                            <RefreshIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="View schema">
                          <IconButton
                            size="small"
                            onClick={() => handleViewSchema(conn.id)}
                          >
                            <SchemaIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Run query">
                          <IconButton
                            size="small"
                            onClick={() => handleOpenQuery(conn)}
                          >
                            <QueryIcon />
                          </IconButton>
                        </Tooltip>
                        <Box sx={{ flex: 1 }} />
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            sx={{ color: 'text.secondary' }}
                            onClick={() => handleDeleteConnection(conn.id)}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </CardActions>
                    </ConnectorCard>
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <DatabaseIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                <Typography variant="h6" sx={{ mb: 1 }}>
                  No connections yet
                </Typography>
                <Typography color="text.secondary" sx={{ mb: 3 }}>
                  Connect to a database or cloud storage to get started.
                </Typography>
                <ConnActionButton
                  variant="contained"
                  onClick={() => handleTabChange(0)}
                >
                  Browse Connectors
                </ConnActionButton>
              </Box>
            )}
          </Box>
        )}
      </Content>

      {/* Connect Dialog */}
      <Dialog
        open={connectDialogOpen}
        onClose={handleCloseConnect}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Connect to {selectedConnector?.name}
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Connection Name"
            value={connectionName}
            onChange={(e) => setConnectionName(e.target.value)}
            sx={{ mt: 2, mb: 2 }}
          />
          <TextField
            fullWidth
            label="Host"
            value={connectionConfig.host || ''}
            onChange={(e) => setConnectionConfig({ ...connectionConfig, host: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Port"
            type="number"
            value={connectionConfig.port || ''}
            onChange={(e) => setConnectionConfig({ ...connectionConfig, port: parseInt(e.target.value) })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Database"
            value={connectionConfig.database || ''}
            onChange={(e) => setConnectionConfig({ ...connectionConfig, database: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Username"
            value={connectionConfig.username || ''}
            onChange={(e) => setConnectionConfig({ ...connectionConfig, username: e.target.value })}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Password"
            type="password"
            value={connectionConfig.password || ''}
            onChange={(e) => setConnectionConfig({ ...connectionConfig, password: e.target.value })}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleCloseConnect}>Cancel</Button>
          <Button
            variant="outlined"
            onClick={handleTestConnection}
            disabled={testing}
            startIcon={testing ? <CircularProgress size={16} /> : <PlayArrowIcon />}
          >
            Test
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateConnection}
            disabled={!connectionName || loading}
            data-testid="connector-create-button"
          >
            Connect
          </Button>
        </DialogActions>
      </Dialog>

      {/* Query Dialog */}
      <Dialog
        open={queryDialogOpen}
        onClose={handleCloseQuery}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Run Query</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={6}
            label="SQL Query"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="SELECT * FROM table_name LIMIT 100"
            sx={{ mt: 2 }}
          />
          {queryResult && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Results ({queryResult.row_count} rows, {queryResult.execution_time_ms?.toFixed(0)}ms)
              </Typography>
              <Paper variant="outlined" sx={{ p: 2, maxHeight: 300, overflow: 'auto' }}>
                {queryResult.columns?.length > 0 ? (
                  <Box component="pre" sx={{ fontSize: 12, m: 0 }}>
                    {JSON.stringify(queryResult.rows?.slice(0, 10), null, 2)}
                  </Box>
                ) : (
                  <Typography color="text.secondary">No results</Typography>
                )}
              </Paper>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseQuery}>Close</Button>
          <Button
            variant="contained"
            onClick={handleExecuteQuery}
            disabled={!queryText || querying}
            startIcon={querying ? <CircularProgress size={16} /> : <PlayArrowIcon />}
          >
            Execute
          </Button>
        </DialogActions>
      </Dialog>

      {/* Schema Dialog */}
      <Dialog
        open={schemaDialogOpen}
        onClose={handleCloseSchema}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Database Schema</DialogTitle>
        <DialogContent>
          {schema?.tables?.length > 0 ? (
            <Box sx={{ mt: 2 }}>
              {schema.tables.map((table) => (
                <Paper key={table.name} variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                    {table.name}
                    {table.row_count && (
                      <Chip size="small" label={`${table.row_count} rows`} sx={{ ml: 1 }} />
                    )}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {table.columns?.map((col) => (
                      <Chip
                        key={col.name}
                        size="small"
                        variant="outlined"
                        label={`${col.name}: ${col.data_type}`}
                      />
                    ))}
                  </Box>
                </Paper>
              ))}
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ mt: 2 }}>
              No schema information available
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseSchema}>Close</Button>
        </DialogActions>
      </Dialog>

      {error && (
        <Alert
          severity="error"
          onClose={handleDismissError}
          sx={{ position: 'fixed', bottom: 16, right: 16, maxWidth: 400 }}
        >
          {error}
        </Alert>
      )}
    </ConnPageContainer>
  )
}

