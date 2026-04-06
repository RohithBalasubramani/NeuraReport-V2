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


export async function createDocument(data) {
  const response = await api.post('/documents', data);
  return response.data;
}

export async function getDocument(documentId) {
  const response = await api.get(`/documents/${documentId}`);
  return response.data;
}

export async function updateDocument(documentId, data) {
  const response = await api.put(`/documents/${documentId}`, data);
  return response.data;
}

export async function deleteDocument(documentId) {
  const response = await api.delete(`/documents/${documentId}`);
  return response.data;
}

export async function listDocuments(params = {}) {
  const response = await api.get('/documents', { params });
  const payload = response.data;
  if (Array.isArray(payload)) {
    return { documents: payload, total: payload.length };
  }
  if (payload && typeof payload === 'object') {
    const documents = asArray(payload, ['documents', 'items', 'results']);
    return { ...payload, documents, total: payload.total ?? documents.length };
  }
  return { documents: [], total: 0 };
}


export async function restoreVersion(documentId, versionId) {
  const response = await api.post(`/documents/${documentId}/versions/${versionId}/restore`);
  return response.data;
}


export async function getComments(documentId) {
  const response = await api.get(`/documents/${documentId}/comments`);
  return response.data;
}

export async function addComment(documentId, data) {
  const response = await api.post(`/documents/${documentId}/comments`, data);
  return response.data;
}

export async function replyToComment(documentId, commentId, data) {
  const response = await api.post(`/documents/${documentId}/comments/${commentId}/reply`, data);
  return response.data;
}

export async function resolveComment(documentId, commentId, resolved = true) {
  const response = await api.patch(`/documents/${documentId}/comments/${commentId}/resolve`, { resolved });
  return response.data;
}

export async function deleteComment(documentId, commentId) {
  const response = await api.delete(`/documents/${documentId}/comments/${commentId}`);
  return response.data;
}


export async function checkGrammar(documentId, text, options = {}) {
  const response = await api.post(`/documents/${documentId}/ai/grammar`, { text, options });
  return response.data;
}

export async function summarize(documentId, text, length = 'medium', style = 'paragraph') {
  const response = await api.post(`/documents/${documentId}/ai/summarize`, {
    text,
    instruction: 'summarize',
    options: { length, style },
  });
  return response.data;
}

export async function rewrite(documentId, text, tone = 'professional', style = 'clear') {
  const response = await api.post(`/documents/${documentId}/ai/rewrite`, {
    text,
    instruction: 'rewrite',
    options: { tone, style },
  });
  return response.data;
}

export async function expand(documentId, text, targetLength = 'double') {
  const response = await api.post(`/documents/${documentId}/ai/expand`, {
    text,
    instruction: 'expand',
    options: { target_length: targetLength },
  });
  return response.data;
}

export async function translate(documentId, text, targetLanguage, preserveFormatting = true) {
  const response = await api.post(`/documents/${documentId}/ai/translate`, {
    text,
    instruction: 'translate',
    options: { target_language: targetLanguage, preserve_formatting: preserveFormatting },
  });
  return response.data;
}

export async function adjustTone(documentId, text, targetTone) {
  const response = await api.post(`/documents/${documentId}/ai/tone`, { text, target_tone: targetTone });
  return response.data;
}


export async function listTemplates(params = {}) {
  const response = await api.get('/documents/templates', { params });
  const payload = response.data;
  if (Array.isArray(payload)) {
    return { templates: payload, total: payload.length };
  }
  if (payload && typeof payload === 'object') {
    const templates = asArray(payload, ['templates', 'items', 'results']);
    return { ...payload, templates, total: payload.total ?? templates.length };
  }
  return { templates: [], total: 0 };
}

export async function createFromTemplate(templateId, name) {
  const response = await api.post(`/documents/templates/${templateId}/create`, { name });
  return response.data;
}

export async function saveAsTemplate(documentId, name) {
  const response = await api.post(`/documents/${documentId}/save-as-template`, { name });
  return response.data;
}


export async function generateEmbedToken(documentId, options = {}) {
  const response = await api.post(`/export/distribution/embed/${documentId}`, {
    document_id: documentId,
    width: options.width || 800,
    height: options.height || 600,
    allow_download: options.allowDownload || false,
    allow_print: options.allowPrint || false,
    show_toolbar: options.showToolbar !== false,
    theme: options.theme || 'light',
  });
  return response.data;
}

