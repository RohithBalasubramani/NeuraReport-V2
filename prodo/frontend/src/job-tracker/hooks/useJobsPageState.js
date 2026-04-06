import * as api from '@/api/client'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Manages job list, filtering, bulk actions, and auto-refresh state.
 */
export function useJobsPageState() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [cancellingJob, setCancellingJob] = useState(null)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuJob, setMenuJob] = useState(null)
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [detailsJob, setDetailsJob] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [autoRefreshJobs, setAutoRefreshJobs] = useState(
    () => localStorage.getItem('neura_auto_refresh_jobs') !== 'false'
  )

  const abortControllerRef = useRef(null)

  const fetchJobs = useCallback(async (force = false) => {
    if (abortControllerRef.current) abortControllerRef.current.abort()
    abortControllerRef.current = new AbortController()
    setLoading(true)
    try {
      const data = await api.listJobs({ limit: 50, signal: abortControllerRef.current.signal })
      setJobs(Array.isArray(data) ? data : data?.jobs || [])
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('Failed to fetch jobs:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
    return () => { if (abortControllerRef.current) abortControllerRef.current.abort() }
  }, [fetchJobs])

  return {
    jobs, setJobs, loading,
    cancelConfirmOpen, setCancelConfirmOpen,
    cancellingJob, setCancellingJob,
    menuAnchor, setMenuAnchor,
    menuJob, setMenuJob,
    detailsDialogOpen, setDetailsDialogOpen,
    detailsJob, setDetailsJob,
    retrying, setRetrying,
    selectedIds, setSelectedIds,
    bulkCancelOpen, setBulkCancelOpen,
    bulkDeleteOpen, setBulkDeleteOpen,
    bulkActionLoading, setBulkActionLoading,
    autoRefreshJobs, setAutoRefreshJobs,
    fetchJobs,
  }
}
