import { useState } from 'react'

/**
 * Manages connections page UI state (drawer, dialogs, menus, schema).
 */
export function useConnectionsPageState() {
  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingConnection, setDeletingConnection] = useState(null)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuConnection, setMenuConnection] = useState(null)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [schemaConnection, setSchemaConnection] = useState(null)
  const [favorites, setFavorites] = useState(new Set())

  return {
    loading, setLoading,
    drawerOpen, setDrawerOpen,
    editingConnection, setEditingConnection,
    deleteConfirmOpen, setDeleteConfirmOpen,
    deletingConnection, setDeletingConnection,
    menuAnchor, setMenuAnchor,
    menuConnection, setMenuConnection,
    schemaOpen, setSchemaOpen,
    schemaConnection, setSchemaConnection,
    favorites, setFavorites,
  }
}
