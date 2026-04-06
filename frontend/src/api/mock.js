import { sleep } from './client.js'
const TEMPLATE_HTML_CACHE = new Map()
const ACTIVE_STATUS_SET = new Set(['queued', 'running'])
const SAVED_CHARTS = new Map()
const MOCK_TEMPLATE_CATALOG = [
  {
    id: 'tpl_company_finance',
    name: 'Company Insights',
    source: 'company',
    domain: 'Finance',
    kind: 'pdf',
    description: 'Quarterly revenue and KPI snapshot for finance teams.',
    tags: ['finance', 'kpi'],
  },
  {
    id: 'tpl_company_ops',
    name: 'Operations Pulse',
    source: 'company',
    domain: 'Operations',
    kind: 'pdf',
    description: 'Operational health metrics with alerts for bottlenecks.',
    tags: ['operations', 'ops'],
  },
  {
    id: 'tpl_starter_marketing',
    name: 'Starter Analysis',
    source: 'starter',
    domain: 'Marketing',
    kind: 'pdf',
    description: 'Starter marketing summary.',
    tags: ['marketing'],
  },
]
const MOCK_JOBS = [
  createMockJob({
    id: 'job_mock_running',
    templateId: 'tpl_running_mock',
    templateName: 'Quarterly mock run',
    status: 'running',
  }),
  createMockJob({
    id: 'job_mock_generate',
    templateId: 'tpl_generate_job',
    templateName: 'Quarterly Revenue (Mock)',
    status: 'queued',
  }),
  createMockJob({
    id: 'job_mock_succeeded',
    templateId: 'tpl_success_mock',
    templateName: 'Completed mock run',
    status: 'succeeded',
  }),
  createMockJob({
    id: 'job_mock_failed',
    templateId: 'tpl_failed_mock',
    templateName: 'Failed mock run',
    status: 'failed',
    error: 'Mock failure while rendering PDF',
  }),
]
const MOCK_SCHEDULES = [
  createMockSchedule({
    id: 'schedule_finance_weekly',
    name: 'Weekly Finance Brief',
    template_id: 'tpl_finance_weekly',
    template_name: 'Finance Weekly Brief',
    frequency: 'weekly',
    start_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    next_run_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    last_run_status: 'success',
    last_run_at: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
  }),
  createMockSchedule({
    id: 'schedule_ops_daily',
    name: 'Daily Ops Digest',
    template_id: 'tpl_ops_daily',
    template_name: 'Operations Daily Digest',
    frequency: 'daily',
    start_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    next_run_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    last_run_status: 'failed',
    last_run_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  }),
]
const MOCK_RUNS = [
  {
    id: 'run_mock_001',
    templateId: 'tpl_1',
    templateName: 'Invoice v1',
    templateKind: 'pdf',
    connectionId: 'conn_mock',
    connectionName: 'Mock SQLite',
    startDate: '2024-01-01',
    endDate: '2024-01-31',
    status: 'succeeded',
    artifacts: {
      html_url: '/uploads/mock/report_1.html',
      pdf_url: '/uploads/mock/report_1.pdf',
    },
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'run_mock_002',
    templateId: 'tpl_1',
    templateName: 'Invoice v1',
    templateKind: 'pdf',
    connectionId: 'conn_mock',
    connectionName: 'Mock SQLite',
    startDate: '2024-02-01',
    endDate: '2024-02-29',
    status: 'succeeded',
    artifacts: {
      html_url: '/uploads/mock/report_2.html',
      pdf_url: '/uploads/mock/report_2.pdf',
    },
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  },
]

export async function testConnection(payload) {
  await sleep()
  const dbType = payload?.db_type
    || (typeof payload?.db_url === 'string' && payload.db_url.startsWith('sqlite') ? 'sqlite' : null)
  if (dbType === 'sqlite') {
    if (!payload?.db_url && !payload?.database) {
      const error = new Error('Missing required fields')
      error.response = { data: { detail: 'db_url or database is required for sqlite' } }
      throw error
    }
    return { status: 'ok', ok: true, details: 'Connected (SQLite)', latency_ms: 12 }
  }
  // naive mock: consider any host provided as success
  if (!payload?.host || !dbType) {
    const error = new Error('Missing required fields')
    error.response = { data: { detail: 'db_type and host are required' } }
    throw error
  }
  return { status: 'ok', ok: true, details: `Connected to ${dbType}@${payload.host}` }
}

