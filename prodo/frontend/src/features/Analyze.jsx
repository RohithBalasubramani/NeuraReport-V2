import { API_BASE, fetchWithIntent, handleStreamingResponse } from '@/api/client'
import { neutral, palette, secondary } from '@/app/theme'
import { ConnectionSelector, Surface, TemplateSelector, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { AiUsageNotice } from '@/components/ux'
import { GlassCard, float } from '@/styles/styles'
import ArticleIcon from '@mui/icons-material/Article'
import AssessmentIcon from '@mui/icons-material/Assessment'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import AutoGraphIcon from '@mui/icons-material/AutoGraph'
import BarChartIcon from '@mui/icons-material/BarChart'
import BoltIcon from '@mui/icons-material/Bolt'
import CancelIcon from '@mui/icons-material/Cancel'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DataObjectIcon from '@mui/icons-material/DataObject'
import DescriptionIcon from '@mui/icons-material/Description'
import DownloadIcon from '@mui/icons-material/Download'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import GavelIcon from '@mui/icons-material/Gavel'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import InsightsIcon from '@mui/icons-material/Insights'
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck'
import PsychologyIcon from '@mui/icons-material/Psychology'
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import RefreshIcon from '@mui/icons-material/Refresh'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import SecurityIcon from '@mui/icons-material/Security'
import SendIcon from '@mui/icons-material/Send'
import SentimentNeutralIcon from '@mui/icons-material/SentimentNeutral'
import SentimentSatisfiedAltIcon from '@mui/icons-material/SentimentSatisfiedAlt'
import SentimentVeryDissatisfiedIcon from '@mui/icons-material/SentimentVeryDissatisfied'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import SpeedIcon from '@mui/icons-material/Speed'
import TableChartIcon from '@mui/icons-material/TableChart'
import TimelineIcon from '@mui/icons-material/Timeline'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutMapIcon from '@mui/icons-material/ZoomOutMap'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Fade,
  FormControlLabel,
  Grid,
  Grow,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
  Zoom,
  alpha,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
const CHART_COLORS = [
  secondary.violet[500],   // #8B5CF6
  secondary.emerald[500],  // #10B981
  secondary.cyan[500],     // #06B6D4
  secondary.rose[500],     // #F43F5E
  secondary.teal[500],     // #14B8A6
  secondary.fuchsia[500],  // #D946EF
  secondary.slate[500],    // #64748B
  secondary.zinc[500],     // #71717A
]

const CHART_MARGINS = { top: 8, right: 16, bottom: 24, left: 8 }

function ZoomableChart({
  data = [],
  spec = {},
  height = 350,
  showBrush = true,
  showZoomControls = true,
}) {
  const chartRef = useRef(null)
  const [exporting, setExporting] = useState(false)
  const [zoomState, setZoomState] = useState({
    refAreaLeft: null,
    refAreaRight: null,
    startIndex: 0,
    endIndex: null,
    isZoomed: false,
  })

  const { type = 'bar', xField, yFields = [], title } = spec

  const displayData = useMemo(() => {
    if (!data || data.length === 0) return []

    if (zoomState.isZoomed && zoomState.startIndex !== null) {
      const end = zoomState.endIndex ?? data.length
      return data.slice(zoomState.startIndex, end + 1)
    }
    return data
  }, [data, zoomState])

  const handleMouseDown = useCallback((e) => {
    if (!e?.activeLabel) return
    setZoomState((prev) => ({
      ...prev,
      refAreaLeft: e.activeLabel,
      refAreaRight: null,
    }))
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!zoomState.refAreaLeft || !e?.activeLabel) return
    setZoomState((prev) => ({
      ...prev,
      refAreaRight: e.activeLabel,
    }))
  }, [zoomState.refAreaLeft])

  const handleMouseUp = useCallback(() => {
    if (!zoomState.refAreaLeft || !zoomState.refAreaRight) {
      setZoomState((prev) => ({
        ...prev,
        refAreaLeft: null,
        refAreaRight: null,
      }))
      return
    }

    let left = zoomState.refAreaLeft
    let right = zoomState.refAreaRight

    const leftIndex = data.findIndex((d) => d[xField] === left)
    const rightIndex = data.findIndex((d) => d[xField] === right)

    if (leftIndex > rightIndex) {
      [left, right] = [right, left]
    }

    const startIdx = Math.min(leftIndex, rightIndex)
    const endIdx = Math.max(leftIndex, rightIndex)

    if (endIdx - startIdx < 1) {
      setZoomState((prev) => ({
        ...prev,
        refAreaLeft: null,
        refAreaRight: null,
      }))
      return
    }

    setZoomState({
      refAreaLeft: null,
      refAreaRight: null,
      startIndex: startIdx,
      endIndex: endIdx,
      isZoomed: true,
    })
  }, [zoomState.refAreaLeft, zoomState.refAreaRight, data, xField])

  const handleResetZoom = useCallback(() => {
    setZoomState({
      refAreaLeft: null,
      refAreaRight: null,
      startIndex: 0,
      endIndex: null,
      isZoomed: false,
    })
  }, [])

  const handleExportChart = useCallback(async () => {
    if (!chartRef.current) return

    setExporting(true)
    try {
      const svgElement = chartRef.current.querySelector('svg')
      if (!svgElement) {
        console.warn('No SVG found to export')
        return
      }

      // Clone the SVG to avoid modifying the original
      const clonedSvg = svgElement.cloneNode(true)

      // Add white background
      const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      bgRect.setAttribute('width', '100%')
      bgRect.setAttribute('height', '100%')
      bgRect.setAttribute('fill', 'white')
      clonedSvg.insertBefore(bgRect, clonedSvg.firstChild)

      // Get SVG dimensions
      const bbox = svgElement.getBoundingClientRect()
      clonedSvg.setAttribute('width', bbox.width)
      clonedSvg.setAttribute('height', bbox.height)

      // Convert SVG to data URL
      const svgData = new XMLSerializer().serializeToString(clonedSvg)
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl = URL.createObjectURL(svgBlob)

      // Create canvas and draw SVG
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()

      img.onload = () => {
        canvas.width = bbox.width * 2 // 2x for higher resolution
        canvas.height = bbox.height * 2
        ctx.scale(2, 2)
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, bbox.width, bbox.height)
        ctx.drawImage(img, 0, 0)

        // Download as PNG
        const pngUrl = canvas.toDataURL('image/png')
        const link = document.createElement('a')
        link.href = pngUrl
        link.download = `chart_${title || 'export'}_${Date.now()}.png`
        link.click()

        URL.revokeObjectURL(svgUrl)
        setExporting(false)
      }

      img.onerror = () => {
        // Fallback to SVG download
        const link = document.createElement('a')
        link.href = svgUrl
        link.download = `chart_${title || 'export'}_${Date.now()}.svg`
        link.click()

        URL.revokeObjectURL(svgUrl)
        setExporting(false)
      }

      img.src = svgUrl
    } catch (err) {
      console.error('Failed to export chart:', err)
      setExporting(false)
    }
  }, [title])

  const handleBrushChange = useCallback((range) => {
    if (!range) return
    const { startIndex, endIndex } = range
    if (startIndex !== undefined && endIndex !== undefined) {
      setZoomState((prev) => ({
        ...prev,
        startIndex,
        endIndex,
        isZoomed: startIndex > 0 || endIndex < data.length - 1,
      }))
    }
  }, [data.length])

  const renderChart = () => {
    if (!xField || yFields.length === 0) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height }}>
          <Typography color="text.secondary">Invalid chart configuration</Typography>
        </Box>
      )
    }

    if (!displayData || displayData.length === 0) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height }}>
          <Typography color="text.secondary">No data available</Typography>
        </Box>
      )
    }

    const commonProps = {
      data: displayData,
      margin: CHART_MARGINS,
      onMouseDown: type !== 'pie' ? handleMouseDown : undefined,
      onMouseMove: type !== 'pie' ? handleMouseMove : undefined,
      onMouseUp: type !== 'pie' ? handleMouseUp : undefined,
    }

    const zoomArea =
      zoomState.refAreaLeft && zoomState.refAreaRight ? (
        <ReferenceArea
          x1={zoomState.refAreaLeft}
          x2={zoomState.refAreaRight}
          strokeOpacity={0.3}
          fill={secondary.violet[500]}
          fillOpacity={0.3}
        />
      ) : null

    const brush = showBrush && type !== 'pie' && data.length > 10 ? (
      <Brush
        dataKey={xField}
        height={24}
        stroke={secondary.violet[500]}
        travellerWidth={8}
        onChange={handleBrushChange}
        startIndex={zoomState.startIndex}
        endIndex={zoomState.endIndex ?? data.length - 1}
      />
    ) : null

    switch (type) {
      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xField} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {yFields.map((field, idx) => (
              <Line
                key={field}
                type="monotone"
                dataKey={field}
                stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ))}
            {zoomArea}
            {brush}
          </LineChart>
        )

      case 'pie':
        return (
          <PieChart>
            <Pie
              data={displayData}
              dataKey={yFields[0]}
              nameKey={xField}
              cx="50%"
              cy="50%"
              innerRadius="40%"
              outerRadius="75%"
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              labelLine={{ stroke: neutral[500], strokeWidth: 1 }}
            >
              {displayData.map((entry, idx) => (
                <Cell key={`cell-${idx}`} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        )

      case 'scatter':
        return (
          <ScatterChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xField} name={xField} tick={{ fontSize: 12 }} />
            <YAxis dataKey={yFields[0]} name={yFields[0]} tick={{ fontSize: 12 }} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Legend />
            <Scatter
              name={yFields[0]}
              data={displayData}
              fill={CHART_COLORS[0]}
            />
            {zoomArea}
            {brush}
          </ScatterChart>
        )

      case 'bar':
      default:
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xField} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            {yFields.map((field, idx) => (
              <Bar
                key={field}
                dataKey={field}
                fill={CHART_COLORS[idx % CHART_COLORS.length]}
                radius={[4, 4, 0, 0]}
              />
            ))}
            {zoomArea}
            {brush}
          </BarChart>
        )
    }
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {title && (
            <Typography variant="subtitle1" fontWeight={600}>
              {title}
            </Typography>
          )}
          <Chip label={type.toUpperCase()} size="small" variant="outlined" />
          {zoomState.isZoomed && (
            <Chip label="Zoomed" size="small" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
          )}
        </Stack>

        <Stack direction="row" spacing={0.5} alignItems="center">
          <MuiTooltip title="Export chart as PNG">
            <IconButton
              size="small"
              onClick={handleExportChart}
              disabled={exporting}
            >
              {exporting ? (
                <CircularProgress size={16} />
              ) : (
                <DownloadIcon fontSize="small" />
              )}
            </IconButton>
          </MuiTooltip>
          {showZoomControls && type !== 'pie' && (
            <>
              <IconButton
                size="small"
                onClick={handleResetZoom}
                disabled={!zoomState.isZoomed}
                title="Reset zoom"
              >
                <ZoomOutMapIcon fontSize="small" />
              </IconButton>
              <Typography variant="caption" color="text.secondary">
                Drag to zoom
              </Typography>
            </>
          )}
        </Stack>
      </Stack>

      <Box ref={chartRef} sx={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </Box>

      {spec.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {spec.description}
        </Typography>
      )}
    </Box>
  )
}

// DocumentUpload

const ACCEPTED_TYPES = '.pdf,.xlsx,.xls,.xlsm'
const ACCEPTED_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]

