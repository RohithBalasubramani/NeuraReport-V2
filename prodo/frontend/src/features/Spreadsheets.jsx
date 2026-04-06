import 'handsontable/dist/handsontable.full.min.css'
import { HotTable } from '@handsontable/react'
import { neutral, palette } from '@/app/theme'
import { ConnectionSelector, ImportFromMenu, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useIncomingTransfer, useSharedData } from '@/hooks/hooks'
import { useSpreadsheetStore } from '@/stores/content'
import { FeatureKey, TransferAction } from '@/utils/helpers'
import {
  Add as AddIcon,
  AddCircleOutline,
  AutoAwesome as AIIcon,
  Check as ApplyIcon,
  Close as CancelIcon,
  ContentCopy,
  ContentCut,
  ContentCut as CutIcon,
  ContentPaste,
  ContentPaste as PasteIcon,
  Delete,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Edit as EditIcon,
  FileCopy as CopyIcon,
  FilterList,
  FilterList as FilterIcon,
  FormatBold,
  FormatColorFill,
  FormatItalic,
  Functions as FormulaIcon,
  KeyboardArrowDown as DropdownIcon,
  MoreVert as MoreIcon,
  PivotTableChart as PivotIcon,
  Redo as RedoIcon,
  RemoveCircleOutline,
  Save as SaveIcon,
  Sort,
  Sort as SortIcon,
  TableChart as SpreadsheetIcon,
  TableRows,
  TextFormat as FormatIcon,
  Undo as UndoIcon,
  Upload as UploadIcon,
  ViewColumn,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import { registerAllModules } from 'handsontable/registry'
import { HyperFormula } from 'hyperformula'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
const FormulaBarContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: theme.spacing(1, 2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: theme.palette.background.paper,
  gap: theme.spacing(1),
}))

const CellReferenceBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  minWidth: 80,
  padding: theme.spacing(0.5, 1),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  borderRadius: 8,  // Figma spec: 8px
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  cursor: 'pointer',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
  },
}))

const FormulaInput = styled(TextField)(({ theme }) => ({
  flex: 1,
  '& .MuiOutlinedInput-root': {
    borderRadius: 8,  // Figma spec: 8px
    fontSize: '14px',
    fontFamily: 'monospace',
    '& fieldset': {
      borderColor: alpha(theme.palette.divider, 0.2),
    },
    '&:hover fieldset': {
      borderColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.3) : neutral[300],
    },
    '&.Mui-focused fieldset': {
      borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    },
  },
}))

const FunctionChip = styled(Chip)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  height: 24,
  fontSize: '0.75rem',
  fontFamily: 'monospace',
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
  color: 'text.secondary',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.15) : neutral[200],
  },
}))


const FORMULA_FUNCTIONS = [
  { name: 'SUM', syntax: 'SUM(range)', description: 'Sum of values' },
  { name: 'AVERAGE', syntax: 'AVERAGE(range)', description: 'Average of values' },
  { name: 'COUNT', syntax: 'COUNT(range)', description: 'Count of numbers' },
  { name: 'COUNTA', syntax: 'COUNTA(range)', description: 'Count of non-empty cells' },
  { name: 'MAX', syntax: 'MAX(range)', description: 'Maximum value' },
  { name: 'MIN', syntax: 'MIN(range)', description: 'Minimum value' },
  { name: 'IF', syntax: 'IF(condition, true_val, false_val)', description: 'Conditional logic' },
  { name: 'VLOOKUP', syntax: 'VLOOKUP(value, range, col, exact)', description: 'Vertical lookup' },
  { name: 'HLOOKUP', syntax: 'HLOOKUP(value, range, row, exact)', description: 'Horizontal lookup' },
  { name: 'SUMIF', syntax: 'SUMIF(range, criteria, sum_range)', description: 'Conditional sum' },
  { name: 'COUNTIF', syntax: 'COUNTIF(range, criteria)', description: 'Conditional count' },
  { name: 'CONCATENATE', syntax: 'CONCATENATE(text1, text2, ...)', description: 'Join text' },
  { name: 'LEFT', syntax: 'LEFT(text, num_chars)', description: 'Left characters' },
  { name: 'RIGHT', syntax: 'RIGHT(text, num_chars)', description: 'Right characters' },
  { name: 'MID', syntax: 'MID(text, start, length)', description: 'Middle characters' },
  { name: 'LEN', syntax: 'LEN(text)', description: 'Text length' },
  { name: 'TRIM', syntax: 'TRIM(text)', description: 'Remove extra spaces' },
  { name: 'ROUND', syntax: 'ROUND(number, decimals)', description: 'Round number' },
  { name: 'ABS', syntax: 'ABS(number)', description: 'Absolute value' },
  { name: 'TODAY', syntax: 'TODAY()', description: 'Current date' },
  { name: 'NOW', syntax: 'NOW()', description: 'Current date and time' },
  { name: 'YEAR', syntax: 'YEAR(date)', description: 'Year from date' },
  { name: 'MONTH', syntax: 'MONTH(date)', description: 'Month from date' },
  { name: 'DAY', syntax: 'DAY(date)', description: 'Day from date' },
]


