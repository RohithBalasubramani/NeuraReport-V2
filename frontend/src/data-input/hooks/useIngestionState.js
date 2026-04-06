import { useState } from 'react'

/**
 * Manages ingestion page state (upload, URL import, watchers).
 */
export function useIngestionState(activeConnectionId) {
  const [activeMethod, setActiveMethod] = useState('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [watcherPath, setWatcherPath] = useState('')
  const [createWatcherOpen, setCreateWatcherOpen] = useState(false)
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId || '')

  return {
    activeMethod, setActiveMethod,
    isDragging, setIsDragging,
    urlInput, setUrlInput,
    watcherPath, setWatcherPath,
    createWatcherOpen, setCreateWatcherOpen,
    selectedConnectionId, setSelectedConnectionId,
  }
}