function DocumentUpload({
  onFileSelect,
  isUploading = false,
  progress = 0,
  progressStage = '',
  error = null,
  disabled = false,
}) {
  const [dragActive, setDragActive] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [validationError, setValidationError] = useState(null)

  const handleDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const processFile = useCallback(
    (file) => {
      setValidationError(null)

      const validation = validateDocumentFile(file)
      if (!validation.valid) {
        setValidationError(validation.error)
        setSelectedFile(null)
        return
      }

      setSelectedFile(file)
      onFileSelect?.(file)
    },
    [onFileSelect]
  )

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)

      if (disabled || isUploading) return

      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        processFile(files[0])
      }
    },
    [disabled, isUploading, processFile]
  )

  const handleFileInput = useCallback(
    (e) => {
      const files = e.target?.files
      if (files && files.length > 0) {
        processFile(files[0])
      }
      e.target.value = ''
    },
    [processFile]
  )

  const handleClear = useCallback(() => {
    setSelectedFile(null)
    setValidationError(null)
    onFileSelect?.(null)
  }, [onFileSelect])

  const displayError = error || validationError

  return (
    <Paper
      variant="outlined"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      sx={{
        p: 4,
        textAlign: 'center',
        cursor: disabled || isUploading ? 'default' : 'pointer',
        transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        borderStyle: 'dashed',
        borderWidth: 2,
        borderColor: dragActive
          ? 'text.secondary'
          : displayError
            ? 'text.secondary'
            : selectedFile
              ? 'text.secondary'
              : 'divider',
        bgcolor: dragActive
          ? 'action.hover'
          : displayError
            ? 'error.lighter'
            : selectedFile
              ? 'success.lighter'
              : 'background.paper',
        '&:hover': {
          borderColor: disabled || isUploading ? undefined : 'text.secondary',
          bgcolor: disabled || isUploading ? undefined : 'action.hover',
        },
      }}
    >
      <input
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleFileInput}
        disabled={disabled || isUploading}
        style={{ display: 'none' }}
        id="document-upload-input"
      />

      {isUploading ? (
        <Stack spacing={2} alignItems="center">
          <Typography variant="body1" color="text.secondary">
            {progressStage || 'Analyzing document...'}
          </Typography>
          <Box sx={{ width: '100%', maxWidth: 400 }}>
            <LinearProgress variant="determinate" value={progress} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {progress}% complete
          </Typography>
        </Stack>
      ) : selectedFile ? (
        <Stack spacing={2} alignItems="center">
          <CheckCircleIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
          <Stack direction="row" spacing={1} alignItems="center">
            <InsertDriveFileIcon color="action" />
            <Typography variant="body1">{selectedFile.name}</Typography>
            <Chip
              size="small"
              label={`${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`}
              variant="outlined"
            />
          </Stack>
          <Button variant="outlined" size="small" onClick={handleClear}>
            Choose different file
          </Button>
        </Stack>
      ) : (
        <label htmlFor="document-upload-input" style={{ cursor: disabled ? 'default' : 'pointer' }}>
          <Stack spacing={2} alignItems="center">
            <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
            <Typography variant="h6" color="text.primary">
              Drop a document here or click to browse
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Supports PDF and Excel files (max 50MB)
            </Typography>
            <Stack direction="row" spacing={1}>
              <Chip label="PDF" size="small" variant="outlined" />
              <Chip label="XLSX" size="small" variant="outlined" />
              <Chip label="XLS" size="small" variant="outlined" />
            </Stack>
          </Stack>
        </label>
      )}

      {displayError && (
        <Alert severity="error" sx={{ mt: 2, textAlign: 'left' }}>
          {displayError}
        </Alert>
      )}
    </Paper>
  )
}

// AnalysisResults

function TabPanel({ children, value, index, ...other }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`analysis-tabpanel-${index}`}
      aria-labelledby={`analysis-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 2 }}>{children}</Box>}
    </div>
  )
}

function MetricCard({ metric }) {
  const formatValue = (value, unit) => {
    if (value === null || value === undefined) return 'N/A'
    if (typeof value === 'number') {
      const formatted = value.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })
      return unit ? `${formatted} ${unit}` : formatted
    }
    return String(value)
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" gutterBottom>
          {metric.key}
        </Typography>
        <Typography variant="h6" fontWeight={600}>
          {formatValue(metric.value, metric.unit)}
        </Typography>
        {metric.context && (
          <Typography variant="caption" color="text.secondary">
            {metric.context}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

function ExtractedTableView({ table, maxRows = 50 }) {
  const displayRows = table.rows?.slice(0, maxRows) || []
  const hasMore = (table.rows?.length || 0) > maxRows

  return (
    <TableContainer sx={{ maxHeight: 400 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {table.headers?.map((header, idx) => (
              <TableCell key={idx} sx={{ fontWeight: 600, bgcolor: 'background.paper' }}>
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <span>{header}</span>
                  {table.data_types?.[idx] && (
                    <Chip
                      label={table.data_types[idx]}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: '10px', height: 18 }}
                    />
                  )}
                </Stack>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {displayRows.map((row, rowIdx) => (
            <TableRow key={rowIdx} hover>
              {row.map((cell, cellIdx) => (
                <TableCell key={cellIdx} sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {cell || '-'}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {hasMore && (
        <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>
          Showing {maxRows} of {table.rows.length} rows
        </Typography>
      )}
    </TableContainer>
  )
}

function AnalysisResults({ result }) {
  const [tabValue, setTabValue] = useState(0)
  const [selectedChart, setSelectedChart] = useState(0)

  const {
    document_name,
    document_type,
    processing_time_ms,
    summary,
    tables = [],
    data_points = [],
    chart_suggestions = [],
    raw_data = [],
    field_catalog = [],
    warnings = [],
  } = result || {}

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue)
  }

  const handleExportCSV = () => {
    if (!raw_data || raw_data.length === 0) return

    const headers = Object.keys(raw_data[0])
    const csvRows = [
      headers.join(','),
      ...raw_data.map((row) =>
        headers.map((h) => {
          const val = row[h]
          if (val === null || val === undefined) return ''
          const str = String(val)
          return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str
        }).join(',')
      ),
    ]
    const csvContent = csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${document_name || 'analysis'}_data.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleExportJSON = () => {
    if (!raw_data || raw_data.length === 0) return

    const jsonContent = JSON.stringify(raw_data, null, 2)
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${document_name || 'analysis'}_data.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const currentChartSpec = chart_suggestions[selectedChart] || null

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h6">{document_name || 'Analysis Results'}</Typography>
          <Chip label={document_type?.toUpperCase()} size="small" variant="outlined" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
          {processing_time_ms && (
            <Chip label={`${(processing_time_ms / 1000).toFixed(1)}s`} size="small" variant="outlined" />
          )}
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            startIcon={<DownloadIcon />}
            size="small"
            onClick={handleExportCSV}
            disabled={!raw_data?.length}
          >
            Export CSV
          </Button>
          <Button
            startIcon={<DownloadIcon />}
            size="small"
            onClick={handleExportJSON}
            disabled={!raw_data?.length}
          >
            Export JSON
          </Button>
        </Stack>
      </Stack>

      {summary && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {summary}
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {warnings.join('; ')}
        </Alert>
      )}

      {data_points.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Key Metrics
          </Typography>
          <Grid container spacing={2}>
            {data_points.slice(0, 8).map((metric, idx) => (
              <Grid size={{ xs: 6, sm: 4, md: 3 }} key={idx}>
                <MetricCard metric={metric} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Tabs value={tabValue} onChange={handleTabChange} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab icon={<BarChartIcon />} label={`Charts (${chart_suggestions.length})`} iconPosition="start" />
          <Tab icon={<TableChartIcon />} label={`Tables (${tables.length})`} iconPosition="start" />
          <Tab icon={<InsightsIcon />} label={`Fields (${field_catalog.length})`} iconPosition="start" />
        </Tabs>

        <TabPanel value={tabValue} index={0}>
          {chart_suggestions.length > 0 ? (
            <Box>
              <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
                {chart_suggestions.map((chart, idx) => (
                  <Chip
                    key={idx}
                    label={chart.title || `Chart ${idx + 1}`}
                    onClick={() => setSelectedChart(idx)}
                    color={selectedChart === idx ? 'primary' : 'default'}
                    variant={selectedChart === idx ? 'filled' : 'outlined'}
                    icon={chart.type === 'line' ? <TimelineIcon /> : <BarChartIcon />}
                  />
                ))}
              </Stack>

              {currentChartSpec && (
                <ZoomableChart
                  data={raw_data}
                  spec={currentChartSpec}
                  height={400}
                  showBrush={raw_data.length > 15}
                />
              )}
            </Box>
          ) : (
            <Typography color="text.secondary" textAlign="center" py={4}>
              No chart suggestions available
            </Typography>
          )}
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          {tables.length > 0 ? (
            <Stack spacing={2}>
              {tables.map((table, idx) => (
                <Accordion key={idx} defaultExpanded={idx === 0}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <TableChartIcon fontSize="small" color="action" />
                      <Typography fontWeight={500}>
                        {table.title || table.id || `Table ${idx + 1}`}
                      </Typography>
                      <Chip
                        label={`${table.rows?.length || 0} rows`}
                        size="small"
                        variant="outlined"
                      />
                      <Chip
                        label={`${table.headers?.length || 0} cols`}
                        size="small"
                        variant="outlined"
                      />
                      {table.source_page && (
                        <Chip label={`Page ${table.source_page}`} size="small" />
                      )}
                      {table.source_sheet && (
                        <Chip label={table.source_sheet} size="small" />
                      )}
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 0 }}>
                    <ExtractedTableView table={table} />
                  </AccordionDetails>
                </Accordion>
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary" textAlign="center" py={4}>
              No tables extracted
            </Typography>
          )}
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          {field_catalog.length > 0 ? (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Field Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Sample Values</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {field_catalog.map((field, idx) => (
                    <TableRow key={idx} hover>
                      <TableCell>{field.name}</TableCell>
                      <TableCell>
                        <Chip
                          label={field.type}
                          size="small"
                          color={
                            field.type === 'numeric'
                              ? 'success'
                              : field.type === 'datetime'
                                ? 'info'
                                : 'default'
                          }
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        {field.sample_values?.slice(0, 3).join(', ') || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Typography color="text.secondary" textAlign="center" py={4}>
              No field information available
            </Typography>
          )}
        </TabPanel>
      </Paper>
    </Box>
  )
}

// === From: api.js ===

/**
 * Upload and analyze a document (PDF or Excel).
 * Returns streaming NDJSON events with progress and final result.
 *
 * @param {Object} options
 * @param {File} options.file - The document file to analyze
 * @param {string} [options.templateId] - Optional template ID to link
 * @param {string} [options.connectionId] - Optional connection ID
 * @param {Function} [options.onProgress] - Callback for progress events
 * @param {boolean} [options.background=false] - Queue analysis as a background job
 * @param {AbortSignal} [options.signal] - Abort signal for cancelling the request
 * @returns {Promise<Object>} The final analysis result
 */
export async function uploadAndAnalyze({
  file,
  templateId,
  connectionId,
  onProgress,
  background = false,
  signal,
}) {
  if (!file) {
    throw new Error('No file provided for analysis')
  }

  const form = new FormData()
  form.append('file', file)
  if (templateId) form.append('template_id', templateId)
  if (connectionId) form.append('connection_id', connectionId)

  if (background) {
    const res = await fetchWithIntent(`${API_BASE}/analyze/upload?background=true`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `Failed to queue analysis (${res.status})`)
    }
    return res.json()
  }

  const res = await fetchWithIntent(`${API_BASE}/analyze/upload`, {
    method: 'POST',
    body: form,
    signal,
  })

  return handleStreamingResponse(res, {
    onEvent: onProgress,
    errorMessage: 'Document analysis failed',
  })
}

/**
 * Get a previously computed analysis result.
 *
 * @param {string} analysisId - The analysis ID
 * @returns {Promise<Object>} The analysis result
 */
export async function getAnalysis(analysisId) {
  if (!analysisId) throw new Error('Analysis ID is required')

  const res = await fetchWithIntent(`${API_BASE}/analyze/${encodeURIComponent(analysisId)}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Failed to get analysis (${res.status})`)
  }
  return res.json()
}

/**
 * Get raw data from an analysis for charting.
 *
 * @param {string} analysisId - The analysis ID
 * @param {Object} [options]
 * @param {number} [options.limit=500] - Maximum rows to return
 * @param {number} [options.offset=0] - Offset for pagination
 * @returns {Promise<Object>} The raw data
 */
export async function getAnalysisData(analysisId, { limit = 500, offset = 0 } = {}) {
  if (!analysisId) throw new Error('Analysis ID is required')

  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (offset) params.set('offset', String(offset))

  const query = params.toString()
  const res = await fetchWithIntent(`${API_BASE}/analyze/${encodeURIComponent(analysisId)}/data${query ? `?${query}` : ''}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Failed to get analysis data (${res.status})`)
  }
  return res.json()
}

/**
 * Get additional chart suggestions for an analysis.
 *
 * @param {string} analysisId - The analysis ID
 * @param {Object} [options]
 * @param {string} [options.question] - Natural language question for chart suggestions
 * @param {boolean} [options.includeSampleData=true] - Include sample data in response
 * @param {string[]} [options.tableIds] - Filter to specific tables
 * @returns {Promise<Object>} Chart suggestions and optional sample data
 */
export async function suggestAnalysisCharts(analysisId, { question, includeSampleData = true, tableIds } = {}) {
  if (!analysisId) throw new Error('Analysis ID is required')

  const payload = {
    question: question || '',
    include_sample_data: includeSampleData,
  }
  if (Array.isArray(tableIds) && tableIds.length) {
    payload.table_ids = tableIds
  }

  const res = await fetchWithIntent(`${API_BASE}/analyze/${encodeURIComponent(analysisId)}/charts/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Failed to get chart suggestions (${res.status})`)
  }
  return res.json()
}

/**
 * Normalize a chart spec from the API response.
 *
 * @param {Object} chart - Raw chart spec from API
 * @param {number} idx - Index for fallback ID
 * @returns {Object|null} Normalized chart spec
 */
function normalizeChartSpec(chart, idx = 0) {
  if (!chart || typeof chart !== 'object') return null

  const type = typeof chart.type === 'string' ? chart.type.toLowerCase().trim() : 'bar'
  // Backend returns snake_case (x_field), frontend uses camelCase (xField) — accept both
  const rawX = chart.xField ?? chart.x_field ?? ''
  const xField = typeof rawX === 'string' ? rawX.trim() : ''

  let yFields = chart.yFields ?? chart.y_fields
  if (typeof yFields === 'string') {
    yFields = [yFields]
  }
  if (!Array.isArray(yFields)) {
    yFields = []
  }
  const normalizedY = yFields
    .map((v) => (typeof v === 'string' ? v.trim() : String(v)))
    .filter(Boolean)

  if (!xField || !normalizedY.length) return null

  return {
    id: chart.id ? String(chart.id) : `chart_${idx + 1}`,
    type,
    xField,
    yFields: normalizedY,
    groupField: chart.groupField ?? null,
    aggregation: chart.aggregation ?? null,
    title: chart.title ?? null,
    description: chart.description ?? null,
  }
}

/**
 * Validate that a file is a supported document type.
 *
 * @param {File} file - The file to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateDocumentFile(file) {
  if (!file) {
    return { valid: false, error: 'No file selected' }
  }

  const maxSizeMB = 50
  if (file.size > maxSizeMB * 1024 * 1024) {
    return { valid: false, error: `File too large. Maximum size is ${maxSizeMB}MB.` }
  }

  const name = file.name.toLowerCase()
  const validExtensions = ['.pdf', '.xlsx', '.xls', '.xlsm']
  const hasValidExt = validExtensions.some((ext) => name.endsWith(ext))

  if (!hasValidExt) {
    return { valid: false, error: 'Only PDF and Excel files are supported.' }
  }

  return { valid: true }
}

// API functions are individually exported above


// (imports already at top of file)

const API_V2 = `${API_BASE}/analyze/v2`

/**
 * Upload and analyze a document with enhanced AI features
 *
 * @param {Object} options
 * @param {File} options.file - The document file to analyze
 * @param {Object} [options.preferences] - Analysis preferences
 * @param {Function} [options.onProgress] - Callback for progress events
 * @param {AbortSignal} [options.signal] - Abort signal for cancellation
 * @returns {Promise<Object>} The final analysis result
 */
export async function uploadAndAnalyzeEnhanced({
  file,
  preferences = {},
  onProgress,
  signal,
}) {
  if (!file) {
    throw new Error('No file provided for analysis')
  }

  const form = new FormData()
  form.append('file', file)

  if (Object.keys(preferences).length > 0) {
    form.append('preferences', JSON.stringify(preferences))
  }

  const res = await fetchWithIntent(`${API_V2}/upload`, {
    method: 'POST',
    body: form,
    signal,
  })

  return handleStreamingResponse(res, {
    onEvent: onProgress,
    errorMessage: 'Enhanced document analysis failed',
  })
}

/**
 * Get a previously computed analysis result
 *
 * @param {string} analysisId - The analysis ID
 * @returns {Promise<Object>} The analysis result
 */
export async function getEnhancedAnalysis(analysisId) {
  if (!analysisId) throw new Error('Analysis ID is required')

  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Failed to get analysis (${res.status})`)
  }
  return res.json()
}

