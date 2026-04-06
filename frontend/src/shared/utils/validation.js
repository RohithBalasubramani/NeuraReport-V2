import DOMPurify from 'dompurify'

const HIGHLIGHT_CONFIG = Object.freeze({
  ALLOWED_TAGS: ['mark', 'em', 'strong', 'b', 'i', 'span', 'br'],
  ALLOWED_ATTR: ['class'],
  ALLOW_DATA_ATTR: false,
})

const CODE_HIGHLIGHT_CONFIG = Object.freeze({
  ALLOWED_TAGS: ['span'],
  ALLOWED_ATTR: ['class'],
  ALLOW_DATA_ATTR: false,
})

const SVG_CONFIG = Object.freeze({
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur'],
})

/** Sanitize search highlight HTML. */
export function sanitizeHighlight(dirty) {
  return DOMPurify.sanitize(dirty || '', HIGHLIGHT_CONFIG)
}

/** Sanitize syntax-highlighted code. */
export function sanitizeCodeHighlight(dirty) {
  return DOMPurify.sanitize(dirty || '', CODE_HIGHLIGHT_CONFIG)
}

/** Sanitize SVG content. */
export function sanitizeSVG(dirty) {
  return DOMPurify.sanitize(dirty || '', SVG_CONFIG)
}

// === sqlSafety ===

const WRITE_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'truncate',
  'replace',
  'merge',
  'grant',
  'revoke',
  'comment',
  'rename',
  'vacuum',
  'attach',
  'detach',
]

const WRITE_PATTERN = new RegExp(`\\b(${WRITE_KEYWORDS.join('|')})\\b`, 'i')

const stripSql = (sql) => {
  if (!sql) return ''
  let out = ''
  let inSingle = false
  let inDouble = false
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    const next = sql[i + 1]

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false
        out += ' '
      }
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 1
        out += ' '
      }
      continue
    }

    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') {
        inLineComment = true
        i += 1
        continue
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true
        i += 1
        continue
      }
    }

    if (!inDouble && ch === "'") {
      inSingle = !inSingle
      out += ' '
      continue
    }

    if (!inSingle && ch === '"') {
      inDouble = !inDouble
      out += ' '
      continue
    }

    if (inSingle || inDouble) {
      out += ' '
      continue
    }

    out += ch
  }

  return out
}

export const getWriteOperation = (sql = '') => {
  const cleaned = stripSql(sql)
  const match = cleaned.match(WRITE_PATTERN)
  return match ? match[1].toLowerCase() : null
}

// === preferences ===

export const PREFERENCES_STORAGE_KEY = 'neurareport_preferences'

export const readPreferences = () => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export const emitPreferencesChanged = (prefs) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('neura:preferences-changed', { detail: prefs }))
}

export const subscribePreferences = (callback) => {
  if (typeof window === 'undefined') return () => {}

  const handler = (event) => {
    if (event?.type === 'storage') {
      if (event.key !== PREFERENCES_STORAGE_KEY) return
      callback(readPreferences())
      return
    }
    if (event?.type === 'neura:preferences-changed') {
      callback(event.detail || readPreferences())
    }
  }

  window.addEventListener('storage', handler)
  window.addEventListener('neura:preferences-changed', handler)

  return () => {
    window.removeEventListener('storage', handler)
    window.removeEventListener('neura:preferences-changed', handler)
  }
}

// === confirmDelete ===

const PREF_KEY = 'neurareport_preferences'

function shouldConfirmDelete() {
  if (typeof window === 'undefined') return true
  try {
    const raw = window.localStorage.getItem(PREF_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw)
    return parsed?.confirmDelete ?? true
  } catch {
    return true
  }
}

export function confirmDelete(message) {
  if (!shouldConfirmDelete()) return true
  if (typeof window === 'undefined') return true
  return window.confirm(message)
}

// === Form Validation ===

function isEmpty(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function validateRequired(value, fieldName = 'This field') {
  if (isEmpty(value)) {
    return { valid: false, error: `${fieldName} is required` }
  }
  return { valid: true, error: null }
}

export function validateMinLength(value, minLength, fieldName = 'This field') {
  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be a string` }
  }
  if (value.trim().length < minLength) {
    return { valid: false, error: `${fieldName} must be at least ${minLength} characters` }
  }
  return { valid: true, error: null }
}

export function validateMaxLength(value, maxLength, fieldName = 'This field') {
  if (typeof value !== 'string') {
    return { valid: true, error: null }
  }
  if (value.length > maxLength) {
    return { valid: false, error: `${fieldName} must be at most ${maxLength} characters` }
  }
  return { valid: true, error: null }
}

export function combineValidators(...rules) {
  return (value, allValues) => {
    for (const rule of rules) {
      const result = rule(value, allValues)
      if (!result.valid) {
        return result
      }
    }
    return { valid: true, error: null }
  }
}