export async function listTemplates() {
  await sleep()
  return [
    {
      id: 'tpl_1',
      name: 'Invoice v1',
      status: 'approved',
      tags: ['invoice', 'v1'],
      description: 'Monthly invoice rollup for billing teams.',
      kind: 'pdf',
    },
    {
      id: 'tpl_2',
      name: 'Receipt v2',
      status: 'draft',
      tags: ['receipt'],
      description: 'Receipt summary template in draft.',
      kind: 'pdf',
    },
  ]
}

export async function getTemplateCatalog() {
  await sleep(120)
  return MOCK_TEMPLATE_CATALOG.map((tpl) => ({ ...tpl }))
}

export async function createTemplateFromGalleryMock({ galleryId, kind = 'pdf' } = {}) {
  await sleep(200)
  return {
    status: 'ok',
    template_id: `mock-gallery-${galleryId || 'template'}-${Date.now()}`,
    kind,
  }
}

export async function recommendTemplates({ requirement, limit = 5 } = {}) {
  await sleep(200)
  const term = typeof requirement === 'string' ? requirement.toLowerCase() : ''
  const scored = MOCK_TEMPLATE_CATALOG.map((template) => {
    let score = 0.5
    if (term && template.domain && term.includes(template.domain.toLowerCase())) {
      score += 0.3
    }
    if (term && Array.isArray(template.tags) && template.tags.some((tag) => term.includes(tag.toLowerCase()))) {
      score += 0.2
    }
    return {
      template: { ...template },
      explanation:
        template.source === 'starter'
          ? `Starter template for ${template.domain || 'general'} reports.`
          : `Matches ${template.domain || 'general'} requirement.`,
      score,
    }
  })
    .sort((a, b) => b.score - a.score)
  const sliceLength = limit && Number.isFinite(limit) ? Math.max(1, Number(limit)) : scored.length
  return scored.slice(0, sliceLength)
}

export async function startRun(payload) {
  await sleep(800)
  return { run_id: `run_${Math.random().toString(36).slice(2, 8)}`, status: 'queued', ...payload }
}

export async function listRuns() {
  await sleep()
  return [
    { id: 'run_ab12', name: 'Batch 2024-01', status: 'complete', progress: 100 },
    { id: 'run_cd34', name: 'Batch 2024-02', status: 'failed', progress: 42 },
  ]
}

export async function listReportRuns({ templateId, connectionId, scheduleId, limit = 20 } = {}) {
  await sleep(120)
  let runs = MOCK_RUNS.slice()
  if (templateId) runs = runs.filter((run) => run.templateId === templateId)
  if (connectionId) runs = runs.filter((run) => run.connectionId === connectionId)
  if (scheduleId) runs = runs.filter((run) => run.scheduleId === scheduleId)
  if (limit) runs = runs.slice(0, limit)
  return runs
}

export async function getReportRun(runId) {
  await sleep(120)
  return MOCK_RUNS.find((run) => run.id === runId) || null
}

export async function updateTemplateMetadata({ templateId, name, description, tags, status } = {}) {
  await sleep(120)
  return {
    status: 'ok',
    template: {
      id: templateId,
      name,
      description,
      tags,
      status,
      kind: 'pdf',
      updatedAt: new Date().toISOString(),
    },
  }
}

export async function getConnectionSchema({ connectionId, includeRowCounts, includeForeignKeys, sampleRows } = {}) {
  await sleep(120)
  return {
    connection_id: connectionId,
    connection_name: 'Mock SQLite',
    database: 'mock.db',
    table_count: 2,
    tables: [
      {
        name: 'invoices',
        columns: [
          { name: 'invoice_id', type: 'TEXT', notnull: true, pk: true },
          { name: 'customer', type: 'TEXT', notnull: false, pk: false },
          { name: 'amount', type: 'REAL', notnull: false, pk: false },
        ],
        row_count: includeRowCounts ? 128 : undefined,
        foreign_keys: includeForeignKeys ? [] : undefined,
        sample_rows:
          sampleRows && sampleRows > 0
            ? [
                { invoice_id: 'INV-001', customer: 'Acme Corp', amount: 1200.0 },
                { invoice_id: 'INV-002', customer: 'Globex', amount: 540.5 },
              ]
            : undefined,
      },
      {
        name: 'payments',
        columns: [
          { name: 'payment_id', type: 'TEXT', notnull: true, pk: true },
          { name: 'invoice_id', type: 'TEXT', notnull: false, pk: false },
          { name: 'paid_on', type: 'TEXT', notnull: false, pk: false },
        ],
        row_count: includeRowCounts ? 256 : undefined,
        foreign_keys: includeForeignKeys ? [] : undefined,
      },
    ],
  }
}