/**
 * Ask a natural language question about the analyzed document
 *
 * @param {string} analysisId - The analysis ID
 * @param {Object} options
 * @param {string} options.question - The question to ask
 * @param {boolean} [options.includeSources=true] - Include source citations
 * @param {number} [options.maxContextChunks=5] - Max context chunks to use
 * @returns {Promise<Object>} The answer with sources
 */
export async function askQuestion(analysisId, { question, includeSources = true, maxContextChunks = 5 }) {
  if (!analysisId) throw new Error('Analysis ID is required')
  if (!question) throw new Error('Question is required')

  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      include_sources: includeSources,
      max_context_chunks: maxContextChunks,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Failed to ask question (${res.status})`)
  }
  return res.json()
}

/**
 * Get suggested questions for an analysis
 *
 * @param {string} analysisId - The analysis ID
 * @returns {Promise<Object>} Suggested questions
 */
export async function getSuggestedQuestions(analysisId) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/suggested-questions`)
  if (!res.ok) {
    throw new Error('Failed to get suggested questions')
  }
  return res.json()
}

/**
 * Generate charts from natural language query
 *
 * @param {string} analysisId - The analysis ID
 * @param {Object} options
 * @param {string} options.query - Natural language chart request
 * @param {boolean} [options.includeTrends=true] - Include trend lines
 * @param {boolean} [options.includeForecasts=false] - Include forecasts
 * @returns {Promise<Object>} Generated charts
 */
export async function generateCharts(analysisId, { query, includeTrends = true, includeForecasts = false }) {
  if (!analysisId) throw new Error('Analysis ID is required')
  if (!query) throw new Error('Query is required')

  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/charts/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      include_trends: includeTrends,
      include_forecasts: includeForecasts,
    }),
  })

  if (!res.ok) {
    throw new Error('Failed to generate charts')
  }
  return res.json()
}

/**
 * Get all charts for an analysis
 *
 * @param {string} analysisId - The analysis ID
 * @returns {Promise<Object>} Charts and suggestions
 */
export async function getCharts(analysisId) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/charts`)
  if (!res.ok) {
    throw new Error('Failed to get charts')
  }
  return res.json()
}

/**
 * Get extracted tables
 *
 * @param {string} analysisId - The analysis ID
 * @param {number} [limit=10] - Maximum tables to return
 * @returns {Promise<Object>} Tables data
 */
export async function getTables(analysisId, limit = 10) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/tables?limit=${limit}`)
  if (!res.ok) {
    throw new Error('Failed to get tables')
  }
  return res.json()
}

/**
 * Get extracted metrics
 *
 * @param {string} analysisId - The analysis ID
 * @returns {Promise<Object>} Metrics data
 */
export async function getMetrics(analysisId) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/metrics`)
  if (!res.ok) {
    throw new Error('Failed to get metrics')
  }
  return res.json()
}

/**
 * Get extracted entities
 *
 * @param {string} analysisId - The analysis ID
 * @returns {Promise<Object>} Entities data
 */
export async function getEntities(analysisId) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/entities`)
  if (!res.ok) {
    throw new Error('Failed to get entities')
  }
  return res.json()
}

/**
 * Get insights, risks, and opportunities
 *
 * @param {string} analysisId - The analysis ID
 * @returns {Promise<Object>} Insights data
 */
export async function getInsights(analysisId) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/insights`)
  if (!res.ok) {
    throw new Error('Failed to get insights')
  }
  return res.json()
}

/**
 * Get data quality assessment
 *
 * @param {string} analysisId - The analysis ID
 * @returns {Promise<Object>} Data quality report
 */
export async function getDataQuality(analysisId) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/quality`)
  if (!res.ok) {
    throw new Error('Failed to get data quality')
  }
  return res.json()
}

/**
 * Get a specific summary mode
 *
 * @param {string} analysisId - The analysis ID
 * @param {string} mode - Summary mode (executive, data, quick, comprehensive, action_items, risks, opportunities)
 * @returns {Promise<Object>} Summary data
 */
export async function getSummary(analysisId, mode) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/summary/${mode}`)
  if (!res.ok) {
    throw new Error(`Failed to get ${mode} summary`)
  }
  return res.json()
}

/**
 * Export analysis in various formats
 *
 * @param {string} analysisId - The analysis ID
 * @param {Object} options
 * @param {string} options.format - Export format (json, csv, excel, pdf, markdown, html)
 * @param {boolean} [options.includeRawData=true] - Include raw data
 * @param {boolean} [options.includeCharts=true] - Include charts
 * @returns {Promise<Blob>} The exported file
 */
export async function exportAnalysis(analysisId, { format = 'json', includeRawData = true, includeCharts = true }) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      format,
      include_raw_data: includeRawData,
      include_charts: includeCharts,
    }),
  })

  if (!res.ok) {
    throw new Error('Failed to export analysis')
  }

  return res.blob()
}

/**
 * Compare two documents
 *
 * @param {string} analysisId1 - First analysis ID
 * @param {string} analysisId2 - Second analysis ID
 * @returns {Promise<Object>} Comparison result
 */
export async function compareDocuments(analysisId1, analysisId2) {
  const res = await fetchWithIntent(`${API_V2}/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      analysis_id_1: analysisId1,
      analysis_id_2: analysisId2,
    }),
  })

  if (!res.ok) {
    throw new Error('Failed to compare documents')
  }
  return res.json()
}

/**
 * Add a comment to an analysis
 *
 * @param {string} analysisId - The analysis ID
 * @param {Object} options
 * @param {string} options.content - Comment content
 * @param {string} [options.elementType] - Type of element (table, chart, insight, metric)
 * @param {string} [options.elementId] - ID of the element
 * @param {string} [options.userId] - User ID
 * @param {string} [options.userName] - User name
 * @returns {Promise<Object>} Created comment
 */
export async function addComment(analysisId, { content, elementType, elementId, userId = 'anonymous', userName = 'Anonymous' }) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      element_type: elementType,
      element_id: elementId,
      user_id: userId,
      user_name: userName,
    }),
  })

  if (!res.ok) {
    throw new Error('Failed to add comment')
  }
  return res.json()
}

/**
 * Get comments for an analysis
 *
 * @param {string} analysisId - The analysis ID
 * @returns {Promise<Object>} Comments
 */
export async function getComments(analysisId) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/comments`)
  if (!res.ok) {
    throw new Error('Failed to get comments')
  }
  return res.json()
}

/**
 * Create a share link for an analysis
 *
 * @param {string} analysisId - The analysis ID
 * @param {Object} options
 * @param {string} [options.accessLevel='view'] - Access level (view, comment, edit)
 * @param {number} [options.expiresHours] - Hours until expiration
 * @param {boolean} [options.passwordProtected=false] - Require password
 * @param {string[]} [options.allowedEmails=[]] - Allowed email addresses
 * @returns {Promise<Object>} Share link info
 */
export async function createShareLink(analysisId, { accessLevel = 'view', expiresHours, passwordProtected = false, allowedEmails = [] }) {
  const res = await fetchWithIntent(`${API_V2}/${encodeURIComponent(analysisId)}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_level: accessLevel,
      expires_hours: expiresHours,
      password_protected: passwordProtected,
      allowed_emails: allowedEmails,
    }),
  })

  if (!res.ok) {
    throw new Error('Failed to create share link')
  }
  return res.json()
}

/**
 * Get available industry options
 *
 * @returns {Promise<Object>} Industry options
 */
export async function getIndustryOptions() {
  const res = await fetchWithIntent(`${API_V2}/config/industries`)
  if (!res.ok) {
    throw new Error('Failed to get industry options')
  }
  return res.json()
}

/**
 * Get available export formats
 *
 * @returns {Promise<Object>} Export formats
 */
export async function getExportFormats() {
  const res = await fetchWithIntent(`${API_V2}/config/export-formats`)
  if (!res.ok) {
    throw new Error('Failed to get export formats')
  }
  return res.json()
}

/**
 * Get available chart types
 *
 * @returns {Promise<Object>} Chart types
 */
export async function getChartTypes() {
  const res = await fetchWithIntent(`${API_V2}/config/chart-types`)
  if (!res.ok) {
    throw new Error('Failed to get chart types')
  }
  return res.json()
}

/**
 * Get available summary modes
 *
 * @returns {Promise<Object>} Summary modes
 */
export async function getSummaryModes() {
  const res = await fetchWithIntent(`${API_V2}/config/summary-modes`)
  if (!res.ok) {
    throw new Error('Failed to get summary modes')
  }
  return res.json()
}

// Enhanced API functions are exported as named exports above

