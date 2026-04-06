import { useState } from 'react'

/**
 * Manages schema builder page state.
 */
export function useSchemaBuilderState() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newSchemaName, setNewSchemaName] = useState('')
  const [newSchemaDescription, setNewSchemaDescription] = useState('')
  const [selectedConnections, setSelectedConnections] = useState([])
  const [queryInput, setQueryInput] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState({
    open: false, schemaId: null, schemaName: '',
  })
  const [initialLoading, setInitialLoading] = useState(true)

  return {
    createDialogOpen, setCreateDialogOpen,
    newSchemaName, setNewSchemaName,
    newSchemaDescription, setNewSchemaDescription,
    selectedConnections, setSelectedConnections,
    queryInput, setQueryInput,
    deleteConfirm, setDeleteConfirm,
    initialLoading, setInitialLoading,
  }
}
