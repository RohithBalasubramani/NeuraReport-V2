import { getWidgetData, getWidgetReportData, packGrid, selectWidgets } from '@/api/monitoring'
import { neutral, palette, secondary, status } from '@/app/theme'
import { ConnectionSelector, ImportFromMenu, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useIncomingTransfer, useSharedData } from '@/hooks/hooks'
import { useAppStore } from '@/stores/app'
import { useDashboardStore } from '@/stores/workspace'
import { FeatureKey, TransferAction } from '@/utils/helpers'
import {
  AccountTree as SankeyIcon,
  Add as AddIcon,
  AreaChart as AreaIcon,
  AreaChart as CumulativeIcon,
  AutoAwesome as AIIcon,
  BarChart as BarChartIcon,
  BarChart as BarIcon,
  BubbleChart as BubbleIcon,
  Build as BuildIcon,
  Build as DiagnosticIcon,
  CameraAlt as SnapshotIcon,
  Chat as ChatIcon,
  CheckCircle as OkIcon,
  Circle as StatusDotIcon,
  Code as EmbedIcon,
  CompareArrows as CompareIcon,
  ContentCopy as DuplicateIcon,
  Dashboard as DashboardIcon,
  Delete as DeleteIcon,
  Devices as DeviceIcon,
  DonutLarge as DonutIcon,
  Download as DownloadIcon,
  DragIndicator as DragIcon,
  Edit as EditIcon,
  Equalizer as DistributionIcon,
  Error as ErrorIcon,
  ExpandLess as CollapseIcon,
  ExpandMore as ExpandIcon,
  FilterList as FilterIcon,
  Fullscreen as FullscreenIcon,
  GridView as HeatmapIcon,
  HelpOutline as UncertaintyIcon,
  Hexagon as HexIcon,
  Hub as NetworkIcon,
  Image as ImageIcon,
  Layers as CompositionIcon,
  Lock as VaultIcon,
  MoreVert as MoreIcon,
  Notes as NarrativeIcon,
  Numbers as NumberIcon,
  People as PeopleIcon,
  PieChart as PieChartIcon,
  Public as GlobeIcon,
  Refresh as RefreshIcon,
  Save as SaveIcon,
  ScatterPlot as ScatterIcon,
  Share as ShareIcon,
  ShowChart as LineChartIcon,
  SmartToy as AgentIcon,
  Speed as KpiIcon,
  StackedBarChart as StackedIcon,
  Storage as DbIcon,
  TableChart as TableIcon,
  TextFields as TextIcon,
  Timeline as TimelineIcon,
  TrendingDown as TrendDownIcon,
  TrendingFlat as TrendFlatIcon,
  TrendingUp as MetricIcon,
  TrendingUp as TrendIcon,
  TrendingUp as TrendUpIcon,
  UnfoldMore as VariantIcon,
  ViewList as EventLogIcon,
  Warning as AlertsIcon,
  Warning as AnomalyIcon,
  Warning as WarningIcon,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Select,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import ReactECharts from 'echarts-for-react'
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Responsive, WidthProvider } from 'react-grid-layout'
const TrendIconAlias = LineChartIcon


/**
 * Dashboard Grid Layout
 * React-grid-layout wrapper for drag-drop dashboard building.
 */

const ResponsiveGridLayout = WidthProvider(Responsive)


const GridContainer = styled(Box)(({ theme }) => ({
  height: '100%',
  '& .react-grid-item': {
    transition: 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), all 200ms cubic-bezier(0.22, 1, 0.36, 1)',
    '&.react-grid-placeholder': {
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[100],
      border: `2px dashed ${theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}`,
      borderRadius: 8,  // Figma spec: 8px
    },
  },
  '& .react-grid-item.cssTransforms': {
    transitionProperty: 'transform',
  },
  '& .react-grid-item > .react-resizable-handle': {
    background: 'none',
    '&::after': {
      content: '""',
      position: 'absolute',
      right: 5,
      bottom: 5,
      width: 10,
      height: 10,
      borderRight: `2px solid ${alpha(theme.palette.text.primary, 0.3)}`,
      borderBottom: `2px solid ${alpha(theme.palette.text.primary, 0.3)}`,
      borderRadius: '0 0 4px 0',
    },
  },
  '& .react-grid-item:hover > .react-resizable-handle::after': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
  },
}))


const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }
const ROW_HEIGHT = 80
const MARGIN = [16, 16]


function DashboardGridLayout({
  widgets = [],
  layout = [],
  onLayoutChange,
  onWidgetResize,
  children,
  editable = true,
  rowHeight = ROW_HEIGHT,
  margin = MARGIN,
}) {
  const [currentBreakpoint, setCurrentBreakpoint] = useState('lg')

  // Generate layout from widgets if not provided
  const computedLayout = useMemo(() => {
    if (layout.length > 0) return layout

    return widgets.map((widget, index) => ({
      i: widget.id,
      x: widget.x ?? (index % 3) * 4,
      y: widget.y ?? Math.floor(index / 3) * 3,
      w: widget.w ?? 4,
      h: widget.h ?? 3,
      minW: widget.minW ?? 2,
      minH: widget.minH ?? 2,
      maxW: widget.maxW ?? 12,
      maxH: widget.maxH ?? 10,
    }))
  }, [layout, widgets])

  // Generate responsive layouts
  const layouts = useMemo(() => {
    const lg = computedLayout
    const md = computedLayout.map((item) => ({
      ...item,
      w: Math.min(item.w, 10),
      x: Math.min(item.x, 10 - item.w),
    }))
    const sm = computedLayout.map((item) => ({
      ...item,
      w: Math.min(item.w, 6),
      x: 0,
    }))
    const xs = computedLayout.map((item) => ({
      ...item,
      w: 4,
      x: 0,
    }))
    const xxs = computedLayout.map((item) => ({
      ...item,
      w: 2,
      x: 0,
    }))

    return { lg, md, sm, xs, xxs }
  }, [computedLayout])

  const handleLayoutChange = useCallback((currentLayout, allLayouts) => {
    onLayoutChange?.(currentLayout, allLayouts)
  }, [onLayoutChange])

  const handleBreakpointChange = useCallback((newBreakpoint) => {
    setCurrentBreakpoint(newBreakpoint)
  }, [])

  const handleResizeStop = useCallback((layout, oldItem, newItem) => {
    onWidgetResize?.(newItem.i, { w: newItem.w, h: newItem.h })
  }, [onWidgetResize])

  return (
    <GridContainer>
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={rowHeight}
        margin={margin}
        containerPadding={margin}
        isDraggable={editable}
        isResizable={editable}
        onLayoutChange={handleLayoutChange}
        onBreakpointChange={handleBreakpointChange}
        onResizeStop={handleResizeStop}
        draggableHandle=".widget-drag-handle"
        useCSSTransforms
        compactType="vertical"
      >
        {children}
      </ResponsiveGridLayout>
    </GridContainer>
  )
}

/**
 * Helper to generate a unique widget ID
 */
/**
 * Default widget dimensions by type
 */
const DEFAULT_WIDGET_SIZES = {
  chart: { w: 4, h: 3, minW: 2, minH: 2 },
  metric: { w: 2, h: 2, minW: 2, minH: 1 },
  table: { w: 6, h: 4, minW: 3, minH: 2 },
  text: { w: 4, h: 2, minW: 2, minH: 1 },
  filter: { w: 3, h: 1, minW: 2, minH: 1 },
  map: { w: 6, h: 4, minW: 4, minH: 3 },
  image: { w: 3, h: 3, minW: 2, minH: 2 },
}


/**
 * Chart Widget Component
 * ECharts-based chart rendering with multiple chart types.
 */


const WidgetContainer = styled(Box)(({ theme }) => ({
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: theme.palette.background.paper,
  borderRadius: 8,  // Figma spec: 8px
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  overflow: 'hidden',
  transition: 'box-shadow 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    boxShadow: `0 4px 20px ${alpha(theme.palette.common.black, 0.08)}`,
  },
}))

const WidgetHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: theme.spacing(1.5, 2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
  minHeight: 48,
}))

const DragHandle = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  cursor: 'grab',
  color: alpha(theme.palette.text.secondary, 0.4),
  marginRight: theme.spacing(1),
  '&:hover': {
    color: theme.palette.text.secondary,
  },
  '&:active': {
    cursor: 'grabbing',
  },
}))

const WidgetContent = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(1),
  minHeight: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}))

const ChartTypeIcon = {
  bar: BarChartIcon,
  line: LineChartIcon,
  pie: PieChartIcon,
  donut: DonutIcon,
  scatter: ScatterIcon,
  bubble: BubbleIcon,
  stacked: StackedIcon,
  area: AreaIcon,
}


