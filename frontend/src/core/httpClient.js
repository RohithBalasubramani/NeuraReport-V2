/**
 * Core HTTP Client — infrastructure extracted from api/client.js
 *
 * Provides: axios instance, URL resolution, retry interceptor,
 * intent/idempotency headers, fetchWithIntent, error handling utilities.
 */
import { getActiveIntent } from '@/utils/helpers'
import axios from 'axios'

const runtimeEnv = {
  ...(typeof import.meta !== 'undefined' && import.meta?.env ? import.meta.env : {}),
  ...(globalThis.__NEURA_TEST_ENVIRONMENT__ || {}),
}

// base URL from env, with fallback
const envBaseUrl = runtimeEnv.VITE_API_BASE_URL

function resolveBaseUrl(url) {
  if (!url || url === 'proxy') return url
  if (url.startsWith('/')) return url
  if (typeof window === 'undefined') return url
  try {
    const localHosts = new Set(['0.0.0.0', '127.0.0.1', 'localhost', '::1'])
    const hasScheme = /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url)
    const candidate = hasScheme ? url : `${window.location.protocol}//${url}`

    const parsed = new URL(candidate)
    if (localHosts.has(parsed.hostname)) {
      parsed.hostname = window.location.hostname
    }
    if (!parsed.port && runtimeEnv.VITE_API_PORT) {
      parsed.port = String(runtimeEnv.VITE_API_PORT)
    }
    return parsed.origin
  } catch (_) { /* not a full URL, keep as-is */ }
  return url
}

export const API_BASE = envBaseUrl === 'proxy' ? '/api' : (resolveBaseUrl(envBaseUrl) || 'http://127.0.0.1:8000')

export const API_V1_BASE =
  API_BASE.endsWith('/api/v1') ? API_BASE
    : API_BASE.endsWith('/api') ? `${API_BASE}/v1`
    : `${API_BASE.replace(/\/$/, '')}/api/v1`

const isAbsoluteUrl = (url) => /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url)
const joinUrl = (base, path) => {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

export const toApiUrl = (url) => {
  if (!url) return url
  if (isAbsoluteUrl(url)) return url
  if (url === API_BASE || url.startsWith(`${API_BASE}/`)) return url
  if (url === API_V1_BASE || url.startsWith(`${API_V1_BASE}/`)) return url

  if (url.startsWith('/uploads') || url.startsWith('/excel-uploads') || url.startsWith('/ws')) {
    return joinUrl(API_BASE, url)
  }

  if (url.startsWith('/api/v1')) {
    return joinUrl(API_BASE, url)
  }

  return joinUrl(API_V1_BASE, url)
}

// preconfigured axios instance
export const api = axios.create({ baseURL: API_V1_BASE, timeout: 60000 })

// Retry interceptor for transient errors
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const MAX_RETRIES = 2
const RETRY_DELAY = 1500

api.interceptors.response.use(null, async (error) => {
  const config = error.config
  if (!config || (config.__retryCount || 0) >= MAX_RETRIES) return Promise.reject(error)

  const status = error.response?.status
  const isRetryable = RETRYABLE_STATUS.has(status) || !error.response
  if (!isRetryable) return Promise.reject(error)

  config.__retryCount = (config.__retryCount || 0) + 1
  await new Promise(r => setTimeout(r, RETRY_DELAY * config.__retryCount))
  return api(config)
})

const IDEMPOTENCY_HEADER = 'Idempotency-Key'
const IDEMPOTENCY_LEGACY_HEADER = 'X-Idempotency-Key'

const generateIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  const rand = Math.random().toString(36).slice(2)
  return `idem-${Date.now().toString(36)}-${rand}`
}

const buildIntentHeaders = (intent) => {
  if (!intent) return {}
  const headers = {
    'X-Intent-Id': intent.id,
    'X-Intent-Type': intent.type,
  }
  if (intent.label) {
    headers['X-Intent-Label'] = encodeURIComponent(intent.label)
  }
  if (intent.reversibility) {
    headers['X-Reversibility'] = intent.reversibility
  }
  if (intent.workflowId) headers['X-Workflow-Id'] = intent.workflowId
  if (intent.workflowStep) headers['X-Workflow-Step'] = intent.workflowStep
  if (intent.userSession) headers['X-User-Session'] = intent.userSession
  if (intent.userAction) headers['X-User-Action'] = intent.userAction
  return headers
}

