/**
 * StatusView — Visual state orchestrator for the right panel.
 *
 * References:
 *   - Vercel Dashboard: compact status cards with icon + text + arrow
 *   - Linear App: type-driven icon/color, click-to-navigate
 *   - Grafana Alerts: severity coloring, grouped display
 *
 * Covers: S2 (understood cards), S3 (actions taken), S8 (next step), S9 (control via actions)
 *         Plus orchestration of all viz widgets via dnd-kit sortable registry.
 */
import React, { useCallback, useMemo, useState } from 'react'
import { Box, Button, Card, CardContent, Chip, Collapse, IconButton, Stack, Typography } from '@mui/material'
import {
  CheckCircle as SuccessIcon,
  Warning as AttentionIcon,
  Error as ErrorIcon,
  ArrowForward as ArrowIcon,
  DragIndicator as DragIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  History as HistoryIcon,
} from '@mui/icons-material'
import { motion, AnimatePresence } from 'motion/react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import usePipelineStore from '@/stores/pipeline'
import {
  PipelineStrip,
  FieldConnectionGraph,
  DataInjection,
  MiniReality,
  ErrorBreakage,
  RowFlowCompression,
  BeforeAfterMorph,
  TimelineScrubber,
} from './viz'

// ── S2: Status Card Type Config ──
const TYPE_CONFIG = {
  success:   { Icon: SuccessIcon, color: '#2e7d32', bg: '#e8f5e9', border: '#a5d6a7' },
  attention: { Icon: AttentionIcon, color: '#ed6c02', bg: '#fff3e0', border: '#ffcc80' },
  error:     { Icon: ErrorIcon, color: '#d32f2f', bg: '#ffebee', border: '#ef9a9a' },
}