export async function getConnectionTablePreview({ connectionId, table, limit = 10, offset = 0 } = {}) {
  await sleep(120)
  return {
    connection_id: connectionId,
    table,
    columns: ['invoice_id', 'customer', 'amount'],
    rows: [
      { invoice_id: 'INV-001', customer: 'Acme Corp', amount: 1200.0 },
      { invoice_id: 'INV-002', customer: 'Globex', amount: 540.5 },
    ].slice(offset, offset + limit),
    row_count: 128,
    limit,
    offset,
  }
}

export async function listSchedules() {
  await sleep(120)
  return MOCK_SCHEDULES.map(cloneSchedule)
}

export async function createSchedule(payload = {}) {
  await sleep(180)
  const schedule = createMockSchedule({
    ...payload,
    last_run_status: null,
    last_run_at: null,
    next_run_at: payload.start_date || payload.next_run_at || undefined,
  })
  if (!schedule.template_name) {
    schedule.template_name = schedule.name || schedule.template_id
  }
  MOCK_SCHEDULES.unshift(schedule)
  if (MOCK_SCHEDULES.length > 20) {
    MOCK_SCHEDULES.pop()
  }
  return { schedule: cloneSchedule(schedule) }
}

export async function updateSchedule(scheduleId, updates = {}) {
  await sleep(150)
  const index = MOCK_SCHEDULES.findIndex((item) => item.id === scheduleId)
  if (index < 0) {
    return { status: 'not_found', schedule_id: scheduleId }
  }
  const existing = MOCK_SCHEDULES[index]
  const updated = {
    ...existing,
    ...updates,
    updated_at: new Date().toISOString(),
  }
  MOCK_SCHEDULES[index] = updated
  return { schedule: cloneSchedule(updated) }
}

export async function deleteSchedule(scheduleId) {
  await sleep(120)
  const index = MOCK_SCHEDULES.findIndex((item) => item.id === scheduleId)
  if (index >= 0) {
    MOCK_SCHEDULES.splice(index, 1)
  }
  return { status: index >= 0 ? 'ok' : 'not_found', schedule_id: scheduleId }
}

export async function health() {
  await sleep()
  return { status: 'ok' }
}

export async function getTemplateHtml(templateId) {
  await sleep(200)
  const html =
    TEMPLATE_HTML_CACHE.get(templateId) ||
    `<html><body><h1>Mock template ${templateId}</h1><p>Edit this HTML in mock mode.</p></body></html>`
  return {
    status: 'ok',
    template_id: templateId,
    kind: 'pdf',
    html,
    source: TEMPLATE_HTML_CACHE.has(templateId) ? 'report_final' : 'mock',
    can_undo: false,
    metadata: {
      lastEditType: null,
      lastEditAt: null,
      lastEditNotes: null,
      historyCount: 0,
    },
    history: [],
    correlation_id: null,
  }
}

export async function editTemplateManual(templateId, html) {
  await sleep(200)
  TEMPLATE_HTML_CACHE.set(templateId, html)
  const now = new Date().toISOString()
  return {
    status: 'ok',
    template_id: templateId,
    kind: 'pdf',
    html,
    source: 'report_final',
    can_undo: true,
    metadata: {
      lastEditType: 'manual',
      lastEditAt: now,
      lastEditNotes: 'Manual HTML edit (mock)',
      historyCount: 1,
    },
    history: [
      {
        timestamp: now,
        type: 'manual',
        notes: 'Manual HTML edit (mock)',
      },
    ],
    correlation_id: null,
  }
}

