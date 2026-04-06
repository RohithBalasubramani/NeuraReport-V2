import { assistantChat } from '@/api/client'
import { neutral } from '@/app/theme'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useAppStore } from '@/stores/app'
import {
  useDocumentStore,
  useSpreadsheetStore,
  useTemplateCreatorStore,
} from '@/stores/content'
import {
  useDashboardStore,
  useAssistantStore,
  useConnectorStore,
  usePipelineRunStore,
  useWorkflowStore,
} from '@/stores/workspace'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import SendIcon from '@mui/icons-material/Send'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
const ROUTE_KNOWLEDGE = {
  '/': {
    pageTitle: 'Dashboard',
    starters: [
      'How do I generate my first report?',
      'What does each section of the dashboard show?',
      'How do I set up a database connection?',
    ],
    featureSummary: 'Overview of report generation activity and quick actions.',
  },
  '/connections': {
    pageTitle: 'Data Sources',
    starters: [
      'How do I connect to a PostgreSQL database?',
      'My connection test is failing. What should I check?',
      'What database types does NeuraReport support?',
    ],
    featureSummary: 'Manage database connections and test connectivity.',
  },
  '/templates': {
    pageTitle: 'Templates',
    starters: [
      'How do I create a template from a sample PDF?',
      'What are tokens and how do they work?',
      'Why is my template showing "not approved"?',
    ],
    featureSummary: 'Report templates define layout, styling, and data mapping.',
  },
  '/pipeline?mode=create': {
    pageTitle: 'Template Creator',
    starters: [
      'Walk me through the template creation process',
      'What happens after I upload a PDF?',
      'How does the AI extract tokens from my PDF?',
    ],
    featureSummary: 'Create report templates from PDFs using AI.',
  },
  '/reports': {
    pageTitle: 'Reports',
    starters: [
      'How do I generate a report?',
      'What inputs does report generation need?',
      'Why did my report generation fail?',
    ],
    featureSummary: 'Generate reports by combining templates with data sources.',
  },
  '/schedules': {
    pageTitle: 'Schedules',
    starters: [
      'How do I schedule a monthly report?',
      'Can I email scheduled reports automatically?',
      'How do I edit a schedule\'s timing?',
    ],
    featureSummary: 'Schedule automatic report generation at recurring intervals.',
  },
  '/jobs': {
    pageTitle: 'Jobs',
    starters: [
      'Why is my job stuck in pending?',
      'How do I retry a failed job?',
      'What is the Dead Letter Queue?',
    ],
    featureSummary: 'View and manage background jobs and their status.',
  },
  '/query': {
    pageTitle: 'Query Builder',
    starters: [
      'How do I phrase a question for NL2SQL?',
      'Can I edit the generated SQL before running it?',
      'How do I save a query for reuse?',
    ],
    featureSummary: 'Natural Language to SQL query builder.',
  },
  '/enrichment': {
    pageTitle: 'Enrichment',
    starters: [
      'What is data enrichment?',
      'How do I configure an enrichment source?',
      'How does the enrichment cache work?',
    ],
    featureSummary: 'Enrich data with additional information from external sources.',
  },
  '/federation': {
    pageTitle: 'Schema Federation',
    starters: [
      'What is schema federation?',
      'How do I query across multiple databases?',
      'How do I set up a virtual schema?',
    ],
    featureSummary: 'Build federated schemas across multiple database connections.',
  },
  '/synthesis': {
    pageTitle: 'Synthesis',
    starters: [
      'How does document synthesis work?',
      'How many documents can I synthesize at once?',
      'What kinds of questions work best?',
    ],
    featureSummary: 'Combine information from multiple documents into unified analysis.',
  },
  '/docqa': {
    pageTitle: 'Document Q&A',
    starters: [
      'How do I start a Q&A session?',
      'What document formats are supported?',
      'How accurate are the AI answers?',
    ],
    featureSummary: 'Chat-based question answering over uploaded documents.',
  },
  '/summary': {
    pageTitle: 'Summarization',
    starters: [
      'How do I summarize a document?',
      'What summary styles are available?',
      'Can I summarize multiple documents at once?',
    ],
    featureSummary: 'Generate concise summaries of documents or text.',
  },
  '/agents': {
    pageTitle: 'AI Agents',
    starters: [
      'What types of AI agents are available?',
      'How do I run a research agent?',
      'How long do agent tasks take?',
    ],
    featureSummary: 'Run specialized AI agents for research, analysis, and more.',
  },
  '/analyze': {
    pageTitle: 'Enhanced Analysis',
    starters: [
      'What can the AI analyze in my data?',
      'How do I upload data for analysis?',
      'What does the anomaly detection do?',
    ],
    featureSummary: 'AI-powered data analysis with chart suggestions and insights.',
  },
  '/documents': {
    pageTitle: 'Document Editor',
    starters: [
      'What can I do in the document editor?',
      'How do I collaborate with others?',
      'How do I export my document?',
    ],
    featureSummary: 'Rich text document editor with AI writing assistance.',
  },
  '/spreadsheets': {
    pageTitle: 'Spreadsheet Editor',
    starters: [
      'How do I use AI to generate formulas?',
      'How do I create a pivot table?',
      'Can I import data from a query?',
    ],
    featureSummary: 'Spreadsheet editor with formulas, pivot tables, and AI.',
  },
  '/dashboard-builder': {
    pageTitle: 'Dashboard Builder',
    starters: [
      'How do I add a widget to my dashboard?',
      'How do I connect a widget to data?',
      'How do dashboard filters work?',
    ],
    featureSummary: 'Build interactive dashboards with drag-and-drop widgets.',
  },
  '/connectors': {
    pageTitle: 'Connectors',
    starters: [
      'What external services can I connect to?',
      'How do I authenticate a connector?',
      'What is the difference between connectors and connections?',
    ],
    featureSummary: 'Connect to external services and APIs.',
  },
  '/workflows': {
    pageTitle: 'Workflow Builder',
    starters: [
      'How do I create an automated workflow?',
      'What types of workflow nodes are available?',
      'How do I set up a workflow trigger?',
    ],
    featureSummary: 'Build automated workflows with visual node-based editor.',
  },
  '/visualization': {
    pageTitle: 'Visualization',
    starters: [
      'What chart types are available?',
      'How do I configure chart data sources?',
      'Which visualization is best for my data?',
    ],
    featureSummary: 'Create standalone data visualizations and charts.',
  },
  '/knowledge': {
    pageTitle: 'Knowledge Library',
    starters: [
      'How do I add documents to the knowledge library?',
      'What is semantic search?',
      'How do I organize documents into collections?',
    ],
    featureSummary: 'Manage a searchable knowledge base of documents.',
  },
  '/design': {
    pageTitle: 'Design / Brand Kit',
    starters: [
      'How do I set my brand colors?',
      'How do brand settings affect reports?',
      'How do I upload a logo?',
    ],
    featureSummary: 'Configure brand identity for reports and exports.',
  },
  '/ingestion': {
    pageTitle: 'Data Ingestion',
    starters: [
      'How do I set up a folder watcher?',
      'Can I ingest data from emails?',
      'How does web clipping work?',
    ],
    featureSummary: 'Ingest data from files, email, and web sources.',
  },
  '/search': {
    pageTitle: 'Search',
    starters: [
      'How do I search across all my content?',
      'What can I search for?',
      'How do I save a search?',
    ],
    featureSummary: 'Search across all entities in NeuraReport.',
  },
  '/settings': {
    pageTitle: 'Settings',
    starters: [
      'How do I configure email delivery?',
      'Where do I set my preferences?',
      'How do I manage API keys?',
    ],
    featureSummary: 'Configure application settings and preferences.',
  },
  '/activity': {
    pageTitle: 'Activity',
    starters: [
      'What does the activity log show?',
      'How do I filter activities?',
      'Can I export the activity log?',
    ],
    featureSummary: 'View chronological log of all actions.',
  },
  '/stats': {
    pageTitle: 'Usage Statistics',
    starters: [
      'What usage metrics are tracked?',
      'How much has the AI been used?',
      'What do the cost numbers mean?',
    ],
    featureSummary: 'View usage analytics and cost tracking.',
  },
  '/ops': {
    pageTitle: 'Operations Console',
    starters: [
      'What does this system warning mean?',
      'How do I check LLM provider status?',
      'What is the circuit breaker state?',
    ],
    featureSummary: 'System health, monitoring, and debugging.',
  },
  '/pipeline': {
    pageTitle: 'Setup Wizard',
    starters: [
      'What do I need to get started?',
      'How do I add my first connection?',
      'What happens after setup?',
    ],
    featureSummary: 'First-time setup guide for NeuraReport.',
  },
  '/widgets': {
    pageTitle: 'Widget Gallery',
    starters: [
      'What widget types are available?',
      'How do I add a widget to a dashboard?',
      'How do I configure widget data?',
    ],
    featureSummary: 'Browse and configure dashboard widgets.',
  },
  '/history': {
    pageTitle: 'Version History',
    starters: [
      'How do I view previous versions?',
      'Can I restore an older version?',
      'How does version comparison work?',
    ],
    featureSummary: 'Browse version history of templates and documents.',
  },
}

