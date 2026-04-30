/**
 * Pipeline Store — Single Source of Truth.
 *
 * Core principle: `pipelineState.data` is the ONLY truth.
 * Phase, completion, chips, panel type — all DERIVED.
 * No stored phase. No completedSteps. No manual sync.
 *
 * Invalidation is inside setters — upstream change automatically
 * invalidates downstream (template change nukes mapping, etc.)
 */
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import plog, { summarize } from '@/api/pipelineLogger'

// ─── Token Regex (matches backend) ───
const TOKEN_RE = /\{\{?\s*([A-Za-z0-9_\-.]+)\s*\}\}?/g
function extractTokens(html) {
  if (!html) return new Set()
  const tokens = new Set()
  let m
  while ((m = TOKEN_RE.exec(html)) !== null) tokens.add(m[1])
  TOKEN_RE.lastIndex = 0
  return tokens
}
function setsEqual(a, b) {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

// ─── Phase derivation ───
function derivePhase(data, connectionId) {
  if (!data.template?.html) return 'upload'
  if (!connectionId) return 'connect'
  if (!data.mapping?.mapping || Object.keys(data.mapping.mapping).length === 0) return 'map'
  if (!data.contract?.contract) return 'map'
  if (data.validation?.result !== 'pass') return 'validate'
  if (data.generation?.previewApproved) return 'generate'
  return 'validate'
}

// ─── Step completion derivation ───
function isStepComplete(step, data, errors, connectionId) {
  const totalTokens = data.template?.tokens?.length || 0
  switch (step) {
    case 'upload':   return !!data.template?.html
    case 'connect':  return !!connectionId
    case 'edit':     return !!data.template?.html
    case 'map':      return totalTokens > 0 && Object.keys(data.mapping?.mapping || {}).length === totalTokens && !errors.some(e => e.severity === 'error')
    case 'validate': return data.validation?.result === 'pass'
    case 'generate': return data.generation?.jobs?.some(j => j.status === 'completed')
    default: return false
  }
}

// ─── Step gating ───
const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'connect', label: 'Connect Data' },
  { id: 'edit', label: 'Design' },
  { id: 'map', label: 'Map Fields' },
  { id: 'validate', label: 'Review' },
  { id: 'generate', label: 'Create Reports' },
]

const TRANSITION_RULES = {
  upload: () => true,
  connect: () => true,  // always accessible — user can connect before or after upload
  edit: (s) => !!s.data.template?.html,
  map: (s) => (s.data.template?.tokens?.length || 0) > 0 && !!s.data.template?.html,
  validate: (s) => Object.keys(s.data.mapping?.mapping || {}).length > 0 && !!s.data.contract?.contract,
  generate: (s) => s.data.validation?.result === 'pass',
}

const GATE_REASONS = {
  upload: null,
  connect: null,
  edit: 'Upload your report first',
  map: 'Your report design needs to be ready first',
  validate: 'Map your data fields first',
  generate: 'Review needs to pass first',
}

// ─── Phase → action chips (layman-friendly labels) ───
// Pipeline action chips are shown ONLY on the right panel (StatusView NextStepActions).
// Left-side ActionChips only get PERSISTENT_CHIPS (search, help).
const PHASE_CHIPS = {
  upload: [],
  connect: [],
  edit: [],
  map: [],
  validate: [],
  generate: [],
}

// ─── Always-visible chips (available in every phase) ───
const PERSISTENT_CHIPS = [
  { label: 'Search the web', action: 'web_search', variant: 'outlined' },
  { label: 'I need help', action: 'clarify', variant: 'outlined' },
]

// ─── Phase → panel type ───
const PHASE_TO_PANEL = {
  upload: 'upload',
  connect: 'upload',  // same panel — shows connection picker + upload
  edit: 'edit',
  map: 'mapping',
  validate: 'validation',
  generate: 'generation',
}

// ─── Token colors ───
const TOKEN_COLORS = ['#4CAF50','#2196F3','#FF9800','#9C27B0','#F44336','#00BCD4','#795548','#E91E63','#3F51B5','#009688','#FF5722','#607D8B','#8BC34A','#CDDC39']
function tokenColor(signature) {
  return TOKEN_COLORS[parseInt(signature, 16) % TOKEN_COLORS.length]
}

