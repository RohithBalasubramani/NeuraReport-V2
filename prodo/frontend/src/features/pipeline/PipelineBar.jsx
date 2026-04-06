/**
 * PipelineBar — horizontal stepper showing pipeline progress.
 * Steps are derived from store. Blocked steps show tooltip. Clickable when accessible.
 */
import React, { useMemo } from 'react'
import { Box, Chip, Tooltip, Typography } from '@mui/material'
import {
  CheckCircle as DoneIcon,
  RadioButtonUnchecked as PendingIcon,
  FiberManualRecord as ActiveIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'

const STATUS_STYLE = {
  done: { color: 'success.main', Icon: DoneIcon },
  active: { color: 'primary.main', Icon: ActiveIcon },
  pending: { color: 'grey.400', Icon: PendingIcon },
}

export default function PipelineBar({ onStepClick }) {
  // Select raw state — compute steps locally to avoid infinite re-render
  const pipelineState = usePipelineStore(s => s.pipelineState)
  const getPipelineSteps = usePipelineStore(s => s.getPipelineSteps)
  const steps = useMemo(() => getPipelineSteps(), [pipelineState])

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mr: 1, fontWeight: 600 }}>
        Pipeline
      </Typography>
      {steps.map((step, i) => {
        const style = STATUS_STYLE[step.status] || STATUS_STYLE.pending
        const Icon = style.Icon
        const disabled = !step.canEnter

        const chip = (
          <Chip
            key={step.id}
            icon={
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Icon
                  sx={{
                    fontSize: 16,
                    color: disabled ? 'grey.300' : style.color,
                    ...(step.status === 'active' && {
                      animation: 'pulse 1.5s ease-in-out infinite',
                      '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
                    }),
                  }}
                />
                {step.hasWarning && (
                  <WarningIcon sx={{ fontSize: 12, color: 'warning.main', ml: -0.5, mt: -1 }} />
                )}
              </Box>
            }
            label={step.label}
            size="small"
            variant={step.status === 'active' ? 'filled' : 'outlined'}
            color={step.status === 'done' ? 'success' : step.status === 'active' ? 'primary' : 'default'}
            onClick={disabled ? undefined : () => onStepClick?.(step.id)}
            sx={{
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              fontWeight: step.status === 'active' ? 600 : 400,
            }}
          />
        )

        return (
          <React.Fragment key={step.id}>
            {i > 0 && (
              <Box
                sx={{
                  width: 16,
                  height: 2,
                  bgcolor: step.status === 'done' ? 'success.main' : 'grey.300',
                  borderRadius: 1,
                }}
              />
            )}
            {disabled && step.reason ? (
              <Tooltip title={step.reason} arrow>
                <span>{chip}</span>
              </Tooltip>
            ) : (
              chip
            )}
          </React.Fragment>
        )
      })}
    </Box>
  )
}