/**
 * Get route knowledge for a given pathname.
 * Tries exact match, then prefix match, then fallback.
 */
function getRouteKnowledge(pathname) {
  // Exact match
  if (ROUTE_KNOWLEDGE[pathname]) {
    return ROUTE_KNOWLEDGE[pathname]
  }

  // Handle parameterized routes like /templates/abc/edit
  if (pathname.includes('/edit')) {
    const base = pathname.split('/').slice(0, 2).join('/')
    const editKey = `${base}/edit`
    // Not in knowledge, but the parent might be
    if (ROUTE_KNOWLEDGE[base]) {
      return {
        ...ROUTE_KNOWLEDGE[base],
        pageTitle: `${ROUTE_KNOWLEDGE[base].pageTitle} Editor`,
      }
    }
  }

  // Prefix match — find the longest matching route
  let bestMatch = null
  let bestLen = 0
  for (const [route, knowledge] of Object.entries(ROUTE_KNOWLEDGE)) {
    if (pathname.startsWith(route) && route.length > bestLen) {
      bestMatch = knowledge
      bestLen = route.length
    }
  }

  if (bestMatch) return bestMatch

  // Fallback
  return {
    pageTitle: 'NeuraReport',
    starters: [
      'What can I do in NeuraReport?',
      'How do I get started?',
      'What features are available?',
    ],
    featureSummary: 'NeuraReport V2 report generation platform.',
  }
}