function parseA1Range(range) {
  if (!range || typeof range !== 'string') return null;
  const [start, end] = range.split(':');
  const parseCell = (cell) => {
    if (!cell) return null;
    const m = String(cell).trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!m) return null;
    const [, letters, rowStr] = m;
    let col = 0;
    for (let i = 0; i < letters.length; i += 1) {
      col = col * 26 + (letters.charCodeAt(i) - 64);
    }
    return { row: Number(rowStr) - 1, col: col - 1 };
  };
  const s = parseCell(start);
  const e = parseCell(end || start);
  if (!s || !e) return null;
  return {
    start_row: Math.max(0, Math.min(s.row, e.row)),
    end_row: Math.max(0, Math.max(s.row, e.row)),
    start_col: Math.max(0, Math.min(s.col, e.col)),
    end_col: Math.max(0, Math.max(s.col, e.col)),
  };
}

function indexToColumnLabel(index) {
  let col = Number(index) + 1;
  let label = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    col = Math.floor((col - 1) / 26);
  }
  return label;
}

function matrixToCellMap(matrix) {
  if (!Array.isArray(matrix)) return {};
  const cellMap = {};
  matrix.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) return;
    row.forEach((rawValue, colIndex) => {
      if (rawValue == null || rawValue === '') return;
      const cellRef = `${indexToColumnLabel(colIndex)}${rowIndex + 1}`;
      const isFormula = typeof rawValue === 'string' && rawValue.startsWith('=');
      cellMap[cellRef] = {
        value: isFormula ? '' : rawValue,
        formula: isFormula ? rawValue : null,
      };
    });
  });
  return cellMap;
}

function normalizeSheetPayload(detail, fallback = {}) {
  const index = fallback.index ?? 0;
  const rawData = Array.isArray(detail?.data) ? detail.data : [];
  return {
    id: detail?.sheet_id || fallback.id || `sheet-${index}`,
    name: detail?.sheet_name || fallback.name || `Sheet ${index + 1}`,
    index,
    row_count: rawData.length,
    col_count: rawData[0]?.length || 0,
    data: matrixToCellMap(rawData),
    raw_data: rawData,
    formats: detail?.formats || {},
    column_widths: detail?.column_widths || {},
    row_heights: detail?.row_heights || {},
    frozen_rows: detail?.frozen_rows ?? 0,
    frozen_cols: detail?.frozen_cols ?? 0,
    conditional_formats: Array.isArray(detail?.conditional_formats) ? detail.conditional_formats : [],
    data_validations: Array.isArray(detail?.data_validations) ? detail.data_validations : [],
  };
}

function normalizeSpreadsheetPayload(payload, sheetFallbacks = []) {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload.sheets)) {
    return payload;
  }
  const base = {
    id: payload.id,
    name: payload.name,
  };
  const fallback = sheetFallbacks[0] || { index: 0 };
  return {
    ...base,
    sheets: [normalizeSheetPayload(payload, fallback)],
  };
}

function parseCellRef(cellRef) {
  if (typeof cellRef !== 'string') return null;
  const match = cellRef.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const [, letters, rowStr] = match;
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { row: Number(rowStr) - 1, col: col - 1 };
}


export async function createSpreadsheet(data) {
  const response = await api.post('/spreadsheets', data);
  return response.data;
}

export async function getSpreadsheet(spreadsheetId) {
  const firstResponse = await api.get(`/spreadsheets/${spreadsheetId}`);
  const firstPayload = firstResponse.data;

  if (firstPayload && typeof firstPayload === 'object' && Array.isArray(firstPayload.sheets)) {
    return firstPayload;
  }

  let sheetFallbacks = [{ index: 0 }];
  try {
    const listResponse = await api.get('/spreadsheets', { params: { limit: 500, offset: 0 } });
    const listPayload = listResponse.data;
    const spreadsheets = asArray(listPayload, ['spreadsheets', 'items', 'results']);
    const matched = spreadsheets.find((item) => item?.id === spreadsheetId);
    if (Array.isArray(matched?.sheets) && matched.sheets.length > 0) {
      sheetFallbacks = matched.sheets
        .map((sheet, idx) => ({
          id: sheet?.id,
          name: sheet?.name,
          index: typeof sheet?.index === 'number' ? sheet.index : idx,
        }))
        .sort((a, b) => a.index - b.index);
    }
  } catch {
    // Fallback to a single-sheet projection if metadata lookup fails.
  }

  if (sheetFallbacks.length <= 1) {
    return normalizeSpreadsheetPayload(firstPayload, sheetFallbacks);
  }

  const detailsByIndex = new Map();
  detailsByIndex.set(0, firstPayload);

  const pendingIndexes = sheetFallbacks
    .map((sheet) => sheet.index)
    .filter((index) => index !== 0);

  await Promise.all(
    pendingIndexes.map(async (sheetIndex) => {
      try {
        const detailResponse = await api.get(`/spreadsheets/${spreadsheetId}`, {
          params: { sheet_index: sheetIndex },
        });
        detailsByIndex.set(sheetIndex, detailResponse.data);
      } catch {
        // Keep missing sheets out of the normalized response.
      }
    })
  );

  const sheets = sheetFallbacks
    .map((fallback) => normalizeSheetPayload(detailsByIndex.get(fallback.index), fallback))
    .filter((sheet) => sheet && sheet.id);

  return {
    id: firstPayload?.id || spreadsheetId,
    name: firstPayload?.name || 'Spreadsheet',
    sheets: sheets.length ? sheets : [normalizeSheetPayload(firstPayload, { index: 0 })],
  };
}

