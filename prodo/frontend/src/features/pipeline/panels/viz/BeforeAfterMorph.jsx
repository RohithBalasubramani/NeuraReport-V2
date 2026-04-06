/**
 * BeforeAfterMorph (#3) — Visual transformation from raw rows to final output.
 * Uses Framer Motion for smooth morphing between stages.
 * Rows represented as bars that merge/collapse through stages.
 */
import React, { useState, useEffect } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import { motion, AnimatePresence } from 'motion/react'

const STAGE_COLORS = ['#90CAF9', '#66BB6A', '#FFB74D']

export default function BeforeAfterMorph({ stages }) {
  const [activeStage, setActiveStage] = useState(0)

  // Auto-play through stages
  useEffect(() => {
    if (!stages?.length) return
    setActiveStage(0)
    const interval = setInterval(() => {
      setActiveStage((prev) => {
        if (prev >= stages.length - 1) {
          clearInterval(interval)
          return prev
        }
        return prev + 1
      })
    }, 1200)
    return () => clearInterval(interval)
  }, [stages])

  if (!stages?.length || stages.length < 2) return null

  const maxCount = stages[0].count || 1

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" fontWeight={600}>
          Data transformation
        </Typography>
      </Box>

      <Box sx={{ p: 1.5 }}>
        {/* Stage labels */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          {stages.map((stage, i) => (
            <Tooltip key={i} title={`${stage.count} rows`} arrow>
              <motion.span
                onClick={() => setActiveStage(i)}
                animate={{
                  fontWeight: i === activeStage ? 700 : 400,
                  color: i <= activeStage ? (STAGE_COLORS[i] || '#999') : '#bbb',
                }}
                transition={{ duration: 0.3 }}
                style={{
                  fontSize: '0.65rem',
                  cursor: 'pointer',
                  borderBottom: i === activeStage ? `2px solid ${STAGE_COLORS[i] || '#999'}` : '2px solid transparent',
                  paddingBottom: 2,
                  display: 'inline-block',
                }}
              >
                {stage.label}
              </motion.span>
            </Tooltip>
          ))}
        </Box>

        {/* Animated bars */}
        <Box sx={{ position: 'relative', height: 80, overflow: 'hidden' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStage}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 2,
              }}
            >
              {(() => {
                const stage = stages[activeStage]
                const barCount = Math.min(stage.count, 20)
                const scale = barCount / Math.min(stages[0].count, 20)
                const color = STAGE_COLORS[activeStage] || '#ccc'
                const isFinal = activeStage === stages.length - 1

                return (
                  <>
                    {Array.from({ length: Math.max(barCount, 1) }).map((_, barIdx) => (
                      <motion.div
                        key={barIdx}
                        initial={{ width: '100%', opacity: 0.3 }}
                        animate={{
                          width: `${Math.max(scale * 100, 20)}%`,
                          opacity: isFinal ? 0.9 : 0.7,
                        }}
                        transition={{
                          duration: 0.6,
                          delay: barIdx * 0.02,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        style={{
                          height: Math.max(60 / Math.max(barCount, 1) - 2, 2),
                          backgroundColor: color,
                          borderRadius: 3,
                        }}
                      />
                    ))}

                    {/* Count label */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: '0.65rem',
                          color,
                          fontWeight: 600,
                          mt: 0.25,
                        }}
                      >
                        {stage.count.toLocaleString()} rows
                      </Typography>
                    </motion.div>
                  </>
                )
              })()}
            </motion.div>
          </AnimatePresence>
        </Box>
      </Box>
    </Box>
  )
}