const generateChartOptions = (chartType, data, config, theme) => {
  const baseOptions = {
    animation: true,
    animationDuration: 500,
    grid: {
      left: 50,
      right: 20,
      top: 40,
      bottom: 40,
      containLabel: true,
    },
    tooltip: {
      trigger: chartType === 'pie' || chartType === 'donut' ? 'item' : 'axis',
      backgroundColor: alpha(theme.palette.background.paper, 0.95),
      borderColor: alpha(theme.palette.divider, 0.2),
      textStyle: {
        color: theme.palette.text.primary,
        fontSize: 12,
      },
    },
    // Chart colors — secondary palette values per Design System v4/v5
    color: [
      neutral[700],
      neutral[500],
      neutral[900],
      neutral[400],
      neutral[300],
      neutral[200],
      neutral[100],
      neutral[500],
      neutral[300],
      neutral[400],
    ],
  }

  switch (chartType) {
    case 'bar':
      return {
        ...baseOptions,
        xAxis: {
          type: 'category',
          data: data?.labels || [],
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
          axisLine: { lineStyle: { color: alpha(theme.palette.divider, 0.3) } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
          splitLine: { lineStyle: { color: alpha(theme.palette.divider, 0.1) } },
        },
        series: (data?.datasets || []).map((ds, idx) => ({
          name: ds.label || `Series ${idx + 1}`,
          type: 'bar',
          data: ds.data || [],
          itemStyle: { borderRadius: [4, 4, 0, 0] },
        })),
      }

    case 'line':
      return {
        ...baseOptions,
        xAxis: {
          type: 'category',
          data: data?.labels || [],
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
          axisLine: { lineStyle: { color: alpha(theme.palette.divider, 0.3) } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
          splitLine: { lineStyle: { color: alpha(theme.palette.divider, 0.1) } },
        },
        series: (data?.datasets || []).map((ds, idx) => ({
          name: ds.label || `Series ${idx + 1}`,
          type: 'line',
          data: ds.data || [],
          smooth: config?.smooth ?? true,
          symbolSize: 6,
        })),
      }

    case 'area':
      return {
        ...baseOptions,
        xAxis: {
          type: 'category',
          data: data?.labels || [],
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
          boundaryGap: false,
        },
        yAxis: {
          type: 'value',
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
          splitLine: { lineStyle: { color: alpha(theme.palette.divider, 0.1) } },
        },
        series: (data?.datasets || []).map((ds, idx) => ({
          name: ds.label || `Series ${idx + 1}`,
          type: 'line',
          data: ds.data || [],
          smooth: true,
          areaStyle: {
            opacity: 0.3,
          },
        })),
      }

    case 'pie':
    case 'donut':
      return {
        ...baseOptions,
        legend: {
          orient: 'vertical',
          right: 10,
          top: 'center',
          textStyle: { fontSize: 12, color: theme.palette.text.secondary },
        },
        series: [
          {
            type: 'pie',
            radius: chartType === 'donut' ? ['45%', '70%'] : '70%',
            center: ['40%', '50%'],
            data: (data?.labels || []).map((label, idx) => ({
              name: label,
              value: data?.datasets?.[0]?.data?.[idx] || 0,
            })),
            label: {
              show: true,
              fontSize: 12,
              color: theme.palette.text.secondary,
            },
            emphasis: {
              itemStyle: {
                shadowBlur: 10,
                shadowOffsetX: 0,
                shadowColor: 'rgba(0, 0, 0, 0.2)',
              },
            },
          },
        ],
      }

    case 'scatter':
      return {
        ...baseOptions,
        xAxis: {
          type: 'value',
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
          splitLine: { lineStyle: { color: alpha(theme.palette.divider, 0.1) } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
          splitLine: { lineStyle: { color: alpha(theme.palette.divider, 0.1) } },
        },
        series: (data?.datasets || []).map((ds, idx) => ({
          name: ds.label || `Series ${idx + 1}`,
          type: 'scatter',
          data: ds.data || [],
          symbolSize: 10,
        })),
      }

    case 'stacked':
      return {
        ...baseOptions,
        xAxis: {
          type: 'category',
          data: data?.labels || [],
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
        },
        yAxis: {
          type: 'value',
          axisLabel: { fontSize: 12, color: theme.palette.text.secondary },
          splitLine: { lineStyle: { color: alpha(theme.palette.divider, 0.1) } },
        },
        series: (data?.datasets || []).map((ds, idx) => ({
          name: ds.label || `Series ${idx + 1}`,
          type: 'bar',
          stack: 'total',
          data: ds.data || [],
          itemStyle: { borderRadius: idx === (data?.datasets?.length || 1) - 1 ? [4, 4, 0, 0] : 0 },
        })),
      }

    case 'heatmap': {
      const xLabels = data?.xLabels || data?.labels || []
      const yLabels = data?.yLabels || []
      const heatData = data?.heatmapData || data?.data || []
      // Convert {labels, datasets} → heatmap [[x,y,val], ...] if needed
      let points = heatData
      const yLabelsFinal = [...yLabels]
      if (!Array.isArray(heatData) || (heatData.length > 0 && !Array.isArray(heatData[0]))) {
        points = []
        ;(data?.datasets || []).forEach((ds, yi) => {
          ;(ds.data || []).forEach((val, xi) => {
            points.push([xi, yi, val ?? 0])
          })
        })
        if (yLabelsFinal.length === 0 && data?.datasets) {
          data.datasets.forEach((ds) => yLabelsFinal.push(ds.label || ''))
        }
      }
      const allVals = points.map((p) => (Array.isArray(p) ? p[2] : 0)).filter((v) => v != null)
      const minVal = allVals.length ? Math.min(...allVals) : 0
      const maxVal = allVals.length ? Math.max(...allVals) : 100
      return {
        ...baseOptions,
        grid: { left: 80, right: 60, top: 20, bottom: 50, containLabel: true },
        xAxis: {
          type: 'category',
          data: xLabels,
          splitArea: { show: true },
          axisLabel: { fontSize: 11, color: theme.palette.text.secondary, rotate: xLabels.length > 10 ? 45 : 0 },
        },
        yAxis: {
          type: 'category',
          data: yLabelsFinal,
          splitArea: { show: true },
          axisLabel: { fontSize: 11, color: theme.palette.text.secondary },
        },
        visualMap: {
          min: minVal,
          max: maxVal,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          inRange: { color: ['#f5f5f5', neutral[300], neutral[500], neutral[700], neutral[900]] },
          textStyle: { fontSize: 10, color: theme.palette.text.secondary },
        },
        series: [{ type: 'heatmap', data: points, label: { show: points.length <= 50, fontSize: 10 } }],
      }
    }

    case 'sankey': {
      const nodes = (data?.nodes || []).map((n) => (typeof n === 'string' ? { name: n } : n))
      const links = (data?.links || []).map((l) => ({
        source: typeof l.source === 'number' ? (nodes[l.source]?.name || String(l.source)) : String(l.source || ''),
        target: typeof l.target === 'number' ? (nodes[l.target]?.name || String(l.target)) : String(l.target || ''),
        value: l.value ?? 1,
      }))
      return {
        ...baseOptions,
        grid: undefined,
        series: [{
          type: 'sankey',
          layout: 'none',
          emphasis: { focus: 'adjacency' },
          data: nodes,
          links,
          lineStyle: { color: 'gradient', curveness: 0.5 },
          label: { fontSize: 11, color: theme.palette.text.primary },
        }],
      }
    }

    default:
      return baseOptions
  }
}


const SAMPLE_DATA = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  datasets: [
    { label: 'Sales', data: [120, 200, 150, 80, 170, 250] },
    { label: 'Expenses', data: [90, 120, 100, 60, 110, 140] },
  ],
}


const ChartWidget = forwardRef(function ChartWidget({
  id,
  title = 'Chart',
  chartType = 'bar',
  data = SAMPLE_DATA,
  config = {},
  loading = false,
  editable = true,
  onEdit,
  onDelete,
  onRefresh,
  onExport,
  onFullscreen,
  style,
  className,
}, ref) {
  const theme = useTheme()
  const chartRef = useRef(null)
  const [menuAnchor, setMenuAnchor] = useState(null)

  const chartOptions = useMemo(() => {
    return generateChartOptions(chartType, data, config, theme)
  }, [chartType, data, config, theme])

  const handleOpenMenu = useCallback((e) => {
    e.stopPropagation()
    setMenuAnchor(e.currentTarget)
  }, [])

  const handleCloseMenu = useCallback(() => {
    setMenuAnchor(null)
  }, [])

  const handleAction = useCallback((action) => {
    handleCloseMenu()
    switch (action) {
      case 'edit':
        onEdit?.(id)
        break
      case 'delete':
        onDelete?.(id)
        break
      case 'refresh':
        onRefresh?.(id)
        break
      case 'export':
        if (chartRef.current) {
          const chart = chartRef.current.getEchartsInstance()
          const url = chart.getDataURL({ type: 'png', pixelRatio: 2 })
          const link = document.createElement('a')
          link.download = `${title}.png`
          link.href = url
          link.click()
        }
        onExport?.(id)
        break
      case 'fullscreen':
        onFullscreen?.(id)
        break
    }
  }, [handleCloseMenu, id, onDelete, onEdit, onExport, onFullscreen, onRefresh, title])

  const TypeIcon = ChartTypeIcon[chartType] || BarChartIcon

  return (
    <WidgetContainer ref={ref} style={style} className={className}>
      <WidgetHeader>
        {editable && (
          <DragHandle className="widget-drag-handle">
            <DragIcon fontSize="small" />
          </DragHandle>
        )}
        <TypeIcon sx={{ fontSize: 18, color: 'text.secondary', mr: 1 }} />
        <Typography
          variant="subtitle2"
          sx={{ fontWeight: 600, flex: 1, fontSize: '0.875rem' }}
          noWrap
        >
          {title}
        </Typography>

        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => handleAction('refresh')}>
            <RefreshIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <IconButton size="small" onClick={handleOpenMenu}>
          <MoreIcon sx={{ fontSize: 18 }} />
        </IconButton>

        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={handleCloseMenu}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        >
          {editable && (
            <MenuItem onClick={() => handleAction('edit')}>
              <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
              <ListItemText>Edit</ListItemText>
            </MenuItem>
          )}
          <MenuItem onClick={() => handleAction('export')}>
            <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Export as PNG</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleAction('fullscreen')}>
            <ListItemIcon><FullscreenIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Fullscreen</ListItemText>
          </MenuItem>
          {editable && (
            <MenuItem onClick={() => handleAction('delete')} sx={{ color: 'text.secondary' }}>
              <ListItemIcon><DeleteIcon fontSize="small" sx={{ color: 'text.secondary' }} /></ListItemIcon>
              <ListItemText>Delete</ListItemText>
            </MenuItem>
          )}
        </Menu>
      </WidgetHeader>

      <WidgetContent>
        {loading ? (
          <CircularProgress size={32} />
        ) : (
          <ReactECharts
            ref={chartRef}
            option={chartOptions}
            style={{ width: '100%', height: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
            lazyUpdate
          />
        )}
      </WidgetContent>
    </WidgetContainer>
  )
})

/**
 * Available chart types
 */
const CHART_TYPES = [
  { type: 'bar', label: 'Bar Chart', icon: BarChartIcon },
  { type: 'line', label: 'Line Chart', icon: LineChartIcon },
  { type: 'area', label: 'Area Chart', icon: AreaIcon },
  { type: 'pie', label: 'Pie Chart', icon: PieChartIcon },
  { type: 'donut', label: 'Donut Chart', icon: DonutIcon },
  { type: 'scatter', label: 'Scatter Plot', icon: ScatterIcon },
  { type: 'stacked', label: 'Stacked Bar', icon: StackedIcon },
]


/**
 * Metric Widget Component
 * KPI/metric display with trend indicators and sparklines.
 */

// WidgetContainer is defined above (shared between components)

const Header = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  marginBottom: theme.spacing(1),
}))

// DragHandle defined above (shared)

const ValueContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'baseline',
  gap: theme.spacing(1),
  marginBottom: theme.spacing(0.5),
}))

const TrendBadge = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'trend',
})(({ theme, trend }) => {
  const colors = {
    up: theme.palette.text.secondary,
    down: theme.palette.text.secondary,
    flat: theme.palette.text.secondary,
  }
  const bgColors = {
    up: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
    down: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
    flat: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  }

  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: theme.spacing(0.25, 0.75),
    borderRadius: 4,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: colors[trend] || colors.flat,
    backgroundColor: bgColors[trend] || bgColors.flat,
  }
})

const SparklineContainer = styled(Box)(({ theme }) => ({
  flex: 1,
  minHeight: 40,
  marginTop: theme.spacing(1),
}))


const formatValue = (value, format = 'number') => {
  if (value === null || value === undefined) return '-'

  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: value >= 1000000 ? 'compact' : 'standard',
        maximumFractionDigits: value >= 1000000 ? 1 : 0,
      }).format(value)

    case 'percent':
      return `${value.toFixed(1)}%`

    case 'compact':
      return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(value)

    case 'decimal':
      return value.toFixed(2)

    default:
      return new Intl.NumberFormat('en-US').format(value)
  }
}

const getTrendDirection = (current, previous) => {
  if (!previous || current === previous) return 'flat'
  return current > previous ? 'up' : 'down'
}

const calculateChange = (current, previous) => {
  if (!previous) return null
  const change = ((current - previous) / previous) * 100
  return change
}


const MetricWidget = forwardRef(function MetricWidget({
  id,
  title = 'Metric',
  value = 0,
  previousValue,
  format = 'number',
  unit = '',
  sparklineData = [],
  description = '',
  color = 'primary',
  editable = true,
  onDelete,
  style,
  className,
}, ref) {
  const theme = useTheme()

  const trend = useMemo(() => getTrendDirection(value, previousValue), [value, previousValue])
  const change = useMemo(() => calculateChange(value, previousValue), [value, previousValue])
  const formattedValue = useMemo(() => formatValue(value, format), [value, format])

  const sparklineOptions = useMemo(() => {
    if (!sparklineData.length) return null

    const primaryColor = theme.palette.mode === 'dark' ? neutral[500] : neutral[700]

    return {
      grid: { left: 0, right: 0, top: 5, bottom: 5 },
      xAxis: { type: 'category', show: false },
      yAxis: { type: 'value', show: false },
      series: [
        {
          type: 'line',
          data: sparklineData,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            color: primaryColor,
            width: 2,
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                {
                  offset: 0,
                  color: alpha(primaryColor, 0.3),
                },
                {
                  offset: 1,
                  color: alpha(primaryColor, 0),
                },
              ],
            },
          },
        },
      ],
    }
  }, [sparklineData, color, theme])

  const TrendIcon = trend === 'up' ? TrendUpIcon : trend === 'down' ? TrendDownIcon : TrendFlatIcon

  return (
    <WidgetContainer ref={ref} style={style} className={className}>
      <Header>
        {editable && (
          <DragHandle className="widget-drag-handle">
            <DragIcon fontSize="small" />
          </DragHandle>
        )}
        <Typography
          variant="caption"
          sx={{
            flex: 1,
            color: 'text.secondary',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
          noWrap
        >
          {title}
        </Typography>
        {editable && (
          <Tooltip title="Delete">
            <IconButton size="small" onClick={() => onDelete?.(id)}>
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Header>

      <ValueContainer>
        <Typography
          variant="h4"
          sx={{
            fontWeight: 600,
            color: 'text.secondary',
            lineHeight: 1,
          }}
        >
          {formattedValue}
        </Typography>
        {unit && (
          <Typography variant="body2" color="text.secondary">
            {unit}
          </Typography>
        )}
      </ValueContainer>

      {change !== null && (
        <TrendBadge trend={trend}>
          <TrendIcon sx={{ fontSize: 14 }} />
          <span>{change > 0 ? '+' : ''}{change.toFixed(1)}%</span>
        </TrendBadge>
      )}

      {description && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      )}

      {sparklineOptions && (
        <SparklineContainer>
          <ReactECharts
            option={sparklineOptions}
            style={{ width: '100%', height: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
            lazyUpdate
          />
        </SparklineContainer>
      )}
    </WidgetContainer>
  )
})

/**
 * Widget Palette Component
 * Draggable widget options with variant sub-menus for AI widgets.
 */


const PaletteContainer = styled(Box)(({ theme }) => ({
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
}))

const CategoryHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer',
  padding: theme.spacing(0.5, 0),
  '&:hover': {
    opacity: 0.8,
  },
}))

