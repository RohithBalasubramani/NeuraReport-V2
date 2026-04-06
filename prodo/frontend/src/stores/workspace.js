import * as workflowsApi from '../api/workspace';import * as knowledgeApi from '../api/workspace';import * as connectorsApi from '../api/workspace';import * as ingestionApi from '../api/workspace';import * as federationApi from '../api/workspace';import * as visualizationApi from '../api/workspace';import * as nl2sqlApi from '../api/intelligence'
import * as dashboardsApi from '../api/workspace';import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ---- Store action helpers to eliminate repetitive try/catch/set patterns ----

const asyncAction = (set, apiFn, { loadingKey = 'loading', onSuccess, onError, errorReturn = null } = {}) =>
  async (...args) => {
    set({ [loadingKey]: true, error: null });
    try {
      const result = await apiFn(...args);
      const updates = onSuccess ? onSuccess(result) : {};
      set({ ...updates, [loadingKey]: false });
      return result;
    } catch (err) {
      set({ error: err.message, [loadingKey]: false });
      return typeof onError === 'function' ? onError(err) : errorReturn;
    }
  };

const simpleAction = (set, apiFn, { onSuccess, errorReturn = null } = {}) =>
  async (...args) => {
    try {
      const result = await apiFn(...args);
      if (onSuccess) set(onSuccess(result));
      return result;
    } catch (err) {
      set({ error: err.message });
      return errorReturn;
    }
  };

// CRUD helper for stores with list + current item pattern
const crudActions = (set, get, api, { listKey, currentKey, idField = 'id', maxItems = 200 } = {}) => ({
  [`fetch${listKey[0].toUpperCase()}${listKey.slice(1)}`]: async (params = {}) => {
    set({ loading: true, error: null });
    try {
      const response = await api[`list${listKey[0].toUpperCase()}${listKey.slice(1)}`](params);
      set({ [listKey]: response[listKey] || response || [], loading: false });
      return response;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },
});


export const useWorkflowStore = create((set, get) => ({
  workflows: [],
  currentWorkflow: null,
  executions: [],
  currentExecution: null,
  nodeTypes: [],
  pendingApprovals: [],
  loading: false,
  executing: false,
  error: null,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  fetchWorkflows: asyncAction(set, (params = {}) => workflowsApi.listWorkflows(params), {
    onSuccess: (r) => ({ workflows: r.workflows || [] }),
  }),
  createWorkflow: asyncAction(set, (data) => workflowsApi.createWorkflow(data), {
    onSuccess: (workflow) => (state) => ({
      workflows: [workflow, ...state.workflows].slice(0, 200),
      currentWorkflow: workflow,
    }),
  }),
  getWorkflow: asyncAction(set, (id) => workflowsApi.getWorkflow(id), {
    onSuccess: (workflow) => ({ currentWorkflow: workflow }),
  }),
  updateWorkflow: asyncAction(set, (id, data) => workflowsApi.updateWorkflow(id, data), {
    onSuccess: (workflow) => (state) => ({
      workflows: state.workflows.map((w) => (w.id === workflow.id ? workflow : w)),
      currentWorkflow: state.currentWorkflow?.id === workflow.id ? workflow : state.currentWorkflow,
    }),
  }),
  deleteWorkflow: asyncAction(set, (id) => workflowsApi.deleteWorkflow(id), {
    onSuccess: () => (state) => ({
      workflows: state.workflows.filter((w) => w.id !== arguments[0]),
    }),
    errorReturn: false,
  }),

  executeWorkflow: async (workflowId, inputs = {}) => {
    set({ executing: true, error: null });
    try {
      const execution = await workflowsApi.executeWorkflow(workflowId, inputs);
      set((state) => ({
        executions: [execution, ...state.executions].slice(0, 200),
        currentExecution: execution,
        executing: false,
      }));
      return execution;
    } catch (err) {
      set({ error: err.message, executing: false });
      return null;
    }
  },

  fetchExecutions: asyncAction(set, (wfId, params = {}) => workflowsApi.listExecutions(wfId, params), {
    onSuccess: (r) => ({ executions: r.executions || [] }),
  }),
  getExecution: asyncAction(set, (wfId, exId) => workflowsApi.getExecution(wfId, exId), {
    onSuccess: (execution) => ({ currentExecution: execution }),
  }),

  cancelExecution: async (workflowId, executionId) => {
    try {
      await workflowsApi.cancelExecution(workflowId, executionId);
      set((state) => ({
        executions: state.executions.map((e) => e.id === executionId ? { ...e, status: 'cancelled' } : e),
        currentExecution: state.currentExecution?.id === executionId
          ? { ...state.currentExecution, status: 'cancelled' } : state.currentExecution,
      }));
      return true;
    } catch (err) { set({ error: err.message }); return false; }
  },

  retryExecution: async (workflowId, executionId) => {
    set({ executing: true, error: null });
    try {
      const execution = await workflowsApi.retryExecution(workflowId, executionId);
      set((state) => ({
        executions: state.executions.map((e) => (e.id === executionId ? execution : e)),
        currentExecution: state.currentExecution?.id === executionId ? execution : state.currentExecution,
        executing: false,
      }));
      return execution;
    } catch (err) { set({ error: err.message, executing: false }); return null; }
  },

  // Triggers
  addTrigger: async (workflowId, trigger) => {
    set({ loading: true, error: null });
    try {
      const result = await workflowsApi.addTrigger(workflowId, trigger);
      await get().getWorkflow(workflowId);
      set({ loading: false });
      return result;
    } catch (err) { set({ error: err.message, loading: false }); return null; }
  },
  deleteTrigger: async (workflowId, triggerId) => {
    set({ loading: true, error: null });
    try {
      await workflowsApi.deleteTrigger(workflowId, triggerId);
      await get().getWorkflow(workflowId);
      set({ loading: false });
      return true;
    } catch (err) { set({ error: err.message, loading: false }); return false; }
  },
  enableTrigger: simpleAction(set, (wfId, tId) => workflowsApi.enableTrigger(wfId, tId).then(() => get().getWorkflow(wfId)), { errorReturn: false }),
  disableTrigger: simpleAction(set, (wfId, tId) => workflowsApi.disableTrigger(wfId, tId).then(() => get().getWorkflow(wfId)), { errorReturn: false }),
  updateTrigger: async (workflowId, triggerId, data) => {
    set({ loading: true, error: null });
    try {
      const result = await workflowsApi.updateTrigger(workflowId, triggerId, data);
      await get().getWorkflow(workflowId);
      set({ loading: false });
      return result;
    } catch (err) { set({ error: err.message, loading: false }); return null; }
  },

  fetchNodeTypes: simpleAction(set, () => workflowsApi.listNodeTypes(), {
    onSuccess: (types) => ({ nodeTypes: types || [] }),
    errorReturn: [],
  }),
  getNodeTypeSchema: simpleAction(set, (nodeType) => workflowsApi.getNodeTypeSchema(nodeType)),

  fetchPendingApprovals: asyncAction(set, (params = {}) => workflowsApi.getPendingApprovals(params), {
    onSuccess: (r) => ({ pendingApprovals: r.approvals || [] }),
  }),

  approveStep: async (executionId, stepId, comment = null) => {
    set({ loading: true, error: null });
    try {
      const result = await workflowsApi.approveStep(executionId, stepId, comment);
      set((state) => ({
        pendingApprovals: state.pendingApprovals.filter(
          (a) => !(a.execution_id === executionId && a.step_id === stepId)),
        loading: false,
      }));
      return result;
    } catch (err) { set({ error: err.message, loading: false }); return null; }
  },

  rejectStep: async (executionId, stepId, reason) => {
    set({ loading: true, error: null });
    try {
      const result = await workflowsApi.rejectStep(executionId, stepId, reason);
      set((state) => ({
        pendingApprovals: state.pendingApprovals.filter(
          (a) => !(a.execution_id === executionId && a.step_id === stepId)),
        loading: false,
      }));
      return result;
    } catch (err) { set({ error: err.message, loading: false }); return null; }
  },

  createFromTemplate: asyncAction(set, (tplId, name) => workflowsApi.workflowCreateFromTemplate(tplId, name), {
    onSuccess: (workflow) => (state) => ({
      workflows: [workflow, ...state.workflows].slice(0, 200),
      currentWorkflow: workflow,
    }),
  }),
  saveAsTemplate: simpleAction(set, (wfId, name, desc = null) => workflowsApi.workflowSaveAsTemplate(wfId, name, desc)),
  listWorkflowTemplates: asyncAction(set, () => workflowsApi.listWorkflowTemplates(), { errorReturn: [] }),

  createWebhook: asyncAction(set, (wfId, data) => workflowsApi.createWebhook(wfId, data)),
  listWebhooks: simpleAction(set, (wfId) => workflowsApi.listWebhooks(wfId), { errorReturn: [] }),
  deleteWebhook: asyncAction(set, (wfId, whId) => workflowsApi.deleteWebhook(wfId, whId), { errorReturn: false }),
  regenerateWebhookSecret: simpleAction(set, (wfId, whId) => workflowsApi.regenerateWebhookSecret(wfId, whId)),
  getExecutionLogs: simpleAction(set, (wfId, exId) => workflowsApi.getExecutionLogs(wfId, exId), { errorReturn: [] }),
  debugWorkflow: simpleAction(set, (wfId, nodeId, testData) => workflowsApi.debugWorkflow(wfId, nodeId, testData)),

  reset: () => set({ currentWorkflow: null, executions: [], currentExecution: null, error: null }),
  clearWorkflows: () => set({ workflows: [], currentWorkflow: null, executions: [] }),
}));


const normalizeSearchResults = (response) => {
  const rows = Array.isArray(response?.results) ? response.results : [];
  return rows.map((row) => {
    const doc = row?.document && typeof row.document === 'object' ? row.document : row;
    if (!doc || typeof doc !== 'object') return null;
    return { ...doc, _score: row?.score, _highlights: Array.isArray(row?.highlights) ? row.highlights : [] };
  }).filter(Boolean);
};

const normalizeRelatedDocuments = (response) =>
  (Array.isArray(response?.related) ? response.related : [])
    .map((row) => row?.document).filter((doc) => doc && typeof doc === 'object');

const normalizeFaq = (response) => {
  if (Array.isArray(response?.faq?.items)) return response.faq.items;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.faq)) return response.faq;
  return [];
};