const ROUTE_KNOWLEDGE_EXPORT = ROUTE_KNOWLEDGE

// === From: useAssistantContext.js ===
/**
 * Live state bridge hook for the NeuraReport assistant.
 *
 * Gathers current application context from ALL Zustand stores and the router
 * to send with each assistant chat message. This grounds the assistant's
 * responses in the user's actual session state — not just the route.
 *
 * Covers: connections, templates, template creator (Intelligence Canvas),
 * documents, spreadsheets, dashboards, workflows, connectors, pipelines,
 * jobs, errors, and loading states.
 */

/**
 * Safely extract a summary from a store value, avoiding sending
 * massive objects (HTML, full data arrays) to the backend.
 */
function summarizeJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return null
  const running = jobs.filter((j) => j?.status === 'running')
  const failed = jobs.filter((j) => j?.status === 'failed')
  const pending = jobs.filter((j) => ['pending', 'queued'].includes(j?.status))
  return {
    total: jobs.length,
    running: running.length,
    failed: failed.length,
    pending: pending.length,
    recentFailed: failed.slice(0, 3).map((j) => ({
      id: j.id,
      templateName: j.template_name || j.templateName || null,
      error: (j.error || j.message || '').slice(0, 120),
    })),
  }
}

function summarizePipelineRuns(runs) {
  if (!runs || typeof runs !== 'object') return null
  const entries = Object.values(runs)
  if (entries.length === 0) return null
  const active = entries.filter((r) => r.status === 'running')
  if (active.length === 0) return null
  return active.slice(0, 2).map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    progress: r.progress,
    currentStage: r.currentStage || null,
    error: r.error || null,
    stagesSummary: (r.stages || [])
      .filter((s) => s.status !== 'pending')
      .map((s) => `${s.label}: ${s.status}`)
      .join(', '),
  }))
}

