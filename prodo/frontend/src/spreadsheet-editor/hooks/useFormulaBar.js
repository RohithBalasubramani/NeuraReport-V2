import { useCallback, useEffect, useState } from 'react'

/**
 * Manages formula bar editing, autocomplete, and function insertion.
 */
export function useFormulaBar({ value: externalValue, onChange }) {
  const [localValue, setLocalValue] = useState(externalValue)
  const [isEditing, setIsEditing] = useState(false)
  const [functionMenuAnchor, setFunctionMenuAnchor] = useState(null)
  const [autocompleteAnchor, setAutocompleteAnchor] = useState(null)
  const [filteredFunctions, setFilteredFunctions] = useState([])

  useEffect(() => {
    if (!isEditing) setLocalValue(externalValue)
  }, [externalValue, isEditing])

  const handleApply = useCallback(() => {
    if (onChange) onChange(localValue)
    setIsEditing(false)
  }, [localValue, onChange])

  const handleCancel = useCallback(() => {
    setLocalValue(externalValue)
    setIsEditing(false)
  }, [externalValue])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') handleApply()
    else if (e.key === 'Escape') handleCancel()
  }, [handleApply, handleCancel])

  const handleOpenFunctionMenu = useCallback((e) => {
    setFunctionMenuAnchor(e.currentTarget)
  }, [])

  const handleCloseFunctionMenu = useCallback(() => {
    setFunctionMenuAnchor(null)
  }, [])

  return {
    localValue, setLocalValue,
    isEditing, setIsEditing,
    functionMenuAnchor, autocompleteAnchor, setAutocompleteAnchor,
    filteredFunctions, setFilteredFunctions,
    handleApply, handleCancel, handleKeyDown,
    handleOpenFunctionMenu, handleCloseFunctionMenu,
  }
}
