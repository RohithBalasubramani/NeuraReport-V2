import { ErrorBoundary, ToastProvider } from '@/components/core'
import { JobsPanel } from '@/features/Jobs.jsx'
import { CommandPalette } from '@/features/Utility.jsx'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'

// Redirect helper for /templates/:id/edit → /pipeline?templateId=:id&mode=edit
function TemplateEditRedirect() {
  const { templateId } = useParams()
  return <Navigate to={`/pipeline?templateId=${templateId}&mode=edit`} replace />
}
import { recordIntent, updateIntent } from '@/api/monitoring'
import { neutral } from './theme.js'
import { SHORTCUTS, useBootstrapState, useKeyboardShortcuts } from '@/hooks/hooks'
import { ProjectLayout } from '@/Navigation'
import { readPreferences, subscribePreferences } from '@/utils/helpers'
import { ActivityPanel, NetworkStatusBanner, OperationHistoryProvider } from '@/components/ux'
import {
  UXGovernanceProvider,
  useInteraction,
  useNavigateInteraction,
  InteractionType,
  Reversibility,
} from '@/components/governance'
const AssistantPanel = lazy(() => import('@/features/Assistant.jsx'))
// UX Infrastructure - Premium interaction components
// UX Governance - Enforced interaction safety

// Lazy-loaded pages - Main app pages
const DashboardPage = lazy(() => import('@/features/Dashboard.jsx'))
const ConnectionsPage = lazy(() => import('@/features/Connections.jsx'))
const TemplatesPage = lazy(() => import('@/template-manager'))
const JobsPage = lazy(() => import('@/features/Jobs.jsx'))
const ReportsPage = lazy(() => import('@/features/Reports.jsx'))
const SchedulesPage = lazy(() => import('@/features/Schedules.jsx'))
const AnalyzePage = lazy(() => import('@/data-analyzer').then(m => ({ default: m.AnalyzePageContainer })))
const EnhancedAnalyzePage = lazy(() => import('@/data-analyzer'))
const SettingsPage = lazy(() => import('@/features/Settings.jsx'))
const ActivityPage = lazy(() => import('@/features/Timeline.jsx').then(m => ({ default: m.ActivityPage })))
const HistoryPage = lazy(() => import('@/features/Timeline.jsx').then(m => ({ default: m.HistoryPage })))
const UsageStatsPage = lazy(() => import('@/features/Monitoring.jsx').then(m => ({ default: m.UsageStatsPage })))
const OpsConsolePage = lazy(() => import('@/features/Monitoring.jsx').then(m => ({ default: m.OpsConsolePage })))

// AI Features
const QueryBuilderPage = lazy(() => import('@/features/DataQuery.jsx').then(m => ({ default: m.QueryBuilderPage })))
const EnrichmentConfigPage = lazy(() => import('@/features/DataEnrichment.jsx').then(m => ({ default: m.EnrichmentConfigPage })))
const SchemaBuilderPage = lazy(() => import('@/features/DataQuery.jsx').then(m => ({ default: m.SchemaBuilderPage })))
const SynthesisPage = lazy(() => import('@/features/AiText.jsx').then(m => ({ default: m.SynthesisPage })))
const DocumentQAPage = lazy(() => import('@/features/DocQA.jsx'))
const SummaryPage = lazy(() => import('@/features/AiText.jsx').then(m => ({ default: m.SummaryPage })))

// Unified Pipeline
const PipelineChatPage = lazy(() => import('@/features/pipeline/PipelineChatPage'))

// Document Editing & Creation
const DocumentEditorPage = lazy(() => import('@/features/Documents.jsx'))
const SpreadsheetEditorPage = lazy(() => import('@/features/Spreadsheets.jsx'))
const DashboardBuilderPage = lazy(() => import('@/dashboard-builder'))
const ConnectorsPage = lazy(() => import('@/features/DataInput.jsx').then(m => ({ default: m.ConnectorsPage })))
const WorkflowBuilderPage = lazy(() => import('@/features/Workflows.jsx'))