const WidgetCard = styled(Card)(({ theme }) => ({
  cursor: 'grab',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  position: 'relative',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: `0 4px 12px ${theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.15) : alpha(theme.palette.text.primary, 0.08)}`,
    borderColor: theme.palette.divider,
  },
  '&:active': {
    cursor: 'grabbing',
    transform: 'scale(0.98)',
  },
}))

const WidgetGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: theme.spacing(1),
}))

const VariantBadge = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: 2,
  right: 2,
  width: 14,
  height: 14,
  borderRadius: '50%',
  backgroundColor: alpha(theme.palette.primary.main, 0.15),
  color: theme.palette.primary.main,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '10px',
  fontWeight: 600,
}))


const WIDGET_CATEGORIES = [
  {
    id: 'charts',
    label: 'Charts',
    widgets: [
      { type: 'chart:bar', label: 'Bar', icon: BarChartIcon, color: 'primary' },
      { type: 'chart:line', label: 'Line', icon: LineChartIcon, color: 'primary' },
      { type: 'chart:area', label: 'Area', icon: AreaIcon, color: 'primary' },
      { type: 'chart:pie', label: 'Pie', icon: PieChartIcon, color: 'primary' },
      { type: 'chart:donut', label: 'Donut', icon: DonutIcon, color: 'primary' },
      { type: 'chart:stacked', label: 'Stacked', icon: StackedIcon, color: 'primary' },
      { type: 'chart:scatter', label: 'Scatter', icon: ScatterIcon, color: 'primary' },
    ],
  },
  {
    id: 'metrics',
    label: 'Metrics',
    widgets: [
      { type: 'metric', label: 'KPI', icon: MetricIcon, color: 'success' },
      { type: 'metric:number', label: 'Number', icon: NumberIcon, color: 'success' },
      { type: 'metric:progress', label: 'Progress', icon: DonutIcon, color: 'success' },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    widgets: [
      { type: 'table', label: 'Table', icon: TableIcon, color: 'info' },
      { type: 'filter', label: 'Filter', icon: FilterIcon, color: 'warning' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    widgets: [
      { type: 'text', label: 'Text', icon: TextIcon, color: 'secondary' },
      { type: 'image', label: 'Image', icon: ImageIcon, color: 'secondary' },
    ],
  },
  // ── AI Widget Scenarios ──────────────────────────────────────────────────
  {
    id: 'intelligent',
    label: 'AI Widgets',
    defaultCollapsed: true,
    widgets: [
      { type: 'kpi', label: 'KPI', icon: KpiIcon, color: 'success', hasVariants: true },
      { type: 'trend', label: 'Trend', icon: LineChartIcon, color: 'primary', hasVariants: true },
      { type: 'trend-multi-line', label: 'Multi-Line', icon: LineChartIcon, color: 'primary' },
      { type: 'trends-cumulative', label: 'Cumulative', icon: AreaIcon, color: 'primary' },
      { type: 'comparison', label: 'Compare', icon: CompareIcon, color: 'primary', hasVariants: true },
      { type: 'distribution', label: 'Distribution', icon: DistributionIcon, color: 'primary', hasVariants: true },
      { type: 'composition', label: 'Composition', icon: CompositionIcon, color: 'primary', hasVariants: true },
      { type: 'category-bar', label: 'Category Bar', icon: BarChartIcon, color: 'primary', hasVariants: true },
    ],
  },
  {
    id: 'context',
    label: 'Context & Events',
    defaultCollapsed: true,
    widgets: [
      { type: 'alerts', label: 'Alerts', icon: AlertsIcon, color: 'error', hasVariants: true },
      { type: 'timeline', label: 'Timeline', icon: TimelineIcon, color: 'info', hasVariants: true },
      { type: 'eventlogstream', label: 'Event Log', icon: EventLogIcon, color: 'info', hasVariants: true },
      { type: 'narrative', label: 'Narrative', icon: NarrativeIcon, color: 'secondary' },
    ],
  },
  {
    id: 'advanced',
    label: 'Advanced Viz',
    defaultCollapsed: true,
    widgets: [
      { type: 'flow-sankey', label: 'Flow Diagram', icon: SankeyIcon, color: 'warning', hasVariants: true },
      { type: 'matrix-heatmap', label: 'Heatmap', icon: HeatmapIcon, color: 'warning', hasVariants: true },
      { type: 'diagnosticpanel', label: 'Diagnostics', icon: DiagnosticIcon, color: 'warning' },
      { type: 'uncertaintypanel', label: 'Uncertainty', icon: UncertaintyIcon, color: 'warning' },
    ],
  },
  {
    id: 'domain',
    label: 'Domain-Specific',
    defaultCollapsed: true,
    widgets: [
      { type: 'peopleview', label: 'People', icon: PeopleIcon, color: 'secondary' },
      { type: 'peoplehexgrid', label: 'Hex Grid', icon: HexIcon, color: 'secondary' },
      { type: 'peoplenetwork', label: 'Network', icon: NetworkIcon, color: 'secondary' },
      { type: 'edgedevicepanel', label: 'IoT Device', icon: DeviceIcon, color: 'secondary' },
      { type: 'supplychainglobe', label: 'Globe', icon: GlobeIcon, color: 'secondary' },
      { type: 'chatstream', label: 'Chat', icon: ChatIcon, color: 'secondary' },
      { type: 'agentsview', label: 'Agents', icon: AgentIcon, color: 'secondary' },
      { type: 'vaultview', label: 'Vault', icon: VaultIcon, color: 'secondary' },
    ],
  },
]


function WidgetPalette({ onAddWidget }) {
  const theme = useTheme()
  const [expandedCategories, setExpandedCategories] = useState(
    WIDGET_CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat.id]: !cat.defaultCollapsed }), {})
  )
  const [variantAnchor, setVariantAnchor] = useState(null)
  const [variantWidget, setVariantWidget] = useState(null)

  const toggleCategory = useCallback((categoryId) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }))
  }, [])

  const handleDragStart = useCallback((e, widget, variant) => {
    e.dataTransfer.setData('widget-type', widget.type)
    e.dataTransfer.setData('widget-label', widget.label)
    if (variant) {
      e.dataTransfer.setData('widget-variant', variant)
    }
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  const handleWidgetClick = useCallback((widget, e) => {
    // If widget has multiple variants, show variant picker
    const variants = SCENARIO_VARIANTS[widget.type]
    if (widget.hasVariants && variants && variants.length > 1) {
      setVariantAnchor(e.currentTarget)
      setVariantWidget(widget)
      return
    }
    // Single variant or legacy — add directly
    const defaultVariant = DEFAULT_VARIANTS[widget.type]
    onAddWidget?.(widget.type, widget.label, defaultVariant)
  }, [onAddWidget])

  const handleVariantSelect = useCallback((scenario, variant) => {
    const vConfig = VARIANT_CONFIG[variant]
    const label = vConfig?.label || variant
    onAddWidget?.(scenario, label, variant)
    setVariantAnchor(null)
    setVariantWidget(null)
  }, [onAddWidget])

  const handleCloseVariantPicker = useCallback(() => {
    setVariantAnchor(null)
    setVariantWidget(null)
  }, [])

  return (
    <PaletteContainer>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        Add Widget
      </Typography>

      {WIDGET_CATEGORIES.map((category) => (
        <Box key={category.id}>
          <CategoryHeader onClick={() => toggleCategory(category.id)}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              {category.label}
            </Typography>
            <IconButton size="small">
              {expandedCategories[category.id] ? (
                <CollapseIcon fontSize="small" />
              ) : (
                <ExpandIcon fontSize="small" />
              )}
            </IconButton>
          </CategoryHeader>

          <Collapse in={expandedCategories[category.id]}>
            <WidgetGrid>
              {category.widgets.map((widget) => {
                const variantCount = SCENARIO_VARIANTS[widget.type]?.length || 0
                return (
                  <WidgetCard
                    key={widget.type}
                    variant="outlined"
                    draggable
                    onDragStart={(e) => handleDragStart(e, widget)}
                    onClick={(e) => handleWidgetClick(widget, e)}
                  >
                    <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 0.5,
                        }}
                      >
                        <widget.icon
                          sx={{
                            fontSize: 20,
                            color: 'text.secondary',
                          }}
                        />
                        <Typography
                          variant="caption"
                          sx={{ fontSize: '12px', textAlign: 'center' }}
                        >
                          {widget.label}
                        </Typography>
                      </Box>
                    </CardContent>
                    {widget.hasVariants && variantCount > 1 && (
                      <VariantBadge>{variantCount}</VariantBadge>
                    )}
                  </WidgetCard>
                )
              })}
            </WidgetGrid>
          </Collapse>
        </Box>
      ))}

      {/* Variant Picker Popover */}
      <Popover
        open={Boolean(variantAnchor)}
        anchorEl={variantAnchor}
        onClose={handleCloseVariantPicker}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: { maxHeight: 300, minWidth: 200, maxWidth: 260 },
          },
        }}
      >
        {variantWidget && (
          <Box sx={{ py: 0.5 }}>
            <Typography
              variant="caption"
              sx={{ fontWeight: 600, px: 2, py: 0.5, color: 'text.secondary', display: 'block' }}
            >
              {variantWidget.label} Variants
            </Typography>
            <List dense disablePadding>
              {(SCENARIO_VARIANTS[variantWidget.type] || []).map((v) => {
                const vConfig = VARIANT_CONFIG[v]
                return (
                  <ListItemButton
                    key={v}
                    onClick={() => handleVariantSelect(variantWidget.type, v)}
                    sx={{ py: 0.5, px: 2 }}
                  >
                    <ListItemText
                      primary={vConfig?.label || v}
                      secondary={vConfig?.description || ''}
                      primaryTypographyProps={{ variant: 'body2', fontSize: '14px' }}
                      secondaryTypographyProps={{ variant: 'caption', fontSize: '12px', noWrap: true }}
                    />
                  </ListItemButton>
                )
              })}
            </List>
          </Box>
        )}
      </Popover>
    </PaletteContainer>
  )
}

/**
 * Parse widget type to get category and subtype
 */
function parseWidgetType(type) {
  const [category, subtype] = type.split(':')
  return { category, subtype: subtype || category }
}

/**
 * Get widget definition by type
 */
/**
 * All available widget types
 */
// ── Styled Components ──────────────────────────────────────────────────────

const PlaceholderCard = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  padding: theme.spacing(3),
  borderRadius: 8,
  backgroundColor:
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.primary.main, 0.08)
      : alpha(theme.palette.primary.main, 0.04),
  gap: theme.spacing(1),
}))