// === From: src/features/analyze/containers.jsx ===

// === From: AnalyzePageContainer.jsx ===

const STEPS = [
  { label: 'Upload Document', icon: <UploadFileOutlinedIcon fontSize="small" /> },
  { label: 'AI Analysis', icon: <AutoAwesomeIcon fontSize="small" /> },
  { label: 'View Results', icon: <InsightsOutlinedIcon fontSize="small" /> },
]

export function AnalyzePageContainer() {
  const [activeStep, setActiveStep] = useState(0)
  const [selectedFile, setSelectedFile] = useState(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [progressStage, setProgressStage] = useState('')
  const [analysisResult, setAnalysisResult] = useState(null)
  const [error, setError] = useState(null)
  const [chartQuestion, setChartQuestion] = useState('')
  const [isLoadingCharts, setIsLoadingCharts] = useState(false)
  const [runInBackground, setRunInBackground] = useState(false)
  const [queuedJobId, setQueuedJobId] = useState(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const abortControllerRef = useRef(null)

  // Abort in-flight analysis on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [])

  const toast = useToast()
  const { execute } = useInteraction()
  const navigate = useNavigateInteraction()
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { from: 'analyze', ...intent } }),
    [navigate]
  )

  const handleFileSelect = useCallback((file) => {
    setSelectedFile(file)
    setError(null)
    setAnalysisResult(null)
    setQueuedJobId(null)
    if (file) {
      setActiveStep(0)
    }
  }, [])

  const handleAnalyze = useCallback(() => {
    if (!selectedFile) return undefined

    return execute({
      type: InteractionType.ANALYZE,
      label: runInBackground ? 'Queue analysis' : 'Analyze document',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: !runInBackground,
      suppressSuccessToast: true,
      intent: {
        fileName: selectedFile?.name,
        background: runInBackground,
      },
      action: async () => {
        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController()

        setIsAnalyzing(true)
        setAnalysisProgress(0)
        setProgressStage('Starting analysis...')
        setError(null)
        setQueuedJobId(null)

        if (runInBackground) {
          try {
            const queued = await uploadAndAnalyze({
              file: selectedFile,
              background: true,
              connectionId: selectedConnectionId || undefined,
              templateId: selectedTemplateId || undefined,
            })
            const jobId = queued?.job_id || queued?.jobId || null
            setQueuedJobId(jobId)
            setAnalysisResult(null)
            setActiveStep(0)
            toast.show('Analysis queued in background', 'success')
          } catch (err) {
            if (err.name !== 'AbortError') {
              setError(err.message || 'Failed to queue analysis')
            }
          } finally {
            setIsAnalyzing(false)
            setAnalysisProgress(0)
            setProgressStage('')
            abortControllerRef.current = null
          }
          return
        }

        setActiveStep(1)

        try {
          const result = await uploadAndAnalyze({
            file: selectedFile,
            connectionId: selectedConnectionId || undefined,
            templateId: selectedTemplateId || undefined,
            signal: abortControllerRef.current?.signal,
            onProgress: (event) => {
              if (event.event === 'stage') {
                setAnalysisProgress(event.progress || 0)
                setProgressStage(event.detail || event.stage || 'Processing...')
              }
            },
          })

          if (result.event === 'result') {
            setAnalysisResult(result)
            setActiveStep(2)
          }
        } catch (err) {
          if (err.name === 'AbortError') {
            toast.show('Analysis cancelled', 'info')
            setActiveStep(0)
          } else {
            setError(err.message || 'Analysis failed')
            setActiveStep(0)
          }
        } finally {
          setIsAnalyzing(false)
          setAnalysisProgress(100)
          abortControllerRef.current = null
        }
      },
    })
  }, [execute, selectedFile, runInBackground, toast])

  const handleCancelAnalysis = useCallback(() => {
    return execute({
      type: InteractionType.UPDATE,
      label: 'Cancel analysis',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'analyze' },
      action: () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
          setIsAnalyzing(false)
          setActiveStep(0)
          setAnalysisProgress(0)
          setProgressStage('')
          toast.show('Analysis cancelled', 'info')
        }
      },
    })
  }, [execute, toast])

  const handleAskCharts = useCallback(() => {
    if (!analysisResult?.analysis_id || !chartQuestion.trim()) return undefined

    return execute({
      type: InteractionType.GENERATE,
      label: 'Generate charts',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      suppressSuccessToast: true,
      intent: { analysisId: analysisResult.analysis_id },
      action: async () => {
        setIsLoadingCharts(true)
        try {
          const response = await suggestAnalysisCharts(analysisResult.analysis_id, {
            question: chartQuestion,
            includeSampleData: true,
          })

          if (response?.charts) {
            const normalizedCharts = response.charts
              .map((c, idx) => normalizeChartSpec(c, idx))
              .filter(Boolean)

            setAnalysisResult((prev) => ({
              ...prev,
              chart_suggestions: [
                ...normalizedCharts,
                ...(prev.chart_suggestions || []),
              ],
            }))
          }
        } catch (err) {
          setError(err.message || 'Failed to generate charts')
        } finally {
          setIsLoadingCharts(false)
          setChartQuestion('')
        }
      },
    })
  }, [analysisResult?.analysis_id, chartQuestion, execute])

  const handleReset = useCallback(() => {
    return execute({
      type: InteractionType.UPDATE,
      label: 'Reset analysis',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'analyze' },
      action: () => {
        setSelectedFile(null)
        setAnalysisResult(null)
        setError(null)
        setActiveStep(0)
        setChartQuestion('')
        setQueuedJobId(null)
      },
    })
  }, [execute])

  // Compute status chips
  const getStatusChips = () => {
    const chips = []
    if (selectedFile) {
      chips.push({ label: selectedFile.name, color: 'primary', variant: 'outlined' })
    }
    if (analysisResult) {
      const tableCount = analysisResult.tables?.length || 0
      const chartCount = analysisResult.chart_suggestions?.length || 0
      if (tableCount > 0) chips.push({ label: `${tableCount} table${tableCount !== 1 ? 's' : ''} found`, color: 'success' })
      if (chartCount > 0) chips.push({ label: `${chartCount} chart${chartCount !== 1 ? 's' : ''}`, color: 'info' })
    }
    return chips
  }

  const statusChips = getStatusChips()

  return (
    <Box sx={{ py: 3, px: 3 }}>
      {/* Page Header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            Analyze Document
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Upload PDF or Excel files to extract tables and generate interactive visualizations.
          </Typography>
        </Box>
        {analysisResult && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={handleReset}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            New Analysis
          </Button>
        )}
      </Stack>

      <Stack spacing={3}>
        {/* Status Chips */}
        {statusChips.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {statusChips.map((chip, idx) => (
              <Chip
                key={idx}
                label={chip.label}
                size="small"
                variant={chip.variant || 'filled'}
                icon={chip.color === 'success' ? <CheckCircleOutlineIcon /> : undefined}
                sx={{ fontWeight: 500, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
              />
            ))}
          </Stack>
        )}

        {queuedJobId && (
          <Alert
            severity="info"
            action={(
              <Button size="small" onClick={() => handleNavigate('/jobs', 'Open jobs')} sx={{ textTransform: 'none' }}>
                View Jobs
              </Button>
            )}
            sx={{ alignItems: 'center' }}
          >
            Analysis queued in background. Job ID: {queuedJobId}
          </Alert>
        )}

        {/* Progress Stepper */}
      <Surface sx={{ p: 3 }}>
        <Stepper
          activeStep={activeStep}
          sx={{
            mb: 3,
            '& .MuiStepLabel-label': {
              fontWeight: 500,
            },
            '& .MuiStepLabel-label.Mui-active': {
              fontWeight: 600,
              color: 'text.secondary',
            },
            '& .MuiStepLabel-label.Mui-completed': {
              fontWeight: 600,
              color: 'text.secondary',
            },
          }}
        >
          {STEPS.map((step, index) => (
            <Step key={step.label} completed={activeStep > index}>
              <StepLabel
                StepIconProps={{
                  sx: {
                    '&.Mui-completed': { color: 'text.secondary' },
                    '&.Mui-active': { color: 'text.secondary' },
                  },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  {step.icon}
                  <span>{step.label}</span>
                </Stack>
              </StepLabel>
            </Step>
          ))}
        </Stepper>

        {/* Step 0: Upload */}
        {activeStep === 0 && (
          <Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <ConnectionSelector
                value={selectedConnectionId}
                onChange={setSelectedConnectionId}
                label="Analyze from Connection (Optional)"
                size="small"
                showStatus
              />
              <TemplateSelector
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
                label="Report Template (Optional)"
                size="small"
              />
            </Stack>
            <DocumentUpload
              onFileSelect={handleFileSelect}
              isUploading={isAnalyzing}
              progress={analysisProgress}
              progressStage={progressStage}
              error={error}
              disabled={isAnalyzing}
            />

            {selectedFile && !isAnalyzing && (
              <Stack spacing={2} sx={{ mt: 3 }}>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={runInBackground}
                      onChange={(e) => setRunInBackground(e.target.checked)}
                    />
                  )}
                  label="Run in background"
                  sx={{ alignSelf: 'center' }}
                />
                <Stack direction="row" justifyContent="center">
                  <Button
                    variant="contained"
                    size="large"
                    onClick={handleAnalyze}
                    startIcon={<AutoAwesomeIcon />}
                    sx={{
                      px: 4,
                      py: 1.5,
                      fontWeight: 600,
                      fontSize: '1rem',
                      textTransform: 'none',
                      borderRadius: 1,  // Figma spec: 8px
                      boxShadow: `0 4px 14px ${alpha(secondary.violet[500], 0.25)}`,
                      '&:hover': {
                        boxShadow: `0 6px 20px ${alpha(secondary.violet[500], 0.35)}`,
                      },
                    }}
                  >
                    {runInBackground ? 'Queue Analysis' : 'Analyze with AI'}
                  </Button>
                </Stack>
              </Stack>
            )}
          </Box>
        )}

        {/* Step 1: Analyzing */}
        {activeStep === 1 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Box sx={{ position: 'relative', display: 'inline-flex', mb: 3 }}>
              <CircularProgress
                size={80}
                thickness={4}
                variant={analysisProgress > 0 ? 'determinate' : 'indeterminate'}
                value={analysisProgress}
                sx={{ color: 'text.secondary' }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  right: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="caption" fontWeight={600} color="text.secondary">
                  {analysisProgress}%
                </Typography>
              </Box>
            </Box>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              {progressStage || 'Analyzing document...'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              AI is extracting tables, metrics, and generating chart suggestions
            </Typography>
            <LinearProgress
              variant="determinate"
              value={analysisProgress}
              sx={{
                height: 6,
                borderRadius: 1,  // Figma spec: 8px
                maxWidth: 400,
                mx: 'auto',
                mb: 3,
                bgcolor: 'action.hover',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 1,  // Figma spec: 8px
                },
              }}
            />
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<CancelIcon />}
              onClick={handleCancelAnalysis}
              sx={{
                textTransform: 'none',
                fontWeight: 500,
              }}
            >
              Cancel Analysis
            </Button>
          </Box>
        )}

        {/* Step 2: Results */}
        {activeStep === 2 && analysisResult && (
          <Box>
            <AnalysisResults result={analysisResult} />

            <Divider sx={{ my: 3 }} />

            {/* Ask for more insights */}
            <Surface
              variant="outlined"
              sx={{
                p: 2.5,
                bgcolor: 'action.hover',
                border: '1px dashed',
                borderColor: 'divider',
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <AutoAwesomeIcon color="inherit" fontSize="small" sx={{ color: 'text.secondary' }} />
                <Typography variant="subtitle1" fontWeight={600}>
                  Ask for more insights
                </Typography>
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  placeholder="e.g., Show me revenue trends over time, Compare categories by month..."
                  value={chartQuestion}
                  onChange={(e) => setChartQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAskCharts()}
                  disabled={isLoadingCharts}
                  size="small"
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: 'background.paper',
                    },
                  }}
                />
                <Button
                  variant="contained"
                  onClick={handleAskCharts}
                  disabled={!chartQuestion.trim() || isLoadingCharts}
                  startIcon={isLoadingCharts ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                  sx={{
                    minWidth: 160,
                    textTransform: 'none',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isLoadingCharts ? 'Generating...' : 'Generate Charts'}
                </Button>
              </Stack>
            </Surface>
          </Box>
        )}

        {/* Error Display */}
        {error && activeStep !== 0 && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Surface>

        {/* Help Text */}
        <Box sx={{ textAlign: 'center', py: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Supported formats: PDF, Excel (XLSX, XLS) • Max file size: 50MB
          </Typography>
          <Typography variant="caption" color="text.disabled">
            AI-powered extraction with zoomable, interactive time series charts
          </Typography>
        </Box>
      </Stack>
    </Box>
  )
}

// === From: EnhancedAnalyzePageContainer.jsx ===

// Animated stat card
function StatCard({ icon, label, value, delay = 0 }) {
  const theme = useTheme()
  return (
    <Grow in timeout={500 + delay * 100}>
      <Card
        sx={{
          minWidth: 140,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.08)} 0%, ${alpha(theme.palette.text.primary, 0.03)} 100%)`
            : `linear-gradient(135deg, ${neutral[100]} 0%, ${neutral[50]} 100%)`,
          border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
          borderRadius: 1,  // Figma spec: 8px
          transition: 'all 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          '&:hover': {
            transform: 'scale(1.05)',
            boxShadow: theme.palette.mode === 'dark' ? `0 8px 24px ${alpha(theme.palette.common.black, 0.3)}` : '0 8px 24px rgba(0,0,0,0.08)',
          },
        }}
      >
        <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 } }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Avatar
              sx={{
                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
                color: 'text.secondary',
                width: 40,
                height: 40,
              }}
            >
              {icon}
            </Avatar>
            <Box>
              <Typography variant="h5" fontWeight={600} color="text.primary">
                {value}
              </Typography>
              <Typography variant="caption" color="text.secondary" fontWeight={500}>
                {label}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Grow>
  )
}

// Enhanced metric card
function EnhancedMetricCard({ metric, index }) {
  const theme = useTheme()
  const isPositive = metric.change > 0
  const isNegative = metric.change < 0

  return (
    <Zoom in timeout={300 + index * 50}>
      <Card
        sx={{
          minWidth: 220,
          background: `linear-gradient(145deg, ${theme.palette.background.paper} 0%, ${alpha(theme.palette.text.primary, 0.02)} 100%)`,
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          borderRadius: 1,  // Figma spec: 8px
          overflow: 'hidden',
          position: 'relative',
          transition: 'all 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          '&:hover': {
            transform: 'translateY(-6px)',
            boxShadow: theme.palette.mode === 'dark' ? `0 12px 32px ${alpha(theme.palette.common.black, 0.3)}` : '0 12px 32px rgba(0,0,0,0.08)',
            '& .metric-icon': {
              transform: 'scale(1.2) rotate(10deg)',
            },
          },
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
          },
        }}
      >
        <CardContent sx={{ py: 2.5, px: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box sx={{ flex: 1 }}>
              <Typography
                variant="caption"
                color="text.secondary"
                fontWeight={600}
                sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
              >
                {metric.name}
              </Typography>
              <Typography
                variant="h4"
                fontWeight={600}
                sx={{
                  mt: 0.5,
                  color: theme.palette.text.primary,
                }}
              >
                {metric.raw_value}
              </Typography>
              {metric.change !== undefined && metric.change !== null && (
                <Chip
                  size="small"
                  icon={isPositive ? <TrendingUpIcon sx={{ fontSize: 14 }} /> : isNegative ? <TrendingUpIcon sx={{ fontSize: 14, transform: 'rotate(180deg)' }} /> : null}
                  label={`${isPositive ? '+' : ''}${metric.change}%`}
                  sx={{
                    mt: 1,
                    height: 24,
                    fontWeight: 600,
                    bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
                    color: 'text.secondary',
                    '& .MuiChip-icon': {
                      color: 'inherit',
                    },
                  }}
                />
              )}
            </Box>
            <Box
              className="metric-icon"
              sx={{
                transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                color: alpha(theme.palette.text.primary, 0.15),
              }}
            >
              <AutoGraphIcon sx={{ fontSize: 48 }} />
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Zoom>
  )
}

// Enhanced insight card
function InsightCard({ insight, type = 'insight', index = 0 }) {
  const theme = useTheme()

  const config = {
    insight: {
      gradient: theme.palette.mode === 'dark'
        ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.08)} 0%, ${alpha(theme.palette.text.primary, 0.04)} 100%)`
        : `linear-gradient(135deg, ${neutral[100]} 0%, ${neutral[50]} 100%)`,
      borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
      icon: <LightbulbIcon />,
      iconBg: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
    },
    risk: {
      gradient: theme.palette.mode === 'dark'
        ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.08)} 0%, ${alpha(theme.palette.text.primary, 0.04)} 100%)`
        : `linear-gradient(135deg, ${neutral[100]} 0%, ${neutral[50]} 100%)`,
      borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
      icon: <SecurityIcon />,
      iconBg: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
    },
    opportunity: {
      gradient: theme.palette.mode === 'dark'
        ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.08)} 0%, ${alpha(theme.palette.text.primary, 0.04)} 100%)`
        : `linear-gradient(135deg, ${neutral[100]} 0%, ${neutral[50]} 100%)`,
      borderColor: theme.palette.mode === 'dark' ? neutral[300] : neutral[500],
      icon: <RocketLaunchIcon />,
      iconBg: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
    },
    action: {
      gradient: theme.palette.mode === 'dark'
        ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.08)} 0%, ${alpha(theme.palette.text.primary, 0.04)} 100%)`
        : `linear-gradient(135deg, ${neutral[100]} 0%, ${neutral[50]} 100%)`,
      borderColor: theme.palette.mode === 'dark' ? neutral[300] : neutral[500],
      icon: <PlaylistAddCheckIcon />,
      iconBg: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
    },
  }

  const { gradient, borderColor, icon, iconBg } = config[type] || config.insight

  const priorityColors = {
    critical: { bg: theme.palette.mode === 'dark' ? neutral[700] : neutral[900], text: 'common.white' },
    high: { bg: theme.palette.mode === 'dark' ? neutral[500] : neutral[700], text: 'common.white' },
    medium: { bg: theme.palette.mode === 'dark' ? neutral[500] : neutral[500], text: 'common.white' },
    low: { bg: theme.palette.mode === 'dark' ? neutral[300] : neutral[500], text: theme.palette.mode === 'dark' ? neutral[900] : 'common.white' },
  }

  const priorityConfig = priorityColors[insight.priority?.toLowerCase()] || priorityColors.medium

  return (
    <Fade in timeout={400 + index * 100}>
      <Card
        sx={{
          mb: 2,
          background: gradient,
          borderLeft: `4px solid ${borderColor}`,
          borderRadius: 1,  // Figma spec: 8px
          overflow: 'hidden',
          transition: 'all 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
          '&:hover': {
            transform: 'translateX(8px)',
            boxShadow: `0 8px 24px ${alpha(borderColor, 0.2)}`,
          },
        }}
      >
        <CardContent sx={{ py: 2.5, px: 3 }}>
          <Stack direction="row" spacing={2}>
            <Avatar
              sx={{
                bgcolor: iconBg,
                color: borderColor,
                width: 48,
                height: 48,
              }}
            >
              {icon}
            </Avatar>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {insight.title}
                </Typography>
                {insight.priority && (
                  <Chip
                    label={insight.priority}
                    size="small"
                    sx={{
                      height: 22,
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      bgcolor: priorityConfig.bg,
                      color: priorityConfig.text,
                    }}
                  />
                )}
                {insight.confidence && (
                  <Chip
                    label={`${Math.round(insight.confidence * 100)}% confident`}
                    size="small"
                    variant="outlined"
                    sx={{ height: 22, fontSize: 10 }}
                  />
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                {insight.description}
              </Typography>
              {insight.suggested_actions?.length > 0 && (
                <Box sx={{ mt: 2, p: 2, bgcolor: alpha(borderColor, 0.08), borderRadius: 1 }}>
                  <Typography variant="caption" fontWeight={600} color={borderColor}>
                    SUGGESTED ACTIONS
                  </Typography>
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    {insight.suggested_actions.map((action, i) => (
                      <Stack key={i} direction="row" alignItems="center" spacing={1}>
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: borderColor }} />
                        <Typography variant="body2">{action}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Fade>
  )
}

// Sentiment display component
function SentimentDisplay({ sentiment }) {
  const theme = useTheme()
  if (!sentiment) return null

  const getSentimentConfig = (level) => {
    const neutralColor = theme.palette.mode === 'dark' ? neutral[500] : neutral[700]
    const neutralGradient = theme.palette.mode === 'dark'
      ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.12)} 0%, ${alpha(theme.palette.text.primary, 0.06)} 100%)`
      : `linear-gradient(135deg, ${neutral[200]} 0%, ${neutral[100]} 100%)`
    if (level?.includes('positive')) {
      return {
        icon: <SentimentSatisfiedAltIcon sx={{ fontSize: 32 }} />,
        color: neutralColor,
        label: 'Positive',
        gradient: neutralGradient,
      }
    }
    if (level?.includes('negative')) {
      return {
        icon: <SentimentVeryDissatisfiedIcon sx={{ fontSize: 32 }} />,
        color: neutralColor,
        label: 'Negative',
        gradient: neutralGradient,
      }
    }
    return {
      icon: <SentimentNeutralIcon sx={{ fontSize: 32 }} />,
      color: neutralColor,
      label: 'Neutral',
      gradient: neutralGradient,
    }
  }

  const config = getSentimentConfig(sentiment.overall_sentiment)
  const score = Math.round((sentiment.overall_score + 1) * 50) // Convert -1 to 1 → 0 to 100

  return (
    <GlassCard hover={false} sx={{ p: 2.5 }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Avatar
            sx={{
              width: 56,
              height: 56,
              background: config.gradient,
              color: config.color,
            }}
          >
            {config.icon}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" color="text.secondary" fontWeight={600}>
              Document Sentiment
            </Typography>
            <Typography variant="h5" fontWeight={600} color={config.color}>
              {config.label}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircularProgress
                variant="determinate"
                value={score}
                size={60}
                thickness={6}
                sx={{ color: config.color }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="body2" fontWeight={600} color={config.color}>
                  {score}%
                </Typography>
              </Box>
            </Box>
          </Box>
        </Stack>
        <Stack direction="row" spacing={2}>
          <Chip
            size="small"
            label={`Tone: ${sentiment.emotional_tone || 'Neutral'}`}
            sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100] }}
          />
          <Chip
            size="small"
            label={`Urgency: ${sentiment.urgency_level || 'Normal'}`}
            sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100] }}
          />
        </Stack>
      </Stack>
    </GlassCard>
  )
}

