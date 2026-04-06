import { useCallback, useState } from 'react'
import {
  createSavedChart as createSavedChartRequest,
  deleteSavedChart as deleteSavedChartRequest,
  listSavedCharts as listSavedChartsRequest,
  updateSavedChart as updateSavedChartRequest,
} from '@/api/client'

export function useSavedCharts({ templateId, templateKind }) {
  const [savedCharts, setSavedCharts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const reset = useCallback(() => {
    setSavedCharts([])
    setLoading(false)
    setError(null)
  }, [])

  const fetchSavedCharts = useCallback(() => {
    if (!templateId) {
      reset()
      return
    }
    const currentTemplate = templateId
    setLoading(true)
    setError(null)
    listSavedChartsRequest({ templateId: currentTemplate, kind: templateKind })
      .then((charts) => {
        if (currentTemplate === templateId) {
          setSavedCharts(charts)
        }
      })
      .catch((err) => {
        if (currentTemplate === templateId) {
          setError(err?.message || 'Failed to load saved charts.')
        }
      })
      .finally(() => {
        setLoading(false)
      })
  }, [templateId, templateKind, reset])

  const createSavedChart = useCallback(
    async (spec) => {
      if (!templateId) return
      const chart = await createSavedChartRequest({
        templateId,
        kind: templateKind,
        ...spec,
      })
      setSavedCharts((prev) => [...prev, chart])
      return chart
    },
    [templateId, templateKind],
  )

  const renameSavedChart = useCallback(
    async (chartId, newName) => {
      const updated = await updateSavedChartRequest(chartId, { name: newName })
      setSavedCharts((prev) =>
        prev.map((c) => (c.id === chartId ? { ...c, name: newName, ...updated } : c)),
      )
      return updated
    },
    [],
  )

  const deleteSavedChart = useCallback(
    async (chartId) => {
      await deleteSavedChartRequest(chartId)
      setSavedCharts((prev) => prev.filter((c) => c.id !== chartId))
    },
    [],
  )

  return {
    savedCharts,
    savedChartsLoading: loading,
    savedChartsError: error,
    fetchSavedCharts,
    createSavedChart,
    renameSavedChart,
    deleteSavedChart,
  }
}
