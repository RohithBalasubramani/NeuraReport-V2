/**
 * Widget Data API — dedicated REST endpoints for the 10 non-LLM backend widgets.
 *
 * These bypass the chat pipeline so widget data is available immediately on mount.
 */
import plog from './pipelineLogger'

const BASE = '/api/v1/pipeline/data'

const get = (path, params = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  ).toString()
  const url = `${BASE}${path}${qs ? '?' + qs : ''}`
  plog.api(`GET ${path}`, params)
  const start = performance.now()
  return fetch(url).then(r => {
    if (!r.ok) { plog.error(`GET ${path} → ${r.status}`, params); throw new Error(`${r.status} ${r.statusText}`) }
    return r.json()
  }).then(data => {
    plog.api(`GET ${path} → OK (${Math.round(performance.now()-start)}ms)`, { keys: Object.keys(data) })
    return data
  })
}

const post = (path, body) => {
  plog.api(`POST ${path}`, { keys: Object.keys(body) })
  const start = performance.now()
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => {
    if (!r.ok) { plog.error(`POST ${path} → ${r.status}`, body); throw new Error(`${r.status} ${r.statusText}`) }
    return r.json()
  }).then(data => {
    plog.api(`POST ${path} → OK (${Math.round(performance.now()-start)}ms)`, { keys: Object.keys(data) })
    return data
  })
}

/** D2 — Column stats (NULL%, unique, distribution) for a table */
export const fetchColumnStats = (sessionId, table, columns) =>
  get('/column-stats', { session_id: sessionId, table, columns })

/** D6 — Temporal analysis with gap/spike detection */
export const fetchTemporal = (sessionId, table, column, period = 'month') =>
  get('/temporal', { session_id: sessionId, table, column, period })

/** 6d — Batch discovery from contract date columns */
export const fetchBatches = (sessionId, dateFrom, dateTo) =>
  get('/batches', { session_id: sessionId, date_from: dateFrom, date_to: dateTo })

/** 3c — Read persisted column tags */
export const fetchTags = (sessionId) =>
  get('/tags', { session_id: sessionId })

/** 3c — Persist column tags */
export const saveTags = (sessionId, tags) =>
  post('/tags', { session_id: sessionId, tags })

/** D10 — Performance metrics (step timings) */
export const fetchPerformance = (sessionId) =>
  get('/performance', { session_id: sessionId })

/** S7 — Validation issues + constraint violations */
export const fetchProblems = (sessionId) =>
  get('/problems', { session_id: sessionId })

/** 3b — Execute a SELECT query against the session's DB */
export const executeQuery = (sessionId, sql, limit = 100) =>
  post('/query', { session_id: sessionId, sql, limit })

/** 6c — Read persisted custom constraint rules */
export const fetchConstraints = (sessionId) =>
  get('/constraints', { session_id: sessionId })

/** 6c — Persist custom constraint rules */
export const saveConstraints = (sessionId, rules) =>
  post('/constraints', { session_id: sessionId, rules })

/** D12 — Persist pipeline edit history */
export const saveHistory = (sessionId, history) =>
  post('/history', { session_id: sessionId, history })
