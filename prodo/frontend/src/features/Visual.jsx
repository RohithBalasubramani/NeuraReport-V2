import { recommendWidgets } from '@/api/monitoring'
import { ActionButton, FullHeightPageContainer as PageContainer } from '@/styles/styles'
import { extractExcel } from '@/api/workspace'
import { neutral, palette } from '@/app/theme'
import { ConnectionSelector, PageHeader, SendToMenu, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { WidgetRenderer } from '@/features/Dashboards'
import { VARIANT_CONFIG } from '@/features/Dashboards'
import { useCrossPageActions, useSharedData } from '@/hooks/hooks'
import { useAppStore } from '@/stores/app'
import { useVisualizationStore } from '@/stores/workspace'
import { FeatureKey, OutputType, sanitizeSVG } from '@/utils/helpers'
import {
  AccountTree as FlowchartIcon,
  BarChart as ChartIcon,
  BubbleChart as NetworkIcon,
  Cable as ConnectionsIcon,
  Cloud as WordcloudIcon,
  Code as CodeIcon,
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
  FormatListNumbered as GanttIcon,
  Groups as OrgChartIcon,
  Hub as MindmapIcon,
  Image as ImageIcon,
  LinkOff as NoConnectionIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Storage as DbIcon,
  SwapVert as SequenceIcon,
  Timeline as TimelineIcon,
  UploadFile as UploadFileIcon,
  ViewKanban as KanbanIcon,
  Visibility as PreviewIcon,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import mermaid from 'mermaid'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
const ROW_HEIGHT = 80 // px per grid row unit

// ── Styled ───────────────────────────────────────────────────────────────

const DashboardGrid = styled(Box)({
  display: 'grid',
  gridTemplateColumns: 'repeat(12, 1fr)',
  gridAutoRows: ROW_HEIGHT,
  gap: 12,
  width: '100%',
})

const WidgetCell = styled(Box)(({ theme }) => ({
  position: 'relative',
  borderRadius: 10,
  border: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
  backgroundColor: theme.palette.background.paper,
  overflow: 'hidden',
  transition: 'box-shadow 0.2s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    boxShadow: `0 4px 24px ${alpha(theme.palette.common.black, 0.08)}`,
    borderColor: alpha(theme.palette.primary.main, 0.3),
  },
}))

const WidgetOverlay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  padding: theme.spacing(0.75, 1.5),
  background: `linear-gradient(transparent, ${alpha(theme.palette.background.paper, 0.92)})`,
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
  opacity: 0,
  transition: 'opacity 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '.MuiBox-root:hover > &': {
    opacity: 1,
  },
}))

// ── Component ────────────────────────────────────────────────────────────

