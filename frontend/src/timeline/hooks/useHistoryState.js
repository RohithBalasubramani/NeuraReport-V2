import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Manages report history page state (pagination, filters, bulk actions).
 */
export function useHistoryState() {
  const [searchParams] = useSearchParams()
  const initialStatus = searchParams.get('status') || ''
  const initialTemplate = searchParams.get('template') || ''

  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [statusFilter, setStatusFilter] = useState(initialStatus)
  const [templateFilter, setTemplateFilter] = useState(initialTemplate)
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  return {
    history, setHistory,
    loading, setLoading,
    total, setTotal,
    page, setPage,
    rowsPerPage, setRowsPerPage,
    statusFilter, setStatusFilter,
    templateFilter, setTemplateFilter,
    selectedIds, setSelectedIds,
    bulkDeleteOpen, setBulkDeleteOpen,
    bulkDeleting, setBulkDeleting,
  }
}