export async function editTemplateAi(templateId, instructions, html) {
  await sleep(300)
  const baseHtml = typeof html === 'string' && html ? html : TEMPLATE_HTML_CACHE.get(templateId) || ''
  const updated =
    baseHtml ||
    `<html><body><h1>AI-edited mock template ${templateId}</h1><p>${instructions}</p></body></html>`
  TEMPLATE_HTML_CACHE.set(templateId, updated)
  const now = new Date().toISOString()
  return {
    status: 'ok',
    template_id: templateId,
    kind: 'pdf',
    html: updated,
    source: 'report_final',
    can_undo: true,
    metadata: {
      lastEditType: 'ai',
      lastEditAt: now,
      lastEditNotes: 'AI HTML edit (mock)',
      historyCount: 1,
    },
    history: [
      {
        timestamp: now,
        type: 'ai',
        notes: 'AI HTML edit (mock)',
        instructions,
        summary: ['Updated template HTML via mock AI'],
      },
    ],
    summary: ['Updated template HTML via mock AI'],
    correlation_id: null,
  }
}

export async function undoTemplateEdit(templateId) {
  await sleep(200)
  const html =
    TEMPLATE_HTML_CACHE.get(templateId) ||
    `<html><body><h1>Mock template ${templateId}</h1><p>No previous edit to undo.</p></body></html>`
  const now = new Date().toISOString()
  return {
    status: 'ok',
    template_id: templateId,
    kind: 'pdf',
    html,
    source: 'report_final',
    can_undo: false,
    metadata: {
      lastEditType: 'undo',
      lastEditAt: now,
      lastEditNotes: 'Undo last edit (mock)',
      historyCount: 1,
    },
    history: [
      {
        timestamp: now,
        type: 'undo',
        notes: 'Undo last edit (mock)',
      },
    ],
    correlation_id: null,
  }
}

export async function suggestChartsMock({
  templateId,
  startDate,
  endDate,
  question,
}) {
  await sleep(250)
  const normalizedQuestion = (question || '').toLowerCase()
  const highlightParents = normalizedQuestion.includes('parent')
  const charts = [
    {
      id: 'mock-chart-rows-trend',
      type: 'line',
      chartTemplateId: 'time_series_basic',
      xField: 'batch_index',
      yFields: ['rows'],
      title: 'Rows trend over batches',
      description: `Row totals for ${templateId} between ${startDate || 'start'} and ${endDate || 'end'}.`,
    },
    {
      id: 'mock-chart-top-batches',
      type: 'bar',
      chartTemplateId: 'top_n_categories',
      xField: 'batch_id',
      yFields: ['rows'],
      title: 'Top batches by rows',
      description: 'Compare the largest batches by child-row volume.',
    },
    {
      id: 'mock-chart-parent-share',
      type: highlightParents ? 'scatter' : 'pie',
      chartTemplateId: highlightParents ? 'distribution_histogram' : null,
      xField: highlightParents ? 'parent' : 'batch_id',
      yFields: ['parent'],
      title: highlightParents ? 'Parents vs rows scatter' : 'Parent share by batch',
      description: highlightParents
        ? 'Explore the relationship between parent rows and child rows.'
        : 'Share of parent rows contributed by top batches.',
    },
  ]

  const sample_data = Array.from({ length: 8 }).map((_, index) => {
    const batchIndex = index + 1
    const rows = 120 + index * 18
    const parent = 1 + (index % 3)
    return {
      batch_index: batchIndex,
      batch_id: `BATCH_${batchIndex}`,
      rows,
      parent,
      rows_per_parent: rows / parent,
      time: `2024-01-${String(batchIndex).padStart(2, '0')}`,
      category: batchIndex % 2 === 0 ? 'North' : 'South',
    }
  })

  return { charts, sample_data }
}

export async function runReportAsJobMock(payload = {}) {
  await sleep(150)
  const jobId = `job_${Math.random().toString(36).slice(2, 8)}`
  const templateId = payload.template_id || `tpl_${jobId.slice(-4)}`
  const templateKind = payload.template_kind || 'pdf'
  const templateName = payload.template_name || templateId || `Mock job for ${templateId}`
  const job = createMockJob({
    id: jobId,
    templateId,
    templateKind,
    templateName,
    status: 'queued',
    type: payload.schedule_id ? 'schedule_run' : 'run_report',
  })
  MOCK_JOBS.unshift(job)
  if (MOCK_JOBS.length > 25) {
    MOCK_JOBS.pop()
  }
  return { job_id: jobId }
}

