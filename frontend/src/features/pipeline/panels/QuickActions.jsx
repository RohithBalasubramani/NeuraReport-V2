/**
 * QuickActions — Right-click context menu overlay.
 *
 * References:
 *   - react-contexify: context menu library
 *   - @floating-ui/react: tooltip positioning
 *   - VS Code context menu: action-aware based on click target
 *
 * Covers:
 *   10: Quick actions overlay (react-contexify with 6 context-aware actions)
 *
 * Right-click any element in the panel → context menu with:
 *   - Remap field (if token detected)
 *   - Trace data source (→ logic panel)
 *   - Preview with data (→ preview panel)
 *   - Change formatting
 *   - Copy value
 *   - Open in panel
 */
import React, { useCallback, useRef } from 'react'
import { Menu, Item, Separator, useContextMenu } from 'react-contexify'
import 'react-contexify/dist/ReactContexify.css'
import {
  useFloating, autoPlacement, offset, shift,
} from '@floating-ui/react'
import {
  SwapHoriz as RemapIcon, AccountTree as TraceIcon,
  Visibility as PreviewIcon, TextFormat as FormatIcon,
  ContentCopy as CopyIcon, OpenInNew as JumpIcon,
} from '@mui/icons-material'
import { Box, Typography } from '@mui/material'
import usePipelineStore from '@/stores/pipeline'

const MENU_ID = 'neura-quick-actions'

const ACTIONS = {
  remap: { label: 'Remap this field', icon: <RemapIcon sx={{ fontSize: 16 }} /> },
  trace: { label: 'Trace data source', icon: <TraceIcon sx={{ fontSize: 16 }} /> },
  preview: { label: 'Preview with data', icon: <PreviewIcon sx={{ fontSize: 16 }} /> },
  format: { label: 'Change formatting', icon: <FormatIcon sx={{ fontSize: 16 }} /> },
  copy: { label: 'Copy value', icon: <CopyIcon sx={{ fontSize: 16 }} /> },
  jump: { label: 'Open in panel', icon: <JumpIcon sx={{ fontSize: 16 }} /> },
}

// Determine which actions are relevant for the clicked context
function getActions(ctx) {
  const a = []
  if (ctx.token || ctx.field) a.push('remap', 'trace', 'preview')
  if (ctx.text) a.push('copy')
  if (ctx.panel) a.push('jump')
  if (ctx.token) a.push('format')
  if (!a.length) a.push('copy')
  return a
}

// Walk DOM upward to extract data-* attributes
function extractContext(el) {
  const ctx = {}
  let node = el
  while (node && node !== document.body) {
    if (node.dataset?.token) ctx.token = node.dataset.token
    if (node.dataset?.field) ctx.field = node.dataset.field
    if (node.dataset?.panel) ctx.panel = node.dataset.panel
    if (node.dataset?.column) ctx.column = node.dataset.column
    node = node.parentElement
  }
  ctx.text = window.getSelection()?.toString() || el?.textContent?.slice(0, 100) || ''
  return ctx
}

// ── Menu ──
function QuickActionsMenu({ onAction }) {
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)

  const handle = useCallback((type, ctx) => {
    switch (type) {
      case 'remap':
        if (ctx.token) onAction?.({ type: 'remap_field', token: ctx.token })
        break
      case 'trace':
        if (ctx.token || ctx.field) { setActivePanel('logic'); setHighlightedField(ctx.token || ctx.field) }
        break
      case 'preview':
        if (ctx.token) { setActivePanel('preview'); setHighlightedField(ctx.token) }
        break
      case 'format':
        if (ctx.token) onAction?.({ type: 'format_field', token: ctx.token })
        break
      case 'copy':
        if (ctx.text) navigator.clipboard?.writeText(ctx.text)
        break
      case 'jump':
        if (ctx.panel) setActivePanel(ctx.panel)
        break
    }
  }, [onAction, setActivePanel, setHighlightedField])

  return (
    <Menu id={MENU_ID} animation="fade" theme="light">
      {({ props: menuProps }) => {
        const ctx = menuProps?.context || {}
        const available = getActions(ctx)
        return (
          <>
            {ctx.token && (
              <>
                <Box sx={{ px: 1.5, py: 0.5 }}>
                  <Typography variant="caption" color="text.disabled" fontWeight={600}>{ctx.token}</Typography>
                </Box>
                <Separator />
              </>
            )}
            {available.map(key => {
              const a = ACTIONS[key]
              if (!a) return null
              return (
                <Item key={key} onClick={() => handle(key, ctx)}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {a.icon}
                    <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{a.label}</Typography>
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

// ── Provider ──
export default function QuickActionsProvider({ children, onAction }) {
  const { show } = useContextMenu({ id: MENU_ID })

  const handleContextMenu = useCallback(e => {
    e.preventDefault()
    show({ event: e, props: { context: extractContext(e.target) } })
  }, [show])

  return (
    <Box onContextMenu={handleContextMenu} sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {children}
      <QuickActionsMenu onAction={onAction} />
    </Box>
  )
}

// ── Reusable Floating Tooltip ──
export function FloatingTooltip({ children, content, placement = 'bottom' }) {
  const { refs, floatingStyles } = useFloating({
    placement,
    middleware: [offset(8), shift(), autoPlacement()],
  })

  return (
    <>
      <Box ref={refs.setReference} sx={{ display: 'inline-flex' }}>{children}</Box>
      {content && (
        <Box ref={refs.setFloating} style={floatingStyles}
          sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, boxShadow: 2, p: 1, zIndex: 1500, fontSize: '0.75rem' }}>
          {content}
        </Box>
      )}
    </>
  )
}