// New Feature Pages
const AgentsPage = lazy(() => import('@/features/Agents.jsx'))
const SearchPage = lazy(() => import('@/features/DataEnrichment.jsx').then(m => ({ default: m.SearchPageContainer })))
const VisualizationPage = lazy(() => import('@/features/Visual.jsx').then(m => ({ default: m.VisualizationPageContainer })))
const KnowledgePage = lazy(() => import('@/features/ContentTools.jsx').then(m => ({ default: m.KnowledgePageContainer })))
const DesignPage = lazy(() => import('@/features/ContentTools.jsx').then(m => ({ default: m.DesignPageContainer })))
const IngestionPage = lazy(() => import('@/features/DataInput.jsx').then(m => ({ default: m.IngestionPageContainer })))
const WidgetsPage = lazy(() => import('@/features/Visual.jsx').then(m => ({ default: m.WidgetsPageContainer })))
const LoggerPage = lazy(() => import('@/features/Monitoring.jsx').then(m => ({ default: m.LoggerPageContainer })))
const NotFoundPage = lazy(() => import('@/Pages.jsx').then(m => ({ default: m.NotFoundPage })))

// Legacy lazy imports removed — routes now redirect to /pipeline

const intentAuditClient = { recordIntent, updateIntent }

// Loading fallback component
function PageLoader() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 400,
      }}
    >
      <Stack alignItems="center" spacing={2}>
        <CircularProgress size={32} />
        <Typography variant="body2" color="text.secondary">
          Loading...
        </Typography>
      </Stack>
    </Box>
  )
}

// Query client configuration
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30000,
      },
    },
  })
}

// App Providers wrapper
function AppProviders({ children }) {
  const queryClient = useMemo(createQueryClient, [])

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </ThemeProvider>
  )
}

