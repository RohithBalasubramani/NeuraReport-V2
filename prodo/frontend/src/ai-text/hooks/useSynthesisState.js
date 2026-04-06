import { useState } from 'react'

/**
 * Manages synthesis page form state (sessions, documents, settings).
 */
export function useSynthesisState(activeConnectionId) {
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [addDocDialogOpen, setAddDocDialogOpen] = useState(false)
  const [newSessionName, setNewSessionName] = useState('')
  const [docName, setDocName] = useState('')
  const [docContent, setDocContent] = useState('')
  const [docType, setDocType] = useState('text')
  const [outputFormat, setOutputFormat] = useState('structured')
  const [focusTopics, setFocusTopics] = useState('')
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteSessionConfirm, setDeleteSessionConfirm] = useState({
    open: false, sessionId: null, sessionName: '',
  })
  const [removeDocConfirm, setRemoveDocConfirm] = useState({
    open: false, docId: null, docName: '',
  })
  const [initialLoading, setInitialLoading] = useState(true)

  return {
    selectedConnectionId, setSelectedConnectionId,
    createDialogOpen, setCreateDialogOpen,
    addDocDialogOpen, setAddDocDialogOpen,
    newSessionName, setNewSessionName,
    docName, setDocName,
    docContent, setDocContent,
    docType, setDocType,
    outputFormat, setOutputFormat,
    focusTopics, setFocusTopics,
    previewDoc, setPreviewDoc,
    previewOpen, setPreviewOpen,
    deleteSessionConfirm, setDeleteSessionConfirm,
    removeDocConfirm, setRemoveDocConfirm,
    initialLoading, setInitialLoading,
  }
}