const NarrativeCard = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  height: '100%',
  overflow: 'auto',
  backgroundColor: theme.palette.background.paper,
  borderRadius: 8,
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const AlertListCard = styled(Box)(({ theme }) => ({
  padding: theme.spacing(1.5),
  height: '100%',
  overflow: 'auto',
  backgroundColor: theme.palette.background.paper,
  borderRadius: 8,
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const MetricCard = styled(Box)(({ theme }) => ({
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: theme.spacing(2),
  backgroundColor: theme.palette.background.paper,
  borderRadius: 8,
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const StatusDot = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'status',
})(({ theme, status }) => {
  const colorMap = {
    ok: theme.palette.success.main,
    warning: theme.palette.warning.main,
    critical: theme.palette.error.main,
    offline: theme.palette.text.disabled,
  }
  return {
    width: 12,
    height: 12,
    borderRadius: '50%',
    backgroundColor: colorMap[status] || theme.palette.info.main,
    display: 'inline-block',
  }
})

// ── Severity colors ────────────────────────────────────────────────────────

const SEVERITY_COLORS = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
  ok: 'success',
}

// ── Metric sub-renderers ───────────────────────────────────────────────────

function renderMetricVariant(variantKey, vConfig, data, config, props) {
  const value = data?.value ?? data?.summary?.value?.latest ?? 0
  const unit = data?.units || data?.unit || ''
  const title = config?.title || vConfig.label

  // Status KPI — show status dot + on/off label
  if (vConfig.showStatus) {
    const status = data?.status || 'ok'
    return (
      <MetricCard>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <StatusDot status={status} />
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
        </Box>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          {status === 'ok' ? 'Online' : status === 'offline' ? 'Offline' : String(value)}
        </Typography>
        {unit && (
          <Typography variant="caption" color="text.secondary">{unit}</Typography>
        )}
      </MetricCard>
    )
  }

  // Threshold KPI — show alert coloring when over/under threshold
  if (vConfig.showThreshold) {
    const threshold = data?.threshold ?? config?.threshold
    const isOver = threshold != null && value > threshold
    return (
      <MetricWidget
        title={title}
        value={value}
        unit={unit}
        format={vConfig.metricFormat || 'number'}
        previousValue={data?.previousValue}
        sparklineData={data?.timeSeries?.map((p) => p.value) || []}
        description={isOver ? `Above threshold (${threshold})` : data?.label || ''}
        {...props}
      />
    )
  }

  // Default metric rendering (live, accumulated, lifecycle)
  return (
    <MetricWidget
      title={title}
      value={value}
      unit={unit}
      format={vConfig.metricFormat || 'number'}
      previousValue={data?.previousValue}
      sparklineData={data?.timeSeries?.map((p) => p.value) || []}
      description={data?.label || ''}
      {...props}
    />
  )
}

// ── Chart sub-renderer ─────────────────────────────────────────────────────

function renderChartVariant(variantKey, vConfig, data, config, props) {
  const chartType = vConfig.chartType || 'bar'
  const title = config?.title || vConfig.label
  const chartOptions = vConfig.chartOptions || {}

  // Merge variant-specific chart options into config
  const mergedConfig = {
    ...config,
    title,
    ...chartOptions,
  }

  return (
    <ChartWidget
      title={title}
      chartType={chartType}
      data={data}
      config={mergedConfig}
      {...props}
    />
  )
}

// ── List sub-renderer (alerts, timeline, eventlog) ─────────────────────────

function renderListVariant(variantKey, vConfig, data, config, props) {
  const listType = vConfig.listType || 'alerts'
  const title = config?.title || vConfig.label

  if (listType === 'alerts') {
    const items = data?.alerts || data?.events || data?.items || []
    return (
      <AlertListCard>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {title}
        </Typography>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No alerts to display.
          </Typography>
        ) : (
          <List dense disablePadding>
            {items.slice(0, 10).map((item, i) => (
              <ListItem key={i} disableGutters sx={{ py: 0.25 }}>
                <ListItemText
                  primary={item.message || item.title || item.text || `Alert ${i + 1}`}
                  secondary={item.timestamp || item.time || ''}
                  primaryTypographyProps={{ variant: 'body2' }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
                {item.severity && (
                  <Chip
                    label={item.severity}
                    size="small"
                    color={SEVERITY_COLORS[item.severity] || 'default'}
                    sx={{ ml: 1 }}
                  />
                )}
              </ListItem>
            ))}
          </List>
        )}
      </AlertListCard>
    )
  }

  if (listType === 'timeline') {
    const items = data?.events || data?.timeline || data?.items || []
    return (
      <AlertListCard>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
          {title}
        </Typography>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No events to display.
          </Typography>
        ) : (
          <List dense disablePadding>
            {items.slice(0, 15).map((item, i) => (
              <ListItem key={i} disableGutters sx={{ py: 0.25 }}>
                <Box sx={{ mr: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <TimelineIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                  {i < items.length - 1 && (
                    <Box sx={{ width: 1, flex: 1, bgcolor: 'divider', minHeight: 12 }} />
                  )}
                </Box>
                <ListItemText
                  primary={item.message || item.title || item.text || `Event ${i + 1}`}
                  secondary={item.timestamp || item.time || ''}
                  primaryTypographyProps={{ variant: 'body2' }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </AlertListCard>
    )
  }

  // eventlog
  const items = data?.events || data?.logs || data?.items || []
  return (
    <AlertListCard>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        {title}
      </Typography>
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No log entries to display.
        </Typography>
      ) : (
        <List dense disablePadding>
          {items.slice(0, 20).map((item, i) => (
            <ListItem key={i} disableGutters sx={{ py: 0.15 }}>
              <Typography
                variant="caption"
                sx={{ fontFamily: 'monospace', color: 'text.disabled', mr: 1, minWidth: 60 }}
              >
                {item.timestamp || item.time || ''}
              </Typography>
              <ListItemText
                primary={item.message || item.text || `Log ${i + 1}`}
                primaryTypographyProps={{ variant: 'body2', sx: { fontFamily: 'monospace', fontSize: '12px' } }}
              />
              {item.level && (
                <Chip
                  label={item.level}
                  size="small"
                  variant="outlined"
                  sx={{ ml: 1, height: 18, fontSize: '10px' }}
                />
              )}
            </ListItem>
          ))}
        </List>
      )}
    </AlertListCard>
  )
}

// ── Text sub-renderer ──────────────────────────────────────────────────────

function renderTextVariant(variantKey, vConfig, data, config) {
  return (
    <NarrativeCard>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        {data?.title || config?.title || vConfig.label}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
        {data?.text || data?.narrative || 'No narrative available.'}
      </Typography>
      {data?.highlights?.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1.5 }}>
          {data.highlights.map((h, i) => (
            <Chip key={i} label={h} size="small" variant="outlined" />
          ))}
        </Box>
      )}
    </NarrativeCard>
  )
}

// ── Domain sub-renderer (with ECharts for heatmap/sankey) ─────────────────

function renderDomainVariant(variantKey, vConfig, data, config, props) {
  const domainType = vConfig.domainType || variantKey
  const title = config?.title || vConfig.label

  // Route heatmap and sankey through ChartWidget for actual ECharts rendering
  if (domainType === 'matrix-heatmap' && data && Object.keys(data).length > 0) {
    return (
      <ChartWidget
        title={title}
        chartType="heatmap"
        data={data}
        config={{ ...config, title }}
        editable={false}
        {...props}
      />
    )
  }

  if (domainType === 'flow-sankey' && data && Object.keys(data).length > 0) {
    return (
      <ChartWidget
        title={title}
        chartType="sankey"
        data={data}
        config={{ ...config, title }}
        editable={false}
        {...props}
      />
    )
  }

  // Fallback placeholder for other domain types
  const IconComponent = DOMAIN_ICONS[domainType] || TrendIconAlias
  return (
    <PlaceholderCard>
      <IconComponent sx={{ fontSize: 40, color: 'primary.main', opacity: 0.6 }} />
      <Typography variant="subtitle2" color="text.secondary">
        {title}
      </Typography>
      <Typography variant="caption" color="text.disabled">
        {vConfig.description || variantKey}
      </Typography>
      {data && Object.keys(data).length > 0 && (
        <Chip label="Data loaded" size="small" color="success" variant="outlined" sx={{ mt: 0.5 }} />
      )}
    </PlaceholderCard>
  )
}

// ── Data source badge ─────────────────────────────────────────────────────

function DataSourceBadge({ source }) {
  if (!source) return null
  return (
    <Tooltip title={`Source: ${source}`}>
      <Chip
        icon={<DbIcon sx={{ fontSize: 14 }} />}
        label="Live"
        size="small"
        variant="outlined"
        color="success"
        sx={{
          position: 'absolute',
          top: 4,
          right: 4,
          height: 20,
          fontSize: '10px',
          opacity: 0.8,
          zIndex: 1,
          '& .MuiChip-icon': { fontSize: 14 },
        }}
      />
    </Tooltip>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────

export function WidgetRenderer({
  scenario,
  variant,
  data: externalData,
  config,
  connectionId,
  reportRunId,
  showSourceBadge = true,
  ...props
}) {
  // Resolve effective variant — prefer explicit variant, else default for scenario
  const effectiveVariant = variant || config?.variant || DEFAULT_VARIANTS[scenario] || scenario
  const vConfig = getVariantConfig(effectiveVariant, scenario)

  // Resolve connection from config if not passed directly
  // useWidgetData will auto-resolve from app store if this is still undefined
  const explicitConnectionId = connectionId || config?.data_source

  // Always fetch — useWidgetData auto-resolves from the active DB in the store
  const {
    data: fetchedData,
    loading,
    error: fetchError,
    source: dataSource,
  } = useWidgetData({
    scenario,
    variant: effectiveVariant,
    connectionId: explicitConnectionId,
    reportRunId,
    autoFetch: !externalData,
  })

  // Use external data if provided, otherwise use fetched data
  const data = externalData || fetchedData

  // If we can't find any config, render a generic fallback
  if (!vConfig) {
    return (
      <PlaceholderCard>
        <TrendIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
        <Typography variant="body2" color="text.secondary">
          {config?.title || scenario}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          Unknown variant: {effectiveVariant}
        </Typography>
      </PlaceholderCard>
    )
  }

  // Show loading state while fetching
  if (loading && !data) {
    return (
      <PlaceholderCard>
        <CircularProgress size={24} />
        <Typography variant="caption" color="text.secondary">
          Loading {vConfig.label}...
        </Typography>
      </PlaceholderCard>
    )
  }

  // Show error/empty state when no data available
  if (!data && !loading) {
    return (
      <PlaceholderCard>
        <ErrorIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
        <Typography variant="body2" color="text.secondary">
          {config?.title || vConfig?.label || scenario}
        </Typography>
        <Typography variant="caption" color="text.disabled">
          {fetchError || 'No data available. Connect a database to see live data.'}
        </Typography>
      </PlaceholderCard>
    )
  }

  const badge = showSourceBadge && !externalData ? (
    <DataSourceBadge source={dataSource} />
  ) : null

  const renderAs = vConfig.renderAs

  if (renderAs === 'metric') {
    return (
      <Box sx={{ position: 'relative', height: '100%' }}>
        {badge}
        {renderMetricVariant(effectiveVariant, vConfig, data, config, props)}
      </Box>
    )
  }

  if (renderAs === 'chart') {
    return (
      <Box sx={{ position: 'relative', height: '100%' }}>
        {badge}
        {renderChartVariant(effectiveVariant, vConfig, data, config, props)}
      </Box>
    )
  }

  if (renderAs === 'list') {
    return (
      <Box sx={{ position: 'relative', height: '100%' }}>
        {badge}
        {renderListVariant(effectiveVariant, vConfig, data, config, props)}
      </Box>
    )
  }

  if (renderAs === 'text') {
    return (
      <Box sx={{ position: 'relative', height: '100%' }}>
        {badge}
        {renderTextVariant(effectiveVariant, vConfig, data, config)}
      </Box>
    )
  }

  if (renderAs === 'domain') {
    return (
      <Box sx={{ position: 'relative', height: '100%' }}>
        {badge}
        {renderDomainVariant(effectiveVariant, vConfig, data, config, props)}
      </Box>
    )
  }

  // Final fallback
  return (
    <PlaceholderCard>
      <TrendIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
      <Typography variant="body2" color="text.secondary">
        {config?.title || vConfig.label || scenario}
      </Typography>
    </PlaceholderCard>
  )
}

/**
 * Check if a widget type is a scenario-based intelligent widget (not legacy).
 */
function isScenarioWidget(type) {
  const legacyPrefixes = ['chart', 'metric', 'table', 'text', 'filter', 'map', 'image']
  const baseType = type?.split(':')[0]
  return baseType && !legacyPrefixes.includes(baseType)
}


/**
 * AI Widget Suggestion Panel
 *
 * Allows users to describe what they want to see in natural language,
 * then uses the widget intelligence API to suggest optimal widgets.
 */

// ── Scenario → Icon mapping ────────────────────────────────────────────────

const SCENARIO_ICONS = {
  kpi: KpiIcon,
  trend: TrendIcon,
  'trend-multi-line': TrendIcon,
  'trends-cumulative': CumulativeIcon,
  comparison: CompareIcon,
  distribution: DistributionIcon,
  composition: CompositionIcon,
  'category-bar': BarIcon,
  alerts: AlertsIcon,
  timeline: TimelineIcon,
  eventlogstream: EventLogIcon,
  narrative: NarrativeIcon,
  'flow-sankey': SankeyIcon,
  'matrix-heatmap': HeatmapIcon,
  diagnosticpanel: DiagnosticIcon,
  uncertaintypanel: UncertaintyIcon,
  peopleview: PeopleIcon,
  peoplehexgrid: HexIcon,
  peoplenetwork: NetworkIcon,
  edgedevicepanel: DeviceIcon,
  supplychainglobe: GlobeIcon,
  chatstream: ChatIcon,
  agentsview: AgentIcon,
  vaultview: VaultIcon,
}

// ── Styled Components ──────────────────────────────────────────────────────

const SuggestionContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1.5),
}))

const SuggestionItem = styled(ListItem)(({ theme }) => ({
  borderRadius: 8,
  border: `1px solid ${theme.palette.divider}`,
  marginBottom: theme.spacing(0.5),
  cursor: 'pointer',
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? alpha(theme.palette.primary.main, 0.12)
        : alpha(theme.palette.primary.main, 0.06),
    borderColor: theme.palette.primary.main,
  },
}))