export const useKnowledgeStore = create((set, get) => ({
  documents: [], collections: [], tags: [],
  currentDocument: null, currentCollection: null,
  searchResults: [], relatedDocuments: [],
  knowledgeGraph: null, faq: [], stats: null, totalDocuments: 0,
  loading: false, searching: false, error: null,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  addDocument: asyncAction(set, (data) => knowledgeApi.addDocument(data), {
    onSuccess: (doc) => (state) => ({
      documents: [doc, ...state.documents].slice(0, 500), currentDocument: doc,
    }),
  }),
  fetchDocuments: asyncAction(set, (opts = {}) => knowledgeApi.listDocuments(opts), {
    onSuccess: (r) => ({ documents: r.documents || [], totalDocuments: r.total || 0 }),
  }),
  getDocument: asyncAction(set, (id) => knowledgeApi.getDocument(id), {
    onSuccess: (doc) => ({ currentDocument: doc }),
  }),
  updateDocument: asyncAction(set, (id, data) => knowledgeApi.updateDocument(id, data), {
    onSuccess: (doc) => (state) => ({
      documents: state.documents.map((d) => (d.id === doc.id ? doc : d)),
      currentDocument: state.currentDocument?.id === doc.id ? doc : state.currentDocument,
    }),
  }),
  deleteDocument: asyncAction(set, (id) => knowledgeApi.deleteDocument(id), {
    onSuccess: () => (state) => ({
      documents: state.documents.filter((d) => d.id !== arguments[0]),
      currentDocument: state.currentDocument?.id === arguments[0] ? null : state.currentDocument,
    }),
    errorReturn: false,
  }),
  toggleFavorite: simpleAction(set, (docId) => knowledgeApi.toggleFavorite(docId), {
    onSuccess: (result) => (state) => ({
      documents: state.documents.map((d) =>
        d.id === result.document_id || d.id === arguments[0] ? { ...d, is_favorite: result.is_favorite } : d),
      currentDocument: state.currentDocument?.id === (result.document_id || arguments[0])
        ? { ...state.currentDocument, is_favorite: result.is_favorite } : state.currentDocument,
    }),
  }),

  createCollection: asyncAction(set, (data) => knowledgeApi.createCollection(data), {
    onSuccess: (collection) => (state) => ({
      collections: [collection, ...state.collections].slice(0, 200), currentCollection: collection,
    }),
  }),
  fetchCollections: asyncAction(set, () => knowledgeApi.listCollections(), {
    onSuccess: (collections) => ({ collections: collections || [] }),
    errorReturn: [],
  }),
  getCollection: asyncAction(set, (id) => knowledgeApi.getCollection(id), {
    onSuccess: (collection) => ({ currentCollection: collection }),
  }),
  updateCollection: asyncAction(set, (id, data) => knowledgeApi.updateCollection(id, data), {
    onSuccess: (collection) => (state) => ({
      collections: state.collections.map((c) => (c.id === collection.id ? collection : c)),
      currentCollection: state.currentCollection?.id === collection.id ? collection : state.currentCollection,
    }),
  }),
  deleteCollection: asyncAction(set, (id) => knowledgeApi.deleteCollection(id), {
    onSuccess: () => (state) => ({
      collections: state.collections.filter((c) => c.id !== arguments[0]),
      currentCollection: state.currentCollection?.id === arguments[0] ? null : state.currentCollection,
    }),
    errorReturn: false,
  }),
  addDocumentToCollection: async (collectionId, documentId) => {
    try { await knowledgeApi.addDocumentToCollection(collectionId, documentId); await get().getCollection(collectionId); return true; }
    catch (err) { set({ error: err.message }); return false; }
  },
  removeDocumentFromCollection: async (collectionId, documentId) => {
    try { await knowledgeApi.removeDocumentFromCollection(collectionId, documentId); await get().getCollection(collectionId); return true; }
    catch (err) { set({ error: err.message }); return false; }
  },

  createTag: asyncAction(set, (name, color = null) => knowledgeApi.createTag(name, color), {
    onSuccess: (tag) => (state) => ({ tags: [tag, ...state.tags].slice(0, 500) }),
  }),
  fetchTags: simpleAction(set, () => knowledgeApi.listTags(), {
    onSuccess: (tags) => ({ tags: tags || [] }),
    errorReturn: [],
  }),
  deleteTag: simpleAction(set, (tagId) => knowledgeApi.deleteTag(tagId).then(() => tagId), {
    onSuccess: (tagId) => (state) => ({ tags: state.tags.filter((t) => t.id !== tagId) }),
    errorReturn: false,
  }),
  addTagToDocument: async (documentId, tagId) => {
    try { await knowledgeApi.addTagToDocument(documentId, tagId); await get().getDocument(documentId); return true; }
    catch (err) { set({ error: err.message }); return false; }
  },
  removeTagFromDocument: async (documentId, tagId) => {
    try { await knowledgeApi.removeTagFromDocument(documentId, tagId); await get().getDocument(documentId); return true; }
    catch (err) { set({ error: err.message }); return false; }
  },
  getDocumentActivity: simpleAction(set, (docId) => knowledgeApi.getDocumentActivity(docId)),

  searchDocuments: async (query, options = {}) => {
    set({ searching: true, error: null });
    try {
      const response = await knowledgeApi.searchDocuments(query, options);
      set({ searchResults: normalizeSearchResults(response), searching: false });
      return response;
    } catch (err) { set({ error: err.message, searching: false }); return null; }
  },
  semanticSearch: async (query, options = {}) => {
    set({ searching: true, error: null });
    try {
      const response = await knowledgeApi.semanticSearch(query, options);
      set({ searchResults: normalizeSearchResults(response), searching: false });
      return response;
    } catch (err) { set({ error: err.message, searching: false }); return null; }
  },

  autoTag: asyncAction(set, async (docId) => { const r = await knowledgeApi.autoTag(docId); await get().getDocument(docId); return r; }),
  findRelated: asyncAction(set, (docId, opts = {}) => knowledgeApi.findRelated(docId, opts), {
    onSuccess: (related) => ({ relatedDocuments: normalizeRelatedDocuments(related) }),
    errorReturn: [],
  }),
  buildKnowledgeGraph: asyncAction(set, (opts = {}) => knowledgeApi.buildKnowledgeGraph(opts), {
    onSuccess: (graph) => ({ knowledgeGraph: graph }),
  }),
  generateFaq: asyncAction(set, (opts = {}) => knowledgeApi.generateFaq(opts), {
    onSuccess: (response) => ({ faq: normalizeFaq(response) }),
    errorReturn: [],
  }),
  fetchStats: simpleAction(set, () => knowledgeApi.getLibraryStats(), {
    onSuccess: (stats) => ({ stats }),
  }),

  clearSearchResults: () => set({ searchResults: [] }),
  reset: () => set({ currentDocument: null, currentCollection: null, searchResults: [], relatedDocuments: [], error: null }),
}));