export async function listJobsMock({ statuses, types, limit, activeOnly } = {}) {
  await sleep(120)
  const normalizedStatuses = Array.isArray(statuses)
    ? new Set(statuses.map((status) => (status || '').toLowerCase()))
    : null
  const normalizedTypes = Array.isArray(types)
    ? new Set(types.map((type) => (type || '').toLowerCase()))
    : null
  let jobs = MOCK_JOBS.slice()
  if (normalizedStatuses && normalizedStatuses.size) {
    jobs = jobs.filter((job) => normalizedStatuses.has((job.status || '').toLowerCase()))
  }
  if (normalizedTypes && normalizedTypes.size) {
    jobs = jobs.filter((job) => normalizedTypes.has((job.type || '').toLowerCase()))
  }
  if (activeOnly) {
    jobs = jobs.filter((job) => ACTIVE_STATUS_SET.has((job.status || '').toLowerCase()))
  }
  const sliceLength =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : jobs.length
  return { jobs: jobs.slice(0, sliceLength).map(cloneJob) }
}

export async function getJobMock(jobId) {
  await sleep(80)
  const job = MOCK_JOBS.find((item) => item.id === jobId)
  return job ? cloneJob(job) : null
}

function cloneSchedule(schedule) {
  return {
    ...schedule,
    batch_ids: Array.isArray(schedule.batch_ids) ? schedule.batch_ids.slice() : [],
    key_values: { ...(schedule.key_values || {}) },
    email_recipients: Array.isArray(schedule.email_recipients)
      ? schedule.email_recipients.slice()
      : [],
  }
}

function cloneJob(job) {
  return {
    ...job,
    steps: Array.isArray(job.steps) ? job.steps.map((step) => ({ ...step })) : [],
  }
}

const HOUR_MS = 60 * 60 * 1000

function createMockSchedule(overrides = {}) {
  const templateId = overrides.template_id || overrides.templateId || 'tpl_mock'
  const templateName =
    overrides.template_name ||
    overrides.templateName ||
    overrides.name ||
    `Mock template ${templateId}`
  const scheduleName = overrides.name || overrides.schedule_name || templateName
  const connectionId = overrides.connection_id || overrides.connectionId || 'mock_connection'
  const batchIds = overrides.batch_ids || overrides.batchIds
  const keyValues = overrides.key_values || overrides.keyValues
  const emailRecipients = overrides.email_recipients || overrides.emailRecipients
  const startDate = toDate(overrides.start_date || overrides.startDate || Date.now())
  const endDateRaw = overrides.end_date || overrides.endDate
  const nextRunOverride = overrides.next_run_at || overrides.nextRunAt
  const lastRunStatus = overrides.last_run_status || overrides.lastRunStatus || null
  const lastRunOverride = overrides.last_run_at || overrides.lastRunAt
  const nextRunDate = nextRunOverride
    ? toDate(nextRunOverride)
    : new Date(startDate.getTime() + HOUR_MS)
  const lastRunDate =
    lastRunStatus &&
    (lastRunOverride ? toDate(lastRunOverride) : new Date(startDate.getTime() - HOUR_MS))
  return {
    id: overrides.id || overrides.schedule_id || `schedule_${Math.random().toString(36).slice(2, 8)}`,
    template_id: templateId,
    template_name: templateName,
    connection_id: connectionId,
    name: scheduleName,
    start_date: startDate.toISOString(),
    end_date: endDateRaw ? toDate(endDateRaw, startDate.getTime() + 2 * HOUR_MS).toISOString() : null,
    next_run_at: nextRunDate.toISOString(),
    last_run_status: lastRunStatus,
    last_run_at: lastRunDate ? lastRunDate.toISOString() : null,
    frequency: overrides.frequency || 'daily',
    interval_minutes:
      typeof overrides.interval_minutes === 'number'
        ? overrides.interval_minutes
        : typeof overrides.intervalMinutes === 'number' && Number.isFinite(overrides.intervalMinutes)
          ? overrides.intervalMinutes
          : null,
    key_values: keyValues ? { ...keyValues } : {},
    batch_ids: Array.isArray(batchIds) ? batchIds.slice() : [],
    docx: !!overrides.docx,
    xlsx: !!overrides.xlsx,
    email_recipients: Array.isArray(emailRecipients) ? emailRecipients.slice() : [],
    email_subject: overrides.email_subject || overrides.emailSubject || '',
    email_message: overrides.email_message || overrides.emailMessage || '',
    created_at: overrides.created_at || overrides.createdAt || startDate.toISOString(),
    updated_at: overrides.updated_at || overrides.updatedAt || startDate.toISOString(),
  }
}

