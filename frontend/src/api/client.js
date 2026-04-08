import * as mock from './mock.js'
import { api, API_BASE, API_V1_BASE, toApiUrl, fetchWithIntent, applyIntentAndIdempotency } from '../core/httpClient'
export { api, API_BASE, API_V1_BASE, toApiUrl, fetchWithIntent }

const isAbsoluteUrl = (url) => /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url)

const runtimeEnv = {
  ...(typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env : {}),
  ...(globalThis.__NEURA_TEST_ENVIRONMENT__ || {}),
}

// helper: simulate latency in mock mode

export const sleep = (ms = 400) => new Promise(r => setTimeout(r, ms))

// whether to use mock API (defaults to false for production safety)

export const isMock = runtimeEnv.VITE_USE_MOCK === 'true'

const normalizeKind = (kind) => (kind === 'excel' ? 'excel' : 'pdf')

const TEMPLATE_ROUTES = {
  pdf: {
    verify: () => `/templates/verify`,
    mappingPreview: (id) => `/templates/${encodeURIComponent(id)}/mapping/preview`,
    corrections: (id) => `/templates/${encodeURIComponent(id)}/mapping/corrections-preview`,
    approve: (id) => `/templates/${encodeURIComponent(id)}/mapping/approve`,
    generator: (id) => `/templates/${encodeURIComponent(id)}/generator-assets/v1`,
    chartSuggest: (id) => `/templates/${encodeURIComponent(id)}/charts/suggest`,
    savedCharts: (id) => `/templates/${encodeURIComponent(id)}/charts/saved`,
    manifest: (id) => `/templates/${encodeURIComponent(id)}/artifacts/manifest`,
    head: (id, name) =>
      `/templates/${encodeURIComponent(id)}/artifacts/head?name=${encodeURIComponent(name)}`,
    keys: (id) => `/templates/${encodeURIComponent(id)}/keys/options`,
    discover: () => `/reports/discover`,
    run: () => `/reports/run`,
    runJob: () => `/reports/jobs/run-report`,
    uploadsBase: '/uploads',
    manifestBase: '/templates',
  },
  excel: {
    verify: () => `/excel/verify`,
    mappingPreview: (id) => `/excel/${encodeURIComponent(id)}/mapping/preview`,
    corrections: (id) => `/excel/${encodeURIComponent(id)}/mapping/corrections-preview`,
    approve: (id) => `/excel/${encodeURIComponent(id)}/mapping/approve`,
    generator: (id) => `/excel/${encodeURIComponent(id)}/generator-assets/v1`,
    chartSuggest: (id) => `/excel/${encodeURIComponent(id)}/charts/suggest`,
    savedCharts: (id) => `/excel/${encodeURIComponent(id)}/charts/saved`,
    manifest: (id) => `/excel/${encodeURIComponent(id)}/artifacts/manifest`,
    head: (id, name) =>
      `/excel/${encodeURIComponent(id)}/artifacts/head?name=${encodeURIComponent(name)}`,
    keys: (id) => `/excel/${encodeURIComponent(id)}/keys/options`,
    discover: () => `/excel/reports/discover`,
    run: () => `/excel/reports/run`,
    runJob: () => `/excel/jobs/run-report`,
    uploadsBase: '/excel-uploads',
    manifestBase: '/excel',
  },
}

const getTemplateRoutes = (kind) => TEMPLATE_ROUTES[normalizeKind(kind)]

const prepareKeyValues = (values) => {
  if (!values || typeof values !== 'object') return undefined
  const payload = {}
  Object.entries(values).forEach(([token, raw]) => {
    if (!token) return
    if (Array.isArray(raw)) {
      const normalized = raw
        .map((value) => (value == null ? '' : String(value).trim()))
        .filter(Boolean)
      if (!normalized.length) return
      payload[token] = normalized.length === 1 ? normalized[0] : normalized
      return
    }
    if (raw === undefined || raw === null) return
    const text = typeof raw === 'string' ? raw.trim() : raw
    if (typeof text === 'string') {
      if (!text) return
      payload[token] = text
      return
    }
    payload[token] = raw
  })
  return Object.keys(payload).length ? payload : undefined
}

/* ------------------------ NEW: small utilities ------------------------ */

// Build absolute URLs for artifacts the API returns (e.g. /uploads/...)

export const withBase = (pathOrUrl) =>
  isAbsoluteUrl(pathOrUrl) ? pathOrUrl : toApiUrl(pathOrUrl)

export async function fetchArtifactManifest(templateId, { kind = 'pdf' } = {}) {
  const res = await fetchWithIntent(getTemplateRoutes(kind).manifest(templateId))
  if (!res.ok) {
    throw new Error(await res.text().catch(() => `Manifest fetch failed (${res.status})`))
  }
  const data = await res.json()
  return data?.manifest ?? data
}

export async function fetchArtifactHead(templateId, name, { kind = 'pdf' } = {}) {
  const url = getTemplateRoutes(kind).head
    ? getTemplateRoutes(kind).head(templateId, name)
    : `${getTemplateRoutes(kind).manifest(templateId).replace('/manifest', '')}/${encodeURIComponent(name)}`
  const res = await fetchWithIntent(url, { method: 'HEAD' })
  return res.ok
}

/**
 * Shared utility for handling NDJSON streaming responses.
 * Use this for new streaming endpoints to avoid code duplication.
 *
 * @param {Response} res - Fetch response with streaming body
 * @param {Object} options - Options object
 * @param {Function} options.onEvent - Called for each parsed event
 * @param {string} options.errorMessage - Error message prefix for failures
 * @returns {Promise<Object>} The final result event payload
 *
 * @example
 * const result = await handleStreamingResponse(res, {
 *   onEvent: (event) => console.log(event),
 *   errorMessage: 'Operation failed',
 * })
 */
export async function handleStreamingResponse(res, { onEvent, errorMessage = 'Request failed' } = {}) {
  if (!res.ok || !res.body) {
    let detail
    try {
      const data = await res.json()
      detail = data?.detail
    } catch {
      detail = await res.text().catch(() => null)
    }
    throw new Error(detail || errorMessage)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalEvent = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let newlineIndex
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (!line) continue

      let payload
      try {
        payload = JSON.parse(line)
      } catch {
        continue
      }

      onEvent?.(payload)

      if (payload.event === 'result') {
        finalEvent = payload
      } else if (payload.event === 'error') {
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
        const err = new Error(payload.detail || errorMessage)
        err.detail = payload.detail
        throw err
      }
    }
  }

  // Handle any remaining data in buffer
  if (buffer.trim()) {
    let payload
    try {
      payload = JSON.parse(buffer.trim())
    } catch {
      // ignore unparseable trailing data
    }
    if (payload) {
      onEvent?.(payload)
      if (payload.event === 'result') {
        finalEvent = payload
      } else if (payload.event === 'error') {
        const err = new Error(payload.detail || errorMessage)
        err.detail = payload.detail
        throw err
      }
    }
  }

  if (!finalEvent) {
    throw new Error(`${errorMessage}: no result payload received`)
  }

  return finalEvent
}

/* ------------------------ REAL API calls (existing) ------------------------ */

// 1) Test a DB connection

export async function testConnection({ db_url, db_type, database }) {

  const { data } = await api.post('/connections/test', { db_url, db_type, database })

  return data // { ok, connection_id, normalized, latency_ms }

}

// 2) Upload + verify a PDF template (streaming progress or background queue)