function FormulaBar({
  cellRef = '',
  value = '',
  formula = null,
  onChange,
  onApply,
  onCancel,
  onCellRefClick,
  disabled = false,
}) {
  const theme = useTheme()
  const inputRef = useRef(null)
  const [localValue, setLocalValue] = useState(value)
  const [isEditing, setIsEditing] = useState(false)
  const [functionMenuAnchor, setFunctionMenuAnchor] = useState(null)
  const [autocompleteAnchor, setAutocompleteAnchor] = useState(null)
  const [filteredFunctions, setFilteredFunctions] = useState([])

  // Sync value from props
  useEffect(() => {
    setLocalValue(formula || value)
  }, [value, formula])

  // Check if value is a formula
  const isFormula = localValue.startsWith('=')

  // Handle input change
  const handleChange = useCallback((e) => {
    const newValue = e.target.value
    setLocalValue(newValue)
    setIsEditing(true)
    onChange?.(newValue)

    // Check for function autocomplete
    if (newValue.startsWith('=')) {
      const match = newValue.match(/=([A-Z]+)$/i)
      if (match) {
        const searchTerm = match[1].toUpperCase()
        const matches = FORMULA_FUNCTIONS.filter((f) =>
          f.name.startsWith(searchTerm)
        )
        if (matches.length > 0) {
          setFilteredFunctions(matches)
          setAutocompleteAnchor(inputRef.current)
        } else {
          setAutocompleteAnchor(null)
        }
      } else {
        setAutocompleteAnchor(null)
      }
    } else {
      setAutocompleteAnchor(null)
    }
  }, [onChange])

  // Handle apply (Enter key)
  const handleApply = useCallback(() => {
    setIsEditing(false)
    setAutocompleteAnchor(null)
    onApply?.(localValue)
  }, [localValue, onApply])

  // Handle cancel (Escape key)
  const handleCancel = useCallback(() => {
    setLocalValue(formula || value)
    setIsEditing(false)
    setAutocompleteAnchor(null)
    onCancel?.()
  }, [formula, onCancel, value])

  // Handle key press
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      handleApply()
    } else if (e.key === 'Escape') {
      handleCancel()
    }
  }, [handleApply, handleCancel])

  // Insert function from autocomplete
  const handleInsertFunction = useCallback((func) => {
    const currentValue = localValue
    const match = currentValue.match(/=([A-Z]+)$/i)
    if (match) {
      const newValue = currentValue.slice(0, -match[1].length) + func.name + '('
      setLocalValue(newValue)
      onChange?.(newValue)
    }
    setAutocompleteAnchor(null)
    inputRef.current?.focus()
  }, [localValue, onChange])

  // Open function menu
  const handleOpenFunctionMenu = useCallback((e) => {
    setFunctionMenuAnchor(e.currentTarget)
  }, [])

  // Close function menu
  const handleCloseFunctionMenu = useCallback(() => {
    setFunctionMenuAnchor(null)
  }, [])

  // Insert function from menu
  const handleSelectFunction = useCallback((func) => {
    const newValue = `=${func.name}(`
    setLocalValue(newValue)
    onChange?.(newValue)
    handleCloseFunctionMenu()
    inputRef.current?.focus()
  }, [handleCloseFunctionMenu, onChange])

  return (
    <FormulaBarContainer>
      {/* Cell Reference */}
      <CellReferenceBox onClick={onCellRefClick}>
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, fontFamily: 'monospace' }}
        >
          {cellRef || 'A1'}
        </Typography>
      </CellReferenceBox>

      {/* Function Button */}
      <Tooltip title="Insert Function">
        <IconButton
          size="small"
          onClick={handleOpenFunctionMenu}
          disabled={disabled}
          sx={{ color: 'text.secondary' }}
        >
          <FormulaIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {/* Formula Input */}
      <FormulaInput
        ref={inputRef}
        size="small"
        fullWidth
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsEditing(true)}
        placeholder="Enter value or formula (start with =)"
        disabled={disabled}
        InputProps={{
          sx: {
            color: 'text.primary',
          },
        }}
      />

      {/* Apply/Cancel Buttons (visible when editing) */}
      {isEditing && (
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Apply (Enter)">
            <IconButton
              size="small"
              onClick={handleApply}
              sx={{ color: 'text.secondary' }}
            >
              <ApplyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Cancel (Esc)">
            <IconButton
              size="small"
              onClick={handleCancel}
              sx={{ color: 'text.secondary' }}
            >
              <CancelIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      )}

      {/* Function Menu */}
      <Popover
        open={Boolean(functionMenuAnchor)}
        anchorEl={functionMenuAnchor}
        onClose={handleCloseFunctionMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{
          sx: { width: 320, maxHeight: 400, borderRadius: 1 },  // Figma spec: 8px
        }}
      >
        <Box sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            Insert Function
          </Typography>
          <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
            {FORMULA_FUNCTIONS.map((func) => (
              <ListItem key={func.name} disablePadding>
                <ListItemButton
                  onClick={() => handleSelectFunction(func)}
                  sx={{ borderRadius: 1, py: 0.5 }}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <FunctionChip label={func.name} size="small" />
                      </Stack>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {func.description}
                      </Typography>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Popover>

      {/* Autocomplete Popover */}
      <Popover
        open={Boolean(autocompleteAnchor) && filteredFunctions.length > 0}
        anchorEl={autocompleteAnchor}
        onClose={() => setAutocompleteAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        disableAutoFocus
        disableEnforceFocus
        PaperProps={{
          sx: { width: 250, maxHeight: 200, borderRadius: 1 },  // Figma spec: 8px
        }}
      >
        <List dense>
          {filteredFunctions.slice(0, 8).map((func) => (
            <ListItem key={func.name} disablePadding>
              <ListItemButton
                onClick={() => handleInsertFunction(func)}
                sx={{ py: 0.5 }}
              >
                <FunctionChip label={func.name} size="small" sx={{ mr: 1 }} />
                <Typography variant="caption" color="text.secondary" noWrap>
                  {func.description}
                </Typography>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Popover>
    </FormulaBarContainer>
  )
}

// ============================================================================

/**
 * Handsontable Editor Component
 * Excel-like spreadsheet editor with full functionality.
 */

// Icon aliases for row/column operations (using available MUI icons)
const InsertRowAbove = AddCircleOutline
const InsertRowBelow = AddCircleOutline
const DeleteRow = RemoveCircleOutline
const InsertColumnLeft = ViewColumn
const InsertColumnRight = ViewColumn
const DeleteColumn = RemoveCircleOutline

// Register all Handsontable modules
registerAllModules()


const EditorContainer = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'hidden',
  '& .handsontable': {
    fontFamily: theme.typography.fontFamily,
    fontSize: '14px',
  },
  '& .handsontable th': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
    fontWeight: 600,
  },
  '& .handsontable td': {
    verticalAlign: 'middle',
  },
  '& .handsontable td.area': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
  },
  '& .handsontable .htContextMenu': {
    borderRadius: 8,
    boxShadow: theme.shadows[8],
  },
  '& .handsontable .wtBorder.current': {
    backgroundColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
  },
}))