export const useConnectorStore = create((set, get) => ({
  connectorTypes: [], connections: [], currentConnection: null,
  schema: null, queryResult: null, files: [],
  loading: false, testing: false, querying: false, error: null,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  fetchConnectorTypes: asyncAction(set, () => connectorsApi.listConnectorTypes(), {
    onSuccess: (types) => ({ connectorTypes: types || [] }),
    errorReturn: [],
  }),
  getConnectorsByCategory: simpleAction(set, (cat) => connectorsApi.listConnectorsByCategory(cat), { errorReturn: [] }),

  testConnection: async (connectorType, config) => {
    set({ testing: true, error: null });
    try {
      const result = await connectorsApi.testConnection(connectorType, config);
      set({ testing: false });
      return result;
    } catch (err) { set({ error: err.message, testing: false }); return { success: false, error: err.message }; }
  },

  createConnection: asyncAction(set, (type, name, config) => connectorsApi.createConnection(type, name, config), {
    onSuccess: (conn) => (state) => ({
      connections: [conn, ...state.connections].slice(0, 200), currentConnection: conn,
    }),
  }),
  fetchConnections: asyncAction(set, (params = {}) => connectorsApi.listConnections(params), {
    onSuccess: (r) => ({ connections: r.connections || [] }),
  }),
  getConnection: asyncAction(set, (id) => connectorsApi.getConnection(id), {
    onSuccess: (conn) => ({ currentConnection: conn }),
  }),
  deleteConnection: asyncAction(set, (id) => connectorsApi.deleteConnection(id).then(() => id), {
    onSuccess: (id) => (state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      currentConnection: state.currentConnection?.id === id ? null : state.currentConnection,
    }),
    errorReturn: false,
  }),

  checkHealth: async (connectionId) => {
    set({ testing: true, error: null });
    try {
      const result = await connectorsApi.checkConnectionHealth(connectionId);
      set((state) => ({
        connections: state.connections.map((c) =>
          c.id === connectionId ? { ...c, status: result.success ? 'connected' : 'error' } : c),
        testing: false,
      }));
      return result;
    } catch (err) { set({ error: err.message, testing: false }); return { success: false, error: err.message }; }
  },

  fetchSchema: asyncAction(set, (id) => connectorsApi.getConnectionSchema(id), {
    onSuccess: (schema) => ({ schema }),
  }),

  executeQuery: async (connectionId, query, parameters = null, limit = 1000) => {
    set({ querying: true, error: null, queryResult: null });
    try {
      const result = await connectorsApi.executeQuery(connectionId, query, parameters, limit);
      set({ queryResult: result, querying: false });
      return result;
    } catch (err) { set({ error: err.message, querying: false }); return null; }
  },
  clearQueryResult: () => set({ queryResult: null }),

  getOAuthUrl: simpleAction(set, (type, redir, state = null) => connectorsApi.getOAuthUrl(type, redir, state)),
  handleOAuthCallback: asyncAction(set, (type, code, redir, state = null) => connectorsApi.handleOAuthCallback(type, code, redir, state)),

  listFiles: asyncAction(set, (connId, path = '/') => connectorsApi.listFiles(connId, path), {
    onSuccess: (r) => ({ files: r.files || [] }),
    errorReturn: [],
  }),
  downloadFile: simpleAction(set, (connId, path) => connectorsApi.downloadFile(connId, path)),
  uploadFile: async (connectionId, file, destinationPath) => {
    set({ loading: true, error: null });
    try {
      const result = await connectorsApi.uploadFile(connectionId, file, destinationPath);
      await get().listFiles(connectionId, destinationPath.substring(0, destinationPath.lastIndexOf('/')));
      set({ loading: false });
      return result;
    } catch (err) { set({ error: err.message, loading: false }); return null; }
  },

  syncConnection: asyncAction(set, (id, opts = {}) => connectorsApi.syncConnection(id, opts)),
  getSyncStatus: simpleAction(set, (id) => connectorsApi.getSyncStatus(id)),
  getConnectorType: simpleAction(set, (type) => connectorsApi.getConnectorType(type)),
  scheduleSyncJob: asyncAction(set, (id, schedule) => connectorsApi.scheduleSyncJob(id, schedule)),

  reset: () => set({ currentConnection: null, schema: null, queryResult: null, files: [], error: null }),
  clearConnections: () => set({ connections: [], currentConnection: null }),
}));


