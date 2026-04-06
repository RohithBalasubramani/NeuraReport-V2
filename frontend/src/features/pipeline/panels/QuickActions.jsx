/**
 * QuickActions — Right-click context menu overlay using:
 * - react-contexify (context menu)
 * - @floating-ui/react (positioning)
 *
 * Wraps panel content and provides context-aware actions
 * based on what element was right-clicked.
 */
import React, { useCallback, useRef } from 'react'
import { Menu, Item, Separator, useContextMenu } from 'react-contexify'
import 'react-contexify/dist/ReactContexify.css'
import {
  useFloating, autoPlacement, offset, shift,
} from '@floating-ui/react'
import {
  SwapHoriz as RemapIcon,
  AccountTree as TraceIcon,
  Visibility as PreviewIcon,
  TextFormat as FormatIcon,
  ContentCopy as CopyIcon,
  OpenInNew as JumpIcon,
} from '@mui/icons-material'
import { Box, Typography } from '@mui/material'
import usePipelineStore from '@/stores/pipeline'

const MENU_ID = 'neura-quick-actions'

// ── Context Menu Items ──
const ACTIONS = {
  remap: { label: 'Remap this field', icon: <RemapIcon sx={{ fontSize: 16 }} /> },
  trace: { label: 'Trace data source', icon: <TraceIcon sx={{ fontSize: 16 }} /> },
  preview: { label: 'Preview with data', icon: <PreviewIcon sx={{ fontSize: 16 }} /> },
  format: { label: 'Change formatting', icon: <FormatIcon sx={{ fontSize: 16 }} /> },
  copy: { label: 'Copy value', icon: <CopyIcon sx={{ fontSize: 16 }} /> },
  jump: { label: 'Open in panel', icon: <JumpIcon sx={{ fontSize: 16 }} /> },
}

// Determine available actions based on context
function getAvailableActions(context) {
  const actions = []

  if (context.token || context.field) {
    actions.push('remap', 'trace', 'preview')
  }
  if (context.text) {
    actions.push('copy')
  }
  if (context.panel) {
    actions.push('jump')
  }
  if (context.token) {
    actions.push('format')
  }

  // Always show at least copy
  if (actions.length === 0) actions.push('copy')

  return actions
}

// Extract context from right-clicked element
function extractContext(element) {
  const context = {}

  // Walk up DOM to find data attributes
  let el = element
  while (el && el !== document.body) {
    if (el.dataset?.token) context.token = el.dataset.token
    if (el.dataset?.field) context.field = el.dataset.field
    if (el.dataset?.panel) context.panel = el.dataset.panel
    if (el.dataset?.column) context.column = el.dataset.column
    el = el.parentElement
  }

  // Get selected text or element text
  const selection = window.getSelection()?.toString()
  context.text = selection || element?.textContent?.slice(0, 100) || ''

  return context
}

// ── Menu Component ──
function QuickActionsMenu({ onAction }) {
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)

  const handleAction = useCallback((actionType, context) => {
    switch (actionType) {
      case 'remap':
        if (context.token) {
          onAction?.({ type: 'remap_field', token: context.token })
        }
        break
      case 'trace':
        if (context.token || context.field) {
          setActivePanel('logic')
          setHighlightedField(context.token || context.field)
        }
        break
      case 'preview':
        if (context.token) {
          setActivePanel('preview')
          setHighlightedField(context.token)
        }
        break
      case 'format':
        if (context.token) {
          onAction?.({ type: 'format_field', token: context.token })
        }
        break
      case 'copy':
        if (context.text) {
          navigator.clipboard?.writeText(context.text)
        }
        break
      case 'jump':
        if (context.panel) {
          setActivePanel(context.panel)
        }
        break
    }
  }, [onAction, setActivePanel, setHighlightedField])

  return (
    <Menu id={MENU_ID} animation="fade" theme="light">
      {({ props: menuProps }) => {
        const context = menuProps?.context || {}
        const availableActions = getAvailableActions(context)

        return (
          <>
            {context.token && (
              <>
                <Box sx={{ px: 1.5, py: 0.5 }}>
                  <Typography variant="caption" color="text.disabled" fontWeight={600}>
                    {context.token}
                  </Typography>
                </Box>
                <Separator />
              </>
            )}
            {availableActions.map(actionKey => {
              const action = ACTIONS[actionKey]
              if (!action) return null
              return (
                <Item
                  key={actionKey}
                  onClick={() => handleAction(actionKey, context)}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {action.icon}
                    <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                      {action.label}
                    </Typography>
                  </Box>
                </Item>
              )
            })}
          </>
        )
      }}
    </Menu>
  )
}

// ── Provider Wrapper ──
export default function QuickActionsProvider({ children, onAction }) {
  const { show } = useContextMenu({ id: MENU_ID })
  const containerRef = useRef(null)

  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    const context = extractContext(e.target)
    show({ event: e, props: { context } })
  }, [show])

  return (
    <Box
      ref={containerRef}
      onContextMenu={handleContextMenu}
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {children}
      <QuickActionsMenu onAction={onAction} />
    </Box>
  )
}

// ── Floating Tooltip (reusable) ──
export function FloatingTooltip({ children, content, placement = 'bottom' }) {
  const { refs, floatingStyles } = useFloating({
    placement,
    middleware: [offset(8), shift(), autoPlacement()],
  })

  return (
    <>
      <Box ref={refs.setReference} sx={{ display: 'inline-flex' }}>
        {children}
      </Box>
      {content && (
        <Box
          ref={refs.setFloating}
          style={floatingStyles}
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            boxShadow: 2,
            p: 1,
            zIndex: 1500,
            fontSize: '0.75rem',
          }}
        >
          {content}
        </Box>
      )}
    </>
  )
}
