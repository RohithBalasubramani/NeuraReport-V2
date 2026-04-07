/**
 * PanelButtons — Toggle buttons for drill-in panels (S9).
 *
 * References:
 *   - VS Code Activity Bar: icon toggles with badge for problems
 *   - Slack Channel Tabs: pill toggles with progressive reveal
 *   - Figma Layer Panel: compact icon+label, exclusive selection
 *
 * Progressive visibility: buttons appear as pipeline advances.
 * Click active button = return to StatusView (null panel).
 */
import React, { useMemo } from 'react'
import { Box, Badge, Tooltip, Typography } from '@mui/material'
import {
  Description as TemplateIcon,
  Storage as DataIcon,
  Cable as MappingsIcon,
  AccountTree as LogicIcon,
  Preview as PreviewIcon,
  BugReport as ErrorsIcon,
} from '@mui/icons-material'
import { motion, AnimatePresence } from 'motion/react'
import usePipelineStore from '@/stores/pipeline'

const PANEL_BUTTONS = [
  { id: 'template', label: 'Template', Icon: TemplateIcon, tooltip: 'View and edit report template' },
  { id: 'data', label: 'Data', Icon: DataIcon, tooltip: 'Explore database tables and columns' },
  { id: 'mappings', label: 'Mappings', Icon: MappingsIcon, tooltip: 'Field-to-column mapping table' },
  { id: 'logic', label: 'Logic', Icon: LogicIcon, tooltip: 'Contract rules, joins, and lineage' },
  { id: 'preview', label: 'Preview', Icon: PreviewIcon, tooltip: 'Preview generated report data' },
  { id: 'errors', label: 'Errors', Icon: ErrorsIcon, tooltip: 'Validation issues and performance' },
]

function PanelButton({ id, label, Icon, tooltip, isActive, errorCount, warningCount, onClick }) {
  const hasBadge = id === 'errors' && (errorCount > 0 || warningCount > 0)
  const badgeCount = errorCount + warningCount
  const badgeColor = errorCount > 0 ? 'error' : 'warning'

  return (
    <Tooltip title={tooltip} arrow placement="bottom" enterDelay={300}>
      <motion.button
        layout
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        onClick={onClick}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 12px',
          borderRadius: 16,
          border: `1.5px solid ${isActive ? '#1565c0' : '#e0e0e0'}`,
          backgroundColor: isActive ? '#e3f2fd' : 'transparent',
          color: isActive ? '#1565c0' : '#757575',
          cursor: 'pointer',
          fontSize: '0.75rem',
          fontWeight: isActive ? 600 : 400,
          fontFamily: 'inherit',
          outline: 'none',
          transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
        }}
      >
        {hasBadge ? (
          <Badge
            badgeContent={badgeCount}
            color={badgeColor}
            sx={{ '& .MuiBadge-badge': { fontSize: 9, height: 15, minWidth: 15, top: -2, right: -4 } }}
          >
            <Icon sx={{ fontSize: 16 }} />
          </Badge>
        ) : (
          <Icon sx={{ fontSize: 16 }} />
        )}
        <span>{label}</span>
        {/* Active dot indicator */}
        {isActive && (
          <motion.div
            layoutId="panel-active-dot"
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: '#1565c0',
              marginLeft: 2,
            }}
          />
        )}
      </motion.button>
    </Tooltip>
  )
}

export default function PanelButtons() {
  const activePanel = usePipelineStore(s => s.activePanel)
  const availablePanels = usePipelineStore(s => s.availablePanels)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const workspaceMode = usePipelineStore(s => s.workspaceMode)
  const errors = usePipelineStore(s => s.pipelineState.errors)

  const { errorCount, warningCount } = useMemo(() => ({
    errorCount: (errors || []).filter(e => e.severity === 'error').length,
    warningCount: (errors || []).filter(e => e.severity === 'warning').length,
  }), [errors])

  const visible = workspaceMode
    ? PANEL_BUTTONS
    : PANEL_BUTTONS.filter(b => availablePanels.includes(b.id))

  if (visible.length === 0) return null

  return (
    <Box sx={{ px: 2, pb: 0.5 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
        <AnimatePresence>
          {visible.map(btn => (
            <PanelButton
              key={btn.id}
              {...btn}
              isActive={activePanel === btn.id}
              errorCount={errorCount}
              warningCount={warningCount}
              onClick={() => setActivePanel(btn.id)}
            />
          ))}
        </AnimatePresence>
      </Box>
    </Box>
  )
}
