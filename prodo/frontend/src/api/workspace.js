import { api } from './client'
const apiClient = api;


function asArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}


export async function createDashboard(data) {
  const response = await api.post('/dashboards', data);
  return response.data;
}

export async function getDashboard(dashboardId) {
  const response = await api.get(`/dashboards/${dashboardId}`);
  return response.data;
}

export async function updateDashboard(dashboardId, data) {
  const response = await api.put(`/dashboards/${dashboardId}`, data);
  return response.data;
}

export async function deleteDashboard(dashboardId) {
  const response = await api.delete(`/dashboards/${dashboardId}`);
  return response.data;
}

export async function addWidget(dashboardId, widget) {
  const response = await api.post(`/dashboards/${dashboardId}/widgets`, widget);
  return response.data;
}

export async function updateWidget(dashboardId, widgetId, data) {
  const response = await api.put(`/dashboards/${dashboardId}/widgets/${widgetId}`, data);
  return response.data;
}

export async function deleteWidget(dashboardId, widgetId) {
  const response = await api.delete(`/dashboards/${dashboardId}/widgets/${widgetId}`);
  return response.data;
}

export async function refreshDashboard(dashboardId) {
  const response = await api.post(`/dashboards/${dashboardId}/refresh`);
  return response.data;
}


export async function createSnapshot(dashboardId, format = 'png') {
  const response = await api.post(`/dashboards/${dashboardId}/snapshot`, null, {
    params: { format },
  });
  return response.data;
}

export async function generateEmbedToken(dashboardId, expiresHours = 24) {
  const response = await api.post(`/dashboards/${dashboardId}/embed`, null, {
    params: { expires_hours: expiresHours },
  });
  return response.data;
}

export async function generateInsights(data, context = null) {
  const response = await api.post('/dashboards/analytics/insights', { data, context });
  return response.data;
}

export async function predictTrends(data, dateColumn, valueColumn, periods = 12) {
  const response = await api.post('/dashboards/analytics/trends', {
    data,
    date_column: dateColumn,
    value_column: valueColumn,
  }, {
    params: { periods },
  });
  return response.data;
}

export async function detectAnomalies(data, columns, method = 'zscore') {
  const response = await api.post('/dashboards/analytics/anomalies', {
    data,
    columns,
  }, {
    params: { method },
  });
  return response.data;
}

export async function createFromTemplate(templateId, name) {
  const response = await api.post(`/dashboards/templates/${templateId}/create`, { name });
  return response.data;
}

export async function saveAsTemplate(dashboardId, name, description = null) {
  const response = await api.post(`/dashboards/${dashboardId}/save-as-template`, { name, description });
  return response.data;
}

export async function createWorkflow(data) {
  const response = await api.post('/workflows', data);
  return response.data;
}

export async function getWorkflow(workflowId) {
  const response = await api.get(`/workflows/${workflowId}`);
  return response.data;
}

export async function updateWorkflow(workflowId, data) {
  const response = await api.put(`/workflows/${workflowId}`, data);
  return response.data;
}

export async function deleteWorkflow(workflowId) {
  const response = await api.delete(`/workflows/${workflowId}`);
  return response.data;
}

export async function executeWorkflow(workflowId, inputs = {}) {
  const response = await api.post(`/workflows/${workflowId}/execute`, { input_data: inputs });
  return response.data;
}

export async function cancelExecution(workflowId, executionId) {
  const response = await api.post(`/workflows/${workflowId}/executions/${executionId}/cancel`);
  return response.data;
}

export async function retryExecution(workflowId, executionId) {
  const response = await api.post(`/workflows/${workflowId}/executions/${executionId}/retry`);
  return response.data;
}


export async function approveStep(executionId, stepId, comment = null) {
  const response = await api.post(`/workflows/executions/${executionId}/approve`, {
    execution_id: executionId,
    node_id: stepId,
    approved: true,
    comment,
  });
  return response.data;
}

export async function rejectStep(executionId, stepId, reason) {
  const response = await api.post(`/workflows/executions/${executionId}/approve`, {
    execution_id: executionId,
    node_id: stepId,
    approved: false,
    comment: reason,
  });
  return response.data;
}


function normalizeDocument(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const normalized = { ...doc };
  if (normalized.file_type == null && normalized.document_type) {
    normalized.file_type = normalized.document_type;
  }
  if (normalized.collection_ids == null && Array.isArray(normalized.collections)) {
    normalized.collection_ids = normalized.collections;
  }
  return normalized;
}