// ─── Debounced history persistence ───
let _historyTimer = null
function _persistHistory(getState) {
  clearTimeout(_historyTimer)
  _historyTimer = setTimeout(() => {
    const { sessionId, pipelineState } = getState()
    if (!sessionId || !pipelineState.history.length) return
    fetch('/api/v1/pipeline/data/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, history: pipelineState.history }),
    }).catch(() => {})
  }, 2000)
}

// ─── Store ───

const usePipelineStore = create((set, get) => ({
  // ═══════════════════════════════════════════════════════════
  // THE ONLY STATE — everything else is derived from this
  // ═══════════════════════════════════════════════════════════

  pipelineState: {
    data: {
      template: {},   // { html, tokens, schema }
      mapping: {},    // { mapping, errors, catalog, candidates, confidence, confidence_reason, status }
      contract: {},   // { contract, overview, gates }
      validation: {}, // { result, issues, dryRunPdf }
      generation: {}, // { batches, jobs, dateRange, keyValues, previewApproved }
    },
    errors: [],
    progress: { stages: [], currentStage: null },
    history: [],      // [{ beforeData, field, timestamp }] — shallow snapshots of changed field only
  },

  // Session metadata (not part of pipelineState — purely frontend)
  sessionId: null,
  sessionName: 'New Pipeline',
  connectionId: null,
  connectionIds: [],
  templateId: null,
  templateKind: 'pdf',

  // Messages (chat only — no UI blocks)
  messages: [],

  // UI
  inputValue: '',
  isProcessing: false,
  sidebarForcePanel: null, // Override derived panel type
  workspaceMode: false,    // true = Workspace (unrestricted), false = Build Report (guided)
  thinkingEnabled: false,  // Qwen thinking mode — shows reasoning in responses when on

  // Right panel state (status-first architecture)
  activePanel: null,          // null = StatusView, 'template'|'mappings'|'data'|'logic'|'preview'|'errors'
  availablePanels: [],        // Progressive — driven by backend
  pinnedPanels: ['upload'], // Upload button pinned by default; users can pin/unpin via thumbpin
  statusView: null,           // Plain-language status from backend
  highlightedField: null,     // Cross-panel field highlighting
  learningSignal: null,       // Pipeline learning signal from backend

  // Token signature → color mapping
  tokenColorMap: {},

  // Column stats (from backend get_column_stats tool)
  columnStats: {},
  setColumnStats: (s) => set({ columnStats: s }),

  // Constraint violations (from json-rules-engine)
  constraintViolations: [],
  setConstraintViolations: (v) => set({ constraintViolations: v }),

  // Column tags (user-assigned: id/date/metric)
  columnTags: {},
  setColumnTag: (col, tag) => set(s => ({ columnTags: { ...s.columnTags, [col]: tag } })),

  // Query builder state
  queryBuilderState: null,
  setQueryBuilderState: (q) => set({ queryBuilderState: q }),

  // Template diff state
  templateVersions: [],
  addTemplateVersion: (v) => set(s => ({ templateVersions: [...s.templateVersions, v] })),
  templateOriginalHtml: null,
  setTemplateOriginalHtml: (html) => set(s => ({
    templateOriginalHtml: s.templateOriginalHtml ?? html, // Only set once (first load)
  })),

  // Widget ordering for dnd-kit reordering in StatusView (C1: added 'memory')
  widgetOrder: ['pipeline', 'connections', 'rowflow', 'injection', 'morph', 'reality', 'errors', 'memory', 'cards', 'actions', 'next', 'timeline'],
  setWidgetOrder: (order) => set({ widgetOrder: order }),

  // B9: Custom constraint rules for json-rules-engine
  customConstraintRules: [],
  setCustomConstraintRules: (rules) => set({ customConstraintRules: rules }),

  // C3: Transformation pipeline step toggle state
  transformDisabledSteps: {},
  setTransformStepDisabled: (field, step, disabled) => set(s => ({
    transformDisabledSteps: { ...s.transformDisabledSteps, [`${field}.${step}`]: disabled },
  })),

  // Timeline scrubber preview
  historyPreview: null,
  previewHistoryAt: (index) => set(s => ({
    historyPreview: s.pipelineState.history[index] || null,
  })),
  clearHistoryPreview: () => set({ historyPreview: null }),

  // Performance metrics (from backend)
  performanceMetrics: [],
  setPerformanceMetrics: (m) => set({ performanceMetrics: m }),

  // Intelligence Canvas (consolidated from useTemplateCreatorStore)
  sourceMode: 'upload',
  pinnedCards: [],
  selectedToken: null,
  selectedIssue: null,

  // ═══════════════════════════════════════════════════════════
  // DERIVED GETTERS (never stored)
  // ═══════════════════════════════════════════════════════════

  getPhase: () => derivePhase(get().pipelineState.data),

  getPipelineSteps: () => {
    const s = get().pipelineState
    const cid = get().connectionId
    const phase = derivePhase(s.data, cid)
    return STEPS.map(step => {
      const complete = isStepComplete(step.id, s.data, s.errors, cid)
      const active = step.id === phase
      const canEnter = TRANSITION_RULES[step.id](s)
      return {
        ...step,
        status: complete ? 'done' : active ? 'active' : 'pending',
        canEnter,
        reason: canEnter ? null : GATE_REASONS[step.id],
        hasWarning: step.id === 'map' && s.data.mapping?.status === 'approved_with_warnings',
      }
    })
  },

  getActionChips: () => {
    // Workspace mode: only persistent chips, no pipeline-specific ones
    if (get().workspaceMode) {
      return [...PERSISTENT_CHIPS]
    }
    // Left-side chips: only chat-related actions (search, help).
    // All pipeline actions live on the right panel (StatusView).
    return [...PERSISTENT_CHIPS]
  },

  getPanelType: () => {
    const forced = get().sidebarForcePanel
    if (forced) return forced
    return PHASE_TO_PANEL[derivePhase(get().pipelineState.data, get().connectionId)] || 'upload'
  },

  getTokenColor: (signature) => {
    const map = get().tokenColorMap
    return map[signature] || tokenColor(signature || '0')
  },

  // ═══════════════════════════════════════════════════════════
  // SETTERS WITH AUTOMATIC INVALIDATION
  // ═══════════════════════════════════════════════════════════

  setTemplateData: (template, changeType = 'structural') => {
    plog.store(`setTemplateData (${changeType})`, {
      has_html: !!template.html,
      html_len: template.html?.length,
      has_tokens: !!template.tokens,
      token_count: template.tokens?.length,
      has_schema: !!template.schema,
    })
    set(state => {
      const ps = { ...state.pipelineState }
      const d = { ...ps.data }

      // Record undo (shallow copy of changed field only)
      const history = [...ps.history, { field: 'template', before: d.template, timestamp: Date.now() }]
      if (history.length > 30) history.shift()

      const prev = d.template || {}
      d.template = { ...prev, ...template }

      // Detect token change
      const prevTokens = extractTokens(prev.html)
      const newTokens = extractTokens(d.template.html)
      const tokensChanged = !setsEqual(prevTokens, newTokens)

      if (changeType === 'layout_only' || !tokensChanged) {
        d.validation = {}
        d.generation = { ...d.generation, previewApproved: false }
      } else {
        // Full downstream invalidation
        d.mapping = { catalog: d.mapping?.catalog }
        d.contract = {}
        d.validation = {}
        d.generation = { ...d.generation, batches: [], jobs: [], previewApproved: false }
        ps.errors = []
      }

      // Update token list
      d.template.tokens = [...newTokens]

      // Track template version for diff view
      const templateVersions = [...state.templateVersions]
      if (d.template.html && d.template.html !== prev.html) {
        templateVersions.push({
          html: d.template.html,
          timestamp: Date.now(),
          label: `v${templateVersions.length + 1}`,
        })
        // Keep max 10 versions
        if (templateVersions.length > 10) templateVersions.shift()
      }

      _persistHistory(get)
      return { pipelineState: { ...ps, data: d, history }, templateVersions }
    })
  },

  setMappingData: (mapping) => {
    plog.store('setMappingData', {
      mapping_keys: mapping.mapping ? Object.keys(mapping.mapping).length : '-',
      has_confidence: !!mapping.confidence,
      has_candidates: !!mapping.candidates,
      has_catalog: !!mapping.catalog,
      has_token_samples: !!mapping.token_samples,
      status: mapping.status,
    })
    set(state => {
      const ps = { ...state.pipelineState }
      const d = { ...ps.data }
      const history = [...ps.history, { field: 'mapping', before: d.mapping, timestamp: Date.now() }]
      if (history.length > 30) history.shift()

      d.mapping = { ...d.mapping, ...mapping }
      // Invalidate downstream
      d.contract = {}
      d.validation = {}
      d.generation = { ...d.generation, previewApproved: false }

      _persistHistory(get)
      return { pipelineState: { ...ps, data: d, history } }
    })
  },

  setContractData: (contract) => {
    plog.store('setContractData', {
      has_contract: !!contract.contract,
      has_fields: !!contract.contract?.fields,
      field_count: contract.contract?.fields ? Object.keys(contract.contract.fields).length : 0,
      has_joins: !!contract.contract?.joins,
      has_constraints: !!contract.contract?.constraints,
    })
    set(state => {
      const ps = { ...state.pipelineState }
      const d = { ...ps.data }
      d.contract = { ...d.contract, ...contract }
      d.validation = {} // Invalidate downstream
      return { pipelineState: { ...ps, data: d } }
    })
  },

  setValidationData: (validation) => {
    plog.store('setValidationData', {
      result: validation.result,
      passed: validation.passed,
      issue_count: validation.issues?.length || 0,
      has_autoFixable: validation.issues?.some(i => i.autoFixable),
    })
    set(state => {
      const ps = { ...state.pipelineState }
      const d = { ...ps.data }
      d.validation = { ...d.validation, ...validation }
      return { pipelineState: { ...ps, data: d } }
    })
  },

  setGenerationData: (generation) => {
    plog.store('setGenerationData', {
      batch_count: generation.batches?.length,
      job_count: generation.jobs?.length,
    })
    set(state => {
      const ps = { ...state.pipelineState }
      const d = { ...ps.data }
      d.generation = { ...d.generation, ...generation }
      return { pipelineState: { ...ps, data: d } }
    })
  },

  setErrors: (errors) => {
    plog.store('setErrors', { count: errors?.length || 0, severities: [...new Set((errors||[]).map(e=>e.severity))] })
    set(state => ({ pipelineState: { ...state.pipelineState, errors } }))
  },

  setProgress: (progress) =>
    set(state => ({ pipelineState: { ...state.pipelineState, progress } })),

  updateProgressStage: (stageName, updates) =>
    set(state => {
      const ps = { ...state.pipelineState }
      const stages = [...ps.progress.stages]
      const idx = stages.findIndex(s => s.name === stageName)
      if (idx >= 0) {
        stages[idx] = { ...stages[idx], ...updates }
      } else {
        stages.push({ name: stageName, status: 'pending', progress: 0, startedAt: Date.now(), ...updates })
      }
      return { pipelineState: { ...ps, progress: { ...ps.progress, stages, currentStage: stageName } } }
    }),

  // ─── Undo ───
  undo: () =>
    set(state => {
      const ps = { ...state.pipelineState }
      const history = [...ps.history]
      const entry = history.pop()
      if (!entry) return state
      const d = { ...ps.data }
      d[entry.field] = entry.before
      return { pipelineState: { ...ps, data: d, history } }
    }),

  canUndo: () => get().pipelineState.history.length > 0,

  // B10: Revert to a specific history point (restore all snapshots after that index)
  revertToHistory: (targetIndex) =>
    set(state => {
      const ps = { ...state.pipelineState }
      const history = [...ps.history]
      if (targetIndex < 0 || targetIndex >= history.length) return state
      const d = { ...ps.data }
      // Replay backwards from end to targetIndex+1, restoring each snapshot
      for (let i = history.length - 1; i > targetIndex; i--) {
        const entry = history[i]
        if (entry?.field && entry.before) {
          d[entry.field] = entry.before
        }
      }
      return { pipelineState: { ...ps, data: d, history: history.slice(0, targetIndex + 1) } }
    }),

  // ─── Token colors ───
  registerTokenColors: (tokenSignatures) =>
    set(state => {
      const map = { ...state.tokenColorMap }
      for (const [name, sig] of Object.entries(tokenSignatures || {})) {
        if (sig && !map[sig]) map[sig] = tokenColor(sig)
      }
      return { tokenColorMap: map }
    }),

  // ═══════════════════════════════════════════════════════════
  // SESSION
  // ═══════════════════════════════════════════════════════════

  initSession: (sessionId = null) => {
    const id = sessionId || nanoid(12)
    set({
      sessionId: id,
      sessionName: 'New Pipeline',
      pipelineState: {
        data: { template: {}, mapping: {}, contract: {}, validation: {}, generation: {} },
        errors: [], progress: { stages: [], currentStage: null }, history: [],
      },
      messages: [],
      connectionId: null,
      templateId: null,
      tokenColorMap: {},
    })
    get().addAssistantMessage("Welcome! Upload a PDF or Excel file, or describe the report you'd like to create.")
  },

  resumeSession: (sessionData) => set({
    sessionId: sessionData.session_id,
    connectionId: sessionData.connection_id,
    connectionIds: sessionData.connection_ids || (sessionData.connection_id ? [sessionData.connection_id] : []),
    templateId: sessionData.template_id,
  }),

  reset: () => get().initSession(),

  // ═══════════════════════════════════════════════════════════
  // MESSAGES (chat only — text, errors, follow-up, progress)
  // ═══════════════════════════════════════════════════════════

  addUserMessage: (content, type = 'text', data = null) => {
    const msg = { id: nanoid(), role: 'user', type, content, data, timestamp: Date.now(), streaming: false }
    set(s => ({ messages: [...s.messages, msg] }))
    return msg
  },

  addAssistantMessage: (content, type = 'text', data = null) => {
    const msg = { id: nanoid(), role: 'assistant', type, content, data, timestamp: Date.now(), streaming: false }
    set(s => ({ messages: [...s.messages, msg] }))
    return msg
  },

  // Streaming (evolving progress message)
  startStreaming: () => {
    const msg = { id: nanoid(), role: 'assistant', type: 'evolving_progress', content: '', data: { stages: [] }, timestamp: Date.now(), streaming: true }
    set(s => ({ messages: [...s.messages, msg], isProcessing: true }))
    return msg.id
  },

  updateStreamingProgress: (stageName, status, progress = 0) => {
    set(s => ({
      messages: s.messages.map(m => {
        if (!m.streaming) return m
        const stages = [...(m.data?.stages || [])]
        const now = Date.now()
        const idx = stages.findIndex(st => st.name === stageName)
        const isDone = status === 'complete' || status === 'success'
        if (idx >= 0) {
          const existing = stages[idx]
          stages[idx] = {
            ...existing,
            status,
            progress,
            ...(isDone ? { completedAt: now } : {}),
          }
        } else {
          stages.push({ name: stageName, status, progress, timestamp: now, ...(isDone ? { completedAt: now } : {}) })
        }

        // When "x.complete" arrives, also mark "x.start" as complete.
        // When a stage completes, also mark related sub-stages as complete.
        // Relationships: "verify_template" owns "verify.*" sub-stages,
        // "auto_map_tokens" owns "mapping.*", "build_contract" owns "contract.*", etc.
        if (isDone) {
          // Map tool names to their sub-stage prefixes
          const toolPrefix = stageName.replace(/_.*/, '') // "verify_template" → "verify", "auto_map_tokens" → "auto"
          const dotPrefix = stageName.split('.')[0] // "verify.complete" → "verify"
          stages.forEach((st, i) => {
            if (st.status !== 'complete' && st.status !== 'success' && st.name !== stageName) {
              const stRoot = st.name.split('.')[0]
              // Match: "verify.start" when "verify_template" completes (stRoot "verify" === toolPrefix "verify")
              // Match: "verify.start" when "verify.complete" completes (stRoot "verify" === dotPrefix "verify")
              // Match: "mapping.auto_map" when "auto_map_tokens" completes (stRoot "mapping" relates to "auto_map")
              if (stRoot === toolPrefix || stRoot === dotPrefix) {
                stages[i] = { ...st, status: 'complete', completedAt: now }
              }
            }
          })
        }

        return { ...m, data: { ...m.data, stages } }
      }),
    }))
  },

  finishStreaming: () => {
    set(s => ({
      messages: s.messages.map(m => m.streaming ? { ...m, streaming: false } : m),
      isProcessing: false,
    }))
  },

  // ═══════════════════════════════════════════════════════════
  // PROCESS BACKEND EVENTS (NDJSON)
  // ═══════════════════════════════════════════════════════════

  processEvent: (event) => {
    const store = get()
    const type = event.event

    plog.event(`processEvent type=${type || 'legacy'} action=${event.action || '-'} state=${event.pipeline_state || '-'}`, {
      type, action: event.action, pipeline_state: event.pipeline_state,
      has_action_result: !!event.action_result,
      has_status_view: !!event.status_view,
      has_panel: !!event.panel,
      keys: Object.keys(event),
    })

    // ── Legacy format detection (prodo backend returns different shapes) ──
    // Legacy chat-create: { status: "ok", message: "...", ready_to_apply, updated_html, ... }
    if (!type && event.status === 'ok' && event.message) {
      store.finishStreaming()
      store.addAssistantMessage(event.message)
      if (event.updated_html) store.setTemplateData({ html: event.updated_html })
      if (event.template_id) set({ templateId: event.template_id })
      if (event.follow_up_questions?.length)
        store.addAssistantMessage('', 'follow_up', { questions: event.follow_up_questions })
      // Legacy mapping preview result
      if (event.mapping) store.setMappingData({ mapping: event.mapping, errors: event.errors || [] })
      // Legacy tokens from create-from-chat
      if (event.tokens) store.setTemplateData({ tokens: event.tokens }, 'structural')
      return
    }

    // Legacy verify "result" event
    if (type === 'result' && event.template_id) {
      store.finishStreaming()
      set({ templateId: event.template_id })
      store.addAssistantMessage(`Template created: ${event.template_id}`)
      if (event.schema) store.setTemplateData({ schema: event.schema }, 'structural')
      return
    }

    // Legacy mapping/approve NDJSON (same stage format as unified)
    // Falls through to the standard 'stage' handler below

    switch (type) {
      case 'chat_start':
        store.startStreaming()
        break

      case 'stage':
        store.updateStreamingProgress(
          event.stage || 'processing',
          event.status || 'running',
          event.progress || 0,
        )
        store.updateProgressStage(event.stage, { status: event.status, progress: event.progress })
        break

      case 'chat_complete': {
        store.finishStreaming()

        // Update session ID + template ID from backend (enables URL sync + hydration)
        if (event.session_id && event.session_id !== get().sessionId) set({ sessionId: event.session_id })
        if (event.template_id) set({ templateId: event.template_id })

        // Chat message (text only)
        if (event.message) store.addAssistantMessage(event.message)

        // Route structured data to pipelineState.data (NOT to messages)
        const action = event.action

        // ── Hydration: bulk-restore all session artifacts without
        //    triggering history pushes or invalidation cascades ──
        if (action === 'hydrate') {
          const r = event.action_result || {}
          plog.hydrate('hydrate action_result', {
            has_template: !!r.template?.html,
            has_mapping: !!r.mapping?.mapping,
            mapping_keys: r.mapping?.mapping ? Object.keys(r.mapping.mapping).length : 0,
            has_confidence: !!r.mapping?.confidence,
            has_candidates: !!r.mapping?.candidates,
            has_contract: !!r.contract,
            contract_has_fields: !!r.contract?.contract?.fields,
            contract_has_joins: !!r.contract?.contract?.joins,
            has_validation: !!r.validation,
            validation_result: r.validation?.result,
            issue_count: r.validation?.issues?.length || 0,
            has_generation: !!r.generation,
            has_history: !!r.history?.length,
          })
          set(state => {
            const d = { ...state.pipelineState.data }
            if (r.template?.html) d.template = { ...d.template, ...r.template }
            if (r.mapping?.mapping) d.mapping = { ...d.mapping, ...r.mapping }
            if (r.contract) d.contract = { ...d.contract, ...r.contract }
            if (r.validation) d.validation = { ...d.validation, ...r.validation }
            if (r.generation) d.generation = { ...d.generation, ...r.generation }
            // Restore history if persisted (D12 action replay)
            const history = r.history?.length ? r.history : state.pipelineState.history
            return { pipelineState: { ...state.pipelineState, data: d, history } }
          })
          if (event.template_id) set({ templateId: event.template_id })
          if (event.template_kind) set({ templateKind: event.template_kind })
          if (event.connection_id) set({ connectionId: event.connection_id })
          if (event.status_view) store.setStatusView(event.status_view)
          if (event.column_stats) store.setColumnStats(event.column_stats)
          if (event.performance_metrics) store.setPerformanceMetrics(event.performance_metrics)
          if (event.constraint_violations) store.setConstraintViolations(event.constraint_violations)
          if (event.panel?.available) store.setAvailablePanels(event.panel.available)
          if (event.token_color_map) set({ tokenColorMap: event.token_color_map })
          if (event.learning_signal) store.setLearningSignal(event.learning_signal)
          if (event.custom_constraint_rules) store.setCustomConstraintRules(event.custom_constraint_rules)
          if (event.temporal_data) store.setColumnStats({ ...store.columnStats, _temporalCache: event.temporal_data })
          // Populate errors from validation issues (used by ErrorsTab, PipelineStrip)
          if (r.validation?.issues) store.setErrors(r.validation.issues)
          plog.hydrate('hydrate complete', {
            panels: event.panel?.available,
            has_status_view: !!event.status_view,
            has_learning_signal: !!event.learning_signal,
            patterns_count: event.learning_signal?.patterns?.length || 0,
            error_count: r.validation?.issues?.length || 0,
            phase: derivePhase(get().pipelineState.data),
          })
          // Note: pipeline phase is derived by getPhase() from pipelineState.data,
          // so no explicit phase write is needed — setting the data fields is enough.
          break  // Skip normal chat_complete processing
        }

        if (event.updated_html) {
          store.setTemplateData({ html: event.updated_html })
        }

        if (action === 'verify' && event.action_result?.tokens) {
          store.setTemplateData({
            tokens: event.action_result.tokens.map(t => t.name || t),
            schema: event.action_result.schema,
          }, 'structural')
          if (event.action_result.token_signatures) {
            store.registerTokenColors(event.action_result.token_signatures)
          }
          if (event.action_result.kind) {
            set({ templateKind: event.action_result.kind })
            plog.store(`templateKind → ${event.action_result.kind}`)
          }
        }

        if (action === 'map' && event.action_result) {
          store.setMappingData(event.action_result)
          if (event.action_result.token_signatures) {
            store.registerTokenColors(event.action_result.token_signatures)
          }
        }

        if (action === 'approve' && event.action_result?.contract) {
          store.setContractData(event.action_result)
        }

        if (action === 'validate' && event.action_result) {
          store.setValidationData(event.action_result)
          if (event.action_result.issues) {
            store.setErrors(event.action_result.issues)
          }
        }

        if (action === 'discover' && event.action_result?.batches) {
          store.setGenerationData({ batches: event.action_result.batches })
        }

        if (action === 'generate' && event.action_result) {
          const jobs = event.action_result.jobs || [event.action_result]
          store.setGenerationData({ jobs })
        }

        // Status view + panel signals from backend
        if (event.status_view) store.setStatusView(event.status_view)
        if (event.panel?.available) store.setAvailablePanels(event.panel.available)
        if (event.panel?.show) store.setActivePanel(event.panel.show)

        // Learning signal for pipeline health diagnostics
        if (event.learning_signal) store.setLearningSignal(event.learning_signal)

        // Extended data for OSS panel features
        if (event.column_stats) store.setColumnStats(event.column_stats)
        if (event.performance_metrics) store.setPerformanceMetrics(event.performance_metrics)
        if (event.constraint_violations) store.setConstraintViolations(event.constraint_violations)

        // Sync connection_ids from backend (multi-DB support)
        if (event.connection_ids) store.setConnection(event.connection_ids)

        // Follow-up as action chips (not as a message)
        // The LLM's follow_up_questions become suggestions in chat
        if (event.follow_up_questions?.length) {
          store.addAssistantMessage('', 'follow_up', { questions: event.follow_up_questions })
        }

        break
      }

      default:
        break
    }
  },

  // ═══════════════════════════════════════════════════════════
  // UI
  // ═══════════════════════════════════════════════════════════

  setInputValue: (v) => set({ inputValue: v }),
  setIsProcessing: (v) => set({ isProcessing: v }),
  toggleThinking: () => set(s => ({ thinkingEnabled: !s.thinkingEnabled })),
  setConnection: (idOrIds) => {
    if (Array.isArray(idOrIds)) {
      set({ connectionIds: idOrIds, connectionId: idOrIds[0] || null })
    } else {
      set({ connectionId: idOrIds, connectionIds: idOrIds ? [idOrIds] : [] })
    }
  },
  setTemplateId: (id) => set({ templateId: id }),
  setTemplateKind: (kind) => set({ templateKind: kind }),
  setSidebarForcePanel: (panel) => set({ sidebarForcePanel: panel }),
  toggleWorkspaceMode: () => set(s => ({ workspaceMode: !s.workspaceMode })),
  setActivePanel: (p) => { plog.action(`setActivePanel → ${p}`); set(s => ({ activePanel: s.activePanel === p ? null : p })) },
  setAvailablePanels: (p) => { plog.store('setAvailablePanels', p); set({ availablePanels: p }) },
  togglePanelPin: (id) => set(s => ({
    pinnedPanels: s.pinnedPanels.includes(id)
      ? s.pinnedPanels.filter(p => p !== id)
      : [...s.pinnedPanels, id],
  })),
  setStatusView: (sv) => { plog.store('setStatusView', { step: sv?.step, cards: sv?.cards?.length, problems: sv?.problems?.length, has_example: !!sv?.example, has_row_counts: !!sv?.row_counts }); set({ statusView: sv }) },
  setHighlightedField: (f) => { if (f) plog.action(`highlightField → ${f}`); set({ highlightedField: f }) },
  clearHighlightedField: () => set({ highlightedField: null }),
  setLearningSignal: (signal) => { plog.store('setLearningSignal', { patterns: signal?.patterns?.length || 0 }); set({ learningSignal: signal }) },
  // Timeline scrubber state replay
  historyPreview: null,
  previewHistoryAt: (index) => set(s => ({
    historyPreview: s.pipelineState.history[index] || null,
  })),
  clearHistoryPreview: () => set({ historyPreview: null }),
  setSourceMode: (mode) => set({ sourceMode: mode }),
  setSelectedToken: (token) => set({ selectedToken: token }),
  clearSelectedToken: () => set({ selectedToken: null }),
  setSelectedIssue: (issue) => set({ selectedIssue: issue }),
  clearSelectedIssue: () => set({ selectedIssue: null }),
  pinCard: (card) => set(s => ({ pinnedCards: [...s.pinnedCards, card] })),
  unpinCard: (id) => set(s => ({ pinnedCards: s.pinnedCards.filter(c => c.id !== id) })),
}))

export default usePipelineStore
export { STEPS, TRANSITION_RULES, GATE_REASONS, PHASE_CHIPS, PERSISTENT_CHIPS, PHASE_TO_PANEL, TOKEN_COLORS }