export async function updateSpreadsheet(spreadsheetId, data) {
  const response = await api.put(`/spreadsheets/${spreadsheetId}`, data);
  return response.data;
}

export async function deleteSpreadsheet(spreadsheetId) {
  const response = await api.delete(`/spreadsheets/${spreadsheetId}`);
  return response.data;
}

export async function updateCells(spreadsheetId, sheetIndex, updates) {
  const normalizedUpdates = Array.isArray(updates)
    ? updates
    : Object.entries(updates || {}).map(([cellRef, payload]) => {
        const position = parseCellRef(cellRef);
        if (!position) return null;
        const value = payload?.formula || payload?.value || '';
        return { row: position.row, col: position.col, value };
      }).filter(Boolean);

  const response = await api.put(`/spreadsheets/${spreadsheetId}/cells`, { updates: normalizedUpdates }, {
    params: { sheet_index: sheetIndex },
  });
  return response.data;
}

export async function addSheet(spreadsheetId, name) {
  const response = await api.post(`/spreadsheets/${spreadsheetId}/sheets`, { name });
  return response.data;
}

export async function deleteSheet(spreadsheetId, sheetIndex) {
  const response = await api.delete(`/spreadsheets/${spreadsheetId}/sheets/${sheetIndex}`);
  return response.data;
}

export async function renameSheet(spreadsheetId, sheetId, newName) {
  const response = await api.put(`/spreadsheets/${spreadsheetId}/sheets/${sheetId}/rename`, null, {
    params: { name: newName },
  });
  return response.data;
}

export async function createPivotTable(spreadsheetId, config) {
  const response = await api.post(`/spreadsheets/${spreadsheetId}/pivot`, config);
  return response.data;
}

export async function importCsv(file, options = {}) {
  const formData = new FormData();
  formData.append('file', file);
  Object.entries(options).forEach(([key, value]) => {
    formData.append(key, value);
  });
  const response = await api.post('/spreadsheets/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function importExcel(file, options = {}) {
  const formData = new FormData();
  formData.append('file', file);
  Object.entries(options).forEach(([key, value]) => {
    formData.append(key, value);
  });
  const response = await api.post('/spreadsheets/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function exportSpreadsheet(spreadsheetId, format) {
  const response = await api.get(`/spreadsheets/${spreadsheetId}/export`, {
    params: { format },
    responseType: 'blob',
  });
  return response.data;
}


export async function generateFormula(spreadsheetId, description, options = {}) {
  const response = await api.post(`/spreadsheets/${spreadsheetId}/ai/formula`, {
    description,
    available_columns: options.availableColumns || [],
    sheet_context: options.context || null,
  });
  return response.data;
}

export async function detectAnomalies(spreadsheetId, column, options = {}) {
  const response = await api.post(`/spreadsheets/${spreadsheetId}/ai/anomalies`, null, {
    params: {
      column,
      sheet_index: options.sheetIndex || 0,
      sensitivity: options.sensitivity || 'medium',
    },
  });
  return response.data;
}

function normalizeAnalyzeArgs(input, maybeOptions = {}) {
  if (input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'data')) {
    return {
      data: input.data,
      columnDescriptions: input.columnDescriptions,
      maxSuggestions: input.maxSuggestions ?? 3,
    };
  }
  return {
    data: input,
    columnDescriptions: maybeOptions.columnDescriptions,
    maxSuggestions: maybeOptions.maxSuggestions ?? 3,
  };
}

function normalizeGenerateArgs(input, maybeChartType, maybeOptions = {}) {
  if (input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'data')) {
    return {
      data: input.data,
      chartType: input.chartType,
      xField: input.xField,
      yFields: input.yFields,
      title: input.title,
    };
  }
  return {
    data: input,
    chartType: maybeChartType,
    xField: maybeOptions.xField,
    yFields: maybeOptions.yFields,
    title: maybeOptions.title,
  };
}

async function analyzeData(data) { return {} }
async function queueAnalyzeData() { return {} }
async function generateChart() { return {} }
async function queueGenerateChart() { return {} }

export default {
  analyzeData,
  queueAnalyzeData,
  generateChart,
  queueGenerateChart,
};
