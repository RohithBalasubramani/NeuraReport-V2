/**
 * Centralized Job Status Utilities
 */

export const JobStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  CANCELLING: 'cancelling',
}

const ACTIVE_STATUSES = new Set([JobStatus.PENDING, JobStatus.RUNNING, JobStatus.CANCELLING])

export const TERMINAL_STATUSES = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
])

const FAILURE_STATUSES = new Set([JobStatus.FAILED, JobStatus.CANCELLED])

export function normalizeJobStatus(status) {
  const value = (status || '').toString().toLowerCase().trim()

  if (value === 'succeeded' || value === 'success' || value === 'done') {
    return JobStatus.COMPLETED
  }

  if (value === 'queued') {
    return JobStatus.PENDING
  }

  if (value === 'in_progress' || value === 'started') {
    return JobStatus.RUNNING
  }

  if (value === 'error') {
    return JobStatus.FAILED
  }

  if (value === 'canceled') {
    return JobStatus.CANCELLED
  }

  if (value === 'canceling') {
    return JobStatus.CANCELLING
  }

  if (Object.values(JobStatus).includes(value)) {
    return value
  }

  return JobStatus.PENDING
}

function normalizeStepStatus(status) {
  const value = (status || '').toString().toLowerCase().trim()

  if (value === 'complete' || value === 'done' || value === 'success') {
    return JobStatus.COMPLETED
  }

  if (value === 'skipped') {
    return JobStatus.COMPLETED
  }

  return normalizeJobStatus(value)
}

export function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(normalizeJobStatus(status))
}

export function isFailureStatus(status) {
  return FAILURE_STATUSES.has(normalizeJobStatus(status))
}

export function canRetryJob(status) {
  return normalizeJobStatus(status) === JobStatus.FAILED
}

export function canCancelJob(status) {
  return isActiveStatus(status)
}

export function normalizeJob(job = {}) {
  const status = normalizeJobStatus(job.status || job.state)
  const result = job.result || {}
  const meta = job.meta || job.metadata || {}

  const artifacts = job.artifacts || result.artifacts || {
    html_url: result.html_url,
    pdf_url: result.pdf_url,
    docx_url: result.docx_url,
    xlsx_url: result.xlsx_url,
  }

  const steps = Array.isArray(job.steps)
    ? job.steps.map(step => ({
        ...step,
        status: normalizeStepStatus(step.status),
      }))
    : job.steps

  return {
    ...job,
    status,
    steps,
    templateName: job.templateName || job.template_name || job.template || job.templateTitle,
    templateId: job.templateId || job.template_id,
    templateKind: job.templateKind || job.template_kind || job.kind,
    connectionId: job.connectionId || job.connection_id,
    createdAt: job.createdAt || job.created_at || job.startedAt || job.started_at || job.queuedAt || job.queued_at,
    startedAt: job.startedAt || job.started_at || job.created_at || job.queuedAt || job.queued_at,
    finishedAt: job.finishedAt || job.finished_at || job.completed_at || job.completedAt,
    startDate: meta.start_date || meta.startDate || job.start_date || job.startDate,
    endDate: meta.end_date || meta.endDate || job.end_date || job.endDate,
    keyValues: meta.key_values || meta.keyValues || job.key_values || job.keyValues,
    artifacts,
    meta,
  }
}

// === templateMeta ===

const LAST_EDIT_TYPE_LABELS = {
  manual: 'Manual edit',
  ai: 'AI edit',
  undo: 'Undo',
}

const LAST_EDIT_TYPE_COLORS = {
  manual: 'primary',
  ai: 'secondary',
  undo: 'warning',
}

const LAST_EDIT_TYPE_VARIANTS = {
  manual: 'filled',
  ai: 'filled',
  undo: 'outlined',
}

const pad = (value) => String(value).padStart(2, '0')

const formatLastEditTimestamp = (isoString) => {
  if (!isoString) return null
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export const buildLastEditInfo = (source) => {
  if (!source || typeof source !== 'object') return null
  const rawType =
    typeof source.lastEditType === 'string' ? source.lastEditType.trim().toLowerCase() : null
  const type = rawType === 'manual' || rawType === 'ai' || rawType === 'undo' ? rawType : null
  const typeLabel = type ? LAST_EDIT_TYPE_LABELS[type] : null
  const timestampLabel = formatLastEditTimestamp(source.lastEditAt)
  if (!typeLabel && !timestampLabel) {
    return null
  }
  const chipLabel = typeLabel && timestampLabel
    ? `${typeLabel} \u00B7 ${timestampLabel}`
    : typeLabel || (timestampLabel ? `Edited ${timestampLabel}` : null)
  return {
    type,
    typeLabel,
    timestampLabel,
    chipLabel,
    color: (type && LAST_EDIT_TYPE_COLORS[type]) || 'default',
    variant: (type && LAST_EDIT_TYPE_VARIANTS[type]) || 'outlined',
  }
}
