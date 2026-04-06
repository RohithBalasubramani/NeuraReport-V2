/**
 * QuickActions — Floating context menu on right-click in any panel element.
 * Uses @floating-ui/react for positioning.
 * Actions depend on context type: field, mapping, error.
 */
import React, { useState, useCallback } from 'react'
import { Box, MenuItem, ListItemIcon, ListItemText, Paper, Typography } from '@mui/material'
import {
  Highlight as HighlightIcon,
  SwapHoriz as RemapIcon,
  Visibility as ViewIcon,
  Edit as EditIcon,
  BugReport as FixIcon,
  DataObject as DataIcon,
  Check as AcceptIcon,
} from '@mui/icons-material'
import {
  useFloating,
  useInteractions,
  useDismiss,
  useRole,
  FloatingPortal,
  offset,
  flip,
  shift,
} from '@floating-ui/react'
import usePipelineStore from '@/stores/pipeline'

// Context-dependent menu items
const MENU_ITEMS = {
  field: [
    { label: 'Highlight field', icon: HighlightIcon, action: 'highlight' },
    { label: 'Jump to mapping', icon: RemapIcon, action: 'jump_mapping' },
    { label: 'See data samples', icon: DataIcon, action: 'show_data' },
  ],
  mapping: [
    { label: 'Edit mapping', icon: EditIcon, action: 'edit_mapping' },
    { label: 'View confidence', icon: ViewIcon, action: 'view_confidence' },
    { label: 'Accept this field', icon: AcceptIcon, action: 'accept_field' },
  ],
  error: [
    { label: 'Jump to fix', icon: FixIcon, action: 'jump_fix' },
    { label: 'See details', icon: ViewIcon, action: 'view_details' },
  ],
}

export default function QuickActions({ children, context, onAction }) {
  const [isOpen, setIsOpen] = useState(false)
  const setActivePanel = usePipelineStore((s) => s.setActivePanel)
  const setHighlightedField = usePipelineStore((s) => s.setHighlightedField)

  const { refs, floatingStyles, context: floatingCtx } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [offset(5), flip(), shift({ padding: 8 })],
    placement: 'right-start',
  })

  const dismiss = useDismiss(floatingCtx)
  const role = useRole(floatingCtx, { role: 'menu' })
  const { getFloatingProps } = useInteractions([dismiss, role])

  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    refs.setPositionReference({
      getBoundingClientRect: () => ({
        x: e.clientX, y: e.clientY,
        width: 0, height: 0,
        top: e.clientY, left: e.clientX,
        right: e.clientX, bottom: e.clientY,
      }),
    })
    setIsOpen(true)
  }, [refs])

  const handleItemClick = useCallback((action) => {
    setIsOpen(false)
    const field = context?.field
    const panel = context?.panel

    switch (action) {
      case 'highlight':
        if (field) setHighlightedField(field)
        break
      case 'jump_mapping':
        setActivePanel('mappings')
        if (field) setHighlightedField(field)
        break
      case 'show_data':
        setActivePanel('data')
        break
      case 'edit_mapping':
        setActivePanel('mappings')
        if (field) setHighlightedField(field)
        break
      case 'view_confidence':
        setActivePanel('mappings')
        break
      case 'accept_field':
        onAction?.({ type: 'accept_field', field })
        break
      case 'jump_fix':
        if (panel) setActivePanel(panel)
        if (field) setHighlightedField(field)
        break
      case 'view_details':
        setActivePanel('errors')
        break
      default:
        onAction?.({ type: action, ...context })
    }
  }, [context, onAction, setActivePanel, setHighlightedField])

  const menuItems = MENU_ITEMS[context?.type] || MENU_ITEMS.field

  return (
    <>
      <Box onContextMenu={handleContextMenu} sx={{ display: 'contents' }}>
        {children}
      </Box>

      {isOpen && (
        <FloatingPortal>
          <Paper
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            elevation={8}
            sx={{
              py: 0.5,
              minWidth: 180,
              zIndex: 1400,
              borderRadius: 2,
            }}
          >
            <Typography
              variant="caption"
              color="text.disabled"
              sx={{ px: 2, py: 0.25, display: 'block', fontSize: '0.65rem' }}
            >
              {context?.label || 'Actions'}
            </Typography>
            {menuItems.map((item) => {
              const Icon = item.icon
              return (
                <MenuItem
                  key={item.action}
                  onClick={() => handleItemClick(item.action)}
                  dense
                  sx={{ fontSize: '0.8rem', py: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Icon sx={{ fontSize: 16 }} />
                  </ListItemIcon>
                  <ListItemText primaryTypographyProps={{ fontSize: '0.8rem' }}>
                    {item.label}
                  </ListItemText>
                </MenuItem>
              )
            })}
          </Paper>
        </FloatingPortal>
      )}
    </>
  )
}
