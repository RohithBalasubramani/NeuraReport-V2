import * as api from '@/api/client'
import * as recommendationsApi from '@/api/intelligence'
import { TemplateChatEditor } from '@/features/Generate.jsx'
import {
  chatTemplateCreate,
  createTemplateFromChat,
  mappingApprove,
  mappingPreview,
  runTemplateAgent,
} from '@/api/client'
import { neutral, palette, status as statusColors } from '@/app/theme'
import { ConnectionSelector, FavoriteButton, Surface, useToast } from '@/components/core'
import { DataTable } from '@/components/data'
import { InteractionType, Reversibility, useInteraction, useNavigateInteraction } from '@/components/governance'
import { ConfirmModal } from '@/components/modals'
import { ReportGlossaryNotice } from '@/components/ux'
import { useAppStore } from '@/stores/app'
import { CANVAS_MODES, useTemplateChatStore, useTemplateCreatorStore } from '@/stores/content'
import { GlassDialog as StyledDialog, PaddedPageContainer as PageContainer, StyledFormControl, fadeInUp, pulse } from '@/styles/styles'
import AddIcon from '@mui/icons-material/Add'
import ArchiveIcon from '@mui/icons-material/Archive'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import BuildIcon from '@mui/icons-material/Build'
import CancelIcon from '@mui/icons-material/Cancel'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CloseIcon from '@mui/icons-material/Close'
import CompareArrowsIcon from '@mui/icons-material/CompareArrows'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import TokenIcon from '@mui/icons-material/DataObject'
import DeleteIcon from '@mui/icons-material/Delete'
import DescriptionIcon from '@mui/icons-material/Description'
import DifferenceIcon from '@mui/icons-material/Difference'
import DocumentScannerIcon from '@mui/icons-material/DocumentScanner'
import DownloadIcon from '@mui/icons-material/Download'
import EditIcon from '@mui/icons-material/Edit'
import ErrorIcon from '@mui/icons-material/Error'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import LabelIcon from '@mui/icons-material/Label'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import PreviewIcon from '@mui/icons-material/Preview'
import PushPinIcon from '@mui/icons-material/PushPin'
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import SaveIcon from '@mui/icons-material/Save'
import SearchIcon from '@mui/icons-material/Search'
import SettingsIcon from '@mui/icons-material/Settings'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import StorageIcon from '@mui/icons-material/Storage'
import TableChartIcon from '@mui/icons-material/TableChart'
import TimelineIcon from '@mui/icons-material/Timeline'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import VerifiedIcon from '@mui/icons-material/Verified'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputLabel,
  LinearProgress,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
const QA_DEBOUNCE_MS = 2000

/**
 * Watches store state and auto-triggers backend agents.
 *
 * Trigger rules:
 *   template_qa  → when currentHtml changes (debounced 2s)
 *   data_mapping → when currentHtml + connectionId both exist
 *   data_quality → when connectionId changes while HTML exists
 */
function useAgentTrigger() {
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)
  const templateId = useTemplateCreatorStore((s) => s.templateId)
  const connectionId = useTemplateCreatorStore((s) => s.connectionId)
  const setAgentLoading = useTemplateCreatorStore((s) => s.setAgentLoading)
  const setAgentResult = useTemplateCreatorStore((s) => s.setAgentResult)

  // Track what we already analysed to avoid duplicate calls
  const lastQaHtml = useRef(null)
  const lastMappingKey = useRef(null)
  const qaTimer = useRef(null)

  // ── template_qa: debounced on HTML change ──
  useEffect(() => {
    if (!currentHtml || currentHtml === lastQaHtml.current) return

    clearTimeout(qaTimer.current)
    qaTimer.current = setTimeout(() => {
      const htmlSnapshot = currentHtml
      lastQaHtml.current = htmlSnapshot
      setAgentLoading('template_qa', true)

      // templateId may not exist yet for brand-new templates — use a placeholder
      const id = templateId || '__draft__'

      runTemplateAgent(id, 'template_qa', { html_content: htmlSnapshot })
        .then((resp) => {
          // Only apply if HTML hasn't changed again while we waited
          if (useTemplateCreatorStore.getState().currentHtml === htmlSnapshot) {
            setAgentResult('template_qa', resp?.result ?? resp)
          }
        })
        .catch((err) => {
          console.warn('[useAgentTrigger] template_qa failed:', err.message || err)
        })
        .finally(() => {
          setAgentLoading('template_qa', false)
        })
    }, QA_DEBOUNCE_MS)

    return () => clearTimeout(qaTimer.current)
  }, [currentHtml, templateId, setAgentLoading, setAgentResult])

  // ── data_mapping: when HTML + connection both exist ──
  useEffect(() => {
    if (!currentHtml || !connectionId) return

    const key = `${connectionId}::${currentHtml.length}`
    if (key === lastMappingKey.current) return
    lastMappingKey.current = key

    const id = templateId || '__draft__'
    setAgentLoading('data_mapping', true)

    runTemplateAgent(id, 'data_mapping', {
      html_content: currentHtml,
      connection_id: connectionId,
    })
      .then((resp) => {
        setAgentResult('data_mapping', resp?.result ?? resp)
      })
      .catch((err) => {
        console.warn('[useAgentTrigger] data_mapping failed:', err.message || err)
      })
      .finally(() => {
        setAgentLoading('data_mapping', false)
      })
  }, [currentHtml, connectionId, templateId, setAgentLoading, setAgentResult])
}


/**
 * Hook: determines current canvas mode from store state.
 *
 * Priority-ordered rules — first match wins.
 * Returns one of: 'extraction' | 'mapping' | 'diff' | 'validation' | 'data_preview' | 'insights'
 */
function useCanvasMode() {
  const canvasModeOverride = useTemplateCreatorStore((s) => s.canvasModeOverride)
  const validating = useTemplateCreatorStore((s) => s.validating)
  const validationIssues = useTemplateCreatorStore((s) => s.validationIssues)
  const htmlDiff = useTemplateCreatorStore((s) => s.htmlDiff)
  const selectedToken = useTemplateCreatorStore((s) => s.selectedToken)
  const mappingLoading = useTemplateCreatorStore((s) => s.mappingLoading)
  const schemaExt = useTemplateCreatorStore((s) => s.schemaExt)
  const autoMapping = useTemplateCreatorStore((s) => s.autoMapping)
  const userMapping = useTemplateCreatorStore((s) => s.userMapping)
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)
  const connectionId = useTemplateCreatorStore((s) => s.connectionId)
  const dataPreviewRequested = useTemplateCreatorStore((s) => s.dataPreviewRequested)

  // User override takes highest priority
  if (canvasModeOverride) return canvasModeOverride

  // Validation active or issues present
  if (validating || validationIssues.length > 0) return 'validation'

  // HTML just changed — show diff
  if (htmlDiff) return 'diff'

  // Token selected or mapping in progress
  if (selectedToken || mappingLoading) return 'mapping'

  // Tokens exist but not yet mapped
  if (schemaExt && Object.keys(userMapping).length === 0 && Object.keys(autoMapping).length === 0) {
    return 'mapping'
  }

  // HTML exists but schema not analyzed yet
  if (currentHtml && !schemaExt) return 'extraction'

  // Data preview explicitly requested
  if (connectionId && dataPreviewRequested) return 'data_preview'

  // Default
  return 'insights'
}

// === From: cards.jsx ===
/**
 * Intelligence Canvas Card Components (merged)
 */


/**
 * Shared card shell for Intelligence Canvas cards.
 *
 * Structure:
 * ┌─────────────────────────────────────┐
 * │ Icon  Card Title         [Pin][^/v] │
 * │─────────────────────────────────────│
 * │  Content (max 300px, scrollable)    │
 * │─────────────────────────────────────│
 * │ [Action buttons]                    │
 * └─────────────────────────────────────┘
 */
function CanvasCard({
  id,
  icon: Icon,
  title,
  children,
  actions,
  defaultExpanded = true,
  loading = false,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const pinnedCards = useTemplateCreatorStore((s) => s.pinnedCards)
  const pinCard = useTemplateCreatorStore((s) => s.pinCard)
  const unpinCard = useTemplateCreatorStore((s) => s.unpinCard)

  const isPinned = pinnedCards.includes(id)

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 1,
        overflow: 'hidden',
        opacity: loading ? 0.6 : 1,
        transition: 'opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/* Header */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: 1.5,
          py: 0.75,
          bgcolor: 'background.default',
          borderBottom: expanded ? '1px solid' : 'none',
          borderColor: 'divider',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
          transition: 'background-color 100ms',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {Icon && <Icon sx={{ fontSize: 18, color: 'text.secondary' }} />}
        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
          {title}
        </Typography>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            isPinned ? unpinCard(id) : pinCard(id)
          }}
          sx={{ p: 0.25 }}
        >
          {isPinned ? (
            <PushPinIcon sx={{ fontSize: 14, color: 'primary.main' }} />
          ) : (
            <PushPinOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          )}
        </IconButton>
        {expanded ? (
          <ExpandLessIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
        )}
      </Stack>

      {/* Content */}
      <Collapse in={expanded}>
        <Box
          sx={{
            maxHeight: 300,
            overflow: 'auto',
            p: 1.5,
          }}
        >
          {children}
        </Box>

        {/* Actions */}
        {actions && (
          <Stack
            direction="row"
            spacing={1}
            sx={{
              px: 1.5,
              py: 1,
              borderTop: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.default',
            }}
          >
            {actions}
          </Stack>
        )}
      </Collapse>
    </Paper>
  )
}


const TOKEN_RE = /\{(\w+)\}/g
const ROW_PREFIX = /^row_/

/**
 * Instant token extraction summary — no agent call needed.
 * Parses {token} patterns from the current HTML and categorises them.
 */
