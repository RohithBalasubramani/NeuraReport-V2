import api, { API_BASE } from './client'
const getHealthUrl = () => `${API_BASE.replace(/[\\/]+$/, '')}/health`

export async function checkHealth({ timeoutMs = 5000, signal } = {}) {
  const controller = signal ? null : new AbortController()
  const effectiveSignal = signal || controller?.signal
  let timeoutId

  if (!signal && controller) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  }

  try {
    const response = await fetch(getHealthUrl(), {
      method: 'HEAD',
      signal: effectiveSignal,
      cache: 'no-store',
    })
    return response.ok
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function getTokenUsage() {
  const response = await api.get('/health/token-usage')
  return response.data
}

export async function getSchedulerStatus() {
  const response = await api.get('/health/scheduler')
  return response.data
}

export async function getSystemHealth() {
  const [detailed, tokenUsage, scheduler, email] = await Promise.allSettled([
    getDetailedHealth(),
    getTokenUsage(),
    getSchedulerStatus(),
    getEmailStatus(),
  ])

  return {
    detailed: detailed.status === 'fulfilled' ? detailed.value : null,
    tokenUsage: tokenUsage.status === 'fulfilled' ? tokenUsage.value : null,
    scheduler: scheduler.status === 'fulfilled' ? scheduler.value : null,
    email: email.status === 'fulfilled' ? email.value : null,
  }
}


const buildIntentHeaders = (intent, idempotencyKey) => ({
  'Content-Type': 'application/json',
  'Idempotency-Key': idempotencyKey,
  'X-Idempotency-Key': idempotencyKey,
  'X-Intent-Id': intent.id,
  'X-Intent-Type': intent.type,
  'X-Intent-Label': encodeURIComponent(intent.label || ''),
  'X-Correlation-Id': intent.correlationId,
  'X-Session-Id': intent.sessionId,
})

const generateIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  const rand = Math.random().toString(36).slice(2)
  return `idem-${Date.now().toString(36)}-${rand}`
}

// Track if audit endpoint is available (avoid repeated 404 calls)
let auditEndpointAvailable = true

export async function recordIntent(intent) {
  if (!auditEndpointAvailable) {
    return false // Silently skip if endpoint not available
  }

  try {
    const idempotencyKey = generateIdempotencyKey()
    const response = await fetch(`${API_BASE}/audit/intent`, {
      method: 'POST',
      headers: buildIntentHeaders(intent, idempotencyKey),
      body: JSON.stringify(intent),
    })

    if (response.status === 404) {
      // Endpoint not implemented - disable further attempts
      auditEndpointAvailable = false
      return false
    }

    return response.ok
  } catch (error) {
    // Network error - don't disable, might be temporary
    console.debug('[IntentAudit] Failed to record intent:', error.message)
    return false
  }
}

export async function updateIntent(intent, status, result) {
  if (!auditEndpointAvailable) {
    return false // Silently skip if endpoint not available
  }

  try {
    const idempotencyKey = generateIdempotencyKey()
    const response = await fetch(`${API_BASE}/audit/intent/${intent.id}`, {
      method: 'PATCH',
      headers: buildIntentHeaders(intent, idempotencyKey),
      body: JSON.stringify({ status, result }),
    })

    if (response.status === 404) {
      // Endpoint not implemented - disable further attempts
      auditEndpointAvailable = false
      return false
    }

    return response.ok
  } catch (error) {
    // Network error - don't disable, might be temporary
    console.debug('[IntentAudit] Failed to update intent:', error.message)
    return false
  }
}


export async function selectWidgets({
  query,
  queryType = 'overview',
  dataProfile = null,
  maxWidgets = 10,
}) {
  const response = await api.post('/widgets/select', {
    query,
    query_type: queryType,
    data_profile: dataProfile,
    max_widgets: maxWidgets,
  })
  return response.data
}

export async function packGrid(widgets) {
  const response = await api.post('/widgets/pack-grid', { widgets })
  return response.data
}

export async function getWidgetData({ connectionId, scenario, variant, filters, limit = 100 }) {
  const response = await api.post('/widgets/data', {
    connection_id: connectionId,
    scenario,
    variant,
    filters,
    limit,
  })
  return response.data
}

export async function getWidgetReportData({ runId, scenario, variant }) {
  const response = await api.post('/widgets/data/report', {
    run_id: runId,
    scenario,
    variant,
  })
  return response.data
}

export async function recommendWidgets({ connectionId, query = 'overview', maxWidgets = 8 }) {
  const response = await api.post('/widgets/recommend', {
    connection_id: connectionId,
    query,
    max_widgets: maxWidgets,
  })
  return response.data
}

const runtimeEnv = {
  ...(typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env : {}),
  ...(globalThis.__NEURA_TEST_ENVIRONMENT__ || {}),
}