export function WidgetsPageContainer() {
  const navigate = useNavigate()
  const [widgets, setWidgets] = useState([])
  const [grid, setGrid] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('overview')

  const connectionId = useAppStore((s) => s.activeConnectionId)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const connectionName = activeConnection?.name || connectionId || ''

  const loadRecommendations = useCallback(() => {
    if (!connectionId) return
    setLoading(true)
    setError(null)
    recommendWidgets({ connectionId, query, maxWidgets: 12 })
      .then((res) => {
        setWidgets(res.widgets || [])
        setGrid(res.grid || null)
        setProfile(res.profile || null)
      })
      .catch((err) => {
        console.error('[WidgetsPage] Recommendation failed:', err)
        setError(err.userMessage || err.message || 'Failed to get widget recommendations')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [connectionId, query])

  useEffect(() => {
    loadRecommendations()
  }, [loadRecommendations])

  const handleQuerySubmit = useCallback(
    (e) => {
      e.preventDefault()
      loadRecommendations()
    },
    [loadRecommendations],
  )

  // Build a lookup: widget_id → grid cell placement
  const cellMap = useMemo(() => {
    const map = {}
    if (grid?.cells) {
      for (const c of grid.cells) {
        map[c.widget_id] = c
      }
    }
    return map
  }, [grid])

  // ── No connection state ──────────────────────────────────────────────

  if (!connectionId) {
    return (
      <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
        <PageHeader
          title="Widget Intelligence"
          description="Dynamic data-driven widget recommendations"
        />
        <Box
          sx={{
            py: 10,
            textAlign: 'center',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            borderStyle: 'dashed',
          }}
        >
          <NoConnectionIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No database connected
          </Typography>
          <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>
            Connect a database from the Connections page to see intelligent widget
            recommendations tailored to your data.
          </Typography>
          <Button
            variant="contained"
            startIcon={<ConnectionsIcon />}
            onClick={() => navigate('/connections')}
            sx={{ textTransform: 'none' }}
          >
            Go to Connections
          </Button>
        </Box>
      </Box>
    )
  }

  // ── Loading state ────────────────────────────────────────────────────

  if (loading && widgets.length === 0) {
    return (
      <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
        <PageHeader title="Widget Intelligence" description={`Analyzing ${connectionName}...`} />
        <Box
          sx={{ py: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
        >
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            Analyzing database schema and recommending widgets...
          </Typography>
        </Box>
      </Box>
    )
  }

  // ── Error state ──────────────────────────────────────────────────────

  if (error && widgets.length === 0) {
    return (
      <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
        <PageHeader title="Widget Intelligence" description={connectionName} />
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="h6" color="error" gutterBottom>
            Recommendation failed
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {error}
          </Typography>
          <Chip label="Retry" onClick={loadRecommendations} color="primary" clickable />
        </Box>
      </Box>
    )
  }

  // ── Profile chips ────────────────────────────────────────────────────

  const profileChips = profile
    ? [
        `${profile.table_count} tables`,
        `${profile.numeric_columns} numeric cols`,
        profile.has_timeseries ? 'timeseries' : 'no timeseries',
      ]
    : []

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <PageHeader
        title="Widget Intelligence"
        description={`${widgets.length} widgets recommended for ${connectionName}`}
      />

      {/* Profile chips */}
      {profileChips.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Chip icon={<DbIcon />} label={connectionName} size="small" color="primary" variant="outlined" />
          {profileChips.map((label) => (
            <Chip key={label} label={label} size="small" variant="outlined" />
          ))}
        </Box>
      )}

      {/* Query bar */}
      <Box
        component="form"
        onSubmit={handleQuerySubmit}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}
      >
        <TextField
          size="small"
          placeholder="Describe what you want to see... (e.g. 'show trends and alerts')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18 }} />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flex: 1, minWidth: 240 }}
        />
        <Tooltip title="Refresh recommendations">
          <IconButton onClick={loadRecommendations} disabled={loading} size="small">
            <RefreshIcon sx={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Dashboard Grid — full-size widgets positioned by backend grid packer */}
      <DashboardGrid>
        {widgets.map((widget) => {
          const { id, scenario, variant, question, relevance, size } = widget
          const cell = cellMap[id]
          const vConfig = VARIANT_CONFIG[variant]
          const label = vConfig?.label || variant || scenario

          // Use backend grid packing if available, else auto-size by widget size
          const sizeSpans = { compact: 3, normal: 4, expanded: 6, hero: 12 }
          const rowSpans = { compact: 3, normal: 4, expanded: 4, hero: 5 }
          const colSpan = cell
            ? `${cell.col_start} / ${cell.col_end}`
            : `span ${sizeSpans[size] || 4}`
          const rowSpan = cell
            ? `${cell.row_start} / ${cell.row_end}`
            : `span ${rowSpans[size] || 4}`

          return (
            <WidgetCell
              key={id}
              sx={{
                gridColumn: colSpan,
                gridRow: rowSpan,
              }}
            >
              <Box sx={{ height: '100%', width: '100%' }}>
                <WidgetRenderer
                  scenario={scenario}
                  variant={variant}
                  connectionId={connectionId}
                  showSourceBadge
                />
              </Box>
              <WidgetOverlay>
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 600, flex: 1 }}
                  noWrap
                >
                  {question || label}
                </Typography>
                <Chip
                  label={`${Math.round(relevance * 100)}%`}
                  size="small"
                  color={relevance > 0.8 ? 'success' : 'default'}
                  variant="outlined"
                  sx={{ height: 18, fontSize: '10px' }}
                />
              </WidgetOverlay>
            </WidgetCell>
          )
        })}
      </DashboardGrid>

      {widgets.length === 0 && !loading && (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="body1" color="text.secondary">
            No widgets recommended for this database.
          </Typography>
          <Typography variant="caption" color="text.disabled">
            Try a different query or check your database connection.
          </Typography>
        </Box>
      )}

      {/* Grid utilization */}
      {grid && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Typography variant="caption" color="text.disabled">
            {grid.total_cols}&times;{grid.total_rows} grid &middot; {grid.utilization_pct}%
            utilization
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// === From: visualization.jsx ===
/**
 * Visualization Page Container
 * Diagram and chart generation interface.
 */


const sanitizeSvg = (svg) => {
  if (!svg) return ''
  // Remove script tags, event handlers, and foreignObject
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bon\w+\s*=\s*[^\s>]*/gi, '')
}


const Header = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2, 3),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
}))