function ExtractionSummaryCard() {
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)

  const { scalars, rowTokens, total } = useMemo(() => {
    if (!currentHtml) return { scalars: [], rowTokens: [], total: 0 }
    const allTokens = [...new Set(
      Array.from(currentHtml.matchAll(TOKEN_RE), (m) => m[1])
    )]
    const row = allTokens.filter((t) => ROW_PREFIX.test(t))
    const scalar = allTokens.filter((t) => !ROW_PREFIX.test(t))
    return { scalars: scalar, rowTokens: row, total: allTokens.length }
  }, [currentHtml])

  if (!currentHtml || total === 0) return null

  return (
    <CanvasCard id="extraction_summary" icon={TokenIcon} title="Tokens Found">
      <Stack spacing={1.5}>
        <Typography variant="body2" fontWeight={600}>
          {total} token{total !== 1 ? 's' : ''} detected
        </Typography>

        {scalars.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              Scalar fields ({scalars.length})
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {scalars.map((t) => (
                <Chip key={t} label={`{${t}}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
              ))}
            </Stack>
          </Box>
        )}

        {rowTokens.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              Row / table fields ({rowTokens.length})
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.5}>
              {rowTokens.map((t) => (
                <Chip
                  key={t}
                  label={`{${t}}`}
                  size="small"
                  variant="outlined"
                  color="primary"
                  sx={{ fontSize: '0.7rem' }}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </CanvasCard>
  )
}


function confidenceColor(conf) {
  if (conf >= 0.8) return 'success'
  if (conf >= 0.5) return 'warning'
  return 'error'
}

function humanizeToken(token) {
  return token.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Token→column mapping table with confidence bars, inline accept/reject.
 * Data comes from autoMapping/userMapping in store or data_mapping agent result.
 */
function MappingTableCard() {
  const autoMapping = useTemplateCreatorStore((s) => s.autoMapping)
  const userMapping = useTemplateCreatorStore((s) => s.userMapping)
  const mappingConfidence = useTemplateCreatorStore((s) => s.mappingConfidence)
  const unmappedTokens = useTemplateCreatorStore((s) => s.unmappedTokens)
  const mappingLoading = useTemplateCreatorStore((s) => s.mappingLoading)
  const updateUserMapping = useTemplateCreatorStore((s) => s.updateUserMapping)
  const removeUserMapping = useTemplateCreatorStore((s) => s.removeUserMapping)
  const setSelectedToken = useTemplateCreatorStore((s) => s.setSelectedToken)
  const agentMappingResult = useTemplateCreatorStore((s) => s.agentResults.data_mapping)

  // Merge sources: agent result takes priority, then auto/user mapping
  const mappings = agentMappingResult?.mappings || []
  const mergedMapping = { ...autoMapping, ...userMapping }
  const tokens = Object.keys(mergedMapping)

  if (tokens.length === 0 && mappings.length === 0 && !mappingLoading) return null

  return (
    <CanvasCard
      id="mapping_table"
      icon={CompareArrowsIcon}
      title={`Mappings (${tokens.length || mappings.length})`}
      loading={mappingLoading}
    >
      {mappingLoading ? (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Generating mapping suggestions...
          </Typography>
          <LinearProgress />
        </Stack>
      ) : (
        <Stack spacing={1}>
          {/* Agent mappings with confidence */}
          {mappings.length > 0 ? (
            <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, py: 0.5, fontSize: '0.7rem', bgcolor: 'background.paper' }}>Token</TableCell>
                    <TableCell sx={{ fontWeight: 600, py: 0.5, fontSize: '0.7rem', bgcolor: 'background.paper' }}>Column</TableCell>
                    <TableCell sx={{ fontWeight: 600, py: 0.5, fontSize: '0.7rem', bgcolor: 'background.paper', width: 70 }}>Conf</TableCell>
                    <TableCell sx={{ py: 0.5, bgcolor: 'background.paper', width: 60 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {mappings.map((m) => (
                    <TableRow
                      key={m.token}
                      hover
                      onClick={() => setSelectedToken(m.token)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ py: 0.5 }}>
                        <Typography variant="caption" fontWeight={500}>
                          {humanizeToken(m.token)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          {m.column}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 0.5 }}>
                        <Chip
                          label={`${Math.round(m.confidence * 100)}%`}
                          size="small"
                          color={confidenceColor(m.confidence)}
                          variant="outlined"
                          sx={{ fontSize: '0.6rem', height: 20 }}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 0.5 }}>
                        <Stack direction="row" spacing={0.25}>
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); updateUserMapping(m.token, m.column) }}
                            title="Accept"
                            sx={{ p: 0.25 }}
                          >
                            <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); removeUserMapping(m.token) }}
                            title="Reject"
                            sx={{ p: 0.25 }}
                          >
                            <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />
                          </IconButton>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ) : tokens.length > 0 ? (
            /* Fallback: show store-based mappings */
            <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
              <Table size="small">
                <TableBody>
                  {tokens.map((token) => (
                    <TableRow
                      key={token}
                      hover
                      onClick={() => setSelectedToken(token)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ py: 0.5 }}>
                        <Typography variant="caption" fontWeight={500}>
                          {humanizeToken(token)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ py: 0.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          {mergedMapping[token] || 'Unmapped'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ) : null}

          {/* Unmapped tokens */}
          {unmappedTokens.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={600} color="warning.main">
                Unmapped ({unmappedTokens.length})
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
                {unmappedTokens.map((t) => (
                  <Chip
                    key={t}
                    label={humanizeToken(t)}
                    size="small"
                    color="warning"
                    variant="outlined"
                    onClick={() => setSelectedToken(t)}
                    sx={{ fontSize: '0.65rem', cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      )}
    </CanvasCard>
  )
}


/**
 * Ranked candidates for selected token + sample values.
 * Shows when a token is selected in the template or mapping table.
 */
function MappingCandidatesCard() {
  const selectedToken = useTemplateCreatorStore((s) => s.selectedToken)
  const agentResult = useTemplateCreatorStore((s) => s.agentResults.data_mapping)
  const catalog = useTemplateCreatorStore((s) => s.catalog)
  const userMapping = useTemplateCreatorStore((s) => s.userMapping)
  const updateUserMapping = useTemplateCreatorStore((s) => s.updateUserMapping)
  const clearSelectedToken = useTemplateCreatorStore((s) => s.clearSelectedToken)

  if (!selectedToken) return null

  // Find candidates from agent result
  const candidates = (agentResult?.mappings || [])
    .filter((m) => m.token === selectedToken)
    .sort((a, b) => b.confidence - a.confidence)

  const currentMapping = userMapping[selectedToken]

  return (
    <CanvasCard
      id="mapping_candidates"
      icon={SearchIcon}
      title={`Candidates for "${humanizeToken(selectedToken)}"`}
      actions={
        <Button
          size="small"
          variant="text"
          onClick={clearSelectedToken}
          sx={{ textTransform: 'none', fontSize: '0.7rem' }}
        >
          Clear Selection
        </Button>
      }
    >
      <Stack spacing={1}>
        {/* Current mapping */}
        {currentMapping && (
          <Box
            sx={{
              p: 1,
              borderRadius: 0.5,
              bgcolor: (theme) => alpha(theme.palette.success.main, 0.08),
              border: '1px solid',
              borderColor: (theme) => alpha(theme.palette.success.main, 0.3),
            }}
          >
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />
              <Typography variant="caption" fontWeight={600}>
                Current: {currentMapping}
              </Typography>
            </Stack>
          </Box>
        )}

        {/* Ranked candidates */}
        {candidates.length > 0 ? (
          candidates.map((c, idx) => (
            <Box
              key={idx}
              sx={{
                p: 1,
                borderRadius: 0.5,
                border: '1px solid',
                borderColor: 'divider',
                cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
                transition: 'background-color 100ms',
              }}
              onClick={() => updateUserMapping(selectedToken, c.column)}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="caption" fontWeight={500}>
                  {c.column}
                </Typography>
                <Chip
                  label={`${Math.round(c.confidence * 100)}%`}
                  size="small"
                  color={c.confidence >= 0.8 ? 'success' : c.confidence >= 0.5 ? 'warning' : 'error'}
                  variant="outlined"
                  sx={{ fontSize: '0.6rem', height: 18 }}
                />
              </Stack>
              {c.reason && (
                <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem', mt: 0.25, display: 'block' }}>
                  {c.reason}
                </Typography>
              )}
            </Box>
          ))
        ) : (
          <Box>
            <Typography variant="caption" color="text.secondary">
              No agent suggestions available. Choose from catalog:
            </Typography>
            <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.5 }}>
              {(catalog || []).slice(0, 20).map((col) => (
                <Chip
                  key={col}
                  label={col}
                  size="small"
                  variant="outlined"
                  onClick={() => updateUserMapping(selectedToken, col)}
                  sx={{ fontSize: '0.6rem', cursor: 'pointer' }}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </CanvasCard>
  )
}


const SEVERITY_STYLES = {
  error: { color: 'error', icon: ErrorOutlineIcon, label: 'Error' },
  critical: { color: 'error', icon: ErrorOutlineIcon, label: 'Critical' },
  major: { color: 'error', icon: ErrorOutlineIcon, label: 'Major' },
  warning: { color: 'warning', icon: WarningAmberIcon, label: 'Warning' },
  minor: { color: 'warning', icon: WarningAmberIcon, label: 'Minor' },
  info: { color: 'info', icon: FactCheckIcon, label: 'Info' },
}

/**
 * Failed checks + severity + repair actions.
 * Shows when contract validation or dry-run finds issues.
 */
function ValidationIssuesCard() {
  const validationIssues = useTemplateCreatorStore((s) => s.validationIssues)
  const validating = useTemplateCreatorStore((s) => s.validating)
  const dryRunResult = useTemplateCreatorStore((s) => s.dryRunResult)
  const contractBuildResult = useTemplateCreatorStore((s) => s.contractBuildResult)
  const setSelectedIssue = useTemplateCreatorStore((s) => s.setSelectedIssue)

  if (validationIssues.length === 0 && !validating) return null

  const errors = validationIssues.filter((i) => ['error', 'critical', 'major'].includes(i.severity))
  const warnings = validationIssues.filter((i) => ['warning', 'minor'].includes(i.severity))

  return (
    <CanvasCard
      id="validation_issues"
      icon={FactCheckIcon}
      title={`Validation (${validationIssues.length} issues)`}
      loading={validating}
    >
      {validating ? (
        <Typography variant="body2" color="text.secondary">
          Running validation checks...
        </Typography>
      ) : (
        <Stack spacing={1}>
          {/* Summary chips */}
          <Stack direction="row" spacing={0.5}>
            {errors.length > 0 && (
              <Chip label={`${errors.length} errors`} size="small" color="error" variant="outlined" sx={{ fontSize: '0.65rem' }} />
            )}
            {warnings.length > 0 && (
              <Chip label={`${warnings.length} warnings`} size="small" color="warning" variant="outlined" sx={{ fontSize: '0.65rem' }} />
            )}
          </Stack>

          {/* Issue list */}
          <Stack spacing={0.75}>
            {validationIssues.slice(0, 8).map((issue, idx) => {
              const config = SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.warning
              const Icon = config.icon
              return (
                <Box
                  key={idx}
                  onClick={() => setSelectedIssue(issue)}
                  sx={{
                    p: 1,
                    borderRadius: 0.5,
                    border: '1px solid',
                    borderColor: (theme) => alpha(theme.palette[config.color].main, 0.3),
                    bgcolor: (theme) => alpha(theme.palette[config.color].main, 0.04),
                    cursor: 'pointer',
                    '&:hover': { bgcolor: (theme) => alpha(theme.palette[config.color].main, 0.08) },
                    transition: 'background-color 100ms',
                  }}
                >
                  <Stack direction="row" spacing={0.75} alignItems="flex-start">
                    <Icon sx={{ fontSize: 14, color: `${config.color}.main`, mt: 0.25 }} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="caption" sx={{ lineHeight: 1.3, display: 'block', fontWeight: 500 }}>
                        {issue.message || issue.description || String(issue)}
                      </Typography>
                      {issue.suggestion && (
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                          Fix: {issue.suggestion}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                </Box>
              )
            })}
            {validationIssues.length > 8 && (
              <Typography variant="caption" color="text.disabled">
                +{validationIssues.length - 8} more issues
              </Typography>
            )}
          </Stack>

          {/* Dry-run summary */}
          {dryRunResult && (
            <Box sx={{ p: 1, borderRadius: 0.5, bgcolor: 'background.default' }}>
              <Typography variant="caption" fontWeight={600}>
                Dry Run: {dryRunResult.success ? 'Passed' : 'Failed'}
              </Typography>
              {dryRunResult.row_count != null && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {dryRunResult.row_count} rows resolved
                </Typography>
              )}
            </Box>
          )}
        </Stack>
      )}
    </CanvasCard>
  )
}


const SEVERITY_CONFIG = {
  error: { color: 'error', icon: ErrorOutlineIcon },
  warning: { color: 'warning', icon: WarningAmberIcon },
  info: { color: 'info', icon: VerifiedIcon },
}

function scoreColor(score) {
  if (score >= 80) return 'success'
  if (score >= 50) return 'warning'
  return 'error'
}

/**
 * QA score gauge + issue summary from template_qa agent.
 */
function QualityScoreCard() {
  const qaResult = useTemplateCreatorStore((s) => s.agentResults.template_qa)
  const qaLoading = useTemplateCreatorStore((s) => s.agentLoading.template_qa)
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)

  if (!currentHtml && !qaResult) return null

  const score = qaResult?.qa_score ?? null
  const issues = qaResult?.issues || []
  const coverage = qaResult?.token_coverage_pct ?? null
  const summary = qaResult?.summary || ''

  return (
    <CanvasCard
      id="quality_score"
      icon={VerifiedIcon}
      title="Quality Score"
      loading={qaLoading}
    >
      {qaResult ? (
        <Stack spacing={1.5}>
          {/* Score bar */}
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="h4" fontWeight={700} color={`${scoreColor(score)}.main`}>
              {Math.round(score)}
            </Typography>
            <Box sx={{ flex: 1 }}>
              <LinearProgress
                variant="determinate"
                value={score}
                color={scoreColor(score)}
                sx={{ height: 8, borderRadius: 4 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block' }}>
                {coverage != null && `Token coverage: ${coverage}%`}
              </Typography>
            </Box>
          </Stack>

          {/* Summary */}
          {summary && (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
              {summary}
            </Typography>
          )}

          {/* Issues list */}
          {issues.length > 0 && (
            <Stack spacing={0.5}>
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                Issues ({issues.length})
              </Typography>
              {issues.slice(0, 5).map((issue, idx) => {
                const config = SEVERITY_CONFIG[issue.severity] || SEVERITY_CONFIG.info
                const Icon = config.icon
                return (
                  <Stack key={idx} direction="row" spacing={0.75} alignItems="flex-start">
                    <Icon sx={{ fontSize: 14, color: `${config.color}.main`, mt: 0.25 }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" sx={{ lineHeight: 1.4, display: 'block' }}>
                        {issue.description}
                      </Typography>
                      {issue.suggestion && (
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
                          {issue.suggestion}
                        </Typography>
                      )}
                    </Box>
                  </Stack>
                )
              })}
              {issues.length > 5 && (
                <Typography variant="caption" color="text.disabled">
                  +{issues.length - 5} more
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
      ) : qaLoading ? (
        <Typography variant="body2" color="text.secondary">
          Analyzing template quality...
        </Typography>
      ) : (
        <Typography variant="body2" color="text.disabled">
          Quality analysis will run automatically when the template is ready.
        </Typography>
      )}
    </CanvasCard>
  )
}


const STATUS_CONFIG = {
  passed: { icon: CheckCircleIcon, color: 'success.main', label: 'Passed' },
  failed: { icon: ErrorIcon, color: 'error.main', label: 'Failed' },
  skipped: { icon: SkipNextIcon, color: 'text.disabled', label: 'Skipped' },
  repaired: { icon: BuildIcon, color: 'warning.main', label: 'Repaired' },
  needs_repair: { icon: BuildIcon, color: 'warning.main', label: 'Needs Repair' },
  pending: { icon: HourglassEmptyIcon, color: 'text.disabled', label: 'Pending' },
}

function humanizeStep(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Pipeline step status list from report_pipeline agent.
 */
function PipelineStepsCard() {
  const pipelineResult = useTemplateCreatorStore((s) => s.agentResults.report_pipeline)
  const pipelineLoading = useTemplateCreatorStore((s) => s.agentLoading.report_pipeline)

  if (!pipelineResult && !pipelineLoading) return null

  const steps = pipelineResult?.steps || []
  const overall = pipelineResult?.overall_status || 'pending'
  const elapsed = pipelineResult?.total_elapsed_ms

  return (
    <CanvasCard
      id="pipeline_steps"
      icon={TimelineIcon}
      title="Pipeline Steps"
      loading={pipelineLoading}
    >
      {pipelineLoading ? (
        <Typography variant="body2" color="text.secondary">
          Running pipeline...
        </Typography>
      ) : (
        <Stack spacing={0.75}>
          {/* Overall status */}
          <Stack direction="row" alignItems="center" spacing={1}>
            <Chip
              label={overall === 'passed' ? 'All Passed' : 'Failed'}
              size="small"
              color={overall === 'passed' ? 'success' : 'error'}
              variant="outlined"
              sx={{ fontSize: '0.65rem' }}
            />
            {elapsed != null && (
              <Typography variant="caption" color="text.disabled">
                {elapsed > 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${Math.round(elapsed)}ms`}
              </Typography>
            )}
          </Stack>

          {/* Step list */}
          {steps.map((step) => {
            const config = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending
            const Icon = config.icon
            return (
              <Stack key={step.step_name} direction="row" alignItems="center" spacing={1}>
                <Icon sx={{ fontSize: 14, color: config.color }} />
                <Typography variant="caption" sx={{ flex: 1, fontWeight: step.status === 'failed' ? 600 : 400 }}>
                  {humanizeStep(step.step_name)}
                </Typography>
                {step.attempts > 1 && (
                  <Chip label={`${step.attempts}x`} size="small" sx={{ fontSize: '0.55rem', height: 16 }} />
                )}
                {step.elapsed_ms > 0 && (
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                    {step.elapsed_ms > 1000 ? `${(step.elapsed_ms / 1000).toFixed(1)}s` : `${Math.round(step.elapsed_ms)}ms`}
                  </Typography>
                )}
              </Stack>
            )
          })}

          {/* Summary */}
          {pipelineResult?.summary && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, fontSize: '0.7rem' }}>
              {pipelineResult.summary}
            </Typography>
          )}
        </Stack>
      )}
    </CanvasCard>
  )
}


