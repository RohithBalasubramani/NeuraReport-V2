import { runTemplateAgent } from '@/api/client'
import { useTemplateCreatorStore } from '@/stores/content'
import { useEffect, useRef } from 'react'

const QA_DEBOUNCE_MS = 2000

/**
 * Watches store state and auto-triggers backend agents.
 *
 * Trigger rules:
 *   template_qa  -> when currentHtml changes (debounced 2s)
 *   data_mapping -> when currentHtml + connectionId both exist
 *   data_quality -> when connectionId changes while HTML exists
 */
export function useAgentTrigger() {
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)
  const templateId = useTemplateCreatorStore((s) => s.templateId)
  const connectionId = useTemplateCreatorStore((s) => s.connectionId)
  const setAgentLoading = useTemplateCreatorStore((s) => s.setAgentLoading)
  const setAgentResult = useTemplateCreatorStore((s) => s.setAgentResult)

  const lastQaHtml = useRef(null)
  const lastMappingKey = useRef(null)
  const qaTimer = useRef(null)

  useEffect(() => {
    if (!currentHtml || currentHtml === lastQaHtml.current) return
    clearTimeout(qaTimer.current)
    qaTimer.current = setTimeout(() => {
      const htmlSnapshot = currentHtml
      lastQaHtml.current = htmlSnapshot
      setAgentLoading('template_qa', true)
      const id = templateId || '__draft__'
      runTemplateAgent(id, 'template_qa', { html_content: htmlSnapshot })
        .then((resp) => {
          if (useTemplateCreatorStore.getState().currentHtml === htmlSnapshot) {
            setAgentResult('template_qa', resp?.result ?? resp)
          }
        })
        .catch((err) => {
          console.warn('[useAgentTrigger] template_qa failed:', err.message || err)
        })
        .finally(() => {
          setAgentLoading('template_qa', false)
        })
    }, QA_DEBOUNCE_MS)
    return () => clearTimeout(qaTimer.current)
  }, [currentHtml, templateId, setAgentLoading, setAgentResult])

  useEffect(() => {
    if (!currentHtml || !connectionId) return
    const key = `${connectionId}::${currentHtml.length}`
    if (key === lastMappingKey.current) return
    lastMappingKey.current = key
    const id = templateId || '__draft__'
    setAgentLoading('data_mapping', true)
    runTemplateAgent(id, 'data_mapping', { html_content: currentHtml, connection_id: connectionId })
      .then((resp) => {
        setAgentResult('data_mapping', resp?.result ?? resp)
      })
      .catch((err) => {
        console.warn('[useAgentTrigger] data_mapping failed:', err.message || err)
      })
      .finally(() => {
        setAgentLoading('data_mapping', false)
      })
  }, [currentHtml, connectionId, templateId, setAgentLoading, setAgentResult])
}
