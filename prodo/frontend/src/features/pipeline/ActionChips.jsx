/**
 * ActionChips — dynamic action buttons above the chat input.
 * Uses clsx for state-based conditional styling.
 * Derived from pipeline phase + errors + confidence.
 */
import React, { useMemo } from 'react'
import { Box, Chip, Stack } from '@mui/material'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'

export default function ActionChips({ onAction }) {
  const pipelineState = usePipelineStore(s => s.pipelineState)
  const getActionChips = usePipelineStore(s => s.getActionChips)
  const chips = useMemo(() => getActionChips(), [pipelineState])

  if (!chips.length) return null

  return (
    <Box sx={{ px: 2, py: 0.75 }}>
      <Stack direction="row" flexWrap="wrap" gap={0.75}>
        {chips.map((chip, i) => (
          <Chip
            key={`${chip.action}-${i}`}
            label={chip.label}
            size="small"
            color={chip.priority ? 'error' : chip.variant === 'outlined' ? 'default' : 'primary'}
            variant={chip.priority ? 'filled' : chip.variant || 'outlined'}
            onClick={() => onAction?.(chip.action)}
            className={clsx('action-chip', {
              'action-chip--priority': chip.priority,
              'action-chip--secondary': chip.variant === 'outlined',
            })}
            sx={{
              cursor: 'pointer',
              fontWeight: chip.priority ? 600 : 400,
              opacity: chip.variant === 'outlined' ? 0.7 : 1,
              transition: 'all 0.15s ease',
              '&:hover': {
                bgcolor: chip.priority ? 'error.dark' : 'action.hover',
                opacity: 1,
                transform: 'translateY(-1px)',
              },
            }}
          />
        ))}
      </Stack>
    </Box>
  )
}
