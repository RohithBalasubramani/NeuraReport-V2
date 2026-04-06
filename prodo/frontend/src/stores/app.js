import * as designApi from '../api/workspace';import { create } from 'zustand'
const DISCOVERY_STORAGE_KEY = 'neura.discovery.v1'
const DISCOVERY_MAX_SIZE_BYTES = 2 * 1024 * 1024 // 2MB limit
const DISCOVERY_MAX_TEMPLATES = 50 // Max number of template results to keep

const defaultDiscoveryState = { results: {}, meta: null }

const loadDiscoveryFromStorage = () => {
  if (typeof window === 'undefined') return defaultDiscoveryState
  try {
    const raw = window.localStorage.getItem(DISCOVERY_STORAGE_KEY)
    if (!raw) return defaultDiscoveryState
    if (raw.length > DISCOVERY_MAX_SIZE_BYTES) {
      console.warn('[useAppStore] Stored discovery data exceeds size limit, resetting')
      window.localStorage.removeItem(DISCOVERY_STORAGE_KEY)
      return defaultDiscoveryState
    }
    const parsed = JSON.parse(raw)
    const results =
      parsed && parsed.results && typeof parsed.results === 'object' ? parsed.results : {}
    const meta = parsed && parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : null
    return { results, meta }
  } catch {
    return defaultDiscoveryState
  }
}

/**
 * Evict oldest template results if size exceeds limit (LRU eviction).
 * Each template result should have a `_accessedAt` timestamp for ordering.
 */
const evictOldestResults = (results, maxSize, maxTemplates) => {
  if (!results || typeof results !== 'object') return {}

  const entries = Object.entries(results)
  if (entries.length <= 1) return results

  // Sort by access time (oldest first), falling back to template ID
  entries.sort((a, b) => {
    const timeA = a[1]?._accessedAt || 0
    const timeB = b[1]?._accessedAt || 0
    return timeA - timeB
  })

  // Keep only the most recent templates up to maxTemplates
  const trimmed = entries.slice(-maxTemplates)

  // Convert back to object
  const evicted = Object.fromEntries(trimmed)

  // Check size and continue evicting if still too large
  const serialized = JSON.stringify(evicted)
  if (serialized.length > maxSize && trimmed.length > 1) {
    // Remove oldest entry and recurse
    const [, ...rest] = trimmed
    return evictOldestResults(Object.fromEntries(rest), maxSize, maxTemplates)
  }

  return evicted
}

const persistDiscoveryToStorage = (results, meta) => {
  if (typeof window === 'undefined') return
  try {
    // Add access timestamp for LRU tracking
    const timestampedResults = {}
    if (results && typeof results === 'object') {
      Object.entries(results).forEach(([key, value]) => {
        timestampedResults[key] = {
          ...value,
          _accessedAt: value?._accessedAt || Date.now(),
        }
      })
    }

    // Apply LRU eviction if needed
    const evictedResults = evictOldestResults(
      timestampedResults,
      DISCOVERY_MAX_SIZE_BYTES,
      DISCOVERY_MAX_TEMPLATES
    )

    const payload = JSON.stringify({
      results: evictedResults,
      meta: meta && typeof meta === 'object' ? meta : null,
      ts: Date.now(),
    })

    // Final size check before writing
    if (payload.length > DISCOVERY_MAX_SIZE_BYTES) {
      console.warn('[useAppStore] Discovery data exceeds size limit after eviction, clearing old data')
      // Clear all but most recent template
      const entries = Object.entries(evictedResults)
      if (entries.length > 1) {
        const newest = entries[entries.length - 1]
        window.localStorage.setItem(
          DISCOVERY_STORAGE_KEY,
          JSON.stringify({
            results: { [newest[0]]: newest[1] },
            meta: meta && typeof meta === 'object' ? meta : null,
            ts: Date.now(),
          })
        )
        return
      }
    }

    window.localStorage.setItem(DISCOVERY_STORAGE_KEY, payload)
  } catch (err) {
    // Handle quota exceeded error gracefully
    if (err?.name === 'QuotaExceededError' || err?.code === 22) {
      console.warn('[useAppStore] localStorage quota exceeded, clearing discovery cache')
      try {
        window.localStorage.removeItem(DISCOVERY_STORAGE_KEY)
      } catch {
        // swallow
      }
    }
    // swallow other storage errors (private mode, etc.)
  }
}

