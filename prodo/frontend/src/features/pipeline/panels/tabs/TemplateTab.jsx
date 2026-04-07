/**
 * TemplateTab — Template preview and inspection panel.
 *
 * References:
 *   - Monaco Editor preview: HTML rendering with zoom, fullscreen
 *   - Figma Inspect: typography inspector with computed CSS
 *   - GitHub diff viewer: side-by-side HTML comparison
 *   - d3-scale: confidence heatmap color mapping
 *
 * Covers:
 *   1a: Rendered report preview with scaling + fullscreen
 *   1b: Section boundaries (semantic tag detection via density)
 *   1c: Field placeholders highlighted (color-coded token spans)
 *   1d: Grid/spacing overlay toggle (CSS repeating-linear-gradient)
 *   1e: Typography inspector (getComputedStyle on click)
 *   1f: Click field → source/type/transform (TokenInspector)
 *   1g: Toggle raw placeholders vs filled values (displayMode)
 *   8a: Version/diff layer (react-diff-viewer)
 *   D1: Mapping confidence heatmap + top-3 candidates popover
 *   D11: Template density map (grid heatmap overlay)
 */
import React, { useState, useMemo, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import {
  Box, Chip, Collapse, Dialog, DialogContent, DialogTitle, Divider,
  IconButton, List, ListItemButton, ListItemText, Paper, Popover,
  Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import {
  Fullscreen as FullscreenIcon, FullscreenExit as ExitIcon,
  ExpandMore as ExpandIcon, ExpandLess as CollapseIcon,
  Palette as HeatmapIcon, CompareArrows as DiffIcon,
  TextFields as TypoIcon, Code as RawIcon, DataObject as FilledIcon,
  GridOn as GridIcon, Gradient as DensityIcon,
} from '@mui/icons-material'
import { scaleLinear } from 'd3-scale'
import clsx from 'clsx'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken } from '../../utils'

// Lazy-load heavy libraries
const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'))
const PdfDocument = lazy(() => import('react-pdf').then(async (m) => {
  m.pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  await import('react-pdf/dist/Page/AnnotationLayer.css')
  await import('react-pdf/dist/Page/TextLayer.css')
  return { default: m.Document }
}))
const PdfPage = lazy(() => import('react-pdf').then(m => ({ default: m.Page })))

// ── D1: Confidence color scale ──
const confScale = scaleLinear()
  .domain([0, 0.5, 0.8, 1])
  .range(['#f44336', '#ff9800', '#ffeb3b', '#4caf50'])
  .clamp(true)

function confBg(conf) {
  return conf == null ? 'transparent' : `${confScale(conf)}33`
}

// ═════════════════════════════════════════════════════
// 1f: Token Inspector — shows source, confidence, type
// ═════════════════════════════════════════════════════
function TokenInspector({ token, mapping, confidence }) {
  const source = mapping?.[token]
  const conf = confidence?.[token]
  const isResolved = source && source !== 'UNRESOLVED'
  const isComputed = source?.startsWith('COMPUTED:')
  const isReshaped = source?.startsWith('RESHAPE:')

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="caption" fontWeight={700} display="block">
        {humanizeToken(token)}
      </Typography>
      <Stack spacing={0.5} sx={{ mt: 0.75 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Source</Typography>
          <Typography variant="caption" fontWeight={500}>
            {isComputed ? 'Computed' : isReshaped ? 'Reshaped' : isResolved ? source : 'Not connected'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">Type</Typography>
          <Chip
            label={isComputed ? 'computed' : isReshaped ? 'reshape' : isResolved ? 'direct' : 'unresolved'}
            size="small"
            color={isResolved ? 'success' : 'warning'}
            variant="outlined"
            sx={{ height: 18, fontSize: '0.6rem' }}
          />
        </Box>
        {conf != null && (
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">Confidence</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: confScale(conf) }} />
              <Typography variant="caption" color={conf >= 0.8 ? 'success.main' : 'warning.main'}>
                {Math.round(conf * 100)}%
              </Typography>
            </Box>
          </Box>
        )}
      </Stack>
    </Paper>
  )
}

// ═════════════════════════════════════════════════════
// 1e: Typography Inspector — getComputedStyle on click
// ═════════════════════════════════════════════════════
function TypographyInspector({ element }) {
  const [styles, setStyles] = useState(null)

  useEffect(() => {
    if (!element) { setStyles(null); return }
    const cs = window.getComputedStyle(element)
    setStyles({
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textAlign: cs.textAlign,
    })
  }, [element])

  if (!styles) return null

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>
        Typography Inspector
      </Typography>
      <Stack spacing={0.25}>
        {Object.entries(styles).map(([key, val]) => (
          <Box key={key} sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">
              {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
            </Typography>
            <Typography variant="caption" fontFamily="monospace" sx={{ maxWidth: 150 }} noWrap>
              {val}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Paper>
  )
}

// ═════════════════════════════════════════════════════
// 8a: Template Diff View — react-diff-viewer
// ═════════════════════════════════════════════════════
function TemplateDiffView({ versions }) {
  const [leftIdx, setLeftIdx] = useState(0)
  const [rightIdx, setRightIdx] = useState(Math.max(0, versions.length - 1))

  if (versions.length < 2) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          Need at least 2 template versions to compare. Versions are saved automatically when the template changes.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ flex: 1, overflow: 'auto' }}>
      <Box sx={{ px: 2, py: 0.75, display: 'flex', gap: 1, alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary">Left:</Typography>
        <Chip
          label={versions[leftIdx]?.label || `v${leftIdx + 1}`}
          size="small" variant="outlined"
          onClick={() => setLeftIdx(i => Math.max(0, i - 1))}
          sx={{ cursor: 'pointer' }}
        />
        <Typography variant="caption" color="text.secondary">Right:</Typography>
        <Chip
          label={versions[rightIdx]?.label || `v${rightIdx + 1}`}
          size="small" variant="outlined"
          onClick={() => setRightIdx(i => Math.min(versions.length - 1, i + 1))}
          sx={{ cursor: 'pointer' }}
        />
      </Box>
      <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading diff viewer...</Typography>}>
        <ReactDiffViewer
          oldValue={versions[leftIdx]?.html || ''}
          newValue={versions[rightIdx]?.html || ''}
          splitView
          useDarkTheme={false}
          hideLineNumbers={false}
          styles={{ contentText: { fontSize: '0.7rem', fontFamily: 'monospace' } }}
        />
      </Suspense>
    </Box>
  )
}

// ═════════════════════════════════════════════════════
// D11: Density Map View — content density heatmap
// ═════════════════════════════════════════════════════
function DensityMapView({ html }) {
  const GRID = 8

  const density = useMemo(() => {
    if (!html) return []
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const allEls = doc.body.querySelectorAll('*')
    const cells = Array.from({ length: GRID * GRID }, () => 0)
    const total = allEls.length || 1

    allEls.forEach((el, idx) => {
      const row = Math.min(Math.floor((idx / total) * GRID), GRID - 1)
      const textLen = (el.textContent || '').trim().length
      const children = el.children.length
      for (let col = 0; col < GRID; col++) {
        cells[row * GRID + col] += textLen / GRID + children
      }
    })

    const max = Math.max(...cells, 1)
    return cells.map(c => c / max)
  }, [html])

  const colorScale = scaleLinear()
    .domain([0, 0.3, 0.7, 1])
    .range(['#e3f2fd', '#90caf9', '#ff9800', '#f44336'])
    .clamp(true)

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
        Content density: blue = sparse, red = crowded. Click a cell to inspect that section.
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${GRID}, 1fr)`, gap: '2px', maxWidth: 400, mx: 'auto' }}>
        {density.map((d, i) => (
          <Tooltip key={i} title={`Row ${Math.floor(i / GRID) + 1}, Col ${(i % GRID) + 1}: ${Math.round(d * 100)}% density`} arrow>
            <Box
              sx={{
                aspectRatio: '1',
                bgcolor: colorScale(d),
                borderRadius: 0.5,
                opacity: 0.8,
                transition: 'all 0.15s',
                cursor: 'pointer',
                '&:hover': { opacity: 1, transform: 'scale(1.08)' },
              }}
            />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, px: 2 }}>
        <Typography variant="caption" color="text.disabled">Sparse</Typography>
        <Typography variant="caption" color="text.disabled">Dense</Typography>
      </Box>
    </Box>
  )
}

// ═════════════════════════════════════════════════════
// SVG Field Highlight Overlay — tracks highlighted token
// ═════════════════════════════════════════════════════
function FieldHighlightOverlay({ containerRef, highlightedField, getTokenColor }) {
  const [rects, setRects] = useState([])

  useEffect(() => {
    if (!containerRef.current || !highlightedField) { setRects([]); return }
    const container = containerRef.current
    const spans = container.querySelectorAll(`[data-token="${highlightedField}"]`)
    const cr = container.getBoundingClientRect()
    setRects(Array.from(spans).map(span => {
      const r = span.getBoundingClientRect()
      return {
        x: r.left - cr.left + container.scrollLeft,
        y: r.top - cr.top + container.scrollTop,
        width: r.width,
        height: r.height,
      }
    }))
  }, [containerRef, highlightedField])

  if (!rects.length) return null
  const color = getTokenColor(highlightedField)

  return (
    <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}>
      {rects.map((r, i) => (
        <rect key={i} x={r.x - 2} y={r.y - 1} width={r.width + 4} height={r.height + 2}
          fill="none" stroke={color} strokeWidth={2} rx={3}
          style={{ animation: 'highlightPulse 2s infinite' }}
        />
      ))}
    </svg>
  )
}

// ═════════════════════════════════════════════════════
// Main TemplateTab Component
// ═════════════════════════════════════════════════════
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
  const [viewMode, setViewMode] = useState('preview')
  const [displayMode, setDisplayMode] = useState('labels')
  const [inspectedElement, setInspectedElement] = useState(null)
  const [showGrid, setShowGrid] = useState(false)
  const [candidateAnchor, setCandidateAnchor] = useState(null)
  const [candidateToken, setCandidateToken] = useState(null)
  const previewRef = useRef(null)

  const tokens = template?.tokens || []
  const html = template?.html || ''
  const confidence = mapping?.confidence || {}
  const candidates = mapping?.candidates || {}
  const tokenSamples = mapping?.token_samples || {}

  // 1c + 1g + D1: Build highlighted HTML with token styling
  const highlightedHtml = useMemo(() => {
    if (!html) return ''
    let result = html
    tokens.forEach(t => {
      const color = getTokenColor(t)
      const isHL = highlightedField === t
      const isHeatmap = viewMode === 'heatmap'
      const bg = isHeatmap ? confBg(confidence[t]) : `${color}22`

      const style = [
        `background:${bg}`,
        `border:1px solid ${isHeatmap ? confScale(confidence[t] ?? 0.5) : color}`,
        'border-radius:3px', 'padding:0 4px',
        `font-weight:${isHL ? 700 : 500}`,
        isHL ? `box-shadow:0 0 0 2px ${color}` : '',
        'cursor:pointer',
      ].filter(Boolean).join(';')

      // 1g: Display mode — labels, raw {{token}}, or filled sample value
      let text
      if (displayMode === 'raw') text = `{{${t}}}`
      else if (displayMode === 'filled') {
        const s = tokenSamples[t]
        text = (Array.isArray(s) ? s[0] : s) || `{{${t}}}`
      } else text = humanizeToken(t)

      const re = new RegExp(`\\{\\{?\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}?`, 'g')
      result = result.replace(re, `<span style="${style}" data-token="${t}">${text}</span>`)
    })
    return result
  }, [html, tokens, getTokenColor, highlightedField, viewMode, confidence, displayMode, tokenSamples])

  // Click handler: A6 data source glow, A1 candidate popover, 1e typography
  const handlePreviewClick = useCallback((e) => {
    const tokenEl = e.target.closest?.('[data-token]')
    if (tokenEl) {
      const tok = tokenEl.dataset.token
      setHighlightedField(highlightedField === tok ? null : tok)
      setSelectedToken(selectedToken === tok ? null : tok)

      // D1/A1: Heatmap mode → show candidates for low confidence
      if (viewMode === 'heatmap' && confidence[tok] != null && confidence[tok] < 0.8) {
        setCandidateAnchor(tokenEl)
        setCandidateToken(tok)
      }
    }
    // 1e: Typography inspector
    if (viewMode === 'typo' && e.target?.nodeType === 1) {
      setInspectedElement(e.target)
    }
  }, [viewMode, highlightedField, selectedToken, confidence, setHighlightedField])

  // Empty state
  if (!html) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Typography color="text.secondary">No template yet. Upload a file to get started.</Typography>
      </Box>
    )
  }

  // 1a: Preview component (reused in fullscreen dialog)
  const previewContent = (
    <Paper variant="outlined" sx={{ flex: 1, overflow: 'auto', p: 1, position: 'relative' }} ref={previewRef}>
      <Box
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        onClick={handlePreviewClick}
        sx={{
          transform: fullscreen ? 'scale(0.75)' : 'scale(0.45)',
          transformOrigin: 'top left',
          width: fullscreen ? '133%' : '222%',
          cursor: viewMode === 'typo' ? 'crosshair' : 'pointer',
          '& table': { borderCollapse: 'collapse' },
          '& td, & th': { border: '1px solid #ddd', padding: '4px 8px', fontSize: '11px' },
          // 1d: Grid overlay
          ...(showGrid && {
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 49px, rgba(33,150,243,0.12) 49px, rgba(33,150,243,0.12) 50px), repeating-linear-gradient(90deg, transparent, transparent 49px, rgba(33,150,243,0.12) 49px, rgba(33,150,243,0.12) 50px)',
            backgroundSize: '50px 50px',
          }),
          '@keyframes highlightPulse': {
            '0%, 100%': { opacity: 0.4 },
            '50%': { opacity: 1 },
          },
        }}
      />
      <FieldHighlightOverlay containerRef={previewRef} highlightedField={highlightedField} getTokenColor={getTokenColor} />
    </Paper>
  )

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header toolbar ── */}
      <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 100 }}>Template Preview</Typography>
        <Chip label={`${tokens.length} fields`} size="small" variant="outlined" sx={{ height: 22 }} />

        {/* View mode */}
        <ToggleButtonGroup size="small" value={viewMode} exclusive onChange={(_, v) => v && setViewMode(v)}
          sx={{ '& .MuiToggleButton-root': { px: 0.75, py: 0.25 } }}>
          <ToggleButton value="preview"><Tooltip title="Normal"><Typography variant="caption">View</Typography></Tooltip></ToggleButton>
          <ToggleButton value="heatmap"><Tooltip title="Confidence heatmap"><HeatmapIcon sx={{ fontSize: 15 }} /></Tooltip></ToggleButton>
          <ToggleButton value="diff"><Tooltip title="Version diff"><DiffIcon sx={{ fontSize: 15 }} /></Tooltip></ToggleButton>
          <ToggleButton value="typo"><Tooltip title="Typography inspector"><TypoIcon sx={{ fontSize: 15 }} /></Tooltip></ToggleButton>
          <ToggleButton value="density"><Tooltip title="Density map"><DensityIcon sx={{ fontSize: 15 }} /></Tooltip></ToggleButton>
          {template?.pdfUrl && (
            <ToggleButton value="pdf"><Tooltip title="PDF source"><Typography variant="caption">PDF</Typography></Tooltip></ToggleButton>
          )}
        </ToggleButtonGroup>

        {/* 1g: Display mode */}
        <ToggleButtonGroup size="small" value={displayMode} exclusive onChange={(_, v) => v && setDisplayMode(v)}
          sx={{ '& .MuiToggleButton-root': { px: 0.5, py: 0.25 } }}>
          <ToggleButton value="labels"><Tooltip title="Labels"><Typography variant="caption" sx={{ fontSize: '0.6rem' }}>Abc</Typography></Tooltip></ToggleButton>
          <ToggleButton value="raw"><Tooltip title="Raw placeholders"><RawIcon sx={{ fontSize: 13 }} /></Tooltip></ToggleButton>
          <ToggleButton value="filled"><Tooltip title="Sample values"><FilledIcon sx={{ fontSize: 13 }} /></Tooltip></ToggleButton>
        </ToggleButtonGroup>

        {/* 1d: Grid toggle */}
        <Tooltip title={showGrid ? 'Hide grid' : 'Show grid'}>
          <IconButton size="small" onClick={() => setShowGrid(g => !g)} color={showGrid ? 'primary' : 'default'}>
            <GridIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>

        <Tooltip title="Fullscreen">
          <IconButton size="small" onClick={() => setFullscreen(true)}>
            <FullscreenIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* D1: Heatmap legend */}
      {viewMode === 'heatmap' && (
        <Box sx={{ px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.75, bgcolor: '#fafafa', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">Confidence:</Typography>
          {[0, 0.25, 0.5, 0.75, 1].map(v => (
            <Tooltip key={v} title={`${Math.round(v * 100)}%`}>
              <Box sx={{ width: 16, height: 12, borderRadius: 0.5, bgcolor: `${confScale(v)}66`, border: `1px solid ${confScale(v)}` }} />
            </Tooltip>
          ))}
          <Typography variant="caption" color="text.disabled" sx={{ ml: 0.25 }}>Low → High</Typography>
        </Box>
      )}

      {/* 1c: Token chips */}
      <Box sx={{ px: 2, py: 0.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5 }}
        onClick={() => setShowTokens(o => !o)}>
        <Typography variant="caption" fontWeight={600}>Fields</Typography>
        {showTokens ? <CollapseIcon sx={{ fontSize: 16 }} /> : <ExpandIcon sx={{ fontSize: 16 }} />}
      </Box>
      <Collapse in={showTokens}>
        <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ px: 2, pb: 1 }}>
          {tokens.map(t => {
            const conf = confidence[t]
            const isActive = selectedToken === t || highlightedField === t
            return (
              <Chip key={t} label={humanizeToken(t)} size="small"
                onClick={() => {
                  setSelectedToken(selectedToken === t ? null : t)
                  setHighlightedField(highlightedField === t ? null : t)
                }}
                className={clsx({ 'chip-selected': isActive })}
                sx={{
                  bgcolor: viewMode === 'heatmap' ? confBg(conf) : `${getTokenColor(t)}22`,
                  borderColor: viewMode === 'heatmap' ? confScale(conf ?? 0.5) : getTokenColor(t),
                  border: '1px solid',
                  fontWeight: isActive ? 700 : 400,
                  boxShadow: isActive ? `0 0 0 2px ${getTokenColor(t)}` : 'none',
                  transition: 'all 0.15s',
                }}
              />
            )
          })}
        </Stack>
      </Collapse>

      {/* 1f: Token inspector */}
      {selectedToken && viewMode !== 'diff' && (
        <Box sx={{ px: 2, pb: 1 }}>
          <TokenInspector token={selectedToken} mapping={mapping?.mapping} confidence={mapping?.confidence} />
        </Box>
      )}

      {/* 1e: Typography inspector */}
      {viewMode === 'typo' && inspectedElement && (
        <Box sx={{ px: 2, pb: 1 }}>
          <TypographyInspector element={inspectedElement} />
        </Box>
      )}

      <Divider />

      {/* ── Main content area ── */}
      {viewMode === 'diff' ? (
        <TemplateDiffView versions={templateVersions} />
      ) : viewMode === 'density' ? (
        <DensityMapView html={html} />
      ) : viewMode === 'pdf' && template?.pdfUrl ? (
        <Box sx={{ flex: 1, overflow: 'auto', p: 1, display: 'flex', justifyContent: 'center' }}>
          <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading PDF...</Typography>}>
            <PdfDocument file={template.pdfUrl}><PdfPage pageNumber={1} width={500} /></PdfDocument>
          </Suspense>
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>{previewContent}</Box>
      )}

      {/* D1/A1: Candidate popover for low-confidence fields */}
      <Popover
        open={!!candidateAnchor}
        anchorEl={candidateAnchor}
        onClose={() => { setCandidateAnchor(null); setCandidateToken(null) }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        {candidateToken && (
          <Box sx={{ p: 1.5, minWidth: 200, maxWidth: 300 }}>
            <Typography variant="caption" fontWeight={700} display="block">
              Top candidates for {humanizeToken(candidateToken)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              Current confidence: {Math.round((confidence[candidateToken] ?? 0) * 100)}%
            </Typography>
            <List dense disablePadding>
              {(candidates[candidateToken] || []).slice(0, 3).map((col, i) => (
                <ListItemButton key={typeof col === 'string' ? col : i} sx={{ borderRadius: 1, py: 0.5, px: 1 }}
                  onClick={() => {
                    onAction?.({ type: 'remap_field', token: candidateToken, column: col })
                    setCandidateAnchor(null); setCandidateToken(null)
                  }}>
                  <ListItemText
                    primary={typeof col === 'string' ? col.split('.').pop()?.replace(/_/g, ' ') : String(col)}
                    secondary={typeof col === 'string' && col.includes('.') ? col.split('.')[0] : null}
                    primaryTypographyProps={{ fontSize: '0.8rem' }}
                    secondaryTypographyProps={{ fontSize: '0.65rem' }}
                  />
                  <Typography variant="caption" color="primary.main" fontWeight={600}>Use</Typography>
                </ListItemButton>
              ))}
              {(!candidates[candidateToken] || !candidates[candidateToken].length) && (
                <Typography variant="caption" color="text.disabled" sx={{ p: 1 }}>No alternatives available</Typography>
              )}
            </List>
          </Box>
        )}
      </Popover>

      {/* 1a: Fullscreen dialog */}
      <Dialog open={fullscreen} onClose={() => setFullscreen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
          Template Preview
          <IconButton onClick={() => setFullscreen(false)} sx={{ ml: 'auto' }}><ExitIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ height: '75vh', overflow: 'auto' }}>{previewContent}</DialogContent>
      </Dialog>
    </Box>
  )
}
