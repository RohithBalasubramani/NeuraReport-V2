import { getReportHistory } from '@/api/client'
import { extractDocument as extractSynthesisDocument } from '@/api/intelligence'
import { neutral, palette } from '@/app/theme'
import { ConnectionSelector, SendToMenu, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { ConfirmModal } from '@/components/modals'
import { AiUsageNotice, DisabledTooltip } from '@/components/ux'
import { useCrossPageActions, useSharedData } from '@/hooks/hooks'
import { useSummaryStore, useSynthesisStore } from '@/stores/content'
import { FeatureKey, OutputType } from '@/utils/helpers'
import {
  Add as AddIcon,
  AutoAwesome as SummaryIcon,
  AutoAwesome as SynthesizeIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Description as DocIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  History as HistoryIcon,
  Merge as MergeIcon,
  Preview as PreviewIcon,
  Schedule as ScheduleIcon,
  Upload as UploadIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
  Grid,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import React, { useCallback, useEffect, useState } from 'react'
const TONE_OPTIONS = [
  { value: 'formal', label: 'Formal', description: 'Professional, business-appropriate tone' },
  { value: 'conversational', label: 'Conversational', description: 'Friendly, easy-to-read tone' },
  { value: 'technical', label: 'Technical', description: 'Detailed, precise terminology' },
];

const FOCUS_SUGGESTIONS = [
  'Key findings',
  'Financial metrics',
  'Trends',
  'Recommendations',
  'Risks',
  'Opportunities',
  'Performance',
  'Growth',
];

export function SummaryPage() {
  const {
    summary,
    history,
    loading,
    error,
    generateSummary,
    queueSummary,
    clearSummary,
    clearHistory,
    reset,
  } = useSummaryStore();

  const { connections, activeConnectionId } = useSharedData();
  const { registerOutput } = useCrossPageActions(FeatureKey.SUMMARY);

  const [content, setContent] = useState('');
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [tone, setTone] = useState('formal');
  const [maxSentences, setMaxSentences] = useState(5);
  const [focusAreas, setFocusAreas] = useState([]);
  const [customFocus, setCustomFocus] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  const [queueing, setQueueing] = useState(false);
  const [queuedJobId, setQueuedJobId] = useState(null);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [reportRuns, setReportRuns] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const toast = useToast();
  const navigate = useNavigateInteraction();
  const { execute } = useInteraction();
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { from: 'summary', ...intent } }),
    [navigate]
  );
  const executeUI = useCallback(
    (label, action, intent = {}) =>
      execute({
        type: InteractionType.EXECUTE,
        label,
        reversibility: Reversibility.FULLY_REVERSIBLE,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: { source: 'summary', ...intent },
        action,
      }),
    [execute]
  );

  useEffect(() => {
    return () => reset();
  }, [reset]);

  // Fetch recent report runs for "Load from Report" feature
  useEffect(() => {
    let cancelled = false;
    const fetchRuns = async () => {
      setLoadingReports(true);
      try {
        const result = await getReportHistory({ limit: 20, status: 'succeeded' });
        if (!cancelled) {
          setReportRuns(result?.history || []);
        }
      } catch (err) {
        console.error('Failed to fetch report runs:', err);
      } finally {
        if (!cancelled) setLoadingReports(false);
      }
    };
    fetchRuns();
    return () => { cancelled = true; };
  }, []);

  const handleGenerate = async () => {
    if (!content.trim()) return;
    setQueuedJobId(null);
    // Validate content length
    const trimmedContent = content.trim();
    if (trimmedContent.length < 50) {
      toast.show('Content is too short. Please provide at least 50 characters.', 'error');
      return;
    }
    if (trimmedContent.length > 50000) {
      toast.show('Content exceeds maximum length of 50,000 characters.', 'error');
      return;
    }
    await execute({
      type: InteractionType.GENERATE,
      label: 'Generate summary',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        action: 'generate_summary',
      },
      action: async () => {
        const result = await generateSummary({
          content: trimmedContent,
          tone,
          maxSentences,
          focusAreas: focusAreas.length > 0 ? focusAreas : undefined,
        });
        if (!result) {
          throw new Error('Summary generation failed');
        }
        registerOutput({
          type: OutputType.TEXT,
          title: `Executive Summary (${tone})`,
          summary: (typeof result === 'string' ? result : '').substring(0, 200),
          data: typeof result === 'string' ? result : JSON.stringify(result),
          format: 'text',
        });
        return result;
      },
    });
  };

  const handleQueue = async () => {
    if (!content.trim()) return;
    setQueuedJobId(null);
    // Validate content length
    const trimmedContent = content.trim();
    if (trimmedContent.length < 50) {
      toast.show('Content is too short. Please provide at least 50 characters.', 'error');
      return;
    }
    if (trimmedContent.length > 50000) {
      toast.show('Content exceeds maximum length of 50,000 characters.', 'error');
      return;
    }
    await execute({
      type: InteractionType.GENERATE,
      label: 'Queue summary',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        action: 'queue_summary',
      },
      action: async () => {
        setQueueing(true);
        try {
          const response = await queueSummary({
            content: trimmedContent,
            tone,
            maxSentences,
            focusAreas: focusAreas.length > 0 ? focusAreas : undefined,
          });
          if (response?.job_id) {
            setQueuedJobId(response.job_id);
            toast.show('Summary queued. Track progress in Jobs.', 'success');
          } else {
            toast.show('Failed to queue summary job.', 'error');
            throw new Error('Failed to queue summary job');
          }
          return response;
        } finally {
          setQueueing(false);
        }
      },
    });
  };

  const handleToggleHistory = useCallback(
    () =>
      executeUI('Toggle summary history', () => {
        setShowHistory((prev) => !prev);
      }),
    [executeUI]
  );

  const handleOpenClearHistory = useCallback(
    () =>
      executeUI('Open clear history confirmation', () => {
        setClearHistoryConfirmOpen(true);
      }),
    [executeUI]
  );

  const handleCloseClearHistory = useCallback(
    () =>
      executeUI('Close clear history confirmation', () => {
        setClearHistoryConfirmOpen(false);
      }),
    [executeUI]
  );

  const handleAddFocus = useCallback(
    (focus) =>
      executeUI(
        'Add focus area',
        () => {
          if (focusAreas.length < 5 && !focusAreas.includes(focus)) {
            setFocusAreas([...focusAreas, focus]);
          }
        },
        { focus }
      ),
    [executeUI, focusAreas]
  );

  const handleRemoveFocus = useCallback(
    (focus) =>
      executeUI(
        'Remove focus area',
        () => {
          setFocusAreas(focusAreas.filter((f) => f !== focus));
        },
        { focus }
      ),
    [executeUI, focusAreas]
  );

  const handleAddCustomFocus = useCallback(
    () =>
      executeUI('Add custom focus area', () => {
        const trimmed = customFocus.trim();
        if (trimmed && focusAreas.length < 5 && !focusAreas.includes(trimmed)) {
          setFocusAreas([...focusAreas, trimmed]);
          setCustomFocus('');
        }
      }),
    [customFocus, executeUI, focusAreas]
  );

  const handleCopy = useCallback(
    () =>
      executeUI('Copy summary to clipboard', async () => {
        if (summary) {
          await navigator.clipboard.writeText(summary);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }),
    [executeUI, summary]
  );

  const handleClearSummary = useCallback(
    () =>
      execute({
        type: InteractionType.DELETE,
        label: 'Clear summary output',
        reversibility: Reversibility.PARTIALLY_REVERSIBLE,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: { source: 'summary', action: 'clear_summary' },
        action: () => clearSummary(),
      }),
    [clearSummary, execute]
  );

  const handleLoadFromHistory = useCallback(
    (item) =>
      executeUI(
        'Load summary from history',
        () => {
          setContent(item.contentPreview.replace('...', ''));
          setTone(item.tone);
          setMaxSentences(item.maxSentences);
          setFocusAreas(item.focusAreas || []);
        },
        { historyId: item.id }
      ),
    [executeUI]
  );

  const handleClearHistory = useCallback(
    () =>
      execute({
        type: InteractionType.DELETE,
        label: 'Clear summary history',
        reversibility: Reversibility.IRREVERSIBLE,
        requiresConfirmation: true,
        intent: { source: 'summary', action: 'clear_history' },
        action: () => {
          clearHistory();
          setClearHistoryConfirmOpen(false);
        },
      }),
    [clearHistory, execute]
  );

  const handleDismissError = useCallback(
    () =>
      executeUI('Dismiss summary error', () => {
        reset();
      }),
    [executeUI, reset]
  );

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SummaryIcon /> Executive Summary Generator
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Generate concise executive summaries from your content using AI
          </Typography>
        </Box>
        {history.length > 0 && (
          <Button
            variant="outlined"
            startIcon={showHistory ? <ExpandLessIcon /> : <HistoryIcon />}
            onClick={handleToggleHistory}
          >
            History ({history.length})
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={handleDismissError}>
          {error}
        </Alert>
      )}

      {queuedJobId && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={(
            <Button size="small" onClick={() => handleNavigate('/jobs', 'Open jobs')} sx={{ textTransform: 'none' }}>
              View Jobs
            </Button>
          )}
        >
          Summary queued in background. Job ID: {queuedJobId}
        </Alert>
      )}

      <AiUsageNotice
        title="AI summary"
        description="Summaries are generated from the text you provide. Review for accuracy before sharing."
        chips={[
          { label: 'Source: Pasted content', color: 'info', variant: 'outlined' },
          { label: 'Confidence: Review required', color: 'warning', variant: 'outlined' },
          { label: 'Reversible: Output only', color: 'success', variant: 'outlined' },
        ]}
        dense
        sx={{ mb: 2 }}
      />

      {/* History Panel */}
      <Collapse in={showHistory}>
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Recent Summaries</Typography>
            <Button size="small" onClick={handleOpenClearHistory} sx={{ color: 'text.secondary' }}>
              Clear All
            </Button>
          </Box>
          <Grid container spacing={2}>
            {history.map((item) => (
              <Grid size={{ xs: 12, md: 6 }} key={item.id}>
                <Card variant="outlined" sx={{ cursor: 'pointer' }} onClick={() => handleLoadFromHistory(item)}>
                  <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(item.createdAt).toLocaleString()} - {item.tone}
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }} noWrap>
                      {item.summary?.substring(0, 150)}...
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Paper>
      </Collapse>

      <Grid container spacing={3}>
        {/* Input Section */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Typography variant="h6" gutterBottom>
              Content to Summarize
            </Typography>

            {/* Load from existing report runs */}
            {reportRuns.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Load from Report Run</InputLabel>
                  <Select
                    value=""
                    label="Load from Report Run"
                    onChange={(e) => {
                      const run = reportRuns.find((r) => r.id === e.target.value);
                      if (run) {
                        const parts = [
                          `Report: ${run.templateName || 'Unknown'}`,
                          run.startDate && run.endDate ? `Period: ${run.startDate} to ${run.endDate}` : null,
                          run.connectionName ? `Connection: ${run.connectionName}` : null,
                          run.keyValues && Object.keys(run.keyValues).length > 0
                            ? `Parameters: ${Object.entries(run.keyValues).map(([k, v]) => `${k}=${v}`).join(', ')}`
                            : null,
                          run.artifacts?.html_url ? `\nReport content available at: ${run.artifacts.html_url}` : null,
                        ].filter(Boolean);
                        setContent(parts.join('\n'));
                        toast.show(`Loaded report "${run.templateName}" context`, 'success');
                      }
                    }}
                  >
                    {reportRuns.map((run) => (
                      <MenuItem key={run.id} value={run.id}>
                        <Box>
                          <Typography variant="body2">{run.templateName || 'Unknown Report'}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {run.createdAt ? new Date(run.createdAt).toLocaleDateString() : ''}
                            {run.connectionName ? ` \u2022 ${run.connectionName}` : ''}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            )}

            <ConnectionSelector
              value={selectedConnectionId}
              onChange={setSelectedConnectionId}
              label="Pull from Connection (Optional)"
              size="small"
              showStatus
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              multiline
              rows={12}
              placeholder="Paste your document content, report text, or any content you want to summarize..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              sx={{ mb: 2 }}
            />
            <Typography variant="caption" color="text.secondary">
              {content.length} / 50,000 characters
            </Typography>

            <Divider sx={{ my: 2 }} />

            {/* Options */}
            <Typography variant="subtitle2" gutterBottom>
              Summary Options
            </Typography>

            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Tone</InputLabel>
              <Select value={tone} label="Tone" onChange={(e) => setTone(e.target.value)}>
                {TONE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    <Box>
                      <Typography variant="body2">{opt.label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {opt.description}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" gutterBottom>
                Summary Length: {maxSentences} sentences
              </Typography>
              <Slider
                value={maxSentences}
                onChange={(e, val) => setMaxSentences(val)}
                min={2}
                max={15}
                marks={[
                  { value: 2, label: '2' },
                  { value: 5, label: '5' },
                  { value: 10, label: '10' },
                  { value: 15, label: '15' },
                ]}
                valueLabelDisplay="auto"
              />
            </Box>

            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" gutterBottom>
                Focus Areas (optional, max 5)
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                {focusAreas.map((focus) => (
                  <Chip
                    key={focus}
                    label={focus}
                    size="small"
                    onDelete={() => handleRemoveFocus(focus)}
                    sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                  />
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                {FOCUS_SUGGESTIONS.filter((f) => !focusAreas.includes(f)).map((focus) => (
                  <Chip
                    key={focus}
                    label={focus}
                    size="small"
                    variant="outlined"
                    onClick={() => handleAddFocus(focus)}
                    disabled={focusAreas.length >= 5}
                  />
                ))}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  placeholder="Add custom focus..."
                  value={customFocus}
                  onChange={(e) => setCustomFocus(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddCustomFocus()}
                  disabled={focusAreas.length >= 5}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleAddCustomFocus}
                  disabled={!customFocus.trim() || focusAreas.length >= 5}
                >
                  Add
                </Button>
              </Box>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button
                variant="contained"
                fullWidth
                size="large"
                startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <SummaryIcon />}
                onClick={handleGenerate}
                disabled={!content.trim() || content.length < 10 || loading || queueing}
              >
                {loading ? 'Generating...' : 'Generate Summary'}
              </Button>
              <Button
                variant="outlined"
                fullWidth
                size="large"
                startIcon={queueing ? <CircularProgress size={20} color="inherit" /> : <ScheduleIcon />}
                onClick={handleQueue}
                disabled={!content.trim() || content.length < 10 || loading || queueing}
              >
                {queueing ? 'Queueing...' : 'Queue in Background'}
              </Button>
            </Stack>
          </Paper>
        </Grid>

        {/* Output Section */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">Generated Summary</Typography>
              {summary && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <SendToMenu
                    outputType={OutputType.TEXT}
                    payload={{
                      title: `Executive Summary (${tone})`,
                      content: summary,
                    }}
                    sourceFeature={FeatureKey.SUMMARY}
                  />
                  <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
                    <IconButton size="small" onClick={handleCopy} aria-label="Copy to clipboard">
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Clear">
                    <IconButton size="small" onClick={handleClearSummary} aria-label="Clear summary">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            </Box>

            {summary ? (
              <Box sx={{ flex: 1 }}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    bgcolor: neutral[50],
                    minHeight: 200,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  <Typography variant="body1">{summary}</Typography>
                </Paper>
                <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Chip label={`Tone: ${tone}`} size="small" variant="outlined" />
                  <Chip label={`${maxSentences} sentences`} size="small" variant="outlined" />
                  {focusAreas.map((f) => (
                    <Chip key={f} label={f} size="small" variant="outlined" sx={{ borderColor: 'divider', color: 'text.secondary' }} />
                  ))}
                </Box>
              </Box>
            ) : (
              <Box
                sx={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 300,
                }}
              >
                <Box sx={{ textAlign: 'center' }}>
                  <SummaryIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                  <Typography color="text.secondary">
                    Enter your content and click "Generate Summary" to create an executive summary
                  </Typography>
                </Box>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      <ConfirmModal
        open={clearHistoryConfirmOpen}
        onClose={handleCloseClearHistory}
        onConfirm={handleClearHistory}
        title="Clear History"
        message="Are you sure you want to clear all summary history? This action cannot be undone."
        confirmLabel="Clear All"
        severity="warning"
      />
    </Box>
  );
}

// === From: synthesis.jsx ===
/**
 * Multi-Document Synthesis Page
 */
// UX Components for premium interactions
// UX Governance - Enforced interaction API

const MAX_DOC_SIZE = 5 * 1024 * 1024;
const MIN_DOC_LENGTH = 10;
const MAX_NAME_LENGTH = 200;
const MAX_FOCUS_TOPICS = 10;

export function SynthesisPage() {
  const {
    sessions,
    currentSession,
    inconsistencies,
    synthesisResult,
    loading,
    error,
    fetchSessions,
    createSession,
    getSession,
    deleteSession,
    addDocument,
    removeDocument,
    findInconsistencies,
    synthesize,
    reset,
  } = useSynthesisStore();

  const { connections, templates, activeConnectionId } = useSharedData();
  const { registerOutput } = useCrossPageActions(FeatureKey.SYNTHESIS);
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [addDocDialogOpen, setAddDocDialogOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [docName, setDocName] = useState('');
  const [docContent, setDocContent] = useState('');
  const [docType, setDocType] = useState('text');
  const [outputFormat, setOutputFormat] = useState('structured');
  const [focusTopics, setFocusTopics] = useState('');
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteSessionConfirm, setDeleteSessionConfirm] = useState({ open: false, sessionId: null, sessionName: '' });
  const [removeDocConfirm, setRemoveDocConfirm] = useState({ open: false, docId: null, docName: '' });
  const toast = useToast();
  const docCount = currentSession?.documents?.length || 0;
  // UX Governance: Enforced interaction API - ALL user actions flow through this
  const { execute } = useInteraction();

  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      setInitialLoading(true);
      await fetchSessions();
      setInitialLoading(false);
    };
    init();
    return () => reset();
  }, [fetchSessions, reset]);

  const handleCreateSession = () => {
    if (!newSessionName) return;
    if (newSessionName.length > MAX_NAME_LENGTH) {
      toast.show(`Session name must be ${MAX_NAME_LENGTH} characters or less`, 'error');
      return;
    }
    // UX Governance: Create action with tracking
    execute({
      type: InteractionType.CREATE,
      label: `Create session "${newSessionName}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: 'Session created successfully',
      action: async () => {
        await createSession(newSessionName);
        setCreateDialogOpen(false);
        setNewSessionName('');
      },
    });
  };

  const handleAddDocument = () => {
    if (!currentSession || !docName || !docContent) return;
    if (docName.length > MAX_NAME_LENGTH) {
      toast.show(`Document name must be ${MAX_NAME_LENGTH} characters or less`, 'error');
      return;
    }
    if (docContent.trim().length < MIN_DOC_LENGTH) {
      toast.show(`Document content must be at least ${MIN_DOC_LENGTH} characters`, 'error');
      return;
    }
    if (docContent.length > MAX_DOC_SIZE) {
      toast.show('Document content exceeds 5MB limit', 'error');
      return;
    }
    // UX Governance: Upload action with tracking
    execute({
      type: InteractionType.UPLOAD,
      label: `Add document "${docName}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: 'Document added successfully',
      action: async () => {
        await addDocument(currentSession.id, {
          name: docName,
          content: docContent,
          docType,
        });
        setAddDocDialogOpen(false);
        setDocName('');
        setDocContent('');
      },
    });
  };

  const handleFileUpload = async (event) => {
    const inputEl = event.target;
    const file = inputEl.files?.[0];
    if (!file) return;
    if (file.name.length > MAX_NAME_LENGTH) {
      toast.show(`File name must be ${MAX_NAME_LENGTH} characters or less`, 'error');
      inputEl.value = '';
      return;
    }

    // Check file size (max 5MB for text files)
    if (file.size > MAX_DOC_SIZE) {
      toast.show('File size exceeds 5MB limit', 'error');
      inputEl.value = '';
      return;
    }

    const ext = file.name.split('.').pop().toLowerCase();
    const inferredType = ext === 'pdf'
      ? 'pdf'
      : ['xlsx', 'xls', 'csv'].includes(ext)
        ? 'excel'
        : ['doc', 'docx'].includes(ext)
          ? 'word'
          : ext === 'json'
            ? 'json'
            : 'text';

    try {
      const response = await extractSynthesisDocument(file, { docType: inferredType });
      const extracted = response?.document;
      const content = extracted?.content || '';
      if (content.trim().length < MIN_DOC_LENGTH) {
        toast.show(`Extracted content must be at least ${MIN_DOC_LENGTH} characters`, 'error');
        inputEl.value = '';
        return;
      }

      setDocName(extracted?.name || file.name);
      setDocContent(content);
      setDocType(extracted?.doc_type || inferredType);
      if (extracted?.truncated) {
        toast.show('File content was truncated to fit 5MB limit', 'warning');
      } else {
        toast.show('File processed successfully', 'success');
      }
    } catch (err) {
      toast.show(err.message || 'Failed to process file', 'error');
    } finally {
      inputEl.value = '';
    }
  };

  const handleSynthesize = () => {
    if (!currentSession) return;
    const topics = focusTopics
      ? focusTopics.split(',').map((topic) => topic.trim()).filter(Boolean)
      : undefined;
    if (topics && topics.length > MAX_FOCUS_TOPICS) {
      toast.show(`Focus topics must be ${MAX_FOCUS_TOPICS} items or less`, 'error');
      return;
    }

    // UX Governance: Generate action with tracking and navigation blocking
    execute({
      type: InteractionType.GENERATE,
      label: 'Synthesize documents',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      successMessage: 'Synthesis complete',
      errorMessage: 'Synthesis failed',
      action: async () => {
        const result = await synthesize(currentSession.id, {
          focusTopics: topics,
          outputFormat,
          connectionId: selectedConnectionId || undefined,
        });
        if (!result) throw new Error('Synthesis failed');
        const synthTitle = result.synthesis?.title || currentSession.name || 'Synthesis';
        const synthContent = [
          result.synthesis?.executive_summary || '',
          ...(result.synthesis?.key_insights || []),
          ...(result.synthesis?.sections || []).map((s) => `${s.heading}\n${s.content}`),
        ].join('\n\n');
        registerOutput({
          type: OutputType.TEXT,
          title: synthTitle,
          summary: (result.synthesis?.executive_summary || '').substring(0, 200),
          data: synthContent,
          format: 'text',
        });
      },
    });
  };

  const handleFindInconsistencies = () => {
    if (!currentSession) return;

    // UX Governance: Analyze action with tracking
    execute({
      type: InteractionType.ANALYZE,
      label: 'Find inconsistencies',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      action: async () => {
        const result = await findInconsistencies(currentSession.id);
        if (result === null) throw new Error('Analysis failed');
        if (result.length > 0) {
          toast.show(`Found ${result.length} inconsistencies`, 'warning');
        } else {
          toast.show('No inconsistencies found', 'success');
        }
      },
    });
  };

  const handleOpenPreview = (doc) => {
    setPreviewDoc(doc);
    setPreviewOpen(true);
  };

  const handleClosePreview = () => {
    setPreviewOpen(false);
    setPreviewDoc(null);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'error';
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'default';
    }
  };

  // Show loading during initial fetch
  if (initialLoading) {
    return (
      <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <MergeIcon />
          <Typography variant="h5">Multi-Document Synthesis</Typography>
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
            <MergeIcon /> Multi-Document Synthesis
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Combine information from multiple documents with AI-powered analysis
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          New Session
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => reset()}>
          {error}
        </Alert>
      )}

      {currentSession && (
        <AiUsageNotice
          title="AI synthesis"
          description="Outputs are generated from the documents in this session. Review before sharing."
          chips={[
            { label: `Source: ${docCount} document${docCount === 1 ? '' : 's'}`, color: 'info', variant: 'outlined' },
            { label: 'Confidence: Review required', color: 'warning', variant: 'outlined' },
            { label: 'Reversible: No source changes', color: 'success', variant: 'outlined' },
          ]}
          dense
          sx={{ mb: 2 }}
        />
      )}

      <Grid container spacing={3}>
        {/* Sessions List */}
        <Grid size={{ xs: 12, md: 3 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Sessions
            </Typography>
            {sessions.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                No sessions yet
              </Typography>
            ) : (
              <List dense>
                {sessions.map((session) => (
                  <ListItem
                    key={session.id}
                    component="div"
                    selected={currentSession?.id === session.id}
                    onClick={() => getSession(session.id)}
                  >
                    <ListItemIcon>
                      <MergeIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary={session.name}
                      secondary={`${session.documents?.length || 0} docs`}
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteSessionConfirm({ open: true, sessionId: session.id, sessionName: session.name });
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

        {/* Main Content */}
        <Grid size={{ xs: 12, md: 9 }}>
          {currentSession ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* Documents */}
              <Paper sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">
                    Documents ({currentSession.documents?.length || 0})
                  </Typography>
                  <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => setAddDocDialogOpen(true)}
                  >
                    Add Document
                  </Button>
                </Box>

                {currentSession.documents?.length === 0 ? (
                  <Typography color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                    Add documents to begin synthesis
                  </Typography>
                ) : (
                  <Grid container spacing={2}>
                    {currentSession.documents?.map((doc) => (
                      <Grid size={{ xs: 12, sm: 6, md: 4 }} key={doc.id}>
                        <Card variant="outlined">
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                              <DocIcon sx={{ color: 'text.secondary' }} />
                              <Typography variant="subtitle2" noWrap>
                                {doc.name}
                              </Typography>
                            </Box>
                            <Chip size="small" label={doc.doc_type} />
                          </CardContent>
                          <CardActions>
                            <Tooltip title="Preview">
                              <IconButton
                                size="small"
                                onClick={() => handleOpenPreview(doc)}
                              >
                                <PreviewIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <IconButton
                              size="small"
                              onClick={() => setRemoveDocConfirm({ open: true, docId: doc.id, docName: doc.name })}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </CardActions>
                        </Card>
                      </Grid>
                    ))}
                  </Grid>
                )}
              </Paper>

              {/* Analysis Actions */}
              {currentSession.documents?.length >= 2 && (
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom>
                    Analysis
                  </Typography>
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid size={{ xs: 12 }}>
                      <ConnectionSelector
                        value={selectedConnectionId}
                        onChange={setSelectedConnectionId}
                        label="Enrich with Database (optional)"
                        showStatus
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Output Format</InputLabel>
                        <Select
                          value={outputFormat}
                          label="Output Format"
                          onChange={(e) => setOutputFormat(e.target.value)}
                        >
                          <MenuItem value="structured">Structured</MenuItem>
                          <MenuItem value="narrative">Narrative</MenuItem>
                          <MenuItem value="comparison">Comparison</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Focus Topics (comma-separated)"
                        value={focusTopics}
                        onChange={(e) => setFocusTopics(e.target.value)}
                        placeholder="revenue, growth, risks"
                      />
                    </Grid>
                  </Grid>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    {/* UX: DisabledTooltip explains WHY buttons are disabled */}
                    <DisabledTooltip
                      disabled={loading || !currentSession?.documents?.length}
                      reason={
                        loading
                          ? 'Please wait for the current operation to complete'
                          : !currentSession?.documents?.length
                            ? 'Add at least one document first'
                            : undefined
                      }
                    >
                      <Button
                        variant="outlined"
                        startIcon={loading ? <CircularProgress size={20} /> : <WarningIcon />}
                        onClick={handleFindInconsistencies}
                        disabled={loading || !currentSession?.documents?.length}
                      >
                        Find Inconsistencies
                      </Button>
                    </DisabledTooltip>
                    <DisabledTooltip
                      disabled={loading || !currentSession?.documents?.length}
                      reason={
                        loading
                          ? 'Please wait for the current operation to complete'
                          : !currentSession?.documents?.length
                            ? 'Add at least two documents to synthesize'
                            : undefined
                      }
                    >
                      <Button
                        variant="contained"
                        startIcon={loading ? <CircularProgress size={20} /> : <SynthesizeIcon />}
                        onClick={handleSynthesize}
                        disabled={loading || !currentSession?.documents?.length}
                      >
                        Synthesize
                      </Button>
                    </DisabledTooltip>
                  </Box>
                </Paper>
              )}

              {/* Inconsistencies */}
              {inconsistencies.length > 0 && (
                <Paper sx={{ p: 3 }}>
                  <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <WarningIcon sx={{ color: 'text.secondary' }} /> Inconsistencies Found ({inconsistencies.length})
                  </Typography>
                  {inconsistencies.map((item, idx) => (
                    <Accordion key={idx} variant="outlined">
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <Chip
                            size="small"
                            label={item.severity}
                            sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                          />
                          <Typography>{item.field_or_topic}</Typography>
                        </Box>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                          {item.description}
                        </Typography>
                        {item.suggested_resolution && (
                          <Alert severity="info" sx={{ mt: 1 }}>
                            <strong>Suggestion:</strong> {item.suggested_resolution}
                          </Alert>
                        )}
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Paper>
              )}

              {/* Synthesis Result */}
              {synthesisResult && (
                <Paper sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6">
                      Synthesis Result
                    </Typography>
                    <SendToMenu
                      outputType={OutputType.TEXT}
                      payload={{
                        title: synthesisResult.synthesis?.title || currentSession?.name || 'Synthesis',
                        content: [
                          synthesisResult.synthesis?.executive_summary || '',
                          ...(synthesisResult.synthesis?.key_insights || []),
                          ...(synthesisResult.synthesis?.sections || []).map((s) => `${s.heading}\n${s.content}`),
                        ].join('\n\n'),
                      }}
                      sourceFeature={FeatureKey.SYNTHESIS}
                    />
                  </Box>
                  <Box sx={{ bgcolor: neutral[50], p: 2, borderRadius: 1 }}>
                    <Typography variant="h6" gutterBottom>
                      {synthesisResult.synthesis?.title}
                    </Typography>
                    <Typography variant="body1" sx={{ mb: 2 }}>
                      {synthesisResult.synthesis?.executive_summary}
                    </Typography>

                    {synthesisResult.synthesis?.key_insights && (
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" gutterBottom>Key Insights</Typography>
                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                          {synthesisResult.synthesis.key_insights.map((insight, idx) => (
                            <li key={idx}><Typography variant="body2">{insight}</Typography></li>
                          ))}
                        </ul>
                      </Box>
                    )}

                    {synthesisResult.synthesis?.sections && (
                      <Box>
                        {synthesisResult.synthesis.sections.map((section, idx) => (
                          <Box key={idx} sx={{ mb: 2 }}>
                            <Typography variant="subtitle1">{section.heading}</Typography>
                            <Typography variant="body2">{section.content}</Typography>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                </Paper>
              )}
            </Box>
          ) : (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <MergeIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
              <Typography color="text.secondary">
                Select a session or create a new one to begin
              </Typography>
            </Paper>
          )}
        </Grid>
      </Grid>

      {/* Create Session Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)}>
        <DialogTitle>Create Synthesis Session</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Session Name"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            sx={{ mt: 2 }}
            inputProps={{ maxLength: MAX_NAME_LENGTH }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateSession} disabled={!newSessionName}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Document Dialog */}
      <Dialog open={addDocDialogOpen} onClose={() => setAddDocDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add Document</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 2 }}>
            <TextField
              fullWidth
              label="Document Name"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              inputProps={{ maxLength: MAX_NAME_LENGTH }}
            />
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel>Type</InputLabel>
              <Select
                value={docType}
                label="Type"
                onChange={(e) => setDocType(e.target.value)}
              >
                <MenuItem value="text">Text</MenuItem>
                <MenuItem value="pdf">PDF</MenuItem>
                <MenuItem value="excel">Excel</MenuItem>
                <MenuItem value="word">Word</MenuItem>
                <MenuItem value="json">JSON</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Button
            variant="outlined"
            component="label"
            startIcon={<UploadIcon />}
            sx={{ mb: 2 }}
          >
            Upload File
            <input type="file" hidden onChange={handleFileUpload} />
          </Button>
          <TextField
            fullWidth
            multiline
            rows={10}
            label="Document Content"
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
            placeholder="Paste document content or upload a file..."
            inputProps={{ maxLength: MAX_DOC_SIZE }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddDocDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAddDocument}
            disabled={!docName || !docContent}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      {/* Preview Document Dialog */}
      <Dialog open={previewOpen} onClose={handleClosePreview} maxWidth="md" fullWidth>
        <DialogTitle>Document Preview</DialogTitle>
        <DialogContent dividers>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {previewDoc?.name || 'Document'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            {previewDoc?.doc_type || previewDoc?.docType || 'text'}
          </Typography>
          <Paper sx={{ p: 2, bgcolor: neutral[50], maxHeight: 420, overflow: 'auto' }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {previewDoc?.content || 'No content available.'}
            </Typography>
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClosePreview}>Close</Button>
        </DialogActions>
      </Dialog>

      <ConfirmModal
        open={deleteSessionConfirm.open}
        onClose={() => setDeleteSessionConfirm({ open: false, sessionId: null, sessionName: '' })}
        onConfirm={() => {
          const sessionId = deleteSessionConfirm.sessionId;
          const sessionName = deleteSessionConfirm.sessionName;
          setDeleteSessionConfirm({ open: false, sessionId: null, sessionName: '' });

          // UX Governance: Irreversible delete action with tracking
          execute({
            type: InteractionType.DELETE,
            label: `Delete session "${sessionName}"`,
            reversibility: Reversibility.IRREVERSIBLE,
            successMessage: `Session "${sessionName}" deleted`,
            errorMessage: 'Failed to delete session',
            action: async () => {
              const success = await deleteSession(sessionId);
              if (!success) throw new Error('Delete failed');
            },
          });
        }}
        title="Delete Session"
        message={`Are you sure you want to delete "${deleteSessionConfirm.sessionName}"? All documents and analysis data will be permanently removed.`}
        confirmLabel="Delete"
        severity="error"
      />

      <ConfirmModal
        open={removeDocConfirm.open}
        onClose={() => setRemoveDocConfirm({ open: false, docId: null, docName: '' })}
        onConfirm={() => {
          const docId = removeDocConfirm.docId;
          const docName = removeDocConfirm.docName;
          setRemoveDocConfirm({ open: false, docId: null, docName: '' });

          // UX Governance: Delete action with tracking
          execute({
            type: InteractionType.DELETE,
            label: `Remove document "${docName}"`,
            reversibility: Reversibility.PARTIALLY_REVERSIBLE,
            successMessage: `Document "${docName}" removed`,
            errorMessage: 'Failed to remove document',
            action: async () => {
              const success = await removeDocument(currentSession?.id, docId);
              if (!success) throw new Error('Remove failed');
            },
          });
        }}
        title="Remove Document"
        message={`Are you sure you want to remove "${removeDocConfirm.docName}" from this session?`}
        confirmLabel="Remove"
        severity="warning"
      />
    </Box>
  );
}
