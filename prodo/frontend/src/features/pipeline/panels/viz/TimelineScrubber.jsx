/**
 * TimelineScrubber — State replay timeline with history preview.
 *
 * References:
 *   - vis-timeline: interactive zoomable timeline (used by Grafana, Kibana)
 *   - Chrome DevTools Performance timeline: scrub through recorded events
 *   - MUI Slider: simple fallback for timeline interaction
 *
 * Covers: V9 (timeline scrubber with vis-timeline + MUI Slider fallback)
 *         D12 (user action replay — select history point → preview state)
 *
 * Lazy-loads vis-timeline (~300KB). Falls back to MUI Slider while loading.
 * Select item → previewHistoryAt(index) → StatusView shows historical state.
 * Click current → clearHistoryPreview() → snap back to live state.
 */
import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { Box, Button, Slider, Typography, Chip } from '@mui/material'
import { Replay as ReplayIcon } from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'

// ── Lazy-load vis-timeline ──
let _Timeline = null
let _DataSet = null

function useVisTimeline() {
  const [ready, setReady] = useState(!!_Timeline)
  useEffect(() => {
    if (_Timeline) return
    Promise.all([
      import('vis-timeline/standalone'),
      import('vis-data'),
      import('vis-timeline/styles/vis-timeline-graph2d.min.css'),
    ]).then(([tlMod, dataMod]) => {
      _Timeline = tlMod.Timeline
      _DataSet = dataMod.DataSet
      setReady(true)
    }).catch(() => {
      // vis-timeline unavailable, stay on slider fallback
    })
  }, [])
  return ready
}

// Field → human label
function fieldLabel(field) {
  if (!field) return 'State'
  return field.charAt(0).toUpperCase() + field.slice(1)
}

// ── Vis-Timeline View ──
function VisTimelineView({ history, previewHistoryAt, clearHistoryPreview }) {
  const containerRef = useRef(null)
  const timelineRef = useRef(null)

  const items = useMemo(() => {
    if (!_DataSet || history.length < 2) return null
    return new _DataSet(
      history.map((entry, i) => ({
        id: i,
        content: fieldLabel(entry.field),
        start: new Date(entry.timestamp || Date.now() - (history.length - i) * 60000),
        type: 'point',
        className: i === history.length - 1 ? 'vis-item-current' : '',
      }))
    )
  }, [history])

  useEffect(() => {
    if (!containerRef.current || !items || !_Timeline) return

    if (timelineRef.current) {
      timelineRef.current.destroy()
      timelineRef.current = null
    }

    const tl = new _Timeline(containerRef.current, items, {
      height: '80px',
      showCurrentTime: false,
      selectable: true,
      zoomMin: 1000,
      margin: { item: 10 },
      orientation: { axis: 'bottom' },
    })

    tl.on('select', (props) => {
      const idx = props.items?.[0]
      if (idx == null || idx === history.length - 1) {
        clearHistoryPreview()
      } else {
        previewHistoryAt(idx)
      }
    })

    tl.setSelection([history.length - 1])
    timelineRef.current = tl

    return () => {
      timelineRef.current?.destroy()
      timelineRef.current = null
    }
  }, [items, history.length, previewHistoryAt, clearHistoryPreview])

  return <Box ref={containerRef} />
}

// ── MUI Slider Fallback ──
function SliderFallback({ history, previewHistoryAt, clearHistoryPreview }) {
  const [value, setValue] = useState(history.length - 1)

  useEffect(() => {
    setValue(history.length - 1)
  }, [history.length])

  const marks = useMemo(() =>
    history.map((entry, i) => ({
      value: i,
      label: i === 0 ? 'Start' : i === history.length - 1 ? 'Now' : '',
    })),
  [history])

  const handleChange = useCallback((_, val) => {
    setValue(val)
    if (val === history.length - 1) clearHistoryPreview()
    else previewHistoryAt(val)
  }, [history.length, previewHistoryAt, clearHistoryPreview])

  const handleCommit = useCallback(() => {
    clearHistoryPreview()
    setValue(history.length - 1)
  }, [clearHistoryPreview, history.length])

  return (
    <Slider
      min={0}
      max={history.length - 1}
      value={value}
      marks={marks}
      step={1}
      onChange={handleChange}
      onChangeCommitted={handleCommit}
      valueLabelDisplay="auto"
      valueLabelFormat={(val) => {
        const entry = history[val]
        if (!entry) return ''
        return `${fieldLabel(entry.field)} — ${new Date(entry.timestamp).toLocaleTimeString()}`
      }}
      sx={{
        '& .MuiSlider-thumb': { width: 14, height: 14 },
        '& .MuiSlider-track': { height: 4 },
        '& .MuiSlider-rail': { height: 4, opacity: 0.3 },
        '& .MuiSlider-markLabel': { fontSize: '0.6rem' },
      }}
    />
  )
}

// ── Main Component ──
export default function TimelineScrubber() {
  const history = usePipelineStore(s => s.pipelineState.history)
  const previewHistoryAt = usePipelineStore(s => s.previewHistoryAt)
  const clearHistoryPreview = usePipelineStore(s => s.clearHistoryPreview)
  const historyPreview = usePipelineStore(s => s.historyPreview)
  const revertToHistory = usePipelineStore(s => s.revertToHistory)
  const visReady = useVisTimeline()

  if (history.length < 2) return null

  const isPreviewingPast = !!historyPreview
  const previewIndex = isPreviewingPast
    ? history.findIndex(h => h.timestamp === historyPreview.timestamp)
    : -1

  return (
    <Box
      sx={{
        border: 1,
        borderColor: isPreviewingPast ? 'info.light' : 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        transition: 'border-color 0.2s',
        '& .vis-timeline': { border: 'none', fontSize: '0.7rem' },
        '& .vis-item': {
          borderColor: '#1976d2 !important',
          backgroundColor: '#e3f2fd !important',
          fontSize: '0.65rem',
          borderRadius: '8px !important',
        },
        '& .vis-item.vis-selected': {
          borderColor: '#1565c0 !important',
          backgroundColor: '#bbdefb !important',
          fontWeight: 700,
        },
        '& .vis-item-current': {
          borderColor: '#2e7d32 !important',
          backgroundColor: '#e8f5e9 !important',
        },
      }}
    >
      {/* Header */}
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <ReplayIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
        <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ flex: 1 }}>
          Timeline
        </Typography>
        <Chip label={`${history.length} changes`} size="small" sx={{ height: 18, fontSize: '0.58rem' }} />
        {isPreviewingPast && previewIndex >= 0 && (
          <Button
            size="small"
            color="warning"
            onClick={() => revertToHistory(previewIndex)}
            sx={{ textTransform: 'none', fontSize: '0.65rem', py: 0, minHeight: 20 }}
          >
            Revert here
          </Button>
        )}
      </Box>

      {/* Timeline body */}
      <Box sx={{ px: visReady ? 0 : 2, py: visReady ? 0 : 1 }}>
        {visReady ? (
          <VisTimelineView
            history={history}
            previewHistoryAt={previewHistoryAt}
            clearHistoryPreview={clearHistoryPreview}
          />
        ) : (
          <SliderFallback
            history={history}
            previewHistoryAt={previewHistoryAt}
            clearHistoryPreview={clearHistoryPreview}
          />
        )}
      </Box>
    </Box>
  )
}