// Main app content with shell layout
function AppContent() {
  // Bootstrap state (hydrate from localStorage)
  useBootstrapState()

  // UI State
  const { execute } = useInteraction()
  const [jobsOpen, setJobsOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)

  // Handlers
  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'app', ...intent },
      action,
    })
  }, [execute])

  const handleOpenJobs = useCallback(
    () => executeUI('Open jobs panel', () => setJobsOpen(true), { panel: 'jobs' }),
    [executeUI],
  )
  const handleCloseJobs = useCallback(
    () => executeUI('Close jobs panel', () => setJobsOpen(false), { panel: 'jobs' }),
    [executeUI],
  )
  const handleOpenCommandPalette = useCallback(
    () => executeUI('Open command palette', () => setCommandPaletteOpen(true), { panel: 'command-palette' }),
    [executeUI],
  )
  const handleCloseCommandPalette = useCallback(
    () => executeUI('Close command palette', () => setCommandPaletteOpen(false), { panel: 'command-palette' }),
    [executeUI],
  )
  const handleOpenActivity = useCallback(
    () => executeUI('Open activity panel', () => setActivityOpen(true), { panel: 'activity' }),
    [executeUI],
  )
  const handleCloseActivity = useCallback(
    () => executeUI('Close activity panel', () => setActivityOpen(false), { panel: 'activity' }),
    [executeUI],
  )
  const handleOpenAssistant = useCallback(
    () => executeUI('Open assistant', () => {
      // Close other panels for mutual exclusion
      setJobsOpen(false)
      setActivityOpen(false)
      setAssistantOpen(true)
    }, { panel: 'assistant' }),
    [executeUI],
  )
  const handleCloseAssistant = useCallback(
    () => executeUI('Close assistant', () => setAssistantOpen(false), { panel: 'assistant' }),
    [executeUI],
  )

  const handleSkipToContent = useCallback(() => {
    return executeUI('Skip to content', () => {
      const target = document.getElementById('main-content')
      if (target) {
        target.focus()
        target.scrollIntoView({ behavior: 'smooth' })
      }
    }, { action: 'skip-to-content' })
  }, [executeUI])

  // Register global keyboard shortcuts
  useKeyboardShortcuts({
    [SHORTCUTS.COMMAND_PALETTE]: handleOpenCommandPalette,
    [SHORTCUTS.ASSISTANT]: handleOpenAssistant,
    'escape': () => {
      if (commandPaletteOpen) handleCloseCommandPalette()
      else if (assistantOpen) handleCloseAssistant()
      else if (activityOpen) handleCloseActivity()
      else if (jobsOpen) handleCloseJobs()
    },
  })

  useEffect(() => {
    const handleOpenCommandPaletteEvent = () => {
      handleOpenCommandPalette().catch(() => {})
    }
    const handleOpenJobsPanelEvent = () => {
      handleOpenJobs().catch(() => {})
    }
    const handleOpenActivityPanelEvent = () => {
      handleOpenActivity().catch(() => {})
    }
    const handleOpenAssistantEvent = () => {
      handleOpenAssistant().catch(() => {})
    }
    window.addEventListener('neura:open-command-palette', handleOpenCommandPaletteEvent)
    window.addEventListener('neura:open-jobs-panel', handleOpenJobsPanelEvent)
    window.addEventListener('neura:open-activity-panel', handleOpenActivityPanelEvent)
    window.addEventListener('neura:open-assistant', handleOpenAssistantEvent)
    return () => {
      window.removeEventListener('neura:open-command-palette', handleOpenCommandPaletteEvent)
      window.removeEventListener('neura:open-jobs-panel', handleOpenJobsPanelEvent)
      window.removeEventListener('neura:open-activity-panel', handleOpenActivityPanelEvent)
      window.removeEventListener('neura:open-assistant', handleOpenAssistantEvent)
    }
  }, [handleOpenCommandPalette, handleOpenJobs, handleOpenActivity, handleOpenAssistant])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const applyCompactTables = (prefs) => {
      const enabled = prefs?.compactTables ?? false
      document.body.dataset.compactTables = enabled ? 'true' : 'false'
    }
    applyCompactTables(readPreferences())
    return subscribePreferences(applyCompactTables)
  }, [])

  return (
    <>
      {/* Network Status Banner - Visible connectivity feedback */}
      <NetworkStatusBanner />

      {/* Skip to content link for accessibility */}
      <Box
        component="a"
        href="#main-content"
        data-testid="skip-to-content"
        onClick={(e) => {
          e.preventDefault()
          handleSkipToContent()
        }}
        sx={{
          position: 'fixed',
          top: -40,
          left: 16,
          zIndex: 9999,
          bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
          color: 'primary.contrastText',
          px: 2,
          py: 1,
          borderRadius: 1,
          textDecoration: 'none',
          fontWeight: 600,
          transition: 'top 160ms ease',
          '&:focus-visible': {
            top: 16,
            outline: '2px solid',
            outlineColor: 'primary.dark',
            outlineOffset: 2,
          },
        }}
      >
        Skip to content
      </Box>

      {/* Main Content */}
      <Box
        id="main-content"
        component="main"
        tabIndex={-1}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
          minHeight: '100vh',
          bgcolor: 'background.default',
        }}
      >
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Unified Pipeline — single entry point for all template workflows */}
            <Route path="/pipeline" element={<PipelineChatPage />} />
            <Route path="/pipeline/:sessionId" element={<PipelineChatPage />} />

            {/* Legacy routes → redirect to unified pipeline */}
            <Route path="/setup/wizard" element={<Navigate to="/pipeline" replace />} />
            <Route path="/setup" element={<Navigate to="/" replace />} />
            <Route path="/generate" element={<Navigate to="/reports" replace />} />
            <Route path="/templates/new" element={<Navigate to="/pipeline?mode=create" replace />} />
            <Route path="/templates/new/chat" element={<Navigate to="/pipeline?mode=describe" replace />} />
            <Route path="/templates/:templateId/edit" element={<TemplateEditRedirect />} />

            {/* Main app routes with ProjectLayout */}
            <Route element={<ProjectLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
              <Route path="/templates" element={<TemplatesPage />} />
              <Route path="/jobs" element={<JobsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/analyze" element={<EnhancedAnalyzePage />} />
              <Route path="/analyze/legacy" element={<AnalyzePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/stats" element={<UsageStatsPage />} />
              <Route path="/ops" element={<OpsConsolePage />} />
              {/* AI Features */}
              <Route path="/query" element={<QueryBuilderPage />} />
              <Route path="/enrichment" element={<EnrichmentConfigPage />} />
              <Route path="/federation" element={<SchemaBuilderPage />} />
              <Route path="/synthesis" element={<SynthesisPage />} />
              <Route path="/docqa" element={<DocumentQAPage />} />
              <Route path="/summary" element={<SummaryPage />} />
              {/* Document Editing & Creation Tools */}
              <Route path="/documents" element={<DocumentEditorPage />} />
              <Route path="/spreadsheets" element={<SpreadsheetEditorPage />} />
              <Route path="/dashboard-builder" element={<DashboardBuilderPage />} />
              <Route path="/connectors" element={<ConnectorsPage />} />
              <Route path="/workflows" element={<WorkflowBuilderPage />} />
              {/* New Feature Pages */}
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/visualization" element={<VisualizationPage />} />
              <Route path="/knowledge" element={<KnowledgePage />} />
              <Route path="/design" element={<DesignPage />} />
              <Route path="/ingestion" element={<IngestionPage />} />
              <Route path="/widgets" element={<WidgetsPage />} />
              <Route path="/logger" element={<LoggerPage />} />
              {/* URL aliases — redirect common alternate paths */}
              <Route path="/dashboards" element={<Navigate to="/dashboard-builder" replace />} />
              <Route path="/brand-kit" element={<Navigate to="/design" replace />} />
              <Route path="/analytics" element={<Navigate to="/stats" replace />} />
              <Route path="/query-builder" element={<Navigate to="/query" replace />} />
              <Route path="/recommendations" element={<Navigate to="/knowledge" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </Box>

      {/* Overlays */}
      <JobsPanel open={jobsOpen} onClose={handleCloseJobs} />
      <CommandPalette open={commandPaletteOpen} onClose={handleCloseCommandPalette} />
      <ActivityPanel open={activityOpen} onClose={handleCloseActivity} />
      <Suspense fallback={null}>
        <AssistantPanel open={assistantOpen} onClose={handleCloseAssistant} />
      </Suspense>
    </>
  )
}

function StaticErrorFallback() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 4,
      }}
    >
      <Stack spacing={1} sx={{ maxWidth: 520, textAlign: 'center' }}>
        <Typography variant="h5" fontWeight={600} color="text.primary">
          Something went wrong
        </Typography>
        <Typography variant="body2" color="text.secondary">
          An unexpected error occurred. Refresh the page to continue.
        </Typography>
      </Stack>
    </Box>
  )
}

