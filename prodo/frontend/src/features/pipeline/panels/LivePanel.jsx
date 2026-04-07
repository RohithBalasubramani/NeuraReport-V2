/**
 * LivePanel — Routes between StatusView (default) and detail tab panels.
 *
 * References:
 *   - React Router Outlet: nested rendering with transitions
 *   - Notion Side Peek: slide-in panel with back button
 *   - Radix Dialog/Sheet: overlay transitions
 *
 * activePanel=null → StatusView
 * activePanel='template' → TemplateTab, etc.
 * AnimatePresence for smooth panel transitions with directional slide.
 */
import React, { useEffect, useCallback, useMemo } from 'react'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import {
  ArrowBack as BackIcon,
  Close as CloseIcon,
  Description as TemplateIcon,
  Storage as DataIcon,
  Cable as MappingsIcon,
  AccountTree as LogicIcon,
  Preview as PreviewIcon,
  BugReport as ErrorsIcon,
} from '@mui/icons-material'
import { motion, AnimatePresence } from 'motion/react'
import usePipelineStore from '@/stores/pipeline'

import QuickActionsProvider from './QuickActions'
import StatusView from './StatusView'
import UploadPanel from './UploadPanel'
import EditPanel from './EditPanel'
import MappingPanel from './MappingPanel'
import ValidationPanel from './ValidationPanel'
import GenerationPanel from './GenerationPanel'

// Detail panels (tab components)
import TemplateTab from './tabs/TemplateTab'
import MappingsTab from './tabs/MappingsTab'
import DataTab from './tabs/DataTab'
import LogicTab from './tabs/LogicTab'
import PreviewTab from './tabs/PreviewTab'
import ErrorsTab from './tabs/ErrorsTab'

const DETAIL_PANELS = {
  template: { Component: TemplateTab, label: 'Template', Icon: TemplateIcon },
  mappings: { Component: MappingsTab, label: 'Mappings', Icon: MappingsIcon },
  data:     { Component: DataTab, label: 'Data Explorer', Icon: DataIcon },
  logic:    { Component: LogicTab, label: 'Logic & Rules', Icon: LogicIcon },
  preview:  { Component: PreviewTab, label: 'Preview', Icon: PreviewIcon },
  errors:   { Component: ErrorsTab, label: 'Errors & Validation', Icon: ErrorsIcon },
}

// Legacy panel routing (phase-based, before status_view exists)
const LEGACY_PANELS = {
  upload: UploadPanel,
  edit: EditPanel,
  mapping: MappingPanel,
  validation: ValidationPanel,
  generation: GenerationPanel,
}

// Slide direction: entering detail = slide from right, returning = slide from left
const slideVariants = {
  enterFromRight: { opacity: 0, x: 30 },
  enterFromLeft:  { opacity: 0, x: -30 },
  center:         { opacity: 1, x: 0 },
  exitToLeft:     { opacity: 0, x: -30 },
  exitToRight:    { opacity: 0, x: 30 },
}

export default function LivePanel({ onAction }) {
  const activePanel = usePipelineStore(s => s.activePanel)
  const statusView = usePipelineStore(s => s.statusView)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const sidebarForcePanel = usePipelineStore(s => s.sidebarForcePanel)
  const getPanelType = usePipelineStore(s => s.getPanelType)

  // Escape key closes detail panel
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && activePanel) {
      setActivePanel(null)
    }
  }, [activePanel, setActivePanel])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Is this a detail panel?
  const isDetail = activePanel && DETAIL_PANELS[activePanel]
  const detailConfig = isDetail ? DETAIL_PANELS[activePanel] : null

  // Determine what to render
  const { panelKey, content, direction } = useMemo(() => {
    if (detailConfig) {
      const { Component, label, Icon } = detailConfig
      return {
        panelKey: activePanel,
        direction: 'right',
        content: (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Panel header with back button and title */}
            <Box
              sx={{
                px: 2, py: 1,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'background.default',
              }}
            >
              <Tooltip title="Back to overview (Esc)" arrow>
                <IconButton
                  size="small"
                  onClick={() => setActivePanel(null)}
                  sx={{ color: 'text.secondary' }}
                >
                  <BackIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Icon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 600, fontSize: '0.85rem' }}>
                {label}
              </Typography>
              <Tooltip title="Close (Esc)" arrow>
                <IconButton
                  size="small"
                  onClick={() => setActivePanel(null)}
                  sx={{ color: 'text.disabled' }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
            {/* Panel content */}
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              <Component onAction={onAction} />
            </Box>
          </Box>
        ),
      }
    }

    if (statusView) {
      return {
        panelKey: 'status',
        direction: 'left',
        content: <StatusView onAction={onAction} />,
      }
    }

    // Legacy fallback
    const panelType = sidebarForcePanel || getPanelType()
    const LegacyPanel = LEGACY_PANELS[panelType] || UploadPanel
    return {
      panelKey: `legacy-${panelType}`,
      direction: 'left',
      content: <LegacyPanel onAction={onAction} />,
    }
  }, [activePanel, detailConfig, statusView, sidebarForcePanel, getPanelType, onAction, setActivePanel])

  return (
    <Box
      sx={{
        flex: '0 0 45%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        borderLeft: 1,
        borderColor: 'divider',
      }}
    >
      <QuickActionsProvider onAction={onAction}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={panelKey}
            initial={direction === 'right' ? slideVariants.enterFromRight : slideVariants.enterFromLeft}
            animate={slideVariants.center}
            exit={direction === 'right' ? slideVariants.exitToLeft : slideVariants.exitToRight}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
      </QuickActionsProvider>
    </Box>
  )
}
