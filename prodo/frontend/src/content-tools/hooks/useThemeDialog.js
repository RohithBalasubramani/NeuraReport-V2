import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useToast } from '@/components/core'
import useDesignStore from '@/stores/app'
import { useCallback, useState } from 'react'

const EMPTY_THEME_FORM = {
  name: '',
  description: '',
  mode: 'light',
  primary: '#1976d2',
  secondary: '#dc004e',
  background: '#ffffff',
  surface: '#f5f5f5',
  text: '#333333',
}

export function useThemeDialog() {
  const toast = useToast()
  const { execute } = useInteraction()
  const { createTheme, deleteTheme, setActiveTheme } = useDesignStore()

  const [themeDialogOpen, setThemeDialogOpen] = useState(false)
  const [themeForm, setThemeForm] = useState({ ...EMPTY_THEME_FORM })

  const openCreateTheme = () => {
    setThemeForm({ ...EMPTY_THEME_FORM })
    setThemeDialogOpen(true)
  }

  const handleSaveTheme = useCallback(async () => {
    if (!themeForm.name.trim()) return
    return execute({
      type: InteractionType.CREATE,
      label: 'Create theme',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'design', name: themeForm.name },
      action: async () => {
        await createTheme({
          name: themeForm.name,
          description: themeForm.description || undefined,
          mode: themeForm.mode,
          colors: {
            primary: themeForm.primary,
            secondary: themeForm.secondary,
            background: themeForm.background,
            surface: themeForm.surface,
            text: themeForm.text,
          },
        })
        toast.show('Theme created', 'success')
        setThemeDialogOpen(false)
      },
    })
  }, [createTheme, execute, themeForm, toast])

  const handleDeleteTheme = useCallback(
    async (themeId) => execute({
      type: InteractionType.DELETE,
      label: 'Delete theme',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'design', themeId },
      action: async () => {
        await deleteTheme(themeId)
        toast.show('Theme deleted', 'success')
      },
    }),
    [deleteTheme, execute, toast],
  )

  const handleActivateTheme = useCallback(
    async (themeId) => execute({
      type: InteractionType.UPDATE,
      label: 'Activate theme',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      intent: { source: 'design', themeId },
      action: async () => {
        await setActiveTheme(themeId)
        toast.show('Theme activated', 'success')
      },
    }),
    [execute, setActiveTheme, toast],
  )

  return {
    themeDialogOpen, setThemeDialogOpen,
    themeForm, setThemeForm,
    openCreateTheme, handleSaveTheme,
    handleDeleteTheme, handleActivateTheme,
  }
}
