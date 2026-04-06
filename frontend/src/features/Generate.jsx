import * as mock from '@/api/mock'
import { applyChatTemplateEdit, chatTemplateEdit, createSavedChart, createSavedChart as createSavedChartRequest, deleteSavedChart, deleteSavedChart as deleteSavedChartRequest, deleteTemplate as deleteTemplateRequest, discoverReports, editTemplateAi, editTemplateManual, exportTemplateZip, fetchTemplateKeyOptions, getTemplateCatalog, getTemplateHtml, importTemplateZip, isMock, listApprovedTemplates, listSavedCharts, listSavedCharts as listSavedChartsRequest, queueRecommendTemplates, recommendTemplates, runReportAsJob, suggestCharts, undoTemplateEdit, updateSavedChart, updateSavedChart as updateSavedChartRequest, withBase } from '@/api/client'
import { neutral, palette, secondary } from '@/app/theme'
import { EmptyState, InfoTooltip, LoadingState, ScaledIframePreview, Surface, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { ConfirmModal } from '@/components/modals'
import { AiUsageNotice } from '@/components/ux'
import { savePersistedCache, useTrackedJobs } from '@/hooks/hooks'
import { useAppStore } from '@/stores/app'
import { DEFAULT_CREATE_WELCOME, useTemplateChatStore } from '@/stores/content'
import { TOOLTIP_COPY, buildLastEditInfo, confirmDelete, resolveTemplatePreviewUrl, resolveTemplateThumbnailUrl, sanitizeCodeHighlight } from '@/utils/helpers'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined'
import ChatIcon from '@mui/icons-material/Chat'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloseIcon from '@mui/icons-material/Close'
import CodeIcon from '@mui/icons-material/Code'
import CompareArrowsIcon from '@mui/icons-material/CompareArrows'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import EditIcon from '@mui/icons-material/Edit'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import FilterListIcon from '@mui/icons-material/FilterList'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import HistoryIcon from '@mui/icons-material/History'
import KeyboardIcon from '@mui/icons-material/Keyboard'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import QueueIcon from '@mui/icons-material/Queue'
import RefreshIcon from '@mui/icons-material/Refresh'
import RemoveIcon from '@mui/icons-material/Remove'
import ReplayIcon from '@mui/icons-material/Replay'
import RestoreIcon from '@mui/icons-material/Restore'
import SaveIcon from '@mui/icons-material/Save'
import ScheduleIcon from '@mui/icons-material/Schedule'
import SendIcon from '@mui/icons-material/Send'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import UndoIcon from '@mui/icons-material/Undo'
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess'
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore'
import { Alert, AlertTitle, Autocomplete, Box, Breadcrumbs, Button, Card, CardActionArea, CardContent, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, LinearProgress, Link, MenuItem, Paper, Select, Skeleton, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha } from '@mui/material'
import Grid from '@mui/material/Grid2'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, UNSAFE_NavigationContext, useLocation, useParams } from 'react-router-dom'
import { Bar, BarChart, Brush, CartesianGrid, Cell, Legend as RechartsLegend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'

const surfaceStackSx = {
  gap: { xs: 2, md: 2.5 },
}


const JOB_STATUS_COLORS = {
  queued: 'default',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'warning',
}


const toSqlDateTime = (value) => {
  if (!value) return ''

  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:00`
}

const toLocalInputValue = (v) => {
  if (!v) return ''
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return v
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`
}


const buildDownloadUrl = (url) => {
  if (!url) return ''
  try {
    const u = new URL(url)
    u.searchParams.set('download', '1')
    return u.toString()
  } catch {
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}download=1`
  }
}


const getTemplateKind = (template) => (template?.kind === 'excel' ? 'excel' : 'pdf')




const normalizeBatchId = (batch, index) => {
  if (batch && batch.id != null) {
    return String(batch.id)
  }
  return String(index)
}


const getSourceMeta = (source) => {
  const normalized = String(source || '').toLowerCase()
  if (normalized === 'starter') {
    return {
      label: 'Starter',
      color: 'secondary',
      variant: 'outlined',
      isStarter: true,
    }
  }
  return {
    label: 'Company',
    color: 'default',
    variant: 'outlined',
    isStarter: false,
  }
}


const templatePickerInstances = new Set()
let activeTemplatePickerRoot = null

const hideTemplatePickerRoot = (node) => {
  if (!node) return
  node.setAttribute('aria-hidden', 'true')
  node.setAttribute('data-template-picker-hidden', 'true')
  node.setAttribute('hidden', 'true')
  node.inert = true
}

const showTemplatePickerRoot = (node) => {
  if (!node) return
  node.removeAttribute('aria-hidden')
  node.removeAttribute('data-template-picker-hidden')
  node.removeAttribute('hidden')
  node.inert = false
}

const activateTemplatePickerRoot = (node) => {
  if (!node || activeTemplatePickerRoot === node) return
  if (activeTemplatePickerRoot) {
    hideTemplatePickerRoot(activeTemplatePickerRoot)
  }
  showTemplatePickerRoot(node)
  activeTemplatePickerRoot = node
}

const activateFallbackTemplatePicker = () => {
  const iterator = templatePickerInstances.values().next()
  if (!iterator.done) {
    activateTemplatePickerRoot(iterator.value)
    return
  }
  activeTemplatePickerRoot = null
}


const MS_IN_MINUTE = 60 * 1000
const MS_IN_HOUR = 60 * MS_IN_MINUTE
const MS_IN_DAY = 24 * MS_IN_HOUR
const MS_IN_WEEK = 7 * MS_IN_DAY

const DEFAULT_RESAMPLE_CONFIG = {
  dimension: 'time',
  dimensionKind: 'temporal',
  metric: 'rows',
  aggregation: 'sum',
  bucket: 'auto',
  range: null,
}

const RESAMPLE_DIMENSION_OPTIONS = [
  { value: 'time', label: 'Time', kind: 'temporal', bucketable: true },
  { value: 'category', label: 'Category', kind: 'categorical', bucketable: false },
  { value: 'batch_index', label: 'Discovery order', kind: 'numeric', bucketable: true },
]

const RESAMPLE_METRIC_OPTIONS = [
  { value: 'rows', label: 'Rows' },
  { value: 'rows_per_parent', label: 'Rows per parent' },
  { value: 'parent', label: 'Parent rows' },
]

const RESAMPLE_AGGREGATION_OPTIONS = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
]

const RESAMPLE_BUCKET_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'minute', label: 'Minute' },
  { value: 'hour', label: 'Hour' },
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

const RESAMPLE_NUMERIC_BUCKET_OPTIONS = [
  { value: 'auto', label: 'Auto (10 buckets)' },
  { value: '5', label: '5 buckets' },
  { value: '10', label: '10 buckets' },
  { value: '20', label: '20 buckets' },
]

const RESAMPLE_UNCATEGORIZED_LABEL = 'Uncategorized'

const clampBrushRange = (range, maxIndex) => {
  if (!Array.isArray(range) || range.length !== 2 || maxIndex < 0) return null
  const start = Math.max(0, Math.min(maxIndex, Number(range[0]) || 0))
  const endRaw = Number(range[1])
  const end = Math.max(start, Math.min(maxIndex, Number.isFinite(endRaw) ? endRaw : maxIndex))
  return [start, end]
}

const resolveTimeBucket = (metrics, requestedBucket) => {
  if (requestedBucket && requestedBucket !== 'auto') return requestedBucket
  const timestamps = (Array.isArray(metrics) ? metrics : [])
    .map((entry) => Date.parse(entry?.time ?? entry?.timestamp ?? ''))
    .filter((value) => !Number.isNaN(value))
  if (!timestamps.length) return 'day'
  const span = Math.max(...timestamps) - Math.min(...timestamps)
  if (span > 120 * MS_IN_DAY) return 'month'
  if (span > 35 * MS_IN_DAY) return 'week'
  if (span > 7 * MS_IN_DAY) return 'day'
  if (span > 6 * MS_IN_HOUR) return 'hour'
  return 'minute'
}

const truncateTimestampToBucket = (timestamp, bucket) => {
  if (timestamp == null) return null
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  if (bucket === 'month') {
    return new Date(date.getFullYear(), date.getMonth(), 1).setHours(0, 0, 0, 0)
  }
  if (bucket === 'week') {
    const day = date.getDay()
    const diff = date.getDate() - day
    return new Date(date.getFullYear(), date.getMonth(), diff).setHours(0, 0, 0, 0)
  }
  if (bucket === 'day') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).setHours(0, 0, 0, 0)
  }
  if (bucket === 'hour') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).setMinutes(0, 0, 0)
  }
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ).setSeconds(0, 0)
}

const formatBucketLabel = (timestamp, bucket) => {
  if (timestamp == null) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  if (bucket === 'month') {
    return date.toLocaleString(undefined, { month: 'short', year: 'numeric' })
  }
  if (bucket === 'week' || bucket === 'day') {
    return date.toLocaleDateString()
  }
  if (bucket === 'hour') {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
    })
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const collectIdsFromSeries = (series, range) => {
  const ids = new Set()
  if (!Array.isArray(series) || !Array.isArray(range)) return ids
  for (let idx = range[0]; idx <= range[1] && idx < series.length; idx += 1) {
    const bucket = series[idx]
    if (!bucket) continue
    const batchIds = Array.isArray(bucket.batchIds) ? bucket.batchIds : []
    batchIds.forEach((id) => ids.add(String(id)))
  }
  return ids
}

const buildResampleComputation = (
  metrics,
  config = DEFAULT_RESAMPLE_CONFIG,
  numericBins = {},
  categoryGroups = {},
) => {
  const safeMetrics = Array.isArray(metrics) ? metrics : []
  const dimension = config?.dimension || DEFAULT_RESAMPLE_CONFIG.dimension
  let dimensionKind = config?.dimensionKind || DEFAULT_RESAMPLE_CONFIG.dimensionKind
  if (!config?.dimensionKind) {
    if (dimension === 'time') {
      dimensionKind = 'temporal'
    } else if (dimension === 'category') {
      dimensionKind = 'categorical'
    } else {
      dimensionKind = 'numeric'
    }
  }
  const metricKey = config?.metric || DEFAULT_RESAMPLE_CONFIG.metric
  const aggregation = config?.aggregation || DEFAULT_RESAMPLE_CONFIG.aggregation
  const bucketSelection = config?.bucket || DEFAULT_RESAMPLE_CONFIG.bucket
  const resolvedBucket =
    dimensionKind === 'temporal' || dimension === 'time'
      ? resolveTimeBucket(safeMetrics, bucketSelection)
      : 'none'
  const groupsMap = new Map()

  if (dimensionKind === 'categorical' && Array.isArray(categoryGroups?.[dimension])) {
    const precomputed = categoryGroups[dimension]
    const series = precomputed
      .map((entry, idx) => {
        const key = entry?.key ?? entry?.label ?? `cat:${idx}`
        const label = entry?.label ?? key
        const value = Number(entry?.value) || 0
        const batchIds = Array.isArray(entry?.batch_ids) ? entry.batch_ids.map((id) => String(id)) : []
        const sortValue = typeof entry?.sortValue === 'number' ? entry.sortValue : label.toLowerCase()
        return { key, label, value, sortValue, batchIds }
      })
      .filter((entry) => entry.key)
    series.sort((a, b) => {
      if (typeof a.sortValue === 'number' && typeof b.sortValue === 'number') return a.sortValue - b.sortValue
      return String(a.sortValue).localeCompare(String(b.sortValue))
    })
    const maxIndex = series.length - 1
    const hasUserRange = Array.isArray(config?.range) && config.range.length === 2
    const clampedRange = clampBrushRange(hasUserRange ? config.range : [0, maxIndex], maxIndex) ?? [0, maxIndex]
    const coversAll = clampedRange[0] === 0 && clampedRange[1] === maxIndex
    const filterActive = hasUserRange && !coversAll
    const allowedIds = filterActive ? collectIdsFromSeries(series, clampedRange) : null
    return {
      series,
      resolvedBucket: 'none',
      displayRange: clampedRange,
      configRange: filterActive ? clampedRange : null,
      allowedIds,
      filterActive,
    }
  }

  safeMetrics.forEach((entry, idx) => {
    const batchIndexRaw = entry?.batch_index
    const batchIndex = Number.isFinite(Number(batchIndexRaw)) ? Number(batchIndexRaw) : idx + 1
    const batchId = entry?.batch_id ?? entry?.batchId ?? entry?.id ?? batchIndex
    if (batchId == null) return
    const metricValue = Number(entry?.[metricKey]) || 0
    let groupKey = ''
    let sortValue = 0
    let label = ''
    if (dimensionKind === 'temporal' || dimension === 'time') {
      const timestamp = Date.parse(entry?.time ?? entry?.timestamp ?? '')
      if (Number.isNaN(timestamp)) return
      const truncated = truncateTimestampToBucket(timestamp, resolvedBucket)
      if (truncated == null) return
      groupKey = `${resolvedBucket}:${truncated}`
      sortValue = truncated
      label = formatBucketLabel(truncated, resolvedBucket)
    } else if (dimensionKind === 'categorical' || dimension === 'category') {
      const category = entry?.category != null && String(entry.category).trim().length
        ? String(entry.category)
        : RESAMPLE_UNCATEGORIZED_LABEL
      groupKey = `cat:${category}`
      sortValue = category.toLowerCase()
      label = category
    } else if (dimensionKind === 'numeric') {
      const value = Number(entry?.[dimension])
      if (!Number.isFinite(value)) return
      const bucketCount = bucketSelection && bucketSelection !== 'auto' ? Number(bucketSelection) || 10 : 10
      // Build bucket edges lazily based on min/max
      const existing = groupsMap.get('__numeric_meta__') || { key: '__numeric_meta__', min: value, max: value }
      existing.min = Math.min(existing.min, value)
      existing.max = Math.max(existing.max, value)
      existing.bucketCount = bucketCount
      groupsMap.set('__numeric_meta__', existing)
      groupKey = `num:${value}`
      sortValue = value
      label = value.toString()
    } else {
      groupKey = `idx:${batchIndex}`
      sortValue = batchIndex
      label = `Batch ${batchIndex}`
    }
    const existing = groupsMap.get(groupKey) || {
      key: groupKey,
      label,
      sortValue,
      sum: 0,
      count: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      batchIds: new Set(),
    }
    existing.sum += metricValue
    existing.count += 1
    existing.min = Math.min(existing.min, metricValue)
    existing.max = Math.max(existing.max, metricValue)
    existing.batchIds.add(String(batchId))
    groupsMap.set(groupKey, existing)
  })

  const series = Array.from(groupsMap.values())
    .map((entry) => {
      if (entry.key === '__numeric_meta__' || !entry.batchIds) {
        return null
      }
      let value = entry.sum
      if (aggregation === 'avg') {
        value = entry.count ? entry.sum / entry.count : 0
      } else if (aggregation === 'max') {
        value = entry.max === Number.NEGATIVE_INFINITY ? 0 : entry.max
      } else if (aggregation === 'min') {
        value = entry.min === Number.POSITIVE_INFINITY ? 0 : entry.min
      }
      return {
        key: entry.key,
        label: entry.label,
        value,
        sortValue: entry.sortValue,
        batchIds: Array.from(entry.batchIds),
      }
    })
    .sort((a, b) => {
      if (!a || !b) return 0
      if (typeof a.sortValue === 'number' && typeof b.sortValue === 'number') {
        return a.sortValue - b.sortValue
      }
      return String(a.sortValue).localeCompare(String(b.sortValue))
    })
    .filter(Boolean)

  if (dimensionKind === 'numeric') {
    const binsForDimension = Array.isArray(numericBins?.[dimension]) ? numericBins[dimension] : null
    const meta = groupsMap.get('__numeric_meta__') || {}
    const bucketCount = meta?.bucketCount || 10
    const requestedBinCount = bucketSelection && bucketSelection !== 'auto' ? Number(bucketSelection) || null : null
    const numericEntries = safeMetrics
      .map((entry, idxMetric) => ({
        value: Number(entry?.[dimension]),
        batchId: entry?.batch_id ?? entry?.id ?? idxMetric + 1,
      }))
      .filter((item) => Number.isFinite(item.value))
    const canUseBackendBins =
      binsForDimension &&
      metricKey === dimension &&
      (!requestedBinCount || requestedBinCount === binsForDimension.length)
    if (canUseBackendBins) {
      const aggregated = binsForDimension.map((bucket, idx) => {
        const count = Number(bucket?.count) || 0
        const sum = Number(bucket?.sum) || 0
        const min = Number.isFinite(bucket?.min) ? Number(bucket.min) : 0
        const max = Number.isFinite(bucket?.max) ? Number(bucket.max) : 0
        let value = sum
        if (aggregation === 'avg') {
          value = count ? sum / count : 0
        } else if (aggregation === 'count') {
          value = count
        } else if (aggregation === 'max') {
          value = max
        } else if (aggregation === 'min') {
          value = min
        }
        const startRaw = Number(bucket?.start)
        const endRaw = Number(bucket?.end)
        const start = Number.isFinite(startRaw) ? startRaw : idx
        const end = Number.isFinite(endRaw) ? endRaw : idx + 1
        return {
          key: `bin:${idx}`,
          label: `${start} - ${end}`,
          value,
          sortValue: start,
          batchIds: Array.isArray(bucket?.batch_ids) ? bucket.batch_ids.map((id) => String(id)) : [],
        }
      })
      aggregated.sort((a, b) => a.sortValue - b.sortValue)
      const maxIndex = aggregated.length - 1
      const hasUserRange = Array.isArray(config?.range) && config.range.length === 2
      const clampedRange =
        clampBrushRange(hasUserRange ? config.range : [0, maxIndex], maxIndex) ?? [0, maxIndex]
      const coversAll = clampedRange[0] === 0 && clampedRange[1] === maxIndex
      const filterActive = hasUserRange && !coversAll
      const allowedIds = filterActive ? collectIdsFromSeries(aggregated, clampedRange) : null
      return {
        series: aggregated,
        resolvedBucket: bucketSelection || 'auto',
        displayRange: clampedRange,
        configRange: filterActive ? clampedRange : null,
        allowedIds,
        filterActive,
      }
    }

    if (numericEntries.length) {
      const min = meta?.min ?? Math.min(...numericEntries.map((e) => e.value))
      const max = meta?.max ?? Math.max(...numericEntries.map((e) => e.value))
      const step = bucketCount > 0 ? (max - min) / bucketCount : 0
      const buckets = []
      for (let i = 0; i < bucketCount; i += 1) {
        const start = min + step * i
        const end = i === bucketCount - 1 ? max : min + step * (i + 1)
        buckets.push({
          key: `bucket:${i}`,
          label: `${start.toFixed(2)} - ${end.toFixed(2)}`,
          sortValue: start,
          sum: 0,
          count: 0,
          min: Number.POSITIVE_INFINITY,
          max: Number.NEGATIVE_INFINITY,
          batchIds: new Set(),
        })
      }
      numericEntries.forEach(({ value, batchId }) => {
        let target = 0
        if (step > 0) {
          const pos = Math.floor((value - min) / step)
          target = Math.min(bucketCount - 1, Math.max(0, pos))
        }
        const bucket = buckets[target]
        bucket.sum += value
        bucket.count += 1
        bucket.min = Math.min(bucket.min, value)
        bucket.max = Math.max(bucket.max, value)
        if (batchId != null) bucket.batchIds.add(String(batchId))
      })
      const aggregated = buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        value:
          aggregation === 'avg'
            ? bucket.count
              ? bucket.sum / bucket.count
              : 0
            : aggregation === 'max'
              ? bucket.max === Number.NEGATIVE_INFINITY
                ? 0
                : bucket.max
              : aggregation === 'min'
                ? bucket.min === Number.POSITIVE_INFINITY
                  ? 0
                  : bucket.min
                : aggregation === 'count'
                  ? bucket.count
                  : bucket.sum,
        sortValue: bucket.sortValue,
        batchIds: Array.from(bucket.batchIds),
      }))
      aggregated.sort((a, b) => a.sortValue - b.sortValue)
      const maxIndex = aggregated.length - 1
      const hasUserRange = Array.isArray(config?.range) && config.range.length === 2
      const clampedRange =
        clampBrushRange(hasUserRange ? config.range : [0, maxIndex], maxIndex) ?? [0, maxIndex]
      const coversAll = clampedRange[0] === 0 && clampedRange[1] === maxIndex
      const filterActive = hasUserRange && !coversAll
      const allowedIds = filterActive ? collectIdsFromSeries(aggregated, clampedRange) : null
      return {
        series: aggregated,
        resolvedBucket: bucketSelection || 'auto',
        displayRange: clampedRange,
        configRange: filterActive ? clampedRange : null,
        allowedIds,
        filterActive,
      }
    }
  }

  if (!series.length) {
    return {
      series,
      resolvedBucket,
      displayRange: null,
      configRange: null,
      allowedIds: null,
      filterActive: false,
    }
  }

  const maxIndex = series.length - 1
  const hasUserRange = Array.isArray(config?.range) && config.range.length === 2
  const clampedRange = clampBrushRange(hasUserRange ? config.range : [0, maxIndex], maxIndex) ?? [0, maxIndex]
  const coversAll = clampedRange[0] === 0 && clampedRange[1] === maxIndex
  const filterActive = hasUserRange && !coversAll
  const allowedIds = filterActive ? collectIdsFromSeries(series, clampedRange) : null

  return {
    series,
    resolvedBucket,
    displayRange: clampedRange,
    configRange: filterActive ? clampedRange : null,
    allowedIds,
    filterActive,
  }
}

// generateFeatureUtils convenience re-exports are now inlined above

// === From: hooks.js ===
/**
 * Generate Feature Hooks
 * Merged from: useEditorDraft.js, useEditorKeyboardShortcuts.js, useSavedCharts.js
 */


const DRAFT_PREFIX = 'neura-template-draft-'
const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Hook for auto-saving template drafts to localStorage.
 *
 * Features:
 * - Auto-saves drafts periodically when content changes
 * - Detects and restores unsaved drafts on load
 * - Cleans up old/expired drafts
 * - Provides manual save/discard controls
 */
function useEditorDraft(templateId, { autoSaveInterval = 10000, enabled = true } = {}) {
  const [hasDraft, setHasDraft] = useState(false)
  const [draftData, setDraftData] = useState(null)
  const [lastSaved, setLastSaved] = useState(null)
  const autoSaveTimerRef = useRef(null)
  const pendingContentRef = useRef(null)

  const storageKey = `${DRAFT_PREFIX}${templateId}`

  // Load draft on mount
  useEffect(() => {
    if (!templateId || !enabled) return

    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = JSON.parse(stored)
        const age = Date.now() - (parsed.savedAt || 0)

        if (age < DRAFT_EXPIRY_MS) {
          setHasDraft(true)
          setDraftData(parsed)
        } else {
          // Expired draft, clean up
          localStorage.removeItem(storageKey)
        }
      }
    } catch (err) {
      console.warn('Failed to load draft:', err)
    }
  }, [templateId, storageKey, enabled])

  // Clean up old drafts on mount
  useEffect(() => {
    if (!enabled) return

    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(DRAFT_PREFIX))
      keys.forEach((key) => {
        try {
          const stored = localStorage.getItem(key)
          if (stored) {
            const parsed = JSON.parse(stored)
            const age = Date.now() - (parsed.savedAt || 0)
            if (age >= DRAFT_EXPIRY_MS) {
              localStorage.removeItem(key)
            }
          }
        } catch {
          // Invalid draft, remove it
          localStorage.removeItem(key)
        }
      })
    } catch (err) {
      console.warn('Failed to clean up drafts:', err)
    }
  }, [enabled])

  // Save draft to localStorage
  const saveDraft = useCallback(
    (html, instructions = '') => {
      if (!templateId || !enabled) return false

      try {
        const draft = {
          html,
          instructions,
          savedAt: Date.now(),
          templateId,
        }
        localStorage.setItem(storageKey, JSON.stringify(draft))
        setLastSaved(new Date())
        return true
      } catch (err) {
        console.warn('Failed to save draft:', err)
        return false
      }
    },
    [templateId, storageKey, enabled]
  )

  // Discard draft
  const discardDraft = useCallback(() => {
    if (!templateId) return

    try {
      localStorage.removeItem(storageKey)
      setHasDraft(false)
      setDraftData(null)
    } catch (err) {
      console.warn('Failed to discard draft:', err)
    }
  }, [templateId, storageKey])

  // Auto-save with debounce
  const scheduleAutoSave = useCallback(
    (html, instructions = '') => {
      if (!enabled) return

      pendingContentRef.current = { html, instructions }

      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }

      autoSaveTimerRef.current = setTimeout(() => {
        if (pendingContentRef.current) {
          saveDraft(pendingContentRef.current.html, pendingContentRef.current.instructions)
        }
      }, autoSaveInterval)
    },
    [enabled, autoSaveInterval, saveDraft]
  )

  // Flush pending draft and cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
      // Flush any pending content before unmount
      if (pendingContentRef.current) {
        try {
          const draft = {
            html: pendingContentRef.current.html,
            instructions: pendingContentRef.current.instructions,
            savedAt: Date.now(),
            templateId,
          }
          localStorage.setItem(storageKey, JSON.stringify(draft))
        } catch {
          // Best-effort flush on unmount
        }
      }
    }
  }, [templateId, storageKey])

  // Clear draft when it's been applied (i.e., saved to server)
  const clearDraftAfterSave = useCallback(() => {
    discardDraft()
  }, [discardDraft])

  return {
    // State
    hasDraft,
    draftData,
    lastSaved,

    // Actions
    saveDraft,
    discardDraft,
    scheduleAutoSave,
    clearDraftAfterSave,
  }
}


/**
 * Hook for handling keyboard shortcuts in the template editor.
 *
 * Shortcuts:
 * - Ctrl/Cmd + S: Save
 * - Ctrl/Cmd + Z: Undo
 * - Ctrl/Cmd + Shift + Z: Redo (future)
 * - Ctrl/Cmd + Enter: Apply AI (when in manual mode with instructions)
 * - Escape: Close dialog/modal
 */
function useEditorKeyboardShortcuts({
  onSave,
  onUndo,
  onRedo,
  onApplyAi,
  onEscape,
  enabled = true,
  dirty = false,
  hasInstructions = false,
}) {
  const handleKeyDown = useCallback(
    (event) => {
      if (!enabled) return

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      const modKey = isMac ? event.metaKey : event.ctrlKey
      const shiftKey = event.shiftKey

      // Ctrl/Cmd + S: Save
      if (modKey && event.key === 's') {
        event.preventDefault()
        if (dirty && onSave) {
          onSave()
        }
        return
      }

      // Ctrl/Cmd + Z: Undo (without shift)
      if (modKey && event.key === 'z' && !shiftKey) {
        event.preventDefault()
        if (onUndo) {
          onUndo()
        }
        return
      }

      // Ctrl/Cmd + Shift + Z: Redo
      if (modKey && event.key === 'z' && shiftKey) {
        event.preventDefault()
        if (onRedo) {
          onRedo()
        }
        return
      }

      // Ctrl/Cmd + Enter: Apply AI
      if (modKey && event.key === 'Enter' && hasInstructions) {
        event.preventDefault()
        if (onApplyAi) {
          onApplyAi()
        }
        return
      }

      // Escape: Close dialog/cancel
      if (event.key === 'Escape') {
        if (onEscape) {
          onEscape()
        }
        return
      }
    },
    [enabled, dirty, hasInstructions, onSave, onUndo, onRedo, onApplyAi, onEscape]
  )

  useEffect(() => {
    if (!enabled) return

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled, handleKeyDown])
}

/**
 * Get keyboard shortcut display string based on platform.
 */
export function getShortcutDisplay(shortcut) {
  const isMac =
    typeof navigator !== 'undefined' &&
    navigator.platform.toUpperCase().indexOf('MAC') >= 0

  const modKey = isMac ? '⌘' : 'Ctrl'

  const shortcuts = {
    save: `${modKey}+S`,
    undo: `${modKey}+Z`,
    redo: `${modKey}+Shift+Z`,
    applyAi: `${modKey}+Enter`,
  }

  return shortcuts[shortcut] || shortcut
}

const EDITOR_SHORTCUTS = [
  { key: 'save', label: 'Save HTML', description: 'Save current changes' },
  { key: 'undo', label: 'Undo', description: 'Revert to previous version' },
  { key: 'applyAi', label: 'Apply AI', description: 'Apply AI instructions (when filled)' },
]


function useSavedCharts({ templateId, templateKind }) {
  const [savedCharts, setSavedCharts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const reset = useCallback(() => {
    setSavedCharts([])
    setLoading(false)
    setError(null)
  }, [])

  const fetchSavedCharts = useCallback(() => {
    if (!templateId) {
      reset()
      return
    }
    const currentTemplate = templateId
    setLoading(true)
    setError(null)
    listSavedChartsRequest({ templateId: currentTemplate, kind: templateKind })
      .then((charts) => {
        if (currentTemplate === templateId) {
          setSavedCharts(charts)
        }
      })
      .catch((err) => {
        if (currentTemplate === templateId) {
          setError(err?.message || 'Failed to load saved charts.')
        }
      })
      .finally(() => {
        if (currentTemplate === templateId) {
          setLoading(false)
        }
      })
  }, [reset, templateId, templateKind])

  useEffect(() => {
    fetchSavedCharts()
  }, [fetchSavedCharts])

  const createSavedChart = useCallback(
    async ({ name, spec }) => {
      if (!templateId) throw new Error('No template selected')
      const created = await createSavedChartRequest({
        templateId,
        name,
        spec,
        kind: templateKind,
      })
      setSavedCharts((prev) => [...prev, created])
      return created
    },
    [templateId, templateKind],
  )

  const renameSavedChart = useCallback(
    async ({ chartId, name }) => {
      if (!templateId) throw new Error('No template selected')
      const updated = await updateSavedChartRequest({
        templateId,
        chartId,
        name,
        kind: templateKind,
      })
      setSavedCharts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      return updated
    },
    [templateId, templateKind],
  )

  const deleteSavedChart = useCallback(
    async ({ chartId }) => {
      if (!templateId) throw new Error('No template selected')
      await deleteSavedChartRequest({
        templateId,
        chartId,
        kind: templateKind,
      })
      setSavedCharts((prev) => prev.filter((item) => item.id !== chartId))
    },
    [templateId, templateKind],
  )

  return {
    savedCharts,
    savedChartsLoading: loading,
    savedChartsError: error,
    fetchSavedCharts,
    createSavedChart,
    renameSavedChart,
    deleteSavedChart,
  }
}

// === From: generateApi.js ===

export {
  createSavedChart,
  deleteSavedChart,
  deleteTemplateRequest,
  discoverReports,
  editTemplateAi,
  editTemplateManual,
  exportTemplateZip,
  fetchTemplateKeyOptions,
  getTemplateCatalog,
  getTemplateHtml,
  importTemplateZip,
  isMock,
  listApprovedTemplates,
  listSavedCharts,
  mock,
  recommendTemplates,
  queueRecommendTemplates,
  runReportAsJob,
  suggestCharts,
  undoTemplateEdit,
  updateSavedChart,
  withBase,
}

// === From: editorComponents.jsx ===
/**
 * Editor Components (merged)
 */


function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Unknown time'

  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function DraftRecoveryBanner({
  show,
  draftData,
  onRestore,
  onDiscard,
  restoring = false,
}) {
  if (!show || !draftData) return null

  return (
    <Collapse in={show}>
      <Alert
        severity="info"
        icon={<RestoreIcon />}
        sx={{
          mb: 2,
          borderRadius: 1,  // Figma spec: 8px
          '& .MuiAlert-message': { width: '100%' },
        }}
        action={
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              startIcon={<RestoreIcon />}
              onClick={onRestore}
              disabled={restoring}
            >
              {restoring ? 'Restoring...' : 'Restore'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<DeleteOutlineIcon />}
              onClick={onDiscard}
              disabled={restoring}
            >
              Discard
            </Button>
          </Stack>
        }
      >
        <AlertTitle sx={{ fontWeight: 600 }}>Unsaved Draft Found</AlertTitle>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="body2">
            You have unsaved changes from a previous session.
          </Typography>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <AccessTimeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary">
              {formatTimeAgo(draftData.savedAt)}
            </Typography>
          </Stack>
        </Stack>
      </Alert>
    </Collapse>
  )
}

function AutoSaveIndicator({ lastSaved, dirty }) {
  if (!lastSaved && !dirty) return null

  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      sx={{
        py: 0.5,
        px: 1,
        borderRadius: 1,
        bgcolor: (theme) =>
          dirty
            ? alpha(theme.palette.text.primary, 0.05)
            : alpha(theme.palette.text.primary, 0.05),
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: 'text.secondary',
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {dirty
          ? 'Unsaved changes'
          : lastSaved
          ? `Draft saved ${formatTimeAgo(lastSaved)}`
          : 'All changes saved'}
      </Typography>
    </Stack>
  )
}


const EDIT_TYPE_CONFIG = {
  manual: {
    icon: EditIcon,
    label: 'Manual',
    color: 'default',
  },
  ai: {
    icon: SmartToyIcon,
    label: 'AI',
    color: 'default',
  },
  chat: {
    icon: ChatIcon,
    label: 'Chat AI',
    color: 'default',
  },
  undo: {
    icon: UndoIcon,
    label: 'Undo',
    color: 'default',
  },
  default: {
    icon: HistoryIcon,
    label: 'Edit',
    color: 'default',
  },
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'Unknown time'

  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function HistoryEntry({ entry, isLatest }) {
  const config = EDIT_TYPE_CONFIG[entry.type] || EDIT_TYPE_CONFIG.default
  const Icon = config.icon

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        py: 1,
        px: 1.5,
        borderRadius: 1,
        bgcolor: isLatest ? (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50] : 'transparent',
        '&:hover': {
          bgcolor: 'action.hover',
        },
      }}
    >
      {/* Timeline indicator */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pt: 0.5,
        }}
      >
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            sx={{
              fontSize: 16,
              color: 'text.secondary',
            }}
          />
        </Box>
        <Box
          sx={{
            width: 2,
            flex: 1,
            mt: 0.5,
            bgcolor: 'divider',
            minHeight: 8,
          }}
        />
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
          <Chip
            label={config.label}
            size="small"
            variant="outlined"
            sx={{
              height: 20,
              fontSize: '12px',
              borderColor: (theme) => alpha(theme.palette.divider, 0.3),
              color: 'text.secondary',
            }}
          />
          {isLatest && (
            <Chip
              label="Latest"
              size="small"
              sx={{
                height: 20,
                fontSize: '12px',
                bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
                color: 'common.white',
              }}
            />
          )}
        </Stack>

        {entry.notes && (
          <Typography
            variant="body2"
            color="text.primary"
            sx={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}
          >
            {entry.notes}
          </Typography>
        )}

        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
          <AccessTimeIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
          <Typography variant="caption" color="text.disabled">
            {formatRelativeTime(entry.timestamp)}
          </Typography>
        </Stack>
      </Box>
    </Box>
  )
}

const MAX_HISTORY_ENTRIES = 500

function EditHistoryTimeline({ history = [], maxVisible = 5 }) {
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState('all')

  const filteredHistory = useMemo(() => {
    if (!Array.isArray(history)) return []
    // Cap to prevent rendering unbounded entries
    const capped = history.length > MAX_HISTORY_ENTRIES
      ? history.slice(-MAX_HISTORY_ENTRIES)
      : history
    let filtered = [...capped].reverse() // Most recent first
    if (filter !== 'all') {
      filtered = filtered.filter((entry) => entry.type === filter)
    }
    return filtered
  }, [history, filter])

  const visibleHistory = expanded
    ? filteredHistory
    : filteredHistory.slice(0, maxVisible)

  const hasMore = filteredHistory.length > maxVisible

  const editTypes = useMemo(() => {
    const types = new Set(['all'])
    history.forEach((entry) => {
      if (entry.type) types.add(entry.type)
    })
    return Array.from(types)
  }, [history])

  if (!history || history.length === 0) {
    return (
      <Box sx={{ py: 2, px: 1.5, textAlign: 'center' }}>
        <HistoryIcon sx={{ fontSize: 32, color: 'text.disabled', mb: 1 }} />
        <Typography variant="body2" color="text.secondary">
          No edit history yet
        </Typography>
        <Typography variant="caption" color="text.disabled">
          Your changes will appear here
        </Typography>
      </Box>
    )
  }

  return (
    <Box>
      {/* Header with filter */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 1 }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center">
          <HistoryIcon fontSize="small" color="action" />
          <Typography variant="subtitle2">
            History
          </Typography>
          <Chip
            label={filteredHistory.length}
            size="small"
            sx={{ height: 18, fontSize: '12px' }}
          />
        </Stack>

        {editTypes.length > 2 && (
          <ToggleButtonGroup
            size="small"
            value={filter}
            exclusive
            onChange={(e, v) => v && setFilter(v)}
            sx={{
              '& .MuiToggleButton-root': {
                py: 0.25,
                px: 0.75,
                fontSize: '12px',
              },
            }}
          >
            <ToggleButton value="all">
              <Tooltip title="All edits">
                <FilterListIcon sx={{ fontSize: 14 }} />
              </Tooltip>
            </ToggleButton>
            {editTypes.filter((t) => t !== 'all').map((type) => {
              const config = EDIT_TYPE_CONFIG[type] || EDIT_TYPE_CONFIG.default
              const TypeIcon = config.icon
              return (
                <ToggleButton key={type} value={type}>
                  <Tooltip title={config.label}>
                    <TypeIcon sx={{ fontSize: 14 }} />
                  </Tooltip>
                </ToggleButton>
              )
            })}
          </ToggleButtonGroup>
        )}
      </Stack>

      {/* Timeline */}
      <Box
        sx={{
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflow: 'hidden',
        }}
      >
        {visibleHistory.map((entry, idx) => (
          <HistoryEntry
            key={`${entry.timestamp}-${idx}`}
            entry={entry}
            isLatest={idx === 0}
          />
        ))}

        {/* Show more / less */}
        {hasMore && (
          <Box
            sx={{
              borderTop: '1px solid',
              borderColor: 'divider',
              py: 0.75,
              textAlign: 'center',
            }}
          >
            <IconButton
              size="small"
              onClick={() => setExpanded(!expanded)}
              sx={{ fontSize: '12px' }}
            >
              {expanded ? (
                <>
                  <ExpandLessIcon fontSize="small" />
                  <Typography variant="caption" sx={{ ml: 0.5 }}>
                    Show less
                  </Typography>
                </>
              ) : (
                <>
                  <ExpandMoreIcon fontSize="small" />
                  <Typography variant="caption" sx={{ ml: 0.5 }}>
                    Show {filteredHistory.length - maxVisible} more
                  </Typography>
                </>
              )}
            </IconButton>
          </Box>
        )}
      </Box>
    </Box>
  )
}


function EditorSkeleton({ mode = 'manual' }) {
  return (
    <Grid container spacing={2.5} sx={{ alignItems: 'stretch' }}>
      {/* Preview Panel */}
      <Grid size={{ xs: 12, md: mode === 'chat' ? 5 : 6 }} sx={{ minWidth: 0 }}>
        <Stack spacing={1.5} sx={{ height: '100%' }}>
          <Skeleton variant="text" width={80} height={28} />
          <Box
            sx={{
              borderRadius: 1.5,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              p: 1.5,
              minHeight: mode === 'chat' ? 400 : 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Skeleton
              variant="rectangular"
              width="80%"
              height={mode === 'chat' ? 350 : 180}
              sx={{ borderRadius: 1 }}
            />
          </Box>
          <Skeleton variant="text" width={150} height={20} />
        </Stack>
      </Grid>

      {/* Editor Panel */}
      <Grid size={{ xs: 12, md: mode === 'chat' ? 7 : 6 }} sx={{ minWidth: 0 }}>
        {mode === 'chat' ? (
          <Box
            sx={{
              height: 600,
              borderRadius: 1,  // Figma spec: 8px
              border: '1px solid',
              borderColor: 'divider',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Chat header skeleton */}
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton variant="text" width={180} height={28} />
              <Skeleton variant="text" width={250} height={18} />
            </Box>

            {/* Chat messages skeleton */}
            <Box sx={{ flex: 1, p: 2 }}>
              <Stack spacing={2}>
                {[1, 2, 3].map((i) => (
                  <Stack key={i} direction="row" spacing={1.5}>
                    <Skeleton variant="circular" width={32} height={32} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" width={80} height={18} />
                      <Skeleton
                        variant="rectangular"
                        width="80%"
                        height={60}
                        sx={{ borderRadius: 1, mt: 0.5 }}
                      />
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Box>

            {/* Chat input skeleton */}
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Skeleton variant="rectangular" height={56} sx={{ borderRadius: 1 }} />
            </Box>
          </Box>
        ) : (
          <Stack spacing={1.5} sx={{ height: '100%' }}>
            <Skeleton variant="text" width={150} height={28} />

            {/* HTML textarea skeleton */}
            <Skeleton
              variant="rectangular"
              height={260}
              sx={{ borderRadius: 1 }}
            />

            {/* AI instructions skeleton */}
            <Skeleton
              variant="rectangular"
              height={100}
              sx={{ borderRadius: 1 }}
            />

            {/* Buttons skeleton */}
            <Stack direction="row" spacing={1.5}>
              <Skeleton variant="rectangular" width={100} height={36} sx={{ borderRadius: 1 }} />
              <Skeleton variant="rectangular" width={120} height={36} sx={{ borderRadius: 1 }} />
              <Skeleton variant="rectangular" width={130} height={36} sx={{ borderRadius: 1 }} />
              <Skeleton variant="rectangular" width={90} height={36} sx={{ borderRadius: 1 }} />
            </Stack>

            <Skeleton variant="text" width={350} height={18} />

            {/* History skeleton */}
            <Box>
              <Skeleton variant="text" width={80} height={24} />
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} variant="text" width={`${90 - i * 10}%`} height={18} />
                ))}
              </Stack>
            </Box>
          </Stack>
        )}
      </Grid>
    </Grid>
  )
}


function ShortcutKey({ children }) {
  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 0.75,
        py: 0.25,
        minWidth: 24,
        height: 22,
        borderRadius: 0.5,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        boxShadow: (theme) => `0 1px 0 ${alpha(theme.palette.common.black, 0.1)}`,
        fontFamily: 'monospace',
        fontSize: '12px',
        fontWeight: 600,
        color: 'text.secondary',
      }}
    >
      {children}
    </Box>
  )
}

function ShortcutDisplay({ shortcutKey }) {
  const display = getShortcutDisplay(shortcutKey)
  const parts = display.split('+')

  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {parts.map((part, idx) => (
        <ShortcutKey key={idx}>{part}</ShortcutKey>
      ))}
    </Stack>
  )
}

function KeyboardShortcutsPanel({ compact = false }) {
  if (compact) {
    return (
      <Stack
        direction="row"
        spacing={2}
        sx={{
          py: 1,
          px: 1.5,
          borderRadius: 1,
          bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
          border: '1px solid',
          borderColor: (theme) => alpha(theme.palette.divider, 0.1),
        }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center">
          <KeyboardIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          <Typography variant="caption" color="text.disabled">
            Shortcuts:
          </Typography>
        </Stack>
        {EDITOR_SHORTCUTS.slice(0, 3).map((shortcut) => (
          <Stack key={shortcut.key} direction="row" spacing={0.5} alignItems="center">
            <ShortcutDisplay shortcutKey={shortcut.key} />
            <Typography variant="caption" color="text.secondary">
              {shortcut.label}
            </Typography>
          </Stack>
        ))}
      </Stack>
    )
  }

  return (
    <Box
      sx={{
        p: 2,
        borderRadius: 1.5,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <KeyboardIcon fontSize="small" color="action" />
        <Typography variant="subtitle2">Keyboard Shortcuts</Typography>
      </Stack>

      <Stack spacing={1.5}>
        {EDITOR_SHORTCUTS.map((shortcut) => (
          <Stack
            key={shortcut.key}
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Box>
              <Typography variant="body2">{shortcut.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {shortcut.description}
              </Typography>
            </Box>
            <ShortcutDisplay shortcutKey={shortcut.key} />
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}


// HTML escaping for safe dangerouslySetInnerHTML usage
const escapeHtml = (str) =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Simple HTML syntax highlighting
function highlightHtml(text) {
  if (!text) return null

  text = escapeHtml(text)

  // Replace HTML tags
  const highlighted = text
    .replace(/(&lt;|<)(\/?)([\w-]+)/g, (match, bracket, slash, tag) => {
      return `<span class="html-bracket">&lt;</span><span class="html-slash">${slash}</span><span class="html-tag">${tag}</span>`
    })
    .replace(/(\s)([\w-]+)(=)/g, (match, space, attr, eq) => {
      return `${space}<span class="html-attr">${attr}</span><span class="html-eq">=</span>`
    })
    .replace(/("[^"]*"|'[^']*')/g, '<span class="html-string">$1</span>')
    .replace(/(>)/g, '<span class="html-bracket">$1</span>')
    .replace(/(\{[^}]+\})/g, '<span class="html-token">$1</span>')

  return <span dangerouslySetInnerHTML={{ __html: sanitizeCodeHighlight(highlighted) }} />
}

// Compute diff using LCS algorithm for better accuracy
function computeDiff(beforeText, afterText, contextLines = 3) {
  const beforeLines = (beforeText || '').split('\n')
  const afterLines = (afterText || '').split('\n')

  const result = []
  let beforeIdx = 0
  let afterIdx = 0

  // Simple line-by-line diff
  const maxLen = Math.max(beforeLines.length, afterLines.length)

  let unchangedStart = null
  const unchangedBuffer = []

  for (let i = 0; i < maxLen; i++) {
    const beforeLine = beforeLines[i] ?? null
    const afterLine = afterLines[i] ?? null

    if (beforeLine === afterLine && beforeLine !== null) {
      // Unchanged line
      if (unchangedStart === null) {
        unchangedStart = i
      }
      unchangedBuffer.push({
        type: 'unchanged',
        lineNumber: { before: i + 1, after: i + 1 },
        content: beforeLine,
      })
    } else {
      // Flush unchanged buffer with context
      if (unchangedBuffer.length > 0) {
        if (unchangedBuffer.length <= contextLines * 2 + 1) {
          // Show all if small
          result.push(...unchangedBuffer)
        } else {
          // Show context + collapsed
          result.push(...unchangedBuffer.slice(0, contextLines))
          result.push({
            type: 'collapsed',
            count: unchangedBuffer.length - contextLines * 2,
            startLine: unchangedStart + contextLines + 1,
          })
          result.push(...unchangedBuffer.slice(-contextLines))
        }
        unchangedBuffer.length = 0
        unchangedStart = null
      }

      // Handle changed lines
      if (beforeLine !== null && afterLine !== null) {
        result.push({
          type: 'modified',
          lineNumber: { before: i + 1, after: i + 1 },
          beforeContent: beforeLine,
          afterContent: afterLine,
        })
      } else if (beforeLine !== null) {
        result.push({
          type: 'removed',
          lineNumber: { before: i + 1, after: null },
          content: beforeLine,
        })
      } else if (afterLine !== null) {
        result.push({
          type: 'added',
          lineNumber: { before: null, after: i + 1 },
          content: afterLine,
        })
      }
    }
  }

  // Flush remaining unchanged
  if (unchangedBuffer.length > 0) {
    if (unchangedBuffer.length <= contextLines) {
      result.push(...unchangedBuffer)
    } else {
      result.push(...unchangedBuffer.slice(0, contextLines))
      if (unchangedBuffer.length > contextLines) {
        result.push({
          type: 'collapsed',
          count: unchangedBuffer.length - contextLines,
          startLine: unchangedStart + contextLines + 1,
        })
      }
    }
  }

  return result
}

function DiffLine({ item, viewMode, expanded, onToggleExpand, syntaxHighlight }) {
  const lineNumberSx = {
    width: 48,
    minWidth: 48,
    px: 1,
    py: 0.5,
    bgcolor: 'action.hover',
    color: 'text.disabled',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    textAlign: 'right',
    userSelect: 'none',
    borderRight: '1px solid',
    borderColor: 'divider',
  }

  const contentSx = {
    flex: 1,
    px: 1.5,
    py: 0.5,
    fontFamily: 'monospace',
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    minHeight: 24,
    '& .html-tag': { color: secondary.cyan[600] },
    '& .html-attr': { color: secondary.teal[500] },
    '& .html-string': { color: secondary.rose[400] },
    '& .html-bracket': { color: neutral[500] },
    '& .html-slash': { color: neutral[500] },
    '& .html-eq': { color: neutral[300] },
    '& .html-token': { color: secondary.emerald[400], fontWeight: 600 },
  }

  if (item.type === 'collapsed') {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 0.5,
          px: 2,
          bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
          borderTop: '1px dashed',
          borderBottom: '1px dashed',
          borderColor: 'divider',
          cursor: 'pointer',
          '&:hover': {
            bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
          },
        }}
        onClick={() => onToggleExpand?.(item.startLine)}
      >
        <UnfoldMoreIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
        <Typography variant="caption" color="text.secondary">
          {item.count} unchanged lines (click to expand)
        </Typography>
      </Box>
    )
  }

  if (item.type === 'unchanged') {
    return (
      <Box sx={{ display: 'flex', bgcolor: 'transparent' }}>
        <Box sx={lineNumberSx}>{item.lineNumber.before}</Box>
        {viewMode === 'split' && <Box sx={lineNumberSx}>{item.lineNumber.after}</Box>}
        <Box sx={contentSx}>
          {syntaxHighlight ? highlightHtml(item.content) : item.content}
        </Box>
      </Box>
    )
  }

  if (item.type === 'removed') {
    return (
      <Box sx={{ display: 'flex', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50] }}>
        <Box sx={{ ...lineNumberSx, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100] }}>
          {item.lineNumber.before}
        </Box>
        {viewMode === 'split' && <Box sx={lineNumberSx} />}
        <Box sx={{ ...contentSx, color: 'text.secondary', textDecoration: 'line-through' }}>
          <RemoveIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
          {syntaxHighlight ? highlightHtml(item.content) : item.content}
        </Box>
      </Box>
    )
  }

  if (item.type === 'added') {
    return (
      <Box sx={{ display: 'flex', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.06) : neutral[200] }}>
        <Box sx={lineNumberSx} />
        {viewMode === 'split' && (
          <Box sx={{ ...lineNumberSx, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200] }}>
            {item.lineNumber.after}
          </Box>
        )}
        <Box sx={{ ...contentSx, color: 'text.primary' }}>
          <AddIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
          {syntaxHighlight ? highlightHtml(item.content) : item.content}
        </Box>
      </Box>
    )
  }

  if (item.type === 'modified') {
    if (viewMode === 'split') {
      return (
        <>
          <Box sx={{ display: 'flex', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50] }}>
            <Box sx={{ ...lineNumberSx, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100] }}>
              {item.lineNumber.before}
            </Box>
            <Box sx={{ ...contentSx, color: 'text.secondary', textDecoration: 'line-through', flex: 0.5 }}>
              {syntaxHighlight ? highlightHtml(item.beforeContent) : item.beforeContent}
            </Box>
            <Box sx={{ ...lineNumberSx, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200] }}>
              {item.lineNumber.after}
            </Box>
            <Box sx={{ ...contentSx, color: 'text.primary', flex: 0.5 }}>
              {syntaxHighlight ? highlightHtml(item.afterContent) : item.afterContent}
            </Box>
          </Box>
        </>
      )
    }

    return (
      <>
        <Box sx={{ display: 'flex', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50] }}>
          <Box sx={{ ...lineNumberSx, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100] }}>
            {item.lineNumber.before}
          </Box>
          <Box sx={{ ...contentSx, color: 'text.secondary', textDecoration: 'line-through' }}>
            <RemoveIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
            {syntaxHighlight ? highlightHtml(item.beforeContent) : item.beforeContent}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.06) : neutral[200] }}>
          <Box sx={{ ...lineNumberSx, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200] }}>
            {item.lineNumber.after}
          </Box>
          <Box sx={{ ...contentSx, color: 'text.primary' }}>
            <AddIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
            {syntaxHighlight ? highlightHtml(item.afterContent) : item.afterContent}
          </Box>
        </Box>
      </>
    )
  }

  return null
}

function EnhancedDiffViewer({ beforeText, afterText, contextLines = 3 }) {
  const [viewMode, setViewMode] = useState('unified') // 'unified' | 'split'
  const [syntaxHighlight, setSyntaxHighlight] = useState(true)
  const [expandedSections, setExpandedSections] = useState(new Set())
  const [currentDiffIndex, setCurrentDiffIndex] = useState(0)

  const diff = useMemo(
    () => computeDiff(beforeText, afterText, contextLines),
    [beforeText, afterText, contextLines]
  )

  const stats = useMemo(() => {
    let added = 0
    let removed = 0
    let modified = 0
    diff.forEach((item) => {
      if (item.type === 'added') added++
      if (item.type === 'removed') removed++
      if (item.type === 'modified') modified++
    })
    return { added, removed, modified, total: added + removed + modified }
  }, [diff])

  const diffIndices = useMemo(() => {
    return diff
      .map((item, idx) => (item.type !== 'unchanged' && item.type !== 'collapsed' ? idx : null))
      .filter((idx) => idx !== null)
  }, [diff])

  const handleToggleExpand = (startLine) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(startLine)) {
        next.delete(startLine)
      } else {
        next.add(startLine)
      }
      return next
    })
  }

  const navigateDiff = (direction) => {
    if (diffIndices.length === 0) return
    let newIndex = currentDiffIndex + direction
    if (newIndex < 0) newIndex = diffIndices.length - 1
    if (newIndex >= diffIndices.length) newIndex = 0
    setCurrentDiffIndex(newIndex)
    // Scroll to the diff - would need ref in real implementation
  }

  if (!beforeText && !afterText) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">No content to compare</Typography>
      </Box>
    )
  }

  if (beforeText === afterText) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">No differences found</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            size="small"
            icon={<AddIcon />}
            label={`+${stats.added}`}
            variant="outlined"
            sx={{ borderColor: (theme) => alpha(theme.palette.divider, 0.3), color: 'text.secondary' }}
          />
          <Chip
            size="small"
            icon={<RemoveIcon />}
            label={`-${stats.removed}`}
            variant="outlined"
            sx={{ borderColor: (theme) => alpha(theme.palette.divider, 0.3), color: 'text.secondary' }}
          />
          {stats.modified > 0 && (
            <Chip
              size="small"
              icon={<CompareArrowsIcon />}
              label={`~${stats.modified}`}
              variant="outlined"
              sx={{ borderColor: (theme) => alpha(theme.palette.divider, 0.3), color: 'text.secondary' }}
            />
          )}
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          {diffIndices.length > 0 && (
            <>
              <Typography variant="caption" color="text.secondary">
                {currentDiffIndex + 1} / {diffIndices.length}
              </Typography>
              <Tooltip title="Previous change">
                <IconButton size="small" onClick={() => navigateDiff(-1)} aria-label="Previous change">
                  <KeyboardArrowUpIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Next change">
                <IconButton size="small" onClick={() => navigateDiff(1)} aria-label="Next change">
                  <KeyboardArrowDownIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}

          <ToggleButtonGroup
            size="small"
            value={viewMode}
            exclusive
            onChange={(e, v) => v && setViewMode(v)}
          >
            <ToggleButton value="unified">
              <Tooltip title="Unified view">
                <UnfoldLessIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="split">
              <Tooltip title="Split view">
                <CompareArrowsIcon fontSize="small" />
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>

      {/* Diff content */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          bgcolor: 'background.default',
          '& > *:nth-of-type(even)': {
            bgcolor: (theme) => alpha(theme.palette.action.hover, 0.3),
          },
        }}
      >
        {diff.map((item, idx) => (
          <DiffLine
            key={idx}
            item={item}
            viewMode={viewMode}
            syntaxHighlight={syntaxHighlight}
            onToggleExpand={handleToggleExpand}
          />
        ))}
      </Box>
    </Box>
  )
}

// === From: SavedChartsPanel.jsx ===

function SavedChartsPanel({
  activeTemplate,
  savedCharts,
  savedChartsLoading,
  savedChartsError,
  selectedChartSource,
  selectedSavedChartId,
  onRetry,
  onSelectSavedChart,
  onRenameSavedChart,
  onDeleteSavedChart,
}) {
  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      {savedChartsLoading && (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading saved charts…
          </Typography>
        </Stack>
      )}
      {savedChartsError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          {savedChartsError}
        </Alert>
      )}
      {!savedChartsLoading && !savedChartsError && savedCharts.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No saved charts yet. Use "Save this chart" after asking AI to pin a favorite configuration.
        </Typography>
      )}
      {!savedChartsLoading && !savedChartsError && savedCharts.length > 0 && (
        <Stack spacing={1}>
          {savedCharts.map((chart) => {
            const spec = chart.spec || {}
            const isSelected = selectedChartSource === 'saved' && selectedSavedChartId === chart.id
            return (
              <Card
                data-testid={`saved-chart-card-${chart.id}`}
                key={chart.id}
                variant={isSelected ? 'outlined' : 'elevation'}
                sx={{
                  borderColor: isSelected ? 'text.secondary' : 'divider',
                  bgcolor: isSelected ? alpha(secondary.violet[500], 0.04) : 'background.paper',
                }}
              >
                <CardActionArea component="div" onClick={() => onSelectSavedChart(chart.id)}>
                  <CardContent>
                    <Stack direction="row" alignItems="flex-start" justifyContent="space-between">
                      <Typography variant="subtitle2" sx={{ pr: 1 }}>
                        {chart.name || 'Saved chart'}
                      </Typography>
                      <Stack direction="row" spacing={0.5}>
                        <IconButton
                          size="small"
                          aria-label="Rename saved chart"
                          onClick={(event) => onRenameSavedChart(event, chart)}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label="Delete saved chart"
                          onClick={(event) => onDeleteSavedChart(event, chart)}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        label={spec.type || 'chart'}
                        variant="outlined"
                        sx={{ textTransform: 'capitalize' }}
                      />
                      {spec.chartTemplateId && (
                        <Chip size="small" label={`From template: ${spec.chartTemplateId}`} variant="outlined" />
                      )}
                      {!spec.chartTemplateId && <Chip size="small" label="Custom" variant="outlined" />}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}

// === From: GenerateAndDownload.jsx ===

const buildFallbackChartsFromSample = (sampleData) => {
  if (!Array.isArray(sampleData) || !sampleData.length) return []
  const firstEntry = sampleData.find((item) => item && typeof item === 'object') || {}
  const keys = Object.keys(firstEntry)
  if (!keys.length) return []
  const preferredX =
    keys.find((key) =>
      ['label', 'bucket', 'bucket_label', 'bucketLabel', 'batch_index', 'batch_id', 'category'].includes(key),
    ) || keys[0]
  const numericKeys = keys.filter((key) => Number.isFinite(Number(firstEntry[key])))
  const preferredY =
    numericKeys.find((key) => key !== preferredX) ||
    numericKeys[0] ||
    keys.find((key) => key !== preferredX) ||
    preferredX
  return [
    {
      id: 'fallback-line',
      type: 'line',
      xField: preferredX,
      yFields: [preferredY],
      title: 'Line distribution',
      description: 'Auto-generated from sample data',
      chartTemplateId: 'sample_line',
      source: 'fallback',
    },
    {
      id: 'fallback-bar',
      type: 'bar',
      xField: preferredX,
      yFields: [preferredY],
      title: 'Bar distribution',
      description: 'Auto-generated from sample data',
      chartTemplateId: 'sample_bar',
      source: 'fallback',
    },
  ]
}

function GenerateAndDownload({
  selected,
  selectedTemplates,
  autoType,
  start,
  end,
  setStart,
  setEnd,
  onFind,
  findDisabled,
  finding,
  results,
  onToggleBatch,
  onGenerate,
  canGenerate,
  generateLabel,
  generation,
  generatorReady,
  generatorIssues,
  keyValues = {},
  onKeyValueChange = () => {},
  keysReady = true,
  keyOptions = {},
  keyOptionsLoading = {},
  onResampleFilter = () => {},
}) {
  const { downloads } = useAppStore()
  const toast = useToast()
  const { execute } = useInteraction()
  const targetNames = selectedTemplates.map((t) => t.name)
  const subline = targetNames.length
    ? `${targetNames.slice(0, 3).join(', ')}${targetNames.length > 3 ? ', ...' : ''}`
    : ''
  const generatorMessages = generatorIssues?.messages || []
  const generatorMissing = generatorIssues?.missing || []
  const generatorNeedsFix = generatorIssues?.needsFix || []
  const selectionReady = selected.length > 0 && generatorReady
  const [chartQuestion, setChartQuestion] = useState('')
  const [chartSuggestions, setChartSuggestions] = useState([])
  const [selectedChartId, setSelectedChartId] = useState(null)
  const [chartSampleData, setChartSampleData] = useState(null)
  const [selectedChartSource, setSelectedChartSource] = useState('suggestion')
  const [selectedSavedChartId, setSelectedSavedChartId] = useState(null)
  const [saveChartLoading, setSaveChartLoading] = useState(false)
  const trackedJobIds = useMemo(
    () => generation.items.map((item) => item.jobId).filter(Boolean),
    [generation.items],
  )
  const { jobsById } = useTrackedJobs(trackedJobIds)
  const templateKeyTokens = (tpl) => {
    const fromState = Array.isArray(tpl?.mappingKeys)
      ? tpl.mappingKeys.map((token) => (typeof token === 'string' ? token.trim() : '')).filter(Boolean)
      : []
    if (fromState.length) return fromState
    const options = keyOptions?.[tpl?.id] || {}
    return Object.keys(options || {})
  }
  const templatesWithKeys = useMemo(() => (
    selectedTemplates
      .map((tpl) => ({ tpl, tokens: templateKeyTokens(tpl) }))
      .filter(({ tokens }) => tokens.length > 0)
  ), [selectedTemplates, keyOptions])
  const valid = selectionReady && !!start && !!end && new Date(end) >= new Date(start) && keysReady
  const keysMissing = !keysReady && templatesWithKeys.length > 0
  const showGeneratorWarning = selected.length > 0 && (!generatorReady || generatorMissing.length || generatorNeedsFix.length)
  const activeTemplate = useMemo(
    () => (selectedTemplates && selectedTemplates.length ? selectedTemplates[0] : null),
    [selectedTemplates],
  )
  const activeTemplateId = activeTemplate?.id
  const activeTemplateKind = useMemo(
    () => (activeTemplate ? getTemplateKind(activeTemplate) : 'pdf'),
    [activeTemplate],
  )
  const {
    savedCharts,
    savedChartsLoading,
    savedChartsError,
    fetchSavedCharts,
    createSavedChart,
    renameSavedChart,
    deleteSavedChart,
  } = useSavedCharts({ templateId: activeTemplateId, templateKind: activeTemplateKind })
  const activeTemplateResult = activeTemplateId ? results?.[activeTemplateId] : null
  const activeNumericBins = activeTemplateResult?.numericBins
  const activeDateRange = activeTemplateResult?.dateRange
  const activeBatchData = useMemo(() => {
    if (!activeTemplateId || !activeTemplateResult || !Array.isArray(activeTemplateResult.batches)) {
      return []
    }
    return activeTemplateResult.batches.map((batch, index) => {
      const batchId = batch.id != null ? String(batch.id) : String(index + 1)
      const rows = Number(batch.rows || 0)
      const parent = Number(batch.parent || 0)
      const safeParent = parent || 1
      const rowsPerParent = safeParent ? rows / safeParent : rows
      return {
        batch_index: index + 1,
        batch_id: batchId,
        rows,
        parent,
        rows_per_parent: rowsPerParent,
        time: batch.time ?? null,
        category: batch.category ?? null,
      }
    })
  }, [activeTemplateId, activeTemplateResult])
  const fallbackChartsActive = useMemo(
    () => chartSuggestions.some((chart) => chart?.source === 'fallback'),
    [chartSuggestions],
  )
  const { data: previewData, usingSampleData } = useMemo(() => {
    if (fallbackChartsActive && Array.isArray(chartSampleData) && chartSampleData.length) {
      return { data: chartSampleData, usingSampleData: true }
    }
    if (activeBatchData.length) {
      return { data: activeBatchData, usingSampleData: false }
    }
    if (Array.isArray(chartSampleData) && chartSampleData.length) {
      return { data: chartSampleData, usingSampleData: true }
    }
    return { data: [], usingSampleData: false }
  }, [activeBatchData, chartSampleData, fallbackChartsActive])
  const activeFieldCatalog = Array.isArray(activeTemplateResult?.fieldCatalog)
    ? activeTemplateResult.fieldCatalog
    : []
  const activeDiscoverySchema = useMemo(
    () => (activeTemplateResult?.discoverySchema && typeof activeTemplateResult.discoverySchema === 'object'
      ? activeTemplateResult.discoverySchema
      : null),
    [activeTemplateResult],
  )
  const dimensionOptions = useMemo(() => {
    if (activeDiscoverySchema?.dimensions && Array.isArray(activeDiscoverySchema.dimensions)) {
      return activeDiscoverySchema.dimensions.map((dim) => ({
        value: dim.name,
        label: dim.name,
        kind: dim.kind || dim.type || 'categorical',
        bucketable: Boolean(dim.bucketable),
      }))
    }
    const names = new Set(activeFieldCatalog.map((field) => field?.name))
    const base = RESAMPLE_DIMENSION_OPTIONS.filter((option) => {
      if (option.value === 'time') return names.has('time')
      if (option.value === 'category') return names.has('category')
      return true
    })
    if (!base.some((opt) => opt.value === 'batch_index')) {
      const fallback = RESAMPLE_DIMENSION_OPTIONS.find((opt) => opt.value === 'batch_index')
      if (fallback) base.push(fallback)
    }
    return base
  }, [activeDiscoverySchema, activeFieldCatalog])
  const metricOptions = useMemo(() => {
    if (activeDiscoverySchema?.metrics && Array.isArray(activeDiscoverySchema.metrics)) {
      return activeDiscoverySchema.metrics.map((metric) => ({
        value: metric.name,
        label: metric.name,
      }))
    }
    const names = new Set(activeFieldCatalog.map((field) => field?.name))
    const base = RESAMPLE_METRIC_OPTIONS.filter((option) => names.has(option.value))
    if (!base.length) {
      return [...RESAMPLE_METRIC_OPTIONS]
    }
    return base
  }, [activeDiscoverySchema, activeFieldCatalog])
  const resampleConfig = activeTemplateResult?.resample?.config || DEFAULT_RESAMPLE_CONFIG
  const safeResampleConfig = useMemo(() => {
    const next = { ...DEFAULT_RESAMPLE_CONFIG, ...resampleConfig }
    const activeDim = dimensionOptions.find((opt) => opt.value === next.dimension) || dimensionOptions[0]
    if (!activeDim) {
      next.dimension = DEFAULT_RESAMPLE_CONFIG.dimension
      next.dimensionKind = DEFAULT_RESAMPLE_CONFIG.dimensionKind
    } else {
      next.dimension = activeDim.value
      const rawKind = activeDim.kind || activeDim.type || DEFAULT_RESAMPLE_CONFIG.dimensionKind
      const kindText = (rawKind || '').toString().toLowerCase()
      if (kindText.includes('time') || kindText.includes('date')) {
        next.dimensionKind = 'temporal'
      } else if (kindText.includes('num')) {
        next.dimensionKind = 'numeric'
      } else {
        next.dimensionKind = 'categorical'
      }
    }
    if (!metricOptions.some((opt) => opt.value === next.metric)) {
      next.metric = metricOptions[0]?.value || DEFAULT_RESAMPLE_CONFIG.metric
    }
    return next
  }, [resampleConfig, dimensionOptions, metricOptions])
  const resampleState = useMemo(
    () => buildResampleComputation(
      activeTemplateResult?.batchMetrics,
      safeResampleConfig,
      activeNumericBins,
      activeTemplateResult?.categoryGroups,
    ),
    [activeTemplateId, activeTemplateResult?.batchMetrics, safeResampleConfig, activeNumericBins, activeTemplateResult?.categoryGroups],
  )
  const totalBatchCount =
    activeTemplateResult?.allBatches?.length ?? activeTemplateResult?.batches?.length ?? 0
  const filteredBatchCount = activeTemplateResult?.batches?.length ?? 0
  const selectedMetricLabel = useMemo(
    () => metricOptions.find((opt) => opt.value === safeResampleConfig.metric)?.label || 'Metric',
    [metricOptions, safeResampleConfig.metric],
  )
  const resampleBucketHelper =
    (safeResampleConfig.dimensionKind === 'temporal' || safeResampleConfig.dimension === 'time') &&
    safeResampleConfig.bucket === 'auto'
      ? `Auto bucket: ${resampleState.resolvedBucket}`
      : safeResampleConfig.dimensionKind === 'numeric'
        ? 'Buckets group numeric values into ranges'
        : ''
  const bucketOptions =
    safeResampleConfig.dimensionKind === 'numeric' ? RESAMPLE_NUMERIC_BUCKET_OPTIONS : RESAMPLE_BUCKET_OPTIONS
  const applyResampleConfig = useCallback(
    (nextConfig) => {
      if (!activeTemplateId) return
      const computation = buildResampleComputation(
        activeTemplateResult?.batchMetrics,
        nextConfig,
        activeNumericBins,
        activeTemplateResult?.categoryGroups,
      )
      onResampleFilter(activeTemplateId, {
        config: {
          ...nextConfig,
          range: computation.configRange,
        },
        allowedBatchIds: computation.allowedIds ? Array.from(computation.allowedIds) : null,
      })
    },
    [activeTemplateId, activeTemplateResult?.batchMetrics, activeNumericBins, activeTemplateResult?.categoryGroups, onResampleFilter],
  )
  const handleResampleSelectorChange = useCallback(
    (field) => (event) => {
      const { value } = event?.target || {}
      if (value == null) return
      const nextConfig = { ...safeResampleConfig, [field]: value }
      if (field === 'dimension') {
        const selectedDim = dimensionOptions.find((opt) => opt.value === value)
        const rawKind = selectedDim?.kind || selectedDim?.type || DEFAULT_RESAMPLE_CONFIG.dimensionKind
        const kindText = (rawKind || '').toString().toLowerCase()
        if (kindText.includes('time') || kindText.includes('date')) {
          nextConfig.dimensionKind = 'temporal'
        } else if (kindText.includes('num')) {
          nextConfig.dimensionKind = 'numeric'
        } else {
          nextConfig.dimensionKind = 'categorical'
        }
      }
      if (field !== 'range') {
        nextConfig.range = null
      }
      applyResampleConfig(nextConfig)
    },
    [applyResampleConfig, safeResampleConfig],
  )
  const handleResampleBrushChange = useCallback(
    ({ startIndex, endIndex }) => {
      if (
        !activeTemplateId ||
        !Array.isArray(resampleState.series) ||
        !resampleState.series.length
      ) {
        return
      }
      if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return
      const maxIndex = resampleState.series.length - 1
      const nextRange = clampBrushRange([startIndex, endIndex], maxIndex)
      if (!nextRange) return
      const coversAll = nextRange[0] === 0 && nextRange[1] === maxIndex
      const idsSet = coversAll ? null : collectIdsFromSeries(resampleState.series, nextRange)
      onResampleFilter(activeTemplateId, {
        config: {
          ...safeResampleConfig,
          range: coversAll ? null : nextRange,
        },
        allowedBatchIds: idsSet ? Array.from(idsSet) : null,
      })
    },
    [activeTemplateId, onResampleFilter, resampleState.series, safeResampleConfig],
  )
  const handleResampleReset = useCallback(() => {
    if (!activeTemplateId) return
    onResampleFilter(activeTemplateId, {
      config: { ...safeResampleConfig, range: null },
      allowedBatchIds: null,
    })
  }, [activeTemplateId, onResampleFilter, safeResampleConfig])
  const selectedSuggestion = useMemo(() => {
    if (!chartSuggestions.length) return null
    if (selectedChartId) {
      const found = chartSuggestions.find((chart) => chart.id === selectedChartId)
      if (found) return found
    }
    return chartSuggestions[0] || null
  }, [chartSuggestions, selectedChartId])
  const selectedSavedChart = useMemo(
    () => savedCharts.find((chart) => chart.id === selectedSavedChartId) || null,
    [savedCharts, selectedSavedChartId],
  )
  const selectedChartSpec = useMemo(
    () => (selectedChartSource === 'saved' ? selectedSavedChart?.spec || null : selectedSuggestion),
    [selectedChartSource, selectedSavedChart, selectedSuggestion],
  )
  useEffect(() => {
    setChartSuggestions([])
    setSelectedChartId(null)
    setSelectedSavedChartId(null)
    setSelectedChartSource('suggestion')
    setChartSampleData(null)
  }, [activeTemplateId])
  const chartSuggestMutation = useMutation({
    mutationFn: async ({
      templateId,
      kind,
      startDate,
      endDate,
      keyValuesForTemplate,
      question,
    }) => {
      return suggestCharts({
        templateId,
        startDate,
        endDate,
        keyValues: keyValuesForTemplate,
        question,
        kind,
      })
    },
    onSuccess: (data) => {
      const charts = Array.isArray(data?.charts) ? data.charts : []
      const sampleData = Array.isArray(data?.sampleData) ? data.sampleData : null
      const fallbackCharts = charts.length === 0 ? buildFallbackChartsFromSample(sampleData) : []
      const nextCharts = fallbackCharts.length ? fallbackCharts : charts
      setChartSuggestions(nextCharts)
      setSelectedChartId((prev) => {
        if (prev && nextCharts.some((chart) => chart.id === prev)) return prev
        return nextCharts[0]?.id || null
      })
      setSelectedSavedChartId(null)
      setSelectedChartSource('suggestion')
      setChartSampleData(sampleData && sampleData.length ? sampleData : null)
    },
    onError: (error) => {
      toast.show(error?.message || 'Chart suggestions failed', 'error')
    },
  })
  const handleAskCharts = async () => {
    if (!activeTemplate || !start || !end) {
      toast.show('Select a template and valid date range before asking for charts.', 'warning')
      return
    }
    if (!activeBatchData.length) {
      toast.show('Run discovery for this template to unlock chart suggestions.', 'info')
      return
    }
    const startSql = toSqlDateTime(start)
    const endSql = toSqlDateTime(end)
    if (!startSql || !endSql) {
      toast.show('Provide a valid start and end date before asking for charts.', 'warning')
      return
    }
    try {
      await execute({
        type: InteractionType.ANALYZE,
        label: 'Suggest charts',
        reversibility: Reversibility.SYSTEM_MANAGED,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: {
          templateId: activeTemplate.id,
          action: 'suggest_charts',
        },
        action: async () => {
          setChartSampleData(null)
          return chartSuggestMutation.mutateAsync({
            templateId: activeTemplate.id,
            kind: activeTemplateKind,
            startDate: startSql,
            endDate: endSql,
            keyValuesForTemplate: keyValues?.[activeTemplate.id] || {},
            question: chartQuestion,
          })
        },
      })
    } catch {
      // handled in onError
    }
  }
  const handleSelectSuggestion = (chartId) => {
    setSelectedChartSource('suggestion')
    setSelectedChartId(chartId)
    setSelectedSavedChartId(null)
  }
  const handleSelectSavedChart = (chartId) => {
    setSelectedChartSource('saved')
    setSelectedSavedChartId(chartId)
    setSelectedChartId(null)
  }
  const handleSaveCurrentSuggestion = async () => {
    if (!activeTemplate || !selectedSuggestion) {
      toast.show('Select a template and a suggestion before saving.', 'info')
      return
    }
    if (typeof window === 'undefined') return
    const index = chartSuggestions.indexOf(selectedSuggestion)
    const defaultName =
      selectedSuggestion.title ||
      selectedSuggestion.description ||
      (index >= 0 ? `Suggested chart ${index + 1}` : 'Saved chart')
    const entered = window.prompt('Name this chart', defaultName || 'Saved chart')
    if (!entered || !entered.trim()) return
    const name = entered.trim()
    try {
      await execute({
        type: InteractionType.CREATE,
        label: 'Save chart',
        reversibility: Reversibility.SYSTEM_MANAGED,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: {
          templateId: activeTemplate.id,
          action: 'save_chart',
        },
        action: async () => {
          setSaveChartLoading(true)
          try {
            const created = await createSavedChart({ name, spec: selectedSuggestion })
            if (created) {
              setSelectedChartSource('saved')
              setSelectedSavedChartId(created.id)
              toast.show(`Saved chart "${created.name}"`, 'success')
            }
            return created
          } finally {
            setSaveChartLoading(false)
          }
        },
      })
    } catch (error) {
      toast.show(error?.message || 'Failed to save chart.', 'error')
    }
  }
  const handleRenameSavedChart = async (event, chart) => {
    event?.stopPropagation()
    if (!chart || !activeTemplate) return
    if (typeof window === 'undefined') return
    const currentName = chart.name || 'Saved chart'
    const entered = window.prompt('Rename chart', currentName)
    if (!entered || !entered.trim()) return
    const name = entered.trim()
    try {
      await execute({
        type: InteractionType.UPDATE,
        label: 'Rename chart',
        reversibility: Reversibility.SYSTEM_MANAGED,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: {
          chartId: chart.id,
          action: 'rename_chart',
        },
        action: async () => {
          const updated = await renameSavedChart({ chartId: chart.id, name })
          if (updated) {
            toast.show(`Renamed chart to "${updated.name}"`, 'success')
          }
          return updated
        },
      })
    } catch (error) {
      toast.show(error?.message || 'Failed to rename chart.', 'error')
    }
  }
  const handleDeleteSavedChart = async (event, chart) => {
    event?.stopPropagation()
    if (!chart || !activeTemplate) return
    if (typeof window !== 'undefined') {
      const confirmed = confirmDelete(`Delete saved chart "${chart.name || 'Saved chart'}"?`)
      if (!confirmed) return
    }
    try {
      await execute({
        type: InteractionType.DELETE,
        label: 'Delete saved chart',
        reversibility: Reversibility.SYSTEM_MANAGED,
        suppressSuccessToast: true,
        suppressErrorToast: true,
        intent: {
          chartId: chart.id,
          action: 'delete_chart',
        },
        action: async () => {
          await deleteSavedChart({ chartId: chart.id })
          if (selectedChartSource === 'saved' && selectedSavedChartId === chart.id) {
            setSelectedChartSource('suggestion')
            setSelectedSavedChartId(null)
          }
          toast.show('Deleted saved chart.', 'success')
        },
      })
    } catch (error) {
      toast.show(error?.message || 'Failed to delete chart.', 'error')
    }
  }
  const handleRetrySavedCharts = () => {
    fetchSavedCharts()
  }
  const renderSuggestedChart = useCallback((spec, data, { source } = {}) => {
    if (!spec) {
      return (
        <Typography variant="body2" color="text.secondary">
          Select a suggestion to preview a chart.
        </Typography>
      )
    }
    if (!Array.isArray(data) || data.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">
          No data available for this template and filters.
        </Typography>
      )
    }
    const sample = data[0] || {}
    const fieldNames = new Set(Object.keys(sample))
    const missingFields = []
    if (!fieldNames.has(spec.xField)) {
      missingFields.push(spec.xField)
    }
    const yFieldsArray = Array.isArray(spec.yFields) && spec.yFields.length ? spec.yFields : ['rows']
    yFieldsArray.forEach((field) => {
      if (!fieldNames.has(field)) {
        missingFields.push(field)
      }
    })
    if (spec.groupField && !fieldNames.has(spec.groupField)) {
      missingFields.push(spec.groupField)
    }
    if (missingFields.length) {
      return (
        <Alert severity="warning" sx={{ mt: 0.5 }}>
          {source === 'saved'
            ? `Saved chart references fields not present in current data (missing: ${missingFields.join(
                ', ',
              )}). Edit or delete this chart.`
            : `Cannot render this chart because the dataset is missing: ${missingFields.join(', ')}.`}
        </Alert>
      )
    }
    const palette = [secondary.violet[500], secondary.emerald[500], secondary.cyan[500], secondary.rose[500], secondary.teal[500], secondary.fuchsia[500], secondary.slate[500]]
    const type = (spec.type || '').toLowerCase()
    const xField = spec.xField
    const yKeys = yFieldsArray.length ? yFieldsArray : ['rows']
    if (type === 'pie') {
      const valueKey = yKeys[0]
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={xField}
              innerRadius="45%"
              outerRadius="80%"
              paddingAngle={2}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={palette[index % palette.length]} />
              ))}
            </Pie>
            <RechartsTooltip />
            <RechartsLegend />
          </PieChart>
        </ResponsiveContainer>
      )
    }
    if (type === 'scatter') {
      const yKey = yKeys[0]
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey={xField} name={xField} tick={{ fontSize: 12 }} />
            <YAxis type="number" dataKey={yKey} name={yKey} tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <RechartsLegend />
            <Scatter data={data} fill={secondary.emerald[500]} />
          </ScatterChart>
        </ResponsiveContainer>
      )
    }
    if (type === 'line') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xField} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <RechartsLegend />
            {yKeys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={palette[index % palette.length]}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )
    }
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xField} tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <RechartsTooltip />
          <RechartsLegend />
          {yKeys.map((key, index) => (
            <Bar key={key} dataKey={key} fill={palette[index % palette.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    )
  }, [])
  return (
    <>
      <Surface sx={surfaceStackSx}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          spacing={{ xs: 1, sm: 2 }}
        >
          <Stack spacing={0.5}>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Typography variant="h6">Run Reports</Typography>
              <InfoTooltip
                content={TOOLTIP_COPY.runReports}
                ariaLabel="Run reports guidance"
              />
            </Stack>
            {!!subline && <Typography variant="caption" color="text.secondary">{subline}</Typography>}
            {activeDateRange && (
              <Typography variant="caption" color="text.secondary">
                Range: {activeDateRange.start} → {activeDateRange.end}
                {activeDateRange.time_start && activeDateRange.time_end
                  ? ` • data ${activeDateRange.time_start} → ${activeDateRange.time_end}`
                  : ''}
              </Typography>
            )}
          </Stack>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            <Tooltip title="Scan your data to see what can be included in this report">
              <span>
                <Button
                  variant="outlined"
                  onClick={onFind}
                  disabled={!valid || findDisabled}
                  sx={{ width: { xs: '100%', sm: 'auto' }, color: 'text.secondary' }}
                >
                  Preview Data
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={generateLabel}>
              <span>
                <Button
                  variant="contained"
                  onClick={onGenerate}
                  disabled={!canGenerate}
                  aria-label={generateLabel}
                  sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                  {generateLabel}
                </Button>
              </span>
            </Tooltip>
          </Stack>

        {showGeneratorWarning && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {generatorMissing.length
              ? 'Generate SQL & schema assets for all selected templates before continuing.'
              : 'Resolve SQL & schema asset issues before continuing.'}
            {generatorMessages.length ? (
              <Box component="ul" sx={{ pl: 2, mt: 0.5 }}>
                {generatorMessages.map((msg, idx) => (
                  <Typography key={`generator-msg-${idx}`} component="li" variant="caption">
                    {msg}
                  </Typography>
                ))}
              </Box>
            ) : null}
          </Alert>
        )}
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            label="Start Date & Time"
            type="datetime-local"
            InputLabelProps={{ shrink: true }}
            value={toLocalInputValue(start)}
            onChange={(e) => setStart(e.target.value)}
            helperText="Timezone: system"
          />
          <TextField
            label="End Date & Time"
            type="datetime-local"
            InputLabelProps={{ shrink: true }}
            value={toLocalInputValue(end)}
            onChange={(e) => setEnd(e.target.value)}
            error={!!(start && end && new Date(end) < new Date(start))}
            helperText={start && end && new Date(end) < new Date(start) ? 'End must be after Start' : ' '}
          />
          <Chip label={`Auto: ${autoType || '-'}`} size="small" variant="outlined" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} />
        </Stack>

        <Stack spacing={1.5}>
          <Typography variant="subtitle2">Key Token Values</Typography>
          {keysMissing && (
            <Alert severity="warning">Fill in all key token values to enable discovery and runs.</Alert>
          )}
          {templatesWithKeys.length > 0 ? (
            templatesWithKeys.map(({ tpl, tokens }) => (
              <Box
                key={tpl.id}
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5, bgcolor: 'background.paper' }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{tpl.name || tpl.id}</Typography>
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {tokens.map((token) => {
                    const templateOptions = keyOptions?.[tpl.id] || {}
                    const tokenOptions = templateOptions[token] || []
                    const loading = Boolean(keyOptionsLoading?.[tpl.id])
                    const stored = keyValues?.[tpl.id]?.[token]
                    const rawValue = Array.isArray(stored)
                      ? stored
                      : stored
                        ? [stored]
                        : []
                    const uniqueTokenOptions = tokenOptions.filter((opt, idx, arr) => arr.indexOf(opt) === idx)
                    const SELECT_ALL_OPTION = '__NR_SELECT_ALL__'
                    const optionsWithAll = uniqueTokenOptions.length > 1 ? [...uniqueTokenOptions, SELECT_ALL_OPTION] : uniqueTokenOptions
                    const ALL_SENTINELS = new Set(['all', 'select all', SELECT_ALL_OPTION.toLowerCase()])
                    const isAllStored = rawValue.some(
                      (val) => typeof val === 'string' && ALL_SENTINELS.has(val.toLowerCase()),
                    )
                    const displayValue = isAllStored
                      ? [SELECT_ALL_OPTION]
                      : rawValue
                        .filter((val, idx) => rawValue.indexOf(val) === idx)
                        .filter((val) => val !== SELECT_ALL_OPTION)
                    return (
                      <Autocomplete
                        key={token}
                        multiple
                        freeSolo
                        options={optionsWithAll}
                        value={displayValue}
                        getOptionLabel={(option) => (option === SELECT_ALL_OPTION ? 'All values' : option)}
                        filterSelectedOptions
                        renderTags={(value, getTagProps) => {
                          const isAllSelectedExplicit =
                            uniqueTokenOptions.length > 0 &&
                            value.length === uniqueTokenOptions.length &&
                            value.every((item) => uniqueTokenOptions.includes(item))
                          const selectedIncludesAllSentinel = value.some(
                            (item) => typeof item === 'string' && ALL_SENTINELS.has(item.toLowerCase()),
                          )
                          if (isAllSelectedExplicit || selectedIncludesAllSentinel) {
                            return [
                              <Chip
                                {...getTagProps({ index: 0 })}
                                key="all-values"
                                label="All values"
                              />,
                            ]
                          }
                          return value.map((option, index) => (
                            <Chip
                              {...getTagProps({ index })}
                              key={option}
                              label={option === SELECT_ALL_OPTION ? 'All values' : option}
                            />
                          ))
                        }}
                        onChange={(_event, newValue) => {
                          const cleaned = Array.isArray(newValue) ? newValue : []
                          const normalized = cleaned
                            .map((item) => (typeof item === 'string' ? item.trim() : ''))
                            .filter((item) => item.length > 0)
                          const hasSelectAll = normalized.some((item) => {
                            const lower = item.toLowerCase()
                            return item === SELECT_ALL_OPTION || ALL_SENTINELS.has(lower)
                          })
                          const sanitized = normalized.filter(
                            (item) => !ALL_SENTINELS.has(item.toLowerCase()) && item !== SELECT_ALL_OPTION,
                          )
                          if (hasSelectAll) {
                            const allList = uniqueTokenOptions.length
                              ? [SELECT_ALL_OPTION, ...uniqueTokenOptions]
                              : [SELECT_ALL_OPTION]
                            onKeyValueChange(tpl.id, token, allList)
                          } else {
                            onKeyValueChange(tpl.id, token, sanitized)
                          }
                        }}
                        isOptionEqualToValue={(option, optionValue) => option === optionValue}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label={token}
                            required
                            InputProps={{
                              ...params.InputProps,
                              endAdornment: (
                                <>
                                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                                  {params.InputProps.endAdornment}
                                </>
                              ),
                            }}
                          />
                        )}
                      />
                    )
                  })}
                </Stack>
              </Box>
            ))
          ) : (
            <Box
              sx={{
                border: '1px dashed',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
                bgcolor: 'background.default',
                color: 'text.secondary',
              }}
            >
              <Typography variant="body2">
                {selected.length === 0
                  ? 'Select a template to configure key token filters.'
                  : 'Selected templates do not define key tokens.'}
              </Typography>
            </Box>
          )}
        </Stack>

        {activeTemplate && (
          <Box>
            <Divider sx={{ my: 2 }} />
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={{ xs: 0.5, md: 1 }}
              alignItems={{ xs: 'flex-start', md: 'center' }}
              justifyContent="space-between"
            >
              <Stack spacing={0.5}>
                <Typography variant="subtitle1">Filter & Group Data</Typography>
                <Typography variant="body2" color="text.secondary">
                  Narrow down your data before generating reports. Use the chart below to select specific time periods or groups.
                </Typography>
              </Stack>
              <Button
                size="small"
                variant="text"
                onClick={handleResampleReset}
                disabled={!resampleState.filterActive}
              >
                Reset filter
              </Button>
            </Stack>
            {Array.isArray(activeTemplateResult?.batchMetrics) &&
            activeTemplateResult.batchMetrics.length ? (
              <>
                <Stack
                  direction={{ xs: 'column', lg: 'row' }}
                  spacing={1.25}
                  sx={{ mt: 1.5 }}
                >
                  <TextField
                    select
                    size="small"
                    label="Dimension"
                    value={safeResampleConfig.dimension}
                    onChange={handleResampleSelectorChange('dimension')}
                    sx={{ minWidth: { xs: '100%', lg: 180 } }}
                  >
                    {dimensionOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label="Metric"
                    value={safeResampleConfig.metric}
                    onChange={handleResampleSelectorChange('metric')}
                    sx={{ minWidth: { xs: '100%', lg: 180 } }}
                  >
                    {metricOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label="Aggregation"
                    value={safeResampleConfig.aggregation}
                    onChange={handleResampleSelectorChange('aggregation')}
                    sx={{ minWidth: { xs: '100%', lg: 180 } }}
                  >
                    {RESAMPLE_AGGREGATION_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label="Time bucket"
                    value={safeResampleConfig.bucket}
                    onChange={handleResampleSelectorChange('bucket')}
                    disabled={!bucketOptions.length || safeResampleConfig.dimensionKind === 'categorical'}
                    helperText={
                      safeResampleConfig.dimensionKind === 'temporal'
                        ? resampleBucketHelper
                        : safeResampleConfig.dimensionKind === 'numeric'
                          ? 'Applies to numeric bucketing'
                          : 'Not applicable to this dimension'
                    }
                    sx={{ minWidth: { xs: '100%', lg: 180 } }}
                  >
                    {bucketOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                <Box sx={{ height: 260, mt: 2 }}>
                  {resampleState.series.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={resampleState.series}
                        margin={{ top: 8, right: 16, bottom: 24, left: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <RechartsTooltip />
                        <Bar dataKey="value" fill={secondary.violet[500]} name={selectedMetricLabel} />
                        <Brush
                          dataKey="label"
                          height={24}
                          stroke={secondary.violet[500]}
                          startIndex={
                            resampleState.displayRange ? resampleState.displayRange[0] : 0
                          }
                          endIndex={
                            resampleState.displayRange
                              ? resampleState.displayRange[1]
                              : Math.max(resampleState.series.length - 1, 0)
                          }
                          travellerWidth={8}
                          onChange={handleResampleBrushChange}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <Stack
                      alignItems="center"
                      justifyContent="center"
                      sx={{ height: '100%' }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        No buckets available for this selection. Try a different dimension.
                      </Typography>
                    </Stack>
                  )}
                </Box>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  alignItems={{ xs: 'flex-start', sm: 'center' }}
                  justifyContent="space-between"
                  spacing={0.5}
                  sx={{ mt: 1 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Showing {filteredBatchCount}
                    {totalBatchCount && totalBatchCount !== filteredBatchCount
                      ? ` / ${totalBatchCount}`
                      : ''}{' '}
                    {filteredBatchCount === 1 ? 'data section' : 'data sections'}
                  </Typography>
                  {safeResampleConfig.dimension === 'time' && resampleBucketHelper && (
                    <Typography variant="caption" color="text.secondary">
                      {resampleBucketHelper}
                    </Typography>
                  )}
                </Stack>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                Run discovery for this template to populate resampling metrics.
              </Typography>
            )}
          </Box>
        )}

        {(finding || Object.keys(results).length > 0) && (
          <Box>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="subtitle1">Data Preview</Typography>
              <InfoTooltip
                content="This shows the data sections found in your date range. Each section represents a logical grouping of data (like a time period or category) that will become part of your report."
                ariaLabel="Data preview explanation"
              />
            </Stack>
            {finding ? (
              <Stack spacing={1.25} sx={{ mt: 1.5 }}>
                <LinearProgress aria-label="Scanning your data" />
                <Typography variant="body2" color="text.secondary">
                  Scanning your data...
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                {Object.keys(results).map((tid) => {
                  const r = results[tid]
                  const filteredCount = r.batches.length
                  const originalCount = r.allBatches?.length ?? r.batches_count ?? filteredCount
                  const filteredRows = r.batches.reduce((acc, batch) => acc + (batch.rows || 0), 0)
                  const summary =
                    originalCount === filteredCount
                      ? `${filteredCount} ${filteredCount === 1 ? 'section' : 'sections'} \u2022 ${filteredRows.toLocaleString()} records`
                      : `${filteredCount} / ${originalCount} sections \u2022 ${filteredRows.toLocaleString()} records`
                  return (
                    <Box
                      key={tid}
                      sx={{
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 1.5,
                        bgcolor: 'background.paper',
                      }}
                    >
                      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={{ xs: 0.5, sm: 1 }}>
                        <Typography variant="subtitle2">{r.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {summary}
                        </Typography>
                      </Stack>
                      {r.batches.length ? (
                        <Stack spacing={1} sx={{ mt: 1.25 }}>
                          <Typography variant="body2" color="text.secondary">
                            Select which data sections to include in your report:
                          </Typography>
                          {r.batches.map((b, idx) => (
                            <Stack key={b.id || idx} direction="row" spacing={1} alignItems="center">
                              <Checkbox
                                checked={b.selected}
                                onChange={(e) => onToggleBatch(tid, idx, e.target.checked)}
                                inputProps={{ 'aria-label': `Include section ${idx + 1} for ${r.name}` }}
                              />
                              <Typography variant="body2">
                                Section {idx + 1} {'\u2022'} {(b.parent ?? 1)} {(b.parent ?? 1) === 1 ? 'group' : 'groups'} {'\u2022'} {b.rows.toLocaleString()} records
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">No data found for this date range. Try adjusting your dates.</Typography>
                      )}
                    </Box>
                  )
                })}
              </Stack>
            )}
          </Box>
        )}

        {activeTemplate && (
          <Box>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle1">AI chart suggestions</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Ask about the discovered batches for {activeTemplate.name || activeTemplate.id}.
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 1.5 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  maxRows={4}
                  label="Ask a question about this template's data"
                  placeholder="e.g. Highlight batches with unusually high row counts"
                  value={chartQuestion}
                  onChange={(event) => setChartQuestion(event.target.value)}
                />
                <Button
                  variant="outlined"
                  onClick={handleAskCharts}
                  disabled={
                    chartSuggestMutation.isLoading ||
                    !activeBatchData.length
                  }
                  sx={{ alignSelf: { xs: 'flex-end', sm: 'flex-start' }, whiteSpace: 'nowrap' }}
                >
                  {chartSuggestMutation.isLoading ? 'Asking for charts...' : 'Ask AI for charts'}
                </Button>
              </Stack>
              {!activeBatchData.length && (
                <Typography variant="caption" color="text.secondary">
                  Run discovery for this template to unlock chart suggestions.
                </Typography>
              )}
              {chartSuggestions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No suggestions yet. Ask a question to generate chart ideas.
                </Typography>
              ) : (
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                  <Box
                    sx={{
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Suggestions
                    </Typography>
                    <Stack spacing={1}>
                      {chartSuggestions.map((chart) => (
                        <Card
                          key={chart.id}
                          variant={
                            selectedChartSource === 'suggestion' && chart.id === selectedChartId
                              ? 'outlined'
                              : 'elevation'
                          }
                          sx={{
                            borderColor:
                              selectedChartSource === 'suggestion' && chart.id === selectedChartId
                                ? 'text.secondary'
                                : 'divider',
                            bgcolor:
                              selectedChartSource === 'suggestion' && chart.id === selectedChartId
                                ? alpha(secondary.violet[500], 0.04)
                                : 'background.paper',
                          }}
                        >
                          <CardActionArea onClick={() => handleSelectSuggestion(chart.id)}>
                            <CardContent>
                              <Typography variant="subtitle2">
                                {chart.title || 'Untitled chart'}
                              </Typography>
                              {chart.description && (
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{ mt: 0.5 }}
                                >
                                  {chart.description}
                                </Typography>
                              )}
                              <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                                <Chip
                                  size="small"
                                  label={chart.type || 'chart'}
                                  variant="outlined"
                                  sx={{ textTransform: 'capitalize' }}
                                />
                                {chart.chartTemplateId && (
                                  <Chip
                                    size="small"
                                    label={chart.chartTemplateId}
                                    variant="outlined"
                                  />
                                )}
                              </Stack>
                            </CardContent>
                          </CardActionArea>
                        </Card>
                      ))}
                    </Stack>
                  </Box>
                  <Box
                    sx={{
                      flex: 2,
                      minHeight: { xs: 260, sm: 300 },
                      borderRadius: 1.5,
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: 'background.paper',
                      p: 1.5,
                      minWidth: 0,
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      Preview
                    </Typography>
                    {usingSampleData && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        Using sample dataset from suggestion response
                      </Typography>
                    )}
                    <Box sx={{ width: '100%', height: { xs: 220, sm: 260 } }}>
                      {renderSuggestedChart(selectedChartSpec, previewData, {
                        source: selectedChartSource,
                      })}
                    </Box>
                    {chartSuggestions.length > 0 && (
                      <Box sx={{ textAlign: 'right', mt: 1 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<BookmarkAddOutlinedIcon fontSize="small" />}
                          onClick={handleSaveCurrentSuggestion}
                          disabled={!selectedSuggestion || saveChartLoading}
                        >
                          {saveChartLoading ? 'Saving…' : 'Save this chart'}
                        </Button>
                      </Box>
                    )}
                  </Box>
                </Stack>
              )}
            </Stack>
          </Box>
        )}

        <Box>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1">Saved charts</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Reuse charts you previously saved for {activeTemplate?.name || activeTemplate?.id || 'this template'}.
          </Typography>
          {!activeTemplate && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Select a template to view saved charts.
            </Typography>
          )}
          {activeTemplate && (
            <SavedChartsPanel
              activeTemplate={activeTemplate}
              savedCharts={savedCharts}
              savedChartsLoading={savedChartsLoading}
              savedChartsError={savedChartsError}
              selectedChartSource={selectedChartSource}
              selectedSavedChartId={selectedSavedChartId}
              onRetry={handleRetrySavedCharts}
              onSelectSavedChart={handleSelectSavedChart}
              onRenameSavedChart={handleRenameSavedChart}
              onDeleteSavedChart={handleDeleteSavedChart}
            />
          )}
        </Box>

        <Box>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1">Progress</Typography>
          {generation.items.length > 0 && (
            <Alert severity="info" sx={{ mt: 1 }}>
              Reports continue running in the background. Open the Jobs panel from Notifications in the header to monitor status and download results.
            </Alert>
          )}
          <Stack spacing={1.5} sx={{ mt: 1.5 }}>
            {generation.items.map((item) => {
              const jobDetails = item.jobId ? jobsById?.[item.jobId] : null
              const rawStatus = (jobDetails?.status || item.status || 'queued').toLowerCase()
              const statusLabel = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1)
              const jobProgress =
                typeof jobDetails?.progress === 'number'
                  ? jobDetails.progress
                  : typeof item.progress === 'number'
                    ? item.progress
                    : null
              const clampedProgress =
                typeof jobProgress === 'number' && Number.isFinite(jobProgress)
                  ? Math.min(100, Math.max(0, jobProgress))
                  : null
              const chipColor = JOB_STATUS_COLORS[rawStatus] || 'default'
              const progressVariant = clampedProgress == null ? 'indeterminate' : 'determinate'
              const errorMessage = jobDetails?.error || item.error
              return (
                <Box
                  key={item.id}
                  sx={{
                    p: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'background.paper',
                  }}
                >
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={{ xs: 0.5, sm: 1 }}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {item.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.jobId ? `Job ID: ${item.jobId}` : 'Preparing job...'}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      label={statusLabel}
                      color={chipColor === 'default' ? 'default' : chipColor}
                      variant={chipColor === 'default' ? 'outlined' : 'filled'}
                    />
                  </Stack>
                  <LinearProgress
                    variant={progressVariant}
                    value={progressVariant === 'determinate' ? clampedProgress : undefined}
                    sx={{ mt: 1 }}
                    aria-label={`${item.name} progress`}
                  />
                  {errorMessage ? (
                    <Alert severity="error" sx={{ mt: 1 }}>
                      {errorMessage}
                    </Alert>
                  ) : (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                      Keep an eye on the Jobs panel to see when this run finishes and download the files.
                    </Typography>
                  )}
                </Box>
              )
            })}
            {!generation.items.length && <Typography variant="body2" color="text.secondary">No runs yet</Typography>}
          </Stack>
        </Box>
      </Surface>

      <Surface sx={surfaceStackSx}>
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Typography variant="h6">Recently Downloaded</Typography>
          <InfoTooltip
            content={TOOLTIP_COPY.recentDownloads}
            ariaLabel="Recent downloads guidance"
          />
        </Stack>
        <Stack spacing={1.5}>
          {downloads.map((d, i) => {
            const metaLine = [d.template, d.format ? d.format.toUpperCase() : null, d.size || 'Size unknown']
              .filter(Boolean)
              .join(' \u2022 ')
            const formatChips = [
              d.pdfUrl && { label: 'PDF', color: 'primary' },
              d.docxUrl && { label: 'DOCX', color: 'secondary' },
              d.xlsxUrl && { label: 'XLSX', color: 'info' },
            ].filter(Boolean)
            const actionButtons = [
              {
                key: 'open',
                label: 'Open preview',
                variant: 'outlined',
                color: 'inherit',
                disabled: !d.htmlUrl,
                href: d.htmlUrl ? withBase(d.htmlUrl) : null,
              },
              {
                key: 'pdf',
                label: 'Download PDF',
                variant: 'contained',
                color: 'primary',
                disabled: !d.pdfUrl,
                href: d.pdfUrl ? buildDownloadUrl(withBase(d.pdfUrl)) : null,
              },
              d.docxUrl && {
                key: 'docx',
                label: 'Download DOCX',
                variant: 'outlined',
                color: 'primary',
                href: buildDownloadUrl(withBase(d.docxUrl)),
              },
              d.xlsxUrl && {
                key: 'xlsx',
                label: 'Download XLSX',
                variant: 'outlined',
                color: 'info',
                href: buildDownloadUrl(withBase(d.xlsxUrl)),
              },
            ].filter(Boolean)
            return (
              <Box
                key={`${d.filename}-${i}`}
                sx={{
                  p: { xs: 1.5, md: 2 },
                  borderRadius: 1,  // Figma spec: 8px
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  boxShadow: `0 6px 20px ${alpha(neutral[900], 0.06)}`,
                  transition: 'border-color 200ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1), transform 160ms cubic-bezier(0.22, 1, 0.36, 1)',
                  '&:hover': {
                    borderColor: 'primary.light',
                    boxShadow: `0 10px 30px ${alpha(secondary.violet[500], 0.14)}`,
                    transform: 'translateY(-2px)',
                  },
                }}
              >
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                    alignItems={{ md: 'center' }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap title={d.filename}>
                        {d.filename}
                      </Typography>
                      {metaLine && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.5 }}
                          noWrap
                          title={metaLine}
                        >
                          {metaLine}
                        </Typography>
                      )}
                    </Box>
                    {!!formatChips.length && (
                      <Stack direction="row" spacing={0.75} flexWrap="wrap" justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                        {formatChips.map(({ label, color: colorKey }) => (
                          <Chip
                            key={label}
                            size="small"
                            label={label}
                            sx={(theme) => ({
                              borderRadius: 1,
                              fontWeight: 600,
                              bgcolor: alpha(theme.palette[colorKey].main, 0.12),
                              color: theme.palette[colorKey].dark,
                              border: '1px solid',
                              borderColor: alpha(theme.palette[colorKey].main, 0.3),
                            })}
                          />
                        ))}
                      </Stack>
                    )}
                  </Stack>

                  <Divider />

                  <Stack
                    direction={{ xs: 'column', lg: 'row' }}
                    spacing={1.25}
                    alignItems={{ lg: 'flex-start' }}
                  >
                    <Stack
                      direction="row"
                      spacing={1}
                      flexWrap="wrap"
                      sx={{ flexGrow: 1, columnGap: 1, rowGap: 1 }}
                    >
                      {actionButtons.map((action) => {
                        const linkProps = action.href
                          ? { component: 'a', href: action.href, target: '_blank', rel: 'noopener' }
                          : {}
                        return (
                          <Button
                            key={action.key}
                            size="small"
                            variant={action.variant}
                            color={action.color}
                            disabled={action.disabled}
                            sx={{
                              textTransform: 'none',
                              minWidth: { xs: '100%', sm: 0 },
                              flex: { xs: '1 1 100%', sm: '0 0 auto' },
                              px: 2.5,
                            }}
                            {...linkProps}
                          >
                            {action.label}
                          </Button>
                        )
                      })}
                    </Stack>
                    <Box sx={{ width: { xs: '100%', lg: 'auto' } }}>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<ReplayIcon fontSize="small" />}
                        onClick={d.onRerun}
                        sx={{ width: { xs: '100%', lg: 'auto' }, textTransform: 'none', px: 2.5 }}
                      >
                        Re-run
                      </Button>
                    </Box>
                  </Stack>
                </Stack>
              </Box>
            )
          })}
          {!downloads.length && <Typography variant="body2" color="text.secondary">No recent downloads yet.</Typography>}
        </Stack>
      </Surface>
    </>
  )
}

export { GenerateAndDownload }

/* -----------------------------------------------------------
   Page Shell
----------------------------------------------------------- */

// === From: TemplatePicker.jsx ===

function TemplatePicker({ selected, onToggle, outputFormats, setOutputFormats, tagFilter, setTagFilter, onEditTemplate }) {
  const templates = useAppStore((state) => state.templates)
  const templateCatalog = useAppStore((state) => state.templateCatalog)
  const setTemplates = useAppStore((state) => state.setTemplates)
  const setTemplateCatalog = useAppStore((state) => state.setTemplateCatalog)
  const removeTemplate = useAppStore((state) => state.removeTemplate)
  const queryClient = useQueryClient()
  const toast = useToast()
  const [deleting, setDeleting] = useState(null)
  const [activeTab, setActiveTab] = useState('all')
  const [nameQuery, setNameQuery] = useState('')
  const [showStarterInAll, setShowStarterInAll] = useState(true)
  const [requirement, setRequirement] = useState('')
  const [kindHints, setKindHints] = useState([])
  const [domainHints, setDomainHints] = useState([])
  const [recommendations, setRecommendations] = useState([])
  const [recommending, setRecommending] = useState(false)
  const [queueingRecommendations, setQueueingRecommendations] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(null)
  const importInputRef = useRef(null)

  const templatesQuery = useQuery({
    queryKey: ['templates', isMock],
    queryFn: () => (isMock ? mock.listTemplates() : listApprovedTemplates()),
  })

  const catalogQuery = useQuery({
    queryKey: ['template-catalog', isMock],
    queryFn: () => {
      if (isMock) {
        return typeof mock.getTemplateCatalog === 'function' ? mock.getTemplateCatalog() : []
      }
      return getTemplateCatalog()
    },
  })

  const { data, isLoading, isFetching, isError, error } = templatesQuery
  const catalogData = catalogQuery.data

  useEffect(() => {
    if (data) {
      setTemplates(data)
      const state = useAppStore.getState()
      savePersistedCache({
        connections: state.savedConnections,
        templates: data,
        lastUsed: state.lastUsed,
      })
    }
  }, [data, setTemplates])

  useEffect(() => {
    if (catalogData) {
      setTemplateCatalog(catalogData)
    }
  }, [catalogData, setTemplateCatalog])

  const approved = useMemo(() => templates.filter((t) => t.status === 'approved'), [templates])
  const catalogPool = useMemo(
    () => (templateCatalog && templateCatalog.length ? templateCatalog : templates),
    [templateCatalog, templates],
  )
  const companyCandidates = useMemo(
    () => approved.filter((tpl) => String(tpl.source || 'company').toLowerCase() !== 'starter'),
    [approved],
  )
  const starterCandidates = useMemo(
    () => catalogPool.filter((tpl) => String(tpl.source || '').toLowerCase() === 'starter'),
    [catalogPool],
  )
  const allTags = useMemo(
    () => Array.from(new Set(companyCandidates.flatMap((tpl) => tpl.tags || []))),
    [companyCandidates],
  )

  const normalizedQuery = nameQuery.trim().toLowerCase()
  const applyNameFilter = useCallback(
    (items) => {
      if (!normalizedQuery) return items
      return items.filter((tpl) => (tpl.name || tpl.id || '').toLowerCase().includes(normalizedQuery))
    },
    [normalizedQuery],
  )
  const applyTagFilter = useCallback(
    (items) => {
      if (!tagFilter?.length) return items
      return items.filter((tpl) => (tpl.tags || []).some((tag) => tagFilter.includes(tag)))
    },
    [tagFilter],
  )

  const kindOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogPool
            .map((tpl) => (tpl.kind || '').toLowerCase())
            .filter(Boolean),
        ),
      ),
    [catalogPool],
  )
  const domainOptions = useMemo(
    () =>
      Array.from(
        new Set(
          catalogPool
            .map((tpl) => (tpl.domain || '').trim())
            .filter(Boolean),
        ),
      ),
    [catalogPool],
  )

  const companyMatches = useMemo(
    () => applyNameFilter(applyTagFilter(companyCandidates)),
    [applyNameFilter, applyTagFilter, companyCandidates],
  )
  const starterMatches = useMemo(
    () => applyNameFilter(applyTagFilter(starterCandidates)),
    [applyNameFilter, applyTagFilter, starterCandidates],
  )

  const recommendTemplatesClient = isMock ? mock.recommendTemplates : recommendTemplates

  const handleRecommend = async () => {
    const prompt = requirement.trim()
    if (!prompt) {
      toast.show('Describe what you need before requesting recommendations.', 'info')
      return
    }
    setRecommending(true)
    try {
      const result = await recommendTemplatesClient({
        requirement: prompt,
        limit: 6,
        kinds: kindHints,
        domains: domainHints,
      })
      const recs = Array.isArray(result?.recommendations)
        ? result.recommendations
        : Array.isArray(result)
          ? result
          : []
      setRecommendations(recs)
      setActiveTab('recommended')
    } catch (err) {
      toast.show(String(err), 'error')
    } finally {
      setRecommending(false)
    }
  }

  const handleQueueRecommend = async () => {
    const prompt = requirement.trim()
    if (!prompt) {
      toast.show('Describe what you need before queueing recommendations.', 'info')
      return
    }
    setQueueingRecommendations(true)
    try {
      const response = await queueRecommendTemplates({
        requirement: prompt,
        limit: 6,
        kinds: kindHints,
        domains: domainHints,
      })
      if (response?.job_id) {
        toast.show('Recommendation job queued. Track it in Jobs.', 'success')
      } else {
        toast.show('Failed to queue recommendations.', 'error')
      }
    } catch (err) {
      toast.show(String(err), 'error')
    } finally {
      setQueueingRecommendations(false)
    }
  }

  const handleRequirementKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleRecommend()
    }
  }

  const handleFindInAll = (templateName) => {
    const value = templateName || ""
    setNameQuery(value)
    setShowStarterInAll(true)
    setActiveTab('all')
  }

  const handleDeleteTemplate = async (template) => {
    if (!template?.id) return
    const name = template.name || template.id
    const confirmed = confirmDelete(`Delete "${name}"? This cannot be undone.`)
    if (!confirmed) return
    setDeleting(template.id)
    try {
      await deleteTemplateRequest(template.id)
      removeTemplate(template.id)
      setOutputFormats((prev) => {
        const next = { ...(prev || {}) }
        delete next[template.id]
        return next
      })
      if (selected.includes(template.id)) {
        onToggle(template.id)
      }
      queryClient.setQueryData(['templates', isMock], (prev) => {
        if (Array.isArray(prev)) {
          return prev.filter((item) => item?.id !== template.id)
        }
        if (prev && Array.isArray(prev.templates)) {
          return {
            ...prev,
            templates: prev.templates.filter((item) => item?.id !== template.id),
          }
        }
        return prev
      })
      const state = useAppStore.getState()
      savePersistedCache({
        connections: state.savedConnections,
        templates: state.templates,
        lastUsed: state.lastUsed,
      })
      toast.show(`Deleted "${name}"`, 'success')
    } catch (err) {
      toast.show(String(err), 'error')
    } finally {
      setDeleting(null)
    }
  }

  const handleImportTemplate = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const result = await importTemplateZip({ file, name: file.name.replace(/\.zip$/i, '') })
      toast.show(`Imported template "${result.name || result.template_id}"`, 'success')
      queryClient.invalidateQueries(['templates', isMock])
      queryClient.invalidateQueries(['template-catalog', isMock])
    } catch (err) {
      toast.show(`Import failed: ${err}`, 'error')
    } finally {
      setImporting(false)
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    }
  }

  const handleExportTemplate = async (template) => {
    if (!template?.id) return
    setExporting(template.id)
    try {
      await exportTemplateZip(template.id)
      toast.show(`Exported "${template.name || template.id}"`, 'success')
    } catch (err) {
      toast.show(`Export failed: ${err}`, 'error')
    } finally {
      setExporting(null)
    }
  }

  const renderCompanyGrid = (list) => (
    <Grid container spacing={2.5}>
      {list.map((t) => {
        const selectedState = selected.includes(t.id)
        const type = getTemplateKind(t).toUpperCase()
        const fmt = outputFormats[t.id] || 'auto'
        const previewInfo = resolveTemplatePreviewUrl(t)
        const htmlPreview = previewInfo.url
        const previewKey = previewInfo.key || `${t.id}-preview`
        const thumbnailInfo = resolveTemplateThumbnailUrl(t)
        const imagePreview = !htmlPreview ? thumbnailInfo.url : null
        const generatorArtifacts = {
          sql: t.artifacts?.generator_sql_pack_url,
          schemas: t.artifacts?.generator_output_schemas_url,
          meta: t.artifacts?.generator_assets_url,
        }
        const generatorMeta = t.generator || {}
        const hasGeneratorAssets = Object.values(generatorArtifacts).some(Boolean)
        const needsUserFix = Array.isArray(generatorMeta.needsUserFix) ? generatorMeta.needsUserFix : []
        const generatorStatusLabel = generatorMeta.invalid ? 'Needs review' : 'Ready'
        const generatorStatusColor = generatorMeta.invalid ? 'warning' : 'success'
        let generatorUpdated = null
        if (generatorMeta.updatedAt) {
          const parsed = new Date(generatorMeta.updatedAt)
          generatorUpdated = Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString()
        }
        const assetHref = (url) => (url ? buildDownloadUrl(withBase(url)) : null)
        const generatorReady = hasGeneratorAssets && !generatorMeta.invalid && needsUserFix.length === 0
        const lastEditInfo = buildLastEditInfo(t.generator?.summary)
        const lastEditChipLabel = lastEditInfo?.chipLabel || 'Not edited yet'
        const lastEditChipColor = lastEditInfo?.color || 'default'
        const lastEditChipVariant = lastEditInfo?.variant || 'outlined'
        const handleCardToggle = () => {
          if (!selectedState) {
            if (!hasGeneratorAssets) {
              toast.show('Generate SQL & schema assets for this template before selecting it.', 'warning')
              return
            }
            if (!generatorReady) {
              const detail = needsUserFix.length ? `Resolve: ${needsUserFix.join(', ')}` : 'Generator assets need attention.'
              toast.show(detail, 'warning')
              return
            }
          }
          onToggle(t.id)
        }
        const handleCardKeyDown = (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleCardToggle()
          }
        }

        return (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={t.id} sx={{ minWidth: 0 }}>
            <Card
              variant="outlined"
              sx={[
                {
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 300,
                  transition: 'border-color 160ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 160ms cubic-bezier(0.22, 1, 0.36, 1)',
                },
                selectedState && {
                  borderColor: 'text.secondary',
                  boxShadow: `0 0 0 1px ${alpha(secondary.violet[500], 0.28)}`,
                },
              ]}
            >
              <Checkbox
                checked={selectedState}
                onChange={() => onToggle(t.id)}
                onClick={(event) => event.stopPropagation()}
                sx={{ position: 'absolute', top: 12, left: 12, zIndex: 1 }}
                aria-label={`Select ${t.name}`}
              />
              <Box role="button" tabIndex={0} onKeyDown={handleCardKeyDown} onClick={handleCardToggle} sx={{ height: '100%', cursor: 'pointer' }}>
                <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%', flexGrow: 1 }}>
                  <Box
                    sx={{
                      minHeight: 180,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      overflow: 'hidden',
                      bgcolor: 'background.default',
                      p: 1,
                      aspectRatio: '210 / 297',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {htmlPreview ? (
                      <ScaledIframePreview
                        key={previewKey}
                        src={htmlPreview}
                        title={`${t.name} preview`}
                        sx={{ width: '100%', height: '100%' }}
                        frameAspectRatio="210 / 297"
                        pageShadow
                        pageBorderColor={alpha(neutral[900], 0.08)}
                        marginGuides={{ inset: 28, color: alpha(secondary.violet[500], 0.28) }}
                      />
                    ) : imagePreview ? (
                      <Box component="img" src={imagePreview} alt={`${t.name} preview`} loading="lazy" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
                    ) : (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}
                      >
                        No preview yet
                      </Typography>
                    )}
                  </Box>
                  <Stack spacing={0.75}>
                    {!!t.description && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {t.description}
                      </Typography>
                    )}
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                      {(t.tags || []).slice(0, 3).map((tag) => <Chip key={tag} label={tag} size="small" />)}
                      {(t.tags || []).length > 3 && <Chip size="small" variant="outlined" label={`+${(t.tags || []).length - 3}`} />}
                    </Stack>
                    {hasGeneratorAssets && (
                      <Stack spacing={0.75} sx={{ mt: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            SQL & schema assets - {generatorMeta.dialect || 'unknown'}
                          </Typography>
                          <Chip size="small" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} label={generatorStatusLabel} />
                          {!!needsUserFix.length && (
                            <Tooltip title={needsUserFix.join('\\n')}>
                              <Chip
                                size="small"
                                sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                                variant="outlined"
                                label={`${needsUserFix.length} fix${needsUserFix.length === 1 ? '' : 'es'}`}
                              />
                            </Tooltip>
                          )}
                          {generatorUpdated && (
                            <Typography variant="caption" color="text.secondary">
                              Updated {generatorUpdated}
                            </Typography>
                          )}
                        </Stack>
                        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                          {generatorArtifacts.sql && (
                            <Button
                              size="small"
                              variant="outlined"
                              component="a"
                              href={assetHref(generatorArtifacts.sql)}
                              target="_blank"
                              rel="noopener"
                              onClick={(e) => e.stopPropagation()}
                            >
                              SQL Pack
                            </Button>
                          )}
                          {generatorArtifacts.schemas && (
                            <Button
                              size="small"
                              variant="outlined"
                              component="a"
                              href={assetHref(generatorArtifacts.schemas)}
                              target="_blank"
                              rel="noopener"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Output Schemas
                            </Button>
                          )}
                          {generatorArtifacts.meta && (
                            <Button
                              size="small"
                              variant="outlined"
                              component="a"
                              href={assetHref(generatorArtifacts.meta)}
                              target="_blank"
                              rel="noopener"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Generator JSON
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                    )}
                  </Stack>
                  <Divider sx={{ mt: 'auto', my: 1 }} />
                  <Stack spacing={1} alignItems="flex-start">
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
                      {t.name}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ flexWrap: 'wrap', rowGap: 1 }}
                    >
                      <Chip size="small" label={type} variant="outlined" />
                      <Select
                        size="small"
                        value={fmt}
                        onChange={(e) => setOutputFormats((m) => ({ ...m, [t.id]: e.target.value }))}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        sx={{ bgcolor: 'background.paper', minWidth: 132 }}
                        aria-label="Output format"
                      >
                        <MenuItem value="auto">Auto ({type})</MenuItem>
                        <MenuItem value="pdf">PDF</MenuItem>
                        <MenuItem value="docx">Word (DOCX)</MenuItem>
                        <MenuItem value="xlsx">Excel (XLSX)</MenuItem>
                      </Select>
                      <Button
                        size="small"
                        variant={selectedState ? 'contained' : 'outlined'}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleCardToggle()
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        {selectedState ? 'Selected' : 'Select'}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        sx={{ color: 'text.secondary' }}
                        startIcon={
                          deleting === t.id ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <DeleteOutlineIcon fontSize="small" />
                          )
                        }
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleDeleteTemplate(t)
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        disabled={deleting === t.id}
                        aria-label={`Delete ${t.name || 'template'}`}
                      >
                        Delete
                      </Button>
                      {typeof onEditTemplate === 'function' && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<EditOutlinedIcon fontSize="small" />}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onEditTemplate(t)
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        aria-label={`Edit ${t.name || t.id}`}
                      >
                        Edit
                      </Button>
                    )}
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={
                          exporting === t.id ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <DownloadOutlinedIcon fontSize="small" />
                          )
                        }
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleExportTemplate(t)
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        disabled={exporting === t.id}
                        aria-label={`Export ${t.name || 'template'}`}
                      >
                        Export
                      </Button>
                      <Chip
                        size="small"
                        label={lastEditChipLabel}
                        color={lastEditInfo ? lastEditChipColor : 'default'}
                        variant={lastEditInfo ? lastEditChipVariant : 'outlined'}
                        sx={{ mt: 0.5 }}
                      />
                    </Stack>
                  </Stack>
                </CardContent>
              </Box>
            </Card>
          </Grid>
        )
      })}
    </Grid>
  )

  const renderStarterGrid = (list) => (
    <Grid container spacing={2.5}>
      {list.map((t) => (
        <Grid size={{ xs: 12, sm: 6, md: 4 }} key={t.id} sx={{ minWidth: 0 }}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={1}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {t.name || t.id}
                </Typography>
                {t.description && (
                  <Typography variant="body2" color="text.secondary">
                    {t.description}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  Starter template - Read-only
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  )

  const renderRecommendations = () => {
    if (!recommendations.length) {
      return (
        <EmptyState
          size="medium"
          title="No recommendations yet"
          description="Describe what you need and click Get recommendations to see suggestions."
        />
      )
    }
    return (
      <Grid container spacing={2.5}>
        {recommendations.map((entry, index) => {
          const template = entry?.template || {}
          const meta = getSourceMeta(template.source)
          const isStarter = meta.isStarter
          return (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={template.id || `rec-${index}`} sx={{ minWidth: 0 }}>
              <Card variant="outlined">
                <CardContent>
                  <Stack spacing={1.25}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {template.name || template.id || 'Template'}
                      </Typography>
                      <Chip size="small" label={meta.label} sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} variant={meta.variant} />
                    </Stack>
                    {template.description && (
                      <Typography variant="body2" color="text.secondary">
                        {template.description}
                      </Typography>
                    )}
                    {entry?.explanation && (
                      <Typography variant="body2">
                        {entry.explanation}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {isStarter ? 'Starter template - Review before use' : 'Company template - Editable'}
                    </Typography>
                    {!isStarter && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleFindInAll(template.name || template.id)}
                      >
                        Find in "All" templates
                      </Button>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          )
        })}
      </Grid>
    )
  }

  const renderAllTab = () => {
    const sections = []
    const hasCompanyTemplates = companyCandidates.length > 0
    const starterSectionList = showStarterInAll ? applyTagFilter(starterCandidates) : starterMatches
    const hasStarterTemplates = showStarterInAll && starterSectionList.length > 0
    if (hasCompanyTemplates) {
      sections.push(
        <Stack key="company" spacing={1.5}>
          <Typography variant="subtitle2">Company templates</Typography>
          {companyMatches.length ? (
            renderCompanyGrid(companyMatches)
          ) : (
            <Typography variant="body2" color="text.secondary">
              No company templates match the current filters.
            </Typography>
          )}
        </Stack>,
      )
    }
    if (hasStarterTemplates) {
      sections.push(
        <Stack key="starter" spacing={1.5}>
          <Typography variant="subtitle2">Starter templates</Typography>
          {starterSectionList.length ? (
            renderStarterGrid(starterSectionList)
          ) : (
            <Typography variant="body2" color="text.secondary">
              No starter templates match the current filters.
            </Typography>
          )}
        </Stack>,
      )
    }
    if (!sections.length) {
      return (
        <EmptyState
          size="medium"
          title="No templates match the current filters"
          description="Adjust the search text or tags to see more templates."
        />
      )
    }
    return <Stack spacing={3}>{sections}</Stack>
  }

  const renderCompanyTab = () => {
    if (!companyMatches.length) {
      return (
        <EmptyState
          size="medium"
          title="No company templates match"
          description="Try clearing the search text or adjusting the tag filters."
        />
      )
    }
    return renderCompanyGrid(companyMatches)
  }

  const renderStarterTab = () => {
    if (!starterMatches.length) {
      return (
        <EmptyState
          size="medium"
          title="No starter templates available"
          description="Starter templates will appear here when provided by the catalog."
        />
      )
    }
    return renderStarterGrid(starterMatches)
  }

  const renderRecommendedTab = () => renderRecommendations()

  const tabContent = () => {
    if (activeTab === 'company') return renderCompanyTab()
    if (activeTab === 'starter') return renderStarterTab()
    if (activeTab === 'recommended') return renderRecommendedTab()
    return renderAllTab()
  }

  const showRefreshing = (isFetching && !isLoading) || catalogQuery.isFetching

  return (
    <Surface sx={surfaceStackSx}>
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" spacing={0.75} justifyContent="space-between" flexWrap="wrap">
          <Stack direction="row" alignItems="center" spacing={0.75}>
            <Typography variant="h6">Template Picker</Typography>
            <InfoTooltip
              content={TOOLTIP_COPY.templatePicker}
              ariaLabel="Template picker guidance"
            />
          </Stack>
          <Stack direction="row" spacing={1}>
            <input
              type="file"
              accept=".zip"
              ref={importInputRef}
              onChange={handleImportTemplate}
              style={{ display: 'none' }}
              aria-label="Import template zip file"
            />
            <Button
              size="small"
              variant="outlined"
              startIcon={
                importing ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <FileUploadOutlinedIcon fontSize="small" />
                )
              }
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Import Template'}
            </Button>
          </Stack>
        </Stack>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
          <Autocomplete
            multiple
            options={allTags}
            value={tagFilter}
            onChange={(e, v) => setTagFilter(v)}
            freeSolo
            renderInput={(params) => <TextField {...params} label="Filter by tags" />}
            sx={{ maxWidth: 440 }}
          />
          <TextField
            label="Search by name"
            size="small"
            value={nameQuery}
            onChange={(e) => {
              const value = e.target.value
              setNameQuery(value)
              setShowStarterInAll(!value.trim())
            }}
            sx={{ maxWidth: 320 }}
          />
        </Stack>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1}
          alignItems={{ xs: 'stretch', md: 'center' }}
        >
          <TextField
            label="Describe what you need"
            size="small"
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            onKeyDown={handleRequirementKeyDown}
            fullWidth
            id="template-recommendation-requirement"
            InputLabelProps={{ shrink: true }}
            inputProps={{ 'aria-label': 'Describe what you need' }}
          />
          <Autocomplete
            multiple
            options={kindOptions}
            value={kindHints}
            onChange={(_e, v) => setKindHints(v)}
            size="small"
            renderInput={(params) => <TextField {...params} label="Kinds (pdf/excel)" />}
            sx={{ minWidth: 200 }}
          />
          <Autocomplete
            multiple
            options={domainOptions}
            value={domainHints}
            onChange={(_e, v) => setDomainHints(v)}
            size="small"
            renderInput={(params) => <TextField {...params} label="Domains" />}
            sx={{ minWidth: 220 }}
          />
          <Button
            variant="contained"
            onClick={handleRecommend}
            disabled={recommending || queueingRecommendations}
            sx={{ whiteSpace: 'nowrap' }}
          >
            {recommending ? 'Finding...' : 'Get recommendations'}
          </Button>
          <Button
            variant="outlined"
            onClick={handleQueueRecommend}
            disabled={recommending || queueingRecommendations}
            startIcon={
              queueingRecommendations ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <ScheduleIcon fontSize="small" />
              )
            }
            sx={{ whiteSpace: 'nowrap' }}
          >
            {queueingRecommendations ? 'Queueing...' : 'Queue'}
          </Button>
        </Stack>
      </Stack>
      <Collapse in={showRefreshing} unmountOnExit>
        <LinearProgress sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], '& .MuiLinearProgress-bar': { bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700] }, borderRadius: 1 }} aria-label="Refreshing templates" />
      </Collapse>
      {isLoading ? (
        <LoadingState
          label="Loading approved templates..."
          description="Fetching the latest approved templates from the pipeline."

// === From: src/features/generate/support.jsx ===
// SavedChartsPanel is defined below
        />
      ) : isError ? (
        <Alert severity="error">
          {String(error?.message || 'Failed to load approved templates.')}
        </Alert>
      ) : (
        <>
          <Tabs
            value={activeTab}
            onChange={(event, value) => setActiveTab(value)}
            variant="scrollable"
            allowScrollButtonsMobile
          >
            <Tab label="All" value="all" />
            <Tab label="Company" value="company" />
            <Tab label="Starter" value="starter" />
            <Tab label="Recommended" value="recommended" />
          </Tabs>
          <Box sx={{ mt: 2 }}>{tabContent()}</Box>
        </>
      )}
    </Surface>
  )
}

// === From: src/features/generate/containers.jsx ===
// TemplateChatEditor is defined above in this file

// === From: TemplateChatEditor.jsx ===

const MODE_CONFIG = {
  edit: {
    welcomeMessage: null, // uses default edit welcome
    placeholder: 'Describe the changes you want...',
    sendLabel: 'Generate edit suggestions',
  },
  create: {
    welcomeMessage: DEFAULT_CREATE_WELCOME,
    placeholder: 'Describe the report template you need...',
    sendLabel: 'Generate template',
  },
}

const ROLE_CONFIG = {
  user: {
    icon: PersonOutlineIcon,
    label: 'You',
    bgcolor: neutral[900],
    textColor: 'common.white',
  },
  assistant: {
    icon: SmartToyOutlinedIcon,
    label: 'NeuraReport',
    bgcolor: 'background.paper',
    textColor: 'text.primary',
  },
}

function ChatMessage({ message }) {
  const { role, content, timestamp } = message
  const config = ROLE_CONFIG[role] || ROLE_CONFIG.assistant
  const Icon = config.icon
  const isUser = role === 'user'

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 1.5,
        px: 2,
        py: 1.5,
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          bgcolor: isUser ? neutral[900] : neutral[500],
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon sx={{ fontSize: 18, color: 'white' }} />
      </Box>

      <Box
        sx={{
          flex: 1,
          maxWidth: isUser ? 'calc(100% - 100px)' : 'calc(100% - 48px)',
          minWidth: 0,
        }}
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{
            mb: 0.5,
            justifyContent: isUser ? 'flex-end' : 'flex-start',
          }}
        >
          <Typography variant="caption" fontWeight={600} color="text.primary">
            {config.label}
          </Typography>
          {timestamp && (
            <Typography variant="caption" color="text.disabled">
              {new Date(timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Typography>
          )}
        </Stack>

        <Box
          sx={{
            p: 2,
            borderRadius: 1,  // Figma spec: 8px
            bgcolor: isUser
              ? neutral[900]
              : 'background.paper',
            color: isUser ? 'common.white' : 'text.primary',
            boxShadow: isUser
              ? `0 2px 8px ${alpha(neutral[900], 0.2)}`
              : '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.6,
            }}
          >
            {content}
            {message.streaming && (
              <Box
                component="span"
                sx={{
                  display: 'inline-block',
                  width: 6,
                  height: 16,
                  ml: 0.5,
                  bgcolor: 'currentColor',
                  animation: 'blink 1s steps(1) infinite',
                  '@keyframes blink': {
                    '50%': { opacity: 0 },
                  },
                }}
              />
            )}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

function ProposedChangesPanel({ changes, proposedHtml, onApply, onReject, applying }) {
  const [showPreview, setShowPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)

  useEffect(() => {
    if (!proposedHtml) {
      setPreviewUrl(null)
      return
    }
    const blob = new Blob([proposedHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [proposedHtml])

  if (!changes || changes.length === 0) return null

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        mx: 2,
        mb: 2,
        borderRadius: 1,  // Figma spec: 8px
        border: '1px solid',
        borderColor: (theme) => alpha(theme.palette.divider, 0.3),
        bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <CheckCircleIcon sx={{ color: 'text.secondary' }} fontSize="small" />
          <Typography variant="subtitle2" fontWeight={600}>
            Ready to Apply Changes
          </Typography>
        </Stack>

        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Proposed modifications:
          </Typography>
          <Stack spacing={0.5}>
            {changes.map((change, idx) => (
              <Stack key={idx} direction="row" spacing={1} alignItems="flex-start">
                <Typography variant="body2" color="text.secondary">
                  •
                </Typography>
                <Typography variant="body2">
                  {change}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>

        {proposedHtml && (
          <Box>
            <Button
              size="small"
              variant="text"
              onClick={() => setShowPreview(!showPreview)}
              endIcon={showPreview ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ mb: 1 }}
            >
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </Button>
            <Collapse in={showPreview}>
              <Box
                sx={{
                  borderRadius: 1,  // Figma spec: 8px
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  p: 1,
                  height: 300,
                  overflow: 'hidden',
                }}
              >
                {previewUrl && (
                  <ScaledIframePreview
                    src={previewUrl}
                    title="Proposed changes preview"
                    fit="contain"
                    pageShadow
                    frameAspectRatio="210 / 297"
                  />
                )}
              </Box>
            </Collapse>
          </Box>
        )}

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="contained"
            onClick={onApply}
            disabled={applying}
            startIcon={applying ? <CircularProgress size={16} /> : <CheckCircleIcon />}
          >
            {applying ? 'Applying...' : 'Apply Changes'}
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            onClick={onReject}
            disabled={applying}
          >
            Request Different Changes
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}

function FollowUpQuestions({ questions, onQuestionClick }) {
  if (!questions || questions.length === 0) return null

  return (
    <Box sx={{ px: 2, pb: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <LightbulbIcon fontSize="small" color="action" />
        <Typography variant="caption" color="text.secondary">
          Quick responses:
        </Typography>
      </Stack>
      <Stack direction="row" flexWrap="wrap" gap={1}>
        {questions.map((question, idx) => (
          <Chip
            key={idx}
            label={question}
            size="small"
            variant="outlined"
            onClick={() => onQuestionClick(question)}
            sx={{
              cursor: 'pointer',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
          />
        ))}
      </Stack>
    </Box>
  )
}

const SPECIAL_VALUES = new Set(['UNRESOLVED', 'INPUT_SAMPLE', 'LATER_SELECTED'])

function humanizeToken(token) {
  return token.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function humanizeColumn(col) {
  if (!col || SPECIAL_VALUES.has(col)) return null
  // "table.column" → "Column (from Table)"
  const parts = col.split('.')
  if (parts.length === 2) {
    const table = parts[0].replace(/_/g, ' ')
    const column = parts[1].replace(/_/g, ' ')
    return `${column} from ${table}`
  }
  return col.replace(/_/g, ' ')
}

const PROGRESS_STEPS = [
  'Preparing mapping...',
  'Building contract...',
  'Generating report assets...',
  'Finalizing template...',
]

function MappingReviewPanel({ mappingData, catalog, schemaInfo, onApprove, onSkip, onQueue, approving }) {
  const [localMapping, setLocalMapping] = useState(() => ({ ...(mappingData || {}) }))
  const [showDetails, setShowDetails] = useState(false)
  const [editingToken, setEditingToken] = useState(null)
  const [progressStep, setProgressStep] = useState(0)

  const catalogOptions = (catalog || []).map((c) => c)

  const handleChange = (token, newValue) => {
    setLocalMapping((prev) => ({ ...prev, [token]: newValue || '' }))
  }

  // Cycle through progress steps while approving
  useEffect(() => {
    if (!approving) { setProgressStep(0); return }
    const timer = setInterval(() => {
      setProgressStep((prev) => (prev + 1) % PROGRESS_STEPS.length)
    }, 3000)
    return () => clearInterval(timer)
  }, [approving])

  const tokens = Object.keys(localMapping)
  const mapped = tokens.filter((t) => !SPECIAL_VALUES.has(localMapping[t]) && localMapping[t])
  const unresolved = tokens.filter((t) => SPECIAL_VALUES.has(localMapping[t]) || !localMapping[t])

  const tables = schemaInfo
    ? [schemaInfo['child table'], schemaInfo['parent table']].filter(Boolean).join(' and ')
    : null

  // --- Processing state: rolling progress ---
  if (approving) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          mx: 2,
          mb: 2,
          borderRadius: 1,
          border: '1px solid',
          borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
          bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.primary.main, 0.04),
        }}
      >
        <Stack spacing={2} alignItems="center">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <CircularProgress size={22} thickness={5} />
            <Typography variant="subtitle2" fontWeight={600}>
              Setting up your template...
            </Typography>
          </Stack>

          <Box sx={{ width: '100%' }}>
            <LinearProgress
              variant="indeterminate"
              sx={{
                height: 6,
                borderRadius: 3,
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
                '& .MuiLinearProgress-bar': { borderRadius: 3 },
              }}
            />
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ minHeight: 20, transition: 'opacity 0.3s' }}>
            {PROGRESS_STEPS[progressStep]}
          </Typography>

          {onQueue && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<QueueIcon />}
              onClick={onQueue}
              sx={{ textTransform: 'none', mt: 0.5 }}
            >
              Queue & Continue — I'll finish this in the background
            </Button>
          )}
        </Stack>
      </Paper>
    )
  }

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        mx: 2,
        mb: 2,
        borderRadius: 1,
        border: '1px solid',
        borderColor: (theme) => alpha(theme.palette.divider, 0.3),
        bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
      }}
    >
      <Stack spacing={1.5}>
        {/* Friendly summary */}
        <Typography variant="body2" sx={{ lineHeight: 1.7 }}>
          {tables && <>I found your data in the <strong>{tables}</strong> table{tables.includes(' and ') ? 's' : ''}. </>}
          {mapped.length > 0 && (
            <>I was able to connect <strong>{mapped.length} of {tokens.length}</strong> template fields to your database. </>
          )}
          {unresolved.length > 0 && (
            <>{mapped.length > 0 ? 'However, ' : ''}<strong>{unresolved.length} field{unresolved.length > 1 ? 's' : ''}</strong> still need{unresolved.length === 1 ? 's' : ''} to be configured.</>
          )}
          {unresolved.length === 0 && mapped.length > 0 && (
            <>All fields are mapped and ready to go!</>
          )}
        </Typography>

        {/* Mapped fields — compact list */}
        {mapped.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
              Connected fields:
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {mapped.map((token) => (
                <Chip
                  key={token}
                  label={`${humanizeToken(token)} → ${humanizeColumn(localMapping[token]) || localMapping[token]}`}
                  size="small"
                  variant="outlined"
                  color="success"
                  sx={{ fontSize: '0.7rem' }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {/* Unresolved fields — highlighted */}
        {unresolved.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
              Needs your input:
            </Typography>
            <Stack spacing={0.5}>
              {unresolved.map((token) => (
                <Stack key={token} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ minWidth: 120 }}>
                    {humanizeToken(token)}
                  </Typography>
                  {editingToken === token ? (
                    <Autocomplete
                      freeSolo
                      size="small"
                      options={catalogOptions}
                      value={localMapping[token] || ''}
                      onChange={(_e, newVal) => {
                        handleChange(token, newVal)
                        setEditingToken(null)
                      }}
                      onBlur={() => setEditingToken(null)}
                      renderInput={(params) => (
                        <TextField {...params} variant="outlined" autoFocus size="small" placeholder="Pick a column..."
                          sx={{ '& .MuiInputBase-root': { fontSize: '0.8rem', py: 0 } }}
                        />
                      )}
                      sx={{ flex: 1, minWidth: 150 }}
                    />
                  ) : (
                    <Chip
                      label="Select column..."
                      size="small"
                      color="warning"
                      variant="outlined"
                      onClick={() => setEditingToken(token)}
                      sx={{ cursor: 'pointer', fontSize: '0.75rem' }}
                    />
                  )}
                </Stack>
              ))}
            </Stack>
          </Box>
        )}

        {/* Expandable detail view */}
        {mapped.length > 0 && (
          <Button
            size="small"
            variant="text"
            onClick={() => setShowDetails(!showDetails)}
            endIcon={showDetails ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ alignSelf: 'flex-start', textTransform: 'none', fontSize: '0.75rem' }}
          >
            {showDetails ? 'Hide all mappings' : 'View all mappings'}
          </Button>
        )}

        <Collapse in={showDetails}>
          <Box sx={{ maxHeight: 250, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 0.5 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, bgcolor: 'background.paper', width: '40%', py: 0.5 }}>Field</TableCell>
                  <TableCell sx={{ fontWeight: 600, bgcolor: 'background.paper', py: 0.5 }}>Source</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tokens.map((token) => {
                  const value = localMapping[token]
                  const isSpecial = SPECIAL_VALUES.has(value) || !value
                  return (
                    <TableRow key={token} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                      <TableCell sx={{ py: 0.5 }}>
                        <Typography variant="body2" fontSize="0.8rem">{humanizeToken(token)}</Typography>
                      </TableCell>
                      <TableCell sx={{ py: 0.5 }}>
                        {editingToken === token ? (
                          <Autocomplete
                            freeSolo
                            size="small"
                            options={catalogOptions}
                            value={value || ''}
                            onChange={(_e, newVal) => { handleChange(token, newVal); setEditingToken(null) }}
                            onBlur={() => setEditingToken(null)}
                            renderInput={(params) => (
                              <TextField {...params} variant="outlined" autoFocus size="small"
                                sx={{ '& .MuiInputBase-root': { fontSize: '0.8rem', py: 0 } }}
                              />
                            )}
                            sx={{ minWidth: 150 }}
                          />
                        ) : (
                          <Chip
                            label={isSpecial ? 'Not set' : (humanizeColumn(value) || value)}
                            size="small"
                            color={isSpecial ? 'warning' : 'default'}
                            variant="outlined"
                            onClick={() => setEditingToken(token)}
                            sx={{ cursor: 'pointer', fontSize: '0.7rem' }}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        </Collapse>

        <Typography variant="body2" color="text.secondary" fontSize="0.8rem">
          Looks good? Approve to finalize, or tell me what you'd like to change.
        </Typography>

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="contained"
            onClick={() => onApprove(localMapping)}
            disabled={approving}
            startIcon={<CheckCircleIcon />}
            sx={{ textTransform: 'none' }}
          >
            Looks Good, Approve
          </Button>
          <Button
            variant="outlined"
            onClick={() => onApprove(mappingData)}
            disabled={approving}
            sx={{ textTransform: 'none' }}
          >
            You do this
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}

export function TemplateChatEditor({
  templateId,
  templateName,
  currentHtml,
  onHtmlUpdate,
  onApplySuccess,
  onRequestSave,
  onMappingApprove,
  onMappingSkip,
  onMappingQueue,
  mappingPreviewData,
  mappingApproving = false,
  mode = 'edit',
  chatApi = null,
}) {
  const modeConfig = MODE_CONFIG[mode] || MODE_CONFIG.edit
  // In edit mode, bind templateId into the API call; in create mode, use the provided chatApi
  const chatApiFunction = chatApi || ((messages, html) => chatTemplateEdit(templateId, messages, html))
  const toast = useToast()
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const [inputValue, setInputValue] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [followUpQuestions, setFollowUpQuestions] = useState(null)

  // Get store methods
  const getOrCreateSession = useTemplateChatStore((s) => s.getOrCreateSession)
  const getSession = useTemplateChatStore((s) => s.getSession)
  const addUserMessage = useTemplateChatStore((s) => s.addUserMessage)
  const addAssistantMessage = useTemplateChatStore((s) => s.addAssistantMessage)
  const getMessagesForApi = useTemplateChatStore((s) => s.getMessagesForApi)
  const setProposedChanges = useTemplateChatStore((s) => s.setProposedChanges)
  const clearProposedChanges = useTemplateChatStore((s) => s.clearProposedChanges)
  const clearSession = useTemplateChatStore((s) => s.clearSession)
  const { execute } = useInteraction()

  // Initialize session
  useEffect(() => {
    if (templateId) {
      getOrCreateSession(templateId, templateName, modeConfig.welcomeMessage)
    }
  }, [templateId, templateName, getOrCreateSession, modeConfig.welcomeMessage])

  const session = getSession(templateId)
  const messages = session?.messages || []
  const proposedChanges = session?.proposedChanges
  const proposedHtml = session?.proposedHtml
  const readyToApply = session?.readyToApply

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSendMessage = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || isProcessing || !templateId) return

    setInputValue('')
    setFollowUpQuestions(null)
    addUserMessage(templateId, text)

    await execute({
      type: InteractionType.GENERATE,
      label: modeConfig.sendLabel,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        templateId,
        action: mode === 'create' ? 'template_chat_create' : 'template_chat',
      },
      action: async () => {
        setIsProcessing(true)
        try {
          // Get messages for API (already includes the user message added above)
          const apiMessages = getMessagesForApi(templateId)

          const response = await chatApiFunction(apiMessages, currentHtml)

          // Add assistant response
          addAssistantMessage(templateId, response.message, {
            proposedChanges: response.proposed_changes,
            proposedHtml: response.updated_html,
            readyToApply: response.ready_to_apply,
          })

          // Update proposed changes state
          setProposedChanges(templateId, {
            proposedChanges: response.proposed_changes,
            proposedHtml: response.updated_html,
            readyToApply: response.ready_to_apply,
          })

          // In create mode, update the live preview as soon as the AI
          // produces HTML so the left-hand side stays in sync.
          if (mode === 'create' && response.updated_html) {
            onHtmlUpdate?.(response.updated_html)
          }

          // Set follow-up questions if provided
          if (response.follow_up_questions) {
            setFollowUpQuestions(response.follow_up_questions)
          }
          return response
        } catch (err) {
          toast.show(String(err.message || err), 'error')
          addAssistantMessage(
            templateId,
            "I apologize, but I encountered an error. Please try again or rephrase your request."
          )
          throw err
        } finally {
          setIsProcessing(false)
        }
      },
    })
  }, [
    inputValue,
    isProcessing,
    templateId,
    currentHtml,
    addUserMessage,
    addAssistantMessage,
    getMessagesForApi,
    setProposedChanges,
    toast,
    execute,
    chatApiFunction,
    mode,
    modeConfig.sendLabel,
  ])

  const handleApplyChanges = useCallback(async () => {
    if (!proposedHtml || !templateId) return

    await execute({
      type: InteractionType.UPDATE,
      label: 'Apply template changes',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        templateId,
        action: 'apply_template_changes',
      },
      action: async () => {
        setApplying(true)
        try {
          let result
          if (mode === 'create') {
            // In create mode the template doesn't exist on disk yet —
            // just update local state without hitting the backend.
            result = { updated_html: proposedHtml }
          } else {
            result = await applyChatTemplateEdit(templateId, proposedHtml)
          }

          // Clear proposed changes
          clearProposedChanges(templateId)

          // Notify parent of HTML update
          onHtmlUpdate?.(proposedHtml)
          onApplySuccess?.(result)

          // Add confirmation message
          if (mode === 'create') {
            addAssistantMessage(
              templateId,
              "Your template is ready! Opening the save dialog so you can name and save it."
            )
          } else {
            addAssistantMessage(
              templateId,
              "The changes have been applied successfully. Is there anything else you'd like to modify?"
            )
          }

          toast.show('Template changes applied successfully.', 'success')

          // In create mode, auto-open the save dialog
          if (mode === 'create' && onRequestSave) {
            onRequestSave()
          }

          return result
        } catch (err) {
          toast.show(String(err.message || err), 'error')
          throw err
        } finally {
          setApplying(false)
        }
      },
    })
  }, [
    proposedHtml,
    templateId,
    mode,
    clearProposedChanges,
    addAssistantMessage,
    onHtmlUpdate,
    onApplySuccess,
    onRequestSave,
    toast,
    execute,
  ])

  const handleRejectChanges = useCallback(() => {
    clearProposedChanges(templateId)
    addAssistantMessage(
      templateId,
      "No problem! What different changes would you like me to make instead?"
    )
  }, [templateId, clearProposedChanges, addAssistantMessage])

  const handleQuestionClick = useCallback((question) => {
    setInputValue(question)
    setFollowUpQuestions(null)
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSendMessage()
      }
    },
    [handleSendMessage]
  )

  const handleClearChat = useCallback(() => {
    clearSession(templateId, templateName, modeConfig.welcomeMessage)
    setFollowUpQuestions(null)
    // In create mode, also clear the parent's HTML so preview resets
    if (mode === 'create') {
      onHtmlUpdate?.('')
    }
    toast.show('Chat cleared. Starting fresh conversation.', 'info')
  }, [templateId, templateName, clearSession, toast, modeConfig.welcomeMessage, mode, onHtmlUpdate])

  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,         /* respect grid cell constraint */
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
        borderRadius: 1,  // Figma spec: 8px
        border: '1px solid',
        borderColor: 'divider',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="subtitle1" fontWeight={600}>
              {mode === 'create' ? 'AI Template Creator' : 'AI Template Editor'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {mode === 'create'
                ? 'Describe the report you need and I\'ll build it for you'
                : 'Describe the changes you want and I\'ll help you implement them'}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={handleClearChat}
            title="Clear chat and start over"
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      {/* Messages + Proposed Changes + Follow-ups — all in one scrollable area */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          py: 1,
          minHeight: 0,
        }}
      >
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {/* Proposed Changes Panel */}
        {readyToApply && proposedChanges && (
          <ProposedChangesPanel
            changes={proposedChanges}
            proposedHtml={proposedHtml}
            onApply={handleApplyChanges}
            onReject={handleRejectChanges}
            applying={applying}
          />
        )}

        {/* Mapping Review Panel — shown after template save in create mode */}
        {mappingPreviewData && onMappingApprove && (
          <MappingReviewPanel
            mappingData={mappingPreviewData.mapping}
            catalog={mappingPreviewData.catalog}
            schemaInfo={mappingPreviewData.schema_info}
            onApprove={onMappingApprove}
            onSkip={onMappingSkip}
            onQueue={onMappingQueue}
            approving={mappingApproving}
          />
        )}

        {/* Follow-up Questions */}
        <FollowUpQuestions
          questions={followUpQuestions}
          onQuestionClick={handleQuestionClick}
        />

        <div ref={messagesEndRef} />
      </Box>

      {/* Input */}
      <Box
        sx={{
          p: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            p: 1.5,
            borderRadius: 1,  // Figma spec: 8px
            bgcolor: (theme) => alpha(theme.palette.action.hover, 0.5),
            border: 1,
            borderColor: 'divider',
            transition: 'all 150ms cubic-bezier(0.22, 1, 0.36, 1)',
            '&:focus-within': {
              borderColor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
              boxShadow: (theme) =>
                `0 0 0 2px ${alpha(theme.palette.text.primary, 0.08)}`,
            },
          }}
        >
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            maxRows={4}
            placeholder={
              isProcessing
                ? 'Processing...'
                : readyToApply
                ? 'Apply the changes above or describe different modifications...'
                : modeConfig.placeholder
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing}
            variant="standard"
            InputProps={{
              disableUnderline: true,
              sx: {
                fontSize: '1rem',
                lineHeight: 1.5,
              },
            }}
            sx={{
              '& .MuiInputBase-root': {
                py: 0.5,
              },
            }}
          />

          <IconButton
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isProcessing}
            sx={{
              bgcolor: (theme) => inputValue.trim() && !isProcessing
                ? (theme.palette.mode === 'dark' ? neutral[700] : neutral[900])
                : 'action.disabledBackground',
              color: inputValue.trim() && !isProcessing
                ? 'common.white'
                : 'text.disabled',
              '&:hover': {
                bgcolor: (theme) => inputValue.trim() && !isProcessing
                  ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700])
                  : 'action.disabledBackground',
              },
            }}
          >
            {isProcessing ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              <SendIcon fontSize="small" />
            )}
          </IconButton>
        </Box>

        <Stack
          direction="row"
          spacing={2}
          justifyContent="center"
          sx={{ mt: 1 }}
        >
          <Typography variant="caption" color="text.disabled">
            Press Enter to send, Shift+Enter for new line
          </Typography>
        </Stack>
      </Box>
    </Box>
  )
}

// === From: TemplateEditor.jsx ===

// New components

// Hooks

// surfaceStackSx defined above

const FixedTextarea = forwardRef(function FixedTextarea(props, ref) {
  return <textarea {...props} ref={ref} />
})

export default function TemplateEditor() {
  const { templateId } = useParams()
  const navigate = useNavigateInteraction()
  const location = useLocation()
  const toast = useToast()
  const { execute } = useInteraction()
  const templates = useAppStore((state) => state.templates)
  const updateTemplateEntry = useAppStore((state) => state.updateTemplate)

  // Track where user came from for proper back navigation
  const referrer = location.state?.from || '/generate'

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) || null,
    [templates, templateId],
  )

  // Core editor state
  const [loading, setLoading] = useState(true)
  const [html, setHtml] = useState('')
  const [initialHtml, setInitialHtml] = useState('')
  const [instructions, setInstructions] = useState('')
  const [previewUrl, setPreviewUrl] = useState(null)
  const [saving, setSaving] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [undoBusy, setUndoBusy] = useState(false)
  const [serverMeta, setServerMeta] = useState(null)
  const [diffSummary, setDiffSummary] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState(null)

  // UI state
  const [editMode, setEditMode] = useState('manual') // 'manual' | 'chat'
  const [diffOpen, setDiffOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [previewFullscreen, setPreviewFullscreen] = useState(false)
  const [modeSwitchConfirm, setModeSwitchConfirm] = useState({ open: false, nextMode: null })

  const dirty = html !== initialHtml
  const hasInstructions = (instructions || '').trim().length > 0

  // Block in-app navigation when there are unsaved changes (BrowserRouter-compatible)
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    const originalPush = navigator.push
    const originalReplace = navigator.replace

    navigator.push = (...args) => {
      if (dirtyRef.current && !window.confirm('You have unsaved changes in the template editor. Leave without saving?')) {
        return
      }
      originalPush.apply(navigator, args)
    }
    navigator.replace = (...args) => {
      if (dirtyRef.current && !window.confirm('You have unsaved changes in the template editor. Leave without saving?')) {
        return
      }
      originalReplace.apply(navigator, args)
    }

    return () => {
      navigator.push = originalPush
      navigator.replace = originalReplace
    }
  }, [navigator])

  // Draft auto-save
  const {
    hasDraft,
    draftData,
    lastSaved,
    scheduleAutoSave,
    discardDraft,
    clearDraftAfterSave,
    saveDraft,
  } = useEditorDraft(templateId, { enabled: editMode === 'manual' })

  // Auto-save when content changes
  useEffect(() => {
    if (dirty && editMode === 'manual') {
      scheduleAutoSave(html, instructions)
    }
  }, [html, instructions, dirty, editMode, scheduleAutoSave])

  const syncTemplateMetadata = useCallback(
    (metadata) => {
      if (!metadata || !templateId || typeof updateTemplateEntry !== 'function') return
      updateTemplateEntry(templateId, (tpl) => {
        if (!tpl) return tpl
        const prevGenerator = tpl.generator || {}
        const prevSummary = prevGenerator.summary || {}
        const nextSummary = { ...prevSummary }
        const fields = ['lastEditType', 'lastEditAt', 'lastEditNotes']
        let summaryChanged = false
        fields.forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(metadata, field) && metadata[field] !== undefined) {
            if (nextSummary[field] !== metadata[field]) {
              nextSummary[field] = metadata[field]
              summaryChanged = true
            }
          }
        })
        if (!summaryChanged) {
          return tpl
        }
        return {
          ...tpl,
          generator: {
            ...prevGenerator,
            summary: nextSummary,
          },
        }
      })
    },
    [templateId, updateTemplateEntry],
  )

  const loadTemplate = useCallback(async () => {
    if (!templateId) return
    setLoading(true)
    setError(null)
    try {
      const data = await getTemplateHtml(templateId)
      if (!data || typeof data !== 'object' || typeof data.html !== 'string') {
        throw new Error('Template not found or returned invalid data')
      }
      const nextHtml = data.html
      setHtml(nextHtml)
      setInitialHtml(nextHtml)
      setServerMeta(data?.metadata || null)
      setDiffSummary(data?.diff_summary || null)
      setHistory(Array.isArray(data?.history) ? data.history : [])
      if (data?.metadata) {
        syncTemplateMetadata(data.metadata)
      }
    } catch (err) {
      setError(String(err?.message || err))
      toast.show(String(err), 'error')
    } finally {
      setLoading(false)
    }
  }, [templateId, toast, syncTemplateMetadata])

  useEffect(() => {
    loadTemplate()
  }, [loadTemplate])

  useEffect(() => {
    if (!html) {
      setPreviewUrl(null)
      return
    }
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    setPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [html])

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [dirty])

  const handleSave = useCallback(async () => {
    if (!templateId) return
    await execute({
      type: InteractionType.UPDATE,
      label: 'Save template',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        templateId,
        action: 'edit_manual',
      },
      action: async () => {
        setSaving(true)
        try {
          const data = await editTemplateManual(templateId, html)
          const nextHtml = typeof data?.html === 'string' ? data.html : html
          setHtml(nextHtml)
          setInitialHtml(nextHtml)
          setServerMeta(data?.metadata || null)
          setDiffSummary(data?.diff_summary || null)
          setHistory(Array.isArray(data?.history) ? data.history : history)
          if (data?.metadata) {
            syncTemplateMetadata(data.metadata)
          }
          clearDraftAfterSave()
          toast.show('Template HTML saved.', 'success')
          return data
        } catch (err) {
          toast.show(String(err), 'error')
          throw err
        } finally {
          setSaving(false)
        }
      },
    })
  }, [templateId, html, toast, syncTemplateMetadata, clearDraftAfterSave, history, execute])

  const handleApplyAi = useCallback(async () => {
    if (!templateId) return
    const text = (instructions || '').trim()
    if (!text) {
      toast.show('Enter AI instructions before applying.', 'info')
      return
    }
    await execute({
      type: InteractionType.GENERATE,
      label: 'Apply AI edit',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        templateId,
        action: 'edit_ai',
      },
      action: async () => {
        setAiBusy(true)
        try {
          const data = await editTemplateAi(templateId, text, html)
          const nextHtml = typeof data?.html === 'string' ? data.html : html
          setHtml(nextHtml)
          setInitialHtml(nextHtml)
          setServerMeta(data?.metadata || null)
          setDiffSummary(data?.diff_summary || null)
          setHistory(Array.isArray(data?.history) ? data.history : history)
          if (data?.metadata) {
            syncTemplateMetadata(data.metadata)
          }
          setInstructions('')
          clearDraftAfterSave()
          const changes = Array.isArray(data?.summary) ? data.summary : []
          if (changes.length) {
            toast.show(`AI updated template: ${changes.join('; ')}`, 'success')
          } else {
            toast.show('AI updated the template HTML.', 'success')
          }
          return data
        } catch (err) {
          toast.show(String(err), 'error')
          throw err
        } finally {
          setAiBusy(false)
        }
      },
    })
  }, [templateId, html, instructions, toast, syncTemplateMetadata, clearDraftAfterSave, history, execute])

  const handleUndo = useCallback(async () => {
    if (!templateId) return
    await execute({
      type: InteractionType.UPDATE,
      label: 'Undo template edit',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        templateId,
        action: 'undo_edit',
      },
      action: async () => {
        setUndoBusy(true)
        try {
          const data = await undoTemplateEdit(templateId)
          const nextHtml = typeof data?.html === 'string' ? data.html : html
          setHtml(nextHtml)
          setInitialHtml(nextHtml)
          setServerMeta(data?.metadata || null)
          setDiffSummary(data?.diff_summary || null)
          setHistory(Array.isArray(data?.history) ? data.history : history)
          if (data?.metadata) {
            syncTemplateMetadata(data.metadata)
          }
          toast.show('Reverted to the previous template version.', 'success')
          return data
        } catch (err) {
          toast.show(String(err), 'error')
          throw err
        } finally {
          setUndoBusy(false)
        }
      },
    })
  }, [templateId, html, toast, syncTemplateMetadata, history, execute])

  const handleBack = () => {
    if (dirty && typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'You have unsaved changes. Leave the editor and discard them?',
      )
      if (!confirmed) return
    }
    navigate(referrer, {
      label: 'Back to templates',
      intent: { referrer },
    })
  }

  const handleEditModeChange = (event, newMode) => {
    if (newMode !== null) {
      if (dirty && newMode === 'chat') {
        setModeSwitchConfirm({ open: true, nextMode: newMode })
        return
      }
      setEditMode(newMode)
    }
  }

  const handleChatHtmlUpdate = useCallback((newHtml) => {
    setHtml(newHtml)
    setInitialHtml(newHtml)
  }, [])

  const handleChatApplySuccess = useCallback((result) => {
    if (result?.metadata) {
      setServerMeta(result.metadata)
      syncTemplateMetadata(result.metadata)
    }
    if (result?.diff_summary) {
      setDiffSummary(result.diff_summary)
    }
    if (Array.isArray(result?.history)) {
      setHistory(result.history)
    }
  }, [syncTemplateMetadata])

  const handleRestoreDraft = useCallback(() => {
    if (draftData) {
      setHtml(draftData.html || '')
      if (draftData.instructions) {
        setInstructions(draftData.instructions)
      }
      discardDraft()
      toast.show('Draft restored successfully.', 'success')
    }
  }, [draftData, discardDraft, toast])

  // Keyboard shortcuts
  useEditorKeyboardShortcuts({
    onSave: handleSave,
    onUndo: handleUndo,
    onApplyAi: handleApplyAi,
    onEscape: () => {
      if (diffOpen) setDiffOpen(false)
      if (shortcutsOpen) setShortcutsOpen(false)
    },
    enabled: editMode === 'manual' && !loading,
    dirty,
    hasInstructions,
  })

  const lastEditInfo = buildLastEditInfo(serverMeta)
  const breadcrumbLabel = referrer === '/' ? 'Setup' : 'Generate'

  return (
    <>
      {/* Breadcrumb Navigation */}
      <Box sx={{ mb: 2 }}>
        <Breadcrumbs
          separator={<NavigateNextIcon fontSize="small" />}
          aria-label="breadcrumb"
        >
          <Link
            component={RouterLink}
            to={referrer}
            underline="hover"
            color="text.secondary"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            {breadcrumbLabel}
          </Link>
            <Typography color="text.primary" fontWeight={600}>
              Edit Design
            </Typography>
        </Breadcrumbs>
      </Box>

      <Surface sx={surfaceStackSx}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5} flexWrap="wrap">
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Typography variant="h5" fontWeight={600}>
                {template?.name || 'Design Editor'}
              </Typography>
              <AutoSaveIndicator lastSaved={lastSaved} dirty={dirty} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {templateId ? `ID: ${templateId}` : 'No template selected'}
            </Typography>
            {lastEditInfo && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Last edit: {lastEditInfo.chipLabel}
              </Typography>
            )}
            {diffSummary && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Recent change: {diffSummary}
              </Typography>
            )}
          </Box>

          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            {/* Edit mode toggle */}
            <ToggleButtonGroup
              value={editMode}
              exclusive
              onChange={handleEditModeChange}
              size="small"
              aria-label="Edit mode"
            >
              <ToggleButton value="manual" aria-label="Manual edit mode">
                <Tooltip title="Code Editor - Edit HTML directly with AI assistance">
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <CodeIcon fontSize="small" />
                    <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
                      Code
                    </Typography>
                  </Stack>
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="chat" aria-label="Chat edit mode">
                <Tooltip title="Chat Editor - Conversational AI editing">
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <ChatIcon fontSize="small" />
                    <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
                      Chat
                    </Typography>
                  </Stack>
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>

            {/* Keyboard shortcuts button */}
            <Tooltip title="Keyboard shortcuts">
              <IconButton size="small" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts">
                <KeyboardIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Button
              variant="outlined"
              onClick={handleBack}
              startIcon={<ArrowBackIcon />}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Back to {breadcrumbLabel}
            </Button>
          </Stack>
        </Stack>

        <AiUsageNotice
          dense
          title="AI editing"
          description="AI edits apply to this report design. Review changes before saving."
          chips={[
            { label: 'Source: Design + instructions', color: 'info', variant: 'outlined' },
            { label: 'Confidence: Review required', color: 'warning', variant: 'outlined' },
            { label: 'Undo available', color: 'success', variant: 'outlined' },
          ]}
          sx={{ mb: 1 }}
        />

        {/* Draft recovery banner */}
        <DraftRecoveryBanner
          show={hasDraft && !loading && editMode === 'manual'}
          draftData={draftData}
          onRestore={handleRestoreDraft}
          onDiscard={discardDraft}
        />

        {/* Error display — show not-found with back link when template fails to load */}
        {error && (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" component={RouterLink} to={referrer}>
                Back
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {/* Main content — or not-found state when template fails to load */}
        {!loading && error && !html ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Template Not Found
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              The template &ldquo;{templateId}&rdquo; could not be loaded. It may have been deleted or the ID is invalid.
            </Typography>
            <Button variant="contained" component={RouterLink} to="/templates">
              Go to Templates
            </Button>
          </Box>
        ) : loading ? (
          <>
            <Divider />
            <EditorSkeleton mode={editMode} />
          </>
        ) : editMode === 'chat' ? (
          <>
            <Divider />
            <Grid container spacing={2.5} sx={{ alignItems: 'stretch' }}>
              {/* Preview Panel */}
              <Grid size={{ xs: 12, md: previewFullscreen ? 12 : 5 }} sx={{ minWidth: 0 }}>
                <Stack spacing={1.5} sx={{ height: '100%' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle1">Preview</Typography>
                    <Tooltip title={previewFullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}>
                      <IconButton size="small" onClick={() => setPreviewFullscreen(!previewFullscreen)} aria-label={previewFullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}>
                        {previewFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  {previewUrl ? (
                    <Box
                      sx={{
                        borderRadius: 1.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                        p: 1.5,
                        minHeight: previewFullscreen ? 600 : 400,
                        transition: 'min-height 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    >
                      <ScaledIframePreview
                        src={previewUrl}
                        title={`Template preview for ${templateId}`}
                        fit="contain"
                        pageShadow
                        frameAspectRatio="210 / 297"
                        clampToParentHeight
                      />
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        borderRadius: 1.5,
                        border: '1px dashed',
                        borderColor: 'divider',
                        bgcolor: 'background.default',
                        p: 2,
                        minHeight: 400,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        No HTML loaded yet.
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </Grid>

              {/* Chat Editor */}
              {!previewFullscreen && (
                <Grid size={{ xs: 12, md: 7 }} sx={{ minWidth: 0 }}>
                  <Box sx={{ height: 600 }}>
                    <TemplateChatEditor
                      templateId={templateId}
                      templateName={template?.name || 'Template'}
                      currentHtml={html}
                      onHtmlUpdate={handleChatHtmlUpdate}
                      onApplySuccess={handleChatApplySuccess}
                    />
                  </Box>
                </Grid>
              )}
            </Grid>
          </>
        ) : (
          <>
            <Divider />
            <Grid container spacing={2.5} sx={{ alignItems: 'stretch' }}>
              {/* Preview Panel */}
              <Grid size={{ xs: 12, md: previewFullscreen ? 12 : 6 }} sx={{ minWidth: 0 }}>
                <Stack spacing={1.5} sx={{ height: '100%' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="subtitle1">Preview</Typography>
                    <Tooltip title={previewFullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}>
                      <IconButton size="small" onClick={() => setPreviewFullscreen(!previewFullscreen)} aria-label={previewFullscreen ? 'Exit fullscreen' : 'Fullscreen preview'}>
                        {previewFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </Stack>
                  {previewUrl ? (
                    <Box
                      sx={{
                        borderRadius: 1.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                        p: 1.5,
                        minHeight: previewFullscreen ? 500 : 200,
                        flex: 1,
                        transition: 'min-height 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
                      }}
                    >
                      <ScaledIframePreview
                        src={previewUrl}
                        title={`Template preview for ${templateId}`}
                        fit="contain"
                        pageShadow
                        frameAspectRatio="210 / 297"
                        clampToParentHeight
                      />
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        borderRadius: 1.5,
                        border: '1px dashed',
                        borderColor: 'divider',
                        bgcolor: 'background.default',
                        p: 2,
                        minHeight: 200,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        No HTML loaded yet.
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </Grid>

              {/* Editor Panel */}
              {!previewFullscreen && (
                <Grid size={{ xs: 12, md: 6 }} sx={{ minWidth: 0 }}>
                  <Stack spacing={1.5} sx={{ height: '100%' }}>
                    <Typography variant="subtitle1">HTML &amp; AI Guidance</Typography>

                    {/* HTML Editor */}
                    <TextField
                      label="Design HTML"
                      value={html}
                      onChange={(e) => setHtml(e.target.value)}
                      inputProps={{ 'aria-label': 'Template HTML' }}
                      multiline
                      minRows={10}
                      maxRows={24}
                      fullWidth
                      variant="outlined"
                      size="small"
                      error={dirty}
                      helperText={
                        dirty
                          ? `Unsaved changes. Press ${getShortcutDisplay('save')} to save.`
                          : 'HTML is in sync with the saved template.'
                      }
                      InputLabelProps={{ shrink: true }}
                      sx={{
                        '& .MuiInputBase-input': {
                          fontFamily: 'monospace',
                          fontSize: '14px',
                        },
                      }}
                    />

                    {/* AI Instructions */}
                    <TextField
                      label="AI Instructions"
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      multiline
                      rows={3}
                      InputProps={{ inputComponent: FixedTextarea }}
                      fullWidth
                      variant="outlined"
                      size="small"
                      placeholder="Describe how the template should change. AI will preserve tokens and structure unless you ask otherwise."
                      helperText={
                        hasInstructions
                          ? `Press ${getShortcutDisplay('applyAi')} or click Apply to run AI.`
                          : 'Enter instructions to enable AI editing.'
                      }
                      InputLabelProps={{ shrink: true }}
                    />

                    {/* Action Buttons */}
                    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ gap: 1 }}>
                      <Button
                        variant="contained"
                        color="primary"
                        onClick={handleSave}
                        disabled={saving || loading || !dirty || aiBusy}
                        startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
                        sx={{ minWidth: 110 }}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={handleApplyAi}
                        disabled={aiBusy || loading || !hasInstructions}
                        startIcon={aiBusy ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
                        sx={{ minWidth: 130, color: 'text.secondary', borderColor: 'divider' }}
                      >
                        {aiBusy ? 'Applying...' : 'Apply AI'}
                      </Button>
                      <Button
                        variant="text"
                        color="inherit"
                        onClick={handleUndo}
                        disabled={undoBusy || loading}
                        startIcon={undoBusy ? <CircularProgress size={16} /> : <UndoIcon />}
                      >
                        {undoBusy ? 'Undoing...' : 'Undo'}
                      </Button>
                      <Button
                        variant="text"
                        onClick={() => setDiffOpen(true)}
                        disabled={loading || !dirty}
                        startIcon={<CompareArrowsIcon />}
                        sx={{ color: 'text.secondary' }}
                      >
                        View Diff
                      </Button>
                    </Stack>

                    <Typography variant="caption" color="text.secondary">
                      AI edits are generated and may need review before use in production runs.
                    </Typography>

                    {/* Keyboard shortcuts hint */}
                    <KeyboardShortcutsPanel compact />

                    {/* Edit History */}
                    <EditHistoryTimeline history={history} maxVisible={5} />
                  </Stack>
                </Grid>
              )}
            </Grid>
          </>
        )}
      </Surface>

      {/* Enhanced Diff Dialog */}
      <Dialog
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: { height: '80vh', maxHeight: 800 },
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6">HTML Changes</Typography>
            <Typography variant="caption" color="text.secondary">
              Compare saved version with current edits
            </Typography>
          </Box>
          <Tooltip title="Close">
            <IconButton onClick={() => setDiffOpen(false)} aria-label="Close dialog">
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
          <EnhancedDiffViewer beforeText={initialHtml} afterText={html} contextLines={3} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiffOpen(false)}>Close</Button>
          <Button
            variant="contained"
            onClick={() => {
              handleSave()
              setDiffOpen(false)
            }}
            disabled={saving || !dirty}
          >
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Keyboard Shortcuts Dialog */}
      <Dialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Keyboard Shortcuts
          <Tooltip title="Close">
            <IconButton onClick={() => setShortcutsOpen(false)} aria-label="Close dialog">
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </DialogTitle>
        <DialogContent>
          <KeyboardShortcutsPanel />
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={modeSwitchConfirm.open}
        onClose={() => setModeSwitchConfirm({ open: false, nextMode: null })}
        onConfirm={() => {
          if (dirty) {
            saveDraft(html, instructions)
          }
          setModeSwitchConfirm({ open: false, nextMode: null })
          setEditMode(modeSwitchConfirm.nextMode || 'chat')
          toast.show('Draft saved. Your current edits are still available in chat and manual modes.', 'info')
        }}
        title="Switch to Chat Mode"
        message="Switching to chat mode keeps your current edits and saves a draft for manual mode."
        confirmLabel="Switch"
        severity="warning"
      />
    </>
  )
}