/**
 * Before/after diff of changed DOM blocks.
 * Shows when HTML just changed (htmlDiff is set in store).
 */
function HtmlDiffCard() {
  const htmlDiff = useTemplateCreatorStore((s) => s.htmlDiff)
  const clearHtmlDiff = useTemplateCreatorStore((s) => s.clearHtmlDiff)

  const diffStats = useMemo(() => {
    if (!htmlDiff?.before || !htmlDiff?.after) return null

    const beforeLines = htmlDiff.before.split('\n')
    const afterLines = htmlDiff.after.split('\n')

    // Simple line-level diff stats
    const added = afterLines.length - beforeLines.length
    const beforeTokens = (htmlDiff.before.match(/\{(\w+)\}/g) || []).map((t) => t.slice(1, -1))
    const afterTokens = (htmlDiff.after.match(/\{(\w+)\}/g) || []).map((t) => t.slice(1, -1))

    const addedTokens = afterTokens.filter((t) => !beforeTokens.includes(t))
    const removedTokens = beforeTokens.filter((t) => !afterTokens.includes(t))

    return {
      linesBefore: beforeLines.length,
      linesAfter: afterLines.length,
      linesDelta: added,
      addedTokens,
      removedTokens,
      charsDelta: htmlDiff.after.length - htmlDiff.before.length,
    }
  }, [htmlDiff])

  if (!htmlDiff) return null

  return (
    <CanvasCard
      id="html_diff"
      icon={DifferenceIcon}
      title="Template Diff"
      actions={
        <Button
          size="small"
          variant="text"
          onClick={clearHtmlDiff}
          sx={{ textTransform: 'none', fontSize: '0.7rem' }}
        >
          Dismiss
        </Button>
      }
    >
      {diffStats && (
        <Stack spacing={1}>
          {/* Delta summary */}
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            <Chip
              label={`${diffStats.linesDelta >= 0 ? '+' : ''}${diffStats.linesDelta} lines`}
              size="small"
              color={diffStats.linesDelta > 0 ? 'success' : diffStats.linesDelta < 0 ? 'error' : 'default'}
              variant="outlined"
              sx={{ fontSize: '0.6rem' }}
            />
            <Chip
              label={`${diffStats.charsDelta >= 0 ? '+' : ''}${diffStats.charsDelta} chars`}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.6rem' }}
            />
          </Stack>

          {/* Token changes */}
          {diffStats.addedTokens.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={600} color="success.main">
                Added tokens:
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.25 }}>
                {diffStats.addedTokens.map((t) => (
                  <Chip key={t} label={`+${t}`} size="small" color="success" variant="outlined" sx={{ fontSize: '0.6rem' }} />
                ))}
              </Stack>
            </Box>
          )}

          {diffStats.removedTokens.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={600} color="error.main">
                Removed tokens:
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5} sx={{ mt: 0.25 }}>
                {diffStats.removedTokens.map((t) => (
                  <Chip key={t} label={`-${t}`} size="small" color="error" variant="outlined" sx={{ fontSize: '0.6rem' }} />
                ))}
              </Stack>
            </Box>
          )}

          {diffStats.addedTokens.length === 0 && diffStats.removedTokens.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No token changes — layout or styling update.
            </Typography>
          )}
        </Stack>
      )}
    </CanvasCard>
  )
}


/**
 * Sample query results + column profiles from data_quality agent.
 */
function DataPreviewCard() {
  const qualityResult = useTemplateCreatorStore((s) => s.agentResults.data_quality)
  const qualityLoading = useTemplateCreatorStore((s) => s.agentLoading.data_quality)
  const connectionId = useTemplateCreatorStore((s) => s.connectionId)

  if (!qualityResult && !qualityLoading && !connectionId) return null

  const profiles = qualityResult?.column_profiles || {}
  const columns = Object.keys(profiles)
  const overallScore = qualityResult?.overall_score
  const totalRows = qualityResult?.total_rows || 0
  const recommendations = qualityResult?.recommendations || []

  return (
    <CanvasCard
      id="data_preview"
      icon={StorageIcon}
      title="Data Quality"
      loading={qualityLoading}
    >
      {qualityLoading ? (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Analyzing data quality...
          </Typography>
          <LinearProgress />
        </Stack>
      ) : qualityResult ? (
        <Stack spacing={1}>
          {/* Overall score */}
          {overallScore != null && (
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h5" fontWeight={700}>
                {Math.round(overallScore)}
              </Typography>
              <Box sx={{ flex: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={overallScore}
                  color={overallScore >= 80 ? 'success' : overallScore >= 50 ? 'warning' : 'error'}
                  sx={{ height: 6, borderRadius: 3 }}
                />
              </Box>
              <Typography variant="caption" color="text.disabled">
                {totalRows} rows
              </Typography>
            </Stack>
          )}

          {/* Dimension scores */}
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            {qualityResult.completeness_score != null && (
              <Chip label={`Complete: ${Math.round(qualityResult.completeness_score)}%`} size="small" variant="outlined" sx={{ fontSize: '0.6rem' }} />
            )}
            {qualityResult.consistency_score != null && (
              <Chip label={`Consistent: ${Math.round(qualityResult.consistency_score)}%`} size="small" variant="outlined" sx={{ fontSize: '0.6rem' }} />
            )}
            {qualityResult.validity_score != null && (
              <Chip label={`Valid: ${Math.round(qualityResult.validity_score)}%`} size="small" variant="outlined" sx={{ fontSize: '0.6rem' }} />
            )}
          </Stack>

          {/* Column profiles (compact) */}
          {columns.length > 0 && (
            <Box sx={{ maxHeight: 150, overflow: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, py: 0.25, fontSize: '0.65rem' }}>Column</TableCell>
                    <TableCell sx={{ fontWeight: 600, py: 0.25, fontSize: '0.65rem' }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600, py: 0.25, fontSize: '0.65rem' }}>Nulls</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {columns.slice(0, 15).map((col) => {
                    const p = profiles[col]
                    return (
                      <TableRow key={col}>
                        <TableCell sx={{ py: 0.25, fontSize: '0.65rem' }}>{col}</TableCell>
                        <TableCell sx={{ py: 0.25, fontSize: '0.65rem' }}>{p.dominant_type}</TableCell>
                        <TableCell sx={{ py: 0.25, fontSize: '0.65rem' }}>
                          <Typography
                            component="span"
                            variant="caption"
                            color={p.null_pct > 50 ? 'error.main' : 'text.secondary'}
                            sx={{ fontSize: '0.65rem' }}
                          >
                            {Math.round(p.null_pct)}%
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                Recommendations
              </Typography>
              {recommendations.slice(0, 3).map((rec, idx) => (
                <Typography key={idx} variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.65rem' }}>
                  • {rec}
                </Typography>
              ))}
            </Box>
          )}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.disabled">
          Connect a data source to see quality analysis.
        </Typography>
      )}
    </CanvasCard>
  )
}


/**
 * Structure suggestions + completion checklist.
 * Default "insights" mode when template is stable.
 */
function InsightsCard() {
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)
  const templateId = useTemplateCreatorStore((s) => s.templateId)
  const templateName = useTemplateCreatorStore((s) => s.templateName)
  const schemaExt = useTemplateCreatorStore((s) => s.schemaExt)
  const autoMapping = useTemplateCreatorStore((s) => s.autoMapping)
  const userMapping = useTemplateCreatorStore((s) => s.userMapping)
  const contractBuildResult = useTemplateCreatorStore((s) => s.contractBuildResult)
  const dryRunResult = useTemplateCreatorStore((s) => s.dryRunResult)
  const finalized = useTemplateCreatorStore((s) => s.finalized)
  const connectionId = useTemplateCreatorStore((s) => s.connectionId)
  const qaResult = useTemplateCreatorStore((s) => s.agentResults.template_qa)

  // Build checklist
  const checklist = [
    { label: 'Template HTML created', done: !!currentHtml },
    { label: 'Template saved', done: !!templateId },
    { label: 'Data source connected', done: !!connectionId },
    { label: 'Schema analyzed', done: !!schemaExt },
    { label: 'Tokens mapped', done: Object.keys(userMapping).length > 0 || Object.keys(autoMapping).length > 0 },
    { label: 'Quality checked', done: !!qaResult },
    { label: 'Contract built', done: !!contractBuildResult },
    { label: 'Dry-run passed', done: dryRunResult?.success === true },
    { label: 'Report-ready', done: finalized },
  ]

  const completedCount = checklist.filter((c) => c.done).length
  const progress = Math.round((completedCount / checklist.length) * 100)

  return (
    <CanvasCard
      id="insights"
      icon={LightbulbIcon}
      title="Progress"
    >
      <Stack spacing={1}>
        {/* Progress summary */}
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h5" fontWeight={700} color={progress === 100 ? 'success.main' : 'text.primary'}>
            {completedCount}/{checklist.length}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            steps completed
          </Typography>
        </Stack>

        {/* Checklist */}
        <Stack spacing={0.25}>
          {checklist.map((item, idx) => (
            <Stack key={idx} direction="row" alignItems="center" spacing={0.5}>
              {item.done ? (
                <CheckBoxIcon sx={{ fontSize: 16, color: 'success.main' }} />
              ) : (
                <CheckBoxOutlineBlankIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
              )}
              <Typography
                variant="caption"
                sx={{
                  color: item.done ? 'text.secondary' : 'text.primary',
                  textDecoration: item.done ? 'line-through' : 'none',
                }}
              >
                {item.label}
              </Typography>
            </Stack>
          ))}
        </Stack>

        {/* Next action hint */}
        {!currentHtml && (
          <Typography variant="caption" color="primary.main" fontWeight={500}>
            Drop a PDF on the left or describe your report in the chat to begin.
          </Typography>
        )}
        {currentHtml && !schemaExt && (
          <Typography variant="caption" color="primary.main" fontWeight={500}>
            Template is ready. Ask the agent to analyze tokens and structure.
          </Typography>
        )}
        {schemaExt && Object.keys(userMapping).length === 0 && connectionId && (
          <Typography variant="caption" color="primary.main" fontWeight={500}>
            Tokens detected. Say "map all tokens" in the chat.
          </Typography>
        )}
        {Object.keys(userMapping).length > 0 && !contractBuildResult && (
          <Typography variant="caption" color="primary.main" fontWeight={500}>
            Mappings ready. Say "validate" to build and test the contract.
          </Typography>
        )}
      </Stack>
    </CanvasCard>
  )
}

// === From: components.jsx ===
/**
 * Template Components (merged)
 */

// TemplatePreviewPanel

/**
 * Left panel: Live rendered HTML template preview.
 *
 * Always visible, always updating. This is the "source of truth" for
 * what the final report will look like. Supports:
 * - Blob URL iframe rendering of currentHtml
 * - Drop zone overlay when no template exists
 * - Token click detection (postMessage from iframe)
 */
export function TemplatePreviewPanel() {
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)
  const sourceMode = useTemplateCreatorStore((s) => s.sourceMode)
  const setUploadedFile = useTemplateCreatorStore((s) => s.setUploadedFile)
  const setSourceMode = useTemplateCreatorStore((s) => s.setSourceMode)
  const setSelectedToken = useTemplateCreatorStore((s) => s.setSelectedToken)
  const templateKind = useTemplateCreatorStore((s) => s.templateKind)
  const uploadProgress = useTemplateCreatorStore((s) => s.uploadProgress)

  const [previewUrl, setPreviewUrl] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  // Create blob URL for iframe preview
  useEffect(() => {
    if (!currentHtml) {
      setPreviewUrl(null)
      return
    }
    // Inject token click handler script into the HTML
    const clickScript = `
      <script>
        document.addEventListener('click', function(e) {
          var el = e.target;
          // Walk up to find text containing {token} patterns
          var text = el.textContent || '';
          var match = text.match(/\\{(\\w+)\\}/);
          if (match) {
            window.parent.postMessage({ type: 'token_click', token: match[1] }, '*');
          }
        });
      </script>
    `
    const enrichedHtml = currentHtml.replace('</body>', clickScript + '</body>')
    const blob = new Blob([enrichedHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [currentHtml])

  // Listen for token clicks from iframe
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'token_click' && e.data.token) {
        setSelectedToken(e.data.token)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [setSelectedToken])

  // File drop handling
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) {
      setUploadedFile(file)
      setSourceMode('upload')
    }
  }, [setUploadedFile, setSourceMode])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleFileInput = useCallback((e) => {
    const file = e.target?.files?.[0]
    if (file) {
      setUploadedFile(file)
      setSourceMode('upload')
    }
  }, [setUploadedFile, setSourceMode])

  return (
    <Box
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      sx={{
        border: '1px solid',
        borderColor: dragOver ? 'primary.main' : 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        position: 'relative',
        transition: 'border-color 150ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      {/* Panel header */}
      <Box
        sx={{
          p: 1,
          px: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.default',
          flexShrink: 0,
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            Template Preview
          </Typography>
          {uploadProgress > 0 && uploadProgress < 100 && (
            <Chip label={`${uploadProgress}%`} size="small" color="primary" variant="outlined" />
          )}
        </Stack>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title="Template Preview"
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: 'block',
              minHeight: 600,
            }}
          />
        ) : (
          <Box
            component="label"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              p: 4,
              cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' },
              transition: 'background-color 150ms',
            }}
          >
            <UploadFileIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="body1" fontWeight={600} color="text.secondary" sx={{ mb: 0.5 }}>
              Drop a PDF here to start
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ mb: 2, textAlign: 'center' }}>
              Or describe your report in the chat panel.
              {templateKind === 'excel' && ' Excel files also accepted.'}
            </Typography>
            <Chip label="Upload File" variant="outlined" size="small" />
            <input
              type="file"
              accept={templateKind === 'excel' ? 'application/pdf,.xlsx,.xls' : 'application/pdf'}
              hidden
              onChange={handleFileInput}
            />
          </Box>
        )}
      </Box>

      {/* Drag overlay */}
      {dragOver && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
            border: '2px dashed',
            borderColor: 'primary.main',
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
          }}
        >
          <Typography variant="h6" color="primary.main" fontWeight={600}>
            Drop to upload
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ChatPanel

