/**
 * ErrorBreakage — Errors visualized as broken/snapped connections.
 *
 * References:
 *   - Sentry Error Timeline: severity-colored items, click-to-navigate
 *   - GitHub Actions: red X with broken connection lines
 *   - Datadog Trace: broken spans with pulse on break point
 *
 * Covers: V5 (error as breakage with SVG broken lines + pulse)
 *         S7 (problems list with fix-click navigation)
 *
 * Each problem renders as: [field node] —//— [??? node]
 * Click → navigate to panel + highlight field. Pulse animation on break point.
 */
import React, { useCallback } from 'react'
import { Box, Stack, Tooltip, Typography, Chip } from '@mui/material'
import { motion, AnimatePresence } from 'motion/react'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken } from '../../utils'

// Severity → color palette
const SEVERITY = {
  error:   { main: '#d32f2f', light: '#ef9a9a', bg: '#ffebee' },
  warning: { main: '#ed6c02', light: '#ffcc80', bg: '#fff3e0' },
  info:    { main: '#0288d1', light: '#81d4fa', bg: '#e1f5fe' },
}

function BrokenConnection({ problem, index }) {
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)

  const sev = SEVERITY[problem.severity] || SEVERITY.error
  const hasField = !!problem.field
  const fieldLabel = hasField ? humanizeToken(problem.field) : 'Issue'
  const targetLabel = problem.target || '???'

  const handleClick = useCallback(() => {
    if (problem.panel) setActivePanel(problem.panel)
    if (problem.field) setHighlightedField(problem.field)
  }, [problem, setActivePanel, setHighlightedField])

  return (
    <Tooltip
      title={
        <Box sx={{ p: 0.5 }}>
          <Typography variant="caption" fontWeight={600} display="block">{problem.text}</Typography>
          {problem.fix && (
            <Typography variant="caption" color="success.light" display="block" sx={{ mt: 0.25 }}>
              Fix: {problem.fix}
            </Typography>
          )}
        </Box>
      }
      arrow
      placement="right"
    >
      <motion.div
        initial={{ x: -12, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ opacity: 0, x: -20, height: 0, marginTop: 0 }}
        transition={{ delay: index * 0.08, type: 'spring', stiffness: 400, damping: 22 }}
        onClick={handleClick}
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 0 }}
      >
        {/* Left node: field label */}
        <Box
          sx={{
            px: 1.25, py: 0.4,
            borderRadius: 1,
            bgcolor: sev.bg,
            border: '1.5px solid',
            borderColor: sev.light,
            transition: 'transform 0.15s',
            '&:hover': { transform: 'scale(1.03)' },
          }}
        >
          <Typography variant="caption" fontWeight={600} sx={{ fontSize: '0.68rem', color: sev.main }}>
            {fieldLabel}
          </Typography>
        </Box>

        {/* Broken SVG connection line */}
        <svg width="64" height="22" viewBox="0 0 64 22" style={{ flexShrink: 0 }}>
          {/* Left dashed segment */}
          <line x1="0" y1="11" x2="22" y2="11" stroke={sev.main} strokeWidth="2" strokeDasharray="4,2" />
          {/* Break point — two angled lines with pulse */}
          <motion.g
            animate={{
              opacity: [0.6, 1, 0.6],
              scale: [1, 1.15, 1],
            }}
            transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
            style={{ transformOrigin: '32px 11px' }}
          >
            <line x1="25" y1="4" x2="29" y2="18" stroke={sev.main} strokeWidth="2.5" strokeLinecap="round" />
            <line x1="35" y1="4" x2="39" y2="18" stroke={sev.main} strokeWidth="2.5" strokeLinecap="round" />
          </motion.g>
          {/* Right faded segment */}
          <line x1="42" y1="11" x2="64" y2="11" stroke={sev.main} strokeWidth="2" strokeDasharray="4,2" opacity="0.3" />
        </svg>

        {/* Right node: missing target */}
        <Box
          sx={{
            px: 1.25, py: 0.4,
            borderRadius: 1,
            border: '1.5px dashed',
            borderColor: sev.light,
            bgcolor: 'transparent',
          }}
        >
          <Typography variant="caption" sx={{ fontSize: '0.68rem', color: 'text.disabled' }}>
            {targetLabel}
          </Typography>
        </Box>

        {/* Fix hint chip */}
        {problem.fix && (
          <Chip
            label="Fix"
            size="small"
            sx={{
              ml: 0.75,
              height: 18,
              fontSize: '0.58rem',
              bgcolor: sev.bg,
              color: sev.main,
              border: `1px solid ${sev.light}`,
              cursor: 'pointer',
              '&:hover': { bgcolor: sev.light },
            }}
          />
        )}
      </motion.div>
    </Tooltip>
  )
}

export default function ErrorBreakage({ problems }) {
  if (!problems?.length) return null

  const errorCount = problems.filter(p => p.severity === 'error').length
  const warnCount = problems.filter(p => p.severity === 'warning').length

  return (
    <Box sx={{ border: 1, borderColor: 'error.light', borderRadius: 2, overflow: 'hidden' }}>
      {/* Header */}
      <Box
        sx={{
          px: 1.5, py: 0.75,
          borderBottom: 1,
          borderColor: 'error.light',
          bgcolor: '#ffebee',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Typography variant="caption" fontWeight={600} color="error.main" sx={{ flex: 1 }}>
          Needs attention
        </Typography>
        {errorCount > 0 && (
          <Chip label={`${errorCount} error${errorCount > 1 ? 's' : ''}`} size="small" color="error" sx={{ height: 18, fontSize: '0.58rem' }} />
        )}
        {warnCount > 0 && (
          <Chip label={`${warnCount} warning${warnCount > 1 ? 's' : ''}`} size="small" color="warning" sx={{ height: 18, fontSize: '0.58rem' }} />
        )}
      </Box>

      {/* Problem list */}
      <Box sx={{ p: 1.5 }}>
        <Stack spacing={1}>
          <AnimatePresence>
            {problems.map((p, i) => (
              <BrokenConnection key={p.field || p.text || i} problem={p} index={i} />
            ))}
          </AnimatePresence>
        </Stack>
      </Box>
    </Box>
  )
}