function toDate(value, fallbackMs = Date.now()) {
  if (!value && value !== 0) {
    return new Date(fallbackMs)
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date(fallbackMs)
  }
  return date
}

function createMockJob({
  id,
  templateId,
  templateName,
  templateKind = 'pdf',
  status = 'queued',
  type = 'run_report',
  error = null,
}) {
  const now = new Date().toISOString()
  const normalizedStatus = (status || 'queued').toLowerCase()
  const completed = ['succeeded', 'failed', 'cancelled'].includes(normalizedStatus)
  const started = completed || normalizedStatus === 'running'
  const progress =
    normalizedStatus === 'succeeded'
      ? 100
      : normalizedStatus === 'failed' || normalizedStatus === 'cancelled'
        ? 100
        : normalizedStatus === 'running'
          ? 60
          : 0
  return {
    id,
    type,
    status: normalizedStatus,
    templateId,
    templateName,
    templateKind,
    progress,
    error,
    createdAt: now,
    queuedAt: now,
    startedAt: started ? now : null,
    finishedAt: completed ? now : null,
    steps: buildMockSteps(normalizedStatus),
  }
}

function buildMockSteps(jobStatus) {
  const steps = [
    { name: 'dataLoad', label: 'Load database' },
    { name: 'contractCheck', label: 'Prepare contract' },
    { name: 'renderPdf', label: 'Render PDF' },
    { name: 'renderDocx', label: 'Render DOCX' },
    { name: 'renderXlsx', label: 'Render XLSX' },
    { name: 'finalize', label: 'Finalize artifacts' },
    { name: 'email', label: 'Send email' },
  ]
  return steps.map((step, index) => {
    let status = 'queued'
    if (jobStatus === 'succeeded') {
      status = 'succeeded'
    } else if (jobStatus === 'running') {
      status = index <= 1 ? 'succeeded' : index === 2 ? 'running' : 'queued'
    } else if (jobStatus === 'failed') {
      status = index === 0 ? 'failed' : 'queued'
    } else if (jobStatus === 'cancelled') {
      status = index === 0 ? 'cancelled' : 'queued'
    }
    return { id: `${step.name}-${index}`, ...step, status }
  })
}

const _savedChartsFor = (templateId) => {
  const key = templateId || ''
  if (!SAVED_CHARTS.has(key)) {
    SAVED_CHARTS.set(key, [])
  }
  return SAVED_CHARTS.get(key)
}

export async function listSavedChartsMock({ templateId }) {
  await sleep()
  const charts = _savedChartsFor(templateId)
  return { charts }
}

export async function createSavedChartMock({ templateId, name, spec }) {
  await sleep()
  const charts = _savedChartsFor(templateId)
  const record = {
    id: `mock-saved-${Date.now()}-${charts.length + 1}`,
    template_id: templateId,
    name,
    spec: JSON.parse(JSON.stringify(spec || {})),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  charts.push(record)
  return record
}

export async function updateSavedChartMock({ templateId, chartId, name, spec }) {
  await sleep()
  const charts = _savedChartsFor(templateId)
  const record = charts.find((item) => item.id === chartId)
  if (!record) {
    throw new Error('Chart not found')
  }
  if (name != null) {
    record.name = name
  }
  if (spec != null) {
    record.spec = JSON.parse(JSON.stringify(spec))
  }
  record.updated_at = new Date().toISOString()
  return record
}

export async function deleteSavedChartMock({ templateId, chartId }) {
  await sleep()
  const charts = _savedChartsFor(templateId)
  const index = charts.findIndex((item) => item.id === chartId)
  if (index >= 0) {
    charts.splice(index, 1)
  }
  return { status: 'ok' }
}