function inferDocumentType(fileName) {
  const ext = String(fileName || '').toLowerCase().split('.').pop();
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'doc':
    case 'docx':
      return 'docx';
    case 'xls':
    case 'xlsx':
      return 'xlsx';
    case 'ppt':
    case 'pptx':
      return 'pptx';
    case 'txt':
      return 'txt';
    case 'md':
    case 'markdown':
      return 'md';
    case 'htm':
    case 'html':
      return 'html';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return 'image';
    default:
      return 'other';
  }
}


export async function addDocument(data) {
  const response = await api.post('/knowledge/documents', data);
  return response.data;
}

export async function uploadDocument(file, title, collectionId = null) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title || file.name);
  formData.append('document_type', inferDocumentType(file?.name));
  if (collectionId) {
    formData.append('collection_id', collectionId);
  }
  const response = await api.post('/knowledge/documents', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function getDocument(documentId) {
  const response = await api.get(`/knowledge/documents/${documentId}`);
  return response.data;
}

export async function listDocuments(options = {}) {
  const response = await api.get('/knowledge/documents', {
    params: {
      collection_id: options.collectionId,
      tags: Array.isArray(options.tags) ? options.tags.join(',') : options.tags,
      document_type: options.documentType,
      limit: options.pageSize || 50,
      offset: options.offset || 0,
    },
  });
  const payload = response.data;
  if (Array.isArray(payload)) {
    const documents = payload.map(normalizeDocument);
    return { documents, total: documents.length };
  }
  if (payload && Array.isArray(payload.documents)) {
    const documents = payload.documents.map(normalizeDocument);
    return { ...payload, documents, total: payload.total ?? documents.length };
  }
  return { documents: [], total: 0 };
}

export async function updateDocument(documentId, data) {
  const response = await api.put(`/knowledge/documents/${documentId}`, data);
  return response.data;
}

export async function deleteDocument(documentId) {
  const response = await api.delete(`/knowledge/documents/${documentId}`);
  return response.data;
}

export async function toggleFavorite(documentId) {
  const response = await api.post(`/knowledge/documents/${documentId}/favorite`);
  return response.data;
}


export async function createCollection(data) {
  const response = await api.post('/knowledge/collections', data);
  return response.data;
}

export async function searchDocuments(query, options = {}) {
  const response = await api.post('/knowledge/search', {
    query,
    collections: options.collectionId ? [options.collectionId] : [],
    tags: options.tags || [],
    date_from: options.dateFrom,
    date_to: options.dateTo,
    limit: options.pageSize || 50,
    offset: options.offset || 0,
  });
  return response.data;
}

export async function semanticSearch(query, options = {}) {
  const response = await api.post('/knowledge/search/semantic', {
    query,
    top_k: options.limit || 10,
    threshold: options.minSimilarity || 0.5,
  });
  return response.data;
}


export async function autoTag(documentId, maxTags = 5) {
  const response = await api.post('/knowledge/auto-tag', {
    document_id: documentId,
    max_tags: maxTags,
  });
  return response.data;
}

export async function findRelated(documentId, options = {}) {
  const response = await api.post('/knowledge/related', {
    document_id: documentId,
    limit: options.limit || 10,
  });
  return response.data;
}

export async function buildKnowledgeGraph(options = {}) {
  const response = await api.post('/knowledge/knowledge-graph', {
    document_ids: options.documentIds || [],
    depth: options.depth || 2,
    include_entities: options.includeEntities !== false,
  });
  return response.data;
}

export async function generateFaq(options = {}) {
  const documentIds = Array.isArray(options.documentIds)
    ? options.documentIds.filter(Boolean)
    : [];
  const response = await api.post('/knowledge/faq', {
    document_ids: documentIds,
    max_questions: options.maxQuestions || 10,
  }, {
    params: {
      background: options.background ?? false,
    },
  });
  return response.data;
}


export async function testConnection(connectorType, config) {
  const response = await api.post(`/connectors/${connectorType}/test`, {
    connector_type: connectorType,
    config,
  });
  return response.data;
}


export async function createConnection(connectorType, name, config) {
  const response = await api.post(`/connectors/${connectorType}/connect`, {
    name,
    connector_type: connectorType,
    config,
  });
  return response.data;
}

export async function getConnection(connectionId) {
  const response = await api.get(`/connectors/${connectionId}`);
  return response.data;
}

export async function listConnections(params = {}) {
  const response = await api.get('/connectors', { params });
  const payload = response.data;
  if (Array.isArray(payload)) {
    return { connections: payload, total: payload.length };
  }
  if (payload && typeof payload === 'object') {
    const connections = asArray(payload, ['connections', 'items', 'results']);
    return { ...payload, connections, total: payload.total ?? connections.length };
  }
  return { connections: [], total: 0 };
}

export async function deleteConnection(connectionId) {
  const response = await api.delete(`/connectors/${connectionId}`);
  return response.data;
}


export async function getConnectionSchema(connectionId) {
  const response = await api.get(`/connectors/${connectionId}/schema`);
  return response.data;
}


export async function executeQuery(connectionId, query, parameters = null, limit = 1000) {
  const response = await api.post(`/connectors/${connectionId}/query`, {
    query,
    parameters,
    limit,
  });
  return response.data;
}


// Legacy OAuth popup endpoint (returns auth_url)
// Uses the /oauth/authorize endpoint which is the actual backend route
export async function downloadFile(connectionId, filePath) {
  const response = await api.get(`/connectors/${connectionId}/files/download`, {
    params: { path: filePath },
    responseType: 'blob',
  });
  return response.data;
}

export async function uploadFile(connectionId, file, destinationPath) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', destinationPath);
  const response = await api.post(`/connectors/${connectionId}/files/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}


export async function uploadBulk(files, options = {}) {
  const formData = new FormData();
  files.forEach((file, index) => {
    formData.append(`files`, file);
  });
  if (options.autoDetect !== false) {
    formData.append('auto_detect', 'true');
  }

  const response = await api.post('/ingestion/upload/bulk', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: options.onProgress,
  });
  const payload = response.data;
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    return asArray(payload, ['results', 'uploads', 'files', 'items']);
  }
  return [];
}

export async function uploadZip(file, options = {}) {
  const formData = new FormData();
  formData.append('file', file);
  if (options.flattenFolders) {
    formData.append('flatten_folders', 'true');
  }

  const response = await api.post('/ingestion/upload/zip', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: options.onProgress,
  });
  return response.data;
}


export async function importFromUrl(url, options = {}) {
  const response = await api.post('/ingestion/url', {
    url,
    extract_text: options.extractText !== false,
    follow_links: options.followLinks || false,
    max_depth: options.maxDepth || 1,
  });
  return response.data;
}


export async function clipUrl(url, options = {}) {
  const response = await api.post('/ingestion/clip/url', {
    url,
    include_images: options.includeImages !== false,
    clean_content: options.cleanContent !== false,
    capture_screenshot: options.captureScreenshot || false,
  });
  return response.data;
}

export async function createWatcher(folderPath, options = {}) {
  const response = await api.post('/ingestion/watchers', {
    path: folderPath,
    patterns: options.patterns || ['*'],
    recursive: options.recursive !== false,
    auto_import: options.autoImport !== false,
    delete_after_import: options.deleteAfterImport || false,
    target_collection: options.targetCollection || null,
    ignore_patterns: options.ignorePatterns || [],
    tags: options.tags || [],
  });
  return response.data;
}

export async function startWatcher(watcherId) {
  const response = await api.post(`/ingestion/watchers/${watcherId}/start`);
  return response.data;
}

export async function stopWatcher(watcherId) {
  const response = await api.post(`/ingestion/watchers/${watcherId}/stop`);
  return response.data;
}

export async function deleteWatcher(watcherId) {
  const response = await api.delete(`/ingestion/watchers/${watcherId}`);
  return response.data;
}

export async function transcribeFile(file, options = {}) {
  const formData = new FormData();
  formData.append('file', file);
  if (options.language) {
    formData.append('language', options.language);
  }
  if (options.model) {
    formData.append('model', options.model);
  }
  if (options.timestamps) {
    formData.append('timestamps', 'true');
  }

  const response = await api.post('/ingestion/transcribe', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: options.onProgress,
  });
  return response.data;
}

export async function connectImapAccount(config) {
  const response = await api.post('/ingestion/email/imap/connect', config);
  return response.data;
}

export async function syncImapAccount(accountId, options = {}) {
  const response = await api.post(`/ingestion/email/imap/accounts/${accountId}/sync`, {
    folder: options.folder || 'INBOX',
    since_date: options.sinceDate || null,
    limit: options.limit || 100,
  });
  return response.data;
}


export async function suggestJoins(connectionIds) {
  const response = await apiClient.post('/federation/suggest-joins', {
    connection_ids: connectionIds,
  });
  const payload = response.data;
  if (Array.isArray(payload)) {
    return { suggestions: payload };
  }
  if (payload && typeof payload === 'object') {
    return { ...payload, suggestions: asArray(payload, ['suggestions', 'joins']) };
  }
  return { suggestions: [] };
}

async function createVirtualSchema(data) { return {} }
async function listVirtualSchemas() { return [] }
async function getVirtualSchema(id) { return {} }
async function executeFederatedQuery(query) { return { rows: [], columns: [] } }
async function deleteVirtualSchema(id) { return {} }

export default {
  createVirtualSchema,
  listVirtualSchemas,
  getVirtualSchema,
  suggestJoins,
  executeFederatedQuery,
  deleteVirtualSchema,
};



export async function generateFlowchart(data, options = {}) {
  // Backend expects { description: string }
  // Container passes { steps: [...] } — join into a description string
  const description = typeof data === 'string'
    ? data
    : Array.isArray(data?.steps) ? data.steps.join('\n') : JSON.stringify(data);
  const response = await api.post('/visualization/diagrams/flowchart', {
    description,
    title: options.title || null,
  });
  return response.data;
}

export async function generateMindmap(data, options = {}) {
  // Backend expects { content: string }
  const content = typeof data === 'string' ? data : (data?.text || JSON.stringify(data));
  const response = await api.post('/visualization/diagrams/mindmap', {
    content,
    title: options.title || null,
    max_depth: options.maxDepth || 3,
  });
  return response.data;
}

export async function generateOrgChart(data, options = {}) {
  // Backend expects { org_data: list[dict] }
  const orgData = Array.isArray(data) ? data : (data?.org_data || [data]);
  const response = await api.post('/visualization/diagrams/org-chart', {
    org_data: orgData,
    title: options.title || null,
  });
  return response.data;
}

export async function generateTimeline(data, options = {}) {
  // Backend expects { events: list[dict] }
  // Container passes { events: [...strings] } — wrap each string into a dict
  let events = Array.isArray(data) ? data : (data?.events || []);
  events = events.map((e) => (typeof e === 'string' ? { description: e } : e));
  const response = await api.post('/visualization/diagrams/timeline', {
    events,
    title: options.title || null,
  });
  return response.data;
}

export async function generateGantt(data, options = {}) {
  // Backend expects { tasks: list[dict] }
  const tasks = Array.isArray(data) ? data : (data?.tasks || [data]);
  const response = await api.post('/visualization/diagrams/gantt', {
    tasks,
    title: options.title || null,
  });
  return response.data;
}

export async function generateNetworkGraph(data, options = {}) {
  // Backend expects { relationships: list[dict] }
  // Container passes { connections: [...strings] }
  let relationships = Array.isArray(data) ? data : (data?.connections || data?.relationships || []);
  relationships = relationships.map((r) => {
    if (typeof r === 'string') {
      const parts = r.split(/\s*->\s*/);
      return { source: parts[0]?.trim(), target: parts[1]?.trim(), label: parts[2]?.trim() || null };
    }
    return r;
  });
  const response = await api.post('/visualization/diagrams/network', {
    relationships,
    title: options.title || null,
  });
  return response.data;
}

export async function generateKanban(data, options = {}) {
  // Backend expects { items: list[dict] }
  // Container passes { tasks: "string" }
  let items;
  if (typeof data === 'string' || typeof data?.tasks === 'string') {
    const raw = typeof data === 'string' ? data : data.tasks;
    items = raw.split('\n').filter(Boolean).map((line) => {
      const [col, ...rest] = line.split(':');
      return { status: col?.trim(), title: rest.join(':').trim() || col?.trim() };
    });
  } else {
    items = Array.isArray(data) ? data : (data?.items || []);
  }
  const response = await api.post('/visualization/diagrams/kanban', {
    items,
    columns: options.columns || null,
    title: options.title || null,
  });
  return response.data;
}

export async function generateSequenceDiagram(data, options = {}) {
  // Backend expects { interactions: list[dict] }
  // Container passes { interactions: [...strings] }
  let interactions = Array.isArray(data) ? data : (data?.interactions || []);
  interactions = interactions.map((i) => {
    if (typeof i === 'string') {
      const match = i.match(/^(.+?)\s*->\s*(.+?):\s*(.+)$/);
      if (match) return { from: match[1].trim(), to: match[2].trim(), message: match[3].trim() };
      return { from: 'Actor', to: 'System', message: i };
    }
    return i;
  });
  const response = await api.post('/visualization/diagrams/sequence', {
    interactions,
    title: options.title || null,
  });
  return response.data;
}

export async function generateWordcloud(data, options = {}) {
  // Backend expects { text: string }
  // Container passes { text: "..." } or { frequencies: {...} }
  const text = typeof data === 'string'
    ? data
    : (data?.text || (data?.frequencies ? JSON.stringify(data.frequencies) : JSON.stringify(data)));
  const response = await api.post('/visualization/diagrams/wordcloud', {
    text,
    max_words: options.maxWords || 100,
    title: options.title || null,
  });
  return response.data;
}


export async function extractExcel(file) {
  const form = new FormData();
  form.append('file', file);
  const response = await api.post('/visualization/extract-excel', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}


export async function createBrandKit(data) {
  const response = await api.post('/design/brand-kits', data);
  return response.data;
}

export async function getBrandKit(brandKitId) {
  const response = await api.get(`/design/brand-kits/${brandKitId}`);
  return response.data;
}

export async function listBrandKits({ limit, offset } = {}) {
  const params = {};
  if (limit != null) params.limit = limit;
  if (offset != null) params.offset = offset;
  const response = await api.get('/design/brand-kits', { params });
  return asArray(response.data, ['brand_kits', 'kits', 'items', 'results']);
}

export async function updateBrandKit(brandKitId, data) {
  const response = await api.put(`/design/brand-kits/${brandKitId}`, data);
  return response.data;
}

export async function deleteBrandKit(brandKitId) {
  const response = await api.delete(`/design/brand-kits/${brandKitId}`);
  return response.data;
}

export async function setDefaultBrandKit(brandKitId) {
  const response = await api.post(`/design/brand-kits/${brandKitId}/set-default`);
  return response.data;
}

export async function applyBrandKit(brandKitId, documentId) {
  const response = await api.post(`/design/brand-kits/${brandKitId}/apply`, {
    document_id: documentId,
  });
  return response.data;
}


export async function createTheme(data) {
  const response = await api.post('/design/themes', data);
  return response.data;
}

export async function getTheme(themeId) {
  const response = await api.get(`/design/themes/${themeId}`);
  return response.data;
}

export async function listThemes({ limit, offset } = {}) {
  const params = {};
  if (limit != null) params.limit = limit;
  if (offset != null) params.offset = offset;
  const response = await api.get('/design/themes', { params });
  return asArray(response.data, ['themes', 'items', 'results']);
}

export async function updateTheme(themeId, data) {
  const response = await api.put(`/design/themes/${themeId}`, data);
  return response.data;
}

export async function deleteTheme(themeId) {
  const response = await api.delete(`/design/themes/${themeId}`);
  return response.data;
}

export async function setActiveTheme(themeId) {
  const response = await api.post(`/design/themes/${themeId}/activate`);
  return response.data;
}


export async function generateColorPalette(baseColor, harmonyType = 'complementary', count = 5) {
  const response = await api.post('/design/color-palette', {
    base_color: baseColor,
    harmony_type: harmonyType, // 'complementary', 'analogous', 'triadic', 'split-complementary', 'tetradic'
    count,
  });
  return response.data;
}

export async function getColorContrast(color1, color2) {
  const response = await api.post('/design/colors/contrast', {
    color1,
    color2,
  });
  return response.data;
}

export async function suggestAccessibleColors(backgroundColor) {
  const response = await api.post('/design/colors/accessible', {
    background_color: backgroundColor,
  });
  return response.data;
}


export async function listFonts() {
  const response = await api.get('/design/fonts');
  return asArray(response.data, ['fonts', 'items', 'results']);
}

export async function getFontPairings(primaryFont) {
  const response = await api.get('/design/fonts/pairings', {
    params: { primary: primaryFont },
  });
  return response.data;
}


export async function uploadLogo(file, brandKitId) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('brand_kit_id', brandKitId);

  const response = await api.post('/design/assets/logo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function listAssets(brandKitId) {
  const response = await api.get(`/design/brand-kits/${brandKitId}/assets`);
  return asArray(response.data, ['assets', 'items', 'results']);
}

export async function deleteAsset(assetId) {
  const response = await api.delete(`/design/assets/${assetId}`);
  return response.data;
}


export async function exportBrandKit(brandKitId, format = 'json') {
  const response = await api.get(`/design/brand-kits/${brandKitId}/export`, {
    params: { format },
  });
  return response.data;
}

export async function importBrandKit(data) {
  const response = await api.post('/design/brand-kits/import', data);
  return response.data;
}