// ── Main Component ─────────────────────────────────────────────────────────

function AIWidgetSuggestion({ onAddWidgets, onAddSingleWidget }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [error, setError] = useState(null)

  const handleSuggest = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    try {
      const result = await selectWidgets({ query: query.trim(), maxWidgets: 8 })
      setSuggestions(result.widgets || [])
    } catch (err) {
      setError(err.message || 'Failed to get suggestions')
      setSuggestions([])
    } finally {
      setLoading(false)
    }
  }, [query])

  const handleApplyAll = useCallback(async () => {
    if (!suggestions.length) return
    setLoading(true)
    try {
      const layout = await packGrid(suggestions)
      onAddWidgets?.(suggestions, layout)
      setSuggestions([])
      setQuery('')
    } catch (err) {
      setError(err.message || 'Failed to pack grid')
    } finally {
      setLoading(false)
    }
  }, [suggestions, onAddWidgets])

  const handleAddSingle = useCallback(
    (widget) => {
      onAddSingleWidget?.(widget.scenario, widget.variant || widget.scenario)
    },
    [onAddSingleWidget]
  )

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSuggest()
      }
    },
    [handleSuggest]
  )

  return (
    <SuggestionContainer>
      <Divider sx={{ my: 0.5 }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AIIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          AI Suggest
        </Typography>
      </Box>

      <TextField
        size="small"
        placeholder="Describe your dashboard..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        multiline
        maxRows={3}
        fullWidth
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
      />

      <Button
        variant="contained"
        size="small"
        onClick={handleSuggest}
        disabled={loading || !query.trim()}
        startIcon={loading ? <CircularProgress size={16} /> : <AIIcon />}
        sx={{ borderRadius: 2, textTransform: 'none' }}
      >
        {loading ? 'Thinking...' : 'Suggest Widgets'}
      </Button>

      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}

      {suggestions.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary">
            {suggestions.length} widget{suggestions.length !== 1 ? 's' : ''} suggested
          </Typography>

          <List dense disablePadding>
            {suggestions.map((widget, i) => {
              const IconComp = SCENARIO_ICONS[widget.scenario] || TrendIcon
              return (
                <SuggestionItem
                  key={widget.id || i}
                  disableGutters
                  sx={{ px: 1.5, py: 0.75 }}
                  onClick={() => handleAddSingle(widget)}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <IconComp sx={{ fontSize: 18, color: 'primary.main' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={widget.scenario}
                    secondary={widget.variant}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                  <Chip
                    label={`${Math.round((widget.relevance || 0) * 100)}%`}
                    size="small"
                    color="primary"
                    variant="outlined"
                    sx={{ height: 20, fontSize: '12px' }}
                  />
                </SuggestionItem>
              )
            })}
          </List>

          <Button
            variant="outlined"
            size="small"
            onClick={handleApplyAll}
            disabled={loading}
            startIcon={<AddIcon />}
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            Add All to Dashboard
          </Button>
        </>
      )}
    </SuggestionContainer>
  )
}

// === From: widgetVariants.js ===
/**
 * Complete widget variant metadata for all 24 scenarios and 71 variants.
 *
 * Maps every variant to its rendering configuration:
 * - chartType: ECharts chart type to use
 * - renderAs: which renderer component to use (chart, metric, text, list, domain)
 * - label: human-readable display name
 * - description: what this variant is good for
 * - defaultSize: { w, h } grid dimensions
 */

// ── Variant → Rendering Config ─────────────────────────────────────────────

export const VARIANT_CONFIG = {
  // ── KPI (5 variants) ──────────────────────────────────────────────────
  'kpi-live': {
    renderAs: 'metric',
    label: 'Live KPI',
    description: 'Real-time single metric with trend',
    defaultSize: { w: 3, h: 2 },
    metricFormat: 'number',
  },
  'kpi-alert': {
    renderAs: 'metric',
    label: 'Alert KPI',
    description: 'KPI with threshold alert indicator',
    defaultSize: { w: 3, h: 2 },
    metricFormat: 'number',
    showThreshold: true,
  },
  'kpi-accumulated': {
    renderAs: 'metric',
    label: 'Accumulated KPI',
    description: 'Cumulative total metric (kWh, counts)',
    defaultSize: { w: 3, h: 2 },
    metricFormat: 'compact',
  },
  'kpi-lifecycle': {
    renderAs: 'metric',
    label: 'Lifecycle KPI',
    description: 'Equipment age / remaining life',
    defaultSize: { w: 3, h: 2 },
    metricFormat: 'percent',
  },
  'kpi-status': {
    renderAs: 'metric',
    label: 'Status KPI',
    description: 'Binary on/off or status indicator',
    defaultSize: { w: 2, h: 2 },
    metricFormat: 'number',
    showStatus: true,
  },

  // ── Trend (6 variants) ────────────────────────────────────────────────
  'trend-line': {
    renderAs: 'chart',
    chartType: 'line',
    label: 'Line Trend',
    description: 'Standard time-series line chart',
    defaultSize: { w: 6, h: 3 },
  },
  'trend-area': {
    renderAs: 'chart',
    chartType: 'area',
    label: 'Area Trend',
    description: 'Filled area time-series chart',
    defaultSize: { w: 6, h: 3 },
  },
  'trend-step-line': {
    renderAs: 'chart',
    chartType: 'line',
    label: 'Step Line',
    description: 'Stepped line for discrete state changes',
    defaultSize: { w: 6, h: 3 },
    chartOptions: { step: 'end' },
  },
  'trend-rgb-phase': {
    renderAs: 'chart',
    chartType: 'line',
    label: 'RGB Phase',
    description: 'Three-phase R/Y/B overlay',
    defaultSize: { w: 6, h: 3 },
    chartOptions: { multiSeries: true, colors: [status.destructive, status.warning, secondary.cyan[500]] },
  },
  'trend-alert-context': {
    renderAs: 'chart',
    chartType: 'line',
    label: 'Alert Context',
    description: 'Trend line with alert markers',
    defaultSize: { w: 6, h: 3 },
    chartOptions: { showAnnotations: true },
  },
  'trend-heatmap': {
    renderAs: 'chart',
    chartType: 'scatter',
    label: 'Trend Heatmap',
    description: 'Dense time-series as color intensity',
    defaultSize: { w: 6, h: 4 },
  },

  // ── Trend Multi-Line (1 variant) ──────────────────────────────────────
  'trend-multi-line': {
    renderAs: 'chart',
    chartType: 'line',
    label: 'Multi-Line Trend',
    description: 'Multiple metrics overlaid for comparison',
    defaultSize: { w: 8, h: 3 },
    chartOptions: { multiSeries: true },
  },

  // ── Trends Cumulative (1 variant) ─────────────────────────────────────
  'trends-cumulative': {
    renderAs: 'chart',
    chartType: 'area',
    label: 'Cumulative Trend',
    description: 'Running total over time',
    defaultSize: { w: 6, h: 3 },
  },

  // ── Comparison (6 variants) ───────────────────────────────────────────
  'comparison-side-by-side': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Side-by-Side',
    description: 'Two items side by side comparison',
    defaultSize: { w: 6, h: 3 },
  },
  'comparison-delta-bar': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Delta Bar',
    description: 'Show differences as positive/negative bars',
    defaultSize: { w: 6, h: 3 },
    chartOptions: { diverging: true },
  },
  'comparison-grouped-bar': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Grouped Bar',
    description: 'Multiple metrics grouped by entity',
    defaultSize: { w: 8, h: 3 },
    chartOptions: { grouped: true },
  },
  'comparison-waterfall': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Waterfall',
    description: 'Cumulative gains and losses',
    defaultSize: { w: 6, h: 3 },
  },
  'comparison-small-multiples': {
    renderAs: 'chart',
    chartType: 'line',
    label: 'Small Multiples',
    description: 'Grid of small charts for comparison',
    defaultSize: { w: 8, h: 4 },
  },
  'comparison-composition-split': {
    renderAs: 'chart',
    chartType: 'stacked',
    label: 'Composition Split',
    description: 'Split view showing composition differences',
    defaultSize: { w: 8, h: 3 },
  },

  // ── Distribution (6 variants) ─────────────────────────────────────────
  'distribution-donut': {
    renderAs: 'chart',
    chartType: 'donut',
    label: 'Donut',
    description: 'Donut chart with center metric',
    defaultSize: { w: 4, h: 3 },
  },
  'distribution-100-stacked-bar': {
    renderAs: 'chart',
    chartType: 'stacked',
    label: '100% Stacked',
    description: 'Normalized stacked bar (percentages)',
    defaultSize: { w: 6, h: 3 },
  },
  'distribution-horizontal-bar': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Horizontal Bar',
    description: 'Ranked horizontal bars',
    defaultSize: { w: 6, h: 3 },
    chartOptions: { horizontal: true },
  },
  'distribution-pie': {
    renderAs: 'chart',
    chartType: 'pie',
    label: 'Pie',
    description: 'Classic pie chart for simple splits',
    defaultSize: { w: 4, h: 3 },
  },
  'distribution-grouped-bar': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Grouped Dist.',
    description: 'Distribution as grouped bar chart',
    defaultSize: { w: 6, h: 3 },
    chartOptions: { grouped: true },
  },
  'distribution-pareto-bar': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Pareto',
    description: 'Pareto chart with 80/20 line',
    defaultSize: { w: 6, h: 3 },
    chartOptions: { pareto: true },
  },

  // ── Composition (5 variants) ──────────────────────────────────────────
  'composition-stacked-bar': {
    renderAs: 'chart',
    chartType: 'stacked',
    label: 'Stacked Bar',
    description: 'Stacked bar showing parts of whole',
    defaultSize: { w: 6, h: 3 },
  },
  'composition-stacked-area': {
    renderAs: 'chart',
    chartType: 'area',
    label: 'Stacked Area',
    description: 'Stacked area over time',
    defaultSize: { w: 8, h: 3 },
    chartOptions: { stacked: true },
  },
  'composition-donut': {
    renderAs: 'chart',
    chartType: 'donut',
    label: 'Composition Donut',
    description: 'Donut showing composition breakdown',
    defaultSize: { w: 4, h: 3 },
  },
  'composition-waterfall': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Composition Waterfall',
    description: 'How parts build up to the total',
    defaultSize: { w: 6, h: 3 },
  },
  'composition-treemap': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Treemap',
    description: 'Hierarchical area-based composition',
    defaultSize: { w: 6, h: 4 },
  },

  // ── Category Bar (5 variants) ─────────────────────────────────────────
  'category-bar-vertical': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Vertical Bar',
    description: 'Standard vertical category bars',
    defaultSize: { w: 6, h: 3 },
  },
  'category-bar-horizontal': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Horizontal Bar',
    description: 'Horizontal bars for long labels',
    defaultSize: { w: 6, h: 3 },
    chartOptions: { horizontal: true },
  },
  'category-bar-stacked': {
    renderAs: 'chart',
    chartType: 'stacked',
    label: 'Stacked Category',
    description: 'Stacked bar by category',
    defaultSize: { w: 6, h: 3 },
  },
  'category-bar-grouped': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Grouped Category',
    description: 'Grouped bar by category',
    defaultSize: { w: 8, h: 3 },
    chartOptions: { grouped: true },
  },
  'category-bar-diverging': {
    renderAs: 'chart',
    chartType: 'bar',
    label: 'Diverging Bar',
    description: 'Diverging bar from center axis',
    defaultSize: { w: 6, h: 3 },
    chartOptions: { diverging: true },
  },

  // ── Flow Sankey (5 variants) ──────────────────────────────────────────
  'flow-sankey-standard': {
    renderAs: 'domain',
    label: 'Sankey Flow',
    description: 'Standard energy/material flow',
    defaultSize: { w: 8, h: 4 },
    domainType: 'flow-sankey',
  },
  'flow-sankey-energy-balance': {
    renderAs: 'domain',
    label: 'Energy Balance',
    description: 'Energy input → output balance',
    defaultSize: { w: 8, h: 4 },
    domainType: 'flow-sankey',
  },
  'flow-sankey-multi-source': {
    renderAs: 'domain',
    label: 'Multi-Source Flow',
    description: 'Multiple source → destination flows',
    defaultSize: { w: 10, h: 4 },
    domainType: 'flow-sankey',
  },
  'flow-sankey-layered': {
    renderAs: 'domain',
    label: 'Layered Flow',
    description: 'Multi-layer flow diagram',
    defaultSize: { w: 10, h: 4 },
    domainType: 'flow-sankey',
  },
  'flow-sankey-time-sliced': {
    renderAs: 'domain',
    label: 'Time-Sliced Flow',
    description: 'Flow changes over time periods',
    defaultSize: { w: 10, h: 4 },
    domainType: 'flow-sankey',
  },

  // ── Matrix Heatmap (5 variants) ───────────────────────────────────────
  'matrix-heatmap-value': {
    renderAs: 'domain',
    label: 'Value Heatmap',
    description: 'Color-coded value matrix',
    defaultSize: { w: 8, h: 4 },
    domainType: 'matrix-heatmap',
  },
  'matrix-heatmap-correlation': {
    renderAs: 'domain',
    label: 'Correlation Matrix',
    description: 'Metric-to-metric correlation',
    defaultSize: { w: 8, h: 4 },
    domainType: 'matrix-heatmap',
  },
  'matrix-heatmap-calendar': {
    renderAs: 'domain',
    label: 'Calendar Heatmap',
    description: 'Day-of-week × hour pattern',
    defaultSize: { w: 8, h: 4 },
    domainType: 'matrix-heatmap',
  },
  'matrix-heatmap-status': {
    renderAs: 'domain',
    label: 'Status Matrix',
    description: 'Equipment × metric status grid',
    defaultSize: { w: 8, h: 4 },
    domainType: 'matrix-heatmap',
  },
  'matrix-heatmap-density': {
    renderAs: 'domain',
    label: 'Density Heatmap',
    description: 'Event density visualization',
    defaultSize: { w: 8, h: 4 },
    domainType: 'matrix-heatmap',
  },

  // ── Timeline (5 variants) ─────────────────────────────────────────────
  'timeline-linear': {
    renderAs: 'list',
    label: 'Linear Timeline',
    description: 'Chronological event sequence',
    defaultSize: { w: 6, h: 3 },
    listType: 'timeline',
  },
  'timeline-status': {
    renderAs: 'list',
    label: 'Status Timeline',
    description: 'Equipment status history',
    defaultSize: { w: 6, h: 3 },
    listType: 'timeline',
  },
  'timeline-multilane': {
    renderAs: 'list',
    label: 'Multi-Lane Timeline',
    description: 'Parallel timelines per entity',
    defaultSize: { w: 8, h: 4 },
    listType: 'timeline',
  },
  'timeline-forensic': {
    renderAs: 'list',
    label: 'Forensic Timeline',
    description: 'Detailed incident investigation',
    defaultSize: { w: 8, h: 4 },
    listType: 'timeline',
  },
  'timeline-dense': {
    renderAs: 'list',
    label: 'Dense Timeline',
    description: 'Compact high-frequency events',
    defaultSize: { w: 8, h: 3 },
    listType: 'timeline',
  },

  // ── Alerts (5 variants) ───────────────────────────────────────────────
  'alerts-banner': {
    renderAs: 'list',
    label: 'Alert Banner',
    description: 'Full-width alert notification',
    defaultSize: { w: 12, h: 1 },
    listType: 'alerts',
  },
  'alerts-toast': {
    renderAs: 'list',
    label: 'Alert Toast',
    description: 'Compact stacked notifications',
    defaultSize: { w: 3, h: 2 },
    listType: 'alerts',
  },
  'alerts-card': {
    renderAs: 'list',
    label: 'Alert Cards',
    description: 'Card-based alert display',
    defaultSize: { w: 4, h: 3 },
    listType: 'alerts',
  },
  'alerts-badge': {
    renderAs: 'list',
    label: 'Alert Badge',
    description: 'Compact count badge with summary',
    defaultSize: { w: 2, h: 2 },
    listType: 'alerts',
  },
  'alerts-modal': {
    renderAs: 'list',
    label: 'Alert Modal',
    description: 'Expandable alert detail panel',
    defaultSize: { w: 6, h: 3 },
    listType: 'alerts',
  },

  // ── Event Log Stream (5 variants) ─────────────────────────────────────
  'eventlogstream-chronological': {
    renderAs: 'list',
    label: 'Chronological Log',
    description: 'Time-ordered event stream',
    defaultSize: { w: 6, h: 4 },
    listType: 'eventlog',
  },
  'eventlogstream-compact-feed': {
    renderAs: 'list',
    label: 'Compact Feed',
    description: 'Dense scrolling event feed',
    defaultSize: { w: 4, h: 4 },
    listType: 'eventlog',
  },
  'eventlogstream-tabular': {
    renderAs: 'list',
    label: 'Tabular Log',
    description: 'Table-formatted event log',
    defaultSize: { w: 8, h: 4 },
    listType: 'eventlog',
  },
  'eventlogstream-correlation': {
    renderAs: 'list',
    label: 'Correlation Log',
    description: 'Events grouped by correlation',
    defaultSize: { w: 8, h: 4 },
    listType: 'eventlog',
  },
  'eventlogstream-grouped-asset': {
    renderAs: 'list',
    label: 'Asset-Grouped Log',
    description: 'Events grouped by equipment',
    defaultSize: { w: 8, h: 4 },
    listType: 'eventlog',
  },

  // ── Narrative (1 variant) ─────────────────────────────────────────────
  narrative: {
    renderAs: 'text',
    label: 'Narrative',
    description: 'Text-based insight summary',
    defaultSize: { w: 4, h: 2 },
  },

  // ── Single-variant domain scenarios ───────────────────────────────────
  peopleview: {
    renderAs: 'domain',
    label: 'People View',
    description: 'Personnel overview and assignments',
    defaultSize: { w: 6, h: 3 },
    domainType: 'peopleview',
  },
  peoplehexgrid: {
    renderAs: 'domain',
    label: 'People Hex Grid',
    description: 'Hexagonal personnel spatial map',
    defaultSize: { w: 8, h: 4 },
    domainType: 'peoplehexgrid',
  },
  peoplenetwork: {
    renderAs: 'domain',
    label: 'People Network',
    description: 'Organizational network graph',
    defaultSize: { w: 8, h: 4 },
    domainType: 'peoplenetwork',
  },
  supplychainglobe: {
    renderAs: 'domain',
    label: 'Supply Chain Globe',
    description: '3D globe with supply routes',
    defaultSize: { w: 12, h: 6 },
    domainType: 'supplychainglobe',
  },
  edgedevicepanel: {
    renderAs: 'domain',
    label: 'Edge Device Panel',
    description: 'IoT/edge device status panel',
    defaultSize: { w: 4, h: 2 },
    domainType: 'edgedevicepanel',
  },
  chatstream: {
    renderAs: 'domain',
    label: 'Chat Stream',
    description: 'Conversational message feed',
    defaultSize: { w: 4, h: 3 },
    domainType: 'chatstream',
  },
  diagnosticpanel: {
    renderAs: 'domain',
    label: 'Diagnostic Panel',
    description: 'Equipment diagnostics & health',
    defaultSize: { w: 6, h: 3 },
    domainType: 'diagnosticpanel',
  },
  uncertaintypanel: {
    renderAs: 'domain',
    label: 'Uncertainty Panel',
    description: 'Confidence intervals & data quality',
    defaultSize: { w: 4, h: 2 },
    domainType: 'uncertaintypanel',
  },
  agentsview: {
    renderAs: 'domain',
    label: 'Agents View',
    description: 'AI agent status & activity',
    defaultSize: { w: 6, h: 2 },
    domainType: 'agentsview',
  },
  vaultview: {
    renderAs: 'domain',
    label: 'Vault View',
    description: 'Secure data vault & archive',
    defaultSize: { w: 6, h: 2 },
    domainType: 'vaultview',
  },
}

