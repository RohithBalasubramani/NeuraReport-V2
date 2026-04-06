/**
 * StatusView — Visual state orchestrator for the right panel.
 *
 * Renders visualization widgets based on available data.
 * Uses AutoAnimate for widget add/remove and AnimatePresence for cards.
 * Each widget is interactive: click -> inspect, hover -> reveal, drag -> change.
 */
import React, { useCallback } from 'react'
import { Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material'
import {
  CheckCircle as SuccessIcon,
  Warning as AttentionIcon,
  Error as ErrorIcon,
  ArrowForward as ArrowIcon,
  DragIndicator as DragIcon,
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

// ── Fallback status card (for cards not replaced by viz widgets) ──
const TYPE_CONFIG = {
  success:   { Icon: SuccessIcon, color: 'success.main' },
  attention: { Icon: AttentionIcon, color: 'warning.main' },
  error:     { Icon: ErrorIcon, color: 'error.main' },
}

function StatusCard({ card, onPanelClick }) {
  const cfg = TYPE_CONFIG[card.type] || TYPE_CONFIG.success
  const Icon = cfg.Icon
  return (
    <Card
      variant="outlined"
      sx={{
        cursor: card.panel ? 'pointer' : 'default',
        '&:hover': card.panel ? { borderColor: cfg.color, bgcolor: 'action.hover' } : {},
        transition: 'all 0.15s',
      }}
      onClick={() => card.panel && onPanelClick?.(card.panel)}
    >
      <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Icon sx={{ color: cfg.color, fontSize: 18 }} />
        <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem' }}>{card.text}</Typography>
        {card.panel && <ArrowIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
      </CardContent>
    </Card>
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

export default function StatusView({ onAction }) {
  const statusView = usePipelineStore(s => s.statusView)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const history = usePipelineStore(s => s.pipelineState.history)

  const [parentRef] = useAutoAnimate({ duration: 300 })

  // Widget ordering — synced to store for persistence across sessions
  const widgetOrder = usePipelineStore(s => s.widgetOrder)
  const setWidgetOrder = usePipelineStore(s => s.setWidgetOrder)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event
    if (active.id !== over?.id) {
      setWidgetOrder(arrayMove(widgetOrder, widgetOrder.indexOf(active.id), widgetOrder.indexOf(over.id)))
    }
  }, [widgetOrder, setWidgetOrder])

  // Empty state — no status yet
  if (!statusView) {
    return (
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Pipeline strip shows even before first backend response */}
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

  // Filter out cards that are replaced by viz widgets
  const vizReplacedPanels = new Set(hasMapping ? ['mappings'] : [])
  const remainingCards = (cards || []).filter(c =>
    !vizReplacedPanels.has(c.panel) || c.type === 'error'
  )

  // Widget registry: id -> { visible, component }
  const widgetRegistry = {
    pipeline:    { visible: true, component: <PipelineStrip /> },
    connections: { visible: hasMapping, component: <FieldConnectionGraph compact /> },
    rowflow:     { visible: hasRowCounts, component: <RowFlowCompression counts={row_counts} /> },
    injection:   { visible: hasMapping, component: <DataInjection /> },
    morph:       { visible: hasTransformStages, component: <BeforeAfterMorph stages={transform_stages} /> },
    reality:     { visible: hasExample, component: <MiniReality example={example} /> },
    errors:      { visible: hasProblems, component: <ErrorBreakage problems={problems} /> },
  }

  const visibleWidgets = widgetOrder.filter((id) => widgetRegistry[id]?.visible)

  return (
    <Box
      ref={parentRef}
      sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', p: 2, gap: 2 }}
    >
      {/* Sortable visualization widgets */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleWidgets} strategy={verticalListSortingStrategy}>
          {visibleWidgets.map((id) => (
            <SortableWidget key={id} id={id}>
              {widgetRegistry[id].component}
            </SortableWidget>
          ))}
        </SortableContext>
      </DndContext>

      {/* 8. Remaining status cards with AnimatePresence */}
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

      {/* 9. What the system did (compact) */}
      {actions_taken?.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.25, display: 'block' }}>
            What we did
          </Typography>
          <Stack spacing={0.15}>
            {actions_taken.map((a, i) => (
              <Typography key={i} variant="caption" color="text.disabled" sx={{ fontSize: '0.7rem' }}>
                {a}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}

      {/* 10. Next Step + Actions (pinned to bottom) */}
      {next_step && (
        <Box sx={{ mt: 'auto', pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: '0.85rem' }}>
            Next: {next_step}
          </Typography>
          {actions?.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {actions.map((a, i) => (
                <Button
                  key={i}
                  variant={i === 0 ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => {
                    if (a.action === 'show_panel' && a.panel) {
                      setActivePanel(a.panel)
                    } else {
                      onAction?.(a.action)
                    }
                  }}
                  sx={{ textTransform: 'none', fontWeight: 500 }}
                >
                  {a.label}
                </Button>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* 11. Timeline Scrubber (when history has 2+ entries) */}
      {hasHistory && <TimelineScrubber />}
    </Box>
  )
}