// Create HyperFormula instance for calculations
const hyperformulaInstance = HyperFormula.buildEmpty({
  licenseKey: 'gpl-v3',
})

// Default column headers (A-ZZ)
const generateColumnHeaders = (count) => {
  const headers = []
  for (let i = 0; i < count; i++) {
    let header = ''
    let num = i
    while (num >= 0) {
      header = String.fromCharCode((num % 26) + 65) + header
      num = Math.floor(num / 26) - 1
    }
    headers.push(header)
  }
  return headers
}


function HandsontableEditor({
  data = [],
  columns = 26,
  rows = 100,
  onCellChange,
  onSelectionChange,
  onFormulaBarUpdate,
  readOnly = false,
  contextMenuEnabled = true,
  formulas = true,
}) {
  const theme = useTheme()
  const hotRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [selectedRange, setSelectedRange] = useState(null)

  // Generate initial data if empty
  const initialData = useMemo(() => {
    if (data && data.length > 0) return data
    return Array(rows).fill(null).map(() => Array(columns).fill(''))
  }, [data, rows, columns])

  // Column headers
  const colHeaders = useMemo(() => generateColumnHeaders(columns), [columns])

  // Handle cell changes
  const handleAfterChange = useCallback((changes, source) => {
    if (!changes || source === 'loadData') return

    const cellChanges = changes.map(([row, col, oldValue, newValue]) => ({
      row,
      col,
      oldValue,
      newValue,
      cellRef: `${colHeaders[col]}${row + 1}`,
    }))

    onCellChange?.(cellChanges, source)
  }, [colHeaders, onCellChange])

  // Handle selection changes
  const handleAfterSelection = useCallback((row, col, row2, col2) => {
    const selection = {
      start: { row, col, ref: `${colHeaders[col]}${row + 1}` },
      end: { row: row2, col: col2, ref: `${colHeaders[col2]}${row2 + 1}` },
      isRange: row !== row2 || col !== col2,
    }
    setSelectedRange(selection)
    onSelectionChange?.(selection)

    // Update formula bar
    const hot = hotRef.current?.hotInstance
    if (hot) {
      const cellValue = hot.getDataAtCell(row, col)
      const cellMeta = hot.getCellMeta(row, col)
      onFormulaBarUpdate?.({
        cellRef: selection.start.ref,
        value: cellValue || '',
        formula: cellMeta?.formula || null,
      })
    }
  }, [colHeaders, onFormulaBarUpdate, onSelectionChange])

  // Handle context menu (right-click)
  const handleContextMenu = useCallback((event) => {
    event.preventDefault()
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
    })
  }, [])

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // Context menu actions
  const executeAction = useCallback((action) => {
    const hot = hotRef.current?.hotInstance
    if (!hot) return

    switch (action) {
      case 'copy':
        document.execCommand('copy')
        break
      case 'cut':
        document.execCommand('cut')
        break
      case 'paste':
        document.execCommand('paste')
        break
      case 'delete':
        if (selectedRange) {
          const { start, end } = selectedRange
          for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
            for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
              hot.setDataAtCell(r, c, '')
            }
          }
        }
        break
      case 'insert_row_above':
        if (selectedRange) hot.alter('insert_row_above', selectedRange.start.row)
        break
      case 'insert_row_below':
        if (selectedRange) hot.alter('insert_row_below', selectedRange.start.row)
        break
      case 'delete_row':
        if (selectedRange) hot.alter('remove_row', selectedRange.start.row)
        break
      case 'insert_col_left':
        if (selectedRange) hot.alter('insert_col_start', selectedRange.start.col)
        break
      case 'insert_col_right':
        if (selectedRange) hot.alter('insert_col_end', selectedRange.start.col)
        break
      case 'delete_col':
        if (selectedRange) hot.alter('remove_col', selectedRange.start.col)
        break
    }
    handleCloseContextMenu()
  }, [handleCloseContextMenu, selectedRange])

  // Handsontable settings
  const hotSettings = useMemo(() => ({
    data: initialData,
    colHeaders,
    rowHeaders: true,
    width: '100%',
    height: '100%',
    stretchH: 'all',
    autoWrapRow: true,
    autoWrapCol: true,
    readOnly,
    manualColumnResize: true,
    manualRowResize: true,
    manualColumnMove: true,
    manualRowMove: true,
    dropdownMenu: contextMenuEnabled,
    filters: true,
    multiColumnSorting: true,
    mergeCells: true,
    undo: true,
    autoColumnSize: { syncLimit: 100 },
    autoRowSize: { syncLimit: 100 },
    licenseKey: 'non-commercial-and-evaluation',
    // Enable formulas with HyperFormula
    formulas: formulas ? {
      engine: hyperformulaInstance,
    } : false,
    // Cell types
    cells: function(row, col) {
      const cellProperties = {}
      return cellProperties
    },
    // Comments
    comments: true,
    // Validation
    validator: (value, callback) => {
      callback(true)
    },
    afterChange: handleAfterChange,
    afterSelection: handleAfterSelection,
    afterScrollVertically: () => {},
    afterScrollHorizontally: () => {},
    contextMenu: contextMenuEnabled ? {
      items: {
        'copy': { name: 'Copy', disabled: false },
        'cut': { name: 'Cut', disabled: false },
        'hsep1': '---------',
        'row_above': { name: 'Insert row above' },
        'row_below': { name: 'Insert row below' },
        'remove_row': { name: 'Remove row' },
        'hsep2': '---------',
        'col_left': { name: 'Insert column left' },
        'col_right': { name: 'Insert column right' },
        'remove_col': { name: 'Remove column' },
        'hsep3': '---------',
        'undo': { name: 'Undo' },
        'redo': { name: 'Redo' },
      }
    } : false,
  }), [
    initialData,
    colHeaders,
    readOnly,
    contextMenuEnabled,
    formulas,
    handleAfterChange,
    handleAfterSelection,
  ])

  // External API methods
  useEffect(() => {
    // Expose hot instance methods through ref
    if (hotRef.current) {
      const hot = hotRef.current.hotInstance

      // Method to set cell value from formula bar
      hotRef.current.setSelectedCellValue = (value) => {
        if (selectedRange && hot) {
          hot.setDataAtCell(selectedRange.start.row, selectedRange.start.col, value)
        }
      }

      // Method to get current data
      hotRef.current.getData = () => hot?.getData() || []

      // Method to load data
      hotRef.current.loadData = (newData) => hot?.loadData(newData)

      // Method to insert row
      hotRef.current.insertRow = (index, amount = 1) => {
        hot?.alter('insert_row_below', index, amount)
      }

      // Method to insert column
      hotRef.current.insertColumn = (index, amount = 1) => {
        hot?.alter('insert_col_end', index, amount)
      }
    }
  }, [selectedRange])

  return (
    <EditorContainer>
      <HotTable
        ref={hotRef}
        settings={hotSettings}
      />
    </EditorContainer>
  )
}

