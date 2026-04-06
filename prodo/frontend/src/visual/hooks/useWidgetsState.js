import { useState } from 'react'

/**
 * Manages widgets page state.
 */
export function useWidgetsState() {
  const [widgets, setWidgets] = useState([])
  const [grid, setGrid] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('overview')

  return {
    widgets, setWidgets,
    grid, setGrid,
    profile, setProfile,
    loading, setLoading,
    error, setError,
    query, setQuery,
  }
}
