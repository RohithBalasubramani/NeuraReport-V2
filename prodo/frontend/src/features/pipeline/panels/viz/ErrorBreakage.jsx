/**
 * ErrorBreakage (#5) — Errors shown as broken/snapped connections, not text.
 * Uses Framer Motion for entrance animations and AnimatePresence for add/remove.
 * Click the break point to jump to the fix.
 */
import React from 'react'
import { Box, Stack, Tooltip, Typography } from '@mui/material'
import { motion, AnimatePresence } from 'motion/react'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken } from '../../utils'

function BrokenConnection({ problem, index }) {
  const setActivePanel = usePipelineStore((s) => s.setActivePanel)
  const setHighlightedField = usePipelineStore((s) => s.setHighlightedField)

  const hasField = !!problem.field
  const fieldLabel = hasField ? humanizeToken(problem.field) : 'Unknown'

  const handleClick = () => {
    if (problem.panel) setActivePanel(problem.panel)
    if (problem.field) setHighlightedField(problem.field)
  }

  return (
    <Tooltip title={`Click to fix: ${problem.text}`} arrow>
      <motion.div
        initial={{ x: -10, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ opacity: 0, x: -20, height: 0 }}
        transition={{ delay: index * 0.1, type: 'spring', stiffness: 500, damping: 25 }}
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          cursor: 'pointer',
        }}
      >
        {/* Left node — template field */}
        <motion.div
          animate={hasField ? { scale: [1, 1.02, 1] } : {}}
          transition={hasField ? { repeat: Infinity, duration: 2, ease: 'easeInOut' } : {}}
        >
          <Box
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              bgcolor: 'error.50',
              border: '1px solid',
              borderColor: 'error.light',
            }}
          >
            <Typography variant="caption" fontWeight={600} color="error.main" sx={{ fontSize: '0.7rem' }}>
              {fieldLabel}
            </Typography>
          </Box>
        </motion.div>

        {/* Connection line — broken */}
        <svg width="60" height="20" viewBox="0 0 60 20" style={{ flexShrink: 0 }}>
          <line x1="0" y1="10" x2="22" y2="10" stroke="#f44336" strokeWidth="2" strokeDasharray="4,2" />
          <g
            className="break-point"
            style={{ transition: 'transform 0.2s', transformOrigin: '30px 10px' }}
          >
            <line x1="24" y1="4" x2="28" y2="16" stroke="#f44336" strokeWidth="2.5" />
            <line x1="32" y1="4" x2="36" y2="16" stroke="#f44336" strokeWidth="2.5" />
          </g>
          <line x1="38" y1="10" x2="60" y2="10" stroke="#f44336" strokeWidth="2" strokeDasharray="4,2" opacity="0.4" />
        </svg>

        {/* Right node — missing source */}
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            border: '1px dashed',
            borderColor: 'error.light',
            bgcolor: 'transparent',
          }}
        >
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem' }}>
            ???
          </Typography>
        </Box>
      </motion.div>
    </Tooltip>
  )
}

export default function ErrorBreakage({ problems }) {
  if (!problems?.length) return null

  return (
    <Box>
      <Typography variant="caption" color="error.main" fontWeight={600} sx={{ mb: 0.75, display: 'block' }}>
        Needs attention
      </Typography>
      <Stack spacing={1}>
        <AnimatePresence>
          {problems.map((p, i) => (
            <BrokenConnection key={p.field || p.text || i} problem={p} index={i} />
          ))}
        </AnimatePresence>
      </Stack>
    </Box>
  )
}