export const useIngestionStore = create((set, get) => ({
  uploads: [], watchers: [], transcriptionJobs: [], imapAccounts: [],
  currentUpload: null, uploadProgress: {},
  loading: false, uploading: false, error: null,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  uploadFile: async (file, options = {}) => {
    const fileId = crypto.randomUUID();
    set((state) => ({ uploading: true, error: null, uploadProgress: { ...state.uploadProgress, [fileId]: 0 } }));
    try {
      const result = await ingestionApi.ingestionUploadFile(file, {
        ...options,
        onProgress: (event) => {
          const progress = Math.round((event.loaded * 100) / event.total);
          set((state) => ({ uploadProgress: { ...state.uploadProgress, [fileId]: progress } }));
        },
      });
      set((state) => ({ uploads: [result, ...state.uploads], currentUpload: result, uploading: false }));
      return result;
    } catch (err) { set({ error: err.message, uploading: false }); return null; }
  },

  uploadBulk: async (files, options = {}) => {
    set({ uploading: true, error: null });
    try {
      const results = await ingestionApi.uploadBulk(files, options);
      set((state) => ({ uploads: [...results, ...state.uploads], uploading: false }));
      return results;
    } catch (err) { set({ error: err.message, uploading: false }); return []; }
  },

  uploadZip: async (file, options = {}) => {
    set({ uploading: true, error: null });
    try {
      const result = await ingestionApi.uploadZip(file, options);
      set((state) => ({ uploads: [result, ...state.uploads], currentUpload: result, uploading: false }));
      return result;
    } catch (err) { set({ error: err.message, uploading: false }); return null; }
  },

  importFromUrl: asyncAction(set, (url, opts = {}) => ingestionApi.importFromUrl(url, opts), {
    onSuccess: (result) => (state) => ({ uploads: [result, ...state.uploads], currentUpload: result }),
  }),
  importStructuredData: asyncAction(set, (data, format, opts = {}) => ingestionApi.importStructuredData(data, format, opts)),
  clipUrl: asyncAction(set, (url, opts = {}) => ingestionApi.clipUrl(url, opts)),
  clipSelection: asyncAction(set, (content, sourceUrl, opts = {}) => ingestionApi.clipSelection(content, sourceUrl, opts)),

  createWatcher: asyncAction(set, (folderPath, opts = {}) => ingestionApi.createWatcher(folderPath, opts), {
    onSuccess: (watcher) => (state) => ({ watchers: [watcher, ...state.watchers] }),
  }),
  fetchWatchers: asyncAction(set, () => ingestionApi.listWatchers(), {
    onSuccess: (watchers) => ({ watchers: watchers || [] }),
    errorReturn: [],
  }),
  getWatcher: asyncAction(set, (id) => ingestionApi.getWatcher(id)),

  startWatcher: simpleAction(set, async (watcherId) => {
    await ingestionApi.startWatcher(watcherId);
    return watcherId;
  }, {
    onSuccess: (watcherId) => (state) => ({
      watchers: state.watchers.map((w) => w.id === watcherId ? { ...w, status: 'running' } : w),
    }),
    errorReturn: false,
  }),
  stopWatcher: simpleAction(set, async (watcherId) => {
    await ingestionApi.stopWatcher(watcherId);
    return watcherId;
  }, {
    onSuccess: (watcherId) => (state) => ({
      watchers: state.watchers.map((w) => w.id === watcherId ? { ...w, status: 'stopped' } : w),
    }),
    errorReturn: false,
  }),
  deleteWatcher: asyncAction(set, (id) => ingestionApi.deleteWatcher(id).then(() => id), {
    onSuccess: (id) => (state) => ({ watchers: state.watchers.filter((w) => w.id !== id) }),
    errorReturn: false,
  }),
  scanFolder: asyncAction(set, (id) => ingestionApi.scanFolder(id)),

  transcribeFile: async (file, options = {}) => {
    set({ uploading: true, error: null });
    try {
      const job = await ingestionApi.transcribeFile(file, options);
      set((state) => ({ transcriptionJobs: [job, ...state.transcriptionJobs], uploading: false }));
      return job;
    } catch (err) { set({ error: err.message, uploading: false }); return null; }
  },
  getTranscriptionStatus: simpleAction(set, (jobId) => ingestionApi.getTranscriptionStatus(jobId), {
    onSuccess: (status) => (state) => ({
      transcriptionJobs: state.transcriptionJobs.map((j) => j.id === status.id ? { ...j, ...status } : j),
    }),
  }),

  connectImapAccount: asyncAction(set, (config) => ingestionApi.connectImapAccount(config), {
    onSuccess: (account) => (state) => ({ imapAccounts: [account, ...state.imapAccounts] }),
  }),
  fetchImapAccounts: asyncAction(set, () => ingestionApi.listImapAccounts(), {
    onSuccess: (accounts) => ({ imapAccounts: accounts || [] }),
    errorReturn: [],
  }),
  syncImapAccount: asyncAction(set, (accountId, opts = {}) => ingestionApi.syncImapAccount(accountId, opts)),
  parseEmail: asyncAction(set, (emailData, opts = {}) => ingestionApi.parseEmail(emailData, opts)),

  clearUploads: () => set({ uploads: [], currentUpload: null, uploadProgress: {} }),
  reset: () => set({ currentUpload: null, uploadProgress: {}, error: null }),
}));


export const useFederationStore = create((set, get) => ({
  schemas: [], currentSchema: null, joinSuggestions: [],
  queryResult: null, loading: false, error: null,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  fetchSchemas: asyncAction(set, () => federationApi.listVirtualSchemas(), {
    onSuccess: (r) => ({ schemas: r.schemas || [] }),
  }),
  createSchema: asyncAction(set, (data) => federationApi.createVirtualSchema(data), {
    onSuccess: (r) => (state) => ({
      schemas: [...state.schemas, r.schema].slice(0, 200), currentSchema: r.schema,
    }),
  }),
  deleteSchema: asyncAction(set, (id) => federationApi.deleteVirtualSchema(id).then(() => id), {
    onSuccess: (id) => (state) => ({
      schemas: state.schemas.filter((s) => s.id !== id),
      currentSchema: state.currentSchema?.id === id ? null : state.currentSchema,
    }),
    errorReturn: false,
  }),
  suggestJoins: async () => {
    const { currentSchema } = get();
    if (!currentSchema?.connections || currentSchema.connections.length < 2) {
      set({ error: 'Need at least 2 connections to suggest joins', loading: false });
      return [];
    }
    set({ loading: true, error: null });
    try {
      const response = await federationApi.suggestJoins(currentSchema.connections);
      set({ joinSuggestions: response.suggestions || [], loading: false });
      return response.suggestions;
    } catch (err) { set({ error: err.message, loading: false }); return []; }
  },
  executeQuery: asyncAction(set, (schemaId, query) => federationApi.executeFederatedQuery({ schemaId, query }), {
    onSuccess: (r) => ({ queryResult: r.result }),
  }),
  getSchema: asyncAction(set, (id) => federationApi.getVirtualSchema(id), {
    onSuccess: (r) => ({ currentSchema: r.schema || r }),
  }),
  setCurrentSchema: (schema) => set({ currentSchema: schema, joinSuggestions: [], queryResult: null }),
  reset: () => set({ currentSchema: null, joinSuggestions: [], queryResult: null, error: null }),
}));


const makeGenerateAction = (set, apiFn) => async (data, options = {}) => {
  set({ generating: true, error: null });
  try {
    const diagram = await apiFn(data, options);
    set((state) => ({
      diagrams: [diagram, ...state.diagrams].slice(0, 200),
      currentDiagram: diagram,
      generating: false,
    }));
    return diagram;
  } catch (err) { set({ error: err.message, generating: false }); return null; }
};

