import * as agentsApi from '../api/intelligence';import * as agentsV2Api from '../api/intelligence';import * as enrichmentApi from '../api/intelligence';import * as synthesisApi from '../api/intelligence';import * as summaryApi from '../api/intelligence';import * as docqaApi from '../api/intelligence';import * as searchApi from '../api/intelligence';import * as documentsApi from '../api/content';import * as spreadsheetsApi from '../api/content';import { bootstrapState, deleteConnection, healthcheckConnection } from '../api/client'
import { useAppStore } from './app'
import { nanoid } from 'nanoid'
import { useCallback, useMemo, useState } from 'react'
import { create } from 'zustand'
export const useTemplateStore = create((set, get) => ({
  // Templates list
  templates: [],
  setTemplates: (templates) => set({ templates }),
  addTemplate: (tpl) => set((state) => ({ templates: [tpl, ...state.templates] })),

  removeTemplate: (id) =>
    set((state) => {
      const templates = state.templates.filter((tpl) => tpl.id !== id)
      const nextTemplateId = state.templateId === id ? null : state.templateId
      const nextLastApproved =
        state.lastApprovedTemplate?.id === id ? null : state.lastApprovedTemplate
      return { templates, templateId: nextTemplateId, lastApprovedTemplate: nextLastApproved }
    }),

  updateTemplate: (templateId, updater) =>
    set((state) => {
      if (!templateId || typeof updater !== 'function') return {}
      let changed = false
      const templates = state.templates.map((tpl) => {
        if (tpl?.id !== templateId) return tpl
        const next = updater(tpl) || tpl
        if (next !== tpl) changed = true
        return next !== tpl ? next : tpl
      })
      return changed ? { templates } : {}
    }),

  // Active template selection
  templateId: null,
  setTemplateId: (id) => set({ templateId: id }),

  templateKind: 'pdf',
  setTemplateKind: (kind) => set({ templateKind: kind === 'excel' ? 'excel' : 'pdf' }),

  // Verification artifacts
  verifyArtifacts: null,
  setVerifyArtifacts: (arts) => set({ verifyArtifacts: arts }),

  // Last approved template
  lastApprovedTemplate: null,
  setLastApprovedTemplate: (tpl) => set({ lastApprovedTemplate: tpl }),

  // Template catalog (company + starter)
  templateCatalog: [],
  setTemplateCatalog: (items) =>
    set({ templateCatalog: Array.isArray(items) ? items : [] }),

  // Preview cache
  cacheKey: 0,
  bumpCache: () => set({ cacheKey: Date.now() }),
  setCacheKey: (value) => set({ cacheKey: value ?? Date.now() }),

  htmlUrls: { final: null, template: null, llm2: null },
  setHtmlUrls: (urlsOrUpdater) =>
    set((state) => {
      const next =
        typeof urlsOrUpdater === 'function'
          ? urlsOrUpdater(state.htmlUrls)
          : urlsOrUpdater
      return { htmlUrls: { ...state.htmlUrls, ...next } }
    }),
}))


/**
 * Template Creator Store — Zustand store for the unified 3-panel template workspace.
 *
 * Manages:
 * - Template identity and HTML state
 * - Mapping artifacts (auto + user overrides)
 * - Validation artifacts (contract, dry-run, issues)
 * - Intelligence Canvas state (mode, selected token, agent results, diff)
 * - Cross-panel focus (selectedToken, selectedIssue, focusedRegion)
 */

// Canvas modes — the Intelligence Canvas switches between these
export const CANVAS_MODES = {
  extraction: { id: 'extraction', label: 'Extraction Analysis', icon: 'DocumentScanner' },
  mapping: { id: 'mapping', label: 'Mapping Assistant', icon: 'CompareArrows' },
  diff: { id: 'diff', label: 'Template Diff', icon: 'Difference' },
  validation: { id: 'validation', label: 'Validation Review', icon: 'FactCheck' },
  data_preview: { id: 'data_preview', label: 'Data Preview', icon: 'TableChart' },
  insights: { id: 'insights', label: 'Report Insights', icon: 'Lightbulb' },
}

const INITIAL_STATE = {
  // Mode
  sourceMode: 'upload', // 'upload' | 'describe'
  templateKind: 'pdf',

  // Template identity (set after verify or chat-create)
  templateId: null,
  templateName: '',

  // Source artifacts
  uploadedFile: null,
  uploadProgress: 0,
  verifyRunId: null,

  // Design / HTML artifacts
  currentHtml: '',
  previousHtml: '',      // for diff computation
  schemaExt: null,
  referenceImageUrl: null,
  ssimScore: null,

  // Mapping artifacts
  autoMapping: {},
  userMapping: {},
  mappingConfidence: {},
  unmappedTokens: [],
  catalog: [],
  schemaInfo: null,
  mappingLoading: false,

  // Validation artifacts
  contractBuildResult: null,
  dryRunResult: null,
  validationIssues: [],
  overallReadinessScore: 0,
  validating: false,
  finalized: false,

  // Connection
  connectionId: null,

  // Pipeline tracking
  activePipelineRunId: null,

  // ---- Intelligence Canvas state ----
  canvasModeOverride: null,     // user can force a mode; null = auto-detect
  pinnedCards: [],               // card IDs that persist across mode changes
  selectedToken: null,           // cross-panel focus: which token is selected
  selectedIssue: null,           // cross-panel focus: which issue is selected
  focusedRegion: null,           // { page, selector } — where in template to scroll
  htmlDiff: null,                // { before, after, changes[] } — set on HTML update
  dataPreviewRequested: false,

  // Agent results (structured data for canvas cards)
  agentResults: {
    template_qa: null,
    data_mapping: null,
    data_quality: null,
    anomaly_detection: null,
    trend_analysis: null,
    report_pipeline: null,
  },
  agentLoading: {},              // { [agentType]: boolean }

  // Errors
  error: null,
}

