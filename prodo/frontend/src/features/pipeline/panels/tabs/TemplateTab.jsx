/**
 * TemplateTab — Template detail panel with:
 * - d3-scale confidence heatmap overlay
 * - react-diff-viewer-continued template diff view
 * - Typography inspector (native CSS computed styles)
 * - SVG field highlight overlay
 * - clsx conditional styling
 */
import React, { useState, useMemo, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import {
  Box, Chip, Collapse, Dialog, DialogContent, DialogTitle, Divider,
  IconButton, Paper, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import {
  Fullscreen as FullscreenIcon, FullscreenExit as ExitIcon,
  ExpandMore as ExpandIcon, ExpandLess as CollapseIcon,
  Palette as HeatmapIcon, CompareArrows as DiffIcon,
  TextFields as TypoIcon,
} from '@mui/icons-material'
import { scaleLinear } from 'd3-scale'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken } from '../../utils'

// Lazy-load heavy libs for code splitting
const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'))
const PdfDocument = lazy(() => import('react-pdf').then(async (m) => {
  // Set up pdf.js worker for Vite
  m.pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  // Import required CSS for proper rendering
  await import('react-pdf/dist/Page/AnnotationLayer.css')
  await import('react-pdf/dist/Page/TextLayer.css')
  return { default: m.Document }
}))
const PdfPage = lazy(() => import('react-pdf').then(m => ({ default: m.Page })))

// ── Confidence heatmap color scale ──
const confidenceColorScale = scaleLinear()
  .domain([0, 0.5, 0.8, 1])
  .range(['#f44336', '#ff9800', '#ffeb3b', '#4caf50'])
  .clamp(true)

function confidenceBackground(conf) {
  if (conf == null) return 'transparent'
  const color = confidenceColorScale(conf)
  return `${color}33` // 20% opacity
}

// ── Token Inspector ──
function TokenInspector({ token, mapping, confidence }) {
  const source = mapping?.[token]
  const conf = confidence?.[token]
  return (
    <Paper variant="outlined" sx={{ p: 1.5, fontSize: '0.8rem' }}>
      <Typography variant="caption" fontWeight={600}>{humanizeToken(token)}</Typography>
      <Box sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          Source: {source && source !== 'UNRESOLVED' ? source : 'Not connected'}
        </Typography>
      </Box>
      {conf != null && (
        <Box sx={{ mt: 0.25, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: confidenceColorScale(conf),
          }} />
          <Typography variant="caption" color={conf >= 0.8 ? 'success.main' : 'warning.main'}>
            Confidence: {Math.round(conf * 100)}%
          </Typography>
        </Box>
      )}
    </Paper>
  )
}

// ── Typography Inspector ──
function TypographyInspector({ element }) {
  const [styles, setStyles] = useState(null)

  useEffect(() => {
    if (!element) { setStyles(null); return }
    const computed = window.getComputedStyle(element)
    setStyles({
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      color: computed.color,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textAlign: computed.textAlign,
    })
  }, [element])

  if (!styles) return null

  return (
    <Paper variant="outlined" sx={{ p: 1.5, fontSize: '0.75rem' }}>
      <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
        Typography Inspector
      </Typography>
      <Stack spacing={0.25}>
        {Object.entries(styles).map(([key, val]) => (
          <Box key={key} sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">
              {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
            </Typography>
            <Typography variant="caption" fontFamily="monospace" sx={{ maxWidth: 160 }} noWrap>
              {val}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  )
}

// ── Template Diff View ──
function TemplateDiffView({ versions }) {
  const [leftIdx, setLeftIdx] = useState(0)
  const [rightIdx, setRightIdx] = useState(versions.length - 1)

  if (versions.length < 2) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Need at least 2 template versions to compare. Versions are saved when the template is modified.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, overflow: 'auto' }}>
      <Box sx={{ px: 2, py: 0.5, display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">Left:</Typography>
        <Chip
          label={versions[leftIdx]?.label || `v${leftIdx + 1}`}
          size="small"
          variant="outlined"
          onClick={() => setLeftIdx(i => Math.max(0, i - 1))}
        />
        <Typography variant="caption" color="text.secondary">Right:</Typography>
        <Chip
          label={versions[rightIdx]?.label || `v${rightIdx + 1}`}
          size="small"
          variant="outlined"
          onClick={() => setRightIdx(i => Math.min(versions.length - 1, i + 1))}
        />
      </Box>
      <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading diff viewer...</Typography>}>
        <ReactDiffViewer
          oldValue={versions[leftIdx]?.html || ''}
          newValue={versions[rightIdx]?.html || ''}
          splitView
          useDarkTheme={false}
          hideLineNumbers={false}
          styles={{
            contentText: { fontSize: '0.7rem', fontFamily: 'monospace' },
          }}
        />
      </Suspense>
    </Box>
  )
}

// ── SVG Highlight Overlay ──
function FieldHighlightOverlay({ containerRef, highlightedField, tokens, getTokenColor }) {
  const [rects, setRects] = useState([])

  useEffect(() => {
    if (!containerRef.current || !highlightedField) { setRects([]); return }
    const container = containerRef.current
    const spans = container.querySelectorAll(`[data-token="${highlightedField}"]`)
    const containerRect = container.getBoundingClientRect()
    const newRects = Array.from(spans).map(span => {
      const r = span.getBoundingClientRect()
      return {
        x: r.left - containerRect.left + container.scrollLeft,
        y: r.top - containerRect.top + container.scrollTop,
        width: r.width,
        height: r.height,
      }
    })
    setRects(newRects)
  }, [containerRef, highlightedField])

  if (!rects.length) return null

  const color = getTokenColor(highlightedField)
  return (
    <svg
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2,
      }}
    >
      {rects.map((r, i) => (
        <rect
          key={i}
          x={r.x - 2} y={r.y - 1}
          width={r.width + 4} height={r.height + 2}
          fill="none"
          stroke={color}
          strokeWidth={2}
          rx={3}
          style={{ animation: 'pulse 2s infinite' }}
        />
      ))}
    </svg>
  )
}

export default function TemplateTab({ onAction }) {
  const template = usePipelineStore(s => s.pipelineState.data.template)
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const getTokenColor = usePipelineStore(s => s.getTokenColor)
  const highlightedField = usePipelineStore(s => s.highlightedField)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)
  const templateVersions = usePipelineStore(s => s.templateVersions)
  const [fullscreen, setFullscreen] = useState(false)
  const [showTokens, setShowTokens] = useState(true)
  const [selectedToken, setSelectedToken] = useState(null)
  const [viewMode, setViewMode] = useState('preview') // 'preview' | 'heatmap' | 'diff' | 'typo' | 'pdf'
  const [inspectedElement, setInspectedElement] = useState(null)
  const previewRef = useRef(null)

  const tokens = template?.tokens || []
  const html = template?.html || ''
  const confidence = mapping?.confidence || {}

  // Build highlighted HTML with heatmap support
  const highlightedHtml = useMemo(() => {
    if (!html) return ''
    let result = html
    tokens.forEach(t => {
      const color = getTokenColor(t)
      const isHighlighted = highlightedField === t
      const showHeatmap = viewMode === 'heatmap'
      const heatmapBg = showHeatmap ? confidenceBackground(confidence[t]) : `${color}22`

      const style = [
        `background:${heatmapBg}`,
        `border:1px solid ${showHeatmap ? confidenceColorScale(confidence[t] ?? 0.5) : color}`,
        'border-radius:3px',
        'padding:0 4px',
        `font-weight:${isHighlighted ? 700 : 500}`,
        isHighlighted ? `box-shadow:0 0 0 2px ${color}` : '',
      ].filter(Boolean).join(';')

      const regex = new RegExp(`\\{\\{?\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}?`, 'g')
      result = result.replace(regex, `<span style="${style}" data-token="${t}">${humanizeToken(t)}</span>`)
    })
    return result
  }, [html, tokens, getTokenColor, highlightedField, viewMode, confidence])

  // Handle click in preview for typography inspector
  const handlePreviewClick = useCallback((e) => {
    if (viewMode !== 'typo') return
    const target = e.target
    if (target && target.nodeType === 1) {
      setInspectedElement(target)
    }
  }, [viewMode])

  if (!html) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Typography color="text.secondary">No template yet. Upload a file to get started.</Typography>
      </Box>
    )
  }

  const preview = (
    <Paper
      variant="outlined"
      sx={{ flex: 1, overflow: 'auto', p: 1, position: 'relative' }}
      ref={previewRef}
    >
      <Box
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        onClick={handlePreviewClick}
        sx={{
          transform: fullscreen ? 'scale(0.75)' : 'scale(0.45)',
          transformOrigin: 'top left',
          width: fullscreen ? '133%' : '222%',
          cursor: viewMode === 'typo' ? 'crosshair' : 'default',
          '& table': { borderCollapse: 'collapse' },
          '& td, & th': { border: '1px solid #ddd', padding: '4px 8px', fontSize: '11px' },
        }}
      />
      <FieldHighlightOverlay
        containerRef={previewRef}
        highlightedField={highlightedField}
        tokens={tokens}
        getTokenColor={getTokenColor}
      />
    </Paper>
  )

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Template Preview</Typography>
        <Chip label={`${tokens.length} fields`} size="small" variant="outlined" />

        {/* View mode toggles */}
        <ToggleButtonGroup
          size="small"
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          sx={{ '& .MuiToggleButton-root': { px: 0.75, py: 0.25 } }}
        >
          <ToggleButton value="preview">
            <Tooltip title="Normal view"><Typography variant="caption">Preview</Typography></Tooltip>
          </ToggleButton>
          <ToggleButton value="heatmap">
            <Tooltip title="Confidence heatmap"><HeatmapIcon sx={{ fontSize: 16 }} /></Tooltip>
          </ToggleButton>
          <ToggleButton value="diff">
            <Tooltip title="Version diff"><DiffIcon sx={{ fontSize: 16 }} /></Tooltip>
          </ToggleButton>
          <ToggleButton value="typo">
            <Tooltip title="Typography inspector"><TypoIcon sx={{ fontSize: 16 }} /></Tooltip>
          </ToggleButton>
          {template?.pdfUrl && (
            <ToggleButton value="pdf">
              <Tooltip title="PDF source"><Typography variant="caption">PDF</Typography></Tooltip>
            </ToggleButton>
          )}
        </ToggleButtonGroup>

        <IconButton size="small" onClick={() => setFullscreen(true)}>
          <FullscreenIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Heatmap legend */}
      {viewMode === 'heatmap' && (
        <Box sx={{ px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'grey.50', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">Confidence:</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {[0, 0.25, 0.5, 0.75, 1].map(v => (
              <Tooltip key={v} title={`${Math.round(v * 100)}%`}>
                <Box sx={{
                  width: 16, height: 12, borderRadius: 0.5,
                  bgcolor: `${confidenceColorScale(v)}66`,
                  border: `1px solid ${confidenceColorScale(v)}`,
                }} />
              </Tooltip>
            ))}
          </Box>
          <Typography variant="caption" color="text.disabled" sx={{ ml: 0.5 }}>Low → High</Typography>
        </Box>
      )}

      {/* Token chips (collapsible) */}
      <Box
        sx={{ px: 2, py: 0.75, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5 }}
        onClick={() => setShowTokens(o => !o)}
      >
        <Typography variant="caption" fontWeight={600}>Fields</Typography>
        {showTokens ? <CollapseIcon sx={{ fontSize: 16 }} /> : <ExpandIcon sx={{ fontSize: 16 }} />}
      </Box>
      <Collapse in={showTokens}>
        <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ px: 2, pb: 1 }}>
          {tokens.map(t => {
            const conf = confidence[t]
            return (
              <Chip
                key={t}
                label={humanizeToken(t)}
                size="small"
                onClick={() => {
                  setSelectedToken(selectedToken === t ? null : t)
                  setHighlightedField(highlightedField === t ? null : t)
                }}
                className={clsx({
                  'chip-selected': selectedToken === t || highlightedField === t,
                  'chip-error': conf != null && conf < 0.5,
                })}
                sx={{
                  bgcolor: viewMode === 'heatmap'
                    ? confidenceBackground(conf)
                    : `${getTokenColor(t)}22`,
                  borderColor: viewMode === 'heatmap'
                    ? confidenceColorScale(conf ?? 0.5)
                    : getTokenColor(t),
                  border: '1px solid',
                  fontWeight: selectedToken === t || highlightedField === t ? 700 : 400,
                  boxShadow: selectedToken === t ? `0 0 0 2px ${getTokenColor(t)}` : 'none',
                }}
              />
            )
          })}
        </Stack>
      </Collapse>

      {/* Token inspector */}
      {selectedToken && viewMode !== 'diff' && (
        <Box sx={{ px: 2, pb: 1 }}>
          <TokenInspector
            token={selectedToken}
            mapping={mapping?.mapping}
            confidence={mapping?.confidence}
          />
        </Box>
      )}

      {/* Typography inspector */}
      {viewMode === 'typo' && inspectedElement && (
        <Box sx={{ px: 2, pb: 1 }}>
          <TypographyInspector element={inspectedElement} />
        </Box>
      )}

      <Divider />

      {/* Main content area */}
      {viewMode === 'diff' ? (
        <TemplateDiffView versions={templateVersions} />
      ) : viewMode === 'pdf' && template?.pdfUrl ? (
        <Box sx={{ flex: 1, overflow: 'auto', p: 1, display: 'flex', justifyContent: 'center' }}>
          <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading PDF...</Typography>}>
            <PdfDocument file={template.pdfUrl}>
              <PdfPage pageNumber={1} width={500} />
            </PdfDocument>
          </Suspense>
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
          {preview}
        </Box>
      )}

      {/* Fullscreen dialog */}
      <Dialog open={fullscreen} onClose={() => setFullscreen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
          Template Preview
          <IconButton onClick={() => setFullscreen(false)} sx={{ ml: 'auto' }}>
            <ExitIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ height: '75vh', overflow: 'auto' }}>
          {preview}
        </DialogContent>
      </Dialog>
    </Box>
  )
}