export const useVisualizationStore = create((set, get) => ({
  diagrams: [], currentDiagram: null, diagramTypes: [], chartTypes: [],
  loading: false, generating: false, error: null,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  generateFlowchart: makeGenerateAction(set, (d, o) => visualizationApi.generateFlowchart(d, o)),
  generateMindmap: makeGenerateAction(set, (d, o) => visualizationApi.generateMindmap(d, o)),
  generateOrgChart: makeGenerateAction(set, (d, o) => visualizationApi.generateOrgChart(d, o)),
  generateTimeline: makeGenerateAction(set, (d, o) => visualizationApi.generateTimeline(d, o)),
  generateGantt: makeGenerateAction(set, (d, o) => visualizationApi.generateGantt(d, o)),
  generateNetworkGraph: makeGenerateAction(set, (d, o) => visualizationApi.generateNetworkGraph(d, o)),
  generateKanban: makeGenerateAction(set, (d, o) => visualizationApi.generateKanban(d, o)),
  generateSequenceDiagram: makeGenerateAction(set, (d, o) => visualizationApi.generateSequenceDiagram(d, o)),
  generateWordcloud: makeGenerateAction(set, (d, o) => visualizationApi.generateWordcloud(d, o)),

  tableToChart: async (tableData, options = {}) => {
    set({ generating: true, error: null });
    try {
      const chart = await visualizationApi.tableToChart(tableData, options);
      set({ currentDiagram: chart, generating: false });
      return chart;
    } catch (err) { set({ error: err.message, generating: false }); return null; }
  },
  generateSparklines: async (data, options = {}) => {
    set({ generating: true, error: null });
    try {
      const sparklines = await visualizationApi.generateSparklines(data, options);
      set({ generating: false });
      return sparklines;
    } catch (err) { set({ error: err.message, generating: false }); return null; }
  },

  exportAsMermaid: asyncAction(set, (id) => visualizationApi.exportDiagramAsMermaid(id)),
  exportAsSvg: asyncAction(set, (id) => visualizationApi.exportDiagramAsSvg(id)),
  exportAsPng: asyncAction(set, (id) => visualizationApi.exportDiagramAsPng(id)),
  fetchDiagramTypes: simpleAction(set, () => visualizationApi.listDiagramTypes(), {
    onSuccess: (types) => ({ diagramTypes: types || [] }), errorReturn: [],
  }),
  fetchChartTypes: simpleAction(set, () => visualizationApi.listChartTypes(), {
    onSuccess: (types) => ({ chartTypes: types || [] }), errorReturn: [],
  }),

  setCurrentDiagram: (diagram) => set({ currentDiagram: diagram }),
  clearDiagrams: () => set({ diagrams: [], currentDiagram: null }),
  reset: () => set({ currentDiagram: null, error: null }),
}));


const PIPELINE_STAGES = [
  { id: 'verify_template', label: 'Verify Template', order: 0 },
  { id: 'extract_mappings', label: 'Extract Mappings', order: 1 },
  { id: 'analyze_schema', label: 'Analyze Schema', order: 2 },
  { id: 'merge_contract', label: 'Merge Contract', order: 3 },
  { id: 'execute_queries', label: 'Execute Queries', order: 4 },
  { id: 'render_html', label: 'Render HTML', order: 5 },
  { id: 'generate_pdf', label: 'Generate PDF', order: 6 },
]

const AGENT_WORKFLOW_STAGES = [
  { id: 'plan_research', label: 'Plan Research', order: 0 },
  { id: 'search_web', label: 'Search Web', order: 1 },
  { id: 'search_docs', label: 'Search Documents', order: 2 },
  { id: 'query_db', label: 'Query Database', order: 3 },
  { id: 'synthesize', label: 'Synthesize', order: 4 },
  { id: 'review', label: 'Review', order: 5 },
]

export const usePipelineRunStore = create((set, get) => ({
  runs: {},
  reportStages: PIPELINE_STAGES,
  agentStages: AGENT_WORKFLOW_STAGES,

  startRun: (runId, pipelineType = 'report') => {
    const stages = pipelineType === 'report' ? PIPELINE_STAGES : AGENT_WORKFLOW_STAGES
    set((state) => ({
      runs: {
        ...state.runs,
        [runId]: {
          id: runId, type: pipelineType, status: 'running',
          startTime: Date.now(), endTime: null, currentStage: null,
          stages: stages.map((s) => ({
            ...s, status: 'pending', startTime: null, endTime: null,
            duration: null, error: null, retryCount: 0,
          })),
          checkpoints: [], error: null, progress: 0, metadata: {},
        },
      },
    }))
  },

  updateStage: (runId, stageId, stageUpdate) => {
    set((state) => {
      const run = state.runs[runId]
      if (!run) return state
      const updatedStages = run.stages.map((s) => s.id === stageId ? { ...s, ...stageUpdate } : s)
      const completed = updatedStages.filter((s) => s.status === 'completed').length
      const progress = Math.round((completed / updatedStages.length) * 100)
      return {
        runs: { ...state.runs, [runId]: {
          ...run, stages: updatedStages, progress,
          currentStage: stageUpdate.status === 'running' ? stageId : run.currentStage,
        }},
      }
    })
  },

  stageStarted: (runId, stageId) => get().updateStage(runId, stageId, { status: 'running', startTime: Date.now() }),
  stageCompleted: (runId, stageId) => {
    const run = get().runs[runId]; if (!run) return
    const stage = run.stages.find((s) => s.id === stageId)
    get().updateStage(runId, stageId, { status: 'completed', endTime: Date.now(), duration: stage?.startTime ? Date.now() - stage.startTime : null })
  },
  stageFailed: (runId, stageId, error) => get().updateStage(runId, stageId, { status: 'failed', endTime: Date.now(), error: error || 'Unknown error' }),
  stageRetrying: (runId, stageId) => {
    const stage = get().runs[runId]?.stages?.find((s) => s.id === stageId)
    get().updateStage(runId, stageId, { status: 'retrying', retryCount: (stage?.retryCount || 0) + 1, startTime: Date.now() })
  },

  addCheckpoint: (runId, stageId, data) => {
    set((state) => {
      const run = state.runs[runId]; if (!run) return state
      return { runs: { ...state.runs, [runId]: {
        ...run, checkpoints: [...run.checkpoints, { stageId, timestamp: Date.now(), data: data || {} }],
      }}}
    })
  },

  completeRun: (runId, metadata = {}) => {
    set((state) => {
      const run = state.runs[runId]; if (!run) return state
      return { runs: { ...state.runs, [runId]: {
        ...run, status: 'completed', endTime: Date.now(), progress: 100, metadata: { ...run.metadata, ...metadata },
      }}}
    })
  },

  failRun: (runId, error) => {
    set((state) => {
      const run = state.runs[runId]; if (!run) return state
      return { runs: { ...state.runs, [runId]: { ...run, status: 'failed', endTime: Date.now(), error }}}
    })
  },

  processEvent: (event) => {
    const { runId, type, stageId, data, error } = event
    const store = get()
    const handlers = {
      pipeline_start: () => store.startRun(runId, data?.pipelineType || 'report'),
      stage_start: () => store.stageStarted(runId, stageId),
      stage_complete: () => store.stageCompleted(runId, stageId),
      stage_fail: () => store.stageFailed(runId, stageId, error),
      stage_retry: () => store.stageRetrying(runId, stageId),
      checkpoint: () => store.addCheckpoint(runId, stageId, data),
      pipeline_complete: () => store.completeRun(runId, data),
      pipeline_fail: () => store.failRun(runId, error),
    }
    handlers[type]?.()
  },

  getRun: (runId) => get().runs[runId] || null,
  getActiveRuns: () => Object.values(get().runs).filter((r) => r.status === 'running'),
  cleanupOldRuns: (maxAge = 3600000) => {
    const now = Date.now()
    set((state) => {
      const runs = { ...state.runs }
      for (const [id, run] of Object.entries(runs)) {
        if (run.endTime && now - run.endTime > maxAge) delete runs[id]
      }
      return { runs }
    })
  },
  reset: () => set({ runs: {} }),
}))


const createMessage = (role, content, metadata = {}) => ({
  id: nanoid(), role, content, timestamp: Date.now(), streaming: false, ...metadata,
})

const WELCOME_MESSAGE = "Hi! I'm the NeuraReport assistant. Ask me anything about what you see on screen, how to use a feature, or what to do next."

