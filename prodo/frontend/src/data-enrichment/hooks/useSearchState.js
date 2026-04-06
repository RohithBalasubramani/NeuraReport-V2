import { useState } from 'react'

/**
 * Manages search page state.
 */
export function useSearchState() {
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState('fulltext')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({})
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [searchName, setSearchName] = useState('')

  return {
    query, setQuery,
    searchType, setSearchType,
    showFilters, setShowFilters,
    filters, setFilters,
    selectedConnectionId, setSelectedConnectionId,
    showHistory, setShowHistory,
    saveDialogOpen, setSaveDialogOpen,
    searchName, setSearchName,
  }
}
