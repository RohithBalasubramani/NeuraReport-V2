import * as nl2sqlApi from '@/api/intelligence'
import * as api from '@/api/client'
import { neutral, palette } from '@/app/theme'
import { SendToMenu, useToast } from '@/components/core'
import { DataTable } from '@/components/data'
import { InteractionType, Reversibility, useConfirmedAction, useInteraction } from '@/components/governance'
import { ConfirmModal } from '@/components/modals'
import { AiUsageNotice, DisabledTooltip } from '@/components/ux'
import { useCrossPageActions } from '@/hooks/hooks'
import { useAppStore } from '@/stores/app'
import { useConnectionStore } from '@/stores/content'
import { useFederationStore, useQueryStore } from '@/stores/workspace'
import { GlassCard, GlassDialog as StyledDialog, PaddedPageContainer as PageContainer, StyledFormControl, fadeInUp } from '@/styles/styles'
import { FeatureKey, OutputType, getWriteOperation } from '@/utils/helpers'
import {
  Add as AddIcon,
  AutoAwesome as AIIcon,
  Delete as DeleteIcon,
  JoinInner as JoinIcon,
  Link as LinkIcon,
  PlayArrow as RunIcon,
  Storage as DatabaseIcon,
} from '@mui/icons-material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import BookmarkIcon from '@mui/icons-material/Bookmark'
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import HistoryIcon from '@mui/icons-material/History'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import SaveIcon from '@mui/icons-material/Save'
import StorageIcon from '@mui/icons-material/Storage'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import React, { useCallback, useEffect, useRef, useState } from 'react'
export function SchemaBuilderPage() {
  const {
    schemas,
    currentSchema,
    joinSuggestions,
    queryResult,
    loading,
    error,
    fetchSchemas,
    createSchema,
    deleteSchema,
    suggestJoins,
    executeQuery,
    setCurrentSchema,
    reset,
  } = useFederationStore();

  const { connections, fetchConnections } = useConnectionStore();
  const confirmWriteQuery = useConfirmedAction('EXECUTE_WRITE_QUERY');
  const { execute } = useInteraction();
  const { registerOutput } = useCrossPageActions(FeatureKey.FEDERATION);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newSchemaName, setNewSchemaName] = useState('');
  const [newSchemaDescription, setNewSchemaDescription] = useState('');
  const [selectedConnections, setSelectedConnections] = useState([]);
  const [queryInput, setQueryInput] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, schemaId: null, schemaName: '' });

  const [initialLoading, setInitialLoading] = useState(true);
  const writeOperation = getWriteOperation(queryInput);

  useEffect(() => {
    const init = async () => {
      setInitialLoading(true);
      await Promise.all([fetchSchemas(), fetchConnections()]);
      setInitialLoading(false);
    };
    init();
    return () => reset();
  }, [fetchSchemas, fetchConnections, reset]);

  const handleCreateSchema = async () => {
    if (!newSchemaName || selectedConnections.length < 2) return;
    await execute({
      type: InteractionType.CREATE,
      label: 'Create federation schema',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        connectionIds: selectedConnections,
        action: 'create_federation_schema',
      },
      action: async () => {
        const result = await createSchema({
          name: newSchemaName,
          connectionIds: selectedConnections,
          description: newSchemaDescription,
        });
        if (!result) {
          throw new Error('Create schema failed');
        }
        setCreateDialogOpen(false);
        setNewSchemaName('');
        setNewSchemaDescription('');
        setSelectedConnections([]);
        return result;
      },
    });
  };

  const handleSuggestJoins = async () => {
    if (!currentSchema) return;
    await execute({
      type: InteractionType.GENERATE,
      label: 'Suggest joins',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        schemaId: currentSchema.id,
        action: 'suggest_joins',
      },
      action: async () => {
        const result = await suggestJoins(); // Store gets connections from currentSchema
        if (!result) {
          throw new Error('Suggest joins failed');
        }
        return result;
      },
    });
  };

  const runExecuteQuery = useCallback(async () => {
    if (!currentSchema || !queryInput.trim()) return;
    await execute({
      type: InteractionType.EXECUTE,
      label: 'Run federated query',
      reversibility: writeOperation ? Reversibility.IRREVERSIBLE : Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        schemaId: currentSchema.id,
        action: 'execute_federation_query',
        writeOperation,
      },
      action: async () => {
        const result = await executeQuery(currentSchema.id, queryInput);
        if (!result) {
          throw new Error('Query execution failed');
        }
        // Register query result for cross-page use
        const rows = result.rows || [];
        const columns = rows.length > 0 ? Object.keys(rows[0]).map((k) => ({ name: k })) : [];
        registerOutput({
          type: OutputType.TABLE,
          title: `Federation: ${currentSchema.name || 'Query'} (${rows.length} rows)`,
          summary: queryInput.slice(0, 100),
          data: { columns, rows },
          format: 'table',
        });
        return result;
      },
    });
  }, [currentSchema, executeQuery, queryInput, execute, writeOperation, registerOutput]);

  const handleExecuteQuery = useCallback(async () => {
    if (!currentSchema || !queryInput.trim()) return;
    if (writeOperation) {
      confirmWriteQuery(currentSchema.name || currentSchema.id || 'selected schema', runExecuteQuery);
      return;
    }
    await runExecuteQuery();
  }, [confirmWriteQuery, currentSchema, queryInput, runExecuteQuery, writeOperation]);

  const handleDeleteRequest = useCallback((schema) => {
    setDeleteConfirm({
      open: true,
      schemaId: schema?.id || null,
      schemaName: schema?.name || 'this schema',
    });
  }, []);

  const handleDeleteSchemaConfirm = async () => {
    const schemaId = deleteConfirm.schemaId;
    const schemaName = deleteConfirm.schemaName;
    setDeleteConfirm({ open: false, schemaId: null, schemaName: '' });
    if (!schemaId) return;
    await execute({
      type: InteractionType.DELETE,
      label: 'Delete federation schema',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        schemaId,
        schemaName,
        action: 'delete_federation_schema',
      },
      action: async () => {
        const result = await deleteSchema(schemaId);
        if (!result) {
          throw new Error('Delete schema failed');
        }
        return result;
      },
    });
  };

  const toggleConnection = (connId) => {
    setSelectedConnections(prev =>
      prev.includes(connId)
        ? prev.filter(id => id !== connId)
        : [...prev, connId]
    );
  };

  // Show loading during initial fetch
  if (initialLoading) {
    return (
      <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <JoinIcon />
          <Typography variant="h5">Cross-Database Federation</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <JoinIcon /> Cross-Database Federation
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Create virtual schemas to query across multiple databases
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          New Virtual Schema
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => reset()}>
          {error}
        </Alert>
      )}

      <AiUsageNotice
        title="AI join suggestions"
        description="Join suggestions are generated from schema metadata. Review before running cross-database queries."
        chips={[
          { label: 'Source: Selected schemas', variant: 'outlined' },
          { label: 'Confidence: Provided per suggestion', variant: 'outlined' },
          { label: 'Read-only recommended', variant: 'outlined' },
        ]}
        dense
        sx={{ mb: 2 }}
      />

      <Grid container spacing={3}>
        {/* Schema List */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Virtual Schemas
            </Typography>
            {schemas.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                No virtual schemas yet. Create one to get started.
              </Typography>
            ) : (
              <List>
                {schemas.map((schema) => (
                  <ListItem
                    key={schema.id}
                    button
                    selected={currentSchema?.id === schema.id}
                    onClick={() => setCurrentSchema(schema)}
                    secondaryAction={
                      <Tooltip title="Delete schema">
                        <IconButton
                          edge="end"
                          aria-label={`Delete ${schema.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRequest(schema);
                          }}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    }
                  >
                    <ListItemIcon>
                      <DatabaseIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary={schema.name}
                      secondary={`${schema.connections?.length || 0} databases`}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        {/* Schema Details & Query */}
        <Grid size={{ xs: 12, md: 8 }}>
          {currentSchema ? (
            <Paper sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">{currentSchema.name}</Typography>
                <Button
                  variant="outlined"
                  startIcon={loading ? <CircularProgress size={20} /> : <AIIcon />}
                  onClick={handleSuggestJoins}
                  disabled={loading}
                >
                  AI Join Suggestions
                </Button>
              </Box>

              {currentSchema.description && (
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                  {currentSchema.description}
                </Typography>
              )}

              <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
                {(currentSchema.connections || []).map((conn, idx) => (
                  <Chip
                    key={idx}
                    icon={<DatabaseIcon />}
                    label={conn.name || conn}
                    variant="outlined"
                  />
                ))}
              </Box>

              {/* Join Suggestions */}
              {joinSuggestions.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" gutterBottom>
                    Suggested Joins
                  </Typography>
                  <Grid container spacing={2}>
                    {joinSuggestions.map((suggestion, idx) => (
                      <Grid size={{ xs: 12, sm: 6 }} key={idx}>
                        <Card variant="outlined">
                          <CardContent sx={{ py: 1.5 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                              <LinkIcon sx={{ color: 'text.secondary' }} />
                              <Typography variant="subtitle2">
                                {suggestion.left_table} ↔ {suggestion.right_table}
                              </Typography>
                            </Box>
                            <Typography variant="body2" color="text.secondary">
                              {suggestion.left_column} = {suggestion.right_column}
                            </Typography>
                            {suggestion.reason && (
                              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                                {suggestion.reason}
                              </Typography>
                            )}
                            <Chip
                              size="small"
                              label={`${Math.round((suggestion.confidence || 0) * 100)}% confidence`}
                              sx={{ mt: 1, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                            />
                          </CardContent>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              )}

              <Divider sx={{ my: 2 }} />

              {/* Query Input */}
              <Typography variant="subtitle1" gutterBottom>
                Federated Query
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={4}
                placeholder="SELECT * FROM db1.users u JOIN db2.orders o ON u.id = o.user_id"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                sx={{ mb: 2, fontFamily: 'monospace' }}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                <Chip
                  size="small"
                  label="Read-only recommended"
                  variant="outlined"
                  sx={{ fontSize: '12px' }}
                />
                {writeOperation && (
                  <Chip
                    size="small"
                    label={`${writeOperation.toUpperCase()} detected`}
                    sx={{ fontSize: '12px', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                  />
                )}
              </Box>
              <Button
                variant="contained"
                startIcon={loading ? <CircularProgress size={20} /> : <RunIcon />}
                onClick={handleExecuteQuery}
                disabled={!queryInput.trim() || loading}
              >
                Execute Query
              </Button>
              {writeOperation && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  Write queries can modify data and may not be reversible. You will be asked to confirm before execution.
                </Alert>
              )}

              {/* Query Results */}
              {queryResult && (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="subtitle1" gutterBottom>
                    Results ({queryResult.rows?.length || 0} rows)
                  </Typography>
                  <Box sx={{ overflowX: 'auto' }}>
                    <pre style={{ fontSize: 12, margin: 0 }}>
                      {JSON.stringify(queryResult, null, 2)}
                    </pre>
                  </Box>
                </Box>
              )}
            </Paper>
          ) : (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <DatabaseIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
              <Typography color="text.secondary">
                Select a virtual schema or create a new one to get started
              </Typography>
            </Paper>
          )}
        </Grid>
      </Grid>

      {/* Create Schema Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Virtual Schema</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Schema Name"
            value={newSchemaName}
            onChange={(e) => setNewSchemaName(e.target.value)}
            sx={{ mt: 2, mb: 2 }}
          />
          <TextField
            fullWidth
            label="Description"
            value={newSchemaDescription}
            onChange={(e) => setNewSchemaDescription(e.target.value)}
            multiline
            rows={2}
            sx={{ mb: 2 }}
          />
          <Typography variant="subtitle2" gutterBottom>
            Select Databases (minimum 2)
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {connections.map((conn) => (
              <Card
                key={conn.id}
                variant="outlined"
                sx={{
                  cursor: 'pointer',
                  borderColor: selectedConnections.includes(conn.id) ? 'text.secondary' : 'divider',
                  bgcolor: selectedConnections.includes(conn.id) ? 'action.selected' : 'background.paper',
                }}
                onClick={() => toggleConnection(conn.id)}
              >
                <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <DatabaseIcon />
                      <Typography>{conn.name}</Typography>
                    </Box>
                    {selectedConnections.includes(conn.id) && (
                      <Chip label="Selected" size="small" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
                    )}
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateSchema}
            disabled={!newSchemaName || selectedConnections.length < 2}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmModal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, schemaId: null, schemaName: '' })}
        onConfirm={handleDeleteSchemaConfirm}
        title="Delete Virtual Schema"
        message={`Delete "${deleteConfirm.schemaName}"? This will remove the virtual schema and its saved join logic.`}
        confirmLabel="Delete"
        severity="error"
      />
    </Box>
  );
}

// === From: query.jsx ===
/**
 * Premium Query Builder Page
 * Natural language to SQL interface with theme-based styling
 */

// UX Components for premium interactions
// UX Governance - Enforced interaction API


const HeaderContainer = styled(Stack)(({ theme }) => ({
  marginBottom: theme.spacing(3),
  animation: `${fadeInUp} 0.5s ease-out`,
}))

const HeaderButton = styled(Button)(({ theme }) => ({
  borderRadius: 12,
  textTransform: 'none',
  fontWeight: 500,
  borderColor: alpha(theme.palette.divider, 0.2),
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
}))

const PrimaryButton = styled(Button)(({ theme }) => ({
  borderRadius: 12,
  textTransform: 'none',
  fontWeight: 600,
  background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  color: theme.palette.common.white,
  boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
    transform: 'translateY(-1px)',
  },
  '&:active': {
    transform: 'translateY(0)',
  },
  '&:disabled': {
    background: alpha(theme.palette.text.disabled, 0.2),
    color: theme.palette.text.disabled,
    boxShadow: 'none',
  },
}))

const ExecuteButton = styled(Button)(({ theme }) => ({
  borderRadius: 12,
  textTransform: 'none',
  fontWeight: 600,
  background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
  color: theme.palette.common.white,
  boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[500],
    boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
    transform: 'translateY(-1px)',
  },
  '&:disabled': {
    background: alpha(theme.palette.text.disabled, 0.2),
    color: theme.palette.text.disabled,
    boxShadow: 'none',
  },
}))

const StyledTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: 12,
    backgroundColor: alpha(theme.palette.background.default, 0.5),
    transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
    '&:hover': {
      backgroundColor: alpha(theme.palette.background.default, 0.7),
    },
    '&.Mui-focused': {
      backgroundColor: alpha(theme.palette.background.default, 0.9),
      boxShadow: `0 0 0 3px ${alpha(theme.palette.text.primary, 0.08)}`,
    },
  },
}))

const SavedQueryItem = styled(Stack)(({ theme }) => ({
  padding: theme.spacing(1),
  borderRadius: 10,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    transform: 'translateX(4px)',
  },
}))

const HistoryItem = styled(Stack)(({ theme }) => ({
  padding: theme.spacing(1),
  borderRadius: 10,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    transform: 'translateX(4px)',
  },
}))

const ExplanationBox = styled(Box)(({ theme }) => ({
  marginTop: theme.spacing(2),
  padding: theme.spacing(1.5),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  borderRadius: 12,
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
}))

const ConfidenceChip = styled(Chip)(({ theme, confidence }) => ({
  height: 20,
  fontSize: '12px',
  fontWeight: 600,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
  color: theme.palette.text.secondary,
  borderRadius: 6,
}))

export function QueryBuilderPage() {
  const theme = useTheme()
  const toast = useToast()
  // UX Governance: Enforced interaction API - ALL user actions flow through this
  const { execute } = useInteraction()
  const confirmWriteQuery = useConfirmedAction('EXECUTE_WRITE_QUERY')
  const { registerOutput } = useCrossPageActions(FeatureKey.QUERY)
  const connections = useAppStore((s) => s.savedConnections)
  const {
    currentQuestion,
    generatedSQL,
    explanation,
    confidence,
    warnings,
    results,
    columns,
    totalCount,
    executionTimeMs,
    includeTotal,
    isGenerating,
    isExecuting,
    error,
    selectedConnectionId,
    savedQueries,
    queryHistory,
    setCurrentQuestion,
    setGeneratedSQL,
    setSelectedConnection,
    setGenerationResult,
    setExecutionResult,
    setError,
    setIsGenerating,
    setIsExecuting,
    clearResults,
    clearAll,
    setSavedQueries,
    addSavedQuery,
    removeSavedQuery,
    setIncludeTotal,
    setQueryHistory,
    loadSavedQuery,
  } = useQueryStore()

  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [schema, setSchema] = useState(null)
  const [deleteSavedConfirm, setDeleteSavedConfirm] = useState({ open: false, queryId: null, queryName: '' })
  const [deleteHistoryConfirm, setDeleteHistoryConfirm] = useState({ open: false, entryId: null, question: '' })
  const schemaRequestIdRef = useRef(0)
  const writeOperation = getWriteOperation(generatedSQL)
  const selectedConnectionLabel = connections.find((conn) => conn.id === selectedConnectionId)?.name
    || (selectedConnectionId ? 'Selected connection' : 'No connection selected')
  const connectionLabelId = 'query-builder-connection-label'

  // Fetch connections on mount
  useEffect(() => {
    const fetchConnections = async () => {
      try {
        const { connections: conns } = await api.listConnections()
        useAppStore.getState().setSavedConnections(conns || [])
      } catch (err) {
        console.error('Failed to fetch connections:', err)
        toast.show('Failed to load connections. Please refresh the page.', 'error')
      }
    }
    fetchConnections()
  }, [toast])

  // Fetch schema when connection changes
  useEffect(() => {
    if (!selectedConnectionId) {
      setSchema(null)
      return
    }

    // Increment request ID to track this specific request
    const requestId = ++schemaRequestIdRef.current

    const fetchSchema = async () => {
      try {
        const result = await api.getConnectionSchema(selectedConnectionId)
        // Only update state if this is still the latest request
        if (requestId === schemaRequestIdRef.current) {
          setSchema(result)
        }
      } catch (err) {
        // Only log error if this is still the latest request
        if (requestId === schemaRequestIdRef.current) {
          console.error('Failed to fetch schema:', err)
          toast.show('Failed to load database schema', 'warning')
        }
      }
    }
    fetchSchema()
  }, [selectedConnectionId, toast])

  // Fetch saved queries on mount
  useEffect(() => {
    const fetchSaved = async () => {
      try {
        const { queries } = await nl2sqlApi.listSavedQueries()
        setSavedQueries(queries || [])
      } catch (err) {
        console.error('Failed to fetch saved queries:', err)
      }
    }
    fetchSaved()
  }, [setSavedQueries])

  // Fetch history on mount
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const { history } = await nl2sqlApi.getQueryHistory({ limit: 50 })
        setQueryHistory(history || [])
      } catch (err) {
        console.error('Failed to fetch history:', err)
      }
    }
    fetchHistory()
  }, [setQueryHistory])

  const handleGenerate = useCallback(() => {
    if (!currentQuestion.trim() || !selectedConnectionId) return

    // UX Governance: Generate action with tracking
    execute({
      type: InteractionType.GENERATE,
      label: 'Generate SQL query',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      action: async () => {
        setIsGenerating(true)
        setError(null)
        clearResults()

        try {
          const result = await nl2sqlApi.generateSQL({
            question: currentQuestion,
            connectionId: selectedConnectionId,
          })

          setGenerationResult({
            sql: result.sql,
            explanation: result.explanation,
            confidence: result.confidence,
            warnings: result.warnings,
            originalQuestion: result.original_question,
          })
        } catch (err) {
          const errorMsg = err.response?.data?.message || err.message || 'Failed to generate SQL'
          setError(errorMsg)
          throw new Error(errorMsg)
        } finally {
          setIsGenerating(false)
        }
      },
    })
  }, [currentQuestion, selectedConnectionId, setIsGenerating, setError, clearResults, setGenerationResult, execute])

  const runExecute = useCallback(() => {
    // UX Governance: Execute action with tracking and navigation blocking
    execute({
      type: InteractionType.EXECUTE,
      label: 'Execute SQL query',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      successMessage: 'Query executed successfully',
      action: async () => {
        setIsExecuting(true)
        setError(null)

        try {
          const result = await nl2sqlApi.executeQuery({
            sql: generatedSQL,
            connectionId: selectedConnectionId,
            limit: 100,
            includeTotal,
          })

          setExecutionResult({
            columns: result.columns,
            rows: result.rows,
            rowCount: result.row_count,
            totalCount: result.total_count,
            executionTimeMs: result.execution_time_ms,
            truncated: result.truncated,
          })
          registerOutput({
            type: OutputType.TABLE,
            title: `Query: ${currentQuestion.substring(0, 60)}`,
            summary: `${result.row_count} rows, ${result.columns?.length || 0} columns`,
            data: { columns: result.columns, rows: result.rows },
            format: 'table',
          })
          toast.show(`Query returned ${result.row_count} rows`, 'success')
        } catch (err) {
          const errorMsg = err.response?.data?.detail || err.response?.data?.message || err.message || 'Failed to execute query'
          setError(errorMsg)
          throw new Error(errorMsg)
        } finally {
          setIsExecuting(false)
        }
      },
    })
  }, [execute, generatedSQL, includeTotal, selectedConnectionId, setError, setExecutionResult, setIsExecuting, toast])

  const handleExecute = useCallback(() => {
    if (!generatedSQL.trim() || !selectedConnectionId) return

    if (writeOperation) {
      const selectedConnection = connections.find((conn) => conn.id === selectedConnectionId)
      const targetLabel = selectedConnection?.name || selectedConnectionId || 'selected connection'
      confirmWriteQuery(targetLabel, runExecute)
      return
    }

    runExecute()
  }, [confirmWriteQuery, connections, generatedSQL, runExecute, selectedConnectionId, writeOperation])

  const handleSave = useCallback(() => {
    if (!saveName.trim() || !generatedSQL.trim() || !selectedConnectionId) return

    // UX Governance: Create action with tracking
    execute({
      type: InteractionType.CREATE,
      label: `Save query "${saveName}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: 'Query saved successfully',
      errorMessage: 'Failed to save query',
      action: async () => {
        const result = await nl2sqlApi.saveQuery({
          name: saveName,
          sql: generatedSQL,
          connectionId: selectedConnectionId,
          description: saveDescription || undefined,
          originalQuestion: currentQuestion || undefined,
        })

        addSavedQuery(result.query)
        setShowSaveDialog(false)
        setSaveName('')
        setSaveDescription('')
      },
    })
  }, [saveName, saveDescription, generatedSQL, selectedConnectionId, currentQuestion, addSavedQuery, execute])

  const handleDeleteSaved = useCallback(
    (queryId) => {
      // UX Governance: Delete action with tracking
      execute({
        type: InteractionType.DELETE,
        label: 'Delete saved query',
        reversibility: Reversibility.IRREVERSIBLE,
        successMessage: 'Query deleted',
        errorMessage: 'Failed to delete query',
        action: async () => {
          await nl2sqlApi.deleteSavedQuery(queryId)
          removeSavedQuery(queryId)
        },
      })
    },
    [removeSavedQuery, execute]
  )

  const handleDeleteHistory = useCallback(
    (entryId) => {
      if (!entryId) return
      // UX Governance: Delete action with tracking
      execute({
        type: InteractionType.DELETE,
        label: 'Delete history entry',
        reversibility: Reversibility.IRREVERSIBLE,
        successMessage: 'History entry deleted',
        errorMessage: 'Failed to delete history entry',
        action: async () => {
          await nl2sqlApi.deleteQueryHistoryEntry(entryId)
          const current = useQueryStore.getState().queryHistory
          setQueryHistory(current.filter((entry) => entry.id !== entryId))
        },
      })
    },
    [setQueryHistory, execute]
  )

  const handleCopySQL = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedSQL)
      toast.show('SQL copied to clipboard', 'success')
    } catch (err) {
      toast.show('Failed to copy to clipboard', 'error')
    }
  }, [generatedSQL, toast])

  const tableColumns = columns.map((col) => ({
    field: col,
    header: col,
    sortable: true,
  }))

  const executeDisabledReason = !generatedSQL.trim()
    ? 'Generate SQL before executing'
    : !selectedConnectionId
      ? 'Select a connection first'
      : null

  return (
    <PageContainer>
      {/* Header */}
      <HeaderContainer direction="row" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography variant="h5" fontWeight={600} sx={{ color: theme.palette.text.primary }}>
            Query Builder
          </Typography>
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
            Ask questions in natural language and get SQL queries
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <HeaderButton
            variant="outlined"
            size="small"
            startIcon={<BookmarkIcon />}
            onClick={() => setShowSaved(!showSaved)}
          >
            Saved ({savedQueries.length})
          </HeaderButton>
          <HeaderButton
            variant="outlined"
            size="small"
            startIcon={<HistoryIcon />}
            onClick={() => setShowHistory(!showHistory)}
          >
            History
          </HeaderButton>
        </Stack>
      </HeaderContainer>

      <AiUsageNotice
        title="AI query draft"
        description="AI turns questions into SQL using the selected connection's schema. Review the SQL before executing."
        chips={[
          { label: `Source: ${selectedConnectionLabel}`, variant: 'outlined' },
          { label: 'Confidence: Varies per query', variant: 'outlined' },
          { label: 'Read-only recommended', variant: 'outlined' },
        ]}
        dense
        sx={{ mb: 2 }}
      />

      {/* Saved Queries Panel */}
      <Collapse in={showSaved}>
        <GlassCard>
          <Typography variant="subtitle2" sx={{ color: theme.palette.text.secondary, mb: 1 }}>
            Saved Queries
          </Typography>
          {savedQueries.length === 0 ? (
            <Typography variant="body2" sx={{ color: theme.palette.text.disabled }}>
              No saved queries yet
            </Typography>
          ) : (
            <Stack spacing={1}>
              {savedQueries.slice(0, 5).map((q) => (
                <SavedQueryItem
                  key={q.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Box sx={{ flex: 1 }} onClick={() => loadSavedQuery(q)}>
                    <Typography variant="body2" fontWeight={500} sx={{ color: theme.palette.text.primary }}>
                      {q.name}
                    </Typography>
                    {q.description && (
                      <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                        {q.description}
                      </Typography>
                    )}
                  </Box>
                  <Tooltip title="Delete saved query">
                    <IconButton
                      size="small"
                      onClick={() => setDeleteSavedConfirm({ open: true, queryId: q.id, queryName: q.name })}
                      aria-label="Delete saved query"
                    >
                      <DeleteIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                    </IconButton>
                  </Tooltip>
                </SavedQueryItem>
              ))}
            </Stack>
          )}
        </GlassCard>
      </Collapse>

      {/* History Panel */}
      <Collapse in={showHistory}>
        <GlassCard>
          <Typography variant="subtitle2" sx={{ color: theme.palette.text.secondary, mb: 1 }}>
            Recent Queries
          </Typography>
          {queryHistory.length === 0 ? (
            <Typography variant="body2" sx={{ color: theme.palette.text.disabled }}>
              No query history yet
            </Typography>
          ) : (
            <Stack spacing={1}>
              {queryHistory.slice(0, 5).map((h) => (
                <HistoryItem
                  key={h.id}
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  onClick={() => {
                    setCurrentQuestion(h.question)
                    setGeneratedSQL(h.sql)
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ color: theme.palette.text.primary }} noWrap>
                      {h.question}
                    </Typography>
                    <Stack direction="row" spacing={1} mt={0.5}>
                      <ConfidenceChip
                        size="small"
                        label={`${Math.round(h.confidence * 100)}%`}
                        confidence={h.confidence}
                      />
                      {h.success ? (
                        <Chip
                          size="small"
                          label="Success"
                          sx={{
                            height: 20,
                            fontSize: '12px',
                            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
                            color: theme.palette.text.secondary,
                            borderRadius: 1.5,
                          }}
                        />
                      ) : (
                        <Chip
                          size="small"
                          label="Failed"
                          sx={{
                            height: 20,
                            fontSize: '12px',
                            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
                            color: theme.palette.text.secondary,
                            borderRadius: 1.5,
                          }}
                        />
                      )}
                    </Stack>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteHistoryConfirm({ open: true, entryId: h.id, question: h.question })
                    }}
                  >
                    <DeleteIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                  </IconButton>
                </HistoryItem>
              ))}
            </Stack>
          )}
        </GlassCard>
      </Collapse>

      {/* Connection Selector */}
      <GlassCard>
        <StyledFormControl fullWidth size="small">
          <InputLabel id={connectionLabelId}>Database Connection</InputLabel>
          <Select
            value={selectedConnectionId || ''}
            label="Database Connection"
            labelId={connectionLabelId}
            id="query-builder-connection-select"
            onChange={(e) => setSelectedConnection(e.target.value)}
            startAdornment={<StorageIcon sx={{ mr: 1, color: theme.palette.text.secondary }} />}
          >
            {connections.map((conn) => (
              <MenuItem key={conn.id} value={conn.id}>
                {conn.name || conn.database_path}
              </MenuItem>
            ))}
          </Select>
        </StyledFormControl>

        {schema && (
          <Box mt={2}>
            <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
              Available tables: {schema.tables?.map((t) => t.name).join(', ')}
            </Typography>
          </Box>
        )}
      </GlassCard>

      {/* Question Input */}
      <GlassCard>
        <StyledTextField
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          placeholder="Ask a question about your data... (e.g., 'Show me all customers who made purchases last month')"
          value={currentQuestion}
          onChange={(e) => setCurrentQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              handleGenerate()
            }
          }}
        />
        <Stack direction="row" justifyContent="space-between" alignItems="center" mt={2}>
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
            Press Ctrl+Enter to generate
          </Typography>
          <PrimaryButton
            startIcon={isGenerating ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
            onClick={handleGenerate}
            disabled={!currentQuestion.trim() || !selectedConnectionId || isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Generate SQL'}
          </PrimaryButton>
        </Stack>
      </GlassCard>

      {/* Error Alert */}
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2, borderRadius: 1 }}  // Figma spec: 8px
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {/* Generated SQL */}
      {generatedSQL && (
        <GlassCard>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle2" sx={{ color: theme.palette.text.secondary }}>
                Generated SQL
              </Typography>
              {confidence > 0 && (
                <ConfidenceChip
                  size="small"
                  label={`${Math.round(confidence * 100)}% confidence`}
                  confidence={confidence}
                />
              )}
            </Stack>
            <Stack direction="row" spacing={1}>
              <Tooltip title="Copy SQL">
                <IconButton size="small" onClick={handleCopySQL} aria-label="Copy SQL">
                  <ContentCopyIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Save Query">
                <IconButton size="small" onClick={() => setShowSaveDialog(true)} aria-label="Save Query">
                  <SaveIcon fontSize="small" sx={{ color: theme.palette.text.secondary }} />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          <StyledTextField
            fullWidth
            multiline
            minRows={3}
            maxRows={10}
            value={generatedSQL}
            onChange={(e) => setGeneratedSQL(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              },
            }}
          />

          {warnings.length > 0 && (
            <Stack spacing={0.5} mt={1}>
              {warnings.map((w, i) => (
                <Alert key={i} severity="warning" sx={{ py: 0, borderRadius: 1 }}>
                  {w}
                </Alert>
              ))}
            </Stack>
          )}

          {explanation && (
            <ExplanationBox>
              <Stack direction="row" alignItems="flex-start" spacing={1}>
                <LightbulbIcon sx={{ color: theme.palette.text.secondary, fontSize: 18, mt: 0.25 }} />
                <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                  {explanation}
                </Typography>
              </Stack>
            </ExplanationBox>
          )}

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
            mt={2}
            spacing={1.5}
          >
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={includeTotal}
                  onChange={(event) => setIncludeTotal(event.target.checked)}
                />
              }
              label="Include total row count (slower)"
              sx={{ color: theme.palette.text.secondary }}
            />
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Chip
                size="small"
                label="Read-only recommended"
                variant="outlined"
                sx={{ fontSize: '12px' }}
              />
              {writeOperation && (
                <Chip
                  size="small"
                  label={`${writeOperation.toUpperCase()} detected`}
                  sx={{ fontSize: '12px', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                />
              )}
            </Stack>
            {/* UX: DisabledTooltip explains WHY the button is disabled */}
            <DisabledTooltip
              disabled={Boolean(executeDisabledReason) || isExecuting}
              reason={
                isExecuting
                  ? 'Query is currently running...'
                  : executeDisabledReason
              }
              hint={
                !selectedConnectionId
                  ? 'Select a database from the dropdown above'
                  : !generatedSQL.trim()
                    ? 'Enter a question and click Generate first'
                    : undefined
              }
            >
              <ExecuteButton
                startIcon={isExecuting ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                onClick={handleExecute}
                disabled={Boolean(executeDisabledReason) || isExecuting}
              >
                {isExecuting ? 'Executing...' : 'Execute Query'}
              </ExecuteButton>
            </DisabledTooltip>
          </Stack>
          {writeOperation && (
            <Alert severity="warning" sx={{ mt: 1.5, borderRadius: 1 }}>
              Write queries can modify data and may not be reversible. You will be asked to confirm before execution.
            </Alert>
          )}
        </GlassCard>
      )}

      {/* Results */}
      {results && (
        <GlassCard>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle2" sx={{ color: theme.palette.text.secondary }}>
                Results
              </Typography>
              <SendToMenu
                outputType={OutputType.TABLE}
                payload={{
                  title: `Query: ${currentQuestion.substring(0, 60)}`,
                  content: JSON.stringify({ columns, rows: results }),
                  data: { columns, rows: results },
                }}
                sourceFeature={FeatureKey.QUERY}
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              {totalCount !== null && (
                <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                  {totalCount} total rows
                </Typography>
              )}
              {executionTimeMs !== null && (
                <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                  {executionTimeMs}ms
                </Typography>
              )}
            </Stack>
          </Stack>

          <DataTable columns={tableColumns} data={results} pageSize={10} loading={false} />
        </GlassCard>
      )}

      {/* Save Dialog */}
      <StyledDialog open={showSaveDialog} onClose={() => setShowSaveDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ color: theme.palette.text.primary }}>Save Query</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <StyledTextField
              fullWidth
              label="Name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g., Monthly Sales Report"
            />
            <StyledTextField
              fullWidth
              multiline
              rows={2}
              label="Description (optional)"
              value={saveDescription}
              onChange={(e) => setSaveDescription(e.target.value)}
              placeholder="What does this query do?"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button
            onClick={() => setShowSaveDialog(false)}
            sx={{ borderRadius: 1, textTransform: 'none' }}  // Figma spec: 8px
          >
            Cancel
          </Button>
          <PrimaryButton onClick={handleSave} disabled={!saveName.trim()}>
            Save
          </PrimaryButton>
        </DialogActions>
      </StyledDialog>

      <ConfirmModal
        open={deleteSavedConfirm.open}
        onClose={() => setDeleteSavedConfirm({ open: false, queryId: null, queryName: '' })}
        onConfirm={() => {
          handleDeleteSaved(deleteSavedConfirm.queryId)
          setDeleteSavedConfirm({ open: false, queryId: null, queryName: '' })
        }}
        title="Delete Saved Query"
        message={`Are you sure you want to delete "${deleteSavedConfirm.queryName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        severity="error"
      />

      <ConfirmModal
        open={deleteHistoryConfirm.open}
        onClose={() => setDeleteHistoryConfirm({ open: false, entryId: null, question: '' })}
        onConfirm={() => {
          handleDeleteHistory(deleteHistoryConfirm.entryId)
          setDeleteHistoryConfirm({ open: false, entryId: null, question: '' })
        }}
        title="Delete History Entry"
        message={`Are you sure you want to delete this history entry? "${deleteHistoryConfirm.question?.substring(0, 50)}${deleteHistoryConfirm.question?.length > 50 ? '...' : ''}"`}
        confirmLabel="Delete"
        severity="warning"
      />
    </PageContainer>
  )
}
