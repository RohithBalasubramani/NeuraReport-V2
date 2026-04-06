import * as api from '@/api/client'
import { useCallback, useEffect, useState } from 'react'

/**
 * Manages activity page state (filters, fetch, clear).
 */
export function useActivityState() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [entityTypeFilter, setEntityTypeFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [clearing, setClearing] = useState(false)

  const fetchActivities = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getActivityLog({
        entity_type: entityTypeFilter || undefined,
        action: actionFilter || undefined,
      })
      setActivities(Array.isArray(data) ? data : data?.activities || [])
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }, [entityTypeFilter, actionFilter])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  return {
    activities, loading,
    entityTypeFilter, setEntityTypeFilter,
    actionFilter, setActionFilter,
    clearConfirmOpen, setClearConfirmOpen,
    clearing, setClearing,
    fetchActivities,
  }
}
