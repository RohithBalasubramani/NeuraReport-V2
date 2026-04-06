/**
 * PipelineStrip (#1) — Living horizontal pipeline with animated blocks.
 * Uses Framer Motion for step entrance, pulse, and shake animations.
 */
import React, { useMemo } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import { Check as CheckIcon, Warning as WarnIcon } from '@mui/icons-material'
import { motion } from 'motion/react'
import usePipelineStore from '@/stores/pipeline'

const STEP_PANELS = {
  upload: 'template',
  edit: 'template',
  map: 'mappings',
  validate: 'errors',
  generate: 'preview',
}

export default function PipelineStrip() {
  const getPipelineSteps = usePipelineStore((s) => s.getPipelineSteps)
  const setActivePanel = usePipelineStore((s) => s.setActivePanel)
  const statusView = usePipelineStore((s) => s.statusView)
  const steps = useMemo(() => getPipelineSteps(), [getPipelineSteps])

  // Detect problems by step
  const problemSteps = useMemo(() => {
    const set = new Set()
    statusView?.problems?.forEach((p) => {
      if (p.panel) set.add(p.panel)
    })
    return set
  }, [statusView?.problems])

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, width: '100%', py: 1 }}>
      {steps.map((step, i) => {
        const isDone = step.status === 'done'
        const isActive = step.status === 'active'
        const hasProblem = problemSteps.has(STEP_PANELS[step.id])

        return (
          <React.Fragment key={step.id}>
            {/* Connector line */}
            {i > 0 && (
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: i * 0.1, duration: 0.3 }}
                style={{
                  flex: '0 0 auto',
                  width: 24,
                  height: 2,
                  backgroundColor: isDone || isActive ? '#4CAF50' : '#e0e0e0',
                  transformOrigin: 'left',
                  ...(isActive && !isDone && {
                    background: 'linear-gradient(90deg, #4CAF50 0%, transparent 100%)',
                  }),
                }}
              />
            )}

            {/* Step block */}
            <Tooltip title={step.label} arrow>
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  ...(isActive && !hasProblem ? { scale: [1, 1.03, 1] } : {}),
                  ...(hasProblem ? { x: [-3, 3, -3, 3, 0] } : {}),
                }}
                transition={{
                  delay: i * 0.08,
                  type: 'spring',
                  stiffness: 500,
                  damping: 25,
                  ...(isActive && !hasProblem ? { scale: { repeat: Infinity, duration: 2, ease: 'easeInOut' } } : {}),
                  ...(hasProblem ? { x: { duration: 0.5 } } : {}),
                }}
                onClick={() => setActivePanel(STEP_PANELS[step.id] || null)}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                {/* Block */}
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '2px solid',
                    transition: 'all 0.3s ease',
                    '&:hover': { transform: 'translateY(-2px)' },

                    // Done
                    ...(isDone && {
                      bgcolor: 'success.main',
                      borderColor: 'success.main',
                      color: 'white',
                    }),

                    // Active
                    ...(isActive && !hasProblem && {
                      borderColor: 'primary.main',
                      bgcolor: 'primary.50',
                      color: 'primary.main',
                      boxShadow: 2,
                    }),

                    // Problem
                    ...(hasProblem && {
                      borderColor: 'warning.main',
                      bgcolor: 'warning.50',
                      color: 'warning.main',
                    }),

                    // Pending
                    ...(!isDone && !isActive && !hasProblem && {
                      borderColor: 'divider',
                      bgcolor: 'background.default',
                      color: 'text.disabled',
                    }),
                  }}
                >
                  {isDone ? (
                    <CheckIcon sx={{ fontSize: 20 }} />
                  ) : hasProblem ? (
                    <WarnIcon sx={{ fontSize: 20 }} />
                  ) : (
                    <Typography variant="caption" fontWeight={700}>
                      {i + 1}
                    </Typography>
                  )}
                </Box>

                {/* Label */}
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: '0.65rem',
                    fontWeight: isActive ? 700 : 400,
                    color: isDone ? 'success.main' : isActive ? 'primary.main' : 'text.disabled',
                    textAlign: 'center',
                    lineHeight: 1.2,
                  }}
                >
                  {step.label}
                </Typography>
              </motion.div>
            </Tooltip>
          </React.Fragment>
        )
      })}
    </Box>
  )
}
