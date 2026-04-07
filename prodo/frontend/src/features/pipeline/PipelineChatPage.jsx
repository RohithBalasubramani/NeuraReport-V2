/**
 * PipelineChatPage — the unified pipeline interface.
 *
 * Layout: PipelineBar (top) + Chat (left 55%) + LivePanel (right 45%)
 * ActionChips sit between ChatStream and ChatInput.
 *
 * Chat = intent + narration. Panel = state + control + execution.
 * Messages never contain interactive UI — all structured data lives in the panel.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Box, Button, Snackbar, Stack, Switch, Typography } from '@mui/material'

import PipelineBar from './PipelineBar'
import ChatStream from './ChatStream'
import ChatInput from './ChatInput'
import ActionChips from './ActionChips'
import PanelButtons from './PanelButtons'
import LivePanel from './panels/LivePanel'
import usePipelineStore from '@/stores/pipeline'
import { pipelineChat, pipelineChatUpload } from '@/api/client'

export default function PipelineChatPage() {
  const { sessionId: urlSessionId } = useParams()
  const [searchParams] = useSearchParams()
  const store = usePipelineStore()
  const { sessionId, templateId, connectionId } = store

  // Initialize or resume session, handle query params from redirects
  useEffect(() => {
    if (urlSessionId && urlSessionId !== sessionId) {
      fetch(`/api/v1/pipeline/${urlSessionId}`)
        .then(r => r.json())
        .then(data => {
          store.resumeSession(data)
          // Hydrate full store with all session artifacts so widgets
          // have data immediately (template, mapping, contract, etc.)
          fetch(`/api/v1/pipeline/${urlSessionId}/hydrate`)
            .then(r => r.json())
            .then(hydration => { if (hydration) store.processEvent(hydration) })
            .catch(err => console.warn('Hydration failed, widgets will populate via chat:', err))
        })
        .catch(() => store.initSession())
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

  // ─── Handle backend response (NDJSON streaming or plain JSON) ───
  const streamResponse = useCallback(async (response) => {
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
            store.processEvent(event)
          } else if (event && typeof event === 'object') {
            // Legacy event without 'event' field — process anyway
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
    workspace_mode: store.workspaceMode,
    messages: store.messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.type === 'text')
      .map(m => ({ role: m.role, content: m.content })),
    html: store.pipelineState.data.template?.html || null,
    ...extra,
  }), [sessionId, templateId, connectionId, store])

  // ─── Send text message ───
  const handleSend = useCallback(async (text) => {
    store.addUserMessage(text)
    store.setIsProcessing(true)
    try {
      const payload = buildPayload()
      payload.messages.push({ role: 'user', content: text })
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

  // ─── Handle action (from chips, panel, or slash commands) ───
  const handleAction = useCallback(async (actionOrObj) => {
    const action = typeof actionOrObj === 'string' ? actionOrObj : actionOrObj?.type || actionOrObj?.action
    if (!action) return

    // Pre-fill actions: let user complete their thought before sending
    if (action === 'web_search') {
      store.setInputValue('Search: ')
      return
    }
    if (action === 'clarify') {
      store.setInputValue('I need help with ')
      return
    }

    store.setIsProcessing(true)
    try {
      const payload = buildPayload({
        action,
        action_params: typeof actionOrObj === 'object' ? actionOrObj : {},
        messages: [{ role: 'user', content: action }],
      })
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

          {/* Action chips */}
          <ActionChips onAction={handleAction} />

          {/* Panel toggle buttons */}
          <PanelButtons />

          {/* Input */}
          <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
            <ChatInput
              onSend={handleSend}
              onFileUpload={handleFileUpload}
              onSlashCommand={handleAction}
            />
          </Box>
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