// Export a ref-forwarding version for external access
const HandsontableEditorRef = ({ forwardedRef, ...props }) => {
  const internalRef = useRef(null)

  useEffect(() => {
    if (forwardedRef) {
      forwardedRef.current = internalRef.current
    }
  }, [forwardedRef])

  return <HandsontableEditor ref={internalRef} {...props} />
}

// === From: SpreadsheetEditorPageContainer.jsx ===
/**
 * Spreadsheet Editor Page Container
 * Excel-like spreadsheet editor with Handsontable and HyperFormula.
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

const SidebarHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
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
  padding: theme.spacing(1, 2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
  gap: theme.spacing(1),
}))

const SpreadsheetArea = styled(Box)(({ theme }) => ({
  flex: 1,
  overflow: 'hidden',
  backgroundColor: theme.palette.background.paper,
}))

const SheetTabs = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: theme.spacing(0.5, 1),
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.6),
  minHeight: 40,
  gap: theme.spacing(0.5),
}))

const SheetTab = styled(Chip, {
  shouldForwardProp: (prop) => prop !== 'active',
})(({ theme, active }) => ({
  borderRadius: '4px 4px 0 0',
  height: 28,
  fontSize: '14px',
  backgroundColor: active
    ? theme.palette.background.paper
    : alpha(theme.palette.background.default, 0.5),
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  borderBottom: active ? 'none' : `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  '&:hover': {
    backgroundColor: active
      ? theme.palette.background.paper
      : theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  },
}))

const ActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 6,
  textTransform: 'none',
  fontWeight: 500,
  minWidth: 'auto',
  fontSize: '14px',
}))

const SpreadsheetListItem = styled(ListItemButton, {
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

const EmptyState = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: theme.spacing(4),
  textAlign: 'center',
}))


const COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

const getCellRef = (row, col) => {
  // Convert col index to letter (0 = A, 25 = Z, 26 = AA, etc.)
  let colName = ''
  let tempCol = col
  while (tempCol >= 0) {
    colName = String.fromCharCode((tempCol % 26) + 65) + colName
    tempCol = Math.floor(tempCol / 26) - 1
  }
  return `${colName}${row + 1}`
}


export default function SpreadsheetEditorPage() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const { connections, activeConnectionId } = useSharedData()

  // Cross-page: accept table data from other features (Query, Federation)
  useIncomingTransfer(FeatureKey.SPREADSHEETS, {
    [TransferAction.OPEN_IN]: async (payload) => {
      const tableData = payload.data || {}
      const columns = tableData.columns || []
      const rows = tableData.rows || []
      // Build cell data from columns/rows
      const cellData = {}
      columns.forEach((col, colIdx) => {
        const colLetter = String.fromCharCode(65 + colIdx)
        cellData[`${colLetter}1`] = { value: typeof col === 'string' ? col : col.name || `Col${colIdx + 1}` }
      })
      rows.forEach((row, rowIdx) => {
        const rowValues = Array.isArray(row) ? row : Object.values(row)
        rowValues.forEach((val, colIdx) => {
          if (colIdx < 26) {
            const colLetter = String.fromCharCode(65 + colIdx)
            cellData[`${colLetter}${rowIdx + 2}`] = { value: val }
          }
        })
      })
      const spreadsheet = await createSpreadsheet({
        name: payload.title || 'Imported Data',
        sheets: [{ name: 'Sheet 1', data: cellData }],
      })
      if (spreadsheet) getSpreadsheet(spreadsheet.id)
    },
  })

  const {
    spreadsheets,
    currentSpreadsheet,
    activeSheetIndex,
    selectedCells,
    loading,
    saving,
    error,
    fetchSpreadsheets,
    createSpreadsheet,
    getSpreadsheet,
    updateSpreadsheet,
    deleteSpreadsheet,
    updateCells,
    addSheet,
    deleteSheet,
    renameSheet,
    setActiveSheetIndex,
    setSelectedCells,
    createPivotTable,
    generateFormula,
    importCsv,
    importExcel,
    exportSpreadsheet,
    reset,
  } = useSpreadsheetStore()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newSpreadsheetName, setNewSpreadsheetName] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [currentCellRef, setCurrentCellRef] = useState('A1')
  const [currentCellValue, setCurrentCellValue] = useState('')
  const [currentCellFormula, setCurrentCellFormula] = useState(null)
  const [localData, setLocalData] = useState([])
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [aiDialogOpen, setAiDialogOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [exportMenuAnchor, setExportMenuAnchor] = useState(null)
  const [moreMenuAnchor, setMoreMenuAnchor] = useState(null)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [newSheetName, setNewSheetName] = useState('')
  const [sheetToRename, setSheetToRename] = useState(null)
  const fileInputRef = useRef(null)
  const handsontableRef = useRef(null)

  useEffect(() => {
    fetchSpreadsheets()
    return () => reset()
  }, [fetchSpreadsheets, reset])

  // Convert sheet data to 2D array for Handsontable
  useEffect(() => {
    if (currentSpreadsheet?.sheets?.[activeSheetIndex]?.data) {
      const sheetData = currentSpreadsheet.sheets[activeSheetIndex].data
      // Convert from { A1: { value, formula }, B1: ... } to 2D array
      const rows = []
      const maxRow = 100
      const maxCol = 26

      for (let r = 0; r < maxRow; r++) {
        const row = []
        for (let c = 0; c < maxCol; c++) {
          const cellKey = getCellRef(r, c)
          const cellData = sheetData[cellKey]
          row.push(cellData?.formula || cellData?.value || '')
        }
        rows.push(row)
      }
      setLocalData(rows)
    } else {
      // Empty grid
      setLocalData(Array(100).fill(null).map(() => Array(26).fill('')))
    }
  }, [currentSpreadsheet, activeSheetIndex])

  const executeUI = useCallback((label, action, intent = {}) => {
    return execute({
      type: InteractionType.EXECUTE,
      label,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'spreadsheets', ...intent },
      action,
    })
  }, [execute])

  const handleOpenCreateDialog = useCallback(() => {
    return executeUI('Open create spreadsheet', () => setCreateDialogOpen(true))
  }, [executeUI])

  const handleCloseCreateDialog = useCallback(() => {
    return executeUI('Close create spreadsheet', () => {
      setCreateDialogOpen(false)
      setNewSpreadsheetName('')
      setSelectedConnectionId('')
    })
  }, [executeUI])

  const handleOpenAiDialog = useCallback(() => {
    return executeUI('Open AI formula', () => setAiDialogOpen(true))
  }, [executeUI])

  const handleCloseAiDialog = useCallback(() => {
    return executeUI('Close AI formula', () => {
      setAiDialogOpen(false)
      setAiPrompt('')
    })
  }, [executeUI])

  const handleTriggerImport = useCallback(() => {
    return executeUI('Import spreadsheet', () => fileInputRef.current?.click())
  }, [executeUI])

  const handleSelectSpreadsheet = useCallback((spreadsheetId) => {
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Open spreadsheet',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'spreadsheets', spreadsheetId },
      action: async () => {
        await getSpreadsheet(spreadsheetId)
        setHasUnsavedChanges(false)
      },
    })
  }, [execute, getSpreadsheet])

  const handleCreateSpreadsheet = useCallback(() => {
    if (!newSpreadsheetName) return undefined
    return execute({
      type: InteractionType.CREATE,
      label: 'Create spreadsheet',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'spreadsheets', name: newSpreadsheetName, connectionId: selectedConnectionId || undefined },
      action: async () => {
        const spreadsheet = await createSpreadsheet({
          name: newSpreadsheetName,
          sheets: [{ name: 'Sheet 1', data: {} }],
          connectionId: selectedConnectionId || undefined,
        })
        if (spreadsheet) {
          setCreateDialogOpen(false)
          setNewSpreadsheetName('')
          setSelectedConnectionId('')
          toast.show('Spreadsheet created', 'success')
        }
        return spreadsheet
      },
    })
  }, [createSpreadsheet, execute, newSpreadsheetName, selectedConnectionId, toast])

  const handleDeleteSpreadsheet = useCallback((spreadsheetId) => {
    return execute({
      type: InteractionType.DELETE,
      label: 'Delete spreadsheet',
      reversibility: Reversibility.REQUIRES_CONFIRMATION,
      intent: { source: 'spreadsheets', spreadsheetId },
      action: async () => {
        const success = await deleteSpreadsheet(spreadsheetId)
        if (success) {
          toast.show('Spreadsheet deleted', 'success')
        }
        return success
      },
    })
  }, [deleteSpreadsheet, execute, toast])

  // Handsontable callbacks
  const handleCellChange = useCallback((changes, source) => {
    if (source === 'loadData') return
    if (!changes) return

    setHasUnsavedChanges(true)

    // Update local data
    setLocalData((prev) => {
      const newData = prev.map((row) => [...row])
      changes.forEach(([row, col, oldVal, newVal]) => {
        if (newData[row]) {
          newData[row][col] = newVal
        }
      })
      return newData
    })
  }, [])

  const handleSelectionChange = useCallback((row, col, row2, col2) => {
    const cellRef = getCellRef(row, col)
    setCurrentCellRef(cellRef)

    const value = localData[row]?.[col] || ''
    setCurrentCellValue(value)
    setCurrentCellFormula(value.startsWith('=') ? value : null)
  }, [localData])

  const handleFormulaBarChange = useCallback((value) => {
    setCurrentCellValue(value)
  }, [])

  const handleFormulaBarApply = useCallback((value) => {
    // Parse currentCellRef to get row/col
    const match = currentCellRef.match(/^([A-Z]+)(\d+)$/)
    if (!match) return

    const colLetters = match[1]
    const row = parseInt(match[2], 10) - 1
    let col = 0
    for (let i = 0; i < colLetters.length; i++) {
      col = col * 26 + (colLetters.charCodeAt(i) - 64)
    }
    col -= 1

    setLocalData((prev) => {
      const newData = prev.map((r) => [...r])
      if (newData[row]) {
        newData[row][col] = value
      }
      return newData
    })
    setHasUnsavedChanges(true)
  }, [currentCellRef])

  const handleFormulaBarCancel = useCallback(() => {
    // Reset to original value
    const match = currentCellRef.match(/^([A-Z]+)(\d+)$/)
    if (!match) return

    const colLetters = match[1]
    const row = parseInt(match[2], 10) - 1
    let col = 0
    for (let i = 0; i < colLetters.length; i++) {
      col = col * 26 + (colLetters.charCodeAt(i) - 64)
    }
    col -= 1

    setCurrentCellValue(localData[row]?.[col] || '')
  }, [currentCellRef, localData])

  const handleSave = useCallback(() => {
    if (!currentSpreadsheet) return undefined
    return execute({
      type: InteractionType.UPDATE,
      label: 'Save spreadsheet',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'spreadsheets', spreadsheetId: currentSpreadsheet.id },
      action: async () => {
        // Convert 2D array back to object format
        const cellDataObj = {}
        localData.forEach((row, rowIndex) => {
          row.forEach((value, colIndex) => {
            if (value !== '') {
              const cellKey = getCellRef(rowIndex, colIndex)
              const isFormula = typeof value === 'string' && value.startsWith('=')
              cellDataObj[cellKey] = {
                value: isFormula ? '' : value,
                formula: isFormula ? value : null,
              }
            }
          })
        })

        await updateCells(currentSpreadsheet.id, activeSheetIndex, cellDataObj)
        setHasUnsavedChanges(false)
        toast.show('Spreadsheet saved', 'success')
      },
    })
  }, [activeSheetIndex, currentSpreadsheet, execute, localData, toast, updateCells])

  const handleImport = useCallback((e) => {
    const file = e.target.files[0]
    if (!file) return

    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')

    execute({
      type: InteractionType.UPLOAD,
      label: 'Import spreadsheet',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'spreadsheets', filename: file.name },
      action: async () => {
        const result = isExcel
          ? await importExcel(file)
          : await importCsv(file)
        if (result) {
          toast.show('File imported successfully', 'success')
        }
      },
    }).finally(() => {
      e.target.value = ''
    })
  }, [execute, importCsv, importExcel, toast])

  const handleExport = useCallback((format) => {
    if (!currentSpreadsheet) return undefined
    setExportMenuAnchor(null)
    return execute({
      type: InteractionType.DOWNLOAD,
      label: 'Export spreadsheet',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: { source: 'spreadsheets', spreadsheetId: currentSpreadsheet.id, format },
      action: async () => {
        const blob = await exportSpreadsheet(currentSpreadsheet.id, format)
        if (blob) {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `${currentSpreadsheet.name}.${format}`
          a.click()
          URL.revokeObjectURL(url)
          toast.show(`Exported to ${format.toUpperCase()}`, 'success')
        } else {
          toast.show('Export not available', 'warning')
        }
      },
    })
  }, [currentSpreadsheet, execute, exportSpreadsheet, toast])

  const handleAIFormula = useCallback(() => {
    if (!aiPrompt || !currentSpreadsheet) return undefined
    return execute({
      type: InteractionType.GENERATE,
      label: 'Generate formula',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      intent: { source: 'spreadsheets', spreadsheetId: currentSpreadsheet.id },
      action: async () => {
        const result = await generateFormula(currentSpreadsheet.id, aiPrompt)
        if (result?.formula) {
          setCurrentCellValue(result.formula)
          handleFormulaBarApply(result.formula)
          toast.show('Formula generated', 'success')
        }
        setAiDialogOpen(false)
        setAiPrompt('')
        return result
      },
    })
  }, [aiPrompt, currentSpreadsheet, execute, generateFormula, handleFormulaBarApply, toast])

  const handleSelectSheet = useCallback((index) => {
    return executeUI('Switch sheet', () => setActiveSheetIndex(index), { index })
  }, [executeUI, setActiveSheetIndex])

  const handleAddSheet = useCallback(() => {
    if (!currentSpreadsheet) return undefined
    return execute({
      type: InteractionType.UPDATE,
      label: 'Add sheet',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'spreadsheets', spreadsheetId: currentSpreadsheet.id },
      action: async () => {
        const nextIndex = (currentSpreadsheet.sheets?.length || 0) + 1
        await addSheet(currentSpreadsheet.id, `Sheet ${nextIndex}`)
        toast.show('Sheet added', 'success')
      },
    })
  }, [addSheet, currentSpreadsheet, execute, toast])

  const handleRenameSheet = useCallback(() => {
    if (!currentSpreadsheet || sheetToRename === null || !newSheetName) return undefined
    return execute({
      type: InteractionType.UPDATE,
      label: 'Rename sheet',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'spreadsheets', spreadsheetId: currentSpreadsheet.id },
      action: async () => {
        await renameSheet(currentSpreadsheet.id, sheetToRename, newSheetName)
        setRenameDialogOpen(false)
        setNewSheetName('')
        setSheetToRename(null)
        toast.show('Sheet renamed', 'success')
      },
    })
  }, [currentSpreadsheet, execute, newSheetName, renameSheet, sheetToRename, toast])

  const handleDeleteSheet = useCallback((index) => {
    if (!currentSpreadsheet || currentSpreadsheet.sheets?.length <= 1) {
      toast.show('Cannot delete the only sheet', 'warning')
      return undefined
    }
    return execute({
      type: InteractionType.DELETE,
      label: 'Delete sheet',
      reversibility: Reversibility.REQUIRES_CONFIRMATION,
      intent: { source: 'spreadsheets', spreadsheetId: currentSpreadsheet.id, sheetIndex: index },
      action: async () => {
        await deleteSheet(currentSpreadsheet.id, index)
        toast.show('Sheet deleted', 'success')
      },
    })
  }, [currentSpreadsheet, deleteSheet, execute, toast])

  const handleDismissError = useCallback(() => {
    return executeUI('Dismiss spreadsheet error', () => reset())
  }, [executeUI, reset])

  const openRenameDialog = useCallback((index) => {
    setSheetToRename(index)
    setNewSheetName(currentSpreadsheet?.sheets?.[index]?.name || '')
    setRenameDialogOpen(true)
  }, [currentSpreadsheet])

  return (
    <PageContainer>
      {/* Sidebar - Spreadsheet List */}
      <Sidebar>
        <SidebarHeader>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Spreadsheets
          </Typography>
          <Tooltip title="New Spreadsheet">
            <IconButton size="small" onClick={handleOpenCreateDialog}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </SidebarHeader>

        <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
          {loading && spreadsheets.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : spreadsheets.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              No spreadsheets yet
            </Typography>
          ) : (
            <List disablePadding>
              {spreadsheets.map((ss) => (
                <SpreadsheetListItem
                  key={ss.id}
                  active={currentSpreadsheet?.id === ss.id}
                  onClick={() => handleSelectSpreadsheet(ss.id)}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <SpreadsheetIcon sx={{ color: 'text.secondary' }} fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={ss.name}
                    secondary={`${ss.sheets?.length || 1} ${(ss.sheets?.length || 1) === 1 ? 'sheet' : 'sheets'}`}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteSpreadsheet(ss.id)
                    }}
                    aria-label={`Delete ${ss.name}`}
                    sx={{ opacity: 0, '.MuiListItemButton-root:hover &': { opacity: 0.5 }, '&:hover': { opacity: 1 } }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </SpreadsheetListItem>
              ))}
            </List>
          )}
        </Box>

        <Box sx={{ p: 1.5, borderTop: (theme) => `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <ImportFromMenu
            currentFeature={FeatureKey.SPREADSHEETS}
            onImport={async (output) => {
              const { columns, rows } = output.data || {}
              const cellData = {}
              if (columns && rows) {
                columns.forEach((col, ci) => {
                  if (ci < 26) {
                    const letter = String.fromCharCode(65 + ci)
                    cellData[`${letter}1`] = { value: typeof col === 'string' ? col : col.name || `Col${ci + 1}` }
                  }
                })
                rows.forEach((row, ri) => {
                  const vals = Array.isArray(row) ? row : Object.values(row)
                  vals.forEach((v, ci) => {
                    if (ci < 26) {
                      const letter = String.fromCharCode(65 + ci)
                      cellData[`${letter}${ri + 2}`] = { value: v }
                    }
                  })
                })
              }
              const spreadsheet = await createSpreadsheet({
                name: output.title || 'Imported Data',
                sheets: [{ name: 'Sheet 1', data: cellData }],
              })
              if (spreadsheet) {
                getSpreadsheet(spreadsheet.id)
                toast.show(`Created spreadsheet from "${output.title}"`, 'success')
              }
            }}
            fullWidth
          />
        </Box>
      </Sidebar>

      {/* Main Content */}
      <MainContent>
        {currentSpreadsheet ? (
          <>
            {/* Toolbar */}
            <Toolbar>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {currentSpreadsheet.name}
                </Typography>
                {hasUnsavedChanges && (
                  <Chip
                    label="Unsaved"
                    size="small"
                    sx={{ height: 20, fontSize: '12px', bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }}
                  />
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title="Undo">
                  <IconButton size="small">
                    <UndoIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Redo">
                  <IconButton size="small">
                    <RedoIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

                <ActionButton
                  size="small"
                  startIcon={<UploadIcon />}
                  onClick={handleTriggerImport}
                >
                  Import
                </ActionButton>
                <ActionButton
                  size="small"
                  startIcon={<DownloadIcon />}
                  onClick={(e) => setExportMenuAnchor(e.currentTarget)}
                >
                  Export
                </ActionButton>
                <ActionButton
                  size="small"
                  startIcon={<AIIcon />}
                  onClick={handleOpenAiDialog}
                >
                  AI Formula
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

            {/* Formula Bar */}
            <FormulaBar
              cellRef={currentCellRef}
              value={currentCellValue}
              formula={currentCellFormula}
              onChange={handleFormulaBarChange}
              onApply={handleFormulaBarApply}
              onCancel={handleFormulaBarCancel}
              disabled={!currentSpreadsheet}
            />

            {/* Spreadsheet Grid */}
            <SpreadsheetArea>
              <HandsontableEditor
                ref={handsontableRef}
                data={localData}
                onCellChange={handleCellChange}
                onSelectionChange={handleSelectionChange}
                formulas={true}
              />
            </SpreadsheetArea>

            {/* Sheet Tabs */}
            <SheetTabs>
              {currentSpreadsheet.sheets?.map((sheet, index) => (
                <SheetTab
                  key={index}
                  label={sheet.name}
                  size="small"
                  active={activeSheetIndex === index}
                  onClick={() => handleSelectSheet(index)}
                  onDoubleClick={() => openRenameDialog(index)}
                  onDelete={
                    currentSpreadsheet.sheets.length > 1
                      ? () => handleDeleteSheet(index)
                      : undefined
                  }
                />
              ))}
              <Tooltip title="Add Sheet">
                <IconButton size="small" onClick={handleAddSheet}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </SheetTabs>
          </>
        ) : (
          <EmptyState>
            <SpreadsheetIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h5" sx={{ fontWeight: 600, mb: 1 }}>
              No Spreadsheet Selected
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Create a new spreadsheet or select one from the sidebar.
            </Typography>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <ActionButton
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleOpenCreateDialog}
              >
                Create Spreadsheet
              </ActionButton>
              <ActionButton
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={handleTriggerImport}
              >
                Import File
              </ActionButton>
            </Box>
          </EmptyState>
        )}

        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept=".csv,.xlsx,.xls"
          onChange={handleImport}
        />
      </MainContent>

      {/* Create Dialog */}
      <Dialog
        open={createDialogOpen}
        onClose={handleCloseCreateDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Create New Spreadsheet</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Spreadsheet Name"
            value={newSpreadsheetName}
            onChange={(e) => setNewSpreadsheetName(e.target.value)}
            sx={{ mt: 2 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSpreadsheetName) {
                handleCreateSpreadsheet()
              }
            }}
          />
          <ConnectionSelector
            value={selectedConnectionId}
            onChange={setSelectedConnectionId}
            label="Import from Connection (Optional)"
            size="small"
            showStatus
          />
          {selectedConnectionId && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
              Data from the selected connection will be imported into the new spreadsheet.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCreateDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateSpreadsheet}
            disabled={!newSpreadsheetName || loading}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rename Sheet Dialog */}
      <Dialog
        open={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Rename Sheet</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Sheet Name"
            value={newSheetName}
            onChange={(e) => setNewSheetName(e.target.value)}
            sx={{ mt: 2 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSheetName) {
                handleRenameSheet()
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleRenameSheet}
            disabled={!newSheetName}
          >
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Formula Dialog */}
      <Dialog
        open={aiDialogOpen}
        onClose={handleCloseAiDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AIIcon sx={{ color: 'text.secondary' }} />
            Generate Formula with AI
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Describe what you want to calculate in plain English.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            placeholder="e.g., Sum all values in column A where column B equals 'Sales'"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            The formula will be inserted into the currently selected cell ({currentCellRef})
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAiDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAIFormula}
            disabled={!aiPrompt}
            startIcon={<AIIcon />}
          >
            Generate
          </Button>
        </DialogActions>
      </Dialog>

      {/* Export Menu */}
      <Menu
        anchorEl={exportMenuAnchor}
        open={Boolean(exportMenuAnchor)}
        onClose={() => setExportMenuAnchor(null)}
      >
        <MenuItem onClick={() => handleExport('csv')}>
          <ListItemText primary="CSV" secondary="Comma-separated values" />
        </MenuItem>
        <MenuItem onClick={() => handleExport('xlsx')}>
          <ListItemText primary="Excel (.xlsx)" secondary="Microsoft Excel format" />
        </MenuItem>
        <MenuItem onClick={() => handleExport('json')}>
          <ListItemText primary="JSON" secondary="JavaScript Object Notation" />
        </MenuItem>
      </Menu>

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
