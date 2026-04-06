import { useState } from 'react'

/**
 * Manages DataTable sorting, pagination, filtering, and selection state.
 * Extracted from components/data.jsx DataTable.
 */
export function useDataTableState({
  columns = [],
  defaultSortField,
  defaultSortOrder = 'asc',
  pageSize = 10,
  persisted = null,
} = {}) {
  const [order, setOrder] = useState(persisted?.order || defaultSortOrder)
  const [orderBy, setOrderBy] = useState(persisted?.orderBy || defaultSortField || columns[0]?.field)
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(persisted?.rowsPerPage || pageSize)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilters, setActiveFilters] = useState(persisted?.filters || {})
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [hiddenColumns, setHiddenColumns] = useState(persisted?.hiddenColumns || [])

  return {
    order, setOrder,
    orderBy, setOrderBy,
    selected, setSelected,
    page, setPage,
    rowsPerPage, setRowsPerPage,
    searchQuery, setSearchQuery,
    activeFilters, setActiveFilters,
    expandedRows, setExpandedRows,
    hiddenColumns, setHiddenColumns,
  }
}