export async function verifyTemplate({
  file,
  connectionId,
  refineIters = 0,
  page = 0,
  onProgress,
  onUploadProgress,
  kind = 'pdf',
  background = false,
} = {}) {
  const form = new FormData()
  form.append('file', file)
  const normalizedConnectionId = connectionId ?? ''
  form.append('connection_id', normalizedConnectionId)
  form.append('refine_iters', String(refineIters ?? 0))
  if (typeof page === 'number' && page > 0) {
    form.append('page', String(page))
  }

  const url = background
    ? `${getTemplateRoutes(kind).verify()}?background=true`
    : getTemplateRoutes(kind).verify()

  // Use XMLHttpRequest for upload progress tracking if onUploadProgress is provided
  if (onUploadProgress || background) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100)
          onUploadProgress?.(percent, event.loaded, event.total)
          // Also emit as a stage event for unified progress handling
          onProgress?.({
            event: 'stage',
            stage: 'upload',
            label: `Uploading file... ${percent}%`,
            progress: Math.min(percent * 0.2, 20), // Upload is 0-20% of total
            status: percent >= 100 ? 'complete' : 'started',
          })
        }
      })

      xhr.upload.addEventListener('load', () => {
        onUploadProgress?.(100, file.size, file.size)
        onProgress?.({
          event: 'stage',
          stage: 'upload',
          label: 'Upload complete, processing...',
          progress: 20,
          status: 'complete',
        })
      })

      xhr.addEventListener('load', async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (background) {
            // Background mode returns JSON directly
            try {
              const data = JSON.parse(xhr.responseText)
              resolve(data)
            } catch (e) {
              reject(new Error('Failed to parse response'))
            }
          } else {
            // Streaming mode: process NDJSON from response
            // For XHR we get the full response at once, so parse all lines
            const lines = xhr.responseText.split('\n').filter(Boolean)
            let finalEvent = null

            for (const line of lines) {
              try {
                const payload = JSON.parse(line.trim())
                if (payload.event === 'stage') {
                  // Adjust progress to 20-100% range for processing stages
                  if (typeof payload.progress === 'number') {
                    payload.progress = 20 + (payload.progress * 0.8)
                  }
                  onProgress?.(payload)
                } else if (payload.event === 'result') {
                  finalEvent = payload
                  onProgress?.(payload)
                } else if (payload.event === 'error') {
                  const err = new Error(payload.detail || 'Verification failed')
                  err.detail = payload.detail
                  reject(err)
                  return
                }
              } catch {
                // Skip unparseable lines
              }
            }

            if (!finalEvent) {
              reject(new Error('Verification did not return a result payload'))
              return
            }

            const { template_id, schema, artifacts, schema_ext_url } = finalEvent
            const schemaExtRel = schema_ext_url || artifacts?.schema_ext_url || null
            const schemaExtUrl = schemaExtRel ? withBase(schemaExtRel) : null
            const llm2Rel = artifacts?.llm2_html_url || null
            const llm2Url = llm2Rel ? withBase(llm2Rel) : null

            resolve({
              template_id,
              schema,
              schema_ext_url: schemaExtUrl,
              llm2_html_url: llm2Url,
              artifacts: artifacts
                ? {
                    pdf_url: artifacts.pdf_url ? withBase(artifacts.pdf_url) : null,
                    png_url: artifacts.png_url ? withBase(artifacts.png_url) : null,
                    html_url: artifacts.html_url ? withBase(artifacts.html_url) : null,
                    llm2_html_url: llm2Url,
                    schema_ext_url: schemaExtUrl,
                  }
                : null,
            })
          }
        } else {
          let detail
          try {
            const data = JSON.parse(xhr.responseText)
            detail = data?.detail
          } catch {
            detail = xhr.responseText || null
          }
          reject(new Error(detail || 'Verify template failed'))
        }
      })

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'))
      })

      xhr.addEventListener('abort', () => {
        const err = new Error('Upload cancelled')
        err.cancelled = true
        reject(err)
      })

      xhr.open('POST', toApiUrl(url))

      // Apply intent + idempotency headers (XHR bypasses fetchWithIntent)
      const xhrHeaders = applyIntentAndIdempotency({}, 'post')
      Object.entries(xhrHeaders).forEach(([key, value]) => {
        if (value) xhr.setRequestHeader(key, value)
      })

      xhr.send(form)
    })
  }

  // Original fetch-based implementation for streaming without upload progress
  const res = await fetchWithIntent(url, {
    method: 'POST',
    body: form,
  })

  if (!res.ok || !res.body) {

    let detail

    try {

      const data = await res.json()

      detail = data?.detail

    } catch {

      detail = await res.text().catch(() => null)

    }

    throw new Error(detail || 'Verify template failed')

  }

  const reader = res.body.getReader()

  const decoder = new TextDecoder()
  let buffer = ''
  let finalEvent = null
  let contractStage = null
  let generatorStage = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let newlineIndex

    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {

      const line = buffer.slice(0, newlineIndex).trim()

      buffer = buffer.slice(newlineIndex + 1)

      if (!line) continue

      let payload

      try {

        payload = JSON.parse(line)

      } catch {

        continue

      }

      if (payload.event === 'stage') {

        onProgress?.(payload)

      } else if (payload.event === 'result') {

        finalEvent = payload

        onProgress?.(payload)

      } else if (payload.event === 'error') {

        try {

          await reader.cancel()

        } catch {

          /* ignore */

        }

        const err = new Error(payload.detail || 'Verification failed')

        err.detail = payload.detail

        throw err

      }

    }

  }

  if (buffer.trim()) {
    let payload
    try {
      payload = JSON.parse(buffer.trim())
    } catch {
      // ignore unparseable trailing data
    }
    if (payload) {
      if (payload.event === 'stage') {
        onProgress?.(payload)
      } else if (payload.event === 'result') {
        finalEvent = payload
        onProgress?.(payload)
      } else if (payload.event === 'error') {
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
        const err = new Error(payload.detail || 'Verification failed')
        err.detail = payload.detail
        throw err
      }
    }
  }

  if (!finalEvent) {

    throw new Error('Verification did not return a result payload')

  }

  const { template_id, schema, artifacts, schema_ext_url } = finalEvent

  const schemaExtRel = schema_ext_url || artifacts?.schema_ext_url || null

  const schemaExtUrl = schemaExtRel ? withBase(schemaExtRel) : null

  const llm2Rel = artifacts?.llm2_html_url || null

  const llm2Url = llm2Rel ? withBase(llm2Rel) : null

  return {

    template_id,

    schema,

    schema_ext_url: schemaExtUrl,

    llm2_html_url: llm2Url,

    artifacts: artifacts

      ? {

          pdf_url: artifacts.pdf_url ? withBase(artifacts.pdf_url) : null,

          png_url: artifacts.png_url ? withBase(artifacts.png_url) : null,

          html_url: artifacts.html_url ? withBase(artifacts.html_url) : null,

          llm2_html_url: llm2Url,

          schema_ext_url: schemaExtUrl,

        }

      : null,

  }

}

// 3) Auto-generate headerG��column mapping

export async function mappingPreview(templateId, connectionId, options = {}) {
  const kind = options.kind || 'pdf'
  const params = { connection_id: connectionId ?? '' }
  if (Object.prototype.hasOwnProperty.call(options, 'forceRefresh')) {
    params.force_refresh = options.forceRefresh
  }
  const endpoint = getTemplateRoutes(kind).mappingPreview(templateId)
  const { data } = await api.post(endpoint, {}, { params })
  return data
}

// 4) Approve & save the mapping (streaming progress)

export async function mappingApprove(
  templateId,
  mapping,
  {
    connectionId,
    userValuesText = '',
    userInstructions = '',
    keys,
    onProgress,
    signal,
    kind = 'pdf',
  } = {}
) {

  const payload = { mapping }

  if (connectionId) payload.connection_id = connectionId

  if (typeof userValuesText === 'string') payload.user_values_text = userValuesText

  if (typeof userInstructions === 'string') payload.user_instructions = userInstructions

  if (Array.isArray(keys)) {
    const normalizedKeys = Array.from(new Set(keys.map((token) => (typeof token === 'string' ? token.trim() : '')).filter(Boolean)))
    payload.keys = normalizedKeys
  } else if (keys === null) {
    payload.keys = []
  }

  if (signal?.aborted) {

    throw new DOMException('Aborted', 'AbortError')

  }

  const res = await fetchWithIntent(getTemplateRoutes(kind).approve(templateId), {

    method: 'POST',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify(payload),

    signal,

  })

  if (!res.ok || !res.body) {

    let detail

    try {

      const data = await res.json()

      detail = data?.detail

    } catch {

      detail = await res.text().catch(() => null)

    }

    throw new Error(detail || 'Approve mapping failed')

  }

  const reader = res.body.getReader()

  const decoder = new TextDecoder()

  let buffer = ''
  let finalEvent = null
  let contractStage = null
  let generatorStage = null

  while (true) {

    const { value, done } = await reader.read()

    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let newlineIndex

    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {

      const line = buffer.slice(0, newlineIndex).trim()

      buffer = buffer.slice(newlineIndex + 1)

      if (!line) continue

      let payloadEvent

      try {

        payloadEvent = JSON.parse(line)

      } catch {

        continue

      }

      if (payloadEvent.event === 'stage') {

        if (payloadEvent.stage === 'contract_build_v2') {

          contractStage = payloadEvent

        } else if (payloadEvent.stage === 'generator_assets_v1') {

          generatorStage = payloadEvent

        }

        onProgress?.(payloadEvent)

      } else if (payloadEvent.event === 'result') {

        finalEvent = payloadEvent

        onProgress?.(payloadEvent)

      } else if (payloadEvent.event === 'error') {

        try {

          await reader.cancel()

        } catch {

          /* ignore */

        }

        const err = new Error(payloadEvent.detail || 'Approve mapping failed')

        err.detail = payloadEvent.detail

        throw err

      }

    }

  }

  if (buffer.trim()) {
    let payloadEvent
    try {
      payloadEvent = JSON.parse(buffer.trim())
    } catch {
      // ignore unparseable trailing data
    }
    if (payloadEvent) {
      if (payloadEvent.event === 'stage') {
        if (payloadEvent.stage === 'contract_build_v2') {
          contractStage = payloadEvent
        } else if (payloadEvent.stage === 'generator_assets_v1') {
          generatorStage = payloadEvent
        }
        onProgress?.(payloadEvent)
      } else if (payloadEvent.event === 'result') {
        finalEvent = payloadEvent
        onProgress?.(payloadEvent)
      } else if (payloadEvent.event === 'error') {
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
        const err = new Error(payloadEvent.detail || 'Approve mapping failed')
        err.detail = payloadEvent.detail
        throw err
      }
    }
  }

  if (!finalEvent) {

    throw new Error('Approve mapping did not return a result payload')

  }

  const {

    saved,

    final_html_path,

    final_html_url,

    template_html_url,

    thumbnail_url,

    contract_ready,

    token_map_size,

    user_values_supplied,

    manifest: manifestData,

    manifest_url,

  } = finalEvent

  const contractStagePayload = contractStage || finalEvent.contract_stage || null
  const generatorStagePayload = generatorStage || finalEvent.generator_stage || null

  const responseKeys = Array.isArray(finalEvent?.keys)
    ? Array.from(
        new Set(
          finalEvent.keys
            .map((token) => (typeof token === 'string' ? token.trim() : ''))
            .filter(Boolean),
        ),
      )
    : []
  const keysCount =
    typeof finalEvent?.keys_count === 'number' ? finalEvent.keys_count : responseKeys.length
  const artifactsRaw =
    finalEvent?.artifacts && typeof finalEvent.artifacts === 'object' && !Array.isArray(finalEvent.artifacts)
      ? finalEvent.artifacts
      : {}
  const artifacts = Object.fromEntries(
    Object.entries(artifactsRaw).map(([name, url]) => [
      name,
      typeof url === 'string' && url ? withBase(url) : url,
    ]),
  )

  let manifest = manifestData || null

  if (!manifest) {

    try {

      manifest = await fetchArtifactManifest(templateId, { kind })

    } catch (err) {

      console.warn('manifest fetch failed', err)

    }

  }

  let generatorStageNormalized = generatorStagePayload
  if (generatorStageNormalized?.artifacts) {
    const normalized = Object.fromEntries(
      Object.entries(generatorStageNormalized.artifacts).map(([name, url]) => [name, url ? withBase(url) : url])
    )
    generatorStageNormalized = { ...generatorStageNormalized, artifacts: normalized }
  }

  return {

    ok: true,

    saved,

    final_html_path,

    final_html_url: final_html_url ? withBase(final_html_url) : final_html_url ?? null,

    template_html_url: template_html_url ? withBase(template_html_url) : template_html_url ?? null,

    thumbnail_url: thumbnail_url ? withBase(thumbnail_url) : thumbnail_url ?? null,

    contract_ready: Boolean(contract_ready),

    token_map_size: token_map_size ?? 0,

    user_values_supplied: Boolean(user_values_supplied),

    manifest,

    manifest_url: manifest_url ? withBase(manifest_url) : null,

    contract_stage: contractStagePayload,

    generator_stage: generatorStageNormalized,

    artifacts,

    keys: responseKeys,

    keys_count: keysCount,

  }

}