// ── Scenario → Default Variant mapping ──────────────────────────────────────

const DEFAULT_VARIANTS = {
  kpi: 'kpi-live',
  trend: 'trend-line',
  'trend-multi-line': 'trend-multi-line',
  'trends-cumulative': 'trends-cumulative',
  comparison: 'comparison-side-by-side',
  distribution: 'distribution-donut',
  composition: 'composition-stacked-bar',
  'category-bar': 'category-bar-vertical',
  'flow-sankey': 'flow-sankey-standard',
  'matrix-heatmap': 'matrix-heatmap-value',
  timeline: 'timeline-linear',
  alerts: 'alerts-card',
  eventlogstream: 'eventlogstream-chronological',
  narrative: 'narrative',
  peopleview: 'peopleview',
  peoplehexgrid: 'peoplehexgrid',
  peoplenetwork: 'peoplenetwork',
  supplychainglobe: 'supplychainglobe',
  edgedevicepanel: 'edgedevicepanel',
  chatstream: 'chatstream',
  diagnosticpanel: 'diagnosticpanel',
  uncertaintypanel: 'uncertaintypanel',
  agentsview: 'agentsview',
  vaultview: 'vaultview',
}

// ── Scenario → All Variants list ────────────────────────────────────────────

const SCENARIO_VARIANTS = {
  kpi: ['kpi-live', 'kpi-alert', 'kpi-accumulated', 'kpi-lifecycle', 'kpi-status'],
  trend: ['trend-line', 'trend-area', 'trend-step-line', 'trend-rgb-phase', 'trend-alert-context', 'trend-heatmap'],
  'trend-multi-line': ['trend-multi-line'],
  'trends-cumulative': ['trends-cumulative'],
  comparison: ['comparison-side-by-side', 'comparison-delta-bar', 'comparison-grouped-bar', 'comparison-waterfall', 'comparison-small-multiples', 'comparison-composition-split'],
  distribution: ['distribution-donut', 'distribution-100-stacked-bar', 'distribution-horizontal-bar', 'distribution-pie', 'distribution-grouped-bar', 'distribution-pareto-bar'],
  composition: ['composition-stacked-bar', 'composition-stacked-area', 'composition-donut', 'composition-waterfall', 'composition-treemap'],
  'category-bar': ['category-bar-vertical', 'category-bar-horizontal', 'category-bar-stacked', 'category-bar-grouped', 'category-bar-diverging'],
  'flow-sankey': ['flow-sankey-standard', 'flow-sankey-energy-balance', 'flow-sankey-multi-source', 'flow-sankey-layered', 'flow-sankey-time-sliced'],
  'matrix-heatmap': ['matrix-heatmap-value', 'matrix-heatmap-correlation', 'matrix-heatmap-calendar', 'matrix-heatmap-status', 'matrix-heatmap-density'],
  timeline: ['timeline-linear', 'timeline-status', 'timeline-multilane', 'timeline-forensic', 'timeline-dense'],
  alerts: ['alerts-banner', 'alerts-toast', 'alerts-card', 'alerts-badge', 'alerts-modal'],
  eventlogstream: ['eventlogstream-chronological', 'eventlogstream-compact-feed', 'eventlogstream-tabular', 'eventlogstream-correlation', 'eventlogstream-grouped-asset'],
  narrative: ['narrative'],
  peopleview: ['peopleview'],
  peoplehexgrid: ['peoplehexgrid'],
  peoplenetwork: ['peoplenetwork'],
  supplychainglobe: ['supplychainglobe'],
  edgedevicepanel: ['edgedevicepanel'],
  chatstream: ['chatstream'],
  diagnosticpanel: ['diagnosticpanel'],
  uncertaintypanel: ['uncertaintypanel'],
  agentsview: ['agentsview'],
  vaultview: ['vaultview'],
}

/**
 * Get variant config, falling back to default variant for the scenario.
 */
function getVariantConfig(variant, scenario) {
  if (VARIANT_CONFIG[variant]) return VARIANT_CONFIG[variant]
  const defaultVariant = DEFAULT_VARIANTS[scenario]
  if (defaultVariant && VARIANT_CONFIG[defaultVariant]) return VARIANT_CONFIG[defaultVariant]
  return null
}

/**
 * Get the default size for a variant or scenario.
 */
function getVariantDefaultSize(variant, scenario) {
  const config = getVariantConfig(variant, scenario)
  return config?.defaultSize || { w: 4, h: 3 }
}

// === From: useWidgetData.js ===
/**
 * useWidgetData — fetches live data for a widget from the active DB connection
 * or from a report run, using the widget's RAG strategy.
 *
 * Automatically reads activeConnectionId from the app store if no
 * connectionId is explicitly provided.
 */

