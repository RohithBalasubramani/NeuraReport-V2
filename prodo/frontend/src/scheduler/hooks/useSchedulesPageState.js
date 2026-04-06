import { useState } from 'react'

/**
 * Manages schedules page state.
 */
export function useSchedulesPageState() {
  const [schedules, setSchedules] = useState([])
  const [schedulableTemplates, setSchedulableTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingSchedule, setDeletingSchedule] = useState(null)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuSchedule, setMenuSchedule] = useState(null)
  const [togglingId, setTogglingId] = useState(null)
  const [schedulerStatus, setSchedulerStatus] = useState(null)

  return {
    schedules, setSchedules,
    schedulableTemplates, setSchedulableTemplates,
    loading, setLoading,
    dialogOpen, setDialogOpen,
    editingSchedule, setEditingSchedule,
    deleteConfirmOpen, setDeleteConfirmOpen,
    deletingSchedule, setDeletingSchedule,
    menuAnchor, setMenuAnchor,
    menuSchedule, setMenuSchedule,
    togglingId, setTogglingId,
    schedulerStatus, setSchedulerStatus,
  }
}
