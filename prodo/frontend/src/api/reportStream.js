/**
 * SSE Streaming Client for V2 Enhanced Report Generation.
 *
 * Connects to the /reports/generate-enhanced endpoint and streams
 * pipeline stage progress events to the pipelineStore.
 */
import { api } from './client'

/**
 * Stream report generation via SSE.
 *
 * @param {Object} params - Report generation parameters
 * @param {string} params.templateId - Template ID
 * @param {string} params.connectionId - Connection ID
 * @param {string} [params.startDate] - Optional start date
 * @param {string} [params.endDate] - Optional end date
 * @param {Object} [params.keyValues] - Optional key values
 * @param {Object} callbacks - Event callbacks
 * @param {Function} callbacks.onStageStart - Called when a stage starts
 * @param {Function} callbacks.onStageComplete - Called when a stage completes
 * @param {Function} callbacks.onQualityScore - Called with quality score
 * @param {Function} callbacks.onComplete - Called when pipeline finishes
 * @param {Function} callbacks.onError - Called on error
 * @param {Function} [callbacks.onEvent] - Called for every raw event
 * @returns {Function} Cleanup function to close the connection
 */
export function streamReportGeneration(params, callbacks = {}) {
  const baseUrl = api.defaults.baseURL || ''
  const url = `${baseUrl}/reports/generate-enhanced`

  const body = JSON.stringify({
    template_id: params.templateId,
    connection_id: params.connectionId,
    start_date: params.startDate,
    end_date: params.endDate,
    key_values: params.keyValues,
  })

  let aborted = false
  const abortController = new AbortController()

  // Use fetch for POST-based SSE (EventSource only supports GET)
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body,
    signal: abortController.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`SSE connection failed: ${response.status} ${text}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!aborted) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue

          try {
            const event = JSON.parse(jsonStr)

            // Call raw event handler
            if (callbacks.onEvent) {
              callbacks.onEvent(event)
            }

            // Dispatch to typed callbacks
            switch (event.event) {
              case 'stage_start':
                if (callbacks.onStageStart) {
                  callbacks.onStageStart(event.stage, event.data)
                }
                break

              case 'stage_complete':
                if (callbacks.onStageComplete) {
                  callbacks.onStageComplete(event.stage, event.data)
                }
                break

              case 'stage_retry':
                if (callbacks.onStageRetry) {
                  callbacks.onStageRetry(event.stage, event.data)
                }
                break

              case 'quality_score':
                if (callbacks.onQualityScore) {
                  callbacks.onQualityScore(event.data)
                }
                break

              case 'pipeline_complete':
                if (callbacks.onComplete) {
                  callbacks.onComplete(event.data)
                }
                break

              case 'pipeline_fail':
              case 'error':
                if (callbacks.onError) {
                  callbacks.onError(event.data?.error || event.data?.message || 'Pipeline failed')
                }
                break

              case 'heartbeat':
                // Keepalive, no action needed
                break

              default:
                break
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }
    })
    .catch((err) => {
      if (!aborted && callbacks.onError) {
        callbacks.onError(err.message || 'Stream connection failed')
      }
    })

  // Return cleanup function
  return () => {
    aborted = true
    abortController.abort()
  }
}