/** @deprecated Use usePipelineStore from stores/pipeline.js instead */
export const useTemplateCreatorStore = create((set, get) => ({
  ...INITIAL_STATE,

  // ---- Source mode ----
  setSourceMode: (mode) => set({ sourceMode: mode }),
  setTemplateKind: (kind) => set({ templateKind: kind }),

  // ---- File upload ----
  setUploadedFile: (file) => set({ uploadedFile: file }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),

  // ---- Template identity ----
  setTemplateId: (id) => set({ templateId: id }),
  setTemplateName: (name) => set({ templateName: name }),

  // ---- HTML / Design artifacts ----
  setCurrentHtml: (html) => {
    const { currentHtml: prev } = get()
    // Track previous HTML for diff computation
    if (prev && html && prev !== html) {
      set({
        currentHtml: html,
        previousHtml: prev,
        htmlDiff: { before: prev, after: html },
      })
      // Auto-clear diff after 8 seconds so canvas returns to normal mode
      setTimeout(() => {
        const { htmlDiff } = get()
        if (htmlDiff?.after === html) {
          set({ htmlDiff: null })
        }
      }, 8000)
    } else {
      set({ currentHtml: html })
    }
  },

  setSchemaExt: (schema) => set({ schemaExt: schema }),
  setReferenceImageUrl: (url) => set({ referenceImageUrl: url }),
  setSsimScore: (score) => set({ ssimScore: score }),

  // ---- Mapping artifacts ----
  setAutoMapping: (mapping) => {
    set({
      autoMapping: mapping,
      userMapping: { ...mapping },
      mappingLoading: false,
    })
  },

  updateUserMapping: (token, column) => {
    set((state) => ({
      userMapping: { ...state.userMapping, [token]: column },
    }))
  },

  removeUserMapping: (token) => {
    set((state) => {
      const updated = { ...state.userMapping }
      delete updated[token]
      return { userMapping: updated }
    })
  },

  setCatalog: (catalog) => set({ catalog }),
  setSchemaInfo: (info) => set({ schemaInfo: info }),
  setMappingConfidence: (conf) => set({ mappingConfidence: conf }),
  setUnmappedTokens: (tokens) => set({ unmappedTokens: tokens }),
  setMappingLoading: (loading) => set({ mappingLoading: loading }),

  // ---- Validation artifacts ----
  setContractBuildResult: (result) => set({ contractBuildResult: result }),
  setDryRunResult: (result) => set({ dryRunResult: result }),
  setValidationIssues: (issues) => set({ validationIssues: issues }),
  setOverallReadinessScore: (score) => set({ overallReadinessScore: score }),
  setValidating: (v) => set({ validating: v }),
  setFinalized: (v) => set({ finalized: v }),

  // ---- Connection ----
  setConnectionId: (id) => set({ connectionId: id }),

  // ---- Pipeline ----
  setActivePipelineRunId: (id) => set({ activePipelineRunId: id }),

  // ---- Intelligence Canvas ----
  setCanvasModeOverride: (mode) => set({ canvasModeOverride: mode }),
  clearCanvasModeOverride: () => set({ canvasModeOverride: null }),

  setSelectedToken: (token) => set({ selectedToken: token, canvasModeOverride: token ? 'mapping' : null }),
  clearSelectedToken: () => set({ selectedToken: null }),

  setSelectedIssue: (issue) => set({ selectedIssue: issue, canvasModeOverride: issue ? 'validation' : null }),
  clearSelectedIssue: () => set({ selectedIssue: null }),

  setFocusedRegion: (region) => set({ focusedRegion: region }),
  clearFocusedRegion: () => set({ focusedRegion: null }),

  setHtmlDiff: (diff) => set({ htmlDiff: diff }),
  clearHtmlDiff: () => set({ htmlDiff: null }),

  setDataPreviewRequested: (v) => set({ dataPreviewRequested: v }),

  pinCard: (cardId) => {
    set((state) => ({
      pinnedCards: state.pinnedCards.includes(cardId)
        ? state.pinnedCards
        : [...state.pinnedCards, cardId],
    }))
  },

  unpinCard: (cardId) => {
    set((state) => ({
      pinnedCards: state.pinnedCards.filter((id) => id !== cardId),
    }))
  },

  // ---- Agent results ----
  setAgentResult: (agentType, result) => {
    set((state) => ({
      agentResults: { ...state.agentResults, [agentType]: result },
      agentLoading: { ...state.agentLoading, [agentType]: false },
    }))
  },

  setAgentLoading: (agentType, loading) => {
    set((state) => ({
      agentLoading: { ...state.agentLoading, [agentType]: loading },
    }))
  },

  clearAgentResult: (agentType) => {
    set((state) => ({
      agentResults: { ...state.agentResults, [agentType]: null },
    }))
  },

  // ---- Computed: Canvas Mode ----
  // Priority-ordered: first match wins
  getCanvasMode: () => {
    const state = get()
    if (state.canvasModeOverride) return state.canvasModeOverride

    // Validation takes highest priority when active
    if (state.validating || state.validationIssues.length > 0) return 'validation'

    // Diff mode when HTML just changed
    if (state.htmlDiff) return 'diff'

    // Mapping mode when user selected a token or mapping is in progress
    if (state.selectedToken || state.mappingLoading) return 'mapping'

    // Mapping mode when tokens exist but aren't fully mapped
    if (state.schemaExt && Object.keys(state.userMapping).length === 0 && Object.keys(state.autoMapping).length === 0) {
      return 'mapping'
    }

    // Extraction mode when HTML exists but schema not yet analyzed
    if (state.currentHtml && !state.schemaExt) return 'extraction'

    // Data preview when explicitly requested
    if (state.connectionId && state.dataPreviewRequested) return 'data_preview'

    // Default: insights
    return 'insights'
  },

  // ---- Computed helpers ----
  getMergedMapping: () => {
    const { autoMapping, userMapping } = get()
    return { ...autoMapping, ...userMapping }
  },

  getTokens: () => {
    const { schemaExt } = get()
    if (!schemaExt) return []
    return [
      ...(schemaExt.scalars || []),
      ...(schemaExt.row_tokens || []),
      ...(schemaExt.totals || []),
    ]
  },

  // ---- Errors ----
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),

  // ---- Reset ----
  reset: () => set({ ...INITIAL_STATE, agentResults: { ...INITIAL_STATE.agentResults } }),
}))


