/**
 * TimelineScrubber (#9) — State replay using vis-timeline.
 * Interactive timeline with zoomable, selectable pipeline history items.
 * Select an item to preview historical state; deselect to snap back to current.
 * Falls back to MUI Slider while vis-timeline lazy-loads.
 */
import React, { useRef, useEffect, useMemo, useState } from 'react'
import { Box, Slider, Typography } from '@mui/material'
import usePipelineStore from '@/stores/pipeline'

// Lazy-load vis-timeline (heavy library ~300KB)
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
    }).catch(() => {})
  }, [])
  return ready
}

// ── Vis-Timeline Implementation ──
function VisTimelineView({ history, previewHistoryAt, clearHistoryPreview }) {
  const containerRef = useRef(null)
  const timelineRef = useRef(null)

  const items = useMemo(() => {
    if (!_DataSet || history.length < 2) return null
    return new _DataSet(
      history.map((entry, i) => ({
        id: i,
        content: entry.field || `Step ${i + 1}`,
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
      if (timelineRef.current) {
        timelineRef.current.destroy()
        timelineRef.current = null
      }
    }
  }, [items, history.length, previewHistoryAt, clearHistoryPreview])

  return <Box ref={containerRef} />
}

// ── MUI Slider Fallback ──
function SliderFallback({ history, previewHistoryAt, clearHistoryPreview }) {
  const marks = useMemo(() =>
    history.map((_, i) => ({
      value: i,
      label: i === 0 ? 'Start' : i === history.length - 1 ? 'Now' : '',
    })),
  [history])

  return (
    <Slider
      min={0}
      max={history.length - 1}
      defaultValue={history.length - 1}
      marks={marks}
      step={1}
      onChange={(_, val) => {
        if (val === history.length - 1) clearHistoryPreview()
        else previewHistoryAt(val)
      }}
      onChangeCommitted={() => clearHistoryPreview()}
      valueLabelDisplay="auto"
      valueLabelFormat={(val) => {
        const entry = history[val]
        if (!entry) return ''
        return `${entry.field || 'state'} — ${new Date(entry.timestamp).toLocaleTimeString()}`
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

export default function TimelineScrubber() {
  const history = usePipelineStore((s) => s.pipelineState.history)
  const previewHistoryAt = usePipelineStore((s) => s.previewHistoryAt)
  const clearHistoryPreview = usePipelineStore((s) => s.clearHistoryPreview)
  const visReady = useVisTimeline()

  if (history.length < 2) return null

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        '& .vis-timeline': { border: 'none', fontSize: '0.7rem' },
        '& .vis-item': {
          borderColor: '#1976D2 !important',
          backgroundColor: '#E3F2FD !important',
          fontSize: '0.65rem',
          borderRadius: '8px !important',
        },
        '& .vis-item.vis-selected': {
          borderColor: '#1565C0 !important',
          backgroundColor: '#BBDEFB !important',
          fontWeight: 700,
        },
        '& .vis-item-current': {
          borderColor: '#4CAF50 !important',
          backgroundColor: '#E8F5E9 !important',
        },
      }}
    >
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" fontWeight={600} color="text.secondary">
          Timeline
        </Typography>
      </Box>
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