function useWidgetData({
  scenario,
  variant,
  connectionId,
  reportRunId,
  filters,
  limit = 100,
  autoFetch = true,
  refreshInterval = 0,
}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [source, setSource] = useState(null)
  const [strategy, setStrategy] = useState(null)
  const intervalRef = useRef(null)

  // Auto-resolve from global store if no explicit connectionId
  const storeConnectionId = useAppStore((s) => s.activeConnectionId)
  const effectiveConnectionId = connectionId || storeConnectionId

  const fetchData = useCallback(async () => {
    if (!scenario) return

    setLoading(true)
    setError(null)

    try {
      let result

      if (reportRunId) {
        // Tier 1: Report run data (RAG over saved report data)
        result = await getWidgetReportData({ runId: reportRunId, scenario, variant })
      } else if (effectiveConnectionId) {
        // Tier 2: Active database connection (real data)
        result = await getWidgetData({
          connectionId: effectiveConnectionId,
          scenario,
          variant,
          filters,
          limit,
        })
      } else {
        // No data source available
        setError('No data source configured. Connect a database to see live data.')
        setLoading(false)
        return
      }

      // Check if backend returned an error with empty data
      if (result.error && (!result.data || Object.keys(result.data).length === 0)) {
        setError(result.error)
        setData(null)
      } else {
        setData(result.data || result)
        setSource(result.source || effectiveConnectionId || null)
        setStrategy(result.strategy || null)
      }
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Failed to fetch widget data'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [scenario, variant, effectiveConnectionId, reportRunId, filters, limit])

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    if (autoFetch) {
      fetchData()
    }
  }, [autoFetch, fetchData])

  // Optional polling interval
  useEffect(() => {
    if (refreshInterval > 0 && autoFetch) {
      intervalRef.current = setInterval(fetchData, refreshInterval)
      return () => clearInterval(intervalRef.current)
    }
  }, [refreshInterval, autoFetch, fetchData])

  return {
    data,
    loading,
    error,
    source,
    strategy,
    connectionId: effectiveConnectionId,
    refresh: fetchData,
  }
}

// === From: src/features/dashboards/containers/DashboardBuilderPageContainer.jsx ===
/**
 * Dashboard Builder Page Container
 * Drag-and-drop dashboard builder with react-grid-layout and ECharts.
 */


const PageContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  height: 'calc(100vh - 64px)',
  backgroundColor: theme.palette.background.default,
}))

const Sidebar = styled(Box)(({ theme }) => ({
  width: 300,
  display: 'flex',
  flexDirection: 'column',
  borderRight: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.6),
}))

const SidebarSection = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const SidebarContent = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(2),
}))

const MainContent = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}))

const Toolbar = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(1.5, 2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
}))

const Canvas = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(2),
  overflow: 'auto',
  backgroundColor: theme.palette.background.default,
}))

const ActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '14px',
}))

const DashboardListItem = styled(ListItemButton, {
  shouldForwardProp: (prop) => prop !== 'active',
})(({ theme, active }) => ({
  borderRadius: 8,
  marginBottom: theme.spacing(0.5),
  backgroundColor: active ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100]) : 'transparent',
  '&:hover': {
    backgroundColor: active
      ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.15) : neutral[100])
      : alpha(theme.palette.action.hover, 0.05),
  },
}))

const EmptyCanvas = styled(Box)(({ theme }) => ({
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `2px dashed ${alpha(theme.palette.divider, 0.3)}`,
  borderRadius: 8,  // Figma spec: 8px
}))

const EmptyState = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: theme.spacing(4),
  textAlign: 'center',
}))

const InsightCard = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(1.5),
  marginBottom: theme.spacing(1),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  border: `1px solid ${theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100]}`,
}))


const SAMPLE_CHART_DATA = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  datasets: [
    { label: 'Revenue', data: [12000, 19000, 15000, 25000, 22000, 30000] },
    { label: 'Expenses', data: [8000, 12000, 10000, 14000, 13000, 16000] },
  ],
}

const SAMPLE_SPARKLINE = [65, 70, 68, 75, 82, 78, 85, 90, 88, 95]