/**
 * Store for managing template editing chat sessions.
 * Each template can have its own chat session with conversation history.
 */

const createMessage = (role, content, metadata = {}) => ({
  id: nanoid(),
  role, // 'user' | 'assistant' | 'system'
  content,
  timestamp: Date.now(),
  streaming: false,
  ...metadata,
})

const DEFAULT_EDIT_WELCOME = "I've reviewed your template. What changes would you like to make? Feel free to describe what you want - whether it's styling updates, layout changes, adding or removing sections, or any other modifications."

const DEFAULT_CREATE_WELCOME = "I'll help you create a report template from scratch. What kind of report do you need? For example: invoice, sales summary, inventory report, financial statement, or something else?"

const createChatSession = (templateId, templateName, welcomeMessage) => ({
  id: nanoid(),
  templateId,
  templateName,
  messages: [
    createMessage('assistant', welcomeMessage || DEFAULT_EDIT_WELCOME),
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  // Track the proposed changes state
  proposedChanges: null,
  proposedHtml: null,
  readyToApply: false,
})

/** @deprecated Use usePipelineStore from stores/pipeline.js instead */
export const useTemplateChatStore = create((set, get) => ({
  // Map of templateId -> chat session
  sessions: {},

  // Get or create a session for a template
  getOrCreateSession: (templateId, templateName = 'Template', welcomeMessage = null) => {
    const { sessions } = get()
    if (sessions[templateId]) {
      return sessions[templateId]
    }
    const session = createChatSession(templateId, templateName, welcomeMessage)
    set((state) => ({
      sessions: {
        ...state.sessions,
        [templateId]: session,
      },
    }))
    return session
  },

  // Get session for a template (returns null if not exists)
  getSession: (templateId) => {
    return get().sessions[templateId] || null
  },

  // Add a user message to the session
  addUserMessage: (templateId, content) => {
    const message = createMessage('user', content)
    set((state) => {
      const session = state.sessions[templateId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [templateId]: {
            ...session,
            messages: [...session.messages, message].slice(-500),
            updatedAt: Date.now(),
          },
        },
      }
    })
    return message.id
  },

  // Add an assistant message to the session
  addAssistantMessage: (templateId, content, metadata = {}) => {
    const message = createMessage('assistant', content, metadata)
    set((state) => {
      const session = state.sessions[templateId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [templateId]: {
            ...session,
            messages: [...session.messages, message].slice(-500),
            updatedAt: Date.now(),
            // Update proposed changes if provided
            ...(metadata.proposedChanges !== undefined && {
              proposedChanges: metadata.proposedChanges,
            }),
            ...(metadata.proposedHtml !== undefined && {
              proposedHtml: metadata.proposedHtml,
            }),
            ...(metadata.readyToApply !== undefined && {
              readyToApply: metadata.readyToApply,
            }),
          },
        },
      }
    })
    return message.id
  },

  // Add a streaming assistant message (initially empty)
  addStreamingMessage: (templateId) => {
    const message = createMessage('assistant', '', { streaming: true })
    set((state) => {
      const session = state.sessions[templateId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [templateId]: {
            ...session,
            messages: [...session.messages, message].slice(-500),
            updatedAt: Date.now(),
          },
        },
      }
    })
    return message.id
  },

  // Update a message content (for streaming)
  updateMessageContent: (templateId, messageId, content) => {
    set((state) => {
      const session = state.sessions[templateId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [templateId]: {
            ...session,
            messages: session.messages.map((m) =>
              m.id === messageId ? { ...m, content } : m
            ),
          },
        },
      }
    })
  },

  // Append to a message content (for streaming)
  appendToMessage: (templateId, messageId, content) => {
    set((state) => {
      const session = state.sessions[templateId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [templateId]: {
            ...session,
            messages: session.messages.map((m) =>
              m.id === messageId ? { ...m, content: m.content + content } : m
            ),
          },
        },
      }
    })
  },

  // Mark a message as done streaming
  finishStreaming: (templateId, messageId, metadata = {}) => {
    set((state) => {
      const session = state.sessions[templateId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [templateId]: {
            ...session,
            messages: session.messages.map((m) =>
              m.id === messageId ? { ...m, streaming: false, ...metadata } : m
            ),
            // Update proposed changes if provided
            ...(metadata.proposedChanges !== undefined && {
              proposedChanges: metadata.proposedChanges,
            }),
            ...(metadata.proposedHtml !== undefined && {
              proposedHtml: metadata.proposedHtml,
            }),
            ...(metadata.readyToApply !== undefined && {
              readyToApply: metadata.readyToApply,
            }),
          },
        },
      }
    })
  },

  // Update proposed changes state
  setProposedChanges: (templateId, { proposedChanges, proposedHtml, readyToApply }) => {
    set((state) => {
      const session = state.sessions[templateId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [templateId]: {
            ...session,
            proposedChanges: proposedChanges ?? session.proposedChanges,
            proposedHtml: proposedHtml ?? session.proposedHtml,
            readyToApply: readyToApply ?? session.readyToApply,
          },
        },
      }
    })
  },

  // Clear proposed changes after applying
  clearProposedChanges: (templateId) => {
    set((state) => {
      const session = state.sessions[templateId]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [templateId]: {
            ...session,
            proposedChanges: null,
            proposedHtml: null,
            readyToApply: false,
          },
        },
      }
    })
  },

  // Clear a session (start fresh conversation)
  clearSession: (templateId, templateName, welcomeMessage = null) => {
    const session = createChatSession(templateId, templateName, welcomeMessage)
    set((state) => ({
      sessions: {
        ...state.sessions,
        [templateId]: session,
      },
    }))
    return session
  },

  // Delete a session entirely
  deleteSession: (templateId) => {
    set((state) => {
      const { [templateId]: removed, ...rest } = state.sessions
      return { sessions: rest }
    })
  },

  // Get messages for a template in the format needed for the API
  getMessagesForApi: (templateId) => {
    const session = get().sessions[templateId]
    if (!session) return []
    // Filter out system messages and convert to API format
    return session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }))
  },
}))