const SESSION_KEY = '__unified_create__'

/**
 * Center panel: Chat / Intent surface.
 *
 * Wraps the existing TemplateChatEditor (1056 lines) in create mode,
 * connecting it to the unified templateCreatorStore. The chat is the
 * user's primary control surface — they say what they want, and the
 * system executes through the template + canvas panels.
 */
function ChatPanel() {
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)
  const templateKind = useTemplateCreatorStore((s) => s.templateKind)
  const uploadedFile = useTemplateCreatorStore((s) => s.uploadedFile)
  const setCurrentHtml = useTemplateCreatorStore((s) => s.setCurrentHtml)

  const handleHtmlUpdate = useCallback((html) => {
    setCurrentHtml(html)
  }, [setCurrentHtml])

  const handleApplySuccess = useCallback((result) => {
    if (result?.updated_html) {
      setCurrentHtml(result.updated_html)
    }
  }, [setCurrentHtml])

  // Wrap the chat API to pass sample PDF and kind
  const chatApi = useCallback((messages, html) => {
    return chatTemplateCreate(messages, html, uploadedFile?.file || null, templateKind)
  }, [uploadedFile, templateKind])

  return (
    <Box sx={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <TemplateChatEditor
        templateId={SESSION_KEY}
        templateName="New Template"
        currentHtml={currentHtml}
        onHtmlUpdate={handleHtmlUpdate}
        onApplySuccess={handleApplySuccess}
        mode="create"
        chatApi={chatApi}
      />
    </Box>
  )
}

// IntelligenceCanvas

// Canvas cards

const MODE_ICONS = {
  extraction: DocumentScannerIcon,
  mapping: CompareArrowsIcon,
  diff: DifferenceIcon,
  validation: FactCheckIcon,
  data_preview: TableChartIcon,
  insights: LightbulbIcon,
}

/**
 * Right panel: Intelligence Canvas.
 *
 * Context-reactive workspace that shows the best visual artifacts for
 * the current task state. Each mode renders a specific set of cards.
 *
 * Rules:
 * - Only show cards that provide: decision support, repair support, or preview support
 * - Every card has actions (accept/reject/apply/pin)
 * - Mode label at top makes intent explicit
 * - Pinned cards persist across mode changes
 */
function IntelligenceCanvas() {
  const mode = useCanvasMode()
  const modeConfig = CANVAS_MODES[mode] || CANVAS_MODES.insights
  const ModeIcon = MODE_ICONS[mode] || LightbulbIcon

  const agentLoading = useTemplateCreatorStore((s) => s.agentLoading)
  const pinnedCards = useTemplateCreatorStore((s) => s.pinnedCards)
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)

  const anyAgentLoading = Object.values(agentLoading).some(Boolean)

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Mode label header */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.default',
          flexShrink: 0,
        }}
      >
        <Chip
          icon={<ModeIcon sx={{ fontSize: '16px !important' }} />}
          label={modeConfig.label}
          size="small"
          variant="outlined"
          sx={{ fontWeight: 600, fontSize: '0.7rem' }}
        />
        {anyAgentLoading && (
          <CircularProgress size={14} thickness={5} sx={{ color: 'text.disabled' }} />
        )}
      </Stack>

      {/* Card stack */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 1.5,
          minHeight: 0,
        }}
      >
        <Stack spacing={1.5}>
          {/* Render cards based on current mode */}
          <ModeCards mode={mode} />

          {/* Pinned cards from other modes (rendered below) */}
          <PinnedCards currentMode={mode} pinnedCards={pinnedCards} />

          {/* Empty state */}
          {!currentHtml && (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <LightbulbIcon sx={{ fontSize: 36, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="text.disabled">
                Start by uploading a PDF or describing your report in the chat.
                Intelligence cards will appear here as you work.
              </Typography>
            </Box>
          )}
        </Stack>
      </Box>

      {/* Agent activity indicator */}
      {anyAgentLoading && (
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04),
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            Agent processing...
          </Typography>
        </Box>
      )}
    </Box>
  )
}

/**
 * Renders the appropriate cards for the current canvas mode.
 */
function ModeCards({ mode }) {
  switch (mode) {
    case 'extraction':
      return (
        <>
          <ExtractionSummaryCard />
          <QualityScoreCard />
        </>
      )

    case 'mapping':
      return (
        <>
          <MappingTableCard />
          <MappingCandidatesCard />
        </>
      )

    case 'diff':
      return (
        <>
          <HtmlDiffCard />
          <QualityScoreCard />
        </>
      )

    case 'validation':
      return (
        <>
          <ValidationIssuesCard />
          <PipelineStepsCard />
          <QualityScoreCard />
        </>
      )

    case 'data_preview':
      return (
        <>
          <DataPreviewCard />
        </>
      )

    case 'insights':
    default:
      return (
        <>
          <InsightsCard />
          <QualityScoreCard />
        </>
      )
  }
}

/**
 * Renders pinned cards that belong to a different mode.
 */
function PinnedCards({ currentMode, pinnedCards }) {
  if (!pinnedCards || pinnedCards.length === 0) return null

  // Map card IDs to their mode — only show cards not in current mode
  const CARD_MODES = {
    quality_score: 'extraction',
    mapping_table: 'mapping',
    mapping_candidates: 'mapping',
    validation_issues: 'validation',
    pipeline_steps: 'validation',
    html_diff: 'diff',
    data_preview: 'data_preview',
    insights: 'insights',
  }

  const crossModeCards = pinnedCards.filter((id) => {
    const cardMode = CARD_MODES[id]
    return cardMode && cardMode !== currentMode
  })

  if (crossModeCards.length === 0) return null

  return crossModeCards.map((cardId) => {
    switch (cardId) {
      case 'quality_score': return <QualityScoreCard key={cardId} />
      case 'mapping_table': return <MappingTableCard key={cardId} />
      case 'mapping_candidates': return <MappingCandidatesCard key={cardId} />
      case 'validation_issues': return <ValidationIssuesCard key={cardId} />
      case 'pipeline_steps': return <PipelineStepsCard key={cardId} />
      case 'html_diff': return <HtmlDiffCard key={cardId} />
      case 'data_preview': return <DataPreviewCard key={cardId} />
      case 'insights': return <InsightsCard key={cardId} />
      default: return null
    }
  })
}

// === From: src/features/templates/containers.jsx ===

// === From: TemplatesPageContainer.jsx ===
/**
 * Premium Templates Page
 * Sophisticated template management with glassmorphism and animations
 */
// UX Governance - Enforced interaction API


const QuickFilterChip = styled(Chip)(({ theme }) => ({
  borderRadius: 8,
  backgroundColor: alpha(theme.palette.text.primary, 0.08),
  color: theme.palette.text.secondary,
  fontSize: '0.75rem',
  '& .MuiChip-deleteIcon': {
    color: theme.palette.text.secondary,
    '&:hover': {
      color: theme.palette.text.primary,
    },
  },
}))

const StyledMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    borderRadius: 8,  // Figma spec: 8px
    boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.15)}`,
    minWidth: 180,
    animation: `${fadeInUp} 0.2s ease-out`,
  },
}))

const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
  borderRadius: 8,
  margin: theme.spacing(0.5, 1),
  padding: theme.spacing(1, 1.5),
  fontSize: '14px',
  transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
  '& .MuiListItemIcon-root': {
    minWidth: 32,
  },
}))

const DialogHeader = styled(DialogTitle)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(2.5, 3),
  fontSize: '1.125rem',
  fontWeight: 600,
}))

const StyledDialogContent = styled(DialogContent)(({ theme }) => ({
  padding: theme.spacing(0, 3, 3),
}))

const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
  padding: theme.spacing(2, 3),
  gap: theme.spacing(1),
}))

const StyledTextField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: 8,  // Figma spec: 8px
    backgroundColor: alpha(theme.palette.background.paper, 0.6),
    transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
    '&:hover': {
      backgroundColor: alpha(theme.palette.background.paper, 0.8),
    },
    '&.Mui-focused': {
      backgroundColor: theme.palette.background.paper,
      boxShadow: `0 0 0 3px ${alpha(theme.palette.text.primary, 0.08)}`,
    },
  },
}))

const ActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.875rem',
  padding: theme.spacing(1, 2.5),
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
}))

const PrimaryButton = styled(ActionButton)(({ theme }) => ({
  background: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  color: theme.palette.common.white,
  boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
  '&:hover': {
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
    transform: 'translateY(-1px)',
  },
  '&:disabled': {
    background: theme.palette.action.disabledBackground,
    color: theme.palette.action.disabled,
    boxShadow: 'none',
  },
}))

const SecondaryButton = styled(ActionButton)(({ theme }) => ({
  borderColor: alpha(theme.palette.divider, 0.3),
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
  },
}))

const KindIconContainer = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'iconColor',
})(({ theme }) => ({
  width: 36,
  height: 36,
  borderRadius: 10,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
}))

const KindChip = styled(Chip, {
  shouldForwardProp: (prop) => !['kindColor', 'kindBg'].includes(prop),
})(({ theme, kindColor, kindBg }) => ({
  borderRadius: 8,
  fontWeight: 600,
  fontSize: '12px',
  backgroundColor: kindBg,
  color: kindColor,
}))

const StatusChip = styled(Chip, {
  shouldForwardProp: (prop) => !['statusColor', 'statusBg'].includes(prop),
})(({ theme, statusColor, statusBg }) => ({
  borderRadius: 8,
  fontWeight: 600,
  fontSize: '12px',
  textTransform: 'capitalize',
  backgroundColor: statusBg,
  color: statusColor,
}))

const TagChip = styled(Chip)(({ theme }) => ({
  borderRadius: 6,
  fontSize: '12px',
  backgroundColor: alpha(theme.palette.text.primary, 0.08),
  color: theme.palette.text.secondary,
}))

const MoreActionsButton = styled(IconButton)(({ theme }) => ({
  color: theme.palette.text.secondary,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
}))

const StyledLinearProgress = styled(LinearProgress)(({ theme }) => ({
  borderRadius: 4,
  height: 6,
  backgroundColor: alpha(theme.palette.text.primary, 0.1),
  '& .MuiLinearProgress-bar': {
    borderRadius: 4,
    background: theme.palette.mode === 'dark' ? neutral[500] : neutral[900],
  },
}))

const SimilarTemplateCard = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderRadius: 8,  // Figma spec: 8px
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
    transform: 'translateX(4px)',
  },
}))

const AiIcon = styled(AutoAwesomeIcon)(({ theme }) => ({
  color: theme.palette.text.secondary,
  animation: `${pulse} 2s infinite ease-in-out`,
}))


const getKindConfig = (theme, kind) => {
  const configs = {
    pdf: {
      icon: PictureAsPdfIcon,
      color: theme.palette.text.secondary,
      bgColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
    },
    excel: {
      icon: TableChartIcon,
      color: theme.palette.text.secondary,
      bgColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
    },
  }
  return configs[kind] || configs.pdf
}

const getStatusConfig = (theme, status) => {
  const s = (status || '').toLowerCase()
  const configs = {
    approved: {
      color: statusColors.success,
      bgColor: alpha(statusColors.success, 0.1),
    },
    failed: {
      color: statusColors.destructive,
      bgColor: alpha(statusColors.destructive, 0.1),
    },
    pending: {
      color: statusColors.warning,
      bgColor: alpha(statusColors.warning, 0.1),
    },
    draft: {
      color: theme.palette.text.secondary,
      bgColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[50],
    },
    archived: {
      color: theme.palette.text.secondary,
      bgColor: alpha(theme.palette.text.secondary, 0.08),
    },
  }
  return configs[s] || configs.approved
}


export default function TemplatesPage() {
  const theme = useTheme()
  const navigate = useNavigateInteraction()
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()
  // UX Governance: Enforced interaction API - ALL user actions flow through this
  const { execute } = useInteraction()
  const handleNavigate = useCallback(
    (path, label, intent = {}) =>
      navigate(path, { label, intent: { from: 'templates', ...intent } }),
    [navigate]
  )
  const templates = useAppStore((s) => s.templates)
  const setTemplates = useAppStore((s) => s.setTemplates)
  const removeTemplate = useAppStore((s) => s.removeTemplate)
  const updateTemplate = useAppStore((s) => s.updateTemplate)

  const [loading, setLoading] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingTemplate, setDeletingTemplate] = useState(null)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuTemplate, setMenuTemplate] = useState(null)
  const [duplicating, setDuplicating] = useState(false)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [metadataTemplate, setMetadataTemplate] = useState(null)
  const [metadataForm, setMetadataForm] = useState({ name: '', description: '', tags: '', status: 'approved' })
  const [metadataSaving, setMetadataSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importName, setImportName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [allTags, setAllTags] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const [bulkStatus, setBulkStatus] = useState('approved')
  const [bulkTagsOpen, setBulkTagsOpen] = useState(false)
  const [bulkTags, setBulkTags] = useState('')
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const bulkDeleteUndoRef = useRef(null)
  const didLoadRef = useRef(false)
  const [similarOpen, setSimilarOpen] = useState(false)
  const [similarTemplate, setSimilarTemplate] = useState(null)
  const [similarTemplates, setSimilarTemplates] = useState([])
  const [similarLoading, setSimilarLoading] = useState(false)
  const [favorites, setFavorites] = useState(new Set())

  const kindFilter = searchParams.get('kind') || ''
  const statusParam = searchParams.get('status') || ''

  const filteredTemplates = useMemo(() => {
    let data = templates
    if (kindFilter) {
      data = data.filter((tpl) => (tpl.kind || '').toLowerCase() === kindFilter.toLowerCase())
    }
    if (statusParam) {
      data = data.filter((tpl) => (tpl.status || '').toLowerCase() === statusParam.toLowerCase())
    }
    return data
  }, [templates, kindFilter, statusParam])

  const clearQuickFilter = useCallback((key) => {
    const next = new URLSearchParams(searchParams)
    next.delete(key)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const fetchTemplatesData = useCallback(async () => {
    setLoading(true)
    try {
      const [templatesData, tagsData, favoritesData] = await Promise.all([
        api.listTemplates(),
        api.getAllTemplateTags(),
        api.getFavorites().catch(() => ({ templates: [] })),
      ])
      setTemplates(templatesData)
      setAllTags(tagsData.tags || [])
      const favIds = (favoritesData.templates || []).map((t) => t.id)
      setFavorites(new Set(favIds))
    } catch (err) {
      toast.show(err.message || 'Failed to load designs', 'error')
    } finally {
      setLoading(false)
    }
  }, [setTemplates, toast])

  const handleFavoriteToggle = useCallback((templateId, isFavorite) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (isFavorite) {
        next.add(templateId)
      } else {
        next.delete(templateId)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (didLoadRef.current) return
    didLoadRef.current = true
    fetchTemplatesData()
  }, [fetchTemplatesData])

  const handleOpenMenu = useCallback((event, template) => {
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
    setMenuTemplate(template)
  }, [])

  const handleCloseMenu = useCallback(() => {
    setMenuAnchor(null)
    setMenuTemplate(null)
  }, [])

  const handleAddTemplate = useCallback(() => {
    handleNavigate('/pipeline?mode=create', 'Create new template')
  }, [handleNavigate])

  const handleCreateWithAi = useCallback(() => {
    handleNavigate('/templates/new?mode=describe', 'Create template with AI')
  }, [handleNavigate])

  const handleEditTemplate = useCallback(() => {
    if (menuTemplate) {
      handleNavigate(`/templates/${menuTemplate.id}/edit`, 'Edit template', { templateId: menuTemplate.id })
    }
    handleCloseMenu()
  }, [menuTemplate, handleNavigate, handleCloseMenu])

  const handleDeleteClick = useCallback(() => {
    setDeletingTemplate(menuTemplate)
    setDeleteConfirmOpen(true)
    handleCloseMenu()
  }, [menuTemplate, handleCloseMenu])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingTemplate) return
    const templateToDelete = deletingTemplate
    const templateData = templates.find((t) => t.id === templateToDelete.id)

    setDeleteConfirmOpen(false)
    setDeletingTemplate(null)

    // UX Governance: Delete action with tracking
    execute({
      type: InteractionType.DELETE,
      label: `Delete design "${templateToDelete.name || templateToDelete.id}"`,
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      action: async () => {
        removeTemplate(templateToDelete.id)

        let undone = false
        const deleteTimeout = setTimeout(async () => {
          if (undone) return
          try {
            await api.deleteTemplate(templateToDelete.id)
          } catch (err) {
            if (templateData) {
              setTemplates((prev) => [...prev, templateData])
            }
            throw err
          }
        }, 5000)

        toast.showWithUndo(
          `"${templateToDelete.name || templateToDelete.id}" removed`,
          () => {
            undone = true
            clearTimeout(deleteTimeout)
            if (templateData) {
              setTemplates((prev) => [...prev, templateData])
            }
            toast.show('Design restored', 'success')
          },
          { severity: 'info' }
        )
      },
    })
  }, [deletingTemplate, templates, removeTemplate, setTemplates, toast, execute])

  const handleExport = useCallback(async () => {
    if (!menuTemplate) return
    const templateToExport = menuTemplate
    handleCloseMenu()

    // UX Governance: Download action with tracking
    execute({
      type: InteractionType.DOWNLOAD,
      label: `Export design "${templateToExport.name || templateToExport.id}"`,
      reversibility: Reversibility.SYSTEM_MANAGED,
      successMessage: 'Design exported',
      errorMessage: 'Failed to export design',
      action: async () => {
        await api.exportTemplateZip(templateToExport.id)
      },
    })
  }, [menuTemplate, handleCloseMenu, execute])

  const handleDuplicate = useCallback(async () => {
    if (!menuTemplate) return
    const templateToDuplicate = menuTemplate
    handleCloseMenu()

    // UX Governance: Create action with tracking
    execute({
      type: InteractionType.CREATE,
      label: `Duplicate design "${templateToDuplicate.name || templateToDuplicate.id}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      errorMessage: 'Failed to copy design',
      action: async () => {
        setDuplicating(true)
        try {
          const result = await api.duplicateTemplate(templateToDuplicate.id)
          const duplicatedName = result?.name || (templateToDuplicate.name ? `${templateToDuplicate.name} (Copy)` : 'Design (Copy)')
          await fetchTemplatesData()
          toast.show(`Design copied as "${duplicatedName}"`, 'success')
        } finally {
          setDuplicating(false)
        }
      },
    })
  }, [menuTemplate, toast, handleCloseMenu, fetchTemplatesData, execute])

  const handleEditMetadata = useCallback(() => {
    if (!menuTemplate) return
    setMetadataTemplate(menuTemplate)
    setMetadataForm({
      name: menuTemplate.name || '',
      description: menuTemplate.description || '',
      tags: Array.isArray(menuTemplate.tags) ? menuTemplate.tags.join(', ') : '',
      status: menuTemplate.status || 'approved',
    })
    setMetadataOpen(true)
    handleCloseMenu()
  }, [menuTemplate, handleCloseMenu])

  const handleViewSimilar = useCallback(async () => {
    if (!menuTemplate) return
    setSimilarTemplate(menuTemplate)
    setSimilarOpen(true)
    setSimilarLoading(true)
    setSimilarTemplates([])
    handleCloseMenu()
    try {
      const response = await api.getSimilarTemplates(menuTemplate.id)
      setSimilarTemplates(response.similar || [])
    } catch (err) {
      console.error('Failed to fetch similar designs:', err)
      toast.show('Failed to load similar designs', 'error')
    } finally {
      setSimilarLoading(false)
    }
  }, [menuTemplate, handleCloseMenu, toast])

  const handleSelectSimilarTemplate = useCallback((template) => {
    setSimilarOpen(false)
    handleNavigate(`/reports?template=${template.id}`, 'Open reports', { templateId: template.id })
  }, [handleNavigate])

  const handleMetadataSave = useCallback(async () => {
    if (!metadataTemplate) return
    const trimmedName = metadataForm.name.trim()
    if (!trimmedName) {
      toast.show('Design name is required', 'error')
      return
    }
    if (trimmedName.length > 200) {
      toast.show('Design name must be 200 characters or less', 'error')
      return
    }
    const tags = metadataForm.tags
      ? metadataForm.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : []
    const invalidTag = tags.find((tag) => tag.length > 50)
    if (invalidTag) {
      toast.show(`Tag "${invalidTag.slice(0, 20)}..." exceeds 50 character limit`, 'error')
      return
    }

    const payload = {
      name: trimmedName,
      description: metadataForm.description.trim() || undefined,
      status: metadataForm.status,
      tags,
    }

    // UX Governance: Update action with tracking
    execute({
      type: InteractionType.UPDATE,
      label: `Update design details "${trimmedName}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: 'Design details updated',
      errorMessage: 'Failed to update design details',
      action: async () => {
        setMetadataSaving(true)
        try {
          const result = await api.updateTemplateMetadata(metadataTemplate.id, payload)
          const updated = result?.template || { ...metadataTemplate, ...payload }
          updateTemplate(metadataTemplate.id, (tpl) => ({ ...tpl, ...updated }))
          setMetadataOpen(false)
        } finally {
          setMetadataSaving(false)
        }
      },
    })
  }, [metadataTemplate, metadataForm, updateTemplate, execute])

  const handleOpenImport = useCallback(() => {
    setImportOpen(true)
  }, [])

  const handleImport = useCallback(async () => {
    if (!importFile) {
      toast.show('Select a design backup file first', 'error')
      return
    }
    const fileName = importFile.name || ''
    const ext = fileName.toLowerCase().split('.').pop()
    if (ext !== 'zip') {
      toast.show('Invalid file type. Please select a .zip file', 'error')
      return
    }
    const maxSize = 50 * 1024 * 1024
    if (importFile.size > maxSize) {
      toast.show('File too large. Maximum size is 50MB', 'error')
      return
    }

    // UX Governance: Upload action with tracking
    execute({
      type: InteractionType.UPLOAD,
      label: `Import design "${importName.trim() || fileName}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      successMessage: 'Design imported',
      errorMessage: 'Failed to import design',
      action: async () => {
        setImporting(true)
        setImportProgress(0)
        try {
          await api.importTemplateZip({
            file: importFile,
            name: importName.trim() || undefined,
            onUploadProgress: (percent) => setImportProgress(percent),
          })
          await fetchTemplatesData()
          setImportOpen(false)
          setImportFile(null)
          setImportName('')
        } finally {
          setImporting(false)
          setImportProgress(0)
        }
      },
    })
  }, [importFile, importName, fetchTemplatesData, execute])

  const handleBulkDeleteOpen = useCallback(() => {
    if (!selectedIds.length) return
    setBulkDeleteOpen(true)
  }, [selectedIds])

  const handleBulkDeleteConfirm = useCallback(async () => {
    if (!selectedIds.length) {
      setBulkDeleteOpen(false)
      return
    }

    const idsToDelete = [...selectedIds]
    const count = idsToDelete.length
    const removedTemplates = templates.filter((tpl) => idsToDelete.includes(tpl.id))
    if (!removedTemplates.length) {
      setBulkDeleteOpen(false)
      return
    }

    setBulkDeleteOpen(false)
    setSelectedIds([])

    if (bulkDeleteUndoRef.current?.timeoutId) {
      clearTimeout(bulkDeleteUndoRef.current.timeoutId)
      bulkDeleteUndoRef.current = null
    }

    // UX Governance: Bulk delete action with tracking
    execute({
      type: InteractionType.DELETE,
      label: `Delete ${count} design${count !== 1 ? 's' : ''}`,
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      errorMessage: 'Failed to remove designs',
      action: async () => {
        setTemplates((prev) => prev.filter((tpl) => !idsToDelete.includes(tpl.id)))

        let undone = false
        const timeoutId = setTimeout(async () => {
          if (undone) return
          setBulkActionLoading(true)
          try {
            const result = await api.bulkDeleteTemplates(idsToDelete)
            const deletedCount = result?.deletedCount ?? result?.deleted?.length ?? 0
            const failedCount = result?.failedCount ?? result?.failed?.length ?? 0
            if (failedCount > 0) {
              toast.show(
                `Removed ${deletedCount} design${deletedCount !== 1 ? 's' : ''}, ${failedCount} failed`,
                'warning'
              )
            } else {
              toast.show(`Removed ${deletedCount} design${deletedCount !== 1 ? 's' : ''}`, 'success')
            }
            await fetchTemplatesData()
          } catch (err) {
            setTemplates((prev) => {
              const existing = new Set(prev.map((tpl) => tpl.id))
              const restored = removedTemplates.filter((tpl) => !existing.has(tpl.id))
              return restored.length ? [...prev, ...restored] : prev
            })
            throw err
          } finally {
            setBulkActionLoading(false)
          }
        }, 5000)

        bulkDeleteUndoRef.current = { timeoutId, ids: idsToDelete, templates: removedTemplates }

        toast.showWithUndo(
          `Removed ${count} design${count !== 1 ? 's' : ''}`,
          () => {
            undone = true
            clearTimeout(timeoutId)
            bulkDeleteUndoRef.current = null
            setTemplates((prev) => {
              const existing = new Set(prev.map((tpl) => tpl.id))
              const restored = removedTemplates.filter((tpl) => !existing.has(tpl.id))
              return restored.length ? [...prev, ...restored] : prev
            })
            toast.show('Designs restored', 'success')
          },
          { severity: 'info' }
        )
      },
    })
  }, [selectedIds, templates, toast, fetchTemplatesData, execute, setTemplates])

  const handleBulkStatusApply = useCallback(async () => {
    if (!selectedIds.length) {
      setBulkStatusOpen(false)
      return
    }

    const count = selectedIds.length
    setBulkStatusOpen(false)

    // UX Governance: Bulk update action with tracking
    execute({
      type: InteractionType.UPDATE,
      label: `Update status for ${count} design${count !== 1 ? 's' : ''}`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      errorMessage: 'Failed to update status',
      action: async () => {
        setBulkActionLoading(true)
        try {
          const result = await api.bulkUpdateTemplateStatus(selectedIds, bulkStatus)
          const updatedCount = result?.updatedCount ?? result?.updated?.length ?? 0
          const failedCount = result?.failedCount ?? result?.failed?.length ?? 0
          if (failedCount > 0) {
            toast.show(
              `Updated ${updatedCount} design${updatedCount !== 1 ? 's' : ''}, ${failedCount} failed`,
              'warning'
            )
          } else {
            toast.show(
              `Updated ${updatedCount} design${updatedCount !== 1 ? 's' : ''}`,
              'success'
            )
          }
          await fetchTemplatesData()
        } finally {
          setBulkActionLoading(false)
        }
      },
    })
  }, [selectedIds, bulkStatus, toast, fetchTemplatesData, execute])

  const handleBulkTagsApply = useCallback(async () => {
    if (!selectedIds.length) {
      setBulkTagsOpen(false)
      return
    }
    const tags = bulkTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (!tags.length) {
      toast.show('Enter at least one tag', 'error')
      return
    }
    const invalidTag = tags.find((tag) => tag.length > 50)
    if (invalidTag) {
      toast.show(`Tag "${invalidTag.slice(0, 20)}..." exceeds 50 character limit`, 'error')
      return
    }

    const count = selectedIds.length
    setBulkTagsOpen(false)

    // UX Governance: Bulk update action with tracking
    execute({
      type: InteractionType.UPDATE,
      label: `Add tags to ${count} design${count !== 1 ? 's' : ''}`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      errorMessage: 'Failed to add tags',
      action: async () => {
        setBulkActionLoading(true)
        try {
          const result = await api.bulkAddTemplateTags(selectedIds, tags)
          const updatedCount = result?.updatedCount ?? result?.updated?.length ?? 0
          const failedCount = result?.failedCount ?? result?.failed?.length ?? 0
          if (failedCount > 0) {
            toast.show(
              `Tagged ${updatedCount} design${updatedCount !== 1 ? 's' : ''}, ${failedCount} failed`,
              'warning'
            )
          } else {
            toast.show(
              `Tagged ${updatedCount} design${updatedCount !== 1 ? 's' : ''}`,
              'success'
            )
          }
          await fetchTemplatesData()
          setBulkTags('')
        } finally {
          setBulkActionLoading(false)
        }
      },
    })
  }, [selectedIds, bulkTags, toast, fetchTemplatesData, execute])

  const handleRowClick = useCallback((row) => {
    handleNavigate(`/reports?template=${row.id}`, 'Open reports', { templateId: row.id })
  }, [handleNavigate])

  const columns = useMemo(() => [
    {
      field: 'name',
      headerName: 'Design',
      minWidth: 200,
      flex: 1,
      renderCell: (value, row) => {
        const config = getKindConfig(theme, row.kind)
        const Icon = config.icon
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FavoriteButton
              entityType="templates"
              entityId={row.id}
              initialFavorite={favorites.has(row.id)}
              onToggle={(isFav) => handleFavoriteToggle(row.id, isFav)}
            />
            <KindIconContainer>
              <Icon sx={{ color: 'text.secondary', fontSize: 18 }} />
            </KindIconContainer>
            <Box sx={{ minWidth: 0, overflow: 'hidden' }}>
              <Typography sx={{
                fontWeight: 500,
                fontSize: '14px',
                color: 'text.primary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {value || row.id}
              </Typography>
              <Typography sx={{
                fontSize: '0.75rem',
                color: 'text.secondary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {row.description || `${row.kind?.toUpperCase() || 'PDF'} Design`}
              </Typography>
            </Box>
          </Box>
        )
      },
    },
    {
      field: 'kind',
      headerName: 'Type',
      width: 100,
      renderCell: (value) => {
        const config = getKindConfig(theme, value)
        return (
          <KindChip
            label={value?.toUpperCase() || 'PDF'}
            size="small"
            kindColor={config.color}
            kindBg={config.bgColor}
          />
        )
      },
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (value) => {
        const config = getStatusConfig(theme, value)
        return (
          <StatusChip
            label={value || 'approved'}
            size="small"
            statusColor={config.color}
            statusBg={config.bgColor}
          />
        )
      },
    },
    {
      field: 'mappingKeys',
      headerName: 'Fields',
      width: 80,
      renderCell: (value, row) => {
        const count = Array.isArray(value) ? value.length : Array.isArray(row.mappingKeys) ? row.mappingKeys.length : row.tokens_count
        return (
          <Typography sx={{ fontSize: '14px', color: 'text.secondary' }}>
            {count || '-'}
          </Typography>
        )
      },
    },
    {
      field: 'tags',
      headerName: 'Tags',
      width: 180,
      renderCell: (value) => {
        const tags = Array.isArray(value) ? value : []
        if (!tags.length) {
          return <Typography sx={{ fontSize: '0.75rem', color: 'text.disabled' }}>-</Typography>
        }
        return (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
            {tags.slice(0, 2).map((tag) => (
              <TagChip key={tag} label={tag} size="small" />
            ))}
            {tags.length > 2 && (
              <Typography variant="caption" color="text.secondary">
                +{tags.length - 2}
              </Typography>
            )}
          </Stack>
        )
      },
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      width: 120,
      renderCell: (value, row) => {
        const raw = value || row.created_at
        if (!raw) return <Typography sx={{ fontSize: '14px', color: 'text.disabled' }}>-</Typography>
        const d = new Date(raw)
        const now = new Date()
        const diffDay = Math.floor((now - d) / 86400000)
        const relative = diffDay < 1 ? 'Today' : diffDay < 2 ? 'Yesterday' : diffDay < 7 ? `${diffDay}d ago` : d.toLocaleDateString()
        return (
          <Tooltip title={d.toLocaleString()} arrow>
            <Typography sx={{ fontSize: '14px', color: 'text.secondary', cursor: 'default' }}>
              {relative}
            </Typography>
          </Tooltip>
        )
      },
    },
    {
      field: 'lastRunAt',
      headerName: 'Last Run',
      width: 120,
      renderCell: (value, row) => {
        const raw = value || row.last_run_at
        if (!raw) return <Typography sx={{ fontSize: '14px', color: 'text.disabled' }}>-</Typography>
        const d = new Date(raw)
        const now = new Date()
        const diffMs = now - d
        const diffHr = Math.floor(diffMs / 3600000)
        const diffDay = Math.floor(diffMs / 86400000)
        const relative = diffHr < 1 ? 'Just now' : diffHr < 24 ? `${diffHr}h ago` : diffDay < 7 ? `${diffDay}d ago` : d.toLocaleDateString()
        return (
          <Tooltip title={d.toLocaleString()} arrow>
            <Typography sx={{ fontSize: '14px', color: 'text.secondary', cursor: 'default' }}>
              {relative}
            </Typography>
          </Tooltip>
        )
      },
    },
    {
      field: 'updatedAt',
      headerName: 'Updated',
      width: 140,
      renderCell: (value, row) => {
        const raw = value || row.updated_at
        return (
          <Typography sx={{ fontSize: '14px', color: 'text.secondary' }}>
            {raw ? new Date(raw).toLocaleDateString() : '-'}
          </Typography>
        )
      },
    },
  ], [theme, favorites, handleFavoriteToggle])

  const filters = useMemo(() => {
    const baseFilters = [
      {
        key: 'kind',
        label: 'Type',
        options: [
          { value: 'pdf', label: 'PDF' },
          { value: 'excel', label: 'Excel' },
        ],
      },
      {
        key: 'status',
        label: 'Status',
        options: [
          { value: 'approved', label: 'Approved' },
          { value: 'pending', label: 'Pending' },
          { value: 'draft', label: 'Draft' },
          { value: 'archived', label: 'Archived' },
        ],
      },
    ]

    if (allTags.length > 0) {
      baseFilters.push({
        key: 'tags',
        label: 'Tag',
        options: allTags.map((tag) => ({ value: tag, label: tag })),
        matchFn: (row, filterValue) => {
          const rowTags = Array.isArray(row.tags) ? row.tags : []
          return rowTags.includes(filterValue)
        },
      })
    }

    return baseFilters
  }, [allTags])

  const bulkActions = useMemo(() => ([
    {
      label: 'Update Status',
      icon: <ArchiveIcon sx={{ fontSize: 16 }} />,
      onClick: () => setBulkStatusOpen(true),
      disabled: bulkActionLoading,
    },
    {
      label: 'Add Tags',
      icon: <LabelIcon sx={{ fontSize: 16 }} />,
      onClick: () => setBulkTagsOpen(true),
      disabled: bulkActionLoading,
    },
  ]), [bulkActionLoading])

  return (
    <PageContainer>
      {(kindFilter || statusParam) && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
          {kindFilter && (
            <QuickFilterChip
              label={`Type: ${kindFilter.toUpperCase()}`}
              onDelete={() => clearQuickFilter('kind')}
              size="small"
            />
          )}
          {statusParam && (
            <QuickFilterChip
              label={`Status: ${statusParam}`}
              onDelete={() => clearQuickFilter('status')}
              size="small"
            />
          )}
        </Stack>
      )}
      <Box sx={{ mb: 2 }}>
        <ReportGlossaryNotice />
      </Box>
      <DataTable
        title="Report Designs"
        subtitle="Upload and manage your report designs"
        columns={columns}
        data={filteredTemplates}
        loading={loading}
        searchPlaceholder="Search designs..."
        filters={filters}
        actions={[
          {
            label: 'Create with AI',
            icon: <AutoAwesomeIcon sx={{ fontSize: 18 }} />,
            variant: 'contained',
            onClick: handleCreateWithAi,
          },
          {
            label: 'Upload Design',
            icon: <AddIcon sx={{ fontSize: 18 }} />,
            variant: 'outlined',
            onClick: handleAddTemplate,
          },
          {
            label: 'Import Backup',
            icon: <UploadFileIcon sx={{ fontSize: 18 }} />,
            variant: 'outlined',
            onClick: handleOpenImport,
          },
        ]}
        selectable
        onSelectionChange={setSelectedIds}
        bulkActions={bulkActions}
        onBulkDelete={handleBulkDeleteOpen}
        onRowClick={handleRowClick}
        rowActions={(row) => (
          <Tooltip title="More actions">
            <MoreActionsButton
              size="small"
              onClick={(e) => handleOpenMenu(e, row)}
              aria-label="More actions"
            >
              <MoreVertIcon sx={{ fontSize: 18 }} />
            </MoreActionsButton>
          </Tooltip>
        )}
        emptyState={{
          icon: DescriptionIcon,
          title: 'No report designs yet',
          description: 'Create a template with AI or upload a PDF/Excel file.',
          actionLabel: 'Create with AI',
          onAction: handleCreateWithAi,
        }}
      />

      {/* Row Actions Menu */}
      <StyledMenu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleCloseMenu}
      >
        <StyledMenuItem onClick={handleEditTemplate}>
          <ListItemIcon><EditIcon sx={{ fontSize: 16 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>Edit</ListItemText>
        </StyledMenuItem>
        <StyledMenuItem onClick={handleEditMetadata}>
          <ListItemIcon><SettingsIcon sx={{ fontSize: 16 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>Edit Details</ListItemText>
        </StyledMenuItem>
        <StyledMenuItem onClick={handleExport}>
          <ListItemIcon><DownloadIcon sx={{ fontSize: 16 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>Export</ListItemText>
        </StyledMenuItem>
        <StyledMenuItem onClick={handleDuplicate} disabled={duplicating}>
          <ListItemIcon><ContentCopyIcon sx={{ fontSize: 16 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>{duplicating ? 'Duplicating...' : 'Duplicate'}</ListItemText>
        </StyledMenuItem>
        <StyledMenuItem onClick={handleViewSimilar}>
          <ListItemIcon><AutoAwesomeIcon sx={{ fontSize: 16 }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>View Similar</ListItemText>
        </StyledMenuItem>
        <StyledMenuItem onClick={handleDeleteClick} sx={{ color: 'text.primary' }}>
          <ListItemIcon><DeleteIcon sx={{ fontSize: 16, color: 'text.secondary' }} /></ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>Delete</ListItemText>
        </StyledMenuItem>
      </StyledMenu>

      {/* Delete Confirmation */}
      <ConfirmModal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Remove Design"
        message={`Remove "${deletingTemplate?.name || deletingTemplate?.id}"? Past report files remain in History. You can undo this within a few seconds.`}
        confirmLabel="Remove"
        severity="error"
        loading={loading}
      />

      <ConfirmModal
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDeleteConfirm}
        title="Remove Designs"
        message={`Remove ${selectedIds.length} design${selectedIds.length !== 1 ? 's' : ''}? Past report files remain in History. You can undo this within a few seconds.`}
        confirmLabel="Remove"
        severity="error"
        loading={bulkActionLoading}
      />

      {/* Edit Metadata Dialog */}
      <StyledDialog open={metadataOpen} onClose={() => setMetadataOpen(false)} maxWidth="sm" fullWidth>
        <DialogHeader>Edit Design Details</DialogHeader>
        <StyledDialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <StyledTextField
              label="Name"
              value={metadataForm.name}
              onChange={(e) => setMetadataForm((prev) => ({ ...prev, name: e.target.value }))}
              fullWidth
            />
            <StyledTextField
              label="Description"
              value={metadataForm.description}
              onChange={(e) => setMetadataForm((prev) => ({ ...prev, description: e.target.value }))}
              multiline
              minRows={2}
              fullWidth
            />
            <StyledTextField
              label="Tags"
              value={metadataForm.tags}
              onChange={(e) => setMetadataForm((prev) => ({ ...prev, tags: e.target.value }))}
              helperText="Comma-separated (e.g. finance, monthly, ops)"
              fullWidth
            />
            <StyledFormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={metadataForm.status}
                label="Status"
                onChange={(e) => setMetadataForm((prev) => ({ ...prev, status: e.target.value }))}
              >
                <MenuItem value="approved">Approved</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="archived">Archived</MenuItem>
              </Select>
            </StyledFormControl>
          </Stack>
        </StyledDialogContent>
        <StyledDialogActions>
          <SecondaryButton variant="outlined" onClick={() => setMetadataOpen(false)} disabled={metadataSaving}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={handleMetadataSave}
            disabled={metadataSaving || !metadataForm.name.trim()}
          >
            {metadataSaving ? 'Saving...' : 'Save'}
          </PrimaryButton>
        </StyledDialogActions>
      </StyledDialog>

      {/* Bulk Status Dialog */}
      <StyledDialog open={bulkStatusOpen} onClose={() => setBulkStatusOpen(false)} maxWidth="xs" fullWidth>
        <DialogHeader>Update Status</DialogHeader>
        <StyledDialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography sx={{ fontSize: '14px', color: 'text.secondary' }}>
              Update {selectedIds.length} design{selectedIds.length !== 1 ? 's' : ''} to:
            </Typography>
            <StyledFormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={bulkStatus}
                label="Status"
                onChange={(e) => setBulkStatus(e.target.value)}
              >
                <MenuItem value="approved">Approved</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="archived">Archived</MenuItem>
              </Select>
            </StyledFormControl>
          </Stack>
        </StyledDialogContent>
        <StyledDialogActions>
          <SecondaryButton variant="outlined" onClick={() => setBulkStatusOpen(false)} disabled={bulkActionLoading}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={handleBulkStatusApply}
            disabled={bulkActionLoading}
          >
            {bulkActionLoading ? 'Updating...' : 'Update'}
          </PrimaryButton>
        </StyledDialogActions>
      </StyledDialog>

      {/* Bulk Tags Dialog */}
      <StyledDialog open={bulkTagsOpen} onClose={() => setBulkTagsOpen(false)} maxWidth="sm" fullWidth>
        <DialogHeader>Add Tags</DialogHeader>
        <StyledDialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography sx={{ fontSize: '14px', color: 'text.secondary' }}>
              Add tags to {selectedIds.length} design{selectedIds.length !== 1 ? 's' : ''}.
            </Typography>
            <StyledTextField
              label="Tags"
              value={bulkTags}
              onChange={(e) => setBulkTags(e.target.value)}
              helperText="Comma-separated (e.g. finance, monthly, ops)"
              fullWidth
            />
          </Stack>
        </StyledDialogContent>
        <StyledDialogActions>
          <SecondaryButton variant="outlined" onClick={() => setBulkTagsOpen(false)} disabled={bulkActionLoading}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={handleBulkTagsApply}
            disabled={bulkActionLoading}
          >
            {bulkActionLoading ? 'Updating...' : 'Add Tags'}
          </PrimaryButton>
        </StyledDialogActions>
      </StyledDialog>

      {/* Import Dialog */}
      <StyledDialog open={importOpen} onClose={() => !importing && setImportOpen(false)} maxWidth="sm" fullWidth>
        <DialogHeader>Import Design Backup</DialogHeader>
        <StyledDialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <SecondaryButton variant="outlined" component="label" disabled={importing}>
              {importFile ? importFile.name : 'Choose backup file (.zip)'}
              <input
                type="file"
                hidden
                accept=".zip"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              />
            </SecondaryButton>
            <StyledTextField
              label="Design Name (optional)"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              fullWidth
              disabled={importing}
            />
            {importing && (
              <Box sx={{ width: '100%' }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Uploading... {importProgress}%
                </Typography>
                <StyledLinearProgress variant="determinate" value={importProgress} />
              </Box>
            )}
          </Stack>
        </StyledDialogContent>
        <StyledDialogActions>
          <SecondaryButton variant="outlined" onClick={() => setImportOpen(false)} disabled={importing}>Cancel</SecondaryButton>
          <PrimaryButton onClick={handleImport} disabled={importing || !importFile}>
            {importing ? 'Importing...' : 'Import'}
          </PrimaryButton>
        </StyledDialogActions>
      </StyledDialog>

      {/* Similar Designs Dialog */}
      <StyledDialog open={similarOpen} onClose={() => setSimilarOpen(false)} maxWidth="sm" fullWidth>
        <DialogHeader>
          <Stack direction="row" alignItems="center" spacing={1}>
            <AiIcon />
            <span>Similar Designs</span>
          </Stack>
        </DialogHeader>
        <StyledDialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Designs similar to "{similarTemplate?.name || similarTemplate?.id}"
          </Typography>
          {similarLoading ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">Loading similar designs...</Typography>
            </Box>
          ) : similarTemplates.length === 0 ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">No similar designs found.</Typography>
            </Box>
          ) : (
            <Stack spacing={1}>
              {similarTemplates.map((template) => {
                const config = getKindConfig(theme, template.kind)
                const Icon = config.icon
                return (
                  <SimilarTemplateCard
                    key={template.id}
                    onClick={() => handleSelectSimilarTemplate(template)}
                  >
                    <Stack direction="row" alignItems="center" spacing={2}>
                      <KindIconContainer>
                        <Icon sx={{ color: 'text.secondary', fontSize: 18 }} />
                      </KindIconContainer>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2">{template.name || template.id}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {template.description || `${template.kind?.toUpperCase() || 'PDF'} Design`}
                        </Typography>
                      </Box>
                      {template.similarity_score && (
                        <Chip
                          label={`${Math.round(template.similarity_score * 100)}% match`}
                          size="small"
                          variant="outlined"
                          sx={{ borderRadius: 8, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                        />
                      )}
                    </Stack>
                  </SimilarTemplateCard>
                )
              })}
            </Stack>
          )}
        </StyledDialogContent>
        <StyledDialogActions>
          <SecondaryButton variant="outlined" onClick={() => setSimilarOpen(false)}>Close</SecondaryButton>
        </StyledDialogActions>
      </StyledDialog>
    </PageContainer>
  )
}

// === From: TemplateChatCreateContainer.jsx ===

const MAX_PDF_SIZE_MB = 10

const CHAT_CHAT_SESSION_KEY = '__chat_create__'

export function TemplateChatCreateContainer() {
  const navigate = useNavigateInteraction()
  const toast = useToast()
  const { execute } = useInteraction()
  const addTemplate = useAppStore((s) => s.addTemplate)
  const setTemplateId = useAppStore((s) => s.setTemplateId)
  const lastUsedConnectionId = useAppStore((s) => s.lastUsed?.connectionId || null)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const setActiveConnectionId = useAppStore((s) => s.setActiveConnectionId)
  const deleteSession = useTemplateChatStore((s) => s.deleteSession)
  const [searchParams] = useSearchParams()
  const fromWizard = searchParams.get('from') === 'wizard'
  const wizardConnectionId = searchParams.get('connectionId') || null
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    wizardConnectionId || lastUsedConnectionId || activeConnection?.id || ''
  )

  const addAssistantMessage = useTemplateChatStore((s) => s.addAssistantMessage)

  const [currentHtml, setCurrentHtml] = useState('')
  const [previewUrl, setPreviewUrl] = useState(null)
  const [nameDialogOpen, setNameDialogOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [creating, setCreating] = useState(false)
  const [samplePdf, setSamplePdf] = useState(null) // { file: File, name, size }
  const [templateKind, setTemplateKind] = useState('pdf')
  const fileInputRef = useRef(null)

  // Mapping phase state — shown after template save
  const [savedTemplateId, setSavedTemplateId] = useState(null)
  const [savedTemplateKind, setSavedTemplateKind] = useState('pdf')
  const [savedTemplateName, setSavedTemplateName] = useState('')
  const [mappingPreviewData, setMappingPreviewData] = useState(null)
  const [mappingApproving, setMappingApproving] = useState(false)

  const handleFileSelect = useCallback((file) => {
    if (!file) return
    const pdfTypes = ['application/pdf']
    const excelTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ]
    const allowedTypes = templateKind === 'excel' ? [...pdfTypes, ...excelTypes] : pdfTypes
    const isExcelExt = /\.(xlsx|xls)$/i.test(file.name)
    if (!allowedTypes.includes(file.type) && !(templateKind === 'excel' && isExcelExt)) {
      toast.show(templateKind === 'excel' ? 'Please upload a PDF or Excel file.' : 'Please upload a PDF file.', 'warning')
      return
    }
    if (file.size > MAX_PDF_SIZE_MB * 1024 * 1024) {
      toast.show(`File too large. Maximum size is ${MAX_PDF_SIZE_MB}MB.`, 'warning')
      return
    }
    setSamplePdf({ file, name: file.name, size: file.size })
    toast.show(`Sample file "${file.name}" attached. The AI will use this as a visual reference.`, 'info')
  }, [toast, templateKind])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    handleFileSelect(file)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
  }, [])

  const handleRemovePdf = useCallback(() => {
    setSamplePdf(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // Update preview when HTML changes
  useEffect(() => {
    if (!currentHtml) {
      setPreviewUrl(null)
      return
    }
    const blob = new Blob([currentHtml], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [currentHtml])

  // Clean up session on unmount
  useEffect(() => {
    return () => {
      // Don't clean up — let the user resume if they navigate back
    }
  }, [])

  const handleHtmlUpdate = useCallback((html) => {
    setCurrentHtml(html)
  }, [])

  const handleApplySuccess = useCallback((result) => {
    // In create mode, "apply" just updates local state (nothing persisted yet)
    if (result?.updated_html) {
      setCurrentHtml(result.updated_html)
    }
  }, [])

  const handleBack = useCallback(async () => {
    const backTo = fromWizard ? '/setup?step=template' : '/templates'
    await navigate(backTo, {
      interaction: {
        type: InteractionType.NAVIGATE,
        label: fromWizard ? 'Back to wizard' : 'Back to templates',
        reversibility: Reversibility.FULLY_REVERSIBLE,
      },
    })
  }, [navigate, fromWizard])

  const handleOpenNameDialog = useCallback(() => {
    setNameDialogOpen(true)
  }, [])

  const handleCloseNameDialog = useCallback(() => {
    setNameDialogOpen(false)
  }, [])

  const handleCreateTemplate = useCallback(async () => {
    const name = templateName.trim()
    if (!name) {
      toast.show('Please enter a template name.', 'warning')
      return
    }
    if (!currentHtml) {
      toast.show('No template HTML to save. Continue the conversation to generate a template first.', 'warning')
      return
    }

    await execute({
      type: InteractionType.CREATE,
      label: 'Create template from chat',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        action: 'create_template_from_chat',
        name,
      },
      action: async () => {
        setCreating(true)
        try {
          const result = await createTemplateFromChat(name, currentHtml, templateKind)
          const templateId = result?.template_id
          const kind = result?.kind || 'pdf'

          // Add to store and set as active template
          if (templateId) {
            addTemplate({
              id: templateId,
              name,
              kind,
              status: 'draft',
              artifacts: {},
              tags: [],
            })
            setTemplateId(templateId)
          }

          setNameDialogOpen(false)

          // Run mapping preview and show in chat for user review
          const connId = selectedConnectionId || wizardConnectionId || lastUsedConnectionId
          if (templateId && connId) {
            // Save template details for mapping phase
            setSavedTemplateId(templateId)
            setSavedTemplateKind(kind)
            setSavedTemplateName(name)

            toast.show(`Template "${name}" saved! Fetching data mapping suggestions...`, 'info')
            addAssistantMessage(
              CHAT_SESSION_KEY,
              `Template "${name}" has been saved successfully! Now let's configure how your template fields map to your database columns. Fetching mapping suggestions...`
            )

            try {
              const preview = await mappingPreview(templateId, connId, { kind })
              const mapping = preview?.mapping || preview?.auto_mapping || {}

              if (Object.keys(mapping).length > 0) {
                // Show the mapping review panel in the chat
                setMappingPreviewData(preview)
                addAssistantMessage(
                  CHAT_SESSION_KEY,
                  `I've auto-mapped ${Object.keys(mapping).length} template fields to your database columns. Review the mapping below — you can click any value to change it, or type in the chat to discuss changes.`
                )
              } else {
                toast.show(`Template "${name}" saved. No auto-mapping available — you can configure mapping later.`, 'info')
                addAssistantMessage(
                  CHAT_SESSION_KEY,
                  `Template saved, but I couldn't generate auto-mapping suggestions. You can configure mapping manually from the template editor.`
                )
                // Navigate away since no mapping to review
                navigateToTemplate(templateId, name, kind)
              }
            } catch (mapErr) {
              console.warn('Mapping preview failed:', mapErr)
              toast.show(`Template "${name}" saved. Mapping preview failed — you can map manually later.`, 'warning')
              addAssistantMessage(
                CHAT_SESSION_KEY,
                `Template saved! Auto-mapping encountered an issue, but you can configure it from the template editor.`
              )
              navigateToTemplate(templateId, name, kind)
            }
          } else {
            toast.show(`Template "${name}" created successfully.`, 'success')
            addAssistantMessage(
              CHAT_SESSION_KEY,
              `Template "${name}" has been saved! Connect a database to enable field mapping.`
            )
            // No connection — navigate away
            deleteSession(CHAT_SESSION_KEY)
            navigateToTemplate(templateId, name, kind)
          }
        } catch (err) {
          toast.show(String(err.message || err), 'error')
          throw err
        } finally {
          setCreating(false)
        }
      },
    })
  }, [templateName, currentHtml, execute, addTemplate, setTemplateId, deleteSession, toast, navigate, fromWizard, wizardConnectionId, lastUsedConnectionId, addAssistantMessage])

  // Navigate to template editor (after save or after mapping)
  const navigateToTemplate = useCallback(async (templateId, name, kind) => {
    deleteSession(CHAT_SESSION_KEY)
    if (fromWizard) {
      try {
        const wizardRaw = sessionStorage.getItem('neurareport_wizard_state')
        const wizardData = wizardRaw ? JSON.parse(wizardRaw) : {}
        wizardData.templateId = templateId
        wizardData.templateKind = kind
        wizardData.templateName = name
        sessionStorage.setItem('neurareport_wizard_state', JSON.stringify(wizardData))
      } catch (_) { /* ignore storage errors */ }

      await navigate('/setup?step=mapping', {
        interaction: {
          type: InteractionType.NAVIGATE,
          label: 'Continue to mapping',
          reversibility: Reversibility.FULLY_REVERSIBLE,
        },
      })
    } else {
      await navigate(`/templates/${templateId}/edit`, {
        state: { from: '/templates', editMode: 'chat' },
        interaction: {
          type: InteractionType.NAVIGATE,
          label: 'Open new template editor',
          reversibility: Reversibility.FULLY_REVERSIBLE,
        },
      })
    }
  }, [deleteSession, fromWizard, navigate])

  // Handle mapping approval from the chat panel
  const handleMappingApprove = useCallback(async (finalMapping) => {
    if (!savedTemplateId) return
    setMappingApproving(true)
    try {
      const connId = selectedConnectionId || wizardConnectionId || lastUsedConnectionId
      addAssistantMessage(CHAT_SESSION_KEY, 'Building contract and generator assets... This may take a moment.')
      toast.show('Approving mapping and building contract...', 'info')
      await mappingApprove(savedTemplateId, finalMapping, {
        connectionId: connId,
        kind: savedTemplateKind,
      })
      toast.show(`Template "${savedTemplateName}" is report-ready!`, 'success')
      addAssistantMessage(CHAT_SESSION_KEY, `Mapping approved and contract built! Template "${savedTemplateName}" is now report-ready. Redirecting...`)
      // Short delay so user sees the success message
      setTimeout(() => {
        navigateToTemplate(savedTemplateId, savedTemplateName, savedTemplateKind)
      }, 1500)
    } catch (err) {
      console.error('Mapping approve failed:', err)
      toast.show('Mapping approval failed. You can retry or map later from the editor.', 'error')
      addAssistantMessage(CHAT_SESSION_KEY, `Mapping approval encountered an error: ${err.message || err}. You can try again or skip to map later.`)
    } finally {
      setMappingApproving(false)
    }
  }, [savedTemplateId, savedTemplateKind, savedTemplateName, wizardConnectionId, lastUsedConnectionId, toast, addAssistantMessage, navigateToTemplate])

  // Handle "Skip — Map Later"
  const handleMappingSkip = useCallback(() => {
    if (!savedTemplateId) return
    toast.show(`Template "${savedTemplateName}" saved. You can configure mapping from the editor.`, 'info')
    navigateToTemplate(savedTemplateId, savedTemplateName, savedTemplateKind)
  }, [savedTemplateId, savedTemplateName, savedTemplateKind, toast, navigateToTemplate])

  // Handle "Queue & Continue" — fire-and-forget the approval and navigate away
  const handleMappingQueue = useCallback(() => {
    if (!savedTemplateId) return
    const connId = selectedConnectionId || wizardConnectionId || lastUsedConnectionId
    // Fire the approval in the background — don't await
    mappingApprove(savedTemplateId, mappingPreviewData?.mapping || {}, {
      connectionId: connId,
      kind: savedTemplateKind,
    }).then(() => {
      // Silently succeeds in background
    }).catch((err) => {
      console.warn('Background mapping approval failed:', err)
    })
    toast.show(`Mapping approval queued for "${savedTemplateName}". You can check progress from the template editor.`, 'info')
    navigateToTemplate(savedTemplateId, savedTemplateName, savedTemplateKind)
  }, [savedTemplateId, savedTemplateName, savedTemplateKind, wizardConnectionId, lastUsedConnectionId, mappingPreviewData, toast, navigateToTemplate])

  // Wrap the chatApi to match (messages, html) signature, passing sample PDF and kind
  const chatApi = useCallback((messages, html) => {
    return chatTemplateCreate(messages, html, samplePdf?.file || null, templateKind)
  }, [samplePdf, templateKind])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
      {/* Breadcrumb */}
      <Box sx={{ mb: 1, flexShrink: 0 }}>
        <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
          <Link
            component={RouterLink}
            to="/templates"
            underline="hover"
            color="text.secondary"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            Templates
          </Link>
          <Typography color="text.primary" fontWeight={600}>
            Create with AI
          </Typography>
        </Breadcrumbs>
      </Box>

      <Surface sx={{ gap: { xs: 1.5, md: 2 }, flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ flexShrink: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <AutoAwesomeIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
            <Typography variant="h6" fontWeight={600}>
              Create Template with AI
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center">
            <ConnectionSelector
              value={selectedConnectionId}
              onChange={(connId) => {
                setSelectedConnectionId(connId)
                setActiveConnectionId(connId)
              }}
              label="Data Source"
              size="small"
              fullWidth={false}
              sx={{ minWidth: 200 }}
            />
            <Button
              variant="contained"
              onClick={handleOpenNameDialog}
              disabled={!currentHtml}
              startIcon={<SaveIcon />}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                bgcolor: neutral[900],
                '&:hover': { bgcolor: neutral[700] },
                '&.Mui-disabled': { bgcolor: neutral[300], color: neutral[500] },
              }}
            >
              Save Template
            </Button>
            <Button
              variant="outlined"
              onClick={handleBack}
              startIcon={<ArrowBackIcon />}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Back
            </Button>
          </Stack>
        </Stack>

        {/* Sample PDF Upload — compact */}
        {samplePdf ? (
          <Paper
            variant="outlined"
            sx={{
              px: 1.5, py: 0.75,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              borderColor: 'primary.main',
              bgcolor: 'primary.50',
              flexShrink: 0,
            }}
          >
            <PictureAsPdfIcon sx={{ color: 'error.main', fontSize: 20 }} />
            <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0 }}>
              {samplePdf.name}
            </Typography>
            <Chip label="Sample PDF" size="small" color="primary" variant="outlined" />
            <IconButton size="small" onClick={handleRemovePdf} title="Remove sample PDF">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Paper>
        ) : (
          <Paper
            variant="outlined"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            sx={{
              px: 1.5, py: 0.75,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              cursor: 'pointer',
              borderStyle: 'dashed',
              borderColor: 'divider',
              '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
              transition: 'all 0.15s',
              flexShrink: 0,
            }}
          >
            <UploadFileIcon sx={{ color: 'text.secondary' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {templateKind === 'excel' ? 'Have a sample PDF or Excel file?' : 'Have a sample PDF?'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {templateKind === 'excel'
                  ? 'Drop a PDF or Excel file here or click to upload. The AI will use it as a visual reference.'
                  : 'Drop a PDF here or click to upload. The AI will use it as a visual reference for layout and styling.'}
              </Typography>
            </Box>
            <Chip label="Optional" size="small" variant="outlined" />
            <input
              ref={fileInputRef}
              type="file"
              accept={templateKind === 'excel' ? 'application/pdf,.xlsx,.xls' : 'application/pdf'}
              hidden
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
            />
          </Paper>
        )}

        {/* Main content: Preview + Chat — fills remaining Surface space */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '7fr 5fr' },
            gap: 2,
            flex: 1,
            minHeight: 0,      /* allow shrinking within flex parent */
          }}
        >
          {/* Left: Preview — full-width iframe with vertical scroll */}
          <Box
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'hidden',
              bgcolor: 'background.paper',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                p: 1.5,
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.default',
                flexShrink: 0,
              }}
            >
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                Template Preview
              </Typography>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {previewUrl ? (
                <iframe
                  src={previewUrl}
                  title="Template Preview"
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    display: 'block',
                    minHeight: 600,
                  }}
                />
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    p: 4,
                  }}
                >
                  <Alert severity="info" variant="outlined" sx={{ maxWidth: 400 }}>
                    Start a conversation to generate a template. The preview will appear here as the AI creates your template.
                  </Alert>
                </Box>
              )}
            </Box>
          </Box>

          {/* Right: Chat — only this panel scrolls internally */}
          <TemplateChatEditor
            templateId={CHAT_SESSION_KEY}
            templateName="New Template"
            currentHtml={currentHtml}
            onHtmlUpdate={handleHtmlUpdate}
            onApplySuccess={handleApplySuccess}
            onRequestSave={handleOpenNameDialog}
            mappingPreviewData={mappingPreviewData}
            mappingApproving={mappingApproving}
            onMappingApprove={handleMappingApprove}
            onMappingSkip={handleMappingSkip}
            onMappingQueue={handleMappingQueue}
            mode="create"
            chatApi={chatApi}
          />
        </Box>
      </Surface>

      {/* Name Dialog */}
      <Dialog
        open={nameDialogOpen}
        onClose={handleCloseNameDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle sx={{ fontWeight: 600 }}>
          Name Your Template
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Give your template a descriptive name. You can change this later.
          </Typography>
          <ToggleButtonGroup
            value={templateKind}
            exclusive
            onChange={(_, newKind) => newKind && setTemplateKind(newKind)}
            size="small"
            sx={{ mb: 2 }}
          >
            <ToggleButton value="pdf">
              <PictureAsPdfIcon sx={{ mr: 1, fontSize: 18 }} /> PDF Report
            </ToggleButton>
            <ToggleButton value="excel">
              <TableChartIcon sx={{ mr: 1, fontSize: 18 }} /> Excel Report
            </ToggleButton>
          </ToggleButtonGroup>
          <TextField
            autoFocus
            fullWidth
            label="Template Name"
            placeholder="e.g., Monthly Sales Invoice"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && templateName.trim()) {
                handleCreateTemplate()
              }
            }}
            disabled={creating}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseNameDialog} disabled={creating}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateTemplate}
            disabled={!templateName.trim() || creating}
            sx={{
              bgcolor: neutral[900],
              '&:hover': { bgcolor: neutral[700] },
            }}
          >
            {creating ? 'Creating...' : 'Create Template'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// === From: UnifiedTemplateCreator.jsx ===

export function UnifiedTemplateCreator() {
  const navigate = useNavigateInteraction()
  const toast = useToast()
  const { execute } = useInteraction()
  const [searchParams] = useSearchParams()

  // Preview dialog state
  const [previewOpen, setPreviewOpen] = useState(false)

  // Store selectors
  const sourceMode = useTemplateCreatorStore((s) => s.sourceMode)
  const templateKind = useTemplateCreatorStore((s) => s.templateKind)
  const templateId = useTemplateCreatorStore((s) => s.templateId)
  const templateName = useTemplateCreatorStore((s) => s.templateName)
  const currentHtml = useTemplateCreatorStore((s) => s.currentHtml)
  const connectionId = useTemplateCreatorStore((s) => s.connectionId)
  const finalized = useTemplateCreatorStore((s) => s.finalized)
  const error = useTemplateCreatorStore((s) => s.error)

  // Store actions
  const setSourceMode = useTemplateCreatorStore((s) => s.setSourceMode)
  const setTemplateKind = useTemplateCreatorStore((s) => s.setTemplateKind)
  const setConnectionId = useTemplateCreatorStore((s) => s.setConnectionId)
  const setCurrentHtml = useTemplateCreatorStore((s) => s.setCurrentHtml)
  const reset = useTemplateCreatorStore((s) => s.reset)

  // App store
  const lastUsedConnectionId = useAppStore((s) => s.lastUsed?.connectionId || null)
  const activeConnection = useAppStore((s) => s.activeConnection)
  const setActiveConnectionId = useAppStore((s) => s.setActiveConnectionId)

  // Auto-trigger agents when HTML / connection changes
  useAgentTrigger()

  // Initialize from URL params
  useEffect(() => {
    const mode = searchParams.get('mode')
    if (mode === 'describe') {
      setSourceMode('describe')
    }
  }, [searchParams, setSourceMode])

  // Initialize connection from app state
  useEffect(() => {
    if (!connectionId) {
      const initial = lastUsedConnectionId || activeConnection?.id || ''
      if (initial) setConnectionId(initial)
    }
  }, [connectionId, lastUsedConnectionId, activeConnection, setConnectionId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Don't reset — let user resume if they navigate back
    }
  }, [])

  const handleConnectionChange = useCallback((connId) => {
    setConnectionId(connId)
    setActiveConnectionId(connId)
  }, [setConnectionId, setActiveConnectionId])

  const handleKindChange = useCallback((_, newKind) => {
    if (newKind) setTemplateKind(newKind)
  }, [setTemplateKind])

  const handleBack = useCallback(async () => {
    await navigate('/templates', {
      interaction: {
        type: InteractionType.NAVIGATE,
        label: 'Back to templates',
        reversibility: Reversibility.FULLY_REVERSIBLE,
      },
    })
  }, [navigate])

  const handleFinalize = useCallback(async () => {
    if (!templateId) {
      toast.show('Save the template first before finalizing.', 'warning')
      return
    }
    await navigate(`/templates/${templateId}/edit`, {
      interaction: {
        type: InteractionType.NAVIGATE,
        label: 'Open template editor',
        reversibility: Reversibility.FULLY_REVERSIBLE,
      },
    })
  }, [templateId, navigate, toast])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
      {/* Breadcrumb */}
      <Box sx={{ mb: 1, flexShrink: 0 }}>
        <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} aria-label="breadcrumb">
          <Link
            component={RouterLink}
            to="/templates"
            underline="hover"
            color="text.secondary"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            Templates
          </Link>
          <Typography color="text.primary" fontWeight={600}>
            New Template
          </Typography>
        </Breadcrumbs>
      </Box>

      <Surface sx={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden', gap: 1.5 }}>
        {/* Header Bar */}
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={1.5}
          sx={{ flexShrink: 0 }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <ToggleButtonGroup
              value={templateKind}
              exclusive
              onChange={handleKindChange}
              size="small"
            >
              <ToggleButton value="pdf" sx={{ textTransform: 'none', px: 1.5 }}>
                <PictureAsPdfIcon sx={{ mr: 0.5, fontSize: 18 }} /> PDF
              </ToggleButton>
              <ToggleButton value="excel" sx={{ textTransform: 'none', px: 1.5 }}>
                <TableChartIcon sx={{ mr: 0.5, fontSize: 18 }} /> Excel
              </ToggleButton>
            </ToggleButtonGroup>

            <ConnectionSelector
              value={connectionId || ''}
              onChange={handleConnectionChange}
              label="Data Source"
              size="small"
              fullWidth={false}
              sx={{ minWidth: 180 }}
            />
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            {/* View Template button */}
            <Button
              variant="outlined"
              size="small"
              startIcon={<PreviewIcon />}
              onClick={() => setPreviewOpen(true)}
              disabled={!currentHtml}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderColor: currentHtml ? 'primary.main' : neutral[300],
              }}
            >
              View Template
            </Button>

            {finalized && (
              <Chip
                icon={<CheckCircleIcon />}
                label="Report-Ready"
                color="success"
                size="small"
                variant="outlined"
              />
            )}
            <Button
              variant="contained"
              onClick={handleFinalize}
              disabled={!templateId}
              startIcon={<SaveIcon />}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                bgcolor: neutral[900],
                '&:hover': { bgcolor: neutral[700] },
                '&.Mui-disabled': { bgcolor: neutral[300], color: neutral[500] },
              }}
            >
              {finalized ? 'Open Editor' : 'Save & Edit'}
            </Button>
          </Stack>
        </Stack>

        {/* 2-Panel Body: Chat + Intelligence Canvas */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 1.5,
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* LEFT: Chat */}
          <ChatPanel />

          {/* RIGHT: Intelligence Canvas */}
          <IntelligenceCanvas />
        </Box>
      </Surface>

      {/* Fullscreen Template Preview Dialog */}
      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        fullScreen
        PaperProps={{
          sx: {
            bgcolor: 'background.default',
          },
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            py: 1.5,
            px: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6" fontWeight={600}>
            Template Preview
          </Typography>
          <IconButton onClick={() => setPreviewOpen(false)} edge="end">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <TemplatePreviewPanel />
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