function GovernedErrorBoundary({ children }) {
  const { execute } = useInteraction()
  const navigate = useNavigateInteraction()

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'error-boundary', ...intent },
      action,
    })
  }, [execute])

  const handleReload = useCallback(
    () => executeUI('Reload application', () => window.location.reload(), { action: 'reload' }),
    [executeUI],
  )

  const handleGoHome = useCallback(
    () => navigate('/', { label: 'Go to dashboard', intent: { source: 'error-boundary' } }),
    [navigate],
  )

  return (
    <ErrorBoundary onReload={handleReload} onGoHome={handleGoHome}>
      {children}
    </ErrorBoundary>
  )
}

// Root App component
export default function App() {
  return (
    <ErrorBoundary fallback={StaticErrorFallback}>
      <BrowserRouter basename={import.meta.env.VITE_ROUTER_BASENAME || import.meta.env.BASE_URL.replace(/\/+$/, '') || ''}>
        <AppProviders>
          <OperationHistoryProvider>
            <UXGovernanceProvider auditClient={intentAuditClient}>
              <ToastProvider>
                <GovernedErrorBoundary>
                  <AppContent />
                </GovernedErrorBoundary>
              </ToastProvider>
            </UXGovernanceProvider>
          </OperationHistoryProvider>
        </AppProviders>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