function useAssistantContext() {
  const location = useLocation()
  const route = location.pathname

  // ── App Store (core state) ──
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const templateId = useAppStore((s) => s.templateId)
  const templates = useAppStore((s) => s.templates)
  const jobs = useAppStore((s) => s.jobs)
  const setupStep = useAppStore((s) => s.setupStep)
  const savedConnections = useAppStore((s) => s.savedConnections)
  const verifyArtifacts = useAppStore((s) => s.verifyArtifacts)
  const runs = useAppStore((s) => s.runs)

  // ── Template Creator Store (Intelligence Canvas) ──
  const tcTemplateName = useTemplateCreatorStore((s) => s.templateName)
  const tcSourceMode = useTemplateCreatorStore((s) => s.sourceMode)
  const tcTemplateKind = useTemplateCreatorStore((s) => s.templateKind)
  const tcHasHtml = useTemplateCreatorStore((s) => !!s.currentHtml)
  const tcSchemaExt = useTemplateCreatorStore((s) => s.schemaExt)
  const tcAutoMapping = useTemplateCreatorStore((s) => s.autoMapping)
  const tcUserMapping = useTemplateCreatorStore((s) => s.userMapping)
  const tcUnmappedTokens = useTemplateCreatorStore((s) => s.unmappedTokens)
  const tcMappingConfidence = useTemplateCreatorStore((s) => s.mappingConfidence)
  const tcMappingLoading = useTemplateCreatorStore((s) => s.mappingLoading)
  const tcValidationIssues = useTemplateCreatorStore((s) => s.validationIssues)
  const tcReadinessScore = useTemplateCreatorStore((s) => s.overallReadinessScore)
  const tcFinalized = useTemplateCreatorStore((s) => s.finalized)
  const tcValidating = useTemplateCreatorStore((s) => s.validating)
  const tcContractResult = useTemplateCreatorStore((s) => s.contractBuildResult)
  const tcDryRunResult = useTemplateCreatorStore((s) => s.dryRunResult)
  const tcCanvasMode = useTemplateCreatorStore((s) => s.canvasModeOverride)
  const tcSelectedToken = useTemplateCreatorStore((s) => s.selectedToken)
  const tcSelectedIssue = useTemplateCreatorStore((s) => s.selectedIssue)
  const tcSsimScore = useTemplateCreatorStore((s) => s.ssimScore)
  const tcConnectionId = useTemplateCreatorStore((s) => s.connectionId)
  const tcAgentResults = useTemplateCreatorStore((s) => s.agentResults)
  const tcError = useTemplateCreatorStore((s) => s.error)

  // ── Document Store ──
  const currentDocument = useDocumentStore((s) => s.currentDocument)
  const docComments = useDocumentStore((s) => s.comments)
  const docCollaborators = useDocumentStore((s) => s.collaborators)
  const docSaving = useDocumentStore((s) => s.saving)
  const docError = useDocumentStore((s) => s.error)
  const docAiResult = useDocumentStore((s) => s.aiResult)

  // ── Spreadsheet Store ──
  const currentSpreadsheet = useSpreadsheetStore((s) => s.currentSpreadsheet)
  const ssActiveSheet = useSpreadsheetStore((s) => s.activeSheetIndex)
  const ssPivotTables = useSpreadsheetStore((s) => s.pivotTables)
  const ssSaving = useSpreadsheetStore((s) => s.saving)
  const ssError = useSpreadsheetStore((s) => s.error)

  // ── Dashboard Store ──
  const currentDashboard = useDashboardStore((s) => s.currentDashboard)
  const dashWidgets = useDashboardStore((s) => s.widgets)
  const dashFilters = useDashboardStore((s) => s.filters)
  const dashInsights = useDashboardStore((s) => s.insights)
  const dashRefreshing = useDashboardStore((s) => s.refreshing)
  const dashError = useDashboardStore((s) => s.error)

  // ── Connector Store ──
  const connCurrentConnection = useConnectorStore((s) => s.currentConnection)
  const connSchema = useConnectorStore((s) => s.schema)
  const connTesting = useConnectorStore((s) => s.testing)
  const connQuerying = useConnectorStore((s) => s.querying)
  const connError = useConnectorStore((s) => s.error)

  // ── Workflow Store ──
  const currentWorkflow = useWorkflowStore((s) => s.currentWorkflow)
  const wfCurrentExecution = useWorkflowStore((s) => s.currentExecution)
  const wfPendingApprovals = useWorkflowStore((s) => s.pendingApprovals)
  const wfExecuting = useWorkflowStore((s) => s.executing)
  const wfError = useWorkflowStore((s) => s.error)

  // ── Pipeline Store ──
  const pipelineRuns = usePipelineRunStore((s) => s.runs)

  const routeKnowledge = getRouteKnowledge(route)

  // ── Collect errors across all stores ──
  const errors = [tcError, docError, ssError, dashError, connError, wfError].filter(Boolean)

  // ── Collect loading indicators ──
  const loadingKeys = []
  if (tcMappingLoading) loadingKeys.push('mapping')
  if (tcValidating) loadingKeys.push('validation')
  if (docSaving) loadingKeys.push('document_save')
  if (ssSaving) loadingKeys.push('spreadsheet_save')
  if (dashRefreshing) loadingKeys.push('dashboard_refresh')
  if (connTesting) loadingKeys.push('connection_test')
  if (connQuerying) loadingKeys.push('query_execution')
  if (wfExecuting) loadingKeys.push('workflow_execution')

  // ── Build Intelligence Canvas context (only if on template creator) ──
  const isTemplateCreator = route.startsWith('/pipeline?mode=create') || route.startsWith('/templates/') && route.endsWith('/edit')
  let templateCreatorState = null
  if (isTemplateCreator) {
    const tokenCount = tcSchemaExt?.tokens?.length || tcSchemaExt?.fields?.length || 0
    const mappedCount = Object.keys(tcUserMapping || {}).length
    const unmappedCount = (tcUnmappedTokens || []).length
    const avgConfidence = (() => {
      const vals = Object.values(tcMappingConfidence || {})
      if (vals.length === 0) return null
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100
    })()
    const activeAgents = Object.entries(tcAgentResults || {})
      .filter(([, v]) => v != null)
      .map(([k]) => k)

    templateCreatorState = {
      templateName: tcTemplateName || null,
      sourceMode: tcSourceMode,
      templateKind: tcTemplateKind,
      hasHtml: tcHasHtml,
      ssimScore: tcSsimScore,
      canvasMode: tcCanvasMode || 'auto',
      connectionId: tcConnectionId || null,
      tokens: { total: tokenCount, mapped: mappedCount, unmapped: unmappedCount },
      avgMappingConfidence: avgConfidence,
      validationIssues: (tcValidationIssues || []).slice(0, 5).map((i) => ({
        severity: i.severity || i.level,
        message: (i.message || i.description || '').slice(0, 100),
      })),
      readinessScore: tcReadinessScore,
      finalized: tcFinalized,
      hasContract: !!tcContractResult,
      hasDryRun: !!tcDryRunResult,
      dryRunSuccess: tcDryRunResult?.success ?? null,
      selectedToken: tcSelectedToken?.name || tcSelectedToken?.key || null,
      selectedIssue: tcSelectedIssue?.message?.slice(0, 80) || null,
      activeAgentResults: activeAgents,
      error: tcError || null,
    }
  }

  // ── Build the full context object ──
  const context = {
    route,
    page_title: routeKnowledge.pageTitle,

    // Core entity selection
    selected_entities: {
      connectionId: activeConnectionId || null,
      connectionName: activeConnection?.name || null,
      connectionType: activeConnection?.db_type || activeConnection?.type || null,
      templateId: templateId || null,
      templateName: templates?.find?.((t) => t.id === templateId)?.name || null,
      hasVerifyArtifacts: !!verifyArtifacts,
    },

    // Workflow / setup state
    workflow_state: {
      setupStep: setupStep || null,
      hasConnections: (savedConnections || []).length > 0,
      connectionCount: (savedConnections || []).length,
      hasTemplates: (templates || []).length > 0,
      templateCount: (templates || []).length,
      jobs: summarizeJobs(jobs),
      pipelines: summarizePipelineRuns(pipelineRuns),
    },

    // Intelligence Canvas (Template Creator) — deep state
    template_creator: templateCreatorState,

    // Document editor state
    document: currentDocument
      ? {
          id: currentDocument.id,
          title: currentDocument.title || null,
          category: currentDocument.category || null,
          hasContent: !!(currentDocument.content || currentDocument.html),
          commentCount: (docComments || []).length,
          collaboratorCount: (docCollaborators || []).length,
          saving: docSaving,
          lastAiAction: docAiResult?.action || null,
        }
      : null,

    // Spreadsheet editor state
    spreadsheet: currentSpreadsheet
      ? {
          id: currentSpreadsheet.id,
          name: currentSpreadsheet.name || null,
          sheetCount: (currentSpreadsheet.sheets || []).length,
          activeSheetIndex: ssActiveSheet,
          activeSheetName: currentSpreadsheet.sheets?.[ssActiveSheet]?.name || null,
          hasPivotTables: (ssPivotTables || []).length > 0,
          pivotCount: (ssPivotTables || []).length,
          saving: ssSaving,
        }
      : null,

    // Dashboard builder state
    dashboard: currentDashboard
      ? {
          id: currentDashboard.id,
          name: currentDashboard.name || null,
          widgetCount: (dashWidgets || []).length,
          widgetTypes: [...new Set((dashWidgets || []).map((w) => w.type).filter(Boolean))],
          filterCount: (dashFilters || []).length,
          insightCount: (dashInsights || []).length,
          refreshing: dashRefreshing,
        }
      : null,

    // Connector / database state
    connector: connCurrentConnection
      ? {
          id: connCurrentConnection.id,
          type: connCurrentConnection.type || connCurrentConnection.connector_type || null,
          name: connCurrentConnection.name || null,
          hasSchema: !!connSchema,
          tableCount: connSchema?.tables?.length || 0,
          testing: connTesting,
          querying: connQuerying,
        }
      : null,

    // Workflow automation state
    workflow: currentWorkflow
      ? {
          id: currentWorkflow.id,
          name: currentWorkflow.name || null,
          nodeCount: (currentWorkflow.nodes || []).length,
          triggerType: currentWorkflow.trigger?.type || null,
          executionStatus: wfCurrentExecution?.status || null,
          pendingApprovals: (wfPendingApprovals || []).length,
          executing: wfExecuting,
        }
      : null,

    // Cross-cutting state
    errors,
    loading_keys: loadingKeys,
  }

  return {
    context,
    starters: routeKnowledge.starters,
    featureSummary: routeKnowledge.featureSummary,
    pageTitle: routeKnowledge.pageTitle,
  }
}

