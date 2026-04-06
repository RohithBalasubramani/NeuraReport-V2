import { useState } from 'react'

/**
 * Manages global search bar state.
 */
export function useGlobalSearchState() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [hasSearched, setHasSearched] = useState(false)

  return {
    query, setQuery,
    results, setResults,
    loading, setLoading,
    open, setOpen,
    selectedIndex, setSelectedIndex,
    hasSearched, setHasSearched,
  }
}
