import { API_BASE, api, toApiUrl } from './client'
const apiClient = api;


function asArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}


const BASE_PATH = '/agents/v2';


class AgentError extends Error {
  constructor(code, message, retryable = false, details = {}) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

class ValidationError extends AgentError {
  constructor(message, field = null) {
    super('VALIDATION_ERROR', message, false, { field });
    this.name = 'ValidationError';
  }
}

class TaskNotFoundError extends AgentError {
  constructor(taskId) {
    super('TASK_NOT_FOUND', `Task ${taskId} not found`, false, { taskId });
    this.name = 'TaskNotFoundError';
  }
}

class TaskConflictError extends AgentError {
  constructor(message) {
    super('TASK_CONFLICT', message, false);
    this.name = 'TaskConflictError';
  }
}


function handleApiError(error) {
  if (error.response) {
    const { status, data } = error.response;
    const detail = data?.detail || {};

    if (status === 400) {
      throw new ValidationError(detail.message || 'Invalid request', detail.field);
    }
    if (status === 404) {
      throw new TaskNotFoundError(detail.taskId || 'unknown');
    }
    if (status === 409) {
      throw new TaskConflictError(detail.message || 'Task conflict');
    }
    if (status === 429) {
      throw new AgentError(
        'RATE_LIMITED',
        detail.message || 'Rate limit exceeded',
        true,
        { retryAfter: detail.retry_after || 60 }
      );
    }

    throw new AgentError(
      detail.code || 'API_ERROR',
      detail.message || error.message,
      detail.retryable ?? true
    );
  }

  throw new AgentError('NETWORK_ERROR', error.message, true);
}


export async function runResearchAgent(topic, options = {}) {
  try {
    const response = await api.post(`${BASE_PATH}/research`, {
      topic,
      depth: options.depth || 'comprehensive',
      focus_areas: options.focusAreas || null,
      max_sections: options.maxSections || 5,
      idempotency_key: options.idempotencyKey || null,
      priority: options.priority || 0,
      webhook_url: options.webhookUrl || null,
      sync: options.sync !== false, // Default to true
    });
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}


export async function runDataAnalystAgent(question, data, options = {}) {
  try {
    const response = await api.post(`${BASE_PATH}/data-analyst`, {
      question,
      data,
      data_description: options.dataDescription || null,
      generate_charts: options.generateCharts !== false,
      idempotency_key: options.idempotencyKey || null,
      priority: options.priority || 0,
      webhook_url: options.webhookUrl || null,
      sync: options.sync !== false,
    });
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}


export async function runEmailDraftAgent(context, purpose, options = {}) {
  try {
    const response = await api.post(`${BASE_PATH}/email-draft`, {
      context,
      purpose,
      tone: options.tone || 'professional',
      recipient_info: options.recipientInfo || null,
      previous_emails: options.previousEmails || null,
      include_subject: options.includeSubject !== false,
      idempotency_key: options.idempotencyKey || null,
      priority: options.priority || 0,
      webhook_url: options.webhookUrl || null,
      sync: options.sync !== false,
    });
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}


export async function runContentRepurposeAgent(content, sourceFormat, targetFormats, options = {}) {
  try {
    const response = await api.post(`${BASE_PATH}/content-repurpose`, {
      content,
      source_format: sourceFormat,
      target_formats: targetFormats,
      preserve_key_points: options.preserveKeyPoints !== false,
      adapt_length: options.adaptLength !== false,
      idempotency_key: options.idempotencyKey || null,
      priority: options.priority || 0,
      webhook_url: options.webhookUrl || null,
      sync: options.sync !== false,
    });
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}


export async function runProofreadingAgent(text, options = {}) {
  try {
    const response = await api.post(`${BASE_PATH}/proofreading`, {
      text,
      style_guide: options.styleGuide || null,
      focus_areas: options.focusAreas || null,
      preserve_voice: options.preserveVoice !== false,
      idempotency_key: options.idempotencyKey || null,
      priority: options.priority || 0,
      webhook_url: options.webhookUrl || null,
      sync: options.sync !== false,
    });
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}


export async function runReportAnalystAgent(runId, options = {}) {
  try {
    const response = await api.post(`${BASE_PATH}/report-analyst`, {
      run_id: runId,
      analysis_type: options.analysisType || 'summarize',
      question: options.question || null,
      compare_run_id: options.compareRunId || null,
      focus_areas: options.focusAreas || null,
      idempotency_key: options.idempotencyKey || null,
      priority: options.priority || 0,
      webhook_url: options.webhookUrl || null,
      sync: options.sync !== false,
    });
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}

export async function generateReportFromTask(taskId, config = {}) {
  try {
    const response = await api.post(`${BASE_PATH}/tasks/${taskId}/generate-report`, {
      template_id: config.templateId,
      connection_id: config.connectionId,
      start_date: config.startDate,
      end_date: config.endDate,
      key_values: config.keyValues || null,
      docx: config.docx || false,
      xlsx: config.xlsx || false,
    });
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}


export async function getTask(taskId) {
  try {
    const response = await api.get(`${BASE_PATH}/tasks/${taskId}`);
    const payload = response.data;
    if (payload && typeof payload === 'object' && payload.task) {
      return payload.task;
    }
    return payload;
  } catch (error) {
    handleApiError(error);
  }
}

export async function listTasks(options = {}) {
  try {
    const params = {};
    if (options.agentType) params.agent_type = options.agentType;
    if (options.status) params.status = options.status;
    if (options.userId) params.user_id = options.userId;
    if (options.limit) params.limit = options.limit;
    if (options.offset) params.offset = options.offset;

    const response = await api.get(`${BASE_PATH}/tasks`, { params });
    const payload = response.data;
    if (Array.isArray(payload)) {
      return { tasks: payload, total: payload.length };
    }
    if (payload && typeof payload === 'object') {
      const tasks = asArray(payload, ['tasks', 'items', 'results']);
      return { ...payload, tasks, total: payload.total ?? payload.count ?? tasks.length };
    }
    return { tasks: [], total: 0 };
  } catch (error) {
    handleApiError(error);
  }
}

export async function cancelTask(taskId, reason = null) {
  try {
    const response = await api.post(`${BASE_PATH}/tasks/${taskId}/cancel`, {
      reason,
    });
    const payload = response.data;
    if (payload && typeof payload === 'object' && payload.task) {
      return payload.task;
    }
    return payload;
  } catch (error) {
    handleApiError(error);
  }
}

export async function retryTask(taskId) {
  try {
    const response = await api.post(`${BASE_PATH}/tasks/${taskId}/retry`);
    const payload = response.data;
    if (payload && typeof payload === 'object' && payload.task) {
      return payload.task;
    }
    return payload;
  } catch (error) {
    handleApiError(error);
  }
}

export async function getTaskEvents(taskId, limit = 100) {
  try {
    const response = await api.get(`${BASE_PATH}/tasks/${taskId}/events`, {
      params: { limit },
    });
    return asArray(response.data, ['events', 'items', 'results']);
  } catch (error) {
    handleApiError(error);
  }
}


export async function listAgentTypes() {
  try {
    const response = await api.get(`${BASE_PATH}/types`);
    const payload = response.data;
    if (Array.isArray(payload)) {
      return { types: payload };
    }
    if (payload && typeof payload === 'object') {
      return { ...payload, types: asArray(payload, ['types', 'items', 'results']) };
    }
    return { types: [] };
  } catch (error) {
    handleApiError(error);
  }
}

export async function healthCheck() {
  try {
    const response = await api.get(`${BASE_PATH}/health`);
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
}


function streamTaskProgress(taskId, options = {}) {
  const {
    onProgress = null,
    onComplete = null,
    onError = null,
    pollInterval = 0.5,
    timeout = 300,
  } = options;

  const params = new URLSearchParams({
    poll_interval: String(pollInterval),
    timeout: String(timeout),
  });

  const url = toApiUrl(`${BASE_PATH}/tasks/${taskId}/stream?${params}`);

  // Use EventSource for native SSE support
  const eventSource = new EventSource(url);
  let closed = false;

  eventSource.onmessage = (event) => {
    if (closed) return;

    try {
      const payload = JSON.parse(event.data);

      if (payload.event === 'progress' && onProgress) {
        onProgress(payload.data);
      } else if (payload.event === 'complete') {
        if (onComplete) onComplete(payload.data);
        eventSource.close();
        closed = true;
      } else if (payload.event === 'heartbeat') {
        // Connection keep-alive — no action needed
      } else if (payload.event === 'error') {
        // DB_ERROR is transient — server will retry automatically
        if (payload.data.code === 'DB_ERROR') return;
        if (onError) {
          onError(new AgentError(
            payload.data.code || 'STREAM_ERROR',
            payload.data.message || 'Stream error',
            false,
          ));
        }
        eventSource.close();
        closed = true;
      }
    } catch (e) {
      console.warn('Failed to parse SSE event:', e);
    }
  };

  eventSource.onerror = (event) => {
    if (closed) return;

    // EventSource auto-reconnects on transient errors.
    // Only propagate if the connection is truly dead.
    if (eventSource.readyState === EventSource.CLOSED) {
      if (onError) {
        onError(new AgentError('SSE_CONNECTION_CLOSED', 'SSE connection closed', true));
      }
      closed = true;
    }
  };

  return {
    close() {
      if (!closed) {
        closed = true;
        eventSource.close();
      }
    },
  };
}

export function generateIdempotencyKey(userId, topic, options = {}) {
  const parts = [
    userId,
    topic.toLowerCase().trim(),
    options.depth || 'comprehensive',
    (options.focusAreas || []).sort().join(','),
    options.maxSections || 5,
  ];
  return btoa(parts.join('|')).replace(/[^a-zA-Z0-9]/g, '').slice(0, 64);
}


export async function createSession(name) {
  const response = await apiClient.post('/docqa/sessions', { name });
  return response.data;
}

export async function listSessions({ limit, offset } = {}) {
  const params = {};
  if (limit != null) params.limit = limit;
  if (offset != null) params.offset = offset;
  const response = await apiClient.get('/docqa/sessions', { params });
  const payload = response.data;
  if (Array.isArray(payload)) {
    return { sessions: payload, total: payload.length };
  }
  if (payload && typeof payload === 'object') {
    const sessions = asArray(payload, ['sessions', 'items', 'results']);
    return { ...payload, sessions, total: payload.total ?? sessions.length };
  }
  return { sessions: [], total: 0 };
}

export async function getSession(sessionId) {
  const response = await apiClient.get(`/docqa/sessions/${sessionId}`);
  return response.data;
}

export async function deleteSession(sessionId) {
  const response = await apiClient.delete(`/docqa/sessions/${sessionId}`);
  return response.data;
}

export async function addDocument(sessionId, { name, content, pageCount }) {
  const response = await apiClient.post(`/docqa/sessions/${sessionId}/documents`, {
    name,
    content,
    page_count: pageCount,
  });
  return response.data;
}

export async function removeDocument(sessionId, documentId) {
  const response = await apiClient.delete(`/docqa/sessions/${sessionId}/documents/${documentId}`);
  return response.data;
}

export async function askQuestion(sessionId, { question, includeCitations = true, maxResponseLength = 2000 }) {
  const response = await apiClient.post(`/docqa/sessions/${sessionId}/ask`, {
    question,
    include_citations: includeCitations,
    max_response_length: maxResponseLength,
  });
  return response.data;
}

export async function getChatHistory(sessionId, limit = 50) {
  const response = await apiClient.get(`/docqa/sessions/${sessionId}/history`, {
    params: { limit },
  });
  return response.data;
}

export async function clearHistory(sessionId) {
  const response = await apiClient.delete(`/docqa/sessions/${sessionId}/history`);
  return response.data;
}

export async function submitFeedback(sessionId, messageId, { feedbackType, comment }) {
  const response = await apiClient.post(
    `/docqa/sessions/${sessionId}/messages/${messageId}/feedback`,
    {
      feedback_type: feedbackType,
      comment,
    }
  );
  return response.data;
}

export async function regenerateResponse(sessionId, messageId, { includeCitations = true, maxResponseLength = 2000 } = {}) {
  const response = await apiClient.post(
    `/docqa/sessions/${sessionId}/messages/${messageId}/regenerate`,
    {
      include_citations: includeCitations,
      max_response_length: maxResponseLength,
    }
  );
  return response.data;
}


export async function synthesis_createSession(name) {
  const response = await apiClient.post('/synthesis/sessions', { name });
  return response.data;
}

export async function synthesis_listSessions() {
  const response = await apiClient.get('/synthesis/sessions');
  const payload = response.data;
  if (Array.isArray(payload)) {
    return { sessions: payload, total: payload.length };
  }
  if (payload && typeof payload === 'object') {
    const sessions = asArray(payload, ['sessions', 'items', 'results']);
    return { ...payload, sessions, total: payload.total ?? sessions.length };
  }
  return { sessions: [], total: 0 };
}

export async function synthesis_getSession(sessionId) {
  const response = await apiClient.get(`/synthesis/sessions/${sessionId}`);
  return response.data;
}

export async function synthesis_deleteSession(sessionId) {
  const response = await apiClient.delete(`/synthesis/sessions/${sessionId}`);
  return response.data;
}

export async function extractDocument(file, { docType } = {}) {
  const formData = new FormData();
  formData.append('file', file);
  if (docType) formData.append('doc_type', docType);

  const response = await apiClient.post('/synthesis/documents/extract', formData);
  return response.data;
}

export async function findInconsistencies(sessionId) {
  const response = await apiClient.get(`/synthesis/sessions/${sessionId}/inconsistencies`);
  return response.data;
}

export async function synthesize(sessionId, { focusTopics, outputFormat = 'structured', includeSources = true, maxLength = 5000 }) {
  const response = await apiClient.post(`/synthesis/sessions/${sessionId}/synthesize`, {
    focus_topics: focusTopics,
    output_format: outputFormat,
    include_sources: includeSources,
    max_length: maxLength,
  });
  return response.data;
}


export async function generateSQL({ question, connectionId, tables, context }) {
  const { data } = await api.post('/nl2sql/generate', {
    question,
    connection_id: connectionId,
    tables: tables?.length ? tables : undefined,
    context: context || undefined,
  })
  return data
}

export async function executeQuery({ sql, connectionId, limit = 100, offset = 0, includeTotal = false }) {
  const { data } = await api.post('/nl2sql/execute', {
    sql,
    connection_id: connectionId,
    limit,
    offset,
    include_total: includeTotal,
  })
  return data
}

export async function explainQuery(sqlOrConnectionId, maybeSql) {
  const sql = maybeSql ?? sqlOrConnectionId
  const { data } = await api.post('/nl2sql/explain', null, {
    params: { sql },
  })
  return data
}

export async function saveQuery({ name, sql, connectionId, description, originalQuestion, tags }) {
  const { data } = await api.post('/nl2sql/save', {
    name,
    sql,
    connection_id: connectionId,
    description: description || undefined,
    original_question: originalQuestion || undefined,
    tags: tags?.length ? tags : undefined,
  })
  return data
}

export async function listSavedQueries({ connectionId, tags } = {}) {
  const { data } = await api.get('/nl2sql/saved', {
    params: {
      connection_id: connectionId || undefined,
      tags: tags?.length ? tags : undefined,
    },
  })
  if (Array.isArray(data)) {
    return { queries: data, total: data.length }
  }
  if (data && typeof data === 'object') {
    const queries = asArray(data, ['queries', 'saved_queries', 'items', 'results'])
    return { ...data, queries, total: data.total ?? data.count ?? queries.length }
  }
  return { queries: [], total: 0 }
}

export async function getSavedQuery(queryId) {
  const { data } = await api.get(`/nl2sql/saved/${encodeURIComponent(queryId)}`)
  if (data && typeof data === 'object' && data.query) {
    return data.query
  }
  return data
}

export async function deleteSavedQuery(queryId) {
  const { data } = await api.delete(`/nl2sql/saved/${encodeURIComponent(queryId)}`)
  return data
}

export async function getQueryHistory(params = {}) {
  const options = typeof params === 'string'
    ? { connectionId: params, limit: 50 }
    : (params || {})
  const { connectionId, limit = 50 } = options
  const { data } = await api.get('/nl2sql/history', {
    params: {
      connection_id: connectionId || undefined,
      limit,
    },
  })
  if (Array.isArray(data)) {
    return { history: data, total: data.length }
  }
  if (data && typeof data === 'object') {
    const history = asArray(data, ['history', 'queries', 'items', 'results'])
    return { ...data, history, total: data.total ?? data.count ?? history.length }
  }
  return { history: [], total: 0 }
}

export async function deleteQueryHistoryEntry(entryId) {
  const { data } = await api.delete(`/nl2sql/history/${encodeURIComponent(entryId)}`)
  return data
}


export async function getEnrichmentSources() {
  const response = await apiClient.get('/enrichment/sources');
  return response.data;
}

export async function previewEnrichment({ data, sources, sampleSize = 5 }) {
  const response = await apiClient.post('/enrichment/preview', {
    data,
    sources,
    sample_size: sampleSize,
  });
  return response.data;
}

export async function enrichData({ data, sources, options = {} }) {
  const response = await apiClient.post('/enrichment/enrich', {
    data,
    sources,
    options,
  });
  return response.data;
}

export async function createSource({ name, type, description, config = {}, cacheTtlHours = 24 }) {
  const response = await apiClient.post('/enrichment/sources/create', {
    name,
    type,
    description,
    config,
    cache_ttl_hours: cacheTtlHours,
  });
  return response.data;
}

export async function deleteSource(sourceId) {
  const response = await apiClient.delete(`/enrichment/sources/${sourceId}`);
  return response.data;
}

export async function clearCache(sourceId = null) {
  const params = sourceId ? `?source_id=${sourceId}` : '';
  const response = await apiClient.delete(`/enrichment/cache${params}`);
  return response.data;
}


function normalizeSearchResponse(payload, fallbackQuery = '') {
  if (!payload || typeof payload !== 'object') {
    return { query: fallbackQuery, results: [], total: 0, facets: {} };
  }
  const results = asArray(payload, ['results', 'items', 'documents']);
  const total = payload.total ?? payload.total_results ?? payload.count ?? results.length;
  const rawFacets = payload.facets;
  const facets = Array.isArray(rawFacets)
    ? Object.fromEntries(
        rawFacets
          .filter((entry) => entry && typeof entry === 'object')
          .map((entry, index) => [entry.field || entry.name || `facet_${index}`, entry.values || entry.buckets || []])
      )
    : (rawFacets && typeof rawFacets === 'object' ? rawFacets : {});
  return {
    ...payload,
    query: payload.query ?? fallbackQuery,
    results,
    total,
    facets,
  };
}


export async function search(query, options = {}) {
  const response = await api.post('/search/search', {
    query,
    search_type: options.searchType || 'fulltext',
    filters: options.filters || [],
    page: options.page || 1,
    page_size: options.pageSize || 20,
    highlight: options.highlight !== false,
    facet_fields: options.facets || [],
  });
  return normalizeSearchResponse(response.data, query);
}

export async function semanticSearch(query, options = {}) {
  const response = await api.post('/search/search/semantic', {
    query,
    search_type: 'semantic',
    filters: options.filters || [],
    page: options.page || 1,
    page_size: options.limit || 20,
  });
  return normalizeSearchResponse(response.data, query);
}

export async function regexSearch(pattern, options = {}) {
  const response = await api.post('/search/search/regex', {
    query: pattern,
    search_type: 'regex',
    filters: options.filters || [],
  });
  return normalizeSearchResponse(response.data, pattern);
}

export async function booleanSearch(query, options = {}) {
  const response = await api.post('/search/search/boolean', {
    query,
    search_type: 'boolean',
    filters: options.filters || [],
  });
  return normalizeSearchResponse(response.data, query);
}


export async function saveSearch(name, query, options = {}) {
  const response = await api.post('/search/saved-searches', {
    name,
    query,
    filters: options.filters || [],
    notify_on_new: options.isAlert || false,
  });
  return response.data;
}

export async function deleteSavedSearch(searchId) {
  const response = await api.delete(`/search/saved-searches/${searchId}`);
  return response.data;
}

export async function runSavedSearch(searchId) {
  const response = await api.post(`/search/saved-searches/${searchId}/run`);
  return normalizeSearchResponse(response.data);
}


export async function getCatalog() {
  const response = await apiClient.get('/recommendations/catalog');
  return response.data;
}


export async function generateSummary({ content, tone = 'formal', maxSentences = 5, focusAreas }) {
  const response = await apiClient.post('/summary/generate', {
    content,
    tone,
    max_sentences: maxSentences,
    focus_areas: focusAreas,
  });
  return response.data;
}

export async function queueSummary({ content, tone = 'formal', maxSentences = 5, focusAreas }) {
  const response = await apiClient.post('/summary/generate?background=true', {
    content,
    tone,
    max_sentences: maxSentences,
    focus_areas: focusAreas,
  });
  return response.data;
}

export async function getReportSummary(reportId) {
  const response = await apiClient.get(`/summary/reports/${reportId}`);
  return response.data;
}

export async function queueReportSummary(reportId) {
  const response = await apiClient.get(`/summary/reports/${reportId}?background=true`);
  return response.data;
}