export async function fetchTemplateKeyOptions(
  templateId,
  { connectionId, tokens, limit, startDate, endDate, kind = 'pdf' } = {},
) {
  if (!templateId) {
    throw new Error('templateId is required to fetch key options')
  }
  const params = new URLSearchParams()
  if (connectionId) params.set('connection_id', connectionId)
  if (Array.isArray(tokens) && tokens.length) params.set('tokens', tokens.join(','))
  else if (typeof tokens === 'string' && tokens.trim()) params.set('tokens', tokens.trim())
  if (typeof limit === 'number' && Number.isFinite(limit)) params.set('limit', String(limit))
  if (startDate) params.set('start_date', startDate)
  if (endDate) params.set('end_date', endDate)

  const query = params.size ? `?${params.toString()}` : ''
  const endpoint = getTemplateRoutes(kind).keys(templateId)
  const res = await fetchWithIntent(`${endpoint}${query}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Key options fetch failed (${res.status})`)
  }
  const data = await res.json().catch(() => ({}))
  const keys = data?.keys && typeof data.keys === 'object' ? data.keys : {}
  return {
    keys: Object.fromEntries(
      Object.entries(keys).map(([token, values]) => [
        token,
        Array.isArray(values)
          ? Array.from(
              new Set(
                values
                  .map((value) => (value == null ? '' : String(value)))
                  .map((value) => value.trim())
                  .filter(Boolean),
              ),
            )
          : [],
      ]),
    ),
  }
}

// 5) Step-5 Generator Assets (SQL + Schemas)

// 5) Convenience for turning verify artifacts into absolute URLs

/* ------------------------ NEW: Generate-page helpers ------------------------ */

const normalizeChartSuggestion = (chart, idx) => {
  if (!chart || typeof chart !== 'object') return null
  const type = typeof chart.type === 'string' ? chart.type.toLowerCase().trim() : ''
  const xField = typeof chart.xField === 'string' ? chart.xField.trim() : ''
  let yFields = chart.yFields
  if (typeof yFields === 'string') {
    yFields = [yFields]
  }
  if (!Array.isArray(yFields)) {
    yFields = []
  }
  const normalizedY = yFields
    .map((value) => (typeof value === 'string' ? value.trim() : String(value)))
    .filter(Boolean)
  if (!type || !xField || !normalizedY.length) return null
  return {
    id: chart.id ? String(chart.id) : `chart_${idx + 1}`,
    type,
    xField,
    yFields: normalizedY,
    groupField:
      typeof chart.groupField === 'string'
        ? chart.groupField
        : chart.groupField != null
          ? String(chart.groupField)
          : null,
    aggregation:
      typeof chart.aggregation === 'string'
        ? chart.aggregation
        : chart.aggregation != null
          ? String(chart.aggregation)
          : null,
    chartTemplateId:
      typeof chart.chartTemplateId === 'string'
        ? chart.chartTemplateId
        : chart.chartTemplateId != null
          ? String(chart.chartTemplateId)
          : null,
    title: typeof chart.title === 'string' ? chart.title : null,
    description: typeof chart.description === 'string' ? chart.description : null,
  }
}

const normalizeSuggestChartsResponse = (data) => {
  const rawCharts = Array.isArray(data?.charts) ? data.charts : []
  const charts = rawCharts.map((chart, idx) => normalizeChartSuggestion(chart, idx)).filter(Boolean)
  const sampleData = Array.isArray(data?.sample_data) ? data.sample_data : null
  return { charts, sampleData }
}

export async function suggestCharts({
  templateId,
  connectionId,
  startDate,
  endDate,
  keyValues,
  question,
  kind = 'pdf',
}) {
  if (!templateId) throw new Error('templateId is required for suggestCharts')
  if (isMock) {
    const mockResponse = await mock.suggestChartsMock({
      templateId,
      connectionId,
      startDate,
      endDate,
      keyValues,
      question,
      kind,
    })
    return normalizeSuggestChartsResponse(mockResponse)
  }
  const payload = {
    start_date: startDate,
    end_date: endDate,
    question: question || '',
    include_sample_data: true,
  }
  if (connectionId) payload.connection_id = connectionId
  const preparedKeyValues = prepareKeyValues(keyValues)
  if (preparedKeyValues) {
    payload.key_values = preparedKeyValues
  }
  const endpoint = getTemplateRoutes(kind).chartSuggest(templateId)
  const { data } = await api.post(endpoint, payload)
  return normalizeSuggestChartsResponse(data)
}

const normalizeSavedChart = (chart, idx = 0) => {
  if (!chart || typeof chart !== 'object') return null
  const templateId = chart.template_id || chart.templateId
  const specPayload = chart.spec || {}
  const normalizedSpec =
    normalizeChartSuggestion(
      {
        ...specPayload,
        id: specPayload.id || `saved_spec_${idx}`,
      },
      idx,
    ) || null
  return {
    id: chart.id,
    templateId,
    name: chart.name,
    spec: normalizedSpec,
    createdAt: chart.created_at || chart.createdAt,
    updatedAt: chart.updated_at || chart.updatedAt,
  }
}

export async function listSavedCharts({ templateId, kind = 'pdf' }) {
  if (!templateId) throw new Error('templateId is required for listSavedCharts')
  if (isMock) {
    const response = await mock.listSavedChartsMock({ templateId })
    const charts = Array.isArray(response?.charts) ? response.charts : []
    return charts.map((chart, idx) => normalizeSavedChart(chart, idx)).filter(Boolean)
  }
  const endpoint = getTemplateRoutes(kind).savedCharts(templateId)
  const { data } = await api.get(endpoint)
  const charts = Array.isArray(data?.charts) ? data.charts : []
  return charts.map((chart, idx) => normalizeSavedChart(chart, idx)).filter(Boolean)
}

export async function createSavedChart({ templateId, name, spec, kind = 'pdf' }) {
  if (!templateId) throw new Error('templateId is required for createSavedChart')
  if (!name) throw new Error('name is required for createSavedChart')
  if (!spec) throw new Error('spec is required for createSavedChart')
  if (isMock) {
    const response = await mock.createSavedChartMock({
      templateId,
      name,
      spec,
    })
    return normalizeSavedChart(response, 0)
  }
  const endpoint = getTemplateRoutes(kind).savedCharts(templateId)
  const { data } = await api.post(endpoint, {
    template_id: templateId,
    name,
    spec,
  })
  return normalizeSavedChart(data, 0)
}

export async function updateSavedChart({ templateId, chartId, name, spec, kind = 'pdf' }) {
  if (!templateId) throw new Error('templateId is required for updateSavedChart')
  if (!chartId) throw new Error('chartId is required for updateSavedChart')
  if (name == null && spec == null) {
    return null
  }
  if (isMock) {
    const response = await mock.updateSavedChartMock({
      templateId,
      chartId,
      name,
      spec,
    })
    return normalizeSavedChart(response, 0)
  }
  const endpoint = `${getTemplateRoutes(kind).savedCharts(templateId)}/${encodeURIComponent(chartId)}`
  const payload = {}
  if (name != null) payload.name = name
  if (spec != null) payload.spec = spec
  const { data } = await api.put(endpoint, payload)
  return normalizeSavedChart(data, 0)
}

