import { bootstrapState } from '../../api/client'
import { useAppStore } from '@/stores/app'
import { useEffect } from 'react'

const CACHE_KEY = 'neura:persistent-cache'
const CACHE_MAX_AGE = 5 * 60 * 1000 // 5 minutes

const safeConnectionCache = (conn) => ({
  id: conn?.id ?? null,
  name: conn?.name ?? '',
  status: conn?.status ?? 'unknown',
  summary: conn?.summary ?? null,
  db_type: conn?.db_type ?? 'sqlite',
  lastConnected: conn?.lastConnected ?? null,
  lastLatencyMs: typeof conn?.lastLatencyMs === 'number' ? conn.lastLatencyMs : null,
  tags: Array.isArray(conn?.tags) ? conn.tags : [],
})

const safeTemplateCache = (tpl) => ({
  id: tpl?.id ?? null,
  name: tpl?.name ?? '',
  status: tpl?.status ?? 'draft',
  tags: Array.isArray(tpl?.tags) ? tpl.tags : [],
  kind: tpl?.kind || 'pdf',
})

const sanitizeConnections = (connections) => {
  if (!Array.isArray(connections)) return []
  return connections.filter((conn) => conn && typeof conn === 'object' && conn.id)
}

const loadPersistedCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      connections: sanitizeConnections(parsed?.connections),
      templates: Array.isArray(parsed?.templates) ? parsed.templates : [],
      lastUsed: parsed?.lastUsed || { connectionId: null, templateId: null },
      timestamp: parsed?.timestamp || 0,
    }
  } catch {
    return null
  }
}

export const savePersistedCache = ({ connections, templates, lastUsed }) => {
  try {
    const payload = {
      connections: Array.isArray(connections) ? connections.map(safeConnectionCache) : [],
      templates: Array.isArray(templates) ? templates.map(safeTemplateCache) : [],
      lastUsed: lastUsed || { connectionId: null, templateId: null },
      timestamp: Date.now(),
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    /* ignore quota errors */
  }
}

export function useBootstrapState() {
  const {
    hydrated,
    setHydrated,
    setSavedConnections,
    setTemplates,
    setLastUsed,
    setConnection,
    initDemoMode,
  } = useAppStore()

  useEffect(() => {
    if (hydrated) return

    // Initialize demo mode from preferences
    initDemoMode()

    const cached = loadPersistedCache()
    if (cached) {
      setSavedConnections(cached.connections || [])
      setTemplates(cached.templates || [])
      setLastUsed(cached.lastUsed || { connectionId: null, templateId: null })
      const active =
        cached.lastUsed?.connectionId &&
        (cached.connections || []).find((c) => c.id === cached.lastUsed.connectionId)
      if (active) {
        setConnection({
          status: active.status || 'connected',
          saved: true,
          name: active.name,
          lastMessage: active.status,
          lastConnectedAt: active.lastConnected,
        })
      }
    }

    let cancelled = false
    const normalizeLastUsed = (value, connections, templates) => {
      if (!value) return { connectionId: null, templateId: null }
      const connectionId = value.connectionId ?? null
      const templateId = value.templateId ?? null
      const connectionOk = connectionId && connections.some((c) => c.id === connectionId)
      const templateOk = templateId && templates.some((t) => t.id === templateId)
      return {
        connectionId: connectionOk ? connectionId : null,
        templateId: templateOk ? templateId : null,
      }
    }

    const resolveLastUsed = (serverLastUsed, connections, templates) => {
      const serverResolved = normalizeLastUsed(serverLastUsed, connections, templates)
      if (serverResolved.connectionId || serverResolved.templateId) {
        return serverResolved
      }
      return normalizeLastUsed(cached?.lastUsed, connections, templates)
    }

    const hydrate = async () => {
      try {
        const cacheAge = cached?.timestamp ? Date.now() - cached.timestamp : Infinity
        if (cacheAge < CACHE_MAX_AGE && cached?.connections?.length > 0) {
          setHydrated(true)
          return
        }

        const data = await bootstrapState()
        if (cancelled || !data) return
        const connections = Array.isArray(data.connections) ? data.connections : []
        const templates = Array.isArray(data.templates) ? data.templates : []
        const serverLastUsed = data.last_used
          ? {
              connectionId: data.last_used.connection_id ?? null,
              templateId: data.last_used.template_id ?? null,
            }
          : null
        const resolvedLastUsed = resolveLastUsed(serverLastUsed, connections, templates)

        setSavedConnections(connections)
        setTemplates(templates)
        setLastUsed(resolvedLastUsed)

        const active =
          resolvedLastUsed.connectionId &&
          connections.find((c) => c.id === resolvedLastUsed.connectionId)
        if (active) {
          setConnection({
            status: active.status || 'connected',
            saved: true,
            name: active.name,
            lastMessage: active.status,
            lastConnectedAt: active.lastConnected,
          })
        }

        savePersistedCache({
          connections,
          templates,
          lastUsed: resolvedLastUsed,
        })
      } catch (err) {
        if (!cached) {
          setTemplates([])
        }
      } finally {
        if (!cancelled) setHydrated(true)
      }
    }

    hydrate()
    return () => {
      cancelled = true
    }
  }, [
    hydrated,
    setHydrated,
    setSavedConnections,
    setTemplates,
    setLastUsed,
    setConnection,
    initDemoMode,
  ])
}