const ContentArea = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
}))

const Sidebar = styled(Box)(({ theme }) => ({
  width: 300,
  borderRight: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.6),
  padding: theme.spacing(2),
  overflow: 'auto',
}))

const PreviewArea = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(3),
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: theme.palette.background.default,
  overflow: 'auto',
}))

const DiagramTypeCard = styled(Card)(({ theme, selected }) => ({
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  marginBottom: theme.spacing(1),
  border: selected ? `2px solid ${theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}` : `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  },
}))

const PreviewCard = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  maxWidth: '100%',
  maxHeight: '70vh',
  overflow: 'auto',
  backgroundColor: theme.palette.background.paper,
}))

const DIAGRAM_TYPES = [
  { type: 'flowchart', name: 'Flowchart', description: 'Process and decision flows', icon: FlowchartIcon },
  { type: 'mindmap', name: 'Mind Map', description: 'Hierarchical idea mapping', icon: MindmapIcon },
  { type: 'org_chart', name: 'Org Chart', description: 'Organizational structure', icon: OrgChartIcon },
  { type: 'timeline', name: 'Timeline', description: 'Chronological events', icon: TimelineIcon },
  { type: 'gantt', name: 'Gantt Chart', description: 'Project scheduling', icon: GanttIcon },
  { type: 'kanban', name: 'Kanban Board', description: 'Task management', icon: KanbanIcon },
  { type: 'network', name: 'Network Graph', description: 'Connections and relationships', icon: NetworkIcon },
  { type: 'sequence', name: 'Sequence Diagram', description: 'Process interactions', icon: SequenceIcon },
  { type: 'wordcloud', name: 'Word Cloud', description: 'Text frequency visualization', icon: WordcloudIcon },
]


mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })

function MermaidDiagram({ code }) {
  const containerRef = useRef(null)
  const [svgContent, setSvgContent] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false
    const id = `mermaid-${Date.now()}`

    mermaid.render(id, code).then(({ svg }) => {
      if (!cancelled) {
        setSvgContent(svg)
        setError(null)
      }
    }).catch((err) => {
      if (!cancelled) {
        setError(err?.message || 'Failed to render diagram')
        setSvgContent('')
      }
    })

    return () => { cancelled = true }
  }, [code])

  if (error) {
    return (
      <Box>
        <Alert severity="warning" sx={{ mb: 2 }}>Diagram render issue — showing code</Alert>
        <Typography component="pre" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {code}
        </Typography>
      </Box>
    )
  }

  if (!svgContent) return <CircularProgress size={24} />

  return (
    <Box
      ref={containerRef}
      dangerouslySetInnerHTML={{ __html: svgContent }}
      sx={{ '& svg': { maxWidth: '100%', height: 'auto' } }}
    />
  )
}


export function VisualizationPageContainer() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const {
    diagrams,
    currentDiagram,
    loading,
    generating,
    error,
    generateFlowchart,
    generateMindmap,
    generateOrgChart,
    generateTimeline,
    generateGantt,
    generateKanban,
    generateNetworkGraph,
    generateSequenceDiagram,
    generateWordcloud,
    exportAsMermaid,
    exportAsSvg,
    exportAsPng,
    setCurrentDiagram,
    reset,
  } = useVisualizationStore()

  const { connections, activeConnectionId } = useSharedData()
  const { registerOutput } = useCrossPageActions(FeatureKey.VISUALIZATION)
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId || '')

  const [selectedType, setSelectedType] = useState(DIAGRAM_TYPES[0])
  const [inputData, setInputData] = useState('')
  const [title, setTitle] = useState('')
  const [options, setOptions] = useState({})
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadedFileName, setUploadedFileName] = useState('')
  const [extractedTable, setExtractedTable] = useState(null) // { headers, rows, filename, sheetCount }
  const [previewType, setPreviewType] = useState(null)
  const fileInputRef = useRef(null)
  const activeDiagram = currentDiagram && previewType === selectedType.type ? currentDiagram : null

  useEffect(() => {
    return () => reset()
  }, [reset])

  const handleTypeChange = useCallback((type) => {
    setSelectedType(type)
    setInputData('')
    setTitle('')
    setUploadedFileName('')
    setExtractedTable(null)
    setPreviewType(null)
    setCurrentDiagram(null)
  }, [setCurrentDiagram])

  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setPreviewType(null)
    setCurrentDiagram(null)
    setUploadingFile(true)
    setUploadedFileName(file.name)
    try {
      const result = await extractExcel(file)
      let headers = []
      let rows = []

      if (result?.sheets?.length > 0) {
        const sheet = result.sheets[0]
        headers = sheet.headers || []
        rows = (sheet.rows || []).slice(0, 200)
      }

      if (headers.length > 0 && rows.length > 0) {
        // Build JSON array for diagram generation input
        const jsonRows = rows.map((row) => {
          const obj = {}
          headers.forEach((h, i) => { obj[h] = row[i] })
          return obj
        })
        setExtractedTable({ headers, rows, filename: file.name, sheetCount: result.total_sheets || 1 })
        setInputData(JSON.stringify(jsonRows, null, 2))
        setTitle(file.name.replace(/\.[^.]+$/, ''))
        toast.show(`Extracted ${rows.length} rows, ${headers.length} columns from ${file.name}`, 'success')
      } else {
        toast.show('No data found in file', 'warning')
      }
    } catch (err) {
      toast.show(err.message || 'Failed to extract data from file', 'error')
    } finally {
      setUploadingFile(false)
    }
  }, [setCurrentDiagram, toast])

  const handleGenerate = useCallback(async () => {
    if (!inputData.trim()) {
      toast.show('Please enter data', 'warning')
      return
    }

    const generateAction = async () => {
      let result = null
      const opts = { title, ...options }

      // Try parsing inputData as JSON array (from Excel upload)
      let parsedRows = null
      try {
        const parsed = JSON.parse(inputData)
        if (Array.isArray(parsed)) parsedRows = parsed
      } catch { /* not JSON, use as plain text */ }

      // Helper: extract single-column values from parsed rows
      const colValues = (rows) => {
        const keys = Object.keys(rows[0] || {})
        return keys.length === 1
          ? rows.map((r) => Object.values(r)[0]).filter(Boolean)
          : rows.map((r) => Object.values(r).join(' - ')).filter(Boolean)
      }

      try {
        switch (selectedType.type) {
          case 'flowchart': {
            const steps = parsedRows ? colValues(parsedRows) : inputData.split('\n').filter(Boolean)
            result = await generateFlowchart({ steps }, opts)
            break
          }
          case 'mindmap': {
            const text = parsedRows ? colValues(parsedRows).join('\n') : inputData
            result = await generateMindmap({ text }, opts)
            break
          }
          case 'org_chart':
            result = await generateOrgChart(parsedRows || JSON.parse(inputData), opts)
            break
          case 'timeline': {
            const events = parsedRows || inputData.split('\n').filter(Boolean)
            result = await generateTimeline({ events }, opts)
            break
          }
          case 'gantt':
            result = await generateGantt(parsedRows || JSON.parse(inputData), opts)
            break
          case 'kanban': {
            if (parsedRows) {
              result = await generateKanban({ items: parsedRows }, opts)
            } else {
              result = await generateKanban({ tasks: inputData }, opts)
            }
            break
          }
          case 'network': {
            if (parsedRows) {
              result = await generateNetworkGraph({ relationships: parsedRows }, opts)
            } else {
              result = await generateNetworkGraph({ connections: inputData.split('\n').filter(Boolean) }, opts)
            }
            break
          }
          case 'sequence': {
            if (parsedRows) {
              result = await generateSequenceDiagram({ interactions: parsedRows }, opts)
            } else {
              result = await generateSequenceDiagram({ interactions: inputData.split('\n').filter(Boolean) }, opts)
            }
            break
          }
          case 'wordcloud': {
            if (parsedRows) {
              const text = colValues(parsedRows).join(' ')
              result = await generateWordcloud({ text }, opts)
            } else {
              try {
                const parsed = JSON.parse(inputData)
                result = await generateWordcloud({ frequencies: parsed }, opts)
              } catch {
                result = await generateWordcloud({ text: inputData }, opts)
              }
            }
            break
          }
          default:
            break
        }

        if (result) {
          setPreviewType(selectedType.type)
          registerOutput({
            type: OutputType.DIAGRAM,
            title: `${selectedType.name}: ${title || 'Untitled'}`,
            summary: `${selectedType.name} diagram`,
            data: { id: result.id, svg: result.svg, mermaid: result.mermaid_code, content: result.content },
            format: 'diagram',
          })
          toast.show('Diagram generated', 'success')
        }
        return result
      } catch (err) {
        toast.show(`Error: ${err.message}`, 'error')
        throw err
      }
    }

    return execute({
      type: InteractionType.CREATE,
      label: `Generate ${selectedType.name}`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      intent: { source: 'visualization', type: selectedType.type },
      action: generateAction,
    })
  }, [execute, generateFlowchart, generateGantt, generateKanban, generateMindmap, generateNetworkGraph, generateOrgChart, generateSequenceDiagram, generateTimeline, generateWordcloud, inputData, options, registerOutput, selectedType, title, toast])

  const handleExport = useCallback(async (format) => {
    if (!activeDiagram?.id) return

    let result
    switch (format) {
      case 'mermaid':
        result = await exportAsMermaid(activeDiagram.id)
        if (result) {
          navigator.clipboard.writeText(result.code)
          toast.show('Mermaid code copied', 'success')
        }
        break
      case 'svg':
        result = await exportAsSvg(activeDiagram.id)
        break
      case 'png':
        result = await exportAsPng(activeDiagram.id)
        if (result) {
          const url = URL.createObjectURL(result)
          const a = document.createElement('a')
          a.href = url
          a.download = `${title || 'diagram'}.png`
          a.click()
          URL.revokeObjectURL(url)
          toast.show('PNG downloaded', 'success')
        }
        break
      default:
        break
    }
  }, [activeDiagram?.id, exportAsMermaid, exportAsPng, exportAsSvg, title, toast])

  return (
    <PageContainer>
      <Header>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ChartIcon sx={{ color: 'text.secondary', fontSize: 28 }} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Visualization Studio
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Generate diagrams, charts, and visualizations
              </Typography>
            </Box>
          </Box>
          {activeDiagram && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <SendToMenu
                outputType={OutputType.DIAGRAM}
                payload={{
                  title: `${selectedType.name}: ${title || 'Diagram'}`,
                  data: { id: activeDiagram.id, svg: activeDiagram.svg, mermaid: activeDiagram.mermaid_code },
                }}
                sourceFeature={FeatureKey.VISUALIZATION}
              />
              <Tooltip title="Copy Mermaid Code">
                <IconButton onClick={() => handleExport('mermaid')}>
                  <CodeIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Download PNG">
                <IconButton onClick={() => handleExport('png')}>
                  <ImageIcon />
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </Box>
      </Header>

      <ContentArea>
        {/* Sidebar - Diagram Types & Input */}
        <Sidebar>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
            Diagram Type
          </Typography>
          {DIAGRAM_TYPES.map((type) => (
            <DiagramTypeCard
              key={type.type}
              selected={selectedType.type === type.type}
              onClick={() => handleTypeChange(type)}
            >
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: alpha(theme.palette.text.primary, 0.08),
                    }}
                  >
                    <type.icon sx={{ color: 'text.secondary', fontSize: 18 }} />
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {type.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {type.description}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </DiagramTypeCard>
          ))}

          {/* Input Section */}
          <Box sx={{ mt: 3 }}>
            <TextField
              fullWidth
              size="small"
              label="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              sx={{ mb: 2 }}
            />
            <ConnectionSelector
              value={selectedConnectionId}
              onChange={setSelectedConnectionId}
              label="Data Source"
              size="small"
              showStatus
              sx={{ mb: 2 }}
            />
            {/* File Upload */}
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
            />
            <Button
              fullWidth
              variant="outlined"
              size="small"
              startIcon={uploadingFile ? <CircularProgress size={16} color="inherit" /> : <UploadFileIcon />}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile}
              sx={{ mb: 1, textTransform: 'none', borderStyle: 'dashed' }}
            >
              {uploadingFile ? 'Extracting data...' : 'Upload Excel / CSV'}
            </Button>
            {uploadedFileName && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, textAlign: 'center' }}>
                {uploadedFileName}
              </Typography>
            )}
            <TextField
              fullWidth
              multiline
              rows={8}
              label="Data Input"
              placeholder="Upload an Excel/CSV file or paste data here..."
              value={inputData}
              onChange={(e) => setInputData(e.target.value)}
              sx={{ mb: 2 }}
            />
            <ActionButton
              variant="contained"
              fullWidth
              startIcon={generating ? <CircularProgress size={20} color="inherit" /> : <PreviewIcon />}
              onClick={handleGenerate}
              disabled={!inputData.trim() || generating}
            >
              {generating ? 'Generating...' : 'Generate'}
            </ActionButton>
          </Box>
        </Sidebar>

        {/* Preview Area */}
        <PreviewArea sx={extractedTable || activeDiagram ? { justifyContent: 'flex-start', alignItems: 'stretch' } : {}}>
          {activeDiagram ? (
            <PreviewCard elevation={2}>
              {activeDiagram.mermaid_code ? (
                <MermaidDiagram code={activeDiagram.mermaid_code} />
              ) : activeDiagram.svg ? (
                <Box
                  dangerouslySetInnerHTML={{ __html: sanitizeSVG(activeDiagram.svg) }}
                  sx={{ '& svg': { maxWidth: '100%', height: 'auto' } }}
                />
              ) : activeDiagram.content ? (
                <Typography
                  component="pre"
                  sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}
                >
                  {typeof activeDiagram.content === 'string'
                    ? activeDiagram.content
                    : JSON.stringify(activeDiagram.content, null, 2)}
                </Typography>
              ) : (
                <Typography color="text.secondary">No diagram data returned</Typography>
              )}
            </PreviewCard>
          ) : extractedTable ? (
            <Box sx={{ width: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {extractedTable.filename}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {extractedTable.rows.length} rows, {extractedTable.headers.length} columns
                    {extractedTable.sheetCount > 1 ? ` (${extractedTable.sheetCount} sheets — showing first)` : ''}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<UploadFileIcon />}
                    onClick={() => fileInputRef.current?.click()}
                    sx={{ textTransform: 'none' }}
                  >
                    Upload Another
                  </Button>
                  <ActionButton
                    variant="contained"
                    size="small"
                    startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <PreviewIcon />}
                    onClick={handleGenerate}
                    disabled={!inputData.trim() || generating}
                  >
                    {generating ? 'Generating...' : `Generate ${selectedType.name}`}
                  </ActionButton>
                </Box>
              </Box>
              <TableContainer component={Paper} elevation={1} sx={{ maxHeight: 'calc(100vh - 220px)' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, bgcolor: 'background.paper', color: 'text.secondary', fontSize: 11, py: 0.75 }}>#</TableCell>
                      {extractedTable.headers.map((h) => (
                        <TableCell key={h} sx={{ fontWeight: 700, bgcolor: 'background.paper', whiteSpace: 'nowrap', py: 0.75 }}>
                          {h}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {extractedTable.rows.map((row, ri) => (
                      <TableRow key={ri} hover>
                        <TableCell sx={{ color: 'text.secondary', fontSize: 11, py: 0.5 }}>{ri + 1}</TableCell>
                        {row.map((cell, ci) => (
                          <TableCell key={ci} sx={{ whiteSpace: 'nowrap', py: 0.5 }}>{cell}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          ) : (
            <Box sx={{ textAlign: 'center', maxWidth: 400 }}>
              <UploadFileIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                Upload Excel Data
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Upload an Excel or CSV file to extract data, then select a diagram type and generate a visualization.
              </Typography>
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => fileInputRef.current?.click()}
                sx={{ textTransform: 'none' }}
              >
                Upload Excel / CSV
              </Button>
            </Box>
          )}
        </PreviewArea>
      </ContentArea>

      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          {error}
        </Alert>
      )}
    </PageContainer>
  )
}
