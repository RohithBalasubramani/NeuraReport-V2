/**
 * BeforeAfterMorph — Visual transformation from raw rows to final output.
 *
 * References:
 *   - Framer Motion layout animations: bar morphing between states
 *   - D3 transitions: data-driven shape interpolation
 *   - Stripe checkout flow: step-by-step visual compression
 *
 * Covers: V3 (before→after morph with bar animations through stages)
 *
 * Auto-plays through stages (raw→filtered→grouped→final).
 * Click stage label to jump. Bars morph width + count via Framer Motion.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import { motion, AnimatePresence } from 'motion/react'

const STAGE_COLORS = ['#64b5f6', '#66bb6a', '#ffb74d', '#ba68c8']

export default function BeforeAfterMorph({ stages }) {
  const [activeStage, setActiveStage] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)

  // Auto-play through stages
  useEffect(() => {
    if (!stages?.length || !isPlaying) return
    setActiveStage(0)
    let i = 0
    const timer = setInterval(() => {
      i++
      if (i >= stages.length) {
        clearInterval(timer)
        setIsPlaying(false)
        return
      }
      setActiveStage(i)
    }, 1200)
    return () => clearInterval(timer)
  }, [stages, isPlaying])

  const handleStageClick = useCallback((i) => {
    setIsPlaying(false)
    setActiveStage(i)
  }, [])

  const handleReplay = useCallback(() => {
    setIsPlaying(true)
  }, [])

  if (!stages?.length || stages.length < 2) return null

  const stage = stages[activeStage]
  const maxCount = stages[0].count || 1
  const barCount = Math.min(stage.count, 18)
  const scale = barCount / Math.min(maxCount, 18)
  const color = STAGE_COLORS[activeStage % STAGE_COLORS.length]
  const isFinal = activeStage === stages.length - 1

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center' }}>
        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
          Data transformation
        </Typography>
        {!isPlaying && (
          <Typography
            variant="caption"
            color="primary"
            sx={{ fontSize: '0.6rem', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            onClick={handleReplay}
          >
            Replay
          </Typography>
        )}
      </Box>

      <Box sx={{ p: 1.5 }}>
        {/* Stage selector labels */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          {stages.map((s, i) => {
            const isActive = i === activeStage
            const isPast = i <= activeStage
            const sColor = STAGE_COLORS[i % STAGE_COLORS.length]

            return (
              <Tooltip key={i} title={`${s.count.toLocaleString()} rows`} arrow>
                <Typography
                  variant="caption"
                  onClick={() => handleStageClick(i)}
                  sx={{
                    fontSize: '0.65rem',
                    fontWeight: isActive ? 700 : 400,
                    color: isPast ? sColor : '#bdbdbd',
                    cursor: 'pointer',
                    borderBottom: isActive ? `2px solid ${sColor}` : '2px solid transparent',
                    pb: 0.25,
                    transition: 'all 0.2s',
                    '&:hover': { color: sColor },
                  }}
                >
                  {s.label}
                </Typography>
              </Tooltip>
            )
          })}
        </Box>

        {/* Animated bars */}
        <Box sx={{ position: 'relative', height: 90, overflow: 'hidden' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStage}
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -8 }}
              transition={{ duration: 0.35 }}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 1,
              }}
            >
              {/* Bar rows */}
              {Array.from({ length: Math.max(barCount, 1) }).map((_, j) => (
                <motion.div
                  key={j}
                  initial={{ width: '100%', opacity: 0.2 }}
                  animate={{
                    width: `${Math.max(scale * 100, 15)}%`,
                    opacity: isFinal ? 0.9 : 0.65,
                  }}
                  transition={{
                    duration: 0.5,
                    delay: j * 0.02,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  style={{
                    height: Math.max(65 / Math.max(barCount, 1) - 1, 2),
                    backgroundColor: color,
                    borderRadius: 3,
                  }}
                />
              ))}

              {/* Count label */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 }}
              >
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color, fontWeight: 600, mt: 0.25 }}>
                  {stage.count.toLocaleString()} rows
                </Typography>
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </Box>

        {/* Progress dots */}
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5, mt: 0.5 }}>
          {stages.map((_, i) => (
            <Box
              key={i}
              onClick={() => handleStageClick(i)}
              sx={{
                width: i === activeStage ? 12 : 6,
                height: 6,
                borderRadius: 3,
                bgcolor: i <= activeStage ? STAGE_COLORS[i % STAGE_COLORS.length] : '#e0e0e0',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  )
}