export const useAssistantStore = create((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),

  messages: [createMessage('assistant', WELCOME_MESSAGE)],
  loading: false, error: null,
  lastRoute: null,
  setLastRoute: (route) => set({ lastRoute: route }),
  followUps: [],
  setFollowUps: (followUps) => set({ followUps }),
  actions: [],
  setActions: (actions) => set({ actions }),

  addUserMessage: (content) => {
    const msg = createMessage('user', content)
    set((state) => ({ messages: [...state.messages, msg].slice(-500), followUps: [], actions: [] }))
    return msg.id
  },
  addAssistantMessage: (content, metadata = {}) => {
    const msg = createMessage('assistant', content, metadata)
    set((state) => ({ messages: [...state.messages, msg].slice(-500) }))
    return msg.id
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clearMessages: () => set({ messages: [createMessage('assistant', WELCOME_MESSAGE)], followUps: [], actions: [], error: null }),
  getMessagesForApi: () => get().messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-20).map((m) => ({ role: m.role, content: m.content })),
}))


const TRANSFER_EXPIRY_MS = 30_000

export const useCrossPageStore = create((set, get) => ({
  pendingTransfer: null,
  setPendingTransfer: (transfer) => set({ pendingTransfer: transfer ? { ...transfer, timestamp: Date.now() } : null }),
  consumeTransfer: (expectedTarget) => {
    const { pendingTransfer } = get()
    if (!pendingTransfer) return null
    if (expectedTarget && pendingTransfer.target !== expectedTarget) return null
    if (Date.now() - pendingTransfer.timestamp > TRANSFER_EXPIRY_MS) { set({ pendingTransfer: null }); return null }
    set({ pendingTransfer: null })
    return pendingTransfer
  },

  outputRegistry: {},
  registerOutput: (featureKey, output) => set((state) => ({
    outputRegistry: { ...state.outputRegistry, [featureKey]: { ...output, featureKey, timestamp: Date.now() } },
  })),
  clearOutput: (featureKey) => set((state) => {
    const next = { ...state.outputRegistry }; delete next[featureKey]; return { outputRegistry: next }
  }),
  getOutput: (featureKey) => get().outputRegistry[featureKey] || null,
  getOutputsByType: (type) => Object.values(get().outputRegistry).filter((o) => o.type === type),
  getAllOutputs: () => Object.values(get().outputRegistry),
}))


export const useQueryStore = create(
  persist(
    (set, get) => ({
      currentQuestion: '', generatedSQL: '', explanation: '', confidence: 0, warnings: [],
      results: null, columns: [], totalCount: null, executionTimeMs: null,
      includeTotal: false,
      isGenerating: false, isExecuting: false, error: null,
      savedQueries: [], queryHistory: [],
      selectedConnectionId: null, selectedTables: [],

      setCurrentQuestion: (question) => set({ currentQuestion: question }),
      setGeneratedSQL: (sql) => set({ generatedSQL: sql }),
      setSelectedConnection: (connectionId) => set({ selectedConnectionId: connectionId, selectedTables: [] }),
      setSelectedTables: (tables) => set({ selectedTables: tables }),
      setGenerationResult: ({ sql, explanation, confidence, warnings, originalQuestion }) =>
        set({ generatedSQL: sql, explanation, confidence, warnings: warnings || [], currentQuestion: originalQuestion, error: null }),
      setExecutionResult: ({ columns, rows, totalCount, executionTimeMs }) =>
        set({ results: rows, columns, totalCount, executionTimeMs, error: null }),
      setIncludeTotal: (includeTotal) => set({ includeTotal: Boolean(includeTotal) }),
      setError: (error) => set({ error, isGenerating: false, isExecuting: false }),
      setIsGenerating: (isGenerating) => set({ isGenerating }),
      setIsExecuting: (isExecuting) => set({ isExecuting }),
      clearResults: () => set({ results: null, columns: [], totalCount: null, executionTimeMs: null }),
      clearAll: () => set({
        currentQuestion: '', generatedSQL: '', explanation: '', confidence: 0, warnings: [],
        results: null, columns: [], totalCount: null, executionTimeMs: null, error: null,
      }),
      setSavedQueries: (queries) => set({ savedQueries: queries }),
      addSavedQuery: (query) => set((state) => ({ savedQueries: [query, ...state.savedQueries] })),
      removeSavedQuery: (queryId) => set((state) => ({ savedQueries: state.savedQueries.filter((q) => q.id !== queryId) })),
      setQueryHistory: (history) => set({ queryHistory: history }),
      addToHistory: (entry) => set((state) => ({ queryHistory: [entry, ...state.queryHistory].slice(0, 100) })),

      explainQuery: async (connectionId, sql) => {
        set({ isGenerating: true, error: null });
        try {
          const result = await nl2sqlApi.explainQuery(connectionId, sql);
          set({ explanation: result.explanation || '', isGenerating: false });
          return result;
        } catch (err) { set({ error: err.message, isGenerating: false }); return null; }
      },
      fetchSavedQuery: simpleAction(set, (queryId) => nl2sqlApi.getSavedQuery(queryId)),
      fetchQueryHistory: async (connectionId = null) => {
        try {
          const response = await nl2sqlApi.getQueryHistory({ connectionId });
          const history = Array.isArray(response) ? response : (response?.history || []);
          set({ queryHistory: history });
          return history;
        } catch (err) { set({ error: err.message }); return []; }
      },
      deleteQueryHistoryEntry: async (entryId) => {
        try {
          await nl2sqlApi.deleteQueryHistoryEntry(entryId);
          set((state) => ({ queryHistory: state.queryHistory.filter((e) => e.id !== entryId) }));
          return true;
        } catch (err) { set({ error: err.message }); return false; }
      },
      loadSavedQuery: (query) => set({
        currentQuestion: query.original_question || '', generatedSQL: query.sql,
        selectedConnectionId: query.connection_id,
        explanation: '', confidence: 0, warnings: [], results: null, columns: [], error: null,
      }),
    }),
    {
      name: 'neura-query-store',
      partialize: (state) => ({
        selectedConnectionId: state.selectedConnectionId,
        queryHistory: state.queryHistory.slice(0, 20),
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.selectedConnectionId != null) {
          const id = state.selectedConnectionId
          if (typeof id !== 'string' || id.trim() === '') state.selectedConnectionId = null
        }
      },
    }
  )
)


export const useJobStore = create((set) => ({
  jobs: [],
  setJobs: (jobs) => set({ jobs: Array.isArray(jobs) ? jobs : [] }),
  addJob: (job) => set((state) => ({ jobs: [job, ...state.jobs] })),
  updateJob: (jobId, updates) => set((state) => ({ jobs: state.jobs.map((j) => (j.id === jobId ? { ...j, ...updates } : j)) })),
  removeJob: (jobId) => set((state) => ({ jobs: state.jobs.filter((j) => j.id !== jobId) })),
  runs: [],
  setRuns: (runs) => set({ runs }),
  downloads: [],
  addDownload: (item) => set((state) => ({ downloads: [item, ...state.downloads].slice(0, 20) })),
}))


const DEMO_CONNECTIONS = [
  { id: 'demo_conn_1', name: 'Sample Sales Database', db_type: 'postgresql', status: 'connected', lastConnected: new Date().toISOString(), lastLatencyMs: 45, summary: 'Demo PostgreSQL connection' },
  { id: 'demo_conn_2', name: 'Marketing Analytics', db_type: 'mysql', status: 'connected', lastConnected: new Date().toISOString(), lastLatencyMs: 32, summary: 'Demo MySQL connection' },
]

const DEMO_TEMPLATES = [
  { id: 'demo_tpl_1', name: 'Monthly Sales Report', kind: 'pdf', status: 'approved', description: 'Comprehensive monthly sales overview', tags: ['sales', 'monthly'], createdAt: new Date().toISOString(), mappingKeys: ['date', 'region', 'product'] },
  { id: 'demo_tpl_2', name: 'Quarterly Revenue Summary', kind: 'excel', status: 'approved', description: 'Revenue breakdown by quarter', tags: ['finance', 'quarterly'], createdAt: new Date().toISOString(), mappingKeys: ['quarter', 'department'] },
  { id: 'demo_tpl_3', name: 'Customer Analytics Dashboard', kind: 'pdf', status: 'approved', description: 'Customer behavior and insights', tags: ['customers', 'analytics'], createdAt: new Date().toISOString(), mappingKeys: ['customer_segment', 'date_range'] },
]

