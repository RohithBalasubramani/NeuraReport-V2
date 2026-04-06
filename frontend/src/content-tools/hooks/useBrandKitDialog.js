import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useToast } from '@/components/core'
import useDesignStore from '@/stores/app'
import { useCallback, useRef, useState } from 'react'

const EMPTY_KIT_FORM = {
  name: '',
  description: '',
  primary_color: '#1976d2',
  secondary_color: '#dc004e',
  accent_color: '#ff9800',
  text_color: '#333333',
  background_color: '#ffffff',
  font_family: 'Inter',
  heading_font: '',
  body_font: '',
}

export function useBrandKitDialog() {
  const toast = useToast()
  const { execute } = useInteraction()
  const importRef = useRef(null)
  const {
    createBrandKit, updateBrandKit, deleteBrandKit,
    setDefaultBrandKit, exportBrandKit, importBrandKit,
  } = useDesignStore()

  const [kitDialogOpen, setKitDialogOpen] = useState(false)
  const [kitDialogMode, setKitDialogMode] = useState('create')
  const [editingKitId, setEditingKitId] = useState(null)
  const [kitForm, setKitForm] = useState({ ...EMPTY_KIT_FORM })
  const [kitFormExpanded, setKitFormExpanded] = useState(false)

  const openCreateKit = () => {
    setKitDialogMode('create')
    setEditingKitId(null)
    setKitForm({ ...EMPTY_KIT_FORM })
    setKitFormExpanded(false)
    setKitDialogOpen(true)
  }

  const openEditKit = (kit) => {
    setKitDialogMode('edit')
    setEditingKitId(kit.id)
    setKitForm({
      name: kit.name || '',
      description: kit.description || '',
      primary_color: kit.primary_color || '#1976d2',
      secondary_color: kit.secondary_color || '#dc004e',
      accent_color: kit.accent_color || '#ff9800',
      text_color: kit.text_color || '#333333',
      background_color: kit.background_color || '#ffffff',
      font_family: kit.typography?.font_family || 'Inter',
      heading_font: kit.typography?.heading_font || '',
      body_font: kit.typography?.body_font || '',
    })
    setKitFormExpanded(true)
    setKitDialogOpen(true)
  }

  const handleSaveKit = useCallback(async () => {
    if (!kitForm.name.trim()) return
    const payload = {
      name: kitForm.name,
      description: kitForm.description || undefined,
      primary_color: kitForm.primary_color,
      secondary_color: kitForm.secondary_color,
      accent_color: kitForm.accent_color,
      text_color: kitForm.text_color,
      background_color: kitForm.background_color,
      typography: {
        font_family: kitForm.font_family || 'Inter',
        heading_font: kitForm.heading_font || undefined,
        body_font: kitForm.body_font || undefined,
      },
    }
    const isEdit = kitDialogMode === 'edit'
    return execute({
      type: isEdit ? InteractionType.UPDATE : InteractionType.CREATE,
      label: isEdit ? 'Update brand kit' : 'Create brand kit',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'design', name: kitForm.name },
      action: async () => {
        if (isEdit) {
          await updateBrandKit(editingKitId, payload)
          toast.show('Brand kit updated', 'success')
        } else {
          await createBrandKit(payload)
          toast.show('Brand kit created', 'success')
        }
        setKitDialogOpen(false)
      },
    })
  }, [kitForm, kitDialogMode, editingKitId, createBrandKit, updateBrandKit, execute, toast])

  const handleDeleteKit = useCallback(
    async (kitId) => execute({
      type: InteractionType.DELETE,
      label: 'Delete brand kit',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'design', brandKitId: kitId },
      action: async () => {
        await deleteBrandKit(kitId)
        toast.show('Brand kit deleted', 'success')
      },
    }),
    [deleteBrandKit, execute, toast],
  )

  const handleSetDefault = useCallback(
    async (kitId) => execute({
      type: InteractionType.UPDATE,
      label: 'Set default brand kit',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      intent: { source: 'design', brandKitId: kitId },
      action: async () => {
        await setDefaultBrandKit(kitId)
        toast.show('Default brand kit updated', 'success')
      },
    }),
    [execute, setDefaultBrandKit, toast],
  )

  const handleExportKit = useCallback(async (kitId) => {
    const data = await exportBrandKit(kitId)
    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `brand-kit-${kitId}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.show('Brand kit exported', 'success')
    }
  }, [exportBrandKit, toast])

  const handleImportKit = useCallback(async (evt) => {
    const file = evt.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const kitData = data.brand_kit || data
      await execute({
        type: InteractionType.CREATE,
        label: 'Import brand kit',
        reversibility: Reversibility.SYSTEM_MANAGED,
        intent: { source: 'design', action: 'import' },
        action: async () => {
          await importBrandKit(kitData)
          toast.show('Brand kit imported', 'success')
        },
      })
    } catch {
      toast.show('Invalid brand kit file', 'error')
    }
    evt.target.value = ''
  }, [execute, importBrandKit, toast])

  return {
    importRef,
    kitDialogOpen, setKitDialogOpen,
    kitDialogMode, editingKitId,
    kitForm, setKitForm,
    kitFormExpanded, setKitFormExpanded,
    openCreateKit, openEditKit,
    handleSaveKit, handleDeleteKit,
    handleSetDefault, handleExportKit, handleImportKit,
  }
}
