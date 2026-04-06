import { useState } from 'react'

/**
 * Manages mapping step state in setup wizard.
 */
export function useSetupMappingState(wizardState) {
  const [loading, setLoading] = useState(false)
  const [mapping, setMapping] = useState(wizardState.mapping || {})
  const [keys, setKeys] = useState(wizardState.keys || [])
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState(null)

  return {
    loading, setLoading,
    mapping, setMapping,
    keys, setKeys,
    showAdvanced, setShowAdvanced,
    approving, setApproving,
    approved, setApproved,
    error, setError,
  }
}