export { DEFAULT_EDIT_WELCOME, DEFAULT_CREATE_WELCOME }


const normalizeConnections = (connections) =>
  Array.isArray(connections) ? connections : []

export function useConnectionStore() {
  const connections = useAppStore((s) => s.savedConnections)
  const setSavedConnections = useAppStore((s) => s.setSavedConnections)
  const updateSavedConnection = useAppStore((s) => s.updateSavedConnection)
  const removeSavedConnection = useAppStore((s) => s.removeSavedConnection)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const normalizedConnections = useMemo(
    () => normalizeConnections(connections),
    [connections]
  )

  const setConnections = useCallback((next) => {
    const resolved = typeof next === 'function' ? next(connections) : next
    setSavedConnections(normalizeConnections(resolved))
  }, [connections, setSavedConnections])

  const fetchConnections = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await bootstrapState()
      const next = normalizeConnections(data?.connections)
      setSavedConnections(next)
      setLoading(false)
      return next
    } catch (err) {
      setError(err.message || 'Failed to load connections')
      setLoading(false)
      return []
    }
  }, [setSavedConnections])

  const healthCheck = useCallback(async (connectionId) => {
    try {
      const result = await healthcheckConnection(connectionId)
      updateSavedConnection(connectionId, {
        lastLatencyMs: result.latency_ms,
        status: 'connected',
      })
      return result
    } catch (err) {
      updateSavedConnection(connectionId, { status: 'error' })
      throw err
    }
  }, [updateSavedConnection])

  const removeConnection = useCallback(async (connectionId) => {
    setLoading(true)
    setError(null)
    try {
      await deleteConnection(connectionId)
      removeSavedConnection(connectionId)
      setLoading(false)
      return true
    } catch (err) {
      setError(err.message || 'Failed to delete connection')
      setLoading(false)
      return false
    }
  }, [removeSavedConnection])

  const getConnection = useCallback(
    (connectionId) =>
      normalizedConnections.find((conn) => conn.id === connectionId) || null,
    [normalizedConnections]
  )

  const reset = useCallback(() => {
    setSavedConnections([])
    setError(null)
  }, [setSavedConnections])

  return useMemo(() => ({
    connections: normalizedConnections,
    loading,
    error,
    setConnections,
    setLoading,
    setError,
    fetchConnections,
    healthCheck,
    removeConnection,
    getConnection,
    reset,
  }), [
    normalizedConnections,
    loading,
    error,
    setConnections,
    setLoading,
    setError,
    fetchConnections,
    healthCheck,
    removeConnection,
    getConnection,
    reset,
  ])
}


/**
 * Connection management store.
 *
 * Extracted from useAppStore to provide focused connection state management.
 * Handles saved connections, active connection selection, and connection status.
 */
// === From: spreadsheetStore.js ===
/**
 * Spreadsheet Store - Zustand store for spreadsheet editing.
 */

