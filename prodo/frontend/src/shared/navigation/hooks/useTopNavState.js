import { useState } from 'react'

/**
 * Manages top navigation bar state (menus, dialogs).
 */
export function useTopNavState() {
  const [anchorEl, setAnchorEl] = useState(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [notificationsAnchorEl, setNotificationsAnchorEl] = useState(null)

  return {
    anchorEl, setAnchorEl,
    shortcutsOpen, setShortcutsOpen,
    helpOpen, setHelpOpen,
    notificationsAnchorEl, setNotificationsAnchorEl,
  }
}
