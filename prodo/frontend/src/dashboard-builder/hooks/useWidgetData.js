import { getWidgetData, getWidgetReportData } from '@/api/monitoring'
import { useAppStore } from '@/stores/app'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Hook to fetch and manage widget data from multiple tiers:
 *   Tier 1: Report run data (RAG over saved report data)
 *   Tier 2: Active database connection (real data)
 */
export function useWidgetData({
  scenario,
  variant,
  connectionId,
  reportRunId,
  filters,
  limit = 100,
  autoFetch = true,
  refreshInterval = 0,
}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(null)
  const [strategy, setStrategy] = useState(null)
  const intervalRef = useRef(null)

  const storeConnectionId = useAppStore((s) => s.activeConnectionId)
  const effectiveConnectionId = connectionId || storeConnectionId

  const fetchData = useCallback(async () => {
    if (!scenario) return
    setLoading(true)
    setError(null)
    try {
      let result
      if (reportRunId) {
        result = await getWidgetReportData({ runId: reportRunId, scenario, variant })
      } else if (effectiveConnectionId) {
        result = await getWidgetData({
          connectionId: effectiveConnectionId,
          scenario, variant, filters, limit,
        })
      } else {
        setError('No data source configured. Connect a database to see live data.')
        setLoading(false)
        return
      }
      if (result.error && (!result.data || Object.keys(result.data).length === 0)) {
        setError(result.error)
        setData(null)
      } else {
        setData(result.data || result)
        setSource(result.source || effectiveConnectionId || null)
        setStrategy(result.strategy || null)
      }
    } catch (err) {
      setError(err?.message || 'Failed to load widget data')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [scenario, variant, effectiveConnectionId, reportRunId, filters, limit])

  useEffect(() => {
    if (autoFetch) fetchData()
  }, [autoFetch, fetchData])

  useEffect(() => {
    if (refreshInterval > 0 && autoFetch) {
      intervalRef.current = setInterval(fetchData, refreshInterval)
      return () => clearInterval(intervalRef.current)
    }
  }, [refreshInterval, autoFetch, fetchData])

  return { data, loading, error, source, strategy, refetch: fetchData }
}