const createFallbackIntent = (method) => {
  const id = `fallback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const typeMap = {
    post: 'create',
    put: 'update',
    patch: 'update',
    delete: 'delete',
  }
  return {
    id,
    type: typeMap[method] || 'execute',
    label: `Auto-generated intent for ${method.toUpperCase()} request`,
    reversibility: 'system_managed',
  }
}

export const applyIntentAndIdempotency = (headers, method) => {
  const next = { ...(headers || {}) }
  if (!['post', 'put', 'patch', 'delete'].includes(method)) {
    return next
  }

  let intent = getActiveIntent()
  if (!intent) {
    if (typeof console !== 'undefined') {
      console.warn('[UX GOVERNANCE] Missing active intent for mutating request. Using fallback intent.')
    }
    intent = createFallbackIntent(method)
  }
  const intentHeaders = buildIntentHeaders(intent)
  Object.entries(intentHeaders).forEach(([key, value]) => {
    if (value && !next[key]) {
      next[key] = value
    }
  })

  const existing =
    next[IDEMPOTENCY_HEADER] ||
    next[IDEMPOTENCY_LEGACY_HEADER]
  if (!existing) {
    const key = generateIdempotencyKey()
    next[IDEMPOTENCY_HEADER] = key
    next[IDEMPOTENCY_LEGACY_HEADER] = key
  }

  return next
}

// User-friendly error message mapping
const USER_FRIENDLY_ERRORS = {
  401: 'Authentication required. Please check your API key.',
  403: 'Access denied. You do not have permission for this action.',
  'Network Error': 'Unable to connect to the server. Please check your internet connection.',
  'Failed to fetch': 'Unable to connect to the server. Please check your internet connection.',
  'NetworkError': 'Unable to connect to the server. Please check your internet connection.',
  'Load failed': 'Unable to connect to the server. Please check your internet connection.',
  'timeout': 'Request timed out. Please try again.',
  502: 'Server is temporarily unavailable. Please try again in a moment.',
  503: 'Service is temporarily unavailable. Please try again later.',
  504: 'Server took too long to respond. Please try again.',
}

const ERROR_PATTERNS = [
  { pattern: /invalid content type/i, message: 'Please upload a valid file type.' },
  { pattern: /context.*(length|window|exceeded|too long)/i, message: 'The document is too large to process. Please try a smaller file.' },
  { pattern: /quota.*exceeded/i, message: 'AI service quota exceeded. Please try again later or check your API plan.' },
  { pattern: /rate.?limit/i, message: 'Too many requests. Please wait a moment and try again.' },
  { pattern: /circuit.?breaker/i, message: 'AI service is temporarily unavailable. Please try again in a few minutes.' },
  { pattern: /invalid.?api.?key/i, message: 'Invalid API key. Please check your configuration.' },
  { pattern: /connection.*refused/i, message: 'Unable to connect to database. Please verify connection settings.' },
  { pattern: /template.*not.*found/i, message: 'Template not found. It may have been deleted.' },
  { pattern: /job.*not.*found/i, message: 'Job not found. It may have been deleted or expired.' },
]

export function getUserFriendlyError(error) {
  if (error?.name === 'AbortError') {
    return 'Request was cancelled.'
  }
  if (error.response) {
    const status = error.response.status
    const detail = error.response.data?.detail
    const responseMessage = error.response.data?.message

    if (USER_FRIENDLY_ERRORS[status]) {
      return USER_FRIENDLY_ERRORS[status]
    }

    if (typeof responseMessage === 'string' && responseMessage.trim()) {
      return responseMessage
    }

    if (Array.isArray(detail) && detail.length) {
      const firstMessage = detail.find((entry) => typeof entry?.msg === 'string')?.msg
      if (firstMessage) {
        return firstMessage
      }
    }

    if (detail && typeof detail === 'object') {
      const structuredMessage = [
        detail.message,
        detail.detail,
        detail.error,
        detail.reason,
      ].find((value) => typeof value === 'string' && value.trim())

      if (structuredMessage) {
        return structuredMessage
      }
    }

    if (detail && typeof detail === 'string') {
      for (const { pattern, message } of ERROR_PATTERNS) {
        if (pattern.test(detail)) {
          return message
        }
      }
      return detail
    }
  }

  if (error.message) {
    for (const [key, message] of Object.entries(USER_FRIENDLY_ERRORS)) {
      if (error.message.includes(key)) {
        return message
      }
    }

    for (const { pattern, message } of ERROR_PATTERNS) {
      if (pattern.test(error.message)) {
        return message
      }
    }
  }

  return error.message || 'An unexpected error occurred. Please try again.'
}

// Lazy import of reportFrontendError to avoid circular dependency
let _reportFrontendError = null
const getReportFrontendError = () => {
  if (!_reportFrontendError) {
    import('@/api/monitoring').then(mod => {
      _reportFrontendError = mod.reportFrontendError || (() => {})
    }).catch(() => {
      _reportFrontendError = () => {}
    })
  }
  return _reportFrontendError || (() => {})
}

export const fetchWithIntent = async (url, options = {}) => {
  const method = (options.method || 'get').toLowerCase()
  const headers = applyIntentAndIdempotency(options.headers, method)
  try {
    return await fetch(toApiUrl(url), { ...options, headers })
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Network error')
    err.userMessage = getUserFriendlyError(err)
    getReportFrontendError()({
      source: 'fetchWithIntent',
      message: err.message || 'Network error',
      stack: err.stack,
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
      requestUrl: toApiUrl(url),
      method,
      context: {
        userMessage: err.userMessage,
      },
    })
    throw err
  }
}

// Error handling response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    error.userMessage = getUserFriendlyError(error)
    const requestUrl = error?.config?.url
    if (!String(requestUrl || '').includes('/audit/frontend-error')) {
      getReportFrontendError()({
        source: 'axios.response',
        message: error?.message || 'API request failed',
        stack: error?.stack,
        route: typeof window !== 'undefined' ? window.location.pathname : undefined,
        requestUrl,
        method: error?.config?.method,
        statusCode: error?.response?.status,
        context: {
          userMessage: error.userMessage,
          responseData: error?.response?.data,
        },
      })
    }
    return Promise.reject(error)
  }
)

// Request interceptor for intent + idempotency on mutating requests
api.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase()
  if (['post', 'put', 'patch', 'delete'].includes(method)) {
    config.headers = applyIntentAndIdempotency(config.headers, method)
  }
  return config
})

export default api
