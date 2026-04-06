import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useToast } from '@/components/core'
import { useDocumentStore } from '@/stores/content'
import { useCallback, useEffect, useState } from 'react'

export function useDocumentEditor() {
  const toast = useToast()
  const { execute } = useInteraction()
  const {
    currentDocument, saving, updateDocument,
    createDocument, getDocument, deleteDocument,
    fetchDocuments, reset,
  } = useDocumentStore()

  const [showDocList, setShowDocList] = useState(true)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newDocName, setNewDocName] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [editorContent, setEditorContent] = useState(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [docToDelete, setDocToDelete] = useState(null)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)

  useEffect(() => {
    fetchDocuments()
    return () => reset()
  }, [fetchDocuments, reset])

  useEffect(() => {
    if (currentDocument?.content) {
      setEditorContent(currentDocument.content)
      setHasUnsavedChanges(false)
    }
  }, [currentDocument])

  useEffect(() => {
    if (!autoSaveEnabled || !currentDocument || !hasUnsavedChanges || saving) return
    const timer = setTimeout(async () => {
      try {
        await updateDocument(currentDocument.id, { content: editorContent })
        setHasUnsavedChanges(false)
        setLastSaved(new Date())
      } catch (err) {
        console.error('Auto-save failed:', err)
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [autoSaveEnabled, currentDocument, editorContent, hasUnsavedChanges, saving, updateDocument])

  const handleCreateDocument = useCallback(async () => {
    if (!newDocName.trim()) return
    return execute({
      type: InteractionType.CREATE,
      label: 'Create document',
      reversibility: Reversibility.SYSTEM_MANAGED,
      successMessage: 'Document created',
      intent: { source: 'documents', name: newDocName },
      action: async () => {
        const doc = await createDocument({
          name: newDocName.trim(),
          content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
        })
        if (doc) {
          setCreateDialogOpen(false)
          setNewDocName('')
          setSelectedTemplateId('')
          await getDocument(doc.id)
        }
        return doc
      },
    })
  }, [createDocument, execute, getDocument, newDocName])

  const handleDeleteDocument = useCallback(async () => {
    if (!docToDelete) return
    return execute({
      type: InteractionType.DELETE,
      label: `Delete document "${docToDelete.name}"`,
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      successMessage: 'Document deleted',
      intent: { source: 'documents', documentId: docToDelete.id },
      action: async () => {
        await deleteDocument(docToDelete.id)
        setDeleteConfirmOpen(false)
        setDocToDelete(null)
      },
    })
  }, [deleteDocument, docToDelete, execute])

  const handleSave = useCallback(async () => {
    if (!currentDocument || !editorContent) return
    return execute({
      type: InteractionType.UPDATE,
      label: 'Save document',
      reversibility: Reversibility.SYSTEM_MANAGED,
      successMessage: 'Document saved',
      intent: { source: 'documents', documentId: currentDocument.id },
      action: async () => {
        await updateDocument(currentDocument.id, { content: editorContent })
        setHasUnsavedChanges(false)
        setLastSaved(new Date())
      },
    })
  }, [currentDocument, editorContent, execute, updateDocument])

  return {
    showDocList, setShowDocList,
    createDialogOpen, setCreateDialogOpen,
    newDocName, setNewDocName,
    selectedTemplateId, setSelectedTemplateId,
    editorContent, setEditorContent,
    deleteConfirmOpen, setDeleteConfirmOpen,
    docToDelete, setDocToDelete,
    autoSaveEnabled, setAutoSaveEnabled,
    hasUnsavedChanges, setHasUnsavedChanges,
    lastSaved,
    handleCreateDocument, handleDeleteDocument, handleSave,
  }
}
