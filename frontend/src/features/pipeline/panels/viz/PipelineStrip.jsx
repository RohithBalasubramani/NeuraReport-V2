/**
 * PipelineStrip — Living horizontal pipeline stepper.
 *
 * References:
 *   - Ant Design Steps: status-driven icons, click navigation
 *   - MUI Stepper: alternativeLabel layout, connector progress
 *   - Retool Workflows: pulse on active, shake on error
 *
 * Covers: S1 (current step summary), S4 (data flow layman), V1 (living pipeline strip)
 */
import React, { useMemo, useCallback } from 'react'
import { Box, Tooltip, Typography } from '@mui/material'
import {
  Check as CheckIcon,
  Warning as WarnIcon,
  CloudUpload as UploadIcon,
  Brush as DesignIcon,
  Cable as ConnectIcon,
  FactCheck as ReviewIcon,
  Description as GenerateIcon,
} from '@mui/icons-material'
import { motion, AnimatePresence } from 'motion/react'
import usePipelineStore from '@/stores/pipeline'

// Step → panel mapping for click navigation
const STEP_PANELS = {
  upload: 'template',
  edit: 'template',
  map: 'mappings',
  validate: 'errors',
  generate: 'preview',
}

// Step icons for each phase
const STEP_ICONS = {
  upload: UploadIcon,
  edit: DesignIcon,
  map: ConnectIcon,
  validate: ReviewIcon,
  generate: GenerateIcon,
}

// Tooltip descriptions for each step (layman S4)
const STEP_DESCRIPTIONS = {
  upload: 'Upload your report PDF or template',
  edit: 'Design and customize your report layout',
  map: 'Connect template fields to your database',
  validate: 'Review data and fix any issues',
  generate: 'Generate final reports from your data',
}

// Color constants
const COLORS = {
  done: '#2e7d32',
  doneBg: '#e8f5e9',
  active: '#1565c0',
  activeBg: '#e3f2fd',
  warn: '#ed6c02',
  warnBg: '#fff3e0',
  pending: '#bdbdbd',
  pendingBg: '#fafafa',
  connector: '#e0e0e0',
  connectorFill: '#4caf50',
}

// ── Connector Line ──
function Connector({ fromDone, toDone, toActive, index }) {
  // Fill ratio: 1 if both done, 0.5 if from done to active, 0 otherwise
  const fillRatio = fromDone && toDone ? 1 : fromDone && toActive ? 0.5 : 0

  return (
    <Box sx={{ flex: '0 0 auto', width: 20, display: 'flex', alignItems: 'center', position: 'relative' }}>
      {/* Background track */}
      <Box sx={{ width: '100%', height: 2, bgcolor: COLORS.connector, borderRadius: 1 }} />
      {/* Progress fill */}
      {fillRatio > 0 && (
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: fillRatio }}
          transition={{ delay: index * 0.1 + 0.15, duration: 0.4, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: '100%',
            height: 2,
            backgroundColor: COLORS.connectorFill,
            transformOrigin: 'left center',
            borderRadius: 1,
          }}
        />
      )}
    </Box>
  )
}