const clearDiscoveryStorage = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(DISCOVERY_STORAGE_KEY)
  } catch {
    // swallow
  }
}

const discoveryInitial = loadDiscoveryFromStorage()

// Demo data for demo mode
const DEMO_CONNECTIONS = [
  { id: 'demo_conn_1', name: 'Sample Sales Database', db_type: 'postgresql', status: 'connected', lastConnected: new Date().toISOString(), lastLatencyMs: 45, summary: 'Demo PostgreSQL connection' },
  { id: 'demo_conn_2', name: 'Marketing Analytics', db_type: 'mysql', status: 'connected', lastConnected: new Date().toISOString(), lastLatencyMs: 32, summary: 'Demo MySQL connection' },
]

const DEMO_TEMPLATES = [
  { id: 'demo_tpl_1', name: 'Monthly Sales Report', kind: 'pdf', status: 'approved', description: 'Comprehensive monthly sales overview', tags: ['sales', 'monthly'], createdAt: new Date().toISOString(), mappingKeys: ['date', 'region', 'product'] },
  { id: 'demo_tpl_2', name: 'Quarterly Revenue Summary', kind: 'excel', status: 'approved', description: 'Revenue breakdown by quarter', tags: ['finance', 'quarterly'], createdAt: new Date().toISOString(), mappingKeys: ['quarter', 'department'] },
  { id: 'demo_tpl_3', name: 'Customer Analytics Dashboard', kind: 'pdf', status: 'approved', description: 'Customer behavior and insights', tags: ['customers', 'analytics'], createdAt: new Date().toISOString(), mappingKeys: ['customer_segment', 'date_range'] },
]

const normalizeLastUsed = (payload, state) => {
  const prev = state?.lastUsed || { connectionId: null, templateId: null }
  const hasConn = payload && Object.prototype.hasOwnProperty.call(payload, 'connectionId')
  const hasTpl = payload && Object.prototype.hasOwnProperty.call(payload, 'templateId')

  const next = {
    connectionId: hasConn ? payload?.connectionId ?? null : prev.connectionId ?? null,
    templateId: hasTpl ? payload?.templateId ?? null : prev.templateId ?? null,
  }

  const savedConnections = Array.isArray(state?.savedConnections) ? state.savedConnections : []
  if (
    next.connectionId &&
    savedConnections.length > 0 &&
    !savedConnections.some((c) => c.id === next.connectionId)
  ) {
    next.connectionId = null
  }

  const templates = Array.isArray(state?.templates) ? state.templates : []
  if (
    next.templateId &&
    templates.length > 0 &&
    !templates.some((t) => t.id === next.templateId)
  ) {
    next.templateId = null
  }

  return { next, hasConn, hasTpl }
}

const sanitizeConnections = (connections) => {
  if (!Array.isArray(connections)) return []
  return connections.filter((conn) => conn && typeof conn === 'object' && conn.id)
}