const localHosts = new Set(['0.0.0.0', '127.0.0.1', 'localhost', '::1'])
const recentFingerprints = new Map()
const FINGERPRINT_TTL_MS = 2500

const trimText = (value, maxLen = 1000) => {
  if (value == null) return undefined
  const text = String(value)
  if (!text) return undefined
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
}

const compactText = (value, maxLen = 1000) => {
  const text = trimText(value, maxLen * 2)
  if (!text) return undefined
  const compacted = text.replace(/\s+/g, ' ').trim()
  return compacted.length > maxLen ? `${compacted.slice(0, maxLen)}…` : compacted
}

const safeContext = (value) => {
  if (value == null) return undefined
  try {
    const serialized = JSON.parse(JSON.stringify(value))
    return serialized
  } catch (_) {
    return trimText(value, 1000)
  }
}

const resolveApiOrigin = () => {
  const envBaseUrl = runtimeEnv.VITE_API_BASE_URL
  if (envBaseUrl === 'proxy') return ''
  if (envBaseUrl && envBaseUrl !== 'proxy') {
    // Path-based URL (e.g. /neurareport-api) — use as base directly
    if (envBaseUrl.startsWith('/')) return envBaseUrl
    try {
      const hasScheme = /^([a-z][a-z\d+\-.]*:)?\/\//i.test(envBaseUrl)
      const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
      const candidate = hasScheme ? envBaseUrl : `${protocol}//${envBaseUrl}`
      const parsed = new URL(candidate)
      if (typeof window !== 'undefined' && localHosts.has(parsed.hostname)) {
        parsed.hostname = window.location.hostname
      }
      if (!parsed.port && runtimeEnv.VITE_API_PORT) {
        parsed.port = String(runtimeEnv.VITE_API_PORT)
      }
      return parsed.origin
    } catch (_) {
      // Fallback below
    }
  }

  if (typeof window === 'undefined') return undefined
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  const hostname = window.location.hostname || '127.0.0.1'
  const port = runtimeEnv.VITE_API_PORT || '8500'
  return `${protocol}//${hostname}:${port}`
}

const shouldSkip = () => {
  if (typeof fetch === 'undefined') return true
  if (runtimeEnv.MODE === 'test') return true
  if (typeof globalThis.__VITEST__ !== 'undefined') return true
  return false
}

export async function reportFrontendError(payload = {}) {
  if (shouldSkip()) return false

  const message = compactText(payload.message, 2000)
  if (!message) return false

  const route = trimText(payload.route, 512)
  const action = trimText(payload.action, 256)
  const source = trimText(payload.source || 'frontend', 128)
  const fingerprint = `${source || '-'}|${route || '-'}|${action || '-'}|${message}`
  const nowMs = Date.now()
  const lastSeen = recentFingerprints.get(fingerprint)
  if (lastSeen && nowMs - lastSeen < FINGERPRINT_TTL_MS) {
    return false
  }
  recentFingerprints.set(fingerprint, nowMs)

  if (recentFingerprints.size > 400) {
    const cutoff = nowMs - (FINGERPRINT_TTL_MS * 8)
    for (const [key, ts] of recentFingerprints.entries()) {
      if (ts < cutoff) {
        recentFingerprints.delete(key)
      }
    }
  }

  const origin = resolveApiOrigin()
  if (!origin) return false

  try {
    const response = await fetch(`${origin.replace(/\/$/, '')}/api/v1/audit/frontend-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        source,
        message,
        route,
        action,
        status_code: payload.statusCode ?? payload.status_code,
        method: trimText(payload.method, 16),
        request_url: trimText(payload.requestUrl ?? payload.request_url, 2000),
        stack: trimText(payload.stack, 10000),
        user_agent: trimText(typeof navigator !== 'undefined' ? navigator.userAgent : undefined, 1024),
        timestamp: new Date().toISOString(),
        context: safeContext(payload.context),
      }),
    })
    return response.ok
  } catch (_) {
    return false
  }
}

let globalHandlersInstalled = false

export function installGlobalFrontendErrorHandlers() {
  if (globalHandlersInstalled || typeof window === 'undefined') return
  globalHandlersInstalled = true

  window.addEventListener('error', (event) => {
    const err = event.error
    reportFrontendError({
      source: 'window.error',
      message: err?.message || event.message || 'Uncaught window error',
      stack: err?.stack,
      route: window.location?.pathname,
      requestUrl: window.location?.href,
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const message =
      reason?.message ||
      (typeof reason === 'string' ? reason : 'Unhandled promise rejection')
    reportFrontendError({
      source: 'window.unhandledrejection',
      message,
      stack: reason?.stack,
      route: window.location?.pathname,
      requestUrl: window.location?.href,
      context: {
        reasonType: typeof reason,
      },
    })
  })
}
