import { useState } from 'react'

/**
 * Manages command palette state.
 */
export function useCommandPaletteState() {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [recentCommands, setRecentCommands] = useState([])

  return {
    query, setQuery,
    selectedIndex, setSelectedIndex,
    searchResults, setSearchResults,
    isSearching, setIsSearching,
    recentCommands, setRecentCommands,
  }
}
