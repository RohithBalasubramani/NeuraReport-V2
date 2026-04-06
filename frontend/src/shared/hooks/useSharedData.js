import { useAppStore } from '@/stores/app'
import { useCallback, useMemo } from 'react'

/**
 * useSharedData -- Cross-page shared data hook
 *
 * Provides unified access to connections, templates, jobs, and last-used
 * context from useAppStore. Any page that needs shared data should use this
 * hook instead of reaching into useAppStore directly for these fields.
 */
export function useSharedData() {
  const connections = useAppStore((s) => s.savedConnections)
  const templates = useAppStore((s) => s.templates)
  const jobs = useAppStore((s) => s.jobs)
  const runs = useAppStore((s) => s.runs)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const lastUsed = useAppStore((s) => s.lastUsed)
  const templateCatalog = useAppStore((s) => s.templateCatalog)
  const setActiveConnectionId = useAppStore((s) => s.setActiveConnectionId)
  const setLastUsed = useAppStore((s) => s.setLastUsed)

  const getConnectionById = useCallback(
    (id) => connections.find((c) => c.id === id) || null,
    [connections],
  )

  const getTemplateById = useCallback(
    (id) => templates.find((t) => t.id === id) || null,
    [templates],
  )

  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status === 'approved'),
    [templates],
  )

  return {
    connections,
    templates,
    approvedTemplates,
    jobs,
    runs,
    activeConnectionId,
    activeConnection,
    lastUsed,
    templateCatalog,
    setActiveConnectionId,
    setLastUsed,
    getConnectionById,
    getTemplateById,
  }
}
