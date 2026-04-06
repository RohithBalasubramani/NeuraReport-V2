/**
 * PanelButtons — toggle buttons in chat area for drill-in panels.
 * Progressive visibility: buttons appear as pipeline advances.
 * Click = switch panel, click active = return to status view.
 */
import React from 'react'
import { Box, ToggleButton, ToggleButtonGroup, Badge, Tooltip } from '@mui/material'
import {
  Description as TemplateIcon,
  Storage as DataIcon,
  LinkOff as MappingsIcon,
  AccountTree as LogicIcon,
  Preview as PreviewIcon,
  BugReport as ErrorsIcon,
} from '@mui/icons-material'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'

const PANEL_BUTTONS = [
  { id: 'template', label: 'Template', Icon: TemplateIcon },
  { id: 'data', label: 'Data', Icon: DataIcon },
  { id: 'mappings', label: 'Mappings', Icon: MappingsIcon },
  { id: 'logic', label: 'Logic', Icon: LogicIcon },
  { id: 'preview', label: 'Preview', Icon: PreviewIcon },
  { id: 'errors', label: 'Errors', Icon: ErrorsIcon },
]

export default function PanelButtons() {
  const activePanel = usePipelineStore(s => s.activePanel)
  const availablePanels = usePipelineStore(s => s.availablePanels)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const workspaceMode = usePipelineStore(s => s.workspaceMode)
  const errors = usePipelineStore(s => s.pipelineState.errors)

  const errorCount = errors?.filter(e => e.severity === 'error')?.length || 0
  const visible = workspaceMode
    ? PANEL_BUTTONS
    : PANEL_BUTTONS.filter(b => availablePanels.includes(b.id))

  if (visible.length === 0) return null

  return (
    <Box sx={{ px: 2, pb: 0.5 }}>
      <ToggleButtonGroup
        value={activePanel}
        exclusive
        onChange={(_, val) => setActivePanel(val)}
        size="small"
        sx={{ flexWrap: 'wrap', gap: 0.5 }}
      >
        {visible.map(({ id, label, Icon }) => (
          <Tooltip key={id} title={label} arrow>
            <ToggleButton
              value={id}
              className={clsx('panel-btn', {
                'panel-btn--active': activePanel === id,
                'panel-btn--error': id === 'errors' && errorCount > 0,
              })}
              sx={{
                textTransform: 'none',
                px: 1.5,
                py: 0.5,
                fontSize: '0.75rem',
                gap: 0.5,
                borderRadius: '16px !important',
                border: '1px solid',
                borderColor: 'divider',
                transition: 'all 0.15s ease',
                '&:hover': { transform: 'translateY(-1px)' },
              }}
            >
              {id === 'errors' && errorCount > 0 ? (
                <Badge badgeContent={errorCount} color="error" sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 16, minWidth: 16 } }}>
                  <Icon sx={{ fontSize: 16 }} />
                </Badge>
              ) : (
                <Icon sx={{ fontSize: 16 }} />
              )}
              {label}
            </ToggleButton>
          </Tooltip>
        ))}
      </ToggleButtonGroup>
    </Box>
  )
}