export const useSetupStore = create((set, get) => ({
  demoMode: false,
  setDemoMode: (enabled) => set({ demoMode: enabled }),
  getDemoConnections: () => DEMO_CONNECTIONS,
  getDemoTemplates: () => DEMO_TEMPLATES,
  initDemoMode: () => {
    try {
      const prefs = localStorage.getItem('neurareport_preferences')
      if (prefs) { const parsed = JSON.parse(prefs); if (parsed.demoMode) get().setDemoMode(true) }
    } catch { /* ignore */ }
  },

  setupNav: 'connect',
  setSetupNav: (pane) => set({ setupNav: pane }),
  setupStep: 'connect',
  setSetupStep: (step) => set({ setupStep: step }),
  resetSetup: () => set({ setupNav: 'connect', setupStep: 'connect' }),

  hydrated: false,
  setHydrated: (flag = true) => set({ hydrated: !!flag }),

  lastUsed: { connectionId: null, templateId: null },
  setLastUsed: (payload) => set((state) => {
    const prev = state.lastUsed || { connectionId: null, templateId: null }
    const hasConn = payload && Object.prototype.hasOwnProperty.call(payload, 'connectionId')
    const hasTpl = payload && Object.prototype.hasOwnProperty.call(payload, 'templateId')
    return {
      lastUsed: {
        connectionId: hasConn ? payload?.connectionId ?? null : prev.connectionId ?? null,
        templateId: hasTpl ? payload?.templateId ?? null : prev.templateId ?? null,
      },
    }
  }),
}))


const DISCOVERY_STORAGE_KEY = 'neura.discovery.v1'
const DISCOVERY_MAX_SIZE_BYTES = 2 * 1024 * 1024
const DISCOVERY_MAX_TEMPLATES = 50
const defaultDiscoveryState = { results: {}, meta: null }

const loadDiscoveryFromStorage = () => {
  if (typeof window === 'undefined') return defaultDiscoveryState
  try {
    const raw = window.localStorage.getItem(DISCOVERY_STORAGE_KEY)
    if (!raw) return defaultDiscoveryState
    if (raw.length > DISCOVERY_MAX_SIZE_BYTES) { window.localStorage.removeItem(DISCOVERY_STORAGE_KEY); return defaultDiscoveryState }
    const parsed = JSON.parse(raw)
    return {
      results: parsed?.results && typeof parsed.results === 'object' ? parsed.results : {},
      meta: parsed?.meta && typeof parsed.meta === 'object' ? parsed.meta : null,
    }
  } catch { return defaultDiscoveryState }
}

const evictOldestResults = (results, maxSize, maxTemplates) => {
  if (!results || typeof results !== 'object') return {}
  const entries = Object.entries(results)
  if (entries.length <= 1) return results
  entries.sort((a, b) => (a[1]?._accessedAt || 0) - (b[1]?._accessedAt || 0))
  const trimmed = entries.slice(-maxTemplates)
  const evicted = Object.fromEntries(trimmed)
  const serialized = JSON.stringify(evicted)
  if (serialized.length > maxSize && trimmed.length > 1) {
    return evictOldestResults(Object.fromEntries(trimmed.slice(1)), maxSize, maxTemplates)
  }
  return evicted
}

const persistDiscoveryToStorage = (results, meta) => {
  if (typeof window === 'undefined') return
  try {
    const timestampedResults = {}
    if (results && typeof results === 'object') {
      Object.entries(results).forEach(([key, value]) => {
        timestampedResults[key] = { ...value, _accessedAt: value?._accessedAt || Date.now() }
      })
    }
    const evictedResults = evictOldestResults(timestampedResults, DISCOVERY_MAX_SIZE_BYTES, DISCOVERY_MAX_TEMPLATES)
    const payload = JSON.stringify({ results: evictedResults, meta: meta && typeof meta === 'object' ? meta : null, ts: Date.now() })
    if (payload.length > DISCOVERY_MAX_SIZE_BYTES) {
      const entries = Object.entries(evictedResults)
      if (entries.length > 1) {
        const newest = entries[entries.length - 1]
        window.localStorage.setItem(DISCOVERY_STORAGE_KEY, JSON.stringify({
          results: { [newest[0]]: newest[1] }, meta: meta && typeof meta === 'object' ? meta : null, ts: Date.now(),
        }))
        return
      }
    }
    window.localStorage.setItem(DISCOVERY_STORAGE_KEY, payload)
  } catch (err) {
    if (err?.name === 'QuotaExceededError' || err?.code === 22) {
      try { window.localStorage.removeItem(DISCOVERY_STORAGE_KEY) } catch { /* swallow */ }
    }
  }
}

const clearDiscoveryStorage = () => {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(DISCOVERY_STORAGE_KEY) } catch { /* swallow */ }
}

const discoveryInitial = loadDiscoveryFromStorage()

export const useDiscoveryStore = create((set, get) => ({
  discoveryResults: discoveryInitial.results,
  discoveryMeta: discoveryInitial.meta,
  discoveryFinding: false,

  setDiscoveryResults: (results, meta) => set((state) => {
    const nextResults = results && typeof results === 'object' ? results : defaultDiscoveryState.results
    const nextMeta = meta ? { ...(state.discoveryMeta || {}), ...meta } : state.discoveryMeta
    persistDiscoveryToStorage(nextResults, nextMeta)
    return { discoveryResults: nextResults, discoveryMeta: nextMeta }
  }),
  setDiscoveryMeta: (meta) => set((state) => {
    if (!meta || typeof meta !== 'object') return {}
    const nextMeta = { ...(state.discoveryMeta || {}), ...meta }
    persistDiscoveryToStorage(state.discoveryResults, nextMeta)
    return { discoveryMeta: nextMeta }
  }),
  clearDiscoveryResults: () => set(() => { clearDiscoveryStorage(); return { discoveryResults: defaultDiscoveryState.results, discoveryMeta: defaultDiscoveryState.meta } }),
  updateDiscoveryBatchSelection: (tplId, batchIdx, selected) => set((state) => {
    const target = state.discoveryResults?.[tplId]
    if (!target || !Array.isArray(target.batches)) return {}
    const nextBatches = target.batches.map((batch, idx) => idx === batchIdx ? { ...batch, selected } : batch)
    const nextResults = { ...state.discoveryResults, [tplId]: { ...target, batches: nextBatches } }
    persistDiscoveryToStorage(nextResults, state.discoveryMeta)
    return { discoveryResults: nextResults }
  }),
  setDiscoveryFinding: (flag = false) => set({ discoveryFinding: !!flag }),
}))

if (typeof window !== 'undefined') {
  if (!window.__NEURA_DISCOVERY_HANDLER__) {
    window.__NEURA_DISCOVERY_HANDLER__ = (event) => {
      if (event.key !== DISCOVERY_STORAGE_KEY) return
      try {
        const parsed = event.newValue ? JSON.parse(event.newValue) : null
        useDiscoveryStore.setState({
          discoveryResults: parsed?.results && typeof parsed.results === 'object' ? parsed.results : defaultDiscoveryState.results,
          discoveryMeta: parsed?.meta && typeof parsed.meta === 'object' ? parsed.meta : defaultDiscoveryState.meta,
        })
      } catch {
        useDiscoveryStore.setState({ discoveryResults: defaultDiscoveryState.results, discoveryMeta: defaultDiscoveryState.meta })
      }
    }
    window.addEventListener('storage', window.__NEURA_DISCOVERY_HANDLER__)
  }
}


