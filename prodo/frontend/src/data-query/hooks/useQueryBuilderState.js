import { useState } from 'react'

/**
 * Manages query builder page state.
 */
export function useQueryBuilderState() {
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const [schema, setSchema] = useState(null)
  const [deleteSavedConfirm, setDeleteSavedConfirm] = useState({
    open: false, queryId: null, queryName: '',
  })
  const [deleteHistoryConfirm, setDeleteHistoryConfirm] = useState({
    open: false, entryId: null, question: '',
  })

  return {
    showSaveDialog, setShowSaveDialog,
    saveName, setSaveName,
    saveDescription, setSaveDescription,
    showHistory, setShowHistory,
    showSaved, setShowSaved,
    schema, setSchema,
    deleteSavedConfirm, setDeleteSavedConfirm,
    deleteHistoryConfirm, setDeleteHistoryConfirm,
  }
}