export async function deleteSavedChart({ templateId, chartId, kind = 'pdf' }) {
  if (!templateId) throw new Error('templateId is required for deleteSavedChart')
  if (!chartId) throw new Error('chartId is required for deleteSavedChart')
  if (isMock) {
    const response = await mock.deleteSavedChartMock({
      templateId,
      chartId,
    })
    return response
  }
  const endpoint = `${getTemplateRoutes(kind).savedCharts(templateId)}/${encodeURIComponent(chartId)}`
  const { data } = await api.delete(endpoint)
  return data
}

// A) List approved templates (adjust if your API differs)

export async function listTemplates({ status, kind = 'all' } = {}) {
  if (isMock) {
    let templates = mock.listTemplates() || []
    if (status) {
      templates = templates.filter((tpl) => (tpl.status || '').toLowerCase() === String(status).toLowerCase())
    }
    if (kind === 'excel') return templates.filter((tpl) => (tpl.kind || 'pdf') === 'excel')
    if (kind === 'pdf') return templates.filter((tpl) => (tpl.kind || 'pdf') === 'pdf')
    return templates
  }
  const params = { limit: 200 }
  if (status) params.status = status
  const { data } = await api.get('/templates', { params })
  const templates = Array.isArray(data?.templates) ? data.templates : []
  if (kind === 'excel') return templates.filter((tpl) => (tpl.kind || 'pdf') === 'excel')
  if (kind === 'pdf') return templates.filter((tpl) => (tpl.kind || 'pdf') === 'pdf')
  return templates
}

export async function listApprovedTemplates({ kind = 'all' } = {}) {
  if (isMock) {
    const templates = (await mock.listTemplates()) || []
    if (kind === 'excel') return templates.filter((tpl) => (tpl.kind || 'pdf') === 'excel')
    if (kind === 'pdf') return templates.filter((tpl) => (tpl.kind || 'pdf') === 'pdf')
    return templates
  }
  const params = { status: 'approved', limit: 200 }
  const { data } = await api.get('/templates', { params })
  const templates = Array.isArray(data?.templates) ? data.templates : []
  if (kind === 'excel') return templates.filter((tpl) => (tpl.kind || 'pdf') === 'excel')
  if (kind === 'pdf') return templates.filter((tpl) => (tpl.kind || 'pdf') === 'pdf')
  return templates
}

export async function getTemplateCatalog() {
  if (isMock) {
    if (typeof mock.getTemplateCatalog === 'function') {
      return mock.getTemplateCatalog()
    }
    return []
  }
  const { data } = await api.get('/templates/catalog')
  if (Array.isArray(data?.templates)) {
    return data.templates
  }
  if (Array.isArray(data)) {
    return data
  }
  return []
}

export async function recommendTemplates({ requirement, limit = 5, domains, kinds } = {}) {
  const payload = {}
  const trimmedRequirement = typeof requirement === 'string' ? requirement.trim() : ''
  if (trimmedRequirement) {
    payload.requirement = trimmedRequirement
  }
  if (Array.isArray(domains) && domains.length) {
    payload.domains = domains
  }
  if (Array.isArray(kinds) && kinds.length) {
    payload.kinds = kinds
  }
  if (limit != null) {
    payload.limit = limit
  }
  if (isMock) {
    if (typeof mock.recommendTemplates === 'function') {
      return mock.recommendTemplates(payload)
    }
    return []
  }
  const { data } = await api.post('/templates/recommend', payload)
  if (Array.isArray(data?.recommendations)) {
    return data.recommendations
  }
  return data
}

export async function queueRecommendTemplates({ requirement, limit = 5, domains, kinds } = {}) {
  const payload = {}
  const trimmedRequirement = typeof requirement === 'string' ? requirement.trim() : ''
  if (trimmedRequirement) {
    payload.requirement = trimmedRequirement
  }
  if (Array.isArray(domains) && domains.length) {
    payload.domains = domains
  }
  if (Array.isArray(kinds) && kinds.length) {
    payload.kinds = kinds
  }
  if (limit != null) {
    payload.limit = limit
  }
  if (isMock) {
    return { status: 'queued', job_id: `mock-recommend-${Date.now()}` }
  }
  const { data } = await api.post('/templates/recommend?background=true', payload)
  return data
}

export async function deleteTemplate(templateId) {
  if (!templateId) throw new Error('Missing template id')
  if (isMock) {
    return { status: 'ok', template_id: templateId }
  }
  const { data } = await api.delete(`/templates/${encodeURIComponent(templateId)}`)
  return data
}

export async function getSimilarTemplates(templateId, limit = 3) {
  if (!templateId) throw new Error('Missing template id')
  if (isMock) {
    await sleep(300)
    return {
      similar: [
        { id: 'similar-1', name: 'Similar Template 1', kind: 'pdf', similarity_score: 0.85 },
        { id: 'similar-2', name: 'Similar Template 2', kind: 'excel', similarity_score: 0.72 },
      ],
    }
  }
  const { data } = await api.get(`/recommendations/templates/${encodeURIComponent(templateId)}/similar`, {
    params: { limit },
  })
  return data
}

export async function updateTemplateMetadata(templateId, payload = {}) {
  if (!templateId) throw new Error('Missing template id')
  const body = {}
  if (payload.name !== undefined) body.name = payload.name
  if (payload.description !== undefined) body.description = payload.description
  if (payload.tags !== undefined) body.tags = payload.tags
  if (payload.status !== undefined) body.status = payload.status
  if (isMock) {
    if (typeof mock.updateTemplateMetadata === 'function') {
      return mock.updateTemplateMetadata({ templateId, ...body })
    }
    return { status: 'ok', template: { id: templateId, ...body } }
  }
  const { data } = await api.patch(`/templates/${encodeURIComponent(templateId)}`, body)
  return data
}