// ── Step Node ──
const StepNode = React.memo(function StepNode({ step, index, hasProblem, onClick }) {
  const isDone = step.status === 'done'
  const isActive = step.status === 'active'
  const Icon = STEP_ICONS[step.id]

  // Determine visual state
  const state = hasProblem ? 'warn' : isDone ? 'done' : isActive ? 'active' : 'pending'

  const colorMap = {
    done: { border: COLORS.done, bg: COLORS.doneBg, text: COLORS.done },
    active: { border: COLORS.active, bg: COLORS.activeBg, text: COLORS.active },
    warn: { border: COLORS.warn, bg: COLORS.warnBg, text: COLORS.warn },
    pending: { border: COLORS.pending, bg: COLORS.pendingBg, text: '#9e9e9e' },
  }
  const c = colorMap[state]

  // Build tooltip content
  const tooltipContent = (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="caption" fontWeight={600} display="block">{step.label}</Typography>
      <Typography variant="caption" color="text.secondary">{STEP_DESCRIPTIONS[step.id]}</Typography>
      {hasProblem && (
        <Typography variant="caption" color="warning.main" display="block" sx={{ mt: 0.5 }}>
          Issues need attention
        </Typography>
      )}
      {!step.canEnter && step.reason && (
        <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
          {step.reason}
        </Typography>
      )}
    </Box>
  )

  // Framer Motion animation variants
  const variants = {
    initial: { scale: 0.7, opacity: 0 },
    enter: { scale: 1, opacity: 1 },
    pulse: {
      scale: [1, 1.06, 1],
      transition: { repeat: Infinity, duration: 2.2, ease: 'easeInOut' },
    },
    shake: {
      x: [0, -3, 3, -3, 3, 0],
      transition: { duration: 0.5, ease: 'easeInOut' },
    },
  }

  const animateState = hasProblem ? 'shake' : isActive ? 'pulse' : 'enter'

  return (
    <Tooltip title={tooltipContent} arrow placement="bottom" enterDelay={200}>
      <motion.div
        variants={variants}
        initial="initial"
        animate={animateState}
        transition={{
          delay: index * 0.08,
          type: 'spring',
          stiffness: 400,
          damping: 20,
        }}
        onClick={onClick}
        style={{
          flex: '1 1 0',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          cursor: step.canEnter ? 'pointer' : 'not-allowed',
          userSelect: 'none',
          overflow: 'visible',
        }}
        whileHover={step.canEnter ? { y: -2 } : undefined}
        whileTap={step.canEnter ? { scale: 0.95 } : undefined}
      >
        {/* Circle node */}
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2.5px solid',
            borderColor: c.border,
            bgcolor: c.bg,
            color: c.text,
            transition: 'box-shadow 0.2s ease',
            ...(isActive && !hasProblem && {
              boxShadow: `0 0 0 4px ${COLORS.activeBg}`,
            }),
            ...(hasProblem && {
              boxShadow: `0 0 0 4px ${COLORS.warnBg}`,
            }),
          }}
        >
          <AnimatePresence mode="wait">
            {isDone ? (
              <motion.div
                key="check"
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                style={{ display: 'flex' }}
              >
                <CheckIcon sx={{ fontSize: 20 }} />
              </motion.div>
            ) : hasProblem ? (
              <motion.div
                key="warn"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                style={{ display: 'flex' }}
              >
                <WarnIcon sx={{ fontSize: 20 }} />
              </motion.div>
            ) : (
              <motion.div
                key="icon"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                style={{ display: 'flex' }}
              >
                <Icon sx={{ fontSize: 18, opacity: isActive ? 1 : 0.6 }} />
              </motion.div>
            )}
          </AnimatePresence>
        </Box>

        {/* Label */}
        <Typography
          variant="caption"
          sx={{
            fontSize: '0.65rem',
            fontWeight: isActive || isDone ? 700 : 400,
            color: c.text,
            textAlign: 'center',
            lineHeight: 1.2,
            letterSpacing: isActive ? '0.02em' : 0,
          }}
        >
          {step.label}
        </Typography>
      </motion.div>
    </Tooltip>
  )
})

// ── Main Component ──
export default function PipelineStrip() {
  const getPipelineSteps = usePipelineStore(s => s.getPipelineSteps)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const statusView = usePipelineStore(s => s.statusView)

  const steps = useMemo(() => getPipelineSteps(), [getPipelineSteps])

  // Build set of panels that have problems for shake animation
  const problemSteps = useMemo(() => {
    const set = new Set()
    ;(statusView?.problems || []).forEach(p => {
      if (p.panel) set.add(p.panel)
    })
    return set
  }, [statusView?.problems])

  const handleStepClick = useCallback((step) => {
    if (!step.canEnter) return
    setActivePanel(STEP_PANELS[step.id] || null)
  }, [setActivePanel])

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        py: 1.5,
        px: 0,
        minWidth: 0,
      }}
    >
      {steps.map((step, i) => {
        const hasProblem = problemSteps.has(STEP_PANELS[step.id])
        const prevStep = i > 0 ? steps[i - 1] : null

        return (
          <React.Fragment key={step.id}>
            {/* Connector between steps */}
            {i > 0 && (
              <Connector
                fromDone={prevStep?.status === 'done'}
                toDone={step.status === 'done'}
                toActive={step.status === 'active'}
                index={i}
              />
            )}

            {/* Step node */}
            <StepNode
              step={step}
              index={i}
              hasProblem={hasProblem}
              onClick={() => handleStepClick(step)}
            />
          </React.Fragment>
        )
      })}
    </Box>
  )
}