export const useAppStore = create((set, get) => ({
  // Demo mode
  demoMode: false,
  setDemoMode: (enabled) => {
    if (enabled) {
      // Populate demo data
      set({
        demoMode: true,
        savedConnections: DEMO_CONNECTIONS,
        activeConnectionId: DEMO_CONNECTIONS[0].id,
        activeConnection: DEMO_CONNECTIONS[0],
        templates: DEMO_TEMPLATES,
      })
    } else {
      // Clear demo data
      set({
        demoMode: false,
        savedConnections: [],
        activeConnectionId: null,
        activeConnection: null,
        templates: [],
      })
    }
  },
  initDemoMode: () => {
    // Check preferences for demo mode
    try {
      const prefs = localStorage.getItem('neurareport_preferences')
      if (prefs) {
        const parsed = JSON.parse(prefs)
        if (parsed.demoMode) {
          get().setDemoMode(true)
        }
      }
    } catch {
      // ignore
    }
  },

  // Setup nav (left navigation panes)
  setupNav: 'connect', // 'connect' | 'generate' | 'templates'
  setSetupNav: (pane) => set({ setupNav: pane }),

  templateKind: 'pdf', // 'pdf' | 'excel'
  setTemplateKind: (kind) =>
    set({ templateKind: kind === 'excel' ? 'excel' : 'pdf' }),

  // Setup flow gating
  setupStep: 'connect', // 'connect' | 'upload' | 'mapping' | 'approve'
  setSetupStep: (step) => set({ setupStep: step }),

  // Connection status
  connection: { status: 'disconnected', lastMessage: null, saved: false, name: '' },
  setConnection: (conn) => set({ connection: { ...get().connection, ...conn } }),

  // Saved connections and active selection
  savedConnections: [], // [{ id, name, db_type, status, lastConnected, summary }]
  setSavedConnections: (connections) =>
    set({ savedConnections: sanitizeConnections(connections) }),
  addSavedConnection: (conn) =>
    set((state) => {
      const incoming = conn?.id ? conn : { ...conn, id: conn?.id || `conn_${Date.now()}` }
      const filtered = state.savedConnections.filter((c) => c.id !== incoming.id)
      return { savedConnections: [incoming, ...filtered] }
    }),
  updateSavedConnection: (id, updates) =>
    set((state) => ({
      savedConnections: state.savedConnections.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
      activeConnection:
        state.activeConnectionId === id
          ? { ...state.activeConnection, ...updates }
          : state.activeConnection,
    })),
  removeSavedConnection: (id) =>
    set((state) => {
      const nextLastUsed =
        state.lastUsed && typeof state.lastUsed === 'object'
          ? { ...state.lastUsed }
          : { connectionId: null, templateId: null }
      if (nextLastUsed.connectionId === id) {
        nextLastUsed.connectionId = null
      }
      const activeRemoved = state.activeConnectionId === id
      return {
        savedConnections: state.savedConnections.filter((c) => c.id !== id),
        activeConnectionId: activeRemoved ? null : state.activeConnectionId,
        activeConnection: activeRemoved ? null : state.activeConnection,
        lastUsed: nextLastUsed,
      }
    }),
  activeConnectionId: null,
  activeConnection: null,
  setActiveConnectionId: (id) =>
    set((state) => ({
      activeConnectionId: id,
      activeConnection: state.savedConnections.find((c) => c.id === id) || null,
    })),
  setActiveConnection: (conn) => set({ activeConnection: conn }),

  // 🔹 Latest verified template id + artifacts (used by the mapping editor)
  templateId: null,
  setTemplateId: (id) => set({ templateId: id }),
  verifyArtifacts: null, // { pdf_url, png_url, html_url, llm2_html_url, schema_ext_url }
  setVerifyArtifacts: (arts) => set({ verifyArtifacts: arts }),

  // 🔹 Preview cache-buster + server-provided HTML URLs
  // Use cacheKey in iframe src as a query param (?v=cacheKey) to force re-fetch.
  cacheKey: 0,
  bumpCache: () => set({ cacheKey: Date.now() }),
  setCacheKey: (value) => set({ cacheKey: value ?? Date.now() }),
  // htmlUrls.final -> report_final.html?ts=...
  // htmlUrls.template -> template_p1.html?ts=...
  // htmlUrls.llm2 -> template_llm2.html?ts=...
  htmlUrls: { final: null, template: null, llm2: null },
  setHtmlUrls: (urlsOrUpdater) =>
    set((state) => {
      const next =
        typeof urlsOrUpdater === 'function'
          ? urlsOrUpdater(state.htmlUrls)
          : urlsOrUpdater
      return { htmlUrls: { ...state.htmlUrls, ...next } }
    }),

  resetSetup: () =>
    set({
      setupNav: 'connect',
      setupStep: 'connect',
      connection: { status: 'disconnected', lastMessage: null, saved: false, name: '' },
      lastApprovedTemplate: null,
      templateId: null,
      verifyArtifacts: null,
      activeConnectionId: null,
      activeConnection: null,
      // reset preview URLs so panes don't show stale content after a full reset
      htmlUrls: { final: null, template: null, llm2: null },
      // (leave cacheKey as-is; callers can bumpCache() explicitly when needed)
    }),

  // Templates in app (only approved listed in Generate by default)
  templates: [],
  setTemplates: (templates) => set({ templates }),
  addTemplate: (tpl) => set((state) => ({ templates: [tpl, ...state.templates] })),
  removeTemplate: (id) =>
    set((state) => {
      const templates = state.templates.filter((tpl) => tpl.id !== id)
      const nextLastUsed =
        state.lastUsed && typeof state.lastUsed === 'object'
          ? { ...state.lastUsed }
          : { connectionId: null, templateId: null }
      if (nextLastUsed.templateId === id) {
        nextLastUsed.templateId = null
      }
      const nextTemplateId = state.templateId === id ? null : state.templateId
      const nextLastApproved =
        state.lastApprovedTemplate?.id === id ? null : state.lastApprovedTemplate
      return {
        templates,
        templateId: nextTemplateId,
        lastUsed: nextLastUsed,
        lastApprovedTemplate: nextLastApproved,
      }
    }),
  updateTemplate: (templateId, updater) =>
    set((state) => {
      if (!templateId || typeof updater !== 'function') return {}
      let changed = false
      const templates = state.templates.map((tpl) => {
        if (tpl?.id !== templateId) {
          return tpl
        }
        const next = updater(tpl) || tpl
        if (next !== tpl) {
          changed = true
          return next
        }
        return tpl
      })
      return changed ? { templates } : {}
    }),

  // Last approved template summary
  lastApprovedTemplate: null,
  setLastApprovedTemplate: (tpl) => set({ lastApprovedTemplate: tpl }),

  // Unified template catalog (company + starter)
  templateCatalog: [],
  setTemplateCatalog: (items) =>
    set({
      templateCatalog: Array.isArray(items) ? items : [],
    }),

  // Jobs for background processing
  jobs: [],
  setJobs: (jobs) => set({ jobs: Array.isArray(jobs) ? jobs : [] }),
  addJob: (job) => set((state) => ({ jobs: [job, ...state.jobs] })),
  updateJob: (jobId, updates) =>
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === jobId ? { ...j, ...updates } : j)),
    })),
  removeJob: (jobId) =>
    set((state) => ({ jobs: state.jobs.filter((j) => j.id !== jobId) })),

  runs: [],
  setRuns: (runs) => set({ runs }),

  // Recently downloaded artifacts
  downloads: [],
  addDownload: (item) =>
    set((state) => ({ downloads: [item, ...state.downloads].slice(0, 20) })),

  hydrated: false,
  setHydrated: (flag = true) => set({ hydrated: !!flag }),
  lastUsed: { connectionId: null, templateId: null },
  setLastUsed: (payload) =>
    set((state) => {
      const { next, hasConn, hasTpl } = normalizeLastUsed(payload, state)
      const activeConnection = hasConn
        ? (next.connectionId
            ? state.savedConnections.find((c) => c.id === next.connectionId) || null
            : null)
        : state.activeConnection
      return {
        lastUsed: next,
        activeConnectionId: hasConn ? next.connectionId : state.activeConnectionId,
        activeConnection,
        templateId: hasTpl ? next.templateId : state.templateId,
      }
    }),

  // Discovery list sharing
  discoveryResults: discoveryInitial.results,
  discoveryMeta: discoveryInitial.meta,
  discoveryFinding: false,
  setDiscoveryResults: (results, meta) =>
    set((state) => {
      const nextResults =
        results && typeof results === 'object' ? results : defaultDiscoveryState.results
      const nextMeta = meta
        ? { ...(state.discoveryMeta || {}), ...meta }
        : state.discoveryMeta
      persistDiscoveryToStorage(nextResults, nextMeta)
      return { discoveryResults: nextResults, discoveryMeta: nextMeta }
    }),
  setDiscoveryMeta: (meta) =>
    set((state) => {
      if (!meta || typeof meta !== 'object') return {}
      const nextMeta = { ...(state.discoveryMeta || {}), ...meta }
      persistDiscoveryToStorage(state.discoveryResults, nextMeta)
      return { discoveryMeta: nextMeta }
    }),
  clearDiscoveryResults: () =>
    set(() => {
      clearDiscoveryStorage()
      return {
        discoveryResults: defaultDiscoveryState.results,
        discoveryMeta: defaultDiscoveryState.meta,
      }
    }),
  updateDiscoveryBatchSelection: (tplId, batchIdx, selected) =>
    set((state) => {
      const target = state.discoveryResults?.[tplId]
      if (!target || !Array.isArray(target.batches)) return {}
      const nextBatches = target.batches.map((batch, idx) =>
        idx === batchIdx ? { ...batch, selected } : batch,
      )
      const nextResults = {
        ...state.discoveryResults,
        [tplId]: { ...target, batches: nextBatches },
      }
      persistDiscoveryToStorage(nextResults, state.discoveryMeta)
      return { discoveryResults: nextResults }
    }),
  setDiscoveryFinding: (flag = false) => set({ discoveryFinding: !!flag }),
}))