export async function duplicateTemplate(templateId, newName = null) {
  if (!templateId) throw new Error('Missing template id')
  if (isMock) {
    await sleep(400)
    return {
      template_id: `${templateId}-copy-${Date.now()}`,
      name: newName || 'Template (Copy)',
      kind: 'pdf',
      status: 'approved',
      source_id: templateId,
    }
  }
  const form = new FormData()
  if (newName) {
    form.append('name', newName)
  }
  const { data } = await api.post(`/templates/${encodeURIComponent(templateId)}/duplicate`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

const templateExportZipUrl = (templateId) =>
  `${API_BASE}/templates/${encodeURIComponent(templateId)}/export`

export async function exportTemplateZip(templateId) {
  if (!templateId) throw new Error('Template ID is required')
  if (isMock) {
    await sleep(400)
    return { status: 'ok', mock: true }
  }
  // Trigger download via browser
  const url = templateExportZipUrl(templateId)
  const link = document.createElement('a')
  link.href = url
  link.download = `${templateId}.zip`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return { status: 'ok' }
}

export async function importTemplateZip({ file, name, onUploadProgress } = {}) {
  if (!file) throw new Error('Select a template zip file')
  if (isMock) {
    await sleep(400)
    return {
      status: 'ok',
      template_id: 'mock-template',
      mock: true,
      name: name || file.name,
    }
  }
  const form = new FormData()
  form.append('file', file)
  if (name) {
    form.append('name', name)
  }
  const { data } = await api.post('/templates/import-zip', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onUploadProgress
      ? (progressEvent) => {
          const percentCompleted = progressEvent.total
            ? Math.round((progressEvent.loaded * 100) / progressEvent.total)
            : 0
          onUploadProgress(percentCompleted)
        }
      : undefined,
  })
  return data
}

export async function createTemplateFromGallery({ galleryId, kind = 'pdf', connectionId } = {}) {
  if (!galleryId) throw new Error('galleryId is required')
  const normalizedKind = normalizeKind(kind)

  if (isMock) {
    if (typeof mock.createTemplateFromGalleryMock === 'function') {
      return mock.createTemplateFromGalleryMock({ galleryId, kind: normalizedKind, connectionId })
    }
    await sleep(200)
    return {
      template_id: `mock-gallery-${galleryId}-${Date.now()}`,
      kind: normalizedKind,
      status: 'approved',
    }
  }

  // Optional backend feature. If the server doesn't implement it (404), callers can fall back.
  const { data } = await api.post('/templates/create-from-gallery', {
    gallery_id: galleryId,
    kind: normalizedKind,
    connection_id: connectionId,
  })
  return data
}

export async function listSchedules() {
  if (isMock) {
    if (typeof mock.listSchedules === 'function') {
      return mock.listSchedules()
    }
    await sleep(200)
    return []
  }
  const { data } = await api.get('/reports/schedules')
  return Array.isArray(data?.schedules) ? data.schedules : []
}

export async function createSchedule(payload) {
  const apiPayload = {
    template_id: payload.templateId,
    connection_id: payload.connectionId,
    start_date: payload.startDate,
    end_date: payload.endDate,
    key_values: payload.keyValues,
    batch_ids: payload.batchIds,
    docx: !!payload.docx,
    xlsx: !!payload.xlsx,
    email_recipients: payload.emailRecipients,
    email_subject: payload.emailSubject,
    email_message: payload.emailMessage,
    frequency: payload.frequency || 'daily',
    interval_minutes: payload.intervalMinutes,
    run_time: payload.runTime || null,
    name: payload.name,
    active: payload.active,
  }
  if (isMock) {
    if (typeof mock.createSchedule === 'function') {
      return mock.createSchedule(apiPayload)
    }
    await sleep(200)
    return { schedule: { id: `mock-schedule-${Date.now()}`, ...apiPayload } }
  }
  const { data } = await api.post('/reports/schedules', apiPayload)
  return data?.schedule || data
}

export async function updateSchedule(scheduleId, payload) {
  if (!scheduleId) throw new Error('Missing schedule id')
  const apiPayload = {}
  if (payload.name !== undefined) apiPayload.name = payload.name
  if (payload.startDate !== undefined) apiPayload.start_date = payload.startDate
  if (payload.endDate !== undefined) apiPayload.end_date = payload.endDate
  if (payload.keyValues !== undefined) apiPayload.key_values = payload.keyValues
  if (payload.batchIds !== undefined) apiPayload.batch_ids = payload.batchIds
  if (payload.docx !== undefined) apiPayload.docx = !!payload.docx
  if (payload.xlsx !== undefined) apiPayload.xlsx = !!payload.xlsx
  if (payload.emailRecipients !== undefined) apiPayload.email_recipients = payload.emailRecipients
  if (payload.emailSubject !== undefined) apiPayload.email_subject = payload.emailSubject
  if (payload.emailMessage !== undefined) apiPayload.email_message = payload.emailMessage
  if (payload.frequency !== undefined) apiPayload.frequency = payload.frequency
  if (payload.intervalMinutes !== undefined) apiPayload.interval_minutes = payload.intervalMinutes
  if (payload.runTime !== undefined) apiPayload.run_time = payload.runTime || null
  if (payload.active !== undefined) apiPayload.active = payload.active

  if (isMock) {
    if (typeof mock.updateSchedule === 'function') {
      return mock.updateSchedule(scheduleId, apiPayload)
    }
    await sleep(200)
    return { schedule: { id: scheduleId, ...apiPayload } }
  }
  const { data } = await api.put(`/reports/schedules/${encodeURIComponent(scheduleId)}`, apiPayload)
  return data?.schedule || data
}

export async function deleteSchedule(scheduleId) {
  if (!scheduleId) throw new Error('Missing schedule id')
  if (isMock) {
    if (typeof mock.deleteSchedule === 'function') {
      return mock.deleteSchedule(scheduleId)
    }
    await sleep(200)
    return { status: 'ok', schedule_id: scheduleId }
  }
  const { data } = await api.delete(`/reports/schedules/${encodeURIComponent(scheduleId)}`)
  return data
}

export async function triggerSchedule(scheduleId) {
  if (!scheduleId) throw new Error('Missing schedule id')
  if (isMock) {
    await sleep(300)
    return { status: 'triggered', schedule_id: scheduleId, job_id: `mock-job-${Date.now()}` }
  }
  const { data } = await api.post(`/reports/schedules/${encodeURIComponent(scheduleId)}/trigger`)
  return data
}

export async function getSchedulerStatus() {
  if (isMock) {
    await sleep(100)
    return {
      status: 'ok',
      scheduler: { enabled: true, running: true, poll_interval_seconds: 60 },
      schedules: { total: 2, active: 1, next_run: null },
    }
  }
  const { data } = await api.get('/health/scheduler')
  return data
}

export async function getTemplateHtml(templateId) {
  if (!templateId) throw new Error('templateId is required')
  if (isMock) {
    return mock.getTemplateHtml(templateId)
  }
  const { data } = await api.get(`/templates/${encodeURIComponent(templateId)}/html`)
  return data
}

export async function editTemplateManual(templateId, html) {
  if (!templateId) throw new Error('templateId is required')
  if (typeof html !== 'string') throw new Error('Provide HTML text to save')
  if (isMock) {
    return mock.editTemplateManual(templateId, html)
  }
  const { data } = await api.post(`/templates/${encodeURIComponent(templateId)}/edit-manual`, { html })
  return data
}

export async function editTemplateAi(templateId, instructions, html) {
  if (!templateId) throw new Error('templateId is required')
  const text = typeof instructions === 'string' ? instructions.trim() : ''
  if (!text) throw new Error('Provide AI instructions before applying')
  if (isMock) {
    return mock.editTemplateAi(templateId, text, html)
  }
  const payload = { instructions: text }
  if (typeof html === 'string' && html.length) {
    payload.html = html
  }
  const { data } = await api.post(`/templates/${encodeURIComponent(templateId)}/edit-ai`, payload)
  return data
}

export async function undoTemplateEdit(templateId) {
  if (!templateId) throw new Error('templateId is required')
  if (isMock) {
    return mock.undoTemplateEdit(templateId)
  }
  const { data } = await api.post(`/templates/${encodeURIComponent(templateId)}/undo-last-edit`)
  return data
}

/**
 * Send a chat message for conversational template editing.
 * The AI will ask clarifying questions if needed before proposing changes.
 *
 * @param {string} templateId - The template ID
 * @param {Array<{role: string, content: string}>} messages - Conversation history
 * @param {string} [html] - Optional current HTML state
 * @returns {Promise<Object>} Chat response with message, ready_to_apply, proposed_changes, etc.
 */
// ---------------------------------------------------------------------------
// In-product Assistant
// ---------------------------------------------------------------------------

export async function assistantChat(messages, context = {}, mode = 'auto') {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required')
  }
  const res = await api.post('/assistant/chat', { messages, context, mode })
  return res.data
}

// ---------------------------------------------------------------------------
// Template Chat
// ---------------------------------------------------------------------------

/** @deprecated Use pipelineChat() instead */
export async function chatTemplateEdit(templateId, messages, html = null) {
  if (!templateId) throw new Error('templateId is required')
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required')
  }
  if (isMock) {
    // Mock implementation
    await sleep(800)
    const lastMessage = messages[messages.length - 1]?.content || ''
    const isSimpleRequest = lastMessage.length > 50 || lastMessage.includes('change') || lastMessage.includes('update')
    return {
      status: 'ok',
      template_id: templateId,
      message: isSimpleRequest
        ? "I understand you want to make changes. Let me propose the following modifications..."
        : "Could you please provide more details about what changes you'd like to make to the template?",
      ready_to_apply: false,
      proposed_changes: null,
      follow_up_questions: isSimpleRequest ? null : [
        "What specific elements would you like to modify?",
        "What style changes do you have in mind?",
      ],
    }
  }
  const payload = { messages }
  if (html) {
    payload.html = html
  }
  const { data } = await api.post(`/templates/${encodeURIComponent(templateId)}/chat`, payload)
  return data
}

/** @deprecated Use pipelineChat() instead */
export async function applyChatTemplateEdit(templateId, html) {
  if (!templateId) throw new Error('templateId is required')
  if (typeof html !== 'string') throw new Error('html is required')
  if (isMock) {
    await sleep(400)
    return {
      status: 'ok',
      template_id: templateId,
      html,
      metadata: {
        lastEditType: 'chat',
        lastEditAt: new Date().toISOString(),
        lastEditNotes: 'AI chat-assisted HTML edit via template editor',
      },
      history: [],
      diff_summary: 'Changes applied via chat',
    }
  }
  const { data } = await api.post(`/templates/${encodeURIComponent(templateId)}/chat/apply`, { html })
  return data
}

/** @deprecated Use pipelineChat() instead */
export async function chatTemplateCreate(messages, html = null, samplePdf = null, kind = 'pdf') {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array is required')
  }
  if (isMock) {
    await sleep(800)
    return {
      status: 'ok',
      message: samplePdf
        ? "I can see your sample PDF. I'll use its layout and styling as a reference. What would you like to keep or change from this design?"
        : "What kind of report template would you like to create? For example: invoice, sales summary, or inventory report.",
      ready_to_apply: false,
      proposed_changes: null,
      follow_up_questions: [
        "What type of report is this?",
        "What sections or columns do you need?",
      ],
    }
  }
  if (samplePdf) {
    const fd = new FormData()
    fd.append('messages_json', JSON.stringify(messages))
    if (html) fd.append('html', html)
    fd.append('sample_pdf', samplePdf)
    fd.append('kind', kind)
    const { data } = await api.post('/templates/chat-create', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  }
  const payload = { messages, kind }
  if (html) {
    payload.html = html
  }
  const { data } = await api.post('/templates/chat-create', payload)
  return data
}

export async function createTemplateFromChat(name, html, kind = 'pdf') {
  if (!name) throw new Error('name is required')
  if (typeof html !== 'string') throw new Error('html is required')
  if (isMock) {
    await sleep(400)
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    return {
      status: 'ok',
      template_id: slug || 'chat-template',
      name,
      kind,
    }
  }
  const { data } = await api.post('/templates/create-from-chat', { name, html, kind })
  return data
}

export async function runTemplateAgent(templateId, agentType, params = {}, sync = true) {
  if (!templateId) throw new Error('templateId is required')
  if (!agentType) throw new Error('agentType is required')
  const { data } = await api.post(`/templates/${encodeURIComponent(templateId)}/run-agent`, {
    agent_type: agentType,
    params,
    sync,
  })
  return data
}

