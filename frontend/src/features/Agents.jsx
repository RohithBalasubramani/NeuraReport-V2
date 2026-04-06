import * as clientApi from '@/api/client'
import { neutral, palette } from '@/app/theme'
import { ConnectionSelector, SendToMenu, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { FeedbackPanel } from '@/features/Utility'
import { useCrossPageActions, useSharedData } from '@/hooks/hooks'
import { useAgentStore } from '@/stores/content'
import { ActionButton, FullHeightPageContainer as PageContainer, GlassCard } from '@/styles/styles'
import { FeatureKey, OutputType } from '@/utils/helpers'
import {
  Analytics as DataIcon,
  Assessment as ReportAnalystIcon,
  CheckCircle as CheckIcon,
  CompareArrows as CompareIcon,
  ContentCopy as CopyIcon,
  Description as ReportIcon,
  Download as DownloadIcon,
  Email as EmailIcon,
  History as HistoryIcon,
  Lightbulb as InsightIcon,
  PlayArrow as RunIcon,
  QuestionAnswer as QAIcon,
  Science as ResearchIcon,
  SmartToy as AgentIcon,
  Spellcheck as ProofreadIcon,
  Transform as ContentIcon,
  TrendingDown as TrendDownIcon,
  TrendingFlat as TrendFlatIcon,
  TrendingUp as TrendUpIcon,
} from '@mui/icons-material'
import {
  Alert,
  Autocomplete,
  Avatar,
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
  FormControl,
  Grid,
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
import { useSearchParams } from 'react-router-dom'
const AGENT_COLORS = {
  template_analyst: '#8B5CF6',
  data_engineer: '#3B82F6',
  report_writer: '#10B981',
  qa_reviewer: '#F59E0B',
  researcher: '#6366F1',
  analyst: '#EC4899',
  writer: '#14B8A6',
  schema_analyst: '#8B5CF6',
  mapping_specialist: '#3B82F6',
  content_reviewer: '#10B981',
  fact_checker: '#F59E0B',
  editor: '#6366F1',
};

const DEFAULT_COLOR = '#6B7280';

function getAgentColor(agent) {
  if (!agent) return DEFAULT_COLOR;
  const key = agent.toLowerCase().replace(/\s+/g, '_');
  return AGENT_COLORS[key] || DEFAULT_COLOR;
}

function getInitials(agent) {
  if (!agent) return '?';
  return agent
    .split(/[\s_]+/)
    .map((w) => w[0]?.toUpperCase() || '')
    .slice(0, 2)
    .join('');
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function MessageBubble({ message }) {
  const { agent, content, timestamp, type = 'output' } = message;
  const color = getAgentColor(agent);
  const isThinking = type === 'thinking';
  const isDelegation = type === 'delegation';

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        mb: 2,
        alignItems: 'flex-start',
      }}
    >
      <Avatar
        sx={{
          bgcolor: color,
          width: 36,
          height: 36,
          fontSize: '0.8rem',
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {getInitials(agent)}
      </Avatar>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 600,
              color: color,
              textTransform: 'capitalize',
            }}
          >
            {agent ? agent.replace(/_/g, ' ') : 'Unknown Agent'}
          </Typography>
          {timestamp && (
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              {formatTimestamp(timestamp)}
            </Typography>
          )}
        </Box>

        <Paper
          elevation={0}
          sx={{
            px: 2,
            py: 1.5,
            borderRadius: 2,
            bgcolor: isDelegation
              ? 'rgba(99, 102, 241, 0.08)'
              : isThinking
                ? 'rgba(0, 0, 0, 0.03)'
                : 'rgba(0, 0, 0, 0.02)',
            borderLeft: `3px solid ${isDelegation ? '#6366F1' : color}`,
          }}
        >
          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              ...(isThinking && {
                fontStyle: 'italic',
                color: 'text.secondary',
              }),
            }}
          >
            {content}
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}

function TeamActivity({ messages = [], maxHeight = 500 }) {
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  if (!messages || messages.length === 0) {
    return (
      <GlassCard>
        <Typography
          variant="h6"
          sx={{ color: neutral[900], fontWeight: 600, mb: 2 }}
        >
          Team Activity
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          No agent activity yet. Start a pipeline to see agent collaboration.
        </Typography>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <Typography
        variant="h6"
        sx={{ color: neutral[900], fontWeight: 600, mb: 2 }}
      >
        Team Activity
      </Typography>

      <Box
        ref={scrollRef}
        sx={{
          maxHeight,
          overflowY: 'auto',
          overflowX: 'hidden',
          pr: 1,
          '&::-webkit-scrollbar': {
            width: 6,
          },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: 'rgba(0,0,0,0.15)',
            borderRadius: 3,
          },
        }}
      >
        {messages.map((msg, index) => (
          <MessageBubble key={index} message={msg} />
        ))}
        <div ref={bottomRef} />
      </Box>
    </GlassCard>
  );
}