// already exported above

// === From: AssistantPanel.jsx ===

const PANEL_WIDTH = { xs: '100vw', sm: 380 }

function ChatMessage({ message }) {
  const isUser = message.role === 'user'
  const Icon = isUser ? PersonOutlineIcon : SmartToyOutlinedIcon

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 1,
        px: 2,
        py: 0.75,
        alignItems: 'flex-start',
      }}
    >
      <Box
        sx={{
          width: 28,
          height: 28,
          minWidth: 28,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: isUser ? neutral[900] : alpha(neutral[200], 0.6),
          mt: 0.25,
        }}
      >
        <Icon sx={{ fontSize: 16, color: isUser ? '#fff' : neutral[600] }} />
      </Box>

      <Box
        sx={{
          maxWidth: 'calc(100% - 44px)',
          p: 1.5,
          borderRadius: 1.5,
          bgcolor: isUser
            ? neutral[900]
            : (theme) =>
                theme.palette.mode === 'dark'
                  ? alpha(neutral[700], 0.5)
                  : alpha(neutral[100], 0.8),
          color: isUser ? '#fff' : 'text.primary',
        }}
      >
        <Typography
          variant="body2"
          sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.55,
            fontSize: '0.8125rem',
          }}
        >
          {message.content}
          {message.streaming && (
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                width: 6,
                height: 14,
                ml: 0.5,
                bgcolor: 'primary.main',
                animation: 'blink 1s step-end infinite',
                '@keyframes blink': {
                  '50%': { opacity: 0 },
                },
              }}
            />
          )}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: isUser ? alpha('#fff', 0.5) : 'text.disabled', mt: 0.5, display: 'block' }}
        >
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Typography>
      </Box>
    </Box>
  )
}