// B) Run a report for a date range (returns artifact URLs)

export async function runReportAsJob({
  templateId,
  templateName,
  connectionId,
  startDate,
  endDate,
  batchIds = null,
  keyValues,
  brandKitId,
  docx = false,
  xlsx = false,
  kind = 'pdf',
  emailRecipients,
  emailSubject,
  emailMessage,
  scheduleId,
}) {
  const payload = {
    template_id: templateId,
    template_name: templateName,
    connection_id: connectionId,
    start_date: startDate,
    end_date: endDate,
  }
  if (Array.isArray(batchIds) && batchIds.length) {
    payload.batch_ids = batchIds
  }
  const preparedKeyValues = prepareKeyValues(keyValues)
  if (preparedKeyValues) {
    payload.key_values = preparedKeyValues
  }
  if (brandKitId) payload.brand_kit_id = brandKitId
  if (docx) payload.docx = true
  if (xlsx) payload.xlsx = true
  if (Array.isArray(emailRecipients) && emailRecipients.length) {
    payload.email_recipients = emailRecipients
  }
  if (emailSubject) payload.email_subject = emailSubject
  if (emailMessage) payload.email_message = emailMessage
  if (scheduleId) payload.schedule_id = scheduleId
  if (isMock) {
    return mock.runReportAsJobMock(payload)
  }
  const { data } = await api.post(getTemplateRoutes(kind).runJob(), payload)
  return data
}

// C) Normalize a run responseG��s artifact URLs to absolute

export async function listReportRuns({ templateId, connectionId, scheduleId, limit = 20 } = {}) {
  if (isMock) {
    if (typeof mock.listReportRuns === 'function') {
      return mock.listReportRuns({ templateId, connectionId, scheduleId, limit })
    }
    return []
  }
  const params = new URLSearchParams()
  if (templateId) params.set('template_id', templateId)
  if (connectionId) params.set('connection_id', connectionId)
  if (scheduleId) params.set('schedule_id', scheduleId)
  if (limit) params.set('limit', String(limit))
  const endpoint = `/reports/runs${params.toString() ? `?${params.toString()}` : ''}`
  const { data } = await api.get(endpoint)
  return Array.isArray(data?.runs) ? data.runs : []
}

export async function getReportRun(runId) {
  if (!runId) throw new Error('Missing run id')
  if (isMock) {
    if (typeof mock.getReportRun === 'function') {
      return mock.getReportRun(runId)
    }
    return null
  }
  const { data } = await api.get(`/reports/runs/${encodeURIComponent(runId)}`)
  return data?.run || data
}

export async function generateDocxJob(runId) {
  if (!runId) throw new Error('Missing run id')
  const { data } = await api.post(`/reports/jobs/generate-docx/${encodeURIComponent(runId)}`)
  return data
}

// D) Discovery helper - delegates to discoverReports with simplified interface

export async function discoverReports({
  templateId,
  connectionId,
  startDate,
  endDate,
  keyValues,
  kind = 'pdf',
}) {
  const payload = {
    template_id: templateId,
    start_date: startDate,
    end_date: endDate,
  }
  if (connectionId) payload.connection_id = connectionId
  const preparedKeyValues = prepareKeyValues(keyValues)
  if (preparedKeyValues) {
    payload.key_values = preparedKeyValues
  }
  const { data } = await api.post(getTemplateRoutes(kind).discover(), payload)
  return data
}

/* ------------------------ Persistent state helpers ------------------------ */

export async function bootstrapState() {

  if (isMock) {

    return {

      status: 'ok',

      connections: [],

      templates: [],

      last_used: {},

    }

  }

  const { data } = await api.get('/state/bootstrap')

  return data

}

export async function listConnections() {

  if (isMock) {

    return { status: 'ok', connections: [] }

  }

  const { data } = await api.get('/connections')

  return data

}

export async function upsertConnection({ id, name, dbType, dbUrl, database, status, latencyMs, tags }) {

  if (isMock) {

    const record = {

      id: id || `conn_${Date.now()}`,

      name,

      db_type: dbType,

      status: status || 'connected',

      summary: database || dbUrl,

      lastConnected: new Date().toISOString(),

      lastLatencyMs: latencyMs ?? null,

      tags: tags || [],

      hasCredentials: true,

    }

    return record

  }

  const payload = {

    id,

    name,

    db_type: dbType,

    db_url: dbUrl,

    database,

    status,

    latency_ms: latencyMs,

    tags,

  }

  const { data } = await api.post('/connections', payload)

  return data?.connection

}

export async function deleteConnection(connectionId) {

  if (isMock) return { status: 'ok', connection_id: connectionId }

  const { data } = await api.delete(`/connections/${encodeURIComponent(connectionId)}`)

  return data

}

export async function healthcheckConnection(connectionId) {

  if (isMock) {

    return { status: 'ok', latency_ms: Math.floor(Math.random() * 120), connection_id: connectionId }

  }

  const { data } = await api.post(`/connections/${encodeURIComponent(connectionId)}/health`)

  return data

}

export async function getConnectionSchema(
  connectionId,
  { includeRowCounts = true, includeForeignKeys = true, sampleRows = 0 } = {},
) {
  if (!connectionId) throw new Error('Missing connection id')
  if (isMock) {
    if (typeof mock.getConnectionSchema === 'function') {
      return mock.getConnectionSchema({
        connectionId,
        includeRowCounts,
        includeForeignKeys,
        sampleRows,
      })
    }
    return { connection_id: connectionId, tables: [] }
  }
  const params = new URLSearchParams()
  if (includeRowCounts) params.set('include_row_counts', 'true')
  if (!includeForeignKeys) params.set('include_foreign_keys', 'false')
  if (sampleRows) params.set('sample_rows', String(sampleRows))
  const query = params.toString()
  const endpoint = `/connections/${encodeURIComponent(connectionId)}/schema${query ? `?${query}` : ''}`
  const { data } = await api.get(endpoint)
  return data
}

export async function getConnectionTablePreview(
  connectionId,
  { table, limit = 10, offset = 0 } = {},
) {
  if (!connectionId) throw new Error('Missing connection id')
  if (!table) throw new Error('Table name is required')
  if (isMock) {
    if (typeof mock.getConnectionTablePreview === 'function') {
      return mock.getConnectionTablePreview({ connectionId, table, limit, offset })
    }
    return { connection_id: connectionId, table, columns: [], rows: [] }
  }
  const params = new URLSearchParams()
  params.set('table', table)
  if (limit) params.set('limit', String(limit))
  if (offset) params.set('offset', String(offset))
  const endpoint = `/connections/${encodeURIComponent(connectionId)}/preview?${params.toString()}`
  const { data } = await api.get(endpoint)
  return data
}

export async function getSystemHealth() {
  if (isMock) {
    return {
      status: 'healthy',
      version: '4.0',
      timestamp: new Date().toISOString(),
      response_time_ms: 15,
      checks: {
        uploads_dir: { status: 'healthy', writable: true },
        state_dir: { status: 'healthy', writable: true },
        llm: { status: 'configured', message: 'Claude Code CLI available', model: 'sonnet' },
        configuration: {
          api_key_configured: true,
          rate_limiting_enabled: true,
          rate_limit: '100/60s',
          request_timeout: 300,
          max_upload_size_mb: 50,
          debug_mode: false,
        },
      },
    }
  }
  const { data } = await api.get('/health/detailed')
  return data
}

export async function getTokenUsage() {
  if (isMock) {
    return {
      status: 'ok',
      usage: {
        total_input_tokens: 125000,
        total_output_tokens: 45000,
        total_tokens: 170000,
        estimated_cost_usd: 2.85,
        request_count: 156,
      },
    }
  }
  const { data } = await api.get('/health/token-usage')
  return data
}

export async function listJobs({ statuses, types, limit = 25, activeOnly = false } = {}) {
  if (isMock) {
    const mockResponse = await mock.listJobsMock({ statuses, types, limit, activeOnly })
    return { jobs: Array.isArray(mockResponse?.jobs) ? mockResponse.jobs : [] }
  }
  const params = new URLSearchParams()
  if (Array.isArray(statuses)) {
    statuses.filter(Boolean).forEach((status) => params.append('status', status))
  }
  if (Array.isArray(types)) {
    types.filter(Boolean).forEach((type) => params.append('type', type))
  }
  if (limit) {
    params.set('limit', String(limit))
  }
  if (activeOnly) {
    params.set('active_only', 'true')
  }
  const query = params.toString()
  const endpoint = `/jobs${query ? `?${query}` : ''}`
  const { data } = await api.get(endpoint)
  return { jobs: Array.isArray(data?.jobs) ? data.jobs : [] }
}

export async function getJob(jobId) {
  if (!jobId) throw new Error('Missing job id')
  if (isMock) {
    return mock.getJobMock(jobId)
  }
  const { data } = await api.get(`/jobs/${encodeURIComponent(jobId)}`)
  return data?.job
}

