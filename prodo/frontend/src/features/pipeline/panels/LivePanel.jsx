/**
 * LivePanel — routes between StatusView (default) and detail panels.
 * activePanel=null -> StatusView. activePanel='template' -> TemplateTab, etc.
 * Uses Framer Motion AnimatePresence for smooth panel transitions.
 */
import React from 'react'
import { Box, Button } from '@mui/material'
import { ArrowBack as BackIcon } from '@mui/icons-material'
import { motion, AnimatePresence } from 'motion/react'
import usePipelineStore from '@/stores/pipeline'

import QuickActionsProvider from './QuickActions'
import StatusView from './StatusView'
import UploadPanel from './UploadPanel'
import EditPanel from './EditPanel'
import MappingPanel from './MappingPanel'
import ValidationPanel from './ValidationPanel'
import GenerationPanel from './GenerationPanel'

// Detail panels — lazy-loaded tab components
import TemplateTab from './tabs/TemplateTab'
import MappingsTab from './tabs/MappingsTab'
import DataTab from './tabs/DataTab'
import LogicTab from './tabs/LogicTab'
import PreviewTab from './tabs/PreviewTab'
import ErrorsTab from './tabs/ErrorsTab'

const DETAIL_PANELS = {
  template: TemplateTab,
  mappings: MappingsTab,
  data: DataTab,
  logic: LogicTab,
  preview: PreviewTab,
  errors: ErrorsTab,
}

// Legacy panel routing (when no status_view yet, use phase-based panels)
const LEGACY_PANELS = {
  upload: UploadPanel,
  edit: EditPanel,
  mapping: MappingPanel,
  validation: ValidationPanel,
  generation: GenerationPanel,
}

export default function LivePanel({ onAction }) {
  const activePanel = usePipelineStore(s => s.activePanel)
  const statusView = usePipelineStore(s => s.statusView)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const sidebarForcePanel = usePipelineStore(s => s.sidebarForcePanel)
  const getPanelType = usePipelineStore(s => s.getPanelType)

  // Determine panel key and content
  let panelKey = 'status'
  let content

  if (activePanel && DETAIL_PANELS[activePanel]) {
    panelKey = activePanel
    const Panel = DETAIL_PANELS[activePanel]
    content = (
      <>
        <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
          <Button
            size="small"
            startIcon={<BackIcon sx={{ fontSize: 16 }} />}
            onClick={() => setActivePanel(null)}
            sx={{ textTransform: 'none', color: 'text.secondary', fontSize: '0.8rem' }}
          >
            Back to overview
          </Button>
        </Box>
        <Panel onAction={onAction} />
      </>
    )
  } else if (statusView) {
    panelKey = 'status'
    content = <StatusView onAction={onAction} />
  } else {
    const panelType = sidebarForcePanel || getPanelType()
    panelKey = `legacy-${panelType}`
    const LegacyPanel = LEGACY_PANELS[panelType] || UploadPanel
    content = <LegacyPanel onAction={onAction} />
  }

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
        <AnimatePresence mode="wait">
          <motion.div
            key={panelKey}
            initial={{ opacity: 0, x: activePanel ? 20 : -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: activePanel ? -20 : 20 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
      </QuickActionsProvider>
    </Box>
  )
}