export default function DashboardBuilderPage() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const {
    dashboards,
    currentDashboard,
    widgets,
    insights,
    loading,
    saving,
    refreshing,
    error,
    fetchDashboards,
    createDashboard,
    getDashboard,
    updateDashboard,
    deleteDashboard,
    addWidget,
    updateWidget,
    deleteWidget,
    refreshDashboard,
    generateInsights,
    predictTrends,
    detectAnomalies,
    createSnapshot,
    generateEmbedToken,
    reset,
  } = useDashboardStore()

  const { connections, templates, activeConnectionId } = useSharedData()
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId)

  // Cross-page: accept diagrams/data from other features (Visualization, Query)
  useIncomingTransfer(FeatureKey.DASHBOARDS, {
    [TransferAction.ADD_TO]: async (payload) => {
      if (currentDashboard) {
        await addWidget(currentDashboard.id, {
          type: payload.data?.svg ? 'html' : 'chart',
          title: payload.title || 'Imported Widget',
          config: payload.data || {},
        })
      }
    },
  })

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newDashboardName, setNewDashboardName] = useState('')
  const [addWidgetDialogOpen, setAddWidgetDialogOpen] = useState(false)
  const [pendingWidgetType, setPendingWidgetType] = useState(null)
  const [widgetTitle, setWidgetTitle] = useState('')
  const [widgetChartType, setWidgetChartType] = useState('bar')
  const [aiMenuAnchor, setAiMenuAnchor] = useState(null)
  const [localLayout, setLocalLayout] = useState([])
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  useEffect(() => {
    fetchDashboards()
    return () => reset()
  }, [fetchDashboards, reset])

  // Sync layout from widgets
  useEffect(() => {
    if (widgets.length > 0) {
      const layout = widgets.map((w) => ({
        i: w.id,
        x: w.x ?? 0,
        y: w.y ?? 0,
        w: w.w ?? 4,
        h: w.h ?? 3,
        minW: w.minW ?? 2,
        minH: w.minH ?? 2,
      }))
      setLocalLayout(layout)
    } else {
      setLocalLayout([])
    }
  }, [widgets])

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'dashboards', ...intent },
      action,
    })
  }, [execute])

  const handleOpenCreateDialog = useCallback(() => {
    return executeUI('Open create dashboard', () => setCreateDialogOpen(true))
  }, [executeUI])

  const handleCloseCreateDialog = useCallback(() => {
    return executeUI('Close create dashboard', () => {
      setCreateDialogOpen(false)
      setNewDashboardName('')
    })
  }, [executeUI])

  const handleSelectDashboard = useCallback((dashboardId) => {
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Open dashboard',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'dashboards', dashboardId },
      action: async () => {
        await getDashboard(dashboardId)
        setHasUnsavedChanges(false)
      },
    })
  }, [execute, getDashboard])

  const handleCreateDashboard = useCallback(() => {
    if (!newDashboardName) return undefined
    return execute({
      type: InteractionType.CREATE,
      label: 'Create dashboard',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'dashboards', name: newDashboardName },
      action: async () => {
        const dashboard = await createDashboard({
          name: newDashboardName,
          connectionId: selectedConnectionId || undefined,
          widgets: [],
          filters: [],
        })
        if (dashboard) {
          setCreateDialogOpen(false)
          setNewDashboardName('')
          toast.show('Dashboard created', 'success')
        }
        return dashboard
      },
    })
  }, [createDashboard, execute, newDashboardName, toast])

  const handleDeleteDashboard = useCallback((dashboardId) => {
    return execute({
      type: InteractionType.DELETE,
      label: 'Delete dashboard',
      reversibility: Reversibility.REQUIRES_CONFIRMATION,
      intent: { source: 'dashboards', dashboardId },
      action: async () => {
        const success = await deleteDashboard(dashboardId)
        if (success) {
          toast.show('Dashboard deleted', 'success')
        }
        return success
      },
    })
  }, [deleteDashboard, execute, toast])

  const [pendingVariant, setPendingVariant] = useState(null)

  // Add widget from palette
  const handleAddWidgetFromPalette = useCallback((widgetType, label, variant) => {
    setPendingWidgetType(widgetType)
    setWidgetTitle(label || '')
    setPendingVariant(variant || DEFAULT_VARIANTS[widgetType] || null)
    const { category, subtype } = parseWidgetType(widgetType)
    if (category === 'chart') {
      setWidgetChartType(subtype)
    }
    setAddWidgetDialogOpen(true)
  }, [])

  const handleCloseAddWidgetDialog = useCallback(() => {
    return executeUI('Close add widget', () => {
      setAddWidgetDialogOpen(false)
      setPendingWidgetType(null)
      setPendingVariant(null)
      setWidgetTitle('')
    })
  }, [executeUI])

  const handleConfirmAddWidget = useCallback(() => {
    if (!currentDashboard || !pendingWidgetType || !widgetTitle) return undefined

    const { category, subtype } = parseWidgetType(pendingWidgetType)
    const isScenario = isScenarioWidget(pendingWidgetType)

    // Use variant-aware sizing for scenario widgets, legacy sizing otherwise
    let sizes
    if (isScenario && pendingVariant) {
      const vs = getVariantDefaultSize(pendingVariant, pendingWidgetType)
      sizes = { w: vs.w, h: vs.h, minW: 2, minH: 2 }
    } else {
      sizes = DEFAULT_WIDGET_SIZES[category] || { w: 4, h: 3, minW: 2, minH: 2 }
    }

    return execute({
      type: InteractionType.UPDATE,
      label: 'Add widget',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'dashboards', dashboardId: currentDashboard.id, widgetType: pendingWidgetType },
      action: async () => {
        const connectionId = selectedConnectionId || currentDashboard?.connectionId || undefined

        const widgetConfig = isScenario
          ? {
              type: pendingWidgetType,
              scenario: pendingWidgetType,
              variant: pendingVariant || DEFAULT_VARIANTS[pendingWidgetType],
              title: widgetTitle,
              data_source: connectionId,
            }
          : {
              type: category,
              subtype: subtype,
              chartType: category === 'chart' ? widgetChartType : undefined,
              title: widgetTitle,
              data: category === 'chart' ? SAMPLE_CHART_DATA : undefined,
              value: category === 'metric' ? 12500 : undefined,
              previousValue: category === 'metric' ? 10000 : undefined,
              sparklineData: category === 'metric' ? SAMPLE_SPARKLINE : undefined,
              format: category === 'metric' ? 'currency' : undefined,
              data_source: connectionId,
            }

        const widget = await addWidget(currentDashboard.id, {
          config: widgetConfig,
          x: 0,
          y: widgets.length * 4,
          ...sizes,
        })
        if (widget) {
          setAddWidgetDialogOpen(false)
          setPendingWidgetType(null)
          setPendingVariant(null)
          setWidgetTitle('')
          setHasUnsavedChanges(true)
          toast.show('Widget added', 'success')
        }
        return widget
      },
    })
  }, [addWidget, currentDashboard, execute, pendingWidgetType, pendingVariant, toast, widgetChartType, widgetTitle, widgets.length, selectedConnectionId])

  const handleDeleteWidget = useCallback((widgetId) => {
    if (!currentDashboard) return undefined
    return execute({
      type: InteractionType.DELETE,
      label: 'Remove widget',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'dashboards', dashboardId: currentDashboard.id, widgetId },
      action: async () => {
        await deleteWidget(currentDashboard.id, widgetId)
        setHasUnsavedChanges(true)
        toast.show('Widget removed', 'success')
      },
    })
  }, [currentDashboard, deleteWidget, execute, toast])

  const handleLayoutChange = useCallback((layout) => {
    setLocalLayout(layout)
    setHasUnsavedChanges(true)
  }, [])

  const handleSave = useCallback(() => {
    if (!currentDashboard) return undefined
    return execute({
      type: InteractionType.UPDATE,
      label: 'Save dashboard',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'dashboards', dashboardId: currentDashboard.id },
      action: async () => {
        // Update widget positions from layout
        const updatedWidgets = widgets.map((w) => {
          const layoutItem = localLayout.find((l) => l.i === w.id)
          if (layoutItem) {
            return { ...w, x: layoutItem.x, y: layoutItem.y, w: layoutItem.w, h: layoutItem.h }
          }
          return w
        })
        await updateDashboard(currentDashboard.id, { widgets: updatedWidgets })
        setHasUnsavedChanges(false)
        toast.show('Dashboard saved', 'success')
      },
    })
  }, [currentDashboard, execute, localLayout, toast, updateDashboard, widgets])

  const handleRefresh = useCallback(() => {
    if (!currentDashboard) return undefined
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Refresh dashboard',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'dashboards', dashboardId: currentDashboard.id },
      action: async () => {
        await refreshDashboard(currentDashboard.id)
        toast.show('Dashboard refreshed', 'success')
      },
    })
  }, [currentDashboard, execute, refreshDashboard, toast])

  const handleOpenAiMenu = useCallback((event) => {
    const anchor = event.currentTarget
    return executeUI('Open AI analytics', () => setAiMenuAnchor(anchor))
  }, [executeUI])

  const handleCloseAiMenu = useCallback(() => {
    return executeUI('Close AI analytics', () => setAiMenuAnchor(null))
  }, [executeUI])

  const handleAIAction = useCallback((action) => {
    handleCloseAiMenu()
    if (!currentDashboard) return undefined

    const sampleData = [{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 15 }, { x: 4, y: 25 }]
    const labelMap = {
      insights: 'Generate insights',
      trends: 'Predict trends',
      anomalies: 'Detect anomalies',
    }

    return execute({
      type: InteractionType.ANALYZE,
      label: labelMap[action] || 'Run AI analytics',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      intent: { source: 'dashboards', dashboardId: currentDashboard.id, action },
      action: async () => {
        switch (action) {
          case 'insights':
            await generateInsights(sampleData)
            toast.show('Insights generated', 'success')
            break
          case 'trends':
            await predictTrends(sampleData, 'x', 'y', 6)
            toast.show('Trends predicted', 'success')
            break
          case 'anomalies':
            await detectAnomalies(sampleData, ['y'])
            toast.show('Anomalies detected', 'success')
            break
        }
      },
    })
  }, [currentDashboard, detectAnomalies, execute, generateInsights, handleCloseAiMenu, predictTrends, toast])

  const handleSnapshot = useCallback(() => {
    if (!currentDashboard) return undefined
    return execute({
      type: InteractionType.DOWNLOAD,
      label: 'Create snapshot',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'dashboards', dashboardId: currentDashboard.id },
      action: async () => {
        const result = await createSnapshot(currentDashboard.id, 'png')
        if (result) {
          toast.show('Snapshot created', 'success')
        }
        return result
      },
    })
  }, [createSnapshot, currentDashboard, execute, toast])

  const handleEmbed = useCallback(() => {
    if (!currentDashboard) return undefined
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Generate embed link',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'dashboards', dashboardId: currentDashboard.id },
      action: async () => {
        const result = await generateEmbedToken(currentDashboard.id)
        if (result) {
          navigator.clipboard.writeText(result.embed_url)
          toast.show('Embed URL copied to clipboard', 'success')
        }
        return result
      },
    })
  }, [currentDashboard, execute, generateEmbedToken, toast])

  const handleDismissError = useCallback(() => {
    return executeUI('Dismiss dashboard error', () => reset())
  }, [executeUI, reset])

  // Render widget by type
  const renderWidget = useCallback((widget) => {
    const widgetType = widget.config?.type || 'chart'

    // Scenario-based intelligent widgets
    if (isScenarioWidget(widgetType)) {
      return (
        <WidgetRenderer
          key={widget.id}
          scenario={widget.config?.scenario || widgetType}
          variant={widget.config?.variant}
          data={widget.config?.data || widget.data}
          config={widget.config}
          connectionId={widget.config?.data_source || selectedConnectionId || currentDashboard?.connectionId}
          id={widget.id}
          editable
          onDelete={handleDeleteWidget}
        />
      )
    }

    const { category } = parseWidgetType(widgetType)

    if (category === 'chart' || widget.config?.type === 'chart') {
      return (
        <ChartWidget
          key={widget.id}
          id={widget.id}
          title={widget.config?.title}
          chartType={widget.config?.chartType || widget.config?.subtype || 'bar'}
          data={widget.config?.data || SAMPLE_CHART_DATA}
          onDelete={handleDeleteWidget}
          onRefresh={() => {}}
          editable
        />
      )
    }

    if (category === 'metric' || widget.config?.type === 'metric') {
      return (
        <MetricWidget
          key={widget.id}
          id={widget.id}
          title={widget.config?.title}
          value={widget.config?.value || 0}
          previousValue={widget.config?.previousValue}
          format={widget.config?.format || 'number'}
          sparklineData={widget.config?.sparklineData || []}
          onDelete={handleDeleteWidget}
          editable
        />
      )
    }

    // Default placeholder for other widget types
    return (
      <Paper
        key={widget.id}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          p: 2,
          borderRadius: 1,  // Figma spec: 8px
        }}
        variant="outlined"
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {widget.config?.title || 'Widget'}
        </Typography>
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
          }}
        >
          <Typography variant="caption">
            {widget.config?.type} widget coming soon
          </Typography>
        </Box>
      </Paper>
    )
  }, [handleDeleteWidget])

  return (
    <PageContainer>
      {/* Sidebar */}
      <Sidebar>
        <SidebarSection>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Dashboards
            </Typography>
            <Tooltip title="New Dashboard">
              <IconButton size="small" onClick={handleOpenCreateDialog}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          <Box sx={{ mt: 1 }}>
            {loading && dashboards.length === 0 ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : dashboards.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                No dashboards yet
              </Typography>
            ) : (
              <List disablePadding dense>
                {dashboards.slice(0, 5).map((db) => (
                  <DashboardListItem
                    key={db.id}
                    active={currentDashboard?.id === db.id}
                    onClick={() => handleSelectDashboard(db.id)}
                    dense
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <DashboardIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={db.name}
                      primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                    />
                  </DashboardListItem>
                ))}
              </List>
            )}
          </Box>
        </SidebarSection>

        {currentDashboard && (
          <SidebarContent>
            <ImportFromMenu
              currentFeature={FeatureKey.DASHBOARDS}
              onImport={async (output) => {
                if (currentDashboard) {
                  await addWidget(currentDashboard.id, {
                    type: output.data?.svg ? 'html' : 'chart',
                    title: output.title || 'Imported Widget',
                    config: output.data || {},
                  })
                  toast.show(`Added "${output.title}" as widget`, 'success')
                }
              }}
              label="Import Widget"
            />
            <Box sx={{ mt: 1 }} />
            <WidgetPalette onAddWidget={handleAddWidgetFromPalette} />

            <AIWidgetSuggestion
              onAddSingleWidget={(scenario, variant) => {
                handleAddWidgetFromPalette(scenario, scenario, variant)
              }}
              onAddWidgets={(widgets, layout) => {
                if (!currentDashboard) return
                const cells = layout?.cells || []
                widgets.forEach((w, i) => {
                  const cell = cells[i]
                  addWidget(currentDashboard.id, {
                    config: {
                      type: w.scenario,
                      title: w.question || w.scenario,
                      variant: w.variant,
                      scenario: w.scenario,
                    },
                    x: cell ? cell.col_start - 1 : 0,
                    y: cell ? cell.row_start - 1 : i * 3,
                    w: cell ? cell.col_end - cell.col_start : 4,
                    h: cell ? cell.row_end - cell.row_start : 3,
                  })
                })
                toast.show(`Added ${widgets.length} AI-suggested widgets`, 'success')
              }}
            />

            {insights.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                  AI INSIGHTS
                </Typography>
                {insights.map((insight, idx) => (
                  <InsightCard key={idx} elevation={0}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {insight.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {insight.description}
                    </Typography>
                  </InsightCard>
                ))}
              </Box>
            )}
          </SidebarContent>
        )}
      </Sidebar>

      {/* Main Content */}
      <MainContent>
        {currentDashboard ? (
          <>
            {/* Toolbar */}
            <Toolbar>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {currentDashboard.name}
                </Typography>
                <Chip
                  size="small"
                  label={`${widgets.length} widgets`}
                  sx={{ borderRadius: 1, height: 20, fontSize: '12px' }}
                />
                {hasUnsavedChanges && (
                  <Chip
                    size="small"
                    label="Unsaved"
                    sx={{ borderRadius: 1, height: 20, fontSize: '12px', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                  />
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <ActionButton
                  size="small"
                  startIcon={<RefreshIcon />}
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  Refresh
                </ActionButton>
                <ActionButton
                  size="small"
                  startIcon={<AIIcon />}
                  onClick={handleOpenAiMenu}
                >
                  AI Analytics
                </ActionButton>
                <ActionButton
                  size="small"
                  startIcon={<SnapshotIcon />}
                  onClick={handleSnapshot}
                >
                  Snapshot
                </ActionButton>
                <ActionButton
                  size="small"
                  startIcon={<EmbedIcon />}
                  onClick={handleEmbed}
                >
                  Embed
                </ActionButton>
                <ActionButton
                  variant="contained"
                  size="small"
                  startIcon={<SaveIcon />}
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                >
                  {saving ? 'Saving...' : 'Save'}
                </ActionButton>
              </Box>
            </Toolbar>

            {/* Canvas */}
            <Canvas>
              {widgets.length > 0 ? (
                <DashboardGridLayout
                  widgets={widgets}
                  layout={localLayout}
                  onLayoutChange={handleLayoutChange}
                  editable
                >
                  {widgets.map((widget) => (
                    <div key={widget.id}>
                      {renderWidget(widget)}
                    </div>
                  ))}
                </DashboardGridLayout>
              ) : (
                <EmptyCanvas>
                  <Typography color="text.secondary">
                    Add widgets from the palette to build your dashboard
                  </Typography>
                </EmptyCanvas>
              )}
            </Canvas>
          </>
        ) : (
          <EmptyState>
            <DashboardIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
              No Dashboard Selected
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Create a new dashboard or select one from the sidebar.
            </Typography>
            <ActionButton
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenCreateDialog}
            >
              Create Dashboard
            </ActionButton>
          </EmptyState>
        )}
      </MainContent>

      {/* AI Menu */}
      <Menu
        anchorEl={aiMenuAnchor}
        open={Boolean(aiMenuAnchor)}
        onClose={handleCloseAiMenu}
      >
        <MenuItem onClick={() => handleAIAction('insights')}>
          <ListItemIcon><AIIcon /></ListItemIcon>
          <ListItemText>Generate Insights</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleAIAction('trends')}>
          <ListItemIcon><TrendIcon /></ListItemIcon>
          <ListItemText>Predict Trends</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleAIAction('anomalies')}>
          <ListItemIcon><AnomalyIcon /></ListItemIcon>
          <ListItemText>Detect Anomalies</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create Dashboard Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={handleCloseCreateDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Create New Dashboard</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Dashboard Name"
            value={newDashboardName}
            onChange={(e) => setNewDashboardName(e.target.value)}
            sx={{ mt: 2 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newDashboardName) {
                handleCreateDashboard()
              }
            }}
          />
          <ConnectionSelector
            value={selectedConnectionId}
            onChange={setSelectedConnectionId}
            label="Data Source (optional)"
            showStatus
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreateDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateDashboard}
            disabled={!newDashboardName || loading}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Widget Dialog */}
      <Dialog
        open={addWidgetDialogOpen}
        onClose={handleCloseAddWidgetDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Add Widget</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Widget Title"
            value={widgetTitle}
            onChange={(e) => setWidgetTitle(e.target.value)}
            sx={{ mt: 2 }}
          />
          {pendingWidgetType?.startsWith('chart') && (
            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel>Chart Type</InputLabel>
              <Select
                value={widgetChartType}
                label="Chart Type"
                onChange={(e) => setWidgetChartType(e.target.value)}
              >
                {CHART_TYPES.map((ct) => (
                  <MenuItem key={ct.type} value={ct.type}>
                    {ct.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          {isScenarioWidget(pendingWidgetType) && SCENARIO_VARIANTS[pendingWidgetType]?.length > 1 && (
            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel>Variant</InputLabel>
              <Select
                value={pendingVariant || DEFAULT_VARIANTS[pendingWidgetType] || ''}
                label="Variant"
                onChange={(e) => setPendingVariant(e.target.value)}
              >
                {(SCENARIO_VARIANTS[pendingWidgetType] || []).map((v) => {
                  const vc = VARIANT_CONFIG[v]
                  return (
                    <MenuItem key={v} value={v}>
                      {vc?.label || v}
                    </MenuItem>
                  )
                })}
              </Select>
            </FormControl>
          )}
          {!currentDashboard?.connectionId && (
            <ConnectionSelector
              value={selectedConnectionId}
              onChange={setSelectedConnectionId}
              label="Widget Data Source"
              showStatus
              sx={{ mt: 2 }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAddWidgetDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleConfirmAddWidget}
            disabled={!widgetTitle}
          >
            Add Widget
          </Button>
        </DialogActions>
      </Dialog>

      {error && (
        <Alert
          severity="error"
          onClose={handleDismissError}
          sx={{ position: 'fixed', bottom: 16, right: 16, maxWidth: 400 }}
        >
          {error}
        </Alert>
      )}
    </PageContainer>
  )
}
