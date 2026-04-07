/**
 * Pipeline Logger — structured logging for debugging the full pipeline flow.
 *
 * Logs to console with color-coded categories. Enable/disable via:
 *   localStorage.setItem('NEURA_DEBUG', 'true')   — enable all
 *   localStorage.setItem('NEURA_DEBUG', 'store,event,api') — enable specific categories
 *   localStorage.removeItem('NEURA_DEBUG')         — disable
 *
 * Categories: store, event, api, widget, action, error
 *
 * Also persists last 500 log entries in memory for programmatic access:
 *   window.__neuraLogs  — array of log entries
 *   window.__neuraDump() — dump all logs to console as table
 */

const COLORS = {
  store:  '#4CAF50', // green — state mutations
  event:  '#2196F3', // blue — NDJSON events from backend
  api:    '#FF9800', // orange — REST API calls
  widget: '#9C27B0', // purple — widget lifecycle
  action: '#00BCD4', // teal — user actions
  error:  '#F44336', // red — errors
  hydrate:'#E91E63', // pink — hydration flow
}

const MAX_ENTRIES = 500
const _logs = []

function _isEnabled(category) {
  try {
    const flag = localStorage.getItem('NEURA_DEBUG')
    if (!flag) return false
    if (flag === 'true' || flag === '1' || flag === '*') return true
    return flag.split(',').map(s => s.trim()).includes(category)
  } catch {
    return false
  }
}

function _ts() {
  const d = new Date()
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${d.getMilliseconds().toString().padStart(3,'0')}`
}

function _summarize(obj, maxKeys = 6) {
  if (obj == null) return String(obj)
  if (typeof obj === 'string') return obj.length > 120 ? obj.slice(0, 117) + '...' : obj
  if (Array.isArray(obj)) return `[${obj.length} items]`
  if (typeof obj === 'object') {
    const keys = Object.keys(obj)
    if (keys.length <= maxKeys) {
      const parts = keys.map(k => {
        const v = obj[k]
        if (v == null) return `${k}:null`
        if (typeof v === 'string') return `${k}:"${v.length > 30 ? v.slice(0,27)+'...' : v}"`
        if (typeof v === 'number' || typeof v === 'boolean') return `${k}:${v}`
        if (Array.isArray(v)) return `${k}:[${v.length}]`
        if (typeof v === 'object') return `${k}:{${Object.keys(v).length}}`
        return `${k}:${typeof v}`
      })
      return `{${parts.join(', ')}}`
    }
    return `{${keys.length} keys: ${keys.slice(0, maxKeys).join(', ')}...}`
  }
  return String(obj)
}

function log(category, message, data = null) {
  const entry = {
    ts: Date.now(),
    cat: category,
    msg: message,
    data,
  }

  // Always store in memory ring buffer
  _logs.push(entry)
  if (_logs.length > MAX_ENTRIES) _logs.shift()

  // Console output only if enabled
  if (!_isEnabled(category)) return

  const color = COLORS[category] || '#999'
  const prefix = `%c[${_ts()}] [${category.toUpperCase()}]`
  const style = `color:${color};font-weight:bold`

  if (data != null) {
    console.groupCollapsed(`${prefix} ${message}`, style)
    if (typeof data === 'object') {
      console.log(data)
    } else {
      console.log(data)
    }
    console.groupEnd()
  } else {
    console.log(`${prefix} ${message}`, style)
  }
}

// Convenience methods
const plog = {
  store:   (msg, data) => log('store', msg, data),
  event:   (msg, data) => log('event', msg, data),
  api:     (msg, data) => log('api', msg, data),
  widget:  (msg, data) => log('widget', msg, data),
  action:  (msg, data) => log('action', msg, data),
  error:   (msg, data) => log('error', msg, data),
  hydrate: (msg, data) => log('hydrate', msg, data),
}

// Expose on window for debugging
if (typeof window !== 'undefined') {
  window.__neuraLogs = _logs
  window.__neuraDump = () => {
    console.table(_logs.map(e => ({
      time: new Date(e.ts).toLocaleTimeString(),
      category: e.cat,
      message: e.msg,
      data: e.data ? _summarize(e.data) : '',
    })))
  }
  window.__neuraEnable = (cats = 'true') => {
    localStorage.setItem('NEURA_DEBUG', cats)
    console.log(`NeuraReport debug enabled: ${cats}`)
  }
  window.__neuraDisable = () => {
    localStorage.removeItem('NEURA_DEBUG')
    console.log('NeuraReport debug disabled')
  }
}

export default plog
export { _logs as logBuffer, _summarize as summarize }