export async function cancelJob(jobId, options = {}) {
  if (!jobId) throw new Error('Missing job id')
  const force = Boolean(options?.force)
  if (isMock) {
    return { status: 'cancelled', job_id: jobId, force }
  }
  const endpoint = `/jobs/${encodeURIComponent(jobId)}/cancel${force ? '?force=true' : ''}`
  const { data } = await api.post(endpoint)
  return data?.job || data
}

export async function retryJob(jobId) {
  if (!jobId) throw new Error('Missing job id')
  if (isMock) {
    await sleep(400)
    return {
      status: 'ok',
      message: 'Job retry queued successfully',
      original_job_id: jobId,
      new_job: { id: `job-retry-${Date.now()}`, status: 'pending' },
    }
  }
  const { data } = await api.post(`/jobs/${encodeURIComponent(jobId)}/retry`)
  return data
}

/* ------------------------ Document Analysis API ------------------------ */

/**
 * Upload and analyze a document (PDF or Excel) using AI.
 * Returns extracted tables, data points, and chart suggestions.
 *
 * @param {Object} options - Analysis options
 * @param {File} options.file - The file to analyze
 * @param {string} [options.connectionId] - Optional database connection for context
 * @param {string} [options.analysisType] - Type of analysis: 'comprehensive', 'tables', 'summary'
 * @param {Function} [options.onProgress] - Progress callback for streaming events
 * @param {AbortSignal} [options.signal] - AbortController signal for cancellation
 * @returns {Promise<Object>} Analysis result with tables, dataPoints, charts, summary
 */
export async function getAnalysis(analysisId) {
  if (!analysisId) throw new Error('analysisId is required')
  const { data } = await api.get(`/analyze/${encodeURIComponent(analysisId)}`)
  return data
}

export async function getAnalysisData(analysisId, { format = 'json', tableId } = {}) {
  if (!analysisId) throw new Error('analysisId is required')
  const params = new URLSearchParams()
  params.set('format', format)
  if (tableId) params.set('table_id', tableId)
  const { data } = await api.get(`/analyze/${encodeURIComponent(analysisId)}/data?${params}`)
  return data
}

export async function extractDocument({ file } = {}) {
  if (!file) throw new Error('File is required for extraction')
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/analyze/extract', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

/* ------------------------ Analytics API ------------------------ */

export async function getDashboardAnalytics() {
  if (isMock) {
    await sleep(300)
    return {
      summary: {
        totalConnections: 3,
        activeConnections: 2,
        totalTemplates: 8,
        approvedTemplates: 6,
        pdfTemplates: 5,
        excelTemplates: 3,
        totalJobs: 45,
        activeJobs: 2,
        completedJobs: 38,
        failedJobs: 5,
        totalSchedules: 4,
        activeSchedules: 3,
      },
      metrics: {
        successRate: 88.4,
        avgConnectionLatency: 45.2,
        jobsToday: 5,
        jobsThisWeek: 23,
        jobsThisMonth: 45,
      },
      topTemplates: [
        { id: 'tpl-1', name: 'Sales Report', kind: 'pdf', runCount: 15 },
        { id: 'tpl-2', name: 'Inventory', kind: 'excel', runCount: 12 },
      ],
      jobsTrend: [
        { date: '2024-01-14', label: 'Sun', total: 3, completed: 3, failed: 0 },
        { date: '2024-01-15', label: 'Mon', total: 8, completed: 7, failed: 1 },
        { date: '2024-01-16', label: 'Tue', total: 5, completed: 5, failed: 0 },
        { date: '2024-01-17', label: 'Wed', total: 6, completed: 5, failed: 1 },
        { date: '2024-01-18', label: 'Thu', total: 4, completed: 4, failed: 0 },
        { date: '2024-01-19', label: 'Fri', total: 7, completed: 6, failed: 1 },
        { date: '2024-01-20', label: 'Sat', total: 2, completed: 2, failed: 0 },
      ],
      recentActivity: [],
      timestamp: new Date().toISOString(),
    }
  }
  const { data } = await api.get('/analytics/dashboard')
  return data
}

export async function getUsageStatistics(period = 'week') {
  if (isMock) {
    await sleep(200)
    return {
      period,
      totalJobs: 23,
      byStatus: { completed: 20, failed: 2, cancelled: 1 },
      byKind: { pdf: 15, excel: 8 },
      templateBreakdown: [],
    }
  }
  const { data } = await api.get(`/analytics/usage?period=${period}`)
  return data
}

export async function getReportHistory({ limit = 50, offset = 0, status, templateId } = {}) {
  if (isMock) {
    await sleep(200)
    return { history: [], total: 0, limit, offset, hasMore: false }
  }
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (status) params.set('status', status)
  if (templateId) params.set('template_id', templateId)
  const { data } = await api.get(`/analytics/reports/history?${params}`)
  return data
}

/* ------------------------ Activity Log API ------------------------ */

export async function getActivityLog({ limit = 50, offset = 0, entityType, action } = {}) {
  if (isMock) {
    await sleep(200)
    return { activities: [], limit, offset }
  }
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (entityType) params.set('entity_type', entityType)
  if (action) params.set('action', action)
  const { data } = await api.get(`/analytics/activity?${params}`)
  return data
}

export async function clearActivityLog() {
  if (isMock) {
    await sleep(100)
    return { cleared: 0 }
  }
  const { data } = await api.delete('/analytics/activity')
  return data
}

/* ------------------------ Favorites API ------------------------ */

export async function getFavorites() {
  if (isMock) {
    await sleep(200)
    return { templates: [], connections: [] }
  }
  const { data } = await api.get('/analytics/favorites')
  return data
}

export async function addFavorite(entityType, entityId) {
  if (isMock) {
    await sleep(100)
    return { added: true, entityType, entityId }
  }
  const { data } = await api.post(`/analytics/favorites/${entityType}/${encodeURIComponent(entityId)}`)
  return data
}

export async function removeFavorite(entityType, entityId) {
  if (isMock) {
    await sleep(100)
    return { removed: true, entityType, entityId }
  }
  const { data } = await api.delete(`/analytics/favorites/${entityType}/${encodeURIComponent(entityId)}`)
  return data
}

export async function checkFavorite(entityType, entityId) {
  if (isMock) {
    await sleep(50)
    return { isFavorite: false, entityType, entityId }
  }
  const { data } = await api.get(`/analytics/favorites/${entityType}/${encodeURIComponent(entityId)}`)
  return data
}

/* ------------------------ User Preferences API ------------------------ */

export async function getUserPreferences() {
  if (isMock) {
    await sleep(100)
    return { preferences: {} }
  }
  const { data } = await api.get('/analytics/preferences')
  return data
}

export async function setUserPreference(key, value) {
  if (isMock) {
    await sleep(100)
    return { preferences: { [key]: value } }
  }
  const { data } = await api.put(`/analytics/preferences/${encodeURIComponent(key)}`, { value })
  return data
}

/* ------------------------ SMTP Settings API ------------------------ */

export async function getSmtpSettings() {
  if (isMock) {
    await sleep(100)
    return { smtp: {} }
  }
  const { data } = await api.get('/settings/smtp')
  return data
}

export async function saveSmtpSettings(settings) {
  if (isMock) {
    await sleep(200)
    return { smtp: settings, message: 'SMTP settings saved' }
  }
  const { data } = await api.put('/settings/smtp', settings)
  return data
}

export async function testSmtpConnection() {
  if (isMock) {
    await sleep(500)
    return { status: 'connected', message: 'SMTP connection successful' }
  }
  const { data } = await api.post('/settings/smtp/test')
  return data
}

/* ------------------------ Export/Backup API ------------------------ */

export async function exportConfiguration() {
  if (isMock) {
    await sleep(200)
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      data: {
        connections: [],
        templates: [],
        schedules: [],
        favorites: { templates: [], connections: [] },
        preferences: {},
      },
    }
  }
  const { data } = await api.get('/analytics/export/config')
  return data
}

/* ------------------------ Global Search API ------------------------ */

export async function globalSearch(query, { types, limit = 20 } = {}) {
  if (!query || query.trim().length < 1) {
    return { query: '', results: [], total: 0 }
  }
  if (isMock) {
    await sleep(150)
    return { query, results: [], total: 0 }
  }
  const params = new URLSearchParams()
  params.set('q', query)
  if (types) params.set('types', types)
  if (limit) params.set('limit', String(limit))
  const { data } = await api.get(`/analytics/search?${params}`)
  return data
}

// ==================== Notifications API ====================

/**
 * Get notifications.
 * @param {Object} options - Options
 * @returns {Promise<Object>} Notifications data
 */
// ==================== Template Tags API ====================

export async function getAllTemplateTags() {
  if (isMock) {
    await sleep(100)
    return { tags: [], tagCounts: {}, total: 0 }
  }
  const { data } = await api.get('/templates/tags/all')
  return data
}

// ==================== Bulk Operations API ====================

export async function bulkDeleteTemplates(templateIds) {
  if (isMock) {
    await sleep(200)
    return { deleted: templateIds, deletedCount: templateIds.length, failed: [], failedCount: 0 }
  }
  const { data } = await api.post('/analytics/bulk/templates/delete', { templateIds })
  return data
}

export async function bulkUpdateTemplateStatus(templateIds, status) {
  if (isMock) {
    await sleep(200)
    return { updated: templateIds, updatedCount: templateIds.length, failed: [], failedCount: 0 }
  }
  const { data } = await api.post('/analytics/bulk/templates/update-status', { templateIds, status })
  return data
}