export default function AssistantPanel({ open, onClose }) {
  const navigate = useNavigate()
  const { execute } = useInteraction()
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const {
    messages,
    loading,
    followUps,
    actions,
    addUserMessage,
    addAssistantMessage,
    setLoading,
    setFollowUps,
    setActions,
    clearMessages,
    getMessagesForApi,
    lastRoute,
    setLastRoute,
  } = useAssistantStore()

  const { context, starters, pageTitle } = useAssistantContext()

  // Track route changes for contextual starters
  useEffect(() => {
    if (context.route !== lastRoute) {
      setLastRoute(context.route)
    }
  }, [context.route, lastRoute, setLastRoute])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loading])

  // Focus input when panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200)
    }
  }, [open])

  const sendMessage = useCallback(
    async (text) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return

      setInputValue('')
      addUserMessage(trimmed)
      setLoading(true)

      try {
        await execute({
          type: InteractionType.EXECUTE,
          label: 'Ask assistant',
          reversibility: Reversibility.FULLY_REVERSIBLE,
          suppressSuccessToast: true,
          suppressErrorToast: true,
          intent: { source: 'assistant', route: context.route },
          action: async () => {
            const apiMessages = getMessagesForApi()
            const result = await assistantChat(apiMessages, context, 'auto')
            addAssistantMessage(result.answer || 'I could not generate a response.')
            setFollowUps(result.follow_ups || [])
            setActions(result.actions || [])
          },
        })
      } catch (err) {
        addAssistantMessage(
          'Sorry, I encountered an error. Please try again or check the Operations Console for system status.'
        )
        setFollowUps([])
        setActions([])
      } finally {
        setLoading(false)
      }
    },
    [
      loading,
      context,
      execute,
      addUserMessage,
      addAssistantMessage,
      setLoading,
      setFollowUps,
      setActions,
      getMessagesForApi,
    ]
  )

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage(inputValue)
      }
    },
    [inputValue, sendMessage]
  )

  const handleFollowUpClick = useCallback(
    (question) => {
      sendMessage(question)
    },
    [sendMessage]
  )

  const handleActionClick = useCallback(
    (action) => {
      if (action.type === 'navigate' && action.path) {
        navigate(action.path)
      }
    },
    [navigate]
  )

  // Show starters when there's only the welcome message
  const showStarters = messages.length <= 1 && !loading

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      ModalProps={{ keepMounted: true }}
      PaperProps={{
        sx: {
          width: PANEL_WIDTH,
          borderLeft: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? alpha(neutral[800], 0.5)
              : alpha(neutral[50], 0.8),
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <SmartToyOutlinedIcon sx={{ fontSize: 20, color: 'primary.main' }} />
          <Typography variant="subtitle2" fontWeight={600}>
            Assistant
          </Typography>
          {pageTitle && (
            <Chip
              label={pageTitle}
              size="small"
              sx={{
                height: 20,
                fontSize: '0.6875rem',
                bgcolor: alpha(neutral[200], 0.5),
              }}
            />
          )}
        </Stack>
        <Stack direction="row" spacing={0.5}>
          <IconButton
            size="small"
            onClick={clearMessages}
            title="Clear conversation"
            sx={{ color: 'text.secondary' }}
          >
            <DeleteOutlineIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton size="small" onClick={onClose} title="Close (Esc)">
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      </Box>

      {/* Messages area */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          py: 1,
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: alpha(neutral[400], 0.3),
            borderRadius: 2,
          },
        }}
      >
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Loading indicator */}
        {loading && (
          <Box sx={{ display: 'flex', gap: 1, px: 2, py: 0.75, alignItems: 'flex-start' }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                minWidth: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(neutral[200], 0.6),
              }}
            >
              <SmartToyOutlinedIcon sx={{ fontSize: 16, color: neutral[600] }} />
            </Box>
            <Box
              sx={{
                p: 1.5,
                borderRadius: 1.5,
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? alpha(neutral[700], 0.5)
                    : alpha(neutral[100], 0.8),
              }}
            >
              <Stack direction="row" spacing={0.5} alignItems="center">
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">
                  Thinking...
                </Typography>
              </Stack>
            </Box>
          </Box>
        )}

        {/* Contextual starters */}
        {showStarters && starters.length > 0 && (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Try asking:
            </Typography>
            <Stack spacing={0.5}>
              {starters.map((question) => (
                <Chip
                  key={question}
                  label={question}
                  size="small"
                  variant="outlined"
                  onClick={() => handleFollowUpClick(question)}
                  sx={{
                    height: 'auto',
                    py: 0.5,
                    '& .MuiChip-label': {
                      whiteSpace: 'normal',
                      fontSize: '0.75rem',
                      lineHeight: 1.4,
                    },
                    cursor: 'pointer',
                    '&:hover': { bgcolor: alpha(neutral[100], 0.5) },
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {/* Follow-up suggestions */}
        {!loading && followUps.length > 0 && (
          <Box sx={{ px: 2, py: 0.5 }}>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {followUps.map((q) => (
                <Chip
                  key={q}
                  label={q}
                  size="small"
                  variant="outlined"
                  color="primary"
                  onClick={() => handleFollowUpClick(q)}
                  sx={{
                    height: 'auto',
                    py: 0.25,
                    '& .MuiChip-label': {
                      whiteSpace: 'normal',
                      fontSize: '0.6875rem',
                      lineHeight: 1.3,
                    },
                    cursor: 'pointer',
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {/* Action buttons */}
        {!loading && actions.length > 0 && (
          <Box sx={{ px: 2, py: 0.5 }}>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
              {actions.map((action, i) => (
                <Chip
                  key={i}
                  label={action.label || action.path || 'Action'}
                  size="small"
                  color="primary"
                  icon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                  onClick={() => handleActionClick(action)}
                  sx={{
                    cursor: 'pointer',
                    '& .MuiChip-label': { fontSize: '0.6875rem' },
                  }}
                />
              ))}
            </Stack>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Box>

      <Divider />

      {/* Input area */}
      <Box sx={{ p: 1.5, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            maxRows={4}
            placeholder="Ask about this page..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            variant="outlined"
            size="small"
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                fontSize: '0.8125rem',
              },
            }}
          />
          <IconButton
            onClick={() => sendMessage(inputValue)}
            disabled={!inputValue.trim() || loading}
            color="primary"
            size="small"
            sx={{
              bgcolor: inputValue.trim() ? 'primary.main' : 'transparent',
              color: inputValue.trim() ? '#fff' : 'text.disabled',
              '&:hover': {
                bgcolor: inputValue.trim() ? 'primary.dark' : 'transparent',
              },
              width: 34,
              height: 34,
              minWidth: 34,
            }}
          >
            {loading ? <CircularProgress size={18} color="inherit" /> : <SendIcon sx={{ fontSize: 18 }} />}
          </IconButton>
        </Box>
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ mt: 0.5, display: 'block', textAlign: 'center', fontSize: '0.625rem' }}
        >
          Powered by NeuraReport AI
        </Typography>
      </Box>
    </Drawer>
  )
}