// Data quality gauge
function DataQualityGauge({ quality }) {
  const theme = useTheme()
  if (!quality) return null

  const score = Math.round((quality.quality_score || 0) * 100)
  const getColor = (s) => {
    if (s >= 80) return theme.palette.mode === 'dark' ? neutral[500] : neutral[700]
    if (s >= 60) return theme.palette.mode === 'dark' ? neutral[500] : neutral[500]
    return theme.palette.mode === 'dark' ? neutral[300] : neutral[500]
  }
  const color = getColor(score)

  return (
    <GlassCard hover={false} sx={{ p: 2.5 }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress
              variant="determinate"
              value={100}
              size={80}
              thickness={6}
              sx={{ color: alpha(color, 0.2) }}
            />
            <CircularProgress
              variant="determinate"
              value={score}
              size={80}
              thickness={6}
              sx={{
                color: color,
                position: 'absolute',
                left: 0,
                '& .MuiCircularProgress-circle': {
                  strokeLinecap: 'round',
                },
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Typography variant="h5" fontWeight={600} color={color}>
                {score}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Score
              </Typography>
            </Box>
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" color="text.secondary" fontWeight={600}>
              Data Quality
            </Typography>
            <Typography variant="h6" fontWeight={600}>
              {score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : 'Needs Attention'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {quality.total_rows} rows, {quality.total_columns} columns
            </Typography>
          </Box>
        </Stack>
        {quality.recommendations?.length > 0 && (
          <Box sx={{ p: 1.5, bgcolor: alpha(color, 0.1), borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {quality.recommendations[0]}
            </Typography>
          </Box>
        )}
      </Stack>
    </GlassCard>
  )
}

// Tab panel
function EnhancedTabPanel({ children, value, index, ...other }) {
  return (
    <div role="tabpanel" hidden={value !== index} {...other}>
      {value === index && <Fade in timeout={300}><Box sx={{ py: 3 }}>{children}</Box></Fade>}
    </div>
  )
}

// Q&A Message bubble
function QABubble({ qa, index }) {
  const theme = useTheme()
  return (
    <Fade in timeout={300 + index * 100}>
      <Box sx={{ mb: 3 }}>
        {/* Question */}
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1.5 }}>
          <Paper
            sx={{
              maxWidth: '80%',
              p: 2,
              px: 3,
              borderRadius: '20px 20px 4px 20px',
              background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
              color: 'common.white',
              boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.2)}`,
            }}
          >
            <Typography variant="body1" fontWeight={500}>
              {qa.question}
            </Typography>
          </Paper>
        </Stack>

        {/* Answer */}
        <Stack direction="row" sx={{ mb: 1 }}>
          <Avatar
            sx={{
              width: 36,
              height: 36,
              mr: 1.5,
              bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
              color: 'text.secondary',
            }}
          >
            <SmartToyIcon sx={{ fontSize: 20 }} />
          </Avatar>
          <Paper
            sx={{
              maxWidth: '80%',
              p: 2,
              px: 3,
              borderRadius: '4px 20px 20px 20px',
              bgcolor: alpha(theme.palette.background.paper, 0.8),
              backdropFilter: 'blur(10px)',
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            }}
          >
            <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
              {qa.answer}
            </Typography>
            {qa.sources?.length > 0 && (
              <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
                <Typography variant="caption" fontWeight={600} color="text.secondary">
                  Sources:
                </Typography>
                {qa.sources.slice(0, 2).map((source, i) => (
                  <Typography key={i} variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                    "{source.content_preview?.slice(0, 100)}..."
                  </Typography>
                ))}
              </Box>
            )}
          </Paper>
        </Stack>
      </Box>
    </Fade>
  )
}

// Main component
export default function EnhancedAnalyzePageContainer() {
  const theme = useTheme()
  const [activeTab, setActiveTab] = useState(0)
  const [selectedFile, setSelectedFile] = useState(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [progressStage, setProgressStage] = useState('')
  const [analysisResult, setAnalysisResult] = useState(null)
  const [error, setError] = useState(null)
  const [suggestedQuestions, setSuggestedQuestions] = useState([])

  // Q&A state
  const [question, setQuestion] = useState('')
  const [isAskingQuestion, setIsAskingQuestion] = useState(false)
  const [qaHistory, setQaHistory] = useState([])

  // Chart generation state
  const [chartQuery, setChartQuery] = useState('')
  const [isGeneratingCharts, setIsGeneratingCharts] = useState(false)
  const [generatedCharts, setGeneratedCharts] = useState([])

  // Data source selectors
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')

  // Export state
  const [exportMenuAnchor, setExportMenuAnchor] = useState(null)
  const [isExporting, setIsExporting] = useState(false)

  // Preferences
  const [preferences] = useState({
    analysis_depth: 'standard',
    focus_areas: [],
    output_format: 'executive',
    industry: null,
    enable_predictions: true,
    auto_chart_generation: true,
    max_charts: 10,
  })

  const abortControllerRef = useRef(null)
  const fileInputRef = useRef(null)
  const toast = useToast()
  const { execute } = useInteraction()

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      setSelectedFile(file)
      setError(null)
      setAnalysisResult(null)
    }
  }, [])

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setError(null)
      setAnalysisResult(null)
    }
  }, [])

  const handleAnalyze = useCallback(() => {
    if (!selectedFile) return undefined

    return execute({
      type: InteractionType.ANALYZE,
      label: 'Analyze document',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      suppressSuccessToast: true,
      intent: { fileName: selectedFile?.name },
      action: async () => {
        abortControllerRef.current = new AbortController()

        setIsAnalyzing(true)
        setAnalysisProgress(0)
        setProgressStage('Initializing AI analysis...')
        setError(null)

        try {
          const result = await uploadAndAnalyzeEnhanced({
            file: selectedFile,
            preferences,
            connectionId: selectedConnectionId || undefined,
            templateId: selectedTemplateId || undefined,
            signal: abortControllerRef.current?.signal,
            onProgress: (event) => {
              if (event.event === 'stage') {
                setAnalysisProgress(event.progress || 0)
                setProgressStage(event.detail || event.stage || 'Processing...')
              }
            },
          })

          if (result.event === 'result') {
            setAnalysisResult(result)
            setSuggestedQuestions(result.suggested_questions || [])
            setGeneratedCharts(
              (result.chart_suggestions || [])
                .map((c, idx) => ({ ...c, ...normalizeChartSpec(c, idx) }))
                .filter(Boolean)
            )
            setActiveTab(0)
            toast.show('Analysis complete!', 'success')
          }
        } catch (err) {
          if (err.name === 'AbortError') {
            toast.show('Analysis cancelled', 'info')
          } else {
            setError(err.message || 'Analysis failed')
          }
        } finally {
          setIsAnalyzing(false)
          setAnalysisProgress(100)
          abortControllerRef.current = null
        }
      },
    })
  }, [execute, selectedFile, preferences, toast])

  const handleCancelAnalysis = useCallback(() => {
    return execute({
      type: InteractionType.UPDATE,
      label: 'Cancel analysis',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'enhanced-analyze' },
      action: () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
          setIsAnalyzing(false)
          setAnalysisProgress(0)
          setProgressStage('')
        }
      },
    })
  }, [execute])

  const handleAskQuestion = useCallback(() => {
    if (!analysisResult?.analysis_id || !question.trim()) return undefined

    return execute({
      type: InteractionType.ANALYZE,
      label: 'Ask analysis question',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: { analysisId: analysisResult.analysis_id },
      action: async () => {
        setIsAskingQuestion(true)
        try {
          const response = await askQuestion(analysisResult.analysis_id, {
            question: question.trim(),
            includeSources: true,
          })

          setQaHistory((prev) => [
            ...prev,
            {
              question: question.trim(),
              answer: response.answer,
              sources: response.sources,
              timestamp: new Date(),
            },
          ])
          setQuestion('')

          if (response.suggested_followups?.length) {
            setSuggestedQuestions(response.suggested_followups)
          }
        } catch (err) {
          toast.show(err.message || 'Failed to get answer', 'error')
        } finally {
          setIsAskingQuestion(false)
        }
      },
    })
  }, [analysisResult?.analysis_id, execute, question, toast])

  const handleGenerateCharts = useCallback(() => {
    if (!analysisResult?.analysis_id || !chartQuery.trim()) return undefined

    return execute({
      type: InteractionType.GENERATE,
      label: 'Generate charts',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: { analysisId: analysisResult.analysis_id },
      action: async () => {
        setIsGeneratingCharts(true)
        try {
          const response = await generateCharts(analysisResult.analysis_id, {
            query: chartQuery.trim(),
            includeTrends: true,
            includeForecasts: false,
          })

          if (response.charts?.length) {
            const normalized = response.charts
              .map((c, i) => ({ ...c, ...normalizeChartSpec(c, i) }))
              .filter(Boolean)
            setGeneratedCharts((prev) => [...normalized, ...prev])
            setChartQuery('')
            toast.show(`Generated ${response.charts.length} chart(s)`, 'success')
          } else {
            toast.show(response.message || 'No charts could be generated for this query. Try a different request or re-analyze the document.', 'warning')
          }
        } catch (err) {
          toast.show(err.message || 'Failed to generate charts', 'error')
        } finally {
          setIsGeneratingCharts(false)
        }
      },
    })
  }, [analysisResult?.analysis_id, chartQuery, execute, toast])

  const handleExport = useCallback((format) => {
    if (!analysisResult?.analysis_id) return undefined

    return execute({
      type: InteractionType.DOWNLOAD,
      label: `Export analysis (${format.toUpperCase()})`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: { analysisId: analysisResult.analysis_id, format },
      action: async () => {
        setExportMenuAnchor(null)
        setIsExporting(true)

        try {
          const blob = await exportAnalysis(analysisResult.analysis_id, { format })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `analysis_${analysisResult.analysis_id}.${format}`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)
          toast.show(`Exported as ${format.toUpperCase()}`, 'success')
        } catch (err) {
          toast.show(err.message || 'Export failed', 'error')
        } finally {
          setIsExporting(false)
        }
      },
    })
  }, [analysisResult?.analysis_id, execute, toast])

  const handleReset = useCallback(() => {
    return execute({
      type: InteractionType.UPDATE,
      label: 'Reset analysis',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'enhanced-analyze' },
      action: () => {
        setSelectedFile(null)
        setAnalysisResult(null)
        setError(null)
        setSuggestedQuestions([])
        setQaHistory([])
        setGeneratedCharts([])
        setActiveTab(0)
      },
    })
  }, [execute])

  // Stats
  const stats = useMemo(() => {
    if (!analysisResult) return null
    return {
      tables: analysisResult.total_tables || analysisResult.tables?.length || 0,
      metrics: analysisResult.total_metrics || analysisResult.metrics?.length || 0,
      entities: analysisResult.total_entities || analysisResult.entities?.length || 0,
      insights: analysisResult.insights?.length || 0,
      risks: analysisResult.risks?.length || 0,
      opportunities: analysisResult.opportunities?.length || 0,
      charts: generatedCharts.length,
    }
  }, [analysisResult, generatedCharts.length])

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: theme.palette.mode === 'dark'
          ? `linear-gradient(180deg, ${alpha(theme.palette.text.primary, 0.02)} 0%, ${theme.palette.background.default} 50%)`
          : `linear-gradient(180deg, ${neutral[50]} 0%, ${theme.palette.background.default} 50%)`,
      }}
    >
      {/* Hero Header */}
      <Box
        sx={{
          pt: 4,
          pb: analysisResult ? 2 : 4,
          px: 4,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${alpha(theme.palette.text.primary, 0.06)} 0%, ${alpha(theme.palette.text.primary, 0.03)} 50%, transparent 100%)`
            : `linear-gradient(135deg, ${neutral[100]} 0%, ${neutral[50]} 50%, transparent 100%)`,
          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={2}>
            <Avatar
              sx={{
                width: 56,
                height: 56,
                background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                boxShadow: `0 8px 24px ${alpha(theme.palette.common.black, 0.2)}`,
              }}
            >
              <PsychologyIcon sx={{ fontSize: 28 }} />
            </Avatar>
            <Box>
              <Typography
                variant="h5"
                fontWeight={600}
                color="text.primary"
              >
                AI Document Analysis
              </Typography>
              <Typography variant="body2" color="text.secondary" fontWeight={500}>
                Intelligent extraction, analysis, visualization & insights powered by AI
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1.5}>
            {analysisResult && (
              <>
                <Button
                  variant="outlined"
                  startIcon={isExporting ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
                  onClick={(e) => setExportMenuAnchor(e.currentTarget)}
                  disabled={isExporting}
                  sx={{
                    borderRadius: 1,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderWidth: 2,
                    '&:hover': { borderWidth: 2 },
                  }}
                >
                  Export
                </Button>
                <Menu
                  anchorEl={exportMenuAnchor}
                  open={Boolean(exportMenuAnchor)}
                  onClose={() => setExportMenuAnchor(null)}
                  PaperProps={{
                    sx: { borderRadius: 1, minWidth: 140 },
                  }}
                >
                  {['json', 'excel', 'pdf', 'csv', 'markdown', 'html'].map((fmt) => (
                    <MenuItem key={fmt} onClick={() => handleExport(fmt)}>
                      {fmt.toUpperCase()}
                    </MenuItem>
                  ))}
                </Menu>
                <Button
                  variant="contained"
                  startIcon={<RefreshIcon />}
                  onClick={handleReset}
                  sx={{
                    borderRadius: 1,
                    textTransform: 'none',
                    fontWeight: 600,
                    background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                    boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.2)}`,
                    '&:hover': {
                      background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                    },
                  }}
                >
                  New Analysis
                </Button>
              </>
            )}
          </Stack>
        </Stack>

        <Box sx={{ mt: 3 }}>
          <AiUsageNotice
            title="AI analysis"
            description="Uses the document you upload. Results are generated by AI; review before sharing."
            chips={[
              { label: 'Source: Uploaded document', color: 'default', variant: 'outlined' },
              { label: 'Confidence: Review required', color: 'warning', variant: 'outlined' },
              { label: 'Reversible: No source changes', color: 'success', variant: 'outlined' },
            ]}
            dense
          />
        </Box>

        {/* Stats Bar */}
        {stats && (
          <Stack direction="row" spacing={2} sx={{ mt: 3, flexWrap: 'wrap' }} useFlexGap>
            <StatCard icon={<TableChartIcon />} label="Tables" value={stats.tables} delay={0} />
            <StatCard icon={<AssessmentIcon />} label="Metrics" value={stats.metrics} delay={1} />
            <StatCard icon={<DataObjectIcon />} label="Entities" value={stats.entities} delay={2} />
            <StatCard icon={<LightbulbIcon />} label="Insights" value={stats.insights} delay={3} />
            <StatCard icon={<WarningAmberIcon />} label="Risks" value={stats.risks} delay={4} />
            <StatCard icon={<TrendingUpIcon />} label="Opportunities" value={stats.opportunities} delay={5} />
            <StatCard icon={<BarChartIcon />} label="Charts" value={stats.charts} delay={6} />
          </Stack>
        )}
      </Box>

      {/* Main Content */}
      <Box sx={{ px: 4, py: 3, maxWidth: 1400, mx: 'auto', width: '100%' }}>
        {/* Upload Section */}
        {!analysisResult && (
          <Fade in>
            <Box>
              {/* Data Source Selectors */}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
                <ConnectionSelector
                  value={selectedConnectionId}
                  onChange={setSelectedConnectionId}
                  label="Analyze from Connection (Optional)"
                  size="small"
                  showStatus
                />
                <TemplateSelector
                  value={selectedTemplateId}
                  onChange={setSelectedTemplateId}
                  label="Report Template (Optional)"
                  size="small"
                />
              </Stack>

              {/* Dropzone */}
              <GlassCard
                gradient
                hover={false}
                sx={{
                  p: 6,
                  textAlign: 'center',
                  cursor: 'pointer',
                  border: `2px dashed ${isDragOver ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700]) : alpha(theme.palette.divider, 0.3)}`,
                  bgcolor: isDragOver ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50]) : undefined,
                  transition: 'all 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,.png,.jpg,.jpeg"
                  onChange={handleFileSelect}
                />

                {!selectedFile && !isAnalyzing && (
                  <Box>
                    <Avatar
                      sx={{
                        width: 100,
                        height: 100,
                        mx: 'auto',
                        mb: 3,
                        background: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
                        animation: `${float} 3s ease-in-out infinite`,
                      }}
                    >
                      <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
                    </Avatar>
                    <Typography variant="h5" fontWeight={600} gutterBottom>
                      Drop your document here
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                      or click to browse files
                    </Typography>
                    <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap">
                      {['PDF', 'Excel', 'CSV', 'Word', 'Images'].map((type) => (
                        <Chip
                          key={type}
                          label={type}
                          size="small"
                          sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100] }}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}

                {selectedFile && !isAnalyzing && (
                  <Box>
                    <Avatar
                      sx={{
                        width: 80,
                        height: 80,
                        mx: 'auto',
                        mb: 3,
                        bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
                      }}
                    >
                      <CheckCircleIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                    </Avatar>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      {selectedFile.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </Typography>
                    <Button
                      variant="contained"
                      size="large"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAnalyze()
                      }}
                      startIcon={<BoltIcon />}
                      sx={{
                        px: 6,
                        py: 2,
                        borderRadius: 1,  // Figma spec: 8px
                        fontWeight: 600,
                        fontSize: '1.1rem',
                        textTransform: 'none',
                        bgcolor: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                        boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.2)}`,
                        transition: 'all 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                        '&:hover': {
                          transform: 'scale(1.05)',
                          bgcolor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                          boxShadow: `0 12px 40px ${alpha(theme.palette.common.black, 0.25)}`,
                        },
                      }}
                    >
                      Analyze with AI
                    </Button>
                  </Box>
                )}

                {isAnalyzing && (
                  <Box>
                    <Box
                      sx={{
                        width: 120,
                        height: 120,
                        mx: 'auto',
                        mb: 3,
                        position: 'relative',
                      }}
                    >
                      <CircularProgress
                        variant="determinate"
                        value={100}
                        size={120}
                        thickness={4}
                        sx={{ color: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200] }}
                      />
                      <CircularProgress
                        variant="determinate"
                        value={analysisProgress}
                        size={120}
                        thickness={4}
                        sx={{
                          position: 'absolute',
                          left: 0,
                          color: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                          '& .MuiCircularProgress-circle': { strokeLinecap: 'round' },
                        }}
                      />
                      <Box
                        sx={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Typography variant="h4" fontWeight={600} color="text.primary">
                          {analysisProgress}%
                        </Typography>
                      </Box>
                    </Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      {progressStage}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={analysisProgress}
                      sx={{
                        maxWidth: 400,
                        mx: 'auto',
                        mt: 2,
                        height: 8,
                        borderRadius: 4,
                        bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200],
                        '& .MuiLinearProgress-bar': {
                          borderRadius: 4,
                          background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                        },
                      }}
                    />
                    <Button
                      variant="outlined"
                      startIcon={<CancelIcon />}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCancelAnalysis()
                      }}
                      sx={{ mt: 3, borderRadius: 1, textTransform: 'none' }}
                    >
                      Cancel
                    </Button>
                  </Box>
                )}
              </GlassCard>

              {error && (
                <Paper
                  sx={{
                    mt: 2,
                    p: 2,
                    bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.error.main, 0.1) : alpha(theme.palette.error.main, 0.05),
                    border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
                    borderRadius: 1,
                  }}
                >
                  <Typography color="error.main" sx={{ fontWeight: 500 }}>{error}</Typography>
                </Paper>
              )}
            </Box>
          </Fade>
        )}

        {/* Results Section */}
        {analysisResult && (
          <Fade in>
            <Box>
              {/* Warnings from partial failures */}
              {analysisResult.warnings?.length > 0 && (
                <Paper
                  sx={{
                    mb: 2,
                    p: 2,
                    bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.warning.main, 0.1) : alpha(theme.palette.warning.main, 0.05),
                    border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
                    borderRadius: 1,
                  }}
                >
                  <Typography variant="body2" color="warning.main" sx={{ fontWeight: 500 }}>
                    Analysis completed with warnings:
                  </Typography>
                  {analysisResult.warnings.map((w, i) => (
                    <Typography key={i} variant="body2" color="text.secondary" sx={{ ml: 2, mt: 0.5 }}>
                      {w}
                    </Typography>
                  ))}
                </Paper>
              )}

              {/* Tabs */}
              <GlassCard hover={false} sx={{ p: 0, mb: 3 }}>
                <Tabs
                  value={activeTab}
                  onChange={(e, v) => setActiveTab(v)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{
                    '& .MuiTab-root': {
                      textTransform: 'none',
                      fontWeight: 600,
                      fontSize: '16px',
                      minHeight: 64,
                      transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
                      '&:hover': {
                        bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                      },
                      '&.Mui-selected': {
                        color: 'text.primary',
                      },
                    },
                    '& .MuiTabs-indicator': {
                      height: 3,
                      borderRadius: '3px 3px 0 0',
                      background: theme.palette.mode === 'dark' ? neutral[500] : neutral[900],
                    },
                  }}
                >
                  <Tab icon={<InsightsOutlinedIcon />} iconPosition="start" label="Overview" />
                  <Tab icon={<QuestionAnswerIcon />} iconPosition="start" label="Q&A" />
                  <Tab icon={<BarChartIcon />} iconPosition="start" label="Charts" />
                  <Tab icon={<TableChartIcon />} iconPosition="start" label="Data" />
                  <Tab icon={<LightbulbIcon />} iconPosition="start" label="Insights" />
                </Tabs>
              </GlassCard>

              {/* Overview Tab */}
              <EnhancedTabPanel value={activeTab} index={0}>
                <Grid container spacing={3}>
                  {/* Executive Summary */}
                  <Grid size={{ xs: 12, lg: 8 }}>
                    <GlassCard sx={{ height: '100%' }}>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                        <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <ArticleIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Executive Summary
                        </Typography>
                      </Stack>
                      <Typography
                        variant="body1"
                        sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, color: 'text.secondary' }}
                      >
                        {analysisResult.summaries?.executive?.content ||
                          analysisResult.summaries?.comprehensive?.content ||
                          'Summary not available'}
                      </Typography>

                      {analysisResult.summaries?.executive?.bullet_points?.length > 0 && (
                        <Box
                          sx={{
                            mt: 3,
                            p: 2.5,
                            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                            borderRadius: 1,  // Figma spec: 8px
                            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                          }}
                        >
                          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                            Key Points
                          </Typography>
                          <Stack spacing={1}>
                            {analysisResult.summaries.executive.bullet_points.map((point, i) => (
                              <Stack key={i} direction="row" alignItems="flex-start" spacing={1.5}>
                                <Box
                                  sx={{
                                    width: 24,
                                    height: 24,
                                    borderRadius: '50%',
                                    bgcolor: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                                    color: 'common.white',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    flexShrink: 0,
                                    mt: 0.25,
                                  }}
                                >
                                  {i + 1}
                                </Box>
                                <Typography variant="body2">{point}</Typography>
                              </Stack>
                            ))}
                          </Stack>
                        </Box>
                      )}
                    </GlassCard>
                  </Grid>

                  {/* Sidebar */}
                  <Grid size={{ xs: 12, lg: 4 }}>
                    <Stack spacing={3}>
                      <SentimentDisplay sentiment={analysisResult.sentiment} />
                      <DataQualityGauge quality={analysisResult.data_quality} />
                    </Stack>
                  </Grid>

                  {/* Key Metrics */}
                  <Grid size={12}>
                    <GlassCard>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <SpeedIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Key Metrics
                        </Typography>
                      </Stack>
                      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                        {analysisResult.metrics?.slice(0, 8).map((metric, i) => (
                          <EnhancedMetricCard key={metric.id} metric={metric} index={i} />
                        ))}
                      </Stack>
                    </GlassCard>
                  </Grid>

                  {/* Top Insights Preview */}
                  <Grid size={{ xs: 12, md: 6 }}>
                    <GlassCard>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: (t) => t.palette.mode === 'dark' ? alpha(t.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <LightbulbIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Top Insights
                        </Typography>
                      </Stack>
                      {analysisResult.insights?.slice(0, 3).map((insight, i) => (
                        <InsightCard key={insight.id} insight={insight} type="insight" index={i} />
                      ))}
                    </GlassCard>
                  </Grid>

                  {/* Risks & Opportunities Preview */}
                  <Grid size={{ xs: 12, md: 6 }}>
                    <GlassCard>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <SecurityIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Risks & Opportunities
                        </Typography>
                      </Stack>
                      {analysisResult.risks?.slice(0, 2).map((risk, i) => (
                        <InsightCard key={risk.id} insight={risk} type="risk" index={i} />
                      ))}
                      {analysisResult.opportunities?.slice(0, 2).map((opp, i) => (
                        <InsightCard key={opp.id} insight={opp} type="opportunity" index={i + 2} />
                      ))}
                    </GlassCard>
                  </Grid>
                </Grid>
              </EnhancedTabPanel>

              {/* Q&A Tab */}
              <EnhancedTabPanel value={activeTab} index={1}>
                <Grid container spacing={3}>
                  <Grid size={{ xs: 12, lg: 8 }}>
                    <GlassCard sx={{ minHeight: 500 }}>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <SmartToyIcon />
                        </Avatar>
                        <Box>
                          <Typography variant="h6" fontWeight={600}>
                            Ask AI About Your Document
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Get instant answers with source citations
                          </Typography>
                        </Box>
                      </Stack>

                      {/* Chat Area */}
                      <Box
                        sx={{
                          minHeight: 300,
                          maxHeight: 400,
                          overflowY: 'auto',
                          mb: 3,
                          p: 2,
                          bgcolor: alpha(theme.palette.background.default, 0.5),
                          borderRadius: 1,  // Figma spec: 8px
                        }}
                      >
                        {qaHistory.length === 0 ? (
                          <Box sx={{ textAlign: 'center', py: 6 }}>
                            <Avatar
                              sx={{
                                width: 80,
                                height: 80,
                                mx: 'auto',
                                mb: 2,
                                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                              }}
                            >
                              <QuestionAnswerIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                            </Avatar>
                            <Typography variant="h6" color="text.secondary" gutterBottom>
                              Start a conversation
                            </Typography>
                            <Typography variant="body2" color="text.disabled">
                              Ask questions about the document content
                            </Typography>
                          </Box>
                        ) : (
                          qaHistory.map((qa, idx) => <QABubble key={idx} qa={qa} index={idx} />)
                        )}
                      </Box>

                      {/* Input */}
                      <Stack direction="row" spacing={2}>
                        <TextField
                          fullWidth
                          placeholder="Ask a question about your document..."
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleAskQuestion()}
                          disabled={isAskingQuestion}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              borderRadius: 1,  // Figma spec: 8px
                              bgcolor: alpha(theme.palette.background.paper, 0.8),
                            },
                          }}
                        />
                        <Button
                          variant="contained"
                          onClick={handleAskQuestion}
                          disabled={!question.trim() || isAskingQuestion}
                          sx={{
                            minWidth: 56,
                            borderRadius: 1,  // Figma spec: 8px
                            background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                            '&:hover': {
                              background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                            },
                          }}
                        >
                          {isAskingQuestion ? <CircularProgress size={20} color="inherit" /> : <SendIcon />}
                        </Button>
                      </Stack>
                    </GlassCard>
                  </Grid>

                  {/* Suggested Questions */}
                  <Grid size={{ xs: 12, lg: 4 }}>
                    <GlassCard>
                      <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                        Suggested Questions
                      </Typography>
                      <Stack spacing={1.5}>
                        {suggestedQuestions.map((q, idx) => (
                          <Button
                            key={idx}
                            variant="outlined"
                            onClick={() => setQuestion(q)}
                            sx={{
                              textTransform: 'none',
                              justifyContent: 'flex-start',
                              textAlign: 'left',
                              borderRadius: 1,
                              py: 1.5,
                              px: 2,
                              fontWeight: 500,
                              borderColor: alpha(theme.palette.divider, 0.2),
                              '&:hover': {
                                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                                borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                              },
                            }}
                          >
                            {q}
                          </Button>
                        ))}
                      </Stack>
                    </GlassCard>
                  </Grid>
                </Grid>
              </EnhancedTabPanel>

              {/* Charts Tab */}
              <EnhancedTabPanel value={activeTab} index={2}>
                <GlassCard sx={{ mb: 3 }}>
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                    <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                      <AutoAwesomeIcon />
                    </Avatar>
                    <Box>
                      <Typography variant="h6" fontWeight={600}>
                        Generate Charts with Natural Language
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Describe the visualization you want and AI will create it
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={2}>
                    <TextField
                      fullWidth
                      placeholder='e.g., "Show revenue by quarter as a line chart" or "Compare categories in a pie chart"'
                      value={chartQuery}
                      onChange={(e) => setChartQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleGenerateCharts()}
                      disabled={isGeneratingCharts}
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          borderRadius: 1,  // Figma spec: 8px
                        },
                      }}
                    />
                    <Button
                      variant="contained"
                      onClick={handleGenerateCharts}
                      disabled={!chartQuery.trim() || isGeneratingCharts}
                      startIcon={isGeneratingCharts ? <CircularProgress size={16} color="inherit" /> : <BarChartIcon />}
                      sx={{
                        minWidth: 160,
                        borderRadius: 1,  // Figma spec: 8px
                        textTransform: 'none',
                        fontWeight: 600,
                        background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                        '&:hover': {
                          background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                        },
                      }}
                    >
                      Generate
                    </Button>
                  </Stack>
                </GlassCard>

                <Grid container spacing={3}>
                  {generatedCharts.map((chart, idx) => (
                    <Grid size={{ xs: 12, md: 6 }} key={chart.id || idx}>
                      <Zoom in timeout={300 + idx * 100}>
                        <Box>
                          <GlassCard>
                            <Typography variant="h6" fontWeight={600} gutterBottom>
                              {chart.title}
                            </Typography>
                            {chart.description && (
                              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                {chart.description}
                              </Typography>
                            )}
                            <Box sx={{ height: 320 }}>
                              <ZoomableChart spec={chart} data={chart.data} height={300} />
                            </Box>
                            {chart.ai_insights?.length > 0 && (
                              <Box
                                sx={{
                                  mt: 2,
                                  p: 2,
                                  bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                                  borderRadius: 1,
                                  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                                }}
                              >
                                <Typography variant="caption" fontWeight={600} color="text.secondary">
                                  AI INSIGHTS
                                </Typography>
                                {chart.ai_insights.map((insight, i) => (
                                  <Typography key={i} variant="body2" sx={{ mt: 0.5 }}>
                                    • {insight}
                                  </Typography>
                                ))}
                              </Box>
                            )}
                          </GlassCard>
                        </Box>
                      </Zoom>
                    </Grid>
                  ))}
                </Grid>
              </EnhancedTabPanel>

              {/* Data Tab */}
              <EnhancedTabPanel value={activeTab} index={3}>
                <Grid container spacing={3}>
                  {/* Tables */}
                  <Grid size={12}>
                    <GlassCard>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <TableChartIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Extracted Tables ({analysisResult.tables?.length || 0})
                        </Typography>
                      </Stack>
                      {analysisResult.tables?.map((table) => (
                        <Accordion
                          key={table.id}
                          sx={{
                            mb: 2,
                            borderRadius: '12px !important',
                            overflow: 'hidden',
                            '&:before': { display: 'none' },
                            boxShadow: 'none',
                            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                          }}
                        >
                          <AccordionSummary
                            expandIcon={<ExpandMoreIcon />}
                            sx={{
                              bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.03) : neutral[50],
                              '&:hover': { bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.06) : neutral[100] },
                            }}
                          >
                            <Stack direction="row" alignItems="center" spacing={2}>
                              <TableChartIcon sx={{ color: 'text.secondary' }} />
                              <Typography fontWeight={600}>{table.title || table.id}</Typography>
                              <Chip label={`${table.row_count} rows`} size="small" variant="outlined" sx={{ borderColor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.3) : neutral[200], color: 'text.secondary' }} />
                              <Chip label={`${table.column_count} cols`} size="small" variant="outlined" />
                            </Stack>
                          </AccordionSummary>
                          <AccordionDetails sx={{ p: 0 }}>
                            <Box sx={{ overflowX: 'auto' }}>
                              <Box
                                component="table"
                                sx={{
                                  width: '100%',
                                  borderCollapse: 'collapse',
                                  '& th': {
                                    p: 1.5,
                                    textAlign: 'left',
                                    fontWeight: 600,
                                    fontSize: '12px',
                                    textTransform: 'uppercase',
                                    bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                                    borderBottom: `2px solid ${theme.palette.mode === 'dark' ? neutral[700] : neutral[900]}`,
                                  },
                                  '& td': {
                                    p: 1.5,
                                    fontSize: '0.875rem',
                                    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                                  },
                                  '& tr:hover td': {
                                    bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.02) : neutral[50],
                                  },
                                }}
                              >
                                <thead>
                                  <tr>
                                    {table.headers.map((header, i) => (
                                      <th key={i}>{header}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {table.rows.slice(0, 10).map((row, i) => (
                                    <tr key={i}>
                                      {row.map((cell, j) => (
                                        <td key={j}>{cell}</td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </Box>
                              {table.rows.length > 10 && (
                                <Box sx={{ p: 2, textAlign: 'center', bgcolor: alpha(neutral[500], 0.05) }}>
                                  <Typography variant="caption" color="text.secondary">
                                    Showing 10 of {table.rows.length} rows
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          </AccordionDetails>
                        </Accordion>
                      ))}
                    </GlassCard>
                  </Grid>

                  {/* Entities */}
                  <Grid size={{ xs: 12, md: 6 }}>
                    <GlassCard>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <DataObjectIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Entities ({analysisResult.entities?.length || 0})
                        </Typography>
                      </Stack>
                      <Stack spacing={1.5}>
                        {analysisResult.entities?.slice(0, 20).map((entity) => (
                          <Stack
                            key={entity.id}
                            direction="row"
                            alignItems="center"
                            spacing={1.5}
                            sx={{
                              p: 1.5,
                              borderRadius: 1,
                              bgcolor: alpha(theme.palette.background.default, 0.5),
                              transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
                              '&:hover': {
                                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                              },
                            }}
                          >
                            <Chip
                              label={entity.type}
                              size="small"
                              sx={{
                                minWidth: 80,
                                fontWeight: 600,
                                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
                                color: 'text.secondary',
                              }}
                            />
                            <Typography variant="body2" fontWeight={500}>
                              {entity.value}
                            </Typography>
                            {entity.normalized_value && entity.normalized_value !== entity.value && (
                              <Typography variant="caption" color="text.secondary">
                                → {entity.normalized_value}
                              </Typography>
                            )}
                          </Stack>
                        ))}
                      </Stack>
                    </GlassCard>
                  </Grid>

                  {/* Invoices & Contracts */}
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Stack spacing={3}>
                      {analysisResult.invoices?.length > 0 && (
                        <GlassCard>
                          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                            <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                              <ReceiptLongIcon />
                            </Avatar>
                            <Typography variant="h6" fontWeight={600}>
                              Invoices Detected
                            </Typography>
                          </Stack>
                          {analysisResult.invoices.map((invoice) => (
                            <Box
                              key={invoice.id}
                              sx={{
                                p: 2,
                                mb: 2,
                                borderRadius: 1,
                                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                                border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                              }}
                            >
                              <Typography variant="subtitle2" fontWeight={600}>
                                {invoice.vendor_name}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Invoice #{invoice.invoice_number} • {invoice.invoice_date}
                              </Typography>
                              <Typography variant="h5" fontWeight={600} color="text.primary" sx={{ mt: 1 }}>
                                {invoice.currency} {invoice.grand_total}
                              </Typography>
                            </Box>
                          ))}
                        </GlassCard>
                      )}

                      {analysisResult.contracts?.length > 0 && (
                        <GlassCard>
                          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                            <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                              <GavelIcon />
                            </Avatar>
                            <Typography variant="h6" fontWeight={600}>
                              Contracts Detected
                            </Typography>
                          </Stack>
                          {analysisResult.contracts.map((contract) => (
                            <Box
                              key={contract.id}
                              sx={{
                                p: 2,
                                borderRadius: 1,
                                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                                border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                              }}
                            >
                              <Typography variant="subtitle2" fontWeight={600}>
                                {contract.contract_type}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                {contract.effective_date} → {contract.expiration_date}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                Parties: {contract.parties?.map((p) => p.name).join(', ')}
                              </Typography>
                            </Box>
                          ))}
                        </GlassCard>
                      )}
                    </Stack>
                  </Grid>
                </Grid>
              </EnhancedTabPanel>

              {/* Insights Tab */}
              <EnhancedTabPanel value={activeTab} index={4}>
                <Grid container spacing={3}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <GlassCard>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: (t) => t.palette.mode === 'dark' ? alpha(t.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <LightbulbIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Key Insights ({analysisResult.insights?.length || 0})
                        </Typography>
                      </Stack>
                      {analysisResult.insights?.map((insight, i) => (
                        <InsightCard key={insight.id} insight={insight} type="insight" index={i} />
                      ))}
                    </GlassCard>
                  </Grid>

                  <Grid size={{ xs: 12, md: 6 }}>
                    <GlassCard>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <SecurityIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Risks ({analysisResult.risks?.length || 0})
                        </Typography>
                      </Stack>
                      {analysisResult.risks?.map((risk, i) => (
                        <InsightCard key={risk.id} insight={risk} type="risk" index={i} />
                      ))}
                    </GlassCard>
                  </Grid>

                  <Grid size={{ xs: 12, md: 6 }}>
                    <GlassCard>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <RocketLaunchIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Opportunities ({analysisResult.opportunities?.length || 0})
                        </Typography>
                      </Stack>
                      {analysisResult.opportunities?.map((opp, i) => (
                        <InsightCard key={opp.id} insight={opp} type="opportunity" index={i} />
                      ))}
                    </GlassCard>
                  </Grid>

                  <Grid size={{ xs: 12, md: 6 }}>
                    <GlassCard>
                      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
                        <Avatar sx={{ bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], color: 'text.secondary' }}>
                          <PlaylistAddCheckIcon />
                        </Avatar>
                        <Typography variant="h6" fontWeight={600}>
                          Action Items ({analysisResult.action_items?.length || 0})
                        </Typography>
                      </Stack>
                      {analysisResult.action_items?.map((action, i) => (
                        <InsightCard key={action.id} insight={action} type="action" index={i} />
                      ))}
                    </GlassCard>
                  </Grid>
                </Grid>
              </EnhancedTabPanel>
            </Box>
          </Fade>
        )}

        {/* Footer */}
        <Box sx={{ textAlign: 'center', py: 4, mt: 4 }}>
          <Typography variant="body2" color="text.secondary">
            Supported formats: PDF, Excel (XLSX, XLS), CSV, Word, Images
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
            AI-powered analysis with intelligent extraction, multi-mode summaries, Q&A, and visualization
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
