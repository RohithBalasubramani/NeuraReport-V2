import { useState } from 'react'

/**
 * Manages DocQA dialog and form state.
 */
export function useDocQAState() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [addDocDialogOpen, setAddDocDialogOpen] = useState(false)
  const [reportPickerOpen, setReportPickerOpen] = useState(false)
  const [availableRuns, setAvailableRuns] = useState([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [newSessionName, setNewSessionName] = useState('')
  const [docName, setDocName] = useState('')
  const [docContent, setDocContent] = useState('')
  const [question, setQuestion] = useState('')

  const [deleteSessionConfirm, setDeleteSessionConfirm] = useState({
    open: false, sessionId: null, sessionName: '',
  })
  const [removeDocConfirm, setRemoveDocConfirm] = useState({
    open: false, docId: null, docName: '',
  })
  const [clearChatConfirm, setClearChatConfirm] = useState({
    open: false, sessionId: null, sessionName: '',
  })

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [initialLoading, setInitialLoading] = useState(true)

  return {
    createDialogOpen, setCreateDialogOpen,
    addDocDialogOpen, setAddDocDialogOpen,
    reportPickerOpen, setReportPickerOpen,
    availableRuns, setAvailableRuns,
    runsLoading, setRunsLoading,
    newSessionName, setNewSessionName,
    docName, setDocName,
    docContent, setDocContent,
    question, setQuestion,
    deleteSessionConfirm, setDeleteSessionConfirm,
    removeDocConfirm, setRemoveDocConfirm,
    clearChatConfirm, setClearChatConfirm,
    searchQuery, setSearchQuery,
    selectedConnectionId, setSelectedConnectionId,
    initialLoading, setInitialLoading,
  }
}