// === From: AgentsPageContainer.jsx ===
/**
 * AI Agents Page Container
 * Interface for running AI agents (research, data analysis, email, content, proofreading, report analyst).
 */

// V2: Team activity and feedback components


const Header = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2, 3),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
}))

const ContentArea = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
}))

const MainPanel = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(3),
  overflow: 'auto',
}))

const Sidebar = styled(Box)(({ theme }) => ({
  width: 350,
  borderLeft: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.6),
  display: 'flex',
  flexDirection: 'column',
}))

const AgentCard = styled(Card)(({ theme, selected }) => ({
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  border: selected ? `2px solid ${theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}` : `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: `0 8px 24px ${alpha(theme.palette.text.primary, 0.15)}`,
  },
}))

const ResultCard = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  marginTop: theme.spacing(2),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
}))

const TrendIcon = ({ trend }) => {
  if (trend === 'up') return <TrendUpIcon fontSize="small" color="success" />
  if (trend === 'down') return <TrendDownIcon fontSize="small" color="error" />
  if (trend === 'stable') return <TrendFlatIcon fontSize="small" color="action" />
  return null
}


const AnalysisSectionTitle = styled(Typography)(({ theme }) => ({
  fontWeight: 600,
  fontSize: '0.875rem',
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  marginBottom: theme.spacing(1),
}))

const FindingCard = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(1.5),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
  borderRadius: 8,
}))

const HighlightRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(1, 1.5),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  '&:last-child': { borderBottom: 'none' },
}))

function ReportAnalystResult({ output }) {
  if (!output || typeof output !== 'object') return null

  const { summary, answer, key_findings, data_highlights, recommendations, comparison, analysis_type } = output

  return (
    <Stack spacing={2.5}>
      {/* Answer (QA mode) */}
      {answer && (
        <Box>
          <AnalysisSectionTitle>
            <QAIcon fontSize="small" color="primary" />
            Answer
          </AnalysisSectionTitle>
          <Paper sx={{ p: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.06), borderRadius: 2, border: '1px solid', borderColor: (t) => alpha(t.palette.primary.main, 0.15) }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{answer}</Typography>
          </Paper>
        </Box>
      )}

      {/* Summary */}
      {summary && (
        <Box>
          <AnalysisSectionTitle>
            <ReportIcon fontSize="small" color="action" />
            Summary
          </AnalysisSectionTitle>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{summary}</Typography>
        </Box>
      )}

      {/* Key Findings */}
      {key_findings?.length > 0 && (
        <Box>
          <AnalysisSectionTitle>
            <InsightIcon fontSize="small" sx={{ color: 'warning.main' }} />
            Key Findings ({key_findings.length})
          </AnalysisSectionTitle>
          <Stack spacing={1}>
            {key_findings.map((f, i) => (
              <FindingCard key={i} elevation={0}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                  <Typography variant="body2">{f.finding || f}</Typography>
                  {f.confidence != null && (
                    <Chip
                      label={`${Math.round(f.confidence * 100)}%`}
                      size="small"
                      color={f.confidence >= 0.8 ? 'success' : f.confidence >= 0.6 ? 'warning' : 'default'}
                      variant="outlined"
                      sx={{ flexShrink: 0, fontSize: '12px', height: 22 }}
                    />
                  )}
                </Box>
                {f.source_section && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    Source: {f.source_section}
                  </Typography>
                )}
              </FindingCard>
            ))}
          </Stack>
        </Box>
      )}

      {/* Data Highlights */}
      {data_highlights?.length > 0 && (
        <Box>
          <AnalysisSectionTitle>
            <DataIcon fontSize="small" color="info" />
            Data Highlights ({data_highlights.length})
          </AnalysisSectionTitle>
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            {data_highlights.map((d, i) => (
              <HighlightRow key={i}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>{d.metric}</Typography>
                  {d.context && <Typography variant="caption" color="text.secondary">{d.context}</Typography>}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                  <Typography variant="body2" fontWeight={500}>{d.value}</Typography>
                  <TrendIcon trend={d.trend} />
                </Box>
              </HighlightRow>
            ))}
          </Paper>
        </Box>
      )}

      {/* Comparison (Compare mode) */}
      {comparison && (
        <Box>
          <AnalysisSectionTitle>
            <CompareIcon fontSize="small" color="secondary" />
            Comparison
          </AnalysisSectionTitle>
          <Stack spacing={1}>
            {comparison.report_a_period && comparison.report_b_period && (
              <Typography variant="caption" color="text.secondary">
                Comparing: {comparison.report_a_period} vs {comparison.report_b_period}
              </Typography>
            )}
            {comparison.improvements?.length > 0 && (
              <Box>
                <Typography variant="caption" fontWeight={600} color="success.main">Improvements:</Typography>
                <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                  {comparison.improvements.map((item, i) => (
                    <li key={i}><Typography variant="caption">{item}</Typography></li>
                  ))}
                </ul>
              </Box>
            )}
            {comparison.regressions?.length > 0 && (
              <Box>
                <Typography variant="caption" fontWeight={600} color="error.main">Regressions:</Typography>
                <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                  {comparison.regressions.map((item, i) => (
                    <li key={i}><Typography variant="caption">{item}</Typography></li>
                  ))}
                </ul>
              </Box>
            )}
          </Stack>
        </Box>
      )}

      {/* Recommendations */}
      {recommendations?.length > 0 && (
        <Box>
          <AnalysisSectionTitle>
            <CheckIcon fontSize="small" color="success" />
            Recommendations ({recommendations.length})
          </AnalysisSectionTitle>
          <Stack spacing={0.5}>
            {recommendations.map((rec, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pl: 0.5 }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 20, fontWeight: 600 }}>{i + 1}.</Typography>
                <Typography variant="body2">{rec}</Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  )
}


function GenerateReportDialog({ open, onClose, taskId, templates, connections, onGenerate }) {
  const [templateId, setTemplateId] = useState('')
  const [connectionId, setConnectionId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setTemplateId(templates?.[0]?.id || '')
      setConnectionId(connections?.[0]?.id || '')
      const today = new Date().toISOString().split('T')[0]
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]
      setStartDate(monthAgo)
      setEndDate(today)
    }
  }, [open, templates, connections])

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      await onGenerate(taskId, {
        templateId,
        connectionId,
        startDate,
        endDate,
      })
      onClose()
    } catch (err) {
      // Error handled in parent
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600 }}>Generate Report from Agent Result</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Template</InputLabel>
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} label="Template">
              {(templates || []).map((t) => (
                <MenuItem key={t.id} value={t.id}>{t.name || t.id}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Connection</InputLabel>
            <Select value={connectionId} onChange={(e) => setConnectionId(e.target.value)} label="Connection">
              {(connections || []).map((c) => (
                <MenuItem key={c.id} value={c.id}>{c.name || c.id}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
              size="small"
            />
            <TextField
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
              size="small"
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!templateId || !connectionId || submitting}
          startIcon={submitting ? <CircularProgress size={16} /> : <ReportIcon />}
        >
          {submitting ? 'Generating...' : 'Generate Report'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}


const AGENTS = [
  {
    type: 'research',
    name: 'Research Agent',
    description: 'Deep-dive research and report compilation on any topic',
    icon: ResearchIcon,
    color: 'primary',
    fields: [
      { name: 'topic', label: 'Research Topic', type: 'text', required: true, multiline: true },
      { name: 'depth', label: 'Depth', type: 'select', options: ['quick', 'standard', 'comprehensive', 'exhaustive'], default: 'comprehensive' },
      { name: 'maxSections', label: 'Sections', type: 'number', default: 5, min: 1, max: 10 },
    ],
  },
  {
    type: 'data_analyst',
    name: 'Data Analyst',
    description: 'Analyze data and answer questions with insights',
    icon: DataIcon,
    color: 'info',
    fields: [
      { name: 'question', label: 'What do you want to know?', type: 'text', required: true, multiline: true, placeholder: 'e.g., What are the top 5 products by revenue? Which month had the highest sales?' },
      { name: 'dataSource', label: 'Data Source', type: 'select', options: ['paste_spreadsheet', 'database_connection', 'sample_sales', 'sample_inventory', 'custom_json'], default: 'paste_spreadsheet' },
      { name: 'data', label: 'Paste your data here (from Excel or Google Sheets)', type: 'spreadsheet', required: true, multiline: true, rows: 8, placeholder: 'Tip: Copy cells from Excel or Google Sheets and paste here. We\'ll convert it automatically!' },
    ],
  },
  {
    type: 'email_draft',
    name: 'Email Draft',
    description: 'Compose professional emails based on context',
    icon: EmailIcon,
    color: 'warning',
    fields: [
      { name: 'context', label: 'Context', type: 'text', required: true, multiline: true },
      { name: 'purpose', label: 'Purpose', type: 'text', required: true },
      { name: 'tone', label: 'Tone', type: 'select', options: ['professional', 'friendly', 'formal', 'casual'], default: 'professional' },
      { name: 'recipientInfo', label: 'Recipient Info', type: 'text' },
    ],
  },
  {
    type: 'content_repurpose',
    name: 'Content Repurpose',
    description: 'Transform content into multiple formats',
    icon: ContentIcon,
    color: 'secondary',
    fields: [
      { name: 'content', label: 'Original Content', type: 'text', required: true, multiline: true, rows: 6 },
      { name: 'sourceFormat', label: 'Source Format', type: 'select', options: ['blog', 'article', 'report', 'notes', 'transcript'], default: 'blog' },
      { name: 'targetFormats', label: 'Target Formats', type: 'multiselect', options: ['tweet_thread', 'linkedin_post', 'blog_summary', 'slides', 'email_newsletter', 'video_script'] },
    ],
  },
  {
    type: 'proofreading',
    name: 'Proofreading',
    description: 'Grammar, style, and clarity improvements',
    icon: ProofreadIcon,
    color: 'success',
    fields: [
      { name: 'text', label: 'Text to Proofread', type: 'text', required: true, multiline: true, rows: 8 },
      { name: 'styleGuide', label: 'Style Guide', type: 'select', options: ['AP', 'Chicago', 'MLA', 'APA', 'None'], default: 'None' },
    ],
  },
  {
    type: 'report_analyst',
    name: 'Report Analyst',
    description: 'Analyze, summarize, compare, or ask questions about generated reports',
    icon: ReportAnalystIcon,
    color: 'error',
    fields: [
      { name: 'runId', label: 'Report Run', type: 'reportRunPicker', required: true, placeholder: 'Select or enter a report run ID' },
      { name: 'analysisType', label: 'Analysis Type', type: 'select', options: ['summarize', 'insights', 'compare', 'qa'], default: 'summarize' },
      { name: 'question', label: 'Question (for Q&A mode)', type: 'text', multiline: true, placeholder: 'What would you like to know about this report?' },
      { name: 'compareRunId', label: 'Comparison Run ID (for compare mode)', type: 'reportRunPicker', placeholder: 'Select second report to compare against' },
    ],
  },
]


export default function AgentsPageContainer() {
  const theme = useTheme()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const { execute } = useInteraction()
  const {
    tasks,
    currentTask,
    agentTypes,
    repurposeFormats,
    loading,
    executing,
    error,
    runResearch,
    runDataAnalysis,
    runEmailDraft,
    runContentRepurpose,
    runProofreading,
    runReportAnalyst,
    generateReportFromTask,
    fetchTasks,
    fetchAgentTypes,
    fetchRepurposeFormats,
    reset,
  } = useAgentStore()

  const { connections, templates, activeConnectionId } = useSharedData()
  const { registerOutput } = useCrossPageActions(FeatureKey.AGENTS)
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId)

  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0])
  const [formData, setFormData] = useState({})
  const [showHistory, setShowHistory] = useState(false)
  const [result, setResult] = useState(null)
  const [recentRuns, setRecentRuns] = useState([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const resultRef = useRef(null)

  useEffect(() => {
    fetchAgentTypes()
    fetchRepurposeFormats()
    fetchTasks()
    return () => reset()
  }, [fetchAgentTypes, fetchRepurposeFormats, fetchTasks, reset])

  // Handle deep-link from Reports page: ?analyzeRunId=<run_id>
  useEffect(() => {
    const analyzeRunId = searchParams.get('analyzeRunId')
    if (analyzeRunId) {
      const reportAnalystAgent = AGENTS.find((a) => a.type === 'report_analyst')
      if (reportAnalystAgent) {
        setSelectedAgent(reportAnalystAgent)
        setFormData({ runId: analyzeRunId, analysisType: 'summarize' })
        // Clear the query param so it doesn't persist
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete('analyzeRunId')
        setSearchParams(nextParams, { replace: true })
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch recent report runs when Report Analyst is selected
  useEffect(() => {
    if (selectedAgent?.type === 'report_analyst') {
      setRunsLoading(true)
      clientApi.listReportRuns({ limit: 20 })
        .then((runs) => setRecentRuns(Array.isArray(runs) ? runs : []))
        .catch(() => setRecentRuns([]))
        .finally(() => setRunsLoading(false))
    }
  }, [selectedAgent?.type])

  const handleSelectAgent = useCallback((agent) => {
    setSelectedAgent(agent)
    setFormData({})
    setResult(null)
  }, [])

  const handleFieldChange = useCallback((fieldName, value) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }))
  }, [])

  const handleRun = useCallback(async () => {
    if (!selectedAgent) return

    const runAction = async () => {
      let taskResult = null

      switch (selectedAgent.type) {
        case 'research':
          taskResult = await runResearch(formData.topic, {
            depth: formData.depth || 'comprehensive',
            maxSections: formData.maxSections || 5,
          })
          break
        case 'data_analyst':
          try {
            let data
            const dataSource = formData.dataSource || 'paste_spreadsheet'

            // Handle different data sources
            if (dataSource === 'sample_sales') {
              data = [
                { product: 'Widget A', revenue: 15000, units: 300, month: 'January' },
                { product: 'Widget B', revenue: 22000, units: 440, month: 'January' },
                { product: 'Widget A', revenue: 18000, units: 360, month: 'February' },
                { product: 'Widget B', revenue: 25000, units: 500, month: 'February' },
                { product: 'Widget C', revenue: 12000, units: 200, month: 'February' },
              ]
            } else if (dataSource === 'sample_inventory') {
              data = [
                { item: 'SKU-001', stock: 150, reorder_point: 50, supplier: 'Acme Corp' },
                { item: 'SKU-002', stock: 25, reorder_point: 30, supplier: 'Beta Inc' },
                { item: 'SKU-003', stock: 200, reorder_point: 75, supplier: 'Acme Corp' },
                { item: 'SKU-004', stock: 10, reorder_point: 20, supplier: 'Gamma Ltd' },
              ]
            } else if (dataSource === 'database_connection') {
              if (!selectedConnectionId) {
                toast.show('Please select a database connection', 'warning')
                return null
              }
              taskResult = await runDataAnalysis(formData.question, [], { connectionId: selectedConnectionId })
            } else if (dataSource === 'custom_json') {
              // User provided raw JSON
              data = JSON.parse(formData.data)
            } else {
              // paste_spreadsheet - parse tab/comma separated values
              const rawData = formData.data || ''
              const lines = rawData.trim().split('\n')
              if (lines.length < 2) {
                toast.show('Please paste data with at least a header row and one data row', 'warning')
                return null
              }
              // Detect delimiter (tab or comma)
              const delimiter = lines[0].includes('\t') ? '\t' : ','
              const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''))
              data = lines.slice(1).map(line => {
                const values = line.split(delimiter).map(v => {
                  const trimmed = v.trim().replace(/^["']|["']$/g, '')
                  // Try to parse as number
                  const num = parseFloat(trimmed)
                  return isNaN(num) ? trimmed : num
                })
                const row = {}
                headers.forEach((header, i) => {
                  row[header] = values[i] ?? ''
                })
                return row
              }).filter(row => Object.values(row).some(v => v !== ''))
            }

            if (dataSource !== 'database_connection') {
              if (!data || !data.length) {
                toast.show('No valid data found. Please check your input.', 'warning')
                return null
              }

              taskResult = await runDataAnalysis(formData.question, data)
            }
          } catch (parseError) {
            toast.show('Could not parse data. For custom JSON, ensure it\'s valid JSON format.', 'error')
            return null
          }
          break
        case 'email_draft':
          taskResult = await runEmailDraft(formData.context, formData.purpose, {
            tone: formData.tone || 'professional',
            recipientInfo: formData.recipientInfo,
          })
          break
        case 'content_repurpose':
          taskResult = await runContentRepurpose(
            formData.content,
            formData.sourceFormat || 'blog',
            formData.targetFormats || ['blog_summary'],
          )
          break
        case 'proofreading':
          taskResult = await runProofreading(formData.text, {
            styleGuide: formData.styleGuide !== 'None' ? formData.styleGuide : null,
          })
          break
        case 'report_analyst':
          taskResult = await runReportAnalyst(formData.runId, {
            analysisType: formData.analysisType || 'summarize',
            question: formData.question || null,
            compareRunId: formData.compareRunId || null,
          })
          break
        default:
          break
      }

      if (taskResult) {
        setResult(taskResult)
        if (taskResult.status === 'failed' || taskResult.status === 'error') {
          const errMsg = (typeof taskResult.error === 'object' ? taskResult.error?.message : taskResult.error) || taskResult.message || 'Agent task failed'
          toast.show(errMsg, 'error')
        } else {
          const taskOutput = taskResult.result || taskResult.output
          const outputText = (typeof taskOutput === 'string'
            ? taskOutput
            : JSON.stringify(taskOutput, null, 2)) || ''
          registerOutput({
            type: OutputType.TEXT,
            title: `${selectedAgent.name}: ${formData.topic || formData.question || formData.purpose || 'Result'}`,
            summary: outputText.substring(0, 200),
            data: outputText,
            format: 'text',
          })
          toast.show('Agent completed successfully', 'success')
        }
      }
      return taskResult
    }

    return execute({
      type: InteractionType.EXECUTE,
      label: `Run ${selectedAgent.name}`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      intent: { source: 'agents', agentType: selectedAgent.type },
      action: runAction,
    })
  }, [execute, formData, runContentRepurpose, runDataAnalysis, runEmailDraft, runProofreading, runReportAnalyst, runResearch, selectedAgent, selectedConnectionId, toast])

  const handleCopyResult = useCallback(() => {
    const outputData = result?.result || result?.output
    if (outputData) {
      navigator.clipboard.writeText(typeof outputData === 'string' ? outputData : JSON.stringify(outputData, null, 2))
      toast.show('Copied to clipboard', 'success')
    }
  }, [result, toast])

  const handleToggleHistory = useCallback(() => {
    setShowHistory((prev) => !prev)
  }, [])

  const isFormValid = () => {
    if (!selectedAgent) return false
    return selectedAgent.fields
      .filter((f) => f.required)
      .every((f) => formData[f.name]?.toString().trim())
  }

  return (
    <PageContainer>
      <Header>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <AgentIcon sx={{ color: 'text.secondary', fontSize: 28 }} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                AI Agents
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Specialized AI agents for research, analysis, writing, and more
              </Typography>
            </Box>
          </Box>
          <ActionButton
            startIcon={<HistoryIcon />}
            onClick={handleToggleHistory}
            variant={showHistory ? 'contained' : 'outlined'}
          >
            History ({tasks.length})
          </ActionButton>
        </Box>
      </Header>

      <ContentArea>
        <MainPanel>
          {/* Agent Selection */}
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
            Select Agent
          </Typography>
          <Grid container spacing={2} sx={{ mb: 4 }}>
            {AGENTS.map((agent) => (
              <Grid item xs={12} sm={6} md={4} key={agent.type}>
                <AgentCard
                  selected={selectedAgent?.type === agent.type}
                  onClick={() => handleSelectAgent(agent)}
                >
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: 1,  // Figma spec: 8px
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                        }}
                      >
                        <agent.icon color="inherit" sx={{ color: 'text.secondary' }} />
                      </Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {agent.name}
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {agent.description}
                    </Typography>
                  </CardContent>
                </AgentCard>
              </Grid>
            ))}
          </Grid>

          {/* Agent Form */}
          {selectedAgent && (
            <>
              <Divider sx={{ mb: 3 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                {selectedAgent.name} Configuration
              </Typography>
              <Paper sx={{ p: 3 }}>
                <Grid container spacing={2}>
                  {selectedAgent.fields.map((field) => {
                    // For data_analyst, hide data field if using sample data or database connection
                    if (selectedAgent.type === 'data_analyst' && field.name === 'data') {
                      const dataSource = formData.dataSource || 'paste_spreadsheet'
                      if (dataSource === 'sample_sales' || dataSource === 'sample_inventory') {
                        return (
                          <Grid item xs={12} key={field.name}>
                            <Alert severity="info" sx={{ mt: 1 }}>
                              Using sample {dataSource === 'sample_sales' ? 'sales' : 'inventory'} data. Just enter your question above!
                            </Alert>
                          </Grid>
                        )
                      }
                      if (dataSource === 'database_connection') {
                        return (
                          <Grid item xs={12} key={field.name}>
                            <ConnectionSelector
                              value={selectedConnectionId}
                              onChange={setSelectedConnectionId}
                              label="Select Database"
                              showStatus
                            />
                          </Grid>
                        )
                      }
                    }

                    // Conditionally hide question/compareRunId fields based on analysisType
                    if (selectedAgent.type === 'report_analyst') {
                      const analysisType = formData.analysisType || 'summarize'
                      if (field.name === 'question' && analysisType !== 'qa') return null
                      if (field.name === 'compareRunId' && analysisType !== 'compare') return null
                    }

                    return (
                      <Grid item xs={12} md={field.multiline ? 12 : 6} key={field.name}>
                        {field.type === 'reportRunPicker' ? (
                          <Autocomplete
                            freeSolo
                            options={recentRuns}
                            loading={runsLoading}
                            getOptionLabel={(option) => {
                              if (typeof option === 'string') return option
                              const name = option.templateName || option.template_name || option.templateId || option.template_id || ''
                              const date = option.createdAt || option.created_at || ''
                              const dateStr = date ? new Date(date).toLocaleDateString() : ''
                              return `${name} — ${dateStr} (${option.id?.slice(0, 8)}...)`
                            }}
                            value={formData[field.name] || null}
                            onChange={(_, value) => {
                              const runId = typeof value === 'string' ? value : value?.id || ''
                              handleFieldChange(field.name, runId)
                            }}
                            onInputChange={(_, value, reason) => {
                              if (reason === 'input') handleFieldChange(field.name, value)
                            }}
                            renderOption={(props, option) => {
                              const { key, ...rest } = props
                              const name = option.templateName || option.template_name || option.templateId || option.template_id || ''
                              const date = option.createdAt || option.created_at || ''
                              const dateStr = date ? new Date(date).toLocaleString() : ''
                              const period = [option.startDate || option.start_date, option.endDate || option.end_date].filter(Boolean).join(' – ')
                              return (
                                <li key={key} {...rest}>
                                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                                    <Typography variant="body2" fontWeight={500}>{name}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {dateStr}{period ? ` | ${period}` : ''} | {option.id?.slice(0, 12)}...
                                    </Typography>
                                  </Box>
                                </li>
                              )
                            }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                label={field.label}
                                placeholder={field.placeholder}
                                required={field.required}
                                InputProps={{
                                  ...params.InputProps,
                                  endAdornment: (
                                    <>
                                      {runsLoading ? <CircularProgress size={18} /> : null}
                                      {params.InputProps.endAdornment}
                                    </>
                                  ),
                                }}
                              />
                            )}
                          />
                        ) : field.type === 'select' ? (
                          <FormControl fullWidth>
                            <InputLabel>{field.label}</InputLabel>
                            <Select
                              value={formData[field.name] || field.default || ''}
                              label={field.label}
                              onChange={(e) => handleFieldChange(field.name, e.target.value)}
                            >
                              {field.options.map((opt) => {
                                // More user-friendly labels for data source options
                                let label = opt.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
                                if (opt === 'paste_spreadsheet') label = 'Paste from Spreadsheet (Recommended)'
                                if (opt === 'database_connection') label = 'Query Database Connection'
                                if (opt === 'sample_sales') label = 'Use Sample Sales Data'
                                if (opt === 'sample_inventory') label = 'Use Sample Inventory Data'
                                if (opt === 'custom_json') label = 'Enter Raw JSON (Advanced)'
                                return (
                                  <MenuItem key={opt} value={opt}>
                                    {label}
                                  </MenuItem>
                                )
                              })}
                            </Select>
                          </FormControl>
                        ) : field.type === 'multiselect' ? (
                          <FormControl fullWidth>
                            <InputLabel>{field.label}</InputLabel>
                            <Select
                              multiple
                              value={formData[field.name] || []}
                              label={field.label}
                              onChange={(e) => handleFieldChange(field.name, e.target.value)}
                              renderValue={(selected) => (
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                  {selected.map((value) => (
                                    <Chip key={value} label={value.replace(/_/g, ' ')} size="small" />
                                  ))}
                                </Box>
                              )}
                            >
                              {field.options.map((opt) => (
                                <MenuItem key={opt} value={opt}>
                                  {opt.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        ) : field.type === 'number' ? (
                          <TextField
                            fullWidth
                            type="number"
                            label={field.label}
                            value={formData[field.name] ?? field.default ?? ''}
                            onChange={(e) => handleFieldChange(field.name, parseInt(e.target.value))}
                            inputProps={{ min: field.min, max: field.max }}
                            required={field.required}
                          />
                        ) : field.type === 'spreadsheet' ? (
                          <TextField
                            fullWidth
                            label={formData.dataSource === 'custom_json' ? 'JSON Data' : field.label}
                            value={formData[field.name] || ''}
                            onChange={(e) => handleFieldChange(field.name, e.target.value)}
                            multiline
                            rows={field.rows || 4}
                            required={field.required}
                            placeholder={formData.dataSource === 'custom_json'
                              ? '[{"name": "John", "value": 100}, {"name": "Jane", "value": 200}]'
                              : field.placeholder || 'Copy from Excel/Sheets and paste here...'}
                            helperText={formData.dataSource === 'custom_json'
                              ? 'Enter valid JSON array of objects'
                              : 'Supports tab-separated (Excel) or comma-separated (CSV) data'}
                          />
                        ) : (
                          <TextField
                            fullWidth
                            label={field.label}
                            value={formData[field.name] || ''}
                            onChange={(e) => handleFieldChange(field.name, e.target.value)}
                            multiline={field.multiline}
                            rows={field.rows || 4}
                            required={field.required}
                            placeholder={field.placeholder}
                          />
                        )}
                      </Grid>
                    )
                  })}
                </Grid>

                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                  <ActionButton
                    variant="contained"
                    size="large"
                    startIcon={executing ? <CircularProgress size={20} color="inherit" /> : <RunIcon />}
                    onClick={handleRun}
                    disabled={!isFormValid() || executing}
                  >
                    {executing ? 'Running...' : `Run ${selectedAgent.name}`}
                  </ActionButton>
                </Box>
              </Paper>

              {/* Result */}
              {result && (
                <ResultCard ref={resultRef}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      Result
                      {result.status && (
                        <Chip
                          label={result.status}
                          size="small"
                          color={result.status === 'completed' ? 'success' : result.status === 'failed' ? 'error' : 'default'}
                          sx={{ ml: 1, fontSize: '12px', height: 22 }}
                        />
                      )}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      {/* Generate Report button for completed agent tasks */}
                      {result.status === 'completed' && result.task_id && (
                        <Tooltip title="Generate a report using this agent's output" arrow>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<ReportIcon fontSize="small" />}
                            onClick={() => setGenerateDialogOpen(true)}
                            sx={{ textTransform: 'none', mr: 0.5 }}
                            data-testid="agent-generate-report-button"
                          >
                            Generate Report
                          </Button>
                        </Tooltip>
                      )}
                      <SendToMenu
                        outputType={OutputType.TEXT}
                        payload={{
                          title: `${selectedAgent.name} Result`,
                          content: (() => { const o = result.result || result.output; return typeof o === 'string' ? o : JSON.stringify(o, null, 2) })(),
                        }}
                        sourceFeature={FeatureKey.AGENTS}
                      />
                      <IconButton size="small" onClick={handleCopyResult} aria-label="Copy result" data-testid="agent-copy-result-button">
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>

                  {/* Structured result for Report Analyst (V2 uses result.result, V1 uses result.output) */}
                  {(() => {
                    const agentOutput = result.result || result.output
                    if (selectedAgent.type === 'report_analyst' && agentOutput && typeof agentOutput === 'object') {
                      return <ReportAnalystResult output={agentOutput} />
                    }
                    const displayContent = typeof agentOutput === 'string' ? agentOutput : JSON.stringify(agentOutput, null, 2)
                    return (
                      <Typography
                        variant="body2"
                        component="pre"
                        sx={{
                          whiteSpace: 'pre-wrap',
                          fontFamily: 'monospace',
                          bgcolor: alpha(theme.palette.background.default, 0.5),
                          p: 2,
                          borderRadius: 1,
                          maxHeight: 400,
                          overflow: 'auto',
                        }}
                      >
                        {displayContent}
                      </Typography>
                    )
                  })()}
                </ResultCard>
              )}

              {/* V2: Team activity view during multi-agent execution */}
              {executing && useAgentStore.getState().activeTeam && (
                <Box sx={{ mt: 2 }}>
                  <TeamActivity teamData={useAgentStore.getState().activeTeam} compact />
                </Box>
              )}

              {/* V2: Feedback panel after task completion */}
              {result && result.task_id && result.status === 'completed' && (
                <Box sx={{ mt: 2 }}>
                  <FeedbackPanel
                    entityType="agent_task"
                    entityId={result.task_id}
                    showThumbs
                    showRating={false}
                    qualityScore={result.quality_score || null}
                  />
                </Box>
              )}
            </>
          )}
        </MainPanel>

        {/* History Sidebar */}
        {showHistory && (
          <Sidebar>
            <Box sx={{ p: 2, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Task History
              </Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              {tasks.length > 0 ? (
                <List>
                  {tasks.map((task) => {
                    const taskId = task.id || task.task_id
                    const isSelected = (result?.id || result?.task_id) === taskId
                    return (
                      <ListItem
                        key={taskId}
                        divider
                        onClick={() => {
                          const agentDef = AGENTS.find((a) => a.type === task.agent_type)
                          if (agentDef) setSelectedAgent(agentDef)
                          setResult(task)
                          setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
                        }}
                        sx={{
                          cursor: 'pointer',
                          bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                          borderLeft: isSelected ? `3px solid ${theme.palette.primary.main}` : '3px solid transparent',
                          '&:hover': {
                            bgcolor: alpha(theme.palette.primary.main, 0.04),
                          },
                          transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
                        }}
                      >
                        <ListItemText
                          primary={task.agent_type?.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                          secondary={
                            <>
                              <Chip
                                size="small"
                                label={task.status}
                                color={task.status === 'completed' ? 'success' : task.status === 'failed' ? 'error' : 'default'}
                                sx={{ mr: 1 }}
                              />
                              {new Date(task.created_at).toLocaleString()}
                            </>
                          }
                        />
                      </ListItem>
                    )
                  })}
                </List>
              ) : (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography color="text.secondary">No tasks yet</Typography>
                </Box>
              )}
            </Box>
          </Sidebar>
        )}
      </ContentArea>

      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          {error}
        </Alert>
      )}

      {/* Generate Report from Agent Dialog */}
      <GenerateReportDialog
        open={generateDialogOpen}
        onClose={() => setGenerateDialogOpen(false)}
        taskId={result?.task_id}
        templates={templates}
        connections={connections}
        onGenerate={async (taskId, config) => {
          const res = await generateReportFromTask(taskId, config)
          if (res) {
            toast.show(`Report generation started! Job ID: ${res.job_id || 'queued'}`, 'success')
          }
        }}
      />
    </PageContainer>
  )
}