const useDashboardStore = create((set, get) => ({
  dashboards: [], currentDashboard: null, widgets: [], filters: [], insights: [],
  loading: false, saving: false, refreshing: false, error: null,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  fetchDashboards: asyncAction(set, (params = {}) => dashboardsApi.listDashboards(params), {
    onSuccess: (r) => ({ dashboards: r.dashboards || [] }),
  }),
  createDashboard: asyncAction(set, (data) => dashboardsApi.createDashboard(data), {
    onSuccess: (dashboard) => (state) => ({
      dashboards: [dashboard, ...state.dashboards].slice(0, 100),
      currentDashboard: dashboard, widgets: dashboard.widgets || [], filters: dashboard.filters || [],
    }),
  }),
  getDashboard: asyncAction(set, (id) => dashboardsApi.getDashboard(id), {
    onSuccess: (dashboard) => ({ currentDashboard: dashboard, widgets: dashboard.widgets || [], filters: dashboard.filters || [] }),
  }),
  updateDashboard: async (dashboardId, data) => {
    set({ saving: true, error: null });
    try {
      const dashboard = await dashboardsApi.updateDashboard(dashboardId, data);
      set((state) => ({
        dashboards: state.dashboards.map((d) => (d.id === dashboardId ? dashboard : d)),
        currentDashboard: state.currentDashboard?.id === dashboardId ? dashboard : state.currentDashboard,
        widgets: state.currentDashboard?.id === dashboardId ? (dashboard.widgets || []) : state.widgets,
        saving: false,
      }));
      return dashboard;
    } catch (err) { set({ error: err.message, saving: false }); return null; }
  },
  deleteDashboard: asyncAction(set, (id) => dashboardsApi.deleteDashboard(id).then(() => id), {
    onSuccess: (id) => (state) => ({
      dashboards: state.dashboards.filter((d) => d.id !== id),
      currentDashboard: state.currentDashboard?.id === id ? null : state.currentDashboard,
      widgets: state.currentDashboard?.id === id ? [] : state.widgets,
    }),
    errorReturn: false,
  }),

  addWidget: async (dashboardId, widget) => {
    set({ saving: true, error: null });
    try {
      const newWidget = await dashboardsApi.addWidget(dashboardId, widget);
      set((state) => ({ widgets: [...state.widgets, newWidget].slice(0, 200), saving: false }));
      return newWidget;
    } catch (err) { set({ error: err.message, saving: false }); return null; }
  },
  updateWidget: async (dashboardId, widgetId, data) => {
    set({ saving: true, error: null });
    try {
      const updatedWidget = await dashboardsApi.updateWidget(dashboardId, widgetId, data);
      set((state) => ({ widgets: state.widgets.map((w) => (w.id === widgetId ? updatedWidget : w)), saving: false }));
      return updatedWidget;
    } catch (err) { set({ error: err.message, saving: false }); return null; }
  },
  deleteWidget: async (dashboardId, widgetId) => {
    set({ saving: true, error: null });
    try {
      await dashboardsApi.deleteWidget(dashboardId, widgetId);
      set((state) => ({ widgets: state.widgets.filter((w) => w.id !== widgetId), saving: false }));
      return true;
    } catch (err) { set({ error: err.message, saving: false }); return false; }
  },
  updateWidgetLayout: async (dashboardId, layouts) => {
    set({ saving: true, error: null });
    try {
      await dashboardsApi.updateWidgetLayout(dashboardId, layouts);
      set((state) => ({
        widgets: state.widgets.map((w) => {
          const layout = layouts.find((l) => l.id === w.id);
          return layout ? { ...w, x: layout.x, y: layout.y, w: layout.w, h: layout.h } : w;
        }),
        saving: false,
      }));
      return true;
    } catch (err) { set({ error: err.message, saving: false }); return false; }
  },

  refreshDashboard: async (dashboardId) => {
    set({ refreshing: true, error: null });
    try { await dashboardsApi.refreshDashboard(dashboardId); await get().getDashboard(dashboardId); set({ refreshing: false }); return true; }
    catch (err) { set({ error: err.message, refreshing: false }); return false; }
  },
  executeWidgetQuery: simpleAction(set, (dId, wId, filters = {}) => dashboardsApi.executeWidgetQuery(dId, wId, filters)),
  createSnapshot: asyncAction(set, (id, format = 'png') => dashboardsApi.createSnapshot(id, format)),
  generateEmbedToken: simpleAction(set, (id, hours = 24) => dashboardsApi.generateEmbedToken(id, hours)),

  generateInsights: asyncAction(set, (data, context = null) => dashboardsApi.generateInsights(data, context), {
    onSuccess: (result) => ({ insights: result.insights || [] }),
  }),
  predictTrends: simpleAction(set, (data, dateCol, valCol, periods = 12) => dashboardsApi.predictTrends(data, dateCol, valCol, periods)),
  detectAnomalies: simpleAction(set, (data, columns, method = 'zscore') => dashboardsApi.detectAnomalies(data, columns, method)),
  findCorrelations: simpleAction(set, (data, columns = null) => dashboardsApi.findCorrelations(data, columns)),

  createFromTemplate: asyncAction(set, (tplId, name) => dashboardsApi.createFromTemplate(tplId, name), {
    onSuccess: (dashboard) => (state) => ({
      dashboards: [dashboard, ...state.dashboards].slice(0, 100), currentDashboard: dashboard,
    }),
  }),
  saveAsTemplate: simpleAction(set, (dId, name, desc = null) => dashboardsApi.saveAsTemplate(dId, name, desc)),
  getSnapshotUrl: simpleAction(set, (id) => dashboardsApi.getSnapshotUrl(id)),

  addFilter: async (dashboardId, filter) => {
    set({ saving: true, error: null });
    try {
      const result = await dashboardsApi.addFilter(dashboardId, filter);
      set((state) => ({ filters: [...state.filters, result], saving: false }));
      return result;
    } catch (err) { set({ error: err.message, saving: false }); return null; }
  },
  updateFilter: async (dashboardId, filterId, data) => {
    set({ saving: true, error: null });
    try {
      const result = await dashboardsApi.updateFilter(dashboardId, filterId, data);
      set((state) => ({ filters: state.filters.map((f) => (f.id === filterId ? result : f)), saving: false }));
      return result;
    } catch (err) { set({ error: err.message, saving: false }); return null; }
  },
  deleteFilter: async (dashboardId, filterId) => {
    set({ saving: true, error: null });
    try {
      await dashboardsApi.deleteFilter(dashboardId, filterId);
      set((state) => ({ filters: state.filters.filter((f) => f.id !== filterId), saving: false }));
      return true;
    } catch (err) { set({ error: err.message, saving: false }); return false; }
  },

  setVariable: simpleAction(set, (dId, variable) => dashboardsApi.setVariable(dId, variable)),
  runWhatIfSimulation: asyncAction(set, (dId, scenario) => dashboardsApi.runWhatIfSimulation(dId, scenario)),
  listDashboardTemplates: asyncAction(set, () => dashboardsApi.listDashboardTemplates(), { errorReturn: [] }),
  shareDashboard: simpleAction(set, (dId, data) => dashboardsApi.shareDashboard(dId, data)),
  exportDashboard: asyncAction(set, (dId, format = 'pdf') => dashboardsApi.exportDashboard(dId, format)),

  reset: () => set({ currentDashboard: null, widgets: [], filters: [], insights: [], error: null }),
  clearDashboards: () => set({ dashboards: [], currentDashboard: null, widgets: [] }),
}));

export { useDashboardStore };