// ── S2: Individual Status Card ──
function StatusCard({ card, onPanelClick }) {
  const cfg = TYPE_CONFIG[card.type] || TYPE_CONFIG.success
  const Icon = cfg.Icon
  const isClickable = !!card.panel

  return (
    <motion.div
      whileHover={isClickable ? { x: 2 } : undefined}
      whileTap={isClickable ? { scale: 0.98 } : undefined}
    >
      <Card
        variant="outlined"
        onClick={() => isClickable && onPanelClick?.(card.panel)}
        sx={{
          cursor: isClickable ? 'pointer' : 'default',
          borderLeft: `3px solid ${cfg.border}`,
          borderColor: cfg.border,
          bgcolor: cfg.bg,
          transition: 'all 0.15s ease',
          '&:hover': isClickable ? {
            borderColor: cfg.color,
            boxShadow: `0 1px 4px ${cfg.border}`,
          } : {},
        }}
      >
        <CardContent
          sx={{
            py: 1, px: 1.5,
            '&:last-child': { pb: 1 },
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Icon sx={{ color: cfg.color, fontSize: 18, flexShrink: 0 }} />
          <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem', color: 'text.primary', lineHeight: 1.4 }}>
            {card.text}
          </Typography>
          {isClickable && <ArrowIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ── S3: Actions Taken Log ──
function ActionsTakenLog({ actions }) {
  const [expanded, setExpanded] = useState(false)
  if (!actions?.length) return null

  const visible = expanded ? actions : actions.slice(0, 3)
  const hasMore = actions.length > 3

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <HistoryIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            What we did
          </Typography>
        </Box>
        {hasMore && (
          <IconButton size="small" onClick={() => setExpanded(e => !e)} sx={{ p: 0.25 }}>
            {expanded ? <CollapseIcon sx={{ fontSize: 14 }} /> : <ExpandIcon sx={{ fontSize: 14 }} />}
          </IconButton>
        )}
      </Box>
      <Collapse in timeout="auto">
        <Stack spacing={0.25}>
          {visible.map((action, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, pl: 0.5 }}>
              <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: 'text.disabled', mt: 0.75, flexShrink: 0 }} />
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem', lineHeight: 1.4 }}>
                {action}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Collapse>
      {hasMore && !expanded && (
        <Typography
          variant="caption"
          color="primary"
          sx={{ fontSize: '0.65rem', cursor: 'pointer', pl: 1.5, mt: 0.25, display: 'block' }}
          onClick={() => setExpanded(true)}
        >
          +{actions.length - 3} more
        </Typography>
      )}
    </Box>
  )
}

// ── S8: Next Step + Action Buttons ──
function NextStepActions({ nextStep, actions, onAction, setActivePanel }) {
  if (!nextStep) return null

  return (
    <Box sx={{ mt: 'auto', pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: '0.85rem', fontWeight: 500 }}>
        Next: {nextStep}
      </Typography>
      {actions?.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actions.map((a, i) => (
            <motion.div
              key={a.label || i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Button
                variant={i === 0 ? 'contained' : 'outlined'}
                size="small"
                disableElevation
                onClick={() => {
                  if (a.action === 'show_panel' && a.panel) {
                    setActivePanel(a.panel)
                  } else {
                    onAction?.(a.action)
                  }
                }}
                sx={{
                  textTransform: 'none',
                  fontWeight: 500,
                  fontSize: '0.8rem',
                  borderRadius: 1.5,
                }}
              >
                {a.label}
              </Button>
            </motion.div>
          ))}
        </Stack>
      )}
    </Box>
  )
}

// ── Sortable Widget Wrapper (dnd-kit) ──
function SortableWidget({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style}>
      <Box sx={{ position: 'relative', '&:hover .drag-handle': { opacity: 0.5 } }}>
        <Box
          className="drag-handle"
          {...attributes}
          {...listeners}
          sx={{
            position: 'absolute', top: 4, left: -16, opacity: 0,
            cursor: 'grab', transition: 'opacity 0.2s', zIndex: 1,
            '&:active': { cursor: 'grabbing' },
          }}
        >
          <DragIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
        </Box>
        {children}
      </Box>
    </div>
  )
}

// ── C1: Learned Patterns Widget ──
function LearnedPatternsWidget({ onAction }) {
  const learningSignal = usePipelineStore(s => s.learningSignal)
  const patterns = learningSignal?.patterns || []
  if (!patterns.length) return null

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
        <Typography variant="caption" fontWeight={600}>Applied from memory</Typography>
      </Box>
      <Stack spacing={0.5} sx={{ p: 1 }}>
        {patterns.map((p, i) => (
          <Card key={p.id || i} variant="outlined" sx={{ '&:hover': { borderColor: 'info.light' } }}>
            <CardContent sx={{ py: 0.75, px: 1.5, '&:last-child': { pb: 0.75 }, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" fontWeight={600}>{p.name || p.description || 'Learned pattern'}</Typography>
                {p.description && p.name && (
                  <Typography variant="caption" color="text.secondary" display="block">{p.description}</Typography>
                )}
              </Box>
              <Chip
                label="Accept"
                size="small"
                color="success"
                variant="outlined"
                onClick={() => onAction?.({ type: 'accept_pattern', patternId: p.id })}
                sx={{ height: 20, fontSize: '0.6rem', cursor: 'pointer' }}
              />
              <Chip
                label="Reject"
                size="small"
                color="error"
                variant="outlined"
                onClick={() => onAction?.({ type: 'reject_pattern', patternId: p.id })}
                sx={{ height: 20, fontSize: '0.6rem', cursor: 'pointer' }}
              />
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  )
}

// ── Main StatusView Orchestrator ──
const PHASE_ORDER = { upload: 0, edit: 1, map: 2, validate: 3, generate: 4 }

export default function StatusView({ onAction }) {
  const statusView = usePipelineStore(s => s.statusView)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const currentMapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const history = usePipelineStore(s => s.pipelineState.history)
  const historyPreview = usePipelineStore(s => s.historyPreview)
  const learningSignal = usePipelineStore(s => s.learningSignal)
  const phase = usePipelineStore(s => s.getPhase())

  // Timeline preview: overlay historical field snapshot
  const mapping = historyPreview?.field === 'mapping' && historyPreview.before
    ? historyPreview.before
    : currentMapping
  const isPreviewActive = !!historyPreview

  const [parentRef] = useAutoAnimate({ duration: 300 })

  // Widget ordering — synced to store for drag-reorder persistence
  const widgetOrder = usePipelineStore(s => s.widgetOrder)
  const setWidgetOrder = usePipelineStore(s => s.setWidgetOrder)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event
    if (active.id !== over?.id) {
      setWidgetOrder(arrayMove(widgetOrder, widgetOrder.indexOf(active.id), widgetOrder.indexOf(over.id)))
    }
  }, [widgetOrder, setWidgetOrder])

  // ── Empty state ──
  if (!statusView) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 2, pt: 2 }}>
          <PipelineStrip />
        </Box>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Welcome to NeuraReport
            </Typography>
            <Typography variant="body2" color="text.disabled">
              Upload a PDF or describe the report you'd like to create.
            </Typography>
          </Box>
        </Box>
      </Box>
    )
  }

  const { cards, actions_taken, example, problems, next_step, actions,
          row_counts, transform_stages } = statusView

  const hasMapping = mapping?.mapping && Object.keys(mapping.mapping).length > 0
  const hasProblems = problems?.length > 0
  const hasExample = example?.rows?.length > 0
  const hasRowCounts = !!row_counts
  const hasTransformStages = transform_stages?.length >= 2
  const hasHistory = history.length >= 2

  // Filter cards replaced by viz widgets (keep error cards always)
  const vizReplacedPanels = new Set(hasMapping ? ['mappings'] : [])
  const remainingCards = (cards || []).filter(c =>
    !vizReplacedPanels.has(c.panel) || c.type === 'error'
  )

  // Widget registry: id → { visible, minPhase, component }
  // minPhase prevents widgets from flickering during phase transitions
  const currentPhaseIdx = PHASE_ORDER[phase] ?? 0
  const widgetRegistry = {
    pipeline:    { visible: true, minPhase: 0, component: <PipelineStrip /> },
    connections: { visible: hasMapping, minPhase: 2, component: <FieldConnectionGraph compact /> },
    injection:   { visible: hasMapping, minPhase: 2, component: <DataInjection /> },
    rowflow:     { visible: hasRowCounts, minPhase: 3, component: <RowFlowCompression counts={row_counts} /> },
    morph:       { visible: hasTransformStages, minPhase: 3, component: <BeforeAfterMorph stages={transform_stages} /> },
    reality:     { visible: hasExample, minPhase: 3, component: <MiniReality example={example} /> },
    errors:      { visible: hasProblems, minPhase: 3, component: <ErrorBreakage problems={problems} /> },
    memory:      { visible: !!learningSignal?.patterns?.length, minPhase: 2, component: <LearnedPatternsWidget onAction={onAction} /> },
  }

  const visibleWidgets = widgetOrder.filter(id => {
    const w = widgetRegistry[id]
    return w?.visible && currentPhaseIdx >= w.minPhase
  })

  return (
    <Box
      ref={parentRef}
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', p: 2, gap: 2 }}
    >
      {/* Timeline preview banner */}
      {isPreviewActive && (
        <Box
          sx={{
            px: 2, py: 0.5,
            bgcolor: '#e3f2fd',
            border: 1,
            borderColor: '#90caf9',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <HistoryIcon sx={{ fontSize: 14, color: '#1565c0' }} />
          <Typography variant="caption" sx={{ color: '#1565c0', fontWeight: 600 }}>
            Previewing: {historyPreview.field} at {new Date(historyPreview.timestamp).toLocaleTimeString()}
          </Typography>
        </Box>
      )}

      {/* Sortable viz widgets */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleWidgets} strategy={verticalListSortingStrategy}>
          {visibleWidgets.map(id => (
            <SortableWidget key={id} id={id}>
              {widgetRegistry[id].component}
            </SortableWidget>
          ))}
        </SortableContext>
      </DndContext>

      {/* S2: Status cards with staggered entrance */}
      {remainingCards.length > 0 && (
        <AnimatePresence>
          {remainingCards.map((card, i) => (
            <motion.div
              key={card.text || `card-${i}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
            >
              <StatusCard card={card} onPanelClick={setActivePanel} />
            </motion.div>
          ))}
        </AnimatePresence>
      )}

      {/* S3: What the system did */}
      <ActionsTakenLog actions={actions_taken} />

      {/* S8: Next step + action buttons */}
      <NextStepActions
        nextStep={next_step}
        actions={actions}
        onAction={onAction}
        setActivePanel={setActivePanel}
      />

      {/* Timeline Scrubber (when history has 2+ entries) */}
      {hasHistory && <TimelineScrubber />}
    </Box>
  )
}
