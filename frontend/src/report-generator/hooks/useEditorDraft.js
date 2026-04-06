import { useCallback, useEffect, useRef, useState } from 'react'

const DRAFT_PREFIX = 'neura-template-draft-'
const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Hook for auto-saving template drafts to localStorage.
 *
 * Features:
 * - Auto-saves drafts periodically when content changes
 * - Detects and restores unsaved drafts on load
 * - Cleans up old/expired drafts
 * - Provides manual save/discard controls
 */
export function useEditorDraft(templateId, { autoSaveInterval = 10000, enabled = true } = {}) {
  const [hasDraft, setHasDraft] = useState(false)
  const [draftData, setDraftData] = useState(null)
  const [lastSaved, setLastSaved] = useState(null)
  const autoSaveTimerRef = useRef(null)
  const pendingContentRef = useRef(null)

  const storageKey = `${DRAFT_PREFIX}${templateId}`

  useEffect(() => {
    if (!templateId || !enabled) return
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        const age = Date.now() - (parsed.savedAt || 0)
        if (age < DRAFT_EXPIRY_MS) {
          setHasDraft(true)
          setDraftData(parsed)
        } else {
          localStorage.removeItem(storageKey)
        }
      }
    } catch (err) {
      console.warn('Failed to load draft:', err)
    }
  }, [templateId, storageKey, enabled])

  useEffect(() => {
    if (!enabled) return
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(DRAFT_PREFIX))
      keys.forEach((key) => {
        try {
          const stored = localStorage.getItem(key)
          if (stored) {
            const parsed = JSON.parse(stored)
            const age = Date.now() - (parsed.savedAt || 0)
            if (age >= DRAFT_EXPIRY_MS) {
              localStorage.removeItem(key)
            }
          }
        } catch {
          localStorage.removeItem(key)
        }
      })
    } catch (err) {
      console.warn('Failed to clean up drafts:', err)
    }
  }, [enabled])

  const saveDraft = useCallback(
    (html, instructions = '') => {
      if (!templateId || !enabled) return false
      try {
        const draft = { html, instructions, savedAt: Date.now(), templateId }
        localStorage.setItem(storageKey, JSON.stringify(draft))
        setLastSaved(new Date())
        return true
      } catch (err) {
        console.warn('Failed to save draft:', err)
        return false
      }
    },
    [templateId, storageKey, enabled],
  )

  const discardDraft = useCallback(() => {
    if (!templateId) return
    try {
      localStorage.removeItem(storageKey)
      setHasDraft(false)
      setDraftData(null)
    } catch (err) {
      console.warn('Failed to discard draft:', err)
    }
  }, [templateId, storageKey])

  const scheduleAutoSave = useCallback(
    (html, instructions = '') => {
      if (!enabled) return
      pendingContentRef.current = { html, instructions }
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
      autoSaveTimerRef.current = setTimeout(() => {
        if (pendingContentRef.current) {
          saveDraft(pendingContentRef.current.html, pendingContentRef.current.instructions)
        }
      }, autoSaveInterval)
    },
    [enabled, autoSaveInterval, saveDraft],
  )

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
      if (pendingContentRef.current) {
        try {
          const draft = {
            html: pendingContentRef.current.html,
            instructions: pendingContentRef.current.instructions,
            savedAt: Date.now(),
            templateId,
          }
          localStorage.setItem(storageKey, JSON.stringify(draft))
        } catch {
          // Best-effort flush on unmount
        }
      }
    }
  }, [templateId, storageKey])

  const clearDraftAfterSave = useCallback(() => {
    discardDraft()
  }, [discardDraft])

  return {
    hasDraft,
    draftData,
    lastSaved,
    saveDraft,
    discardDraft,
    scheduleAutoSave,
    clearDraftAfterSave,
  }
}