const useSpreadsheetStore = create((set, get) => ({
  // State
  spreadsheets: [],
  currentSpreadsheet: null,
  activeSheetIndex: 0,
  selectedCells: null,
  pivotTables: [],
  loading: false,
  saving: false,
  error: null,

  // Actions
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setActiveSheetIndex: (index) => set({ activeSheetIndex: index }),
  setSelectedCells: (cells) => set({ selectedCells: cells }),

  // Fetch all spreadsheets
  fetchSpreadsheets: async (params = {}) => {
    set({ loading: true, error: null });
    try {
      const response = await spreadsheetsApi.listSpreadsheets(params);
      set({ spreadsheets: response.spreadsheets || [], loading: false });
      return response;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  // Create spreadsheet
  createSpreadsheet: async (data) => {
    set({ loading: true, error: null });
    try {
      const spreadsheet = await spreadsheetsApi.createSpreadsheet(data);
      set((state) => ({
        spreadsheets: [spreadsheet, ...state.spreadsheets].slice(0, 200),
        currentSpreadsheet: spreadsheet,
        activeSheetIndex: 0,
        loading: false,
      }));
      return spreadsheet;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  // Get spreadsheet
  getSpreadsheet: async (spreadsheetId) => {
    set({ loading: true, error: null });
    try {
      const spreadsheet = await spreadsheetsApi.getSpreadsheet(spreadsheetId);
      set({
        currentSpreadsheet: spreadsheet,
        activeSheetIndex: 0,
        loading: false,
      });
      return spreadsheet;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  // Update spreadsheet
  updateSpreadsheet: async (spreadsheetId, data) => {
    set({ saving: true, error: null });
    try {
      const spreadsheet = await spreadsheetsApi.updateSpreadsheet(spreadsheetId, data);
      set((state) => ({
        spreadsheets: state.spreadsheets.map((s) => (s.id === spreadsheetId ? spreadsheet : s)),
        currentSpreadsheet: state.currentSpreadsheet?.id === spreadsheetId ? spreadsheet : state.currentSpreadsheet,
        saving: false,
      }));
      return spreadsheet;
    } catch (err) {
      set({ error: err.message, saving: false });
      return null;
    }
  },

  // Delete spreadsheet
  deleteSpreadsheet: async (spreadsheetId) => {
    set({ loading: true, error: null });
    try {
      await spreadsheetsApi.deleteSpreadsheet(spreadsheetId);
      set((state) => ({
        spreadsheets: state.spreadsheets.filter((s) => s.id !== spreadsheetId),
        currentSpreadsheet: state.currentSpreadsheet?.id === spreadsheetId ? null : state.currentSpreadsheet,
        loading: false,
      }));
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  // Cell Operations
  updateCells: async (spreadsheetId, sheetIndex, updates) => {
    set({ saving: true, error: null });
    try {
      const result = await spreadsheetsApi.updateCells(spreadsheetId, sheetIndex, updates);
      // Refresh current spreadsheet to get updated data
      if (get().currentSpreadsheet?.id === spreadsheetId) {
        await get().getSpreadsheet(spreadsheetId);
      }
      set({ saving: false });
      return result;
    } catch (err) {
      set({ error: err.message, saving: false });
      return null;
    }
  },

  getCellRange: async (spreadsheetId, sheetIndex, range) => {
    try {
      const result = await spreadsheetsApi.getCellRange(spreadsheetId, sheetIndex, range);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  // Sheet Operations
  addSheet: async (spreadsheetId, name) => {
    set({ loading: true, error: null });
    try {
      const result = await spreadsheetsApi.addSheet(spreadsheetId, name);
      await get().getSpreadsheet(spreadsheetId);
      set({ loading: false });
      return result;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  deleteSheet: async (spreadsheetId, sheetIndex) => {
    set({ loading: true, error: null });
    try {
      const currentSpreadsheet = get().currentSpreadsheet;
      const sheetId = currentSpreadsheet?.sheets?.[sheetIndex]?.id ?? sheetIndex;
      await spreadsheetsApi.deleteSheet(spreadsheetId, sheetId);
      const state = get();
      if (state.activeSheetIndex >= sheetIndex && state.activeSheetIndex > 0) {
        set({ activeSheetIndex: state.activeSheetIndex - 1 });
      }
      await get().getSpreadsheet(spreadsheetId);
      set({ loading: false });
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  renameSheet: async (spreadsheetId, sheetIndex, newName) => {
    set({ saving: true, error: null });
    try {
      const currentSpreadsheet = get().currentSpreadsheet;
      const sheetId = currentSpreadsheet?.sheets?.[sheetIndex]?.id ?? sheetIndex;
      await spreadsheetsApi.renameSheet(spreadsheetId, sheetId, newName);
      await get().getSpreadsheet(spreadsheetId);
      set({ saving: false });
      return true;
    } catch (err) {
      set({ error: err.message, saving: false });
      return false;
    }
  },

  freezePanes: async (spreadsheetId, sheetIndex, row, col) => {
    set({ saving: true, error: null });
    try {
      const currentSpreadsheet = get().currentSpreadsheet;
      const sheetId = currentSpreadsheet?.sheets?.[sheetIndex]?.id ?? sheetIndex;
      await spreadsheetsApi.freezePanes(spreadsheetId, sheetId, row, col);
      await get().getSpreadsheet(spreadsheetId);
      set({ saving: false });
      return true;
    } catch (err) {
      set({ error: err.message, saving: false });
      return false;
    }
  },

  // Conditional Formatting
  addConditionalFormat: async (spreadsheetId, sheetIndex, rule) => {
    set({ saving: true, error: null });
    try {
      const result = await spreadsheetsApi.addConditionalFormat(spreadsheetId, sheetIndex, rule);
      set({ saving: false });
      return result;
    } catch (err) {
      set({ error: err.message, saving: false });
      return null;
    }
  },

  removeConditionalFormat: async (spreadsheetId, sheetIndex, ruleId) => {
    set({ saving: true, error: null });
    try {
      await spreadsheetsApi.removeConditionalFormat(spreadsheetId, sheetIndex, ruleId);
      set({ saving: false });
      return true;
    } catch (err) {
      set({ error: err.message, saving: false });
      return false;
    }
  },

  // Data Validation
  addDataValidation: async (spreadsheetId, sheetIndex, validation) => {
    set({ saving: true, error: null });
    try {
      const result = await spreadsheetsApi.addDataValidation(spreadsheetId, sheetIndex, validation);
      set({ saving: false });
      return result;
    } catch (err) {
      set({ error: err.message, saving: false });
      return null;
    }
  },

  // Pivot Tables
  createPivotTable: async (spreadsheetId, config) => {
    set({ loading: true, error: null });
    try {
      const pivot = await spreadsheetsApi.createPivotTable(spreadsheetId, config);
      set((state) => ({
        pivotTables: [...state.pivotTables, pivot].slice(0, 100),
        loading: false,
      }));
      return pivot;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  refreshPivotTable: async (spreadsheetId, pivotId) => {
    try {
      const pivot = await spreadsheetsApi.refreshPivotTable(spreadsheetId, pivotId);
      set((state) => ({
        pivotTables: state.pivotTables.map((p) => (p.id === pivotId ? pivot : p)),
      }));
      return pivot;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  updatePivotTable: async (spreadsheetId, pivotId, config) => {
    set({ loading: true, error: null });
    try {
      const pivot = await spreadsheetsApi.updatePivotTable(spreadsheetId, pivotId, config);
      set((state) => ({
        pivotTables: state.pivotTables.map((p) => (p.id === pivotId ? pivot : p)),
        loading: false,
      }));
      return pivot;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  deletePivotTable: async (spreadsheetId, pivotId) => {
    set({ loading: true, error: null });
    try {
      await spreadsheetsApi.deletePivotTable(spreadsheetId, pivotId);
      set((state) => ({
        pivotTables: state.pivotTables.filter((p) => p.id !== pivotId),
        loading: false,
      }));
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  // Formula Engine
  evaluateFormula: async (spreadsheetId, formula, sheetIndex = 0) => {
    try {
      const result = await spreadsheetsApi.evaluateFormula(spreadsheetId, formula, sheetIndex);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  validateFormula: async (spreadsheetId, formula) => {
    try {
      const result = await spreadsheetsApi.validateFormula(spreadsheetId, formula);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  listFunctions: async () => {
    try {
      const result = await spreadsheetsApi.listFunctions();
      return result;
    } catch (err) {
      set({ error: err.message });
      return [];
    }
  },

  // Import/Export
  importCsv: async (file, options = {}) => {
    set({ loading: true, error: null });
    try {
      const spreadsheet = await spreadsheetsApi.importCsv(file, options);
      set((state) => ({
        spreadsheets: [spreadsheet, ...state.spreadsheets].slice(0, 200),
        currentSpreadsheet: spreadsheet,
        loading: false,
      }));
      return spreadsheet;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  importExcel: async (file, options = {}) => {
    set({ loading: true, error: null });
    try {
      const spreadsheet = await spreadsheetsApi.importExcel(file, options);
      set((state) => ({
        spreadsheets: [spreadsheet, ...state.spreadsheets].slice(0, 200),
        currentSpreadsheet: spreadsheet,
        loading: false,
      }));
      return spreadsheet;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  exportSpreadsheet: async (spreadsheetId, format) => {
    try {
      const blob = await spreadsheetsApi.exportSpreadsheet(spreadsheetId, format);
      return blob;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  // AI Features
  generateFormula: async (spreadsheetId, naturalLanguage, context = {}) => {
    try {
      const result = await spreadsheetsApi.generateFormula(spreadsheetId, naturalLanguage, context);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  explainFormula: async (spreadsheetId, formula) => {
    try {
      const result = await spreadsheetsApi.explainFormula(spreadsheetId, formula);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  detectAnomalies: async (spreadsheetId, column, options = {}) => {
    try {
      const result = await spreadsheetsApi.detectAnomalies(spreadsheetId, column, options);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  suggestDataCleaning: async (spreadsheetId, options = {}) => {
    try {
      const result = await spreadsheetsApi.suggestDataCleaning(spreadsheetId, options);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  predictColumn: async (spreadsheetId, column, options = {}) => {
    try {
      const result = await spreadsheetsApi.predictColumn(spreadsheetId, column, options);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  suggestFormulas: async (spreadsheetId, context = {}) => {
    try {
      const result = await spreadsheetsApi.suggestFormulas(spreadsheetId, context);
      return result;
    } catch (err) {
      set({ error: err.message });
      return [];
    }
  },

  // Collaboration
  startCollaboration: async (spreadsheetId, data = {}) => {
    try {
      const session = await spreadsheetsApi.startSpreadsheetCollaboration(spreadsheetId, data);
      return session;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  fetchCollaborators: async (spreadsheetId) => {
    try {
      const response = await spreadsheetsApi.getSpreadsheetCollaborators(spreadsheetId);
      return response;
    } catch (err) {
      set({ error: err.message });
      return [];
    }
  },

  // Reset
  reset: () => set({
    currentSpreadsheet: null,
    activeSheetIndex: 0,
    selectedCells: null,
    pivotTables: [],
    error: null,
  }),

  clearSpreadsheets: () => set({
    spreadsheets: [],
    currentSpreadsheet: null,
  }),
}));

export { useSpreadsheetStore };

// ====================================================================
// documentStore
// ====================================================================

const useDocumentStore = create((set, get) => ({
  documents: [], currentDocument: null, versions: [],
  comments: [], collaborators: [], templates: [],
  aiResult: null, loading: false, saving: false, error: null,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  createDocument: async (data) => {
    set({ saving: true, error: null });
    try { const doc = await documentsApi.createDocument(data); set((s) => ({ documents: [doc, ...s.documents].slice(0, 200), currentDocument: doc, saving: false })); return doc; }
    catch (err) { set({ error: err.message, saving: false }); return null; }
  },
  fetchDocuments: async (params = {}) => {
    set({ loading: true, error: null });
    try { const r = await documentsApi.listDocuments(params); set({ documents: r.documents || [], loading: false }); return r; }
    catch (err) { set({ error: err.message, loading: false }); return null; }
  },
  getDocument: async (id) => {
    set({ loading: true, error: null });
    try { const doc = await documentsApi.getDocument(id); set({ currentDocument: doc, loading: false }); return doc; }
    catch (err) { set({ error: err.message, loading: false }); return null; }
  },
  updateDocument: async (id, data) => {
    set({ saving: true, error: null });
    try { const doc = await documentsApi.updateDocument(id, data); set((s) => ({ documents: s.documents.map((d) => d.id === id ? doc : d), currentDocument: s.currentDocument?.id === id ? doc : s.currentDocument, saving: false })); return doc; }
    catch (err) { set({ error: err.message, saving: false }); return null; }
  },
  deleteDocument: async (id) => {
    set({ loading: true, error: null });
    try { await documentsApi.deleteDocument(id); set((s) => ({ documents: s.documents.filter((d) => d.id !== id), currentDocument: s.currentDocument?.id === id ? null : s.currentDocument, loading: false })); return true; }
    catch (err) { set({ error: err.message, loading: false }); return false; }
  },

  fetchVersions: async (docId) => { try { const v = await documentsApi.getVersions(docId); set({ versions: v || [] }); return v; } catch (err) { set({ error: err.message }); return []; } },
  restoreVersion: async (docId, versionId) => { try { const r = await documentsApi.restoreVersion(docId, versionId); await get().getDocument(docId); return r; } catch (err) { set({ error: err.message }); return null; } },

  fetchComments: async (docId) => { try { const c = await documentsApi.getComments(docId); set({ comments: c || [] }); return c; } catch (err) { set({ error: err.message }); return []; } },
  addComment: async (docId, data) => { try { const c = await documentsApi.addComment(docId, data); set((s) => ({ comments: [...s.comments, c] })); return c; } catch (err) { set({ error: err.message }); return null; } },
  replyToComment: async (docId, commentId, data) => { try { return await documentsApi.replyToComment(docId, commentId, data); } catch (err) { set({ error: err.message }); return null; } },
  resolveComment: async (docId, commentId, resolved = true) => { try { return await documentsApi.resolveComment(docId, commentId, resolved); } catch (err) { set({ error: err.message }); return null; } },
  deleteComment: async (docId, commentId) => { try { await documentsApi.deleteComment(docId, commentId); set((s) => ({ comments: s.comments.filter((c) => c.id !== commentId) })); return true; } catch (err) { set({ error: err.message }); return false; } },

  startCollaboration: async (docId, data = {}) => { try { return await documentsApi.startCollaboration(docId, data); } catch (err) { set({ error: err.message }); return null; } },
  fetchCollaborators: async (docId) => { try { const c = await documentsApi.getCollaborators(docId); set({ collaborators: c || [] }); return c; } catch (err) { set({ error: err.message }); return []; } },

  checkGrammar: async (docId, text, opts = {}) => { try { return await documentsApi.checkGrammar(docId, text, opts); } catch (err) { set({ error: err.message }); return null; } },
  summarize: async (docId, text, length, style) => { try { const r = await documentsApi.summarize(docId, text, length, style); set({ aiResult: r }); return r; } catch (err) { set({ error: err.message }); return null; } },
  rewrite: async (docId, text, tone, style) => { try { const r = await documentsApi.rewrite(docId, text, tone, style); set({ aiResult: r }); return r; } catch (err) { set({ error: err.message }); return null; } },
  expand: async (docId, text, targetLength) => { try { const r = await documentsApi.expand(docId, text, targetLength); set({ aiResult: r }); return r; } catch (err) { set({ error: err.message }); return null; } },
  translate: async (docId, text, lang, preserveFormatting) => { try { const r = await documentsApi.translate(docId, text, lang, preserveFormatting); set({ aiResult: r }); return r; } catch (err) { set({ error: err.message }); return null; } },

  fetchTemplates: async (params = {}) => { try { const t = await documentsApi.listTemplates(params); set({ templates: t || [] }); return t; } catch (err) { set({ error: err.message }); return []; } },

  mergePdfs: async (ids) => { set({ loading: true }); try { const r = await documentsApi.mergePdfs(ids); set({ loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  splitPdf: async (id, pages) => { set({ loading: true }); try { const r = await documentsApi.splitPdf(id, pages); set({ loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return null; } },

  clearAiResult: () => set({ aiResult: null }),
  reset: () => set({ currentDocument: null, versions: [], comments: [], collaborators: [], aiResult: null, error: null }),
  clearDocuments: () => set({ documents: [], currentDocument: null }),
}));

export { useDocumentStore };


// ====================================================================
// agentStore
// ====================================================================

export const useAgentStore = create((set, get) => ({
  tasks: [], currentTask: null, agentTypes: [], events: [],
  loading: false, running: false, error: null,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  runResearchAgent: async (topic, opts = {}) => { set({ running: true, error: null }); try { const t = await agentsApi.runResearchAgent(topic, opts); set((s) => ({ tasks: [t, ...s.tasks].slice(0, 200), currentTask: t, running: false })); return t; } catch (err) { set({ error: err.message, running: false }); return null; } },
  runDataAnalystAgent: async (question, data, opts = {}) => { set({ running: true, error: null }); try { const t = await agentsApi.runDataAnalystAgent(question, data, opts); set((s) => ({ tasks: [t, ...s.tasks].slice(0, 200), currentTask: t, running: false })); return t; } catch (err) { set({ error: err.message, running: false }); return null; } },
  runEmailDraftAgent: async (ctx, purpose, opts = {}) => { set({ running: true, error: null }); try { const t = await agentsApi.runEmailDraftAgent(ctx, purpose, opts); set((s) => ({ tasks: [t, ...s.tasks].slice(0, 200), currentTask: t, running: false })); return t; } catch (err) { set({ error: err.message, running: false }); return null; } },
  runContentRepurposeAgent: async (content, srcFmt, tgtFmts, opts = {}) => { set({ running: true, error: null }); try { const t = await agentsApi.runContentRepurposeAgent(content, srcFmt, tgtFmts, opts); set((s) => ({ tasks: [t, ...s.tasks].slice(0, 200), currentTask: t, running: false })); return t; } catch (err) { set({ error: err.message, running: false }); return null; } },
  runProofreadingAgent: async (text, opts = {}) => { set({ running: true, error: null }); try { const t = await agentsApi.runProofreadingAgent(text, opts); set((s) => ({ tasks: [t, ...s.tasks].slice(0, 200), currentTask: t, running: false })); return t; } catch (err) { set({ error: err.message, running: false }); return null; } },
  runReportAnalystAgent: async (runId, opts = {}) => { set({ running: true, error: null }); try { const t = await agentsApi.runReportAnalystAgent(runId, opts); set((s) => ({ tasks: [t, ...s.tasks].slice(0, 200), currentTask: t, running: false })); return t; } catch (err) { set({ error: err.message, running: false }); return null; } },

  getTask: async (taskId) => { set({ loading: true, error: null }); try { const t = await agentsApi.getTask(taskId); set({ currentTask: t, loading: false }); return t; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  fetchTasks: async (opts = {}) => { set({ loading: true, error: null }); try { const r = await agentsApi.listTasks(opts); set({ tasks: Array.isArray(r) ? r : (r?.tasks || []), loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  cancelTask: async (taskId, reason = null) => { try { await agentsApi.cancelTask(taskId, reason); set((s) => ({ tasks: s.tasks.map((t) => t.id === taskId ? { ...t, status: 'cancelled' } : t) })); return true; } catch (err) { set({ error: err.message }); return false; } },
  retryTask: async (taskId) => { set({ running: true, error: null }); try { const t = await agentsApi.retryTask(taskId); set((s) => ({ tasks: s.tasks.map((tk) => tk.id === taskId ? t : tk), currentTask: s.currentTask?.id === taskId ? t : s.currentTask, running: false })); return t; } catch (err) { set({ error: err.message, running: false }); return null; } },
  fetchTaskEvents: async (taskId, limit = 100) => { try { const e = await agentsApi.getTaskEvents(taskId, limit); set({ events: e || [] }); return e; } catch (err) { set({ error: err.message }); return []; } },
  fetchAgentTypes: async () => { try { const types = await agentsApi.listAgentTypes(); set({ agentTypes: types || [] }); return types; } catch (err) { set({ error: err.message }); return []; } },

  reset: () => set({ currentTask: null, events: [], error: null }),
  clearTasks: () => set({ tasks: [], currentTask: null }),
}));


// ====================================================================
// docqaStore
// ====================================================================

export const useDocQAStore = create((set, get) => ({
  sessions: [], currentSession: null, chatHistory: [],
  loading: false, asking: false, error: null,

  createSession: async (name) => { set({ loading: true, error: null }); try { const s = await docqaApi.createSession(name); set((st) => ({ sessions: [s, ...st.sessions].slice(0, 100), currentSession: s, loading: false })); return s; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  fetchSessions: async (opts = {}) => { set({ loading: true, error: null }); try { const r = await docqaApi.listSessions(opts); set({ sessions: r?.sessions || r || [], loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  getSession: async (id) => { set({ loading: true, error: null }); try { const s = await docqaApi.getSession(id); set({ currentSession: s, loading: false }); return s; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  deleteSession: async (id) => { set({ loading: true, error: null }); try { await docqaApi.deleteSession(id); set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), currentSession: s.currentSession?.id === id ? null : s.currentSession, loading: false })); return true; } catch (err) { set({ error: err.message, loading: false }); return false; } },

  addDocument: async (sessionId, data) => { set({ loading: true, error: null }); try { const r = await docqaApi.addDocument(sessionId, data); set({ loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  removeDocument: async (sessionId, docId) => { try { await docqaApi.removeDocument(sessionId, docId); return true; } catch (err) { set({ error: err.message }); return false; } },

  askQuestion: async (sessionId, data) => { set({ asking: true, error: null }); try { const r = await docqaApi.askQuestion(sessionId, data); set({ asking: false }); return r; } catch (err) { set({ error: err.message, asking: false }); return null; } },
  fetchChatHistory: async (sessionId, limit = 50) => { try { const h = await docqaApi.getChatHistory(sessionId, limit); set({ chatHistory: h || [] }); return h; } catch (err) { set({ error: err.message }); return []; } },
  clearHistory: async (sessionId) => { try { await docqaApi.clearHistory(sessionId); set({ chatHistory: [] }); return true; } catch (err) { set({ error: err.message }); return false; } },
  submitFeedback: async (sessionId, messageId, data) => { try { return await docqaApi.submitFeedback(sessionId, messageId, data); } catch (err) { set({ error: err.message }); return null; } },

  reset: () => set({ currentSession: null, chatHistory: [], error: null }),
}));


// ====================================================================
// enrichmentStore
// ====================================================================

export const useEnrichmentStore = create((set) => ({
  sources: [], enrichments: [], loading: false, error: null,

  fetchSources: async () => { set({ loading: true, error: null }); try { const r = await enrichmentApi.getEnrichmentSources(); set({ sources: r?.sources || r || [], loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return []; } },
  createSource: async (data) => { set({ loading: true, error: null }); try { const s = await enrichmentApi.createSource(data); set((st) => ({ sources: [s, ...st.sources], loading: false })); return s; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  deleteSource: async (id) => { set({ loading: true, error: null }); try { await enrichmentApi.deleteSource(id); set((s) => ({ sources: s.sources.filter((x) => x.id !== id), loading: false })); return true; } catch (err) { set({ error: err.message, loading: false }); return false; } },
  enrichData: async (data, sources, opts = {}) => { set({ loading: true, error: null }); try { const r = await enrichmentApi.enrichData({ data, sources, options: opts }); set({ loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return null; } },

  reset: () => set({ sources: [], enrichments: [], error: null }),
}));


// ====================================================================
// searchStore
// ====================================================================

export const useSearchStore = create((set) => ({
  results: [], query: '', loading: false, error: null,

  search: async (query, opts = {}) => { set({ loading: true, error: null, query }); try { const r = await searchApi.search(query, opts); set({ results: r?.results || r || [], loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  clearResults: () => set({ results: [], query: '' }),
  reset: () => set({ results: [], query: '', error: null }),
}));


// ====================================================================
// summaryStore
// ====================================================================

export const useSummaryStore = create((set) => ({
  summaries: [], currentSummary: null, loading: false, error: null,

  generateSummary: async (data) => { set({ loading: true, error: null }); try { const r = await summaryApi.generateSummary(data); set({ currentSummary: r, loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  reset: () => set({ currentSummary: null, error: null }),
}));


// ====================================================================
// synthesisStore
// ====================================================================

export const useSynthesisStore = create((set) => ({
  sessions: [], currentSession: null, loading: false, error: null,

  createSession: async (name) => { set({ loading: true, error: null }); try { const s = await synthesisApi.synthesis_createSession(name); set((st) => ({ sessions: [s, ...st.sessions], currentSession: s, loading: false })); return s; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  fetchSessions: async () => { set({ loading: true, error: null }); try { const r = await synthesisApi.synthesis_listSessions(); set({ sessions: r?.sessions || r || [], loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return []; } },
  getSession: async (id) => { set({ loading: true, error: null }); try { const s = await synthesisApi.synthesis_getSession(id); set({ currentSession: s, loading: false }); return s; } catch (err) { set({ error: err.message, loading: false }); return null; } },
  deleteSession: async (id) => { set({ loading: true, error: null }); try { await synthesisApi.synthesis_deleteSession(id); set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), currentSession: s.currentSession?.id === id ? null : s.currentSession, loading: false })); return true; } catch (err) { set({ error: err.message, loading: false }); return false; } },
  synthesize: async (sessionId, data) => { set({ loading: true, error: null }); try { const r = await synthesisApi.synthesize(sessionId, data); set({ loading: false }); return r; } catch (err) { set({ error: err.message, loading: false }); return null; } },

  reset: () => set({ currentSession: null, error: null }),
}));
