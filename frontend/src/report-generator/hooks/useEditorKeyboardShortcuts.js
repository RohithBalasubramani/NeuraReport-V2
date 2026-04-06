import { useCallback, useEffect } from 'react'

/**
 * Hook for handling keyboard shortcuts in the template editor.
 */
export function useEditorKeyboardShortcuts({
  onSave,
  onUndo,
  onRedo,
  onApplyAi,
  onEscape,
  enabled = true,
  dirty = false,
  hasInstructions = false,
}) {
  const handleKeyDown = useCallback(
    (event) => {
      if (!enabled) return
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modKey = isMac ? event.metaKey : event.ctrlKey
      const shiftKey = event.shiftKey

      if (modKey && event.key === 's') {
        event.preventDefault()
        if (dirty && onSave) onSave()
        return
      }
      if (modKey && event.key === 'z' && !shiftKey) {
        event.preventDefault()
        if (onUndo) onUndo()
        return
      }
      if (modKey && event.key === 'z' && shiftKey) {
        event.preventDefault()
        if (onRedo) onRedo()
        return
      }
      if (modKey && event.key === 'Enter' && hasInstructions) {
        event.preventDefault()
        if (onApplyAi) onApplyAi()
        return
      }
      if (event.key === 'Escape') {
        if (onEscape) onEscape()
        return
      }
    },
    [enabled, dirty, hasInstructions, onSave, onUndo, onRedo, onApplyAi, onEscape],
  )

  useEffect(() => {
    if (!enabled) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])
}

/**
 * Get keyboard shortcut display string based on platform.
 */
export function getShortcutDisplay(shortcut) {
  const isMac =
    typeof navigator !== 'undefined' &&
    navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const modKey = isMac ? '\u2318' : 'Ctrl'
  const shortcuts = {
    save: `${modKey}+S`,
    undo: `${modKey}+Z`,
    redo: `${modKey}+Shift+Z`,
    applyAi: `${modKey}+Enter`,
  }
  return shortcuts[shortcut] || shortcut
}

export const EDITOR_SHORTCUTS = [
  { key: 'save', label: 'Save HTML', description: 'Save current changes' },
  { key: 'undo', label: 'Undo', description: 'Revert to previous version' },
  { key: 'applyAi', label: 'Apply AI', description: 'Apply AI instructions (when filled)' },
]