// Cross-tab sync for discovery is now handled by useDiscoveryStore.
// Global store exposure removed for security (prevents XSS state mutation).
// Re-export focused stores for gradual migration.
export { useConnectionStore } from './content'
export { useTemplateStore } from './content'
export { useJobStore } from './workspace'
export { useDiscoveryStore } from './workspace'
export { useSetupStore } from './workspace'

// === From: designStore.js ===
/**
 * Design Store - Zustand store for brand kits, themes, and design system.
 */

const useDesignStore = create((set, get) => ({
  // State
  brandKits: [],
  themes: [],
  currentBrandKit: null,
  currentTheme: null,
  defaultBrandKit: null,
  activeTheme: null,
  fonts: [],
  loading: false,
  error: null,

  // Actions
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  // Brand Kits
  createBrandKit: async (data) => {
    set({ loading: true, error: null });
    try {
      const brandKit = await designApi.createBrandKit(data);
      set((state) => ({
        brandKits: [brandKit, ...state.brandKits],
        currentBrandKit: brandKit,
        loading: false,
      }));
      return brandKit;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  fetchBrandKits: async () => {
    set({ loading: true, error: null });
    try {
      const brandKits = await designApi.listBrandKits();
      const defaultKit = brandKits.find((k) => k.is_default);
      set({
        brandKits: brandKits || [],
        defaultBrandKit: defaultKit || null,
        loading: false
      });
      return brandKits;
    } catch (err) {
      set({ error: err.message, loading: false });
      return [];
    }
  },

  getBrandKit: async (brandKitId) => {
    set({ loading: true, error: null });
    try {
      const brandKit = await designApi.getBrandKit(brandKitId);
      set({ currentBrandKit: brandKit, loading: false });
      return brandKit;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  updateBrandKit: async (brandKitId, data) => {
    set({ loading: true, error: null });
    try {
      const brandKit = await designApi.updateBrandKit(brandKitId, data);
      set((state) => ({
        brandKits: state.brandKits.map((k) => (k.id === brandKitId ? brandKit : k)),
        currentBrandKit: state.currentBrandKit?.id === brandKitId ? brandKit : state.currentBrandKit,
        loading: false,
      }));
      return brandKit;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  deleteBrandKit: async (brandKitId) => {
    set({ loading: true, error: null });
    try {
      await designApi.deleteBrandKit(brandKitId);
      set((state) => ({
        brandKits: state.brandKits.filter((k) => k.id !== brandKitId),
        currentBrandKit: state.currentBrandKit?.id === brandKitId ? null : state.currentBrandKit,
        loading: false,
      }));
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  setDefaultBrandKit: async (brandKitId) => {
    set({ loading: true, error: null });
    try {
      await designApi.setDefaultBrandKit(brandKitId);
      set((state) => {
        const updatedBrandKits = state.brandKits.map((k) => ({
          ...k,
          is_default: k.id === brandKitId,
        }));
        return {
          brandKits: updatedBrandKits,
          defaultBrandKit: updatedBrandKits.find((k) => k.id === brandKitId) || null,
          loading: false,
        };
      });
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  applyBrandKit: async (brandKitId, documentId) => {
    set({ loading: true, error: null });
    try {
      const result = await designApi.applyBrandKit(brandKitId, documentId);
      set({ loading: false });
      return result;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  // Themes
  createTheme: async (data) => {
    set({ loading: true, error: null });
    try {
      const theme = await designApi.createTheme(data);
      set((state) => ({
        themes: [theme, ...state.themes],
        currentTheme: theme,
        loading: false,
      }));
      return theme;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  fetchThemes: async () => {
    set({ loading: true, error: null });
    try {
      const themes = await designApi.listThemes();
      const active = themes.find((t) => t.is_active);
      set({
        themes: themes || [],
        activeTheme: active || null,
        loading: false
      });
      return themes;
    } catch (err) {
      set({ error: err.message, loading: false });
      return [];
    }
  },

  getTheme: async (themeId) => {
    set({ loading: true, error: null });
    try {
      const theme = await designApi.getTheme(themeId);
      set({ currentTheme: theme, loading: false });
      return theme;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  updateTheme: async (themeId, data) => {
    set({ loading: true, error: null });
    try {
      const theme = await designApi.updateTheme(themeId, data);
      set((state) => ({
        themes: state.themes.map((t) => (t.id === themeId ? theme : t)),
        currentTheme: state.currentTheme?.id === themeId ? theme : state.currentTheme,
        loading: false,
      }));
      return theme;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  deleteTheme: async (themeId) => {
    set({ loading: true, error: null });
    try {
      await designApi.deleteTheme(themeId);
      set((state) => ({
        themes: state.themes.filter((t) => t.id !== themeId),
        currentTheme: state.currentTheme?.id === themeId ? null : state.currentTheme,
        loading: false,
      }));
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  setActiveTheme: async (themeId) => {
    set({ loading: true, error: null });
    try {
      await designApi.setActiveTheme(themeId);
      set((state) => {
        const updatedThemes = state.themes.map((t) => ({
          ...t,
          is_active: t.id === themeId,
        }));
        return {
          themes: updatedThemes,
          activeTheme: updatedThemes.find((t) => t.id === themeId) || null,
          loading: false,
        };
      });
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  // Color Palettes
  generateColorPalette: async (baseColor, scheme = 'complementary') => {
    set({ loading: true, error: null });
    try {
      const palette = await designApi.generateColorPalette(baseColor, scheme);
      set({ loading: false });
      return palette;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  // Typography
  fetchFonts: async () => {
    try {
      const fonts = await designApi.listFonts();
      set({ fonts: fonts || [] });
      return fonts;
    } catch (err) {
      set({ error: err.message });
      return [];
    }
  },

  getFontPairings: async (primaryFont) => {
    try {
      const pairings = await designApi.getFontPairings(primaryFont);
      return pairings;
    } catch (err) {
      set({ error: err.message });
      return [];
    }
  },

  // Assets
  uploadLogo: async (file, brandKitId) => {
    set({ loading: true, error: null });
    try {
      const result = await designApi.uploadLogo(file, brandKitId);
      // Refresh brand kit to get updated logo
      await get().getBrandKit(brandKitId);
      set({ loading: false });
      return result;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  // Accessibility
  getColorContrast: async (foreground, background) => {
    try {
      const result = await designApi.getColorContrast(foreground, background);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  suggestAccessibleColors: async (baseColor, options = {}) => {
    try {
      const result = await designApi.suggestAccessibleColors(baseColor, options);
      return result;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  // Assets
  fetchAssets: async (brandKitId = null) => {
    set({ loading: true, error: null });
    try {
      const assets = await designApi.listAssets(brandKitId);
      set({ loading: false });
      return assets;
    } catch (err) {
      set({ error: err.message, loading: false });
      return [];
    }
  },

  deleteAsset: async (assetId) => {
    set({ loading: true, error: null });
    try {
      await designApi.deleteAsset(assetId);
      set({ loading: false });
      return true;
    } catch (err) {
      set({ error: err.message, loading: false });
      return false;
    }
  },

  // Export/Import
  exportBrandKit: async (brandKitId, format = 'json') => {
    try {
      const data = await designApi.exportBrandKit(brandKitId, format);
      return data;
    } catch (err) {
      set({ error: err.message });
      return null;
    }
  },

  importBrandKit: async (data) => {
    set({ loading: true, error: null });
    try {
      const brandKit = await designApi.importBrandKit(data);
      set((state) => ({
        brandKits: [brandKit, ...state.brandKits],
        loading: false,
      }));
      return brandKit;
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  // Reset
  reset: () => set({
    currentBrandKit: null,
    currentTheme: null,
    error: null,
  }),
}));

export default useDesignStore;