export async function bulkAddTemplateTags(templateIds, tags) {
  if (isMock) {
    await sleep(200)
    return { updated: templateIds, updatedCount: templateIds.length, failed: [], failedCount: 0 }
  }
  const { data } = await api.post('/analytics/bulk/templates/add-tags', { templateIds, tags })
  return data
}

export async function bulkCancelJobs(jobIds) {
  if (isMock) {
    await sleep(200)
    return { cancelled: jobIds, cancelledCount: jobIds.length, failed: [], failedCount: 0 }
  }
  const { data } = await api.post('/analytics/bulk/jobs/cancel', { jobIds })
  return data
}

export async function bulkDeleteJobs(jobIds) {
  if (isMock) {
    await sleep(200)
    return { deleted: jobIds, deletedCount: jobIds.length, failed: [], failedCount: 0 }
  }
  const { data } = await api.post('/analytics/bulk/jobs/delete', { jobIds })
  return data
}

// ==================== Logger Integration API ====================

export async function discoverLoggerDatabases() {
  if (isMock) {
    await sleep(300)
    return { databases: [] }
  }
  const { data } = await api.get('/logger/discover')
  return data
}

/**
 * Get devices from a Logger database.
 * @param {string} connectionId - Connection ID of the Logger database
 * @returns {Promise<Object>} Devices list
 */
export async function getLoggerDevices(connectionId) {
  const { data } = await api.get(`/logger/${encodeURIComponent(connectionId)}/devices`)
  return data
}

/**
 * Get device schemas from a Logger database.
 * @param {string} connectionId - Connection ID
 * @returns {Promise<Object>} Schemas with fields
 */
export async function getLoggerSchemas(connectionId) {
  const { data } = await api.get(`/logger/${encodeURIComponent(connectionId)}/schemas`)
  return data
}

/**
 * Get logging jobs from a Logger database.
 * @param {string} connectionId - Connection ID
 * @returns {Promise<Object>} Jobs list
 */
export async function getLoggerJobs(connectionId) {
  const { data } = await api.get(`/logger/${encodeURIComponent(connectionId)}/jobs`)
  return data
}

/**
 * Get execution history for a Logger job.
 * @param {string} connectionId - Connection ID
 * @param {string} jobId - Job ID
 * @param {number} [limit=50] - Max runs to return
 * @returns {Promise<Object>} Job runs list
 */
export async function getLoggerJobRuns(connectionId, jobId, limit = 50) {
  const { data } = await api.get(`/logger/${encodeURIComponent(connectionId)}/jobs/${encodeURIComponent(jobId)}/runs?limit=${limit}`)
  return data
}

/**
 * Get storage targets from a Logger database.
 * @param {string} connectionId - Connection ID
 * @returns {Promise<Object>} Storage targets list
 */
export async function getLoggerStorageTargets(connectionId) {
  const { data } = await api.get(`/logger/${encodeURIComponent(connectionId)}/storage-targets`)
  return data
}

/**
 * Get device tables from a Logger database.
 * @param {string} connectionId - Connection ID
 * @returns {Promise<Object>} Device tables list
 */
export async function getLoggerDeviceTables(connectionId) {
  const { data } = await api.get(`/logger/${encodeURIComponent(connectionId)}/device-tables`)
  return data
}

// =============================================================================
// Unified Pipeline Chat API
// =============================================================================

/**
 * Send a chat message to the unified pipeline endpoint.
 * Returns a raw Response with NDJSON body for streaming.
 */
export async function pipelineChat(sessionId, payload) {
  const url = `${API_V1_BASE}/pipeline/chat`
  const body = { ...payload }
  if (sessionId) body.session_id = sessionId
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Pipeline chat failed (${res.status}): ${text}`)
  }
  return res
}

/**
 * Upload a file through the unified pipeline endpoint.
 * Falls back to legacy /templates/verify.
 */
export async function pipelineChatUpload(sessionId, payload, file) {
  const url = `${API_V1_BASE}/pipeline/chat/upload`
  const fd = new FormData()
  fd.append('file', file)
  fd.append('payload_json', JSON.stringify({ ...payload, session_id: sessionId }))
  const res = await fetch(url, { method: 'POST', body: fd })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Pipeline upload failed (${res.status}): ${text}`)
  }
  return res
}

/**
 * Send chat message with reference file attachments (images, docs).
 * These are NOT template uploads — they provide context for the LLM.
 */
export async function pipelineChatWithAttachments(sessionId, payload, files) {
  const url = `${API_V1_BASE}/pipeline/chat/upload`
  const fd = new FormData()
  files.forEach((f, i) => fd.append('attachments', f))
  fd.append('payload_json', JSON.stringify({ ...payload, session_id: sessionId }))
  const res = await fetch(url, { method: 'POST', body: fd })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Pipeline chat with attachments failed (${res.status}): ${text}`)
  }
  return res
}

/**
 * Fetch pipeline session state for resume.
 */

// ==================== Notifications API ====================

/**
 * Get notifications.
 * @param {Object} options - Options
 * @returns {Promise<Object>} Notifications data
 */
export async function getNotifications({ limit = 50, unreadOnly = false } = {}) {
  if (isMock) {
    await sleep(100)
    return { notifications: [], unreadCount: 0, total: 0 }
  }
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (unreadOnly) params.set('unread_only', 'true')
  const { data } = await api.get(`/analytics/notifications?${params}`)
  return data
}

/**
 * Get unread notification count.
 * @returns {Promise<Object>} Unread count
 */
export async function getUnreadNotificationCount() {
  if (isMock) {
    return { unreadCount: 0 }
  }
  const { data } = await api.get('/analytics/notifications/unread-count')
  return data
}

/**
 * Create a notification.
 * @param {Object} notification - Notification data
 * @returns {Promise<Object>} Created notification
 */
export async function createNotification({ title, message, type = 'info', link, entityType, entityId }) {
  if (isMock) {
    await sleep(100)
    return { notification: { id: Date.now(), title, message, type, read: false } }
  }
  const { data } = await api.post('/analytics/notifications', {
    title,
    message,
    type,
    link,
    entityType,
    entityId,
  })
  return data
}

/**
 * Mark a notification as read.
 * @param {string} notificationId - Notification ID
 * @returns {Promise<Object>} Result
 */
export async function markNotificationRead(notificationId) {
  if (isMock) {
    await sleep(50)
    return { marked: true }
  }
  const { data } = await api.put(`/analytics/notifications/${notificationId}/read`)
  return data
}

/**
 * Mark all notifications as read.
 * @returns {Promise<Object>} Result with count
 */
export async function markAllNotificationsRead() {
  if (isMock) {
    await sleep(50)
    return { markedCount: 0 }
  }
  const { data } = await api.put('/analytics/notifications/read-all')
  return data
}

/**
 * Delete a notification.
 * @param {string} notificationId - Notification ID
 * @returns {Promise<Object>} Result
 */
export async function deleteNotification(notificationId) {
  if (isMock) {
    await sleep(50)
    return { deleted: true }
  }
  const { data } = await api.delete(`/analytics/notifications/${notificationId}`)
  return data
}

/**
 * Clear all notifications.
 * @returns {Promise<Object>} Result with count
 */
export async function clearAllNotifications() {
  if (isMock) {
    await sleep(50)
    return { clearedCount: 0 }
  }
  const { data } = await api.delete('/analytics/notifications')
  return data
}

// ==================== Template Tags API ====================

/**
 * Update tags for a template.
 * @param {string} templateId - Template ID
 * @param {string[]} tags - Array of tags
 * @returns {Promise<Object>} Updated tags
 */
export async function updateTemplateTags(templateId, tags) {
  if (isMock) {
    await sleep(100)
    return { template_id: templateId, tags }
  }
  const { data } = await api.put(`/templates/${encodeURIComponent(templateId)}/tags`, { tags })
  return data
}

// ==================== Activity Log (write) ====================

/**
 * Log an activity event.
 * @param {Object} activity - Activity data
 * @returns {Promise<Object>} Created activity entry
 */
export async function logActivity({ action, entityType, entityId, entityName, details } = {}) {
  if (isMock) {
    await sleep(100)
    return { activity: { id: `act-${Date.now()}`, action, entityType, entityId, timestamp: new Date().toISOString() } }
  }
  const params = new URLSearchParams()
  params.set('action', action)
  params.set('entity_type', entityType)
  if (entityId) params.set('entity_id', entityId)
  if (entityName) params.set('entity_name', entityName)
  const { data } = await api.post(`/analytics/activity?${params}`, details || {})
  return data
}

// ==================== User Preferences (batch update) ====================

/**
 * Update user preferences.
 * @param {Object} updates - Preference updates
 * @returns {Promise<Object>} Updated preferences
 */
export async function updateUserPreferences(updates) {
  if (isMock) {
    await sleep(100)
    return { preferences: updates }
  }
  const { data } = await api.put('/analytics/preferences', updates)
  return data
}

// ==================== Export/Backup (download) ====================

/**
 * Download configuration as a JSON file.
 */
export async function downloadConfiguration() {
  const config = await exportConfiguration()
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `neurareport-config-${Date.now()}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  return config
}

export default api
