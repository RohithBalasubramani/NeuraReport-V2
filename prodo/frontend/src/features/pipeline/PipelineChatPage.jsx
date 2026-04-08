/**
 * PipelineChatPage — the unified pipeline interface.
 *
 * Layout: PipelineBar (top) + Chat (left 55%) + LivePanel (right 45%)
 * ActionChips sit between ChatStream and ChatInput.
 *
 * Chat = intent + narration. Panel = state + control + execution.
 * Messages never contain interactive UI — all structured data lives in the panel.
 */
import React, { useCallback, useEffect, useRef, useState, createRef } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Box, Button, Snackbar, Stack, Switch, Typography } from '@mui/material'

import PipelineBar from './PipelineBar'
import ChatStream from './ChatStream'
import ChatInput from './ChatInput'
import ActionChips from './ActionChips'
import PanelButtons from './PanelButtons'
import LivePanel from './panels/LivePanel'
import usePipelineStore from '@/stores/pipeline'
import { pipelineChat, pipelineChatUpload, pipelineChatWithAttachments } from '@/api/client'
import plog from '@/api/pipelineLogger'

export default function PipelineChatPage() {
  const { sessionId: urlSessionId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const store = usePipelineStore()
  const { sessionId, templateId, connectionId } = store
  const hydrationDone = useRef(false)
  const backendAware = useRef(false)  // true after backend has seen this session
  const fileInputRef = useRef(null)

  // ─── Hydrate a session: fetch metadata + full artifacts ───
  const hydrateSession = useCallback((sid) => {
    if (!sid || hydrationDone.current) return
    hydrationDone.current = true
    plog.api(`GET /pipeline/${sid} (resume)`)
    fetch(`/api/v1/pipeline/${sid}`)
      .then(r => {
        if (r.status === 404) {
          // Session doesn't exist on backend — new session, just init locally.
          // This is normal on page refresh for sessions that haven't uploaded yet.
          store.initSession(sid)
          return null
        }
        if (!r.ok) throw new Error(r.status)
        return r.json()
      })
      .then(data => {
        if (!data) return
        store.resumeSession(data)
        backendAware.current = true
        plog.api(`GET /hydrate session=${sid}`)
        return fetch(`/api/v1/pipeline/${sid}/hydrate`)
          .then(r => r.ok ? r.json() : null)
          .then(hydration => {
            if (hydration) {
              plog.hydrate('hydration received', { keys: Object.keys(hydration), state: hydration?.pipeline_state })
              store.processEvent(hydration)
            }
          })
      })
      .catch(err => {
        plog.error('Hydration failed', { error: err.message })
        hydrationDone.current = false
      })
  }, [store])

  // Initialize or resume session, handle query params from redirects
  useEffect(() => {
    if (urlSessionId && urlSessionId !== sessionId) {
      hydrateSession(urlSessionId)
    } else if (!sessionId) {
      store.initSession()
    }

    // Handle query params from legacy route redirects
    const qTemplateId = searchParams.get('templateId')
    const qMode = searchParams.get('mode')
    const qConnectionId = searchParams.get('connectionId')
    const qPhase = searchParams.get('phase')

    if (qTemplateId) {
      store.setTemplateId(qTemplateId)
      // Load template HTML from backend
      fetch(`/api/v1/templates/${qTemplateId}/html`)
        .then(r => r.json())
        .then(data => {
          if (data.html) store.setTemplateData({ html: data.html }, 'structural')
        })
        .catch(() => {})
    }
    if (qConnectionId) store.setConnection(qConnectionId)
    if (qMode === 'describe') {
      store.addAssistantMessage("Let's create a template from scratch. What kind of report do you need?")
    }
    if (qPhase === 'generate') store.setSidebarForcePanel('generation')
  }, [urlSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Sync URL with session ID ONLY after backend has seen it ───
  // Don't put a fresh local session ID in the URL — refreshing would 404
  // because the backend doesn't have a directory for it yet.
  useEffect(() => {
    if (sessionId && sessionId !== urlSessionId && backendAware.current) {
      navigate(`/pipeline/${sessionId}`, { replace: true })
    }
  }, [sessionId, urlSessionId, navigate])

  // ─── Handle backend response (NDJSON streaming or plain JSON) ───
  const streamResponse = useCallback(async (response) => {
    // Capture session ID from response header (backend always sets this)
    const backendSessionId = response.headers.get('X-Session-Id')
    if (backendSessionId && backendSessionId !== usePipelineStore.getState().sessionId) {
      plog.store(`session ID from backend: ${backendSessionId}`)
      usePipelineStore.setState({ sessionId: backendSessionId })
    }
    // Backend has seen this session — safe to put ID in URL now
    backendAware.current = true
    if (sessionId && sessionId !== urlSessionId) {
      navigate(`/pipeline/${sessionId}`, { replace: true })
    }

    const contentType = response.headers.get('content-type') || ''

    // Plain JSON response (legacy endpoints like /templates/chat-create)
    if (contentType.includes('application/json')) {
      const data = await response.json()
      store.processEvent(data)
      return
    }

    // NDJSON streaming response with error recovery
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let parseErrors = 0
    const MAX_PARSE_ERRORS = 10

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          // Validate event structure before processing
          if (event && typeof event === 'object' && event.event) {
            plog.event(`NDJSON ← ${event.event} ${event.stage || event.action || ''}`, { event: event.event, stage: event.stage, action: event.action, status: event.status, progress: event.progress })
            store.processEvent(event)
          } else if (event && typeof event === 'object') {
            plog.event('NDJSON ← legacy (no event field)', { keys: Object.keys(event) })
            store.processEvent(event)
          }
          parseErrors = 0 // Reset on success
        } catch (err) {
          parseErrors++
          if (parseErrors >= MAX_PARSE_ERRORS) {
            console.error('NDJSON: too many parse errors, stopping stream')
            store.addAssistantMessage('Stream interrupted: too many malformed events', 'error')
            return
          }
          console.warn('NDJSON parse error:', err.message, line.slice(0, 100))
        }
      }
    }
    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer)
        if (event && typeof event === 'object') store.processEvent(event)
      } catch (err) {
        console.warn('NDJSON final buffer parse error:', err.message)
      }
    }
  }, [store])

  // ─── Build message payload for backend ───
  const buildPayload = useCallback((extra = {}) => ({
    session_id: sessionId,
    template_id: templateId,
    connection_id: connectionId,
    template_kind: store.templateKind || 'pdf',
    workspace_mode: store.workspaceMode,
    messages: store.messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.type === 'text')
      .map(m => ({ role: m.role, content: m.content })),
    html: store.pipelineState.data.template?.html || null,
    ...extra,
  }), [sessionId, templateId, connectionId, store])

  // ─── Send text message ───
  const handleSend = useCallback(async (text) => {
    plog.action(`chat.send: "${text.slice(0,80)}"`, { session: sessionId, template: templateId, connection: connectionId })
    store.addUserMessage(text)
    store.setIsProcessing(true)
    try {
      const payload = buildPayload()
      payload.messages.push({ role: 'user', content: text })
      plog.api('POST /chat', { session: sessionId, msg_count: payload.messages.length, has_html: !!payload.html })
      const response = await pipelineChat(sessionId, payload)
      await streamResponse(response)
    } catch (err) {
      store.addAssistantMessage(`Error: ${err.message}`, 'error')
    } finally {
      store.setIsProcessing(false)
    }
  }, [store, sessionId, buildPayload, streamResponse])

  // ─── Upload file ───
  const handleFileUpload = useCallback(async (file) => {
    plog.action(`file.upload: ${file.name} (${(file.size/1024).toFixed(1)}KB)`, { name: file.name, size: file.size, type: file.type })
    store.addUserMessage(file.name, 'file_upload', { fileName: file.name, fileSize: file.size })
    store.setIsProcessing(true)
    try {
      const payload = buildPayload()
      payload.messages = [{ role: 'user', content: `Uploaded file: ${file.name}` }]
      const response = await pipelineChatUpload(sessionId, payload, file)
      await streamResponse(response)
    } catch (err) {
      store.addAssistantMessage(`Upload failed: ${err.message}`, 'error')
    } finally {
      store.setIsProcessing(false)
    }
  }, [store, sessionId, buildPayload, streamResponse])

  // ─── Send message with reference attachments (images, docs for context) ───
  const handleReferenceAttach = useCallback(async (text, files) => {
    const names = files.map(f => f.name).join(', ')
    plog.action(`reference.attach: ${names}`, { count: files.length, text: text.slice(0, 80) })
    store.addUserMessage(
      text,
      'file_upload',
      { fileName: names, fileSize: files.reduce((s, f) => s + f.size, 0), isReference: true }
    )
    store.setIsProcessing(true)
    try {
      const payload = buildPayload()
      payload.messages = [...payload.messages, { role: 'user', content: text }]
      const response = await pipelineChatWithAttachments(sessionId, payload, files)
      await streamResponse(response)
    } catch (err) {
      store.addAssistantMessage(`Attachment failed: ${err.message}`, 'error')
    } finally {
      store.setIsProcessing(false)
    }
  }, [store, sessionId, buildPayload, streamResponse])

  // ─── Handle action (from chips, panel, or slash commands) ───
  const handleAction = useCallback(async (actionOrObj) => {
    const action = typeof actionOrObj === 'string' ? actionOrObj : actionOrObj?.type || actionOrObj?.action
    if (!action) return

    // Upload file: trigger the hidden file input
    if (action === 'upload_file') {
      fileInputRef.current?.click()
      return
    }

    // Pre-fill actions: let user complete their thought before sending
    if (action === 'web_search') {
      store.setInputValue('Search: ')
      return
    }
    if (action === 'clarify') {
      store.setInputValue('I need help with ')
      return
    }

    plog.action(`action: ${action}`, typeof actionOrObj === 'object' ? actionOrObj : { action })
    store.setIsProcessing(true)
    try {
      const payload = buildPayload({
        action,
        action_params: typeof actionOrObj === 'object' ? actionOrObj : {},
        messages: [{ role: 'user', content: action }],
      })
      plog.api(`POST /chat action=${action}`, { session: sessionId })
      const response = await pipelineChat(sessionId, payload)
      await streamResponse(response)
    } catch (err) {
      store.addAssistantMessage(`Action failed: ${err.message}`, 'error')
    } finally {
      store.setIsProcessing(false)
    }
  }, [store, sessionId, buildPayload, streamResponse])

  // ─── Pipeline bar step click → navigate panel ───
  const handleStepClick = useCallback((stepId) => {
    const panelMap = { upload: 'upload', edit: 'edit', map: 'mapping', validate: 'validation', generate: 'generation' }
    store.setSidebarForcePanel(panelMap[stepId] || null)
  }, [store])

  // ─── Memory Preferences Snackbar ───
  const [memoryPref, setMemoryPref] = useState(null)

  // Listen for memory_applied events in processEvent
  useEffect(() => {
    const original = store.processEvent
    const wrapped = (event) => {
      if (event.memory_applied) {
        setMemoryPref(event.memory_applied)
      }
      return original(event)
    }
    // Monkey-patch temporarily
    store.processEvent = wrapped
    return () => { store.processEvent = original }
  }, [store])

  const handleMemoryAction = useCallback((action) => {
    if (action === 'reject') {
      handleAction({ type: 'reject_preference', preference: memoryPref })
    } else if (action === 'disable') {
      handleAction({ type: 'disable_preference', preference: memoryPref })
    }
    setMemoryPref(null)
  }, [memoryPref, handleAction])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Mode toggle + Pipeline progress bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: 1 }}>
          {!store.workspaceMode && <PipelineBar onStepClick={handleStepClick} />}
          {store.workspaceMode && (
            <Typography variant="subtitle2" sx={{ px: 3, py: 1.5, color: 'text.secondary' }}>
              Workspace — all tools available
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pr: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
            {store.workspaceMode ? 'Workspace' : 'Build Report'}
          </Typography>
          <Switch
            size="small"
            checked={store.workspaceMode}
            onChange={() => store.toggleWorkspaceMode()}
          />
        </Box>
      </Box>

      {/* Main content: Chat (left) + Panel (right) */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Chat area (55%) */}
        <Box sx={{ flex: '0 0 55%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* Messages */}
          <ChatStream />

          {/* Action chips (chat-related only: search, help) */}
          <ActionChips onAction={handleAction} />

          {/* Input */}
          <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
            <ChatInput
              onSend={handleSend}
              onAttach={handleReferenceAttach}
            />
          </Box>
          {/* Hidden file input for upload_file action from pinned Upload button */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,.xls"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileUpload(file)
              e.target.value = ''
            }}
          />
        </Box>

        {/* Live panel (45%) */}
        <LivePanel onAction={handleAction} />
      </Box>

      {/* Memory Preferences Snackbar */}
      <Snackbar
        open={!!memoryPref}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={
          <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
            Applied: {typeof memoryPref === 'string' ? memoryPref : memoryPref?.description || 'Remembered preference'}
          </Typography>
        }
        action={
          <Stack direction="row" spacing={0.5}>
            <Button size="small" color="inherit" onClick={() => setMemoryPref(null)}>Accept</Button>
            <Button size="small" color="warning" onClick={() => handleMemoryAction('reject')}>Reject</Button>
            <Button size="small" color="error" onClick={() => handleMemoryAction('disable')}>Disable</Button>
          </Stack>
        }
      />
    </Box>
  )
}
