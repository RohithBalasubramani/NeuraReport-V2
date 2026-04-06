import { useState } from 'react'

/**
 * Manages enrichment configuration page state.
 */
export function useEnrichmentState(activeConnectionId) {
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId || '')
  const [initialLoading, setInitialLoading] = useState(true)
  const [inputData, setInputData] = useState('')
  const [selectedSources, setSelectedSources] = useState([])
  const [parsedData, setParsedData] = useState(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newSourceName, setNewSourceName] = useState('')
  const [newSourceType, setNewSourceType] = useState('company_info')
  const [newSourceDescription, setNewSourceDescription] = useState('')
  const [newSourceCacheTtl, setNewSourceCacheTtl] = useState(24)
  const [deleteSourceConfirm, setDeleteSourceConfirm] = useState({
    open: false, sourceId: null, sourceName: '',
  })
  const [clearCacheConfirm, setClearCacheConfirm] = useState({
    open: false, sourceId: null, sourceName: '',
  })

  return {
    selectedConnectionId, setSelectedConnectionId,
    initialLoading, setInitialLoading,
    inputData, setInputData,
    selectedSources, setSelectedSources,
    parsedData, setParsedData,
    createDialogOpen, setCreateDialogOpen,
    newSourceName, setNewSourceName,
    newSourceType, setNewSourceType,
    newSourceDescription, setNewSourceDescription,
    newSourceCacheTtl, setNewSourceCacheTtl,
    deleteSourceConfirm, setDeleteSourceConfirm,
    clearCacheConfirm, setClearCacheConfirm,
  }
}
