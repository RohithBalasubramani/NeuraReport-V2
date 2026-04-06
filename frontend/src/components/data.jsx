import { figmaComponents, fontFamilyBody, neutral, palette } from '@/app/theme'
import { float, shimmer, slideIn } from '@/styles/styles'
import {
  Add as AddIcon,
  Archive as ArchiveIcon,
  ArrowDownward as SortDescIcon,
  ArrowUpward as SortAscIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  FilterList as FilterListIcon,
  Inbox as InboxIcon,
  KeyboardArrowDown as ArrowDownIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowUp as CollapseIcon,
  Label as LabelIcon,
  MoreVert as MoreVertIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  ViewColumn as ColumnsIcon,
} from '@mui/icons-material'
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Fade,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  Zoom,
  alpha,
  keyframes,
  styled,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`

const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
`


const EmptyContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(8, 4),
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  backgroundColor: 'transparent',
  position: 'relative',
  overflow: 'hidden',
  animation: `${fadeIn} 0.5s ease-out`,
}))

const IconContainer = styled(Box)(({ theme }) => ({
  width: 64,
  height: 64,
  borderRadius: 24,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: theme.spacing(3),
  position: 'relative',
  animation: `${float} 3s infinite ease-in-out`,
}))

const StyledIcon = styled(Box)(({ theme }) => ({
  fontSize: 32,
  color: theme.palette.text.secondary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}))

const Title = styled(Typography)(({ theme }) => ({
  fontSize: '1.125rem',
  fontWeight: 600,
  color: theme.palette.text.primary,
  marginBottom: theme.spacing(0.5),
  letterSpacing: '-0.01em',
}))

const Description = styled(Typography)(({ theme }) => ({
  fontSize: '0.875rem',
  color: theme.palette.text.secondary,
  maxWidth: 360,
  marginBottom: theme.spacing(3),
  lineHeight: 1.6,
}))

const ActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  textTransform: 'none',
  fontWeight: 600,
  fontSize: '0.875rem',
  padding: theme.spacing(1.25, 3),
  backgroundColor: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  color: theme.palette.common.white,
  boxShadow: `0 4px 16px ${alpha(theme.palette.common.black, 0.15)}`,
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    transform: 'translateY(-2px)',
    boxShadow: `0 8px 24px ${alpha(theme.palette.common.black, 0.2)}`,
  },
  '&:active': {
    transform: 'translateY(0)',
  },
}))

const SecondaryButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.875rem',
  padding: theme.spacing(1.25, 3),
  color: theme.palette.text.secondary,
  borderColor: alpha(theme.palette.divider, 0.2),
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
    color: theme.palette.text.primary,
  },
}))

const DecorativeDots = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(1),
  marginTop: theme.spacing(4),
  '& span': {
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: alpha(theme.palette.text.primary, 0.1),
    '&:nth-of-type(2)': {
      backgroundColor: alpha(theme.palette.text.primary, 0.2),
    },
  },
}))

const IllustrationLines = styled(Box)(({ theme }) => ({
  position: 'absolute',
  bottom: 40,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  opacity: 0.3,
  '& span': {
    height: 4,
    borderRadius: 1,  // Figma spec: 8px
    backgroundColor: alpha(theme.palette.text.primary, 0.1),
    '&:nth-of-type(1)': { width: 120 },
    '&:nth-of-type(2)': { width: 80, marginLeft: 20 },
    '&:nth-of-type(3)': { width: 100, marginLeft: 10 },
  },
}))


function DataTableEmptyState({
  icon: Icon = InboxIcon,
  title = 'No data',
  description,
  action,
  actionLabel,
  onAction,
  secondaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}) {
  const theme = useTheme()

  return (
    <EmptyContainer>
      <IconContainer>
        <StyledIcon as={Icon} />
      </IconContainer>

      <Title>{title}</Title>

      {description && <Description>{description}</Description>}

      <Box sx={{ display: 'flex', gap: 1.5 }}>
        {(action || onAction) && (
          <ActionButton
            onClick={onAction}
            startIcon={action?.icon || <AddIcon />}
          >
            {actionLabel || action?.label || 'Get Started'}
          </ActionButton>
        )}

        {(secondaryAction || onSecondaryAction) && (
          <SecondaryButton
            variant="outlined"
            onClick={onSecondaryAction}
            startIcon={secondaryAction?.icon}
          >
            {secondaryActionLabel || secondaryAction?.label || 'Learn More'}
          </SecondaryButton>
        )}
      </Box>

    </EmptyContainer>
  )
}

// === From: DataTableToolbar.jsx ===
/**
 * Premium Data Table Toolbar
 * Sophisticated search, filters, and actions with glassmorphism effects
 */


const tbSlideIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`

const tbPulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
`


const ToolbarContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2.5, 3),
  backgroundColor: alpha(theme.palette.background.paper, 0.4),
  backdropFilter: 'blur(10px)',
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
}))

const HeaderRow = styled(Stack)(({ theme }) => ({
  marginBottom: theme.spacing(2),
}))

const TitleSection = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(0.25),
}))

const TbTitle = styled(Typography)(({ theme }) => ({
  fontSize: '1.125rem',
  fontWeight: 600,
  color: theme.palette.text.primary,
  letterSpacing: '-0.01em',
}))

const Subtitle = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  color: theme.palette.text.secondary,
}))

const TbActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '14px',
  padding: theme.spacing(0.75, 2),
  transition: 'all 0.2s ease',
  '&.MuiButton-outlined': {
    borderColor: alpha(theme.palette.divider, 0.2),
    '&:hover': {
      borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
    },
  },
  '&.MuiButton-contained': {
    backgroundColor: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
    boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.15)}`,
    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
      boxShadow: `0 6px 20px ${alpha(theme.palette.common.black, 0.2)}`,
      transform: 'translateY(-1px)',
    },
  },
}))

const SelectionBar = styled(Box)(({ theme }) => ({
  marginBottom: theme.spacing(2),
  padding: theme.spacing(1.5, 2),
  background: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  borderRadius: 8,  // Figma spec: 8px
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  animation: `${tbSlideIn} 0.3s ease-out`,
}))

const SelectionText = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  fontWeight: 500,
  color: theme.palette.text.primary,
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
}))

const SelectionBadge = styled(Box)(({ theme }) => ({
  width: 24,
  height: 24,
  borderRadius: 8,
  backgroundColor: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
  color: theme.palette.common.white,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.75rem',
  fontWeight: 600,
}))

const SelectionAction = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontSize: '0.75rem',
  fontWeight: 500,
  padding: theme.spacing(0.5, 1.5),
  minWidth: 'auto',
  color: theme.palette.text.secondary,
  borderColor: alpha(theme.palette.text.primary, 0.1),
  '&:hover': {
    borderColor: alpha(theme.palette.text.primary, 0.2),
    backgroundColor: alpha(theme.palette.text.primary, 0.04),
  },
}))

const DeleteAction = styled(SelectionAction)(({ theme }) => ({
  color: theme.palette.text.secondary,
  borderColor: alpha(theme.palette.divider, 0.3),
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
}))

const SearchField = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: 8,  // Figma spec: 8px
    backgroundColor: alpha(theme.palette.background.paper, 0.6),
    transition: 'all 0.2s ease',
    '& fieldset': {
      borderColor: alpha(theme.palette.divider, 0.1),
      transition: 'all 0.2s ease',
    },
    '&:hover fieldset': {
      borderColor: alpha(theme.palette.divider, 0.3),
    },
    '&.Mui-focused': {
      backgroundColor: theme.palette.background.paper,
      boxShadow: `0 0 0 3px ${alpha(theme.palette.divider, 0.1)}`,
      '& fieldset': {
        borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
      },
    },
  },
  '& .MuiInputBase-input': {
    fontSize: '0.875rem',
    padding: theme.spacing(1, 1.5),
    '&::placeholder': {
      color: theme.palette.text.disabled,
      opacity: 1,
    },
  },
}))

const FilterButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '14px',
  padding: theme.spacing(0.75, 1.5),
  color: theme.palette.text.secondary,
  borderColor: alpha(theme.palette.divider, 0.2),
  '&:hover': {
    borderColor: alpha(theme.palette.divider, 0.3),
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
  },
  '&.active': {
    color: theme.palette.text.primary,
    borderColor: alpha(theme.palette.divider, 0.5),
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
}))

const FilterChip = styled(Chip)(({ theme }) => ({
  borderRadius: 8,
  height: 28,
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
  color: theme.palette.text.secondary,
  fontWeight: 500,
  fontSize: '0.75rem',
  animation: `${tbSlideIn} 0.2s ease-out`,
  '& .MuiChip-deleteIcon': {
    color: theme.palette.text.disabled,
    fontSize: 16,
    '&:hover': {
      color: theme.palette.text.secondary,
    },
  },
}))

const IconButtonStyled = styled(IconButton)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  color: theme.palette.text.secondary,
  transition: 'all 0.2s ease',
  '&:hover': {
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
}))

const StyledMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    borderRadius: 8,  // Figma spec: 8px
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.12)}`,
    minWidth: 200,
    marginTop: theme.spacing(0.5),
  },
}))

const MenuSection = styled(Box)(({ theme }) => ({
  padding: theme.spacing(1, 0),
}))

const MenuLabel = styled(Typography)(({ theme }) => ({
  padding: theme.spacing(1, 2),
  fontSize: '12px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: theme.palette.text.disabled,
}))

const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
  fontSize: '14px',
  padding: theme.spacing(1, 2),
  borderRadius: 6,
  margin: theme.spacing(0, 1),
  transition: 'all 0.15s ease',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
  '&.Mui-selected': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[200],
    color: theme.palette.text.primary,
    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.16) : neutral[200],
    },
  },
}))

const FilterBadge = styled(Badge)(({ theme }) => ({
  '& .MuiBadge-badge': {
    backgroundColor: theme.palette.mode === 'dark' ? neutral[700] : neutral[900],
    color: theme.palette.common.white,
    fontSize: '10px',
    fontWeight: 600,
    minWidth: 16,
    height: 16,
    borderRadius: 6,
    padding: '0 4px',
  },
}))


function DataTableToolbar({
  title,
  subtitle,
  searchPlaceholder = 'Search...',
  onSearch,
  filters = [],
  actions = [],
  numSelected = 0,
  onRefresh,
  onBulkDelete,
  bulkActions = [],
  onFiltersChange,
  columns = [],
  hiddenColumns = [],
  onToggleColumn,
  onResetColumns,
  onExportCsv,
  onExportJson,
  exportCsvDisabled = false,
  exportJsonDisabled = false,
}) {
  const theme = useTheme()
  const [searchValue, setSearchValue] = useState('')
  const [filterAnchor, setFilterAnchor] = useState(null)
  const [activeFilters, setActiveFilters] = useState({})
  const [moreAnchor, setMoreAnchor] = useState(null)
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false)

  const visibleColumnCount = columns.filter(
    (column) => column?.field && !hiddenColumns.includes(column.field)
  ).length
  const canConfigureColumns = columns.some((column) => column?.field) && typeof onToggleColumn === 'function'

  const handleSearchChange = useCallback((e) => {
    const value = e.target.value
    setSearchValue(value)
    onSearch?.(value)
  }, [onSearch])

  const handleFilterClick = useCallback((event) => {
    setFilterAnchor(event.currentTarget)
  }, [])

  const handleFilterClose = useCallback(() => {
    setFilterAnchor(null)
  }, [])

  const handleFilterSelect = useCallback((filterKey, value) => {
    setActiveFilters((prev) => {
      const next = { ...prev, [filterKey]: value }
      onFiltersChange?.(next)
      return next
    })
    handleFilterClose()
  }, [handleFilterClose, onFiltersChange])

  const handleClearFilter = useCallback((filterKey) => {
    setActiveFilters((prev) => {
      const next = { ...prev }
      delete next[filterKey]
      onFiltersChange?.(next)
      return next
    })
  }, [onFiltersChange])

  const handleClearAllFilters = useCallback(() => {
    setActiveFilters({})
    onFiltersChange?.({})
  }, [onFiltersChange])

  const handleMoreClick = useCallback((event) => {
    setMoreAnchor(event.currentTarget)
  }, [])

  const handleMoreClose = useCallback(() => {
    setMoreAnchor(null)
  }, [])

  const handleOpenColumnSettings = useCallback(() => {
    if (!canConfigureColumns) return
    setColumnSettingsOpen(true)
    handleMoreClose()
  }, [canConfigureColumns, handleMoreClose])

  const handleCloseColumnSettings = useCallback(() => {
    setColumnSettingsOpen(false)
  }, [])

  const handleExportCsv = useCallback(() => {
    if (exportCsvDisabled || !onExportCsv) return
    onExportCsv()
    handleMoreClose()
  }, [exportCsvDisabled, onExportCsv, handleMoreClose])

  const handleExportJson = useCallback(() => {
    if (exportJsonDisabled || !onExportJson) return
    onExportJson()
    handleMoreClose()
  }, [exportJsonDisabled, onExportJson, handleMoreClose])

  const activeFilterCount = Object.keys(activeFilters).length

  return (
    <ToolbarContainer>
      {/* Header Row */}
      <HeaderRow
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        spacing={2}
      >
        <TitleSection>
          {title && <TbTitle>{title}</TbTitle>}
          {subtitle && <Subtitle>{subtitle}</Subtitle>}
        </TitleSection>

        <Stack direction="row" spacing={1}>
          {actions.map((action, index) => (
            <TbActionButton
              key={index}
              variant={action.variant || 'outlined'}
              color={action.color || 'primary'}
              size="small"
              startIcon={action.icon}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </TbActionButton>
          ))}
        </Stack>
      </HeaderRow>

      {/* Selection Bar */}
      {numSelected > 0 && (
        <Fade in>
          <SelectionBar>
            <SelectionText>
              <SelectionBadge>{numSelected}</SelectionBadge>
              item{numSelected > 1 ? 's' : ''} selected
            </SelectionText>
            <Stack direction="row" spacing={1}>
              {bulkActions.map((action, index) => (
                <SelectionAction
                  key={index}
                  variant="outlined"
                  size="small"
                  startIcon={action.icon}
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.label}
                </SelectionAction>
              ))}
              {onBulkDelete && (
                <DeleteAction
                  variant="outlined"
                  size="small"
                  startIcon={<DeleteIcon sx={{ fontSize: 16 }} />}
                  onClick={onBulkDelete}
                >
                  Delete
                </DeleteAction>
              )}
            </Stack>
          </SelectionBar>
        </Fade>
      )}

      {/* Search and Filters Row */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', sm: 'center' }}
      >
        <SearchField
          size="small"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={handleSearchChange}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
              </InputAdornment>
            ),
            endAdornment: searchValue && (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => {
                    setSearchValue('')
                    onSearch?.('')
                  }}
                  sx={{ p: 0.5 }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{ width: { xs: '100%', sm: 280 } }}
        />

        <Stack
          direction="row"
          spacing={1}
          sx={{ flex: 1, flexWrap: 'wrap', gap: 1 }}
          alignItems="center"
        >
          {filters.length > 0 && (
            <>
              <FilterBadge badgeContent={activeFilterCount} invisible={activeFilterCount === 0}>
                <FilterButton
                  variant="outlined"
                  size="small"
                  startIcon={<FilterListIcon sx={{ fontSize: 16 }} />}
                  endIcon={<ArrowDownIcon sx={{ fontSize: 16 }} />}
                  onClick={handleFilterClick}
                  className={activeFilterCount > 0 ? 'active' : ''}
                >
                  Filters
                </FilterButton>
              </FilterBadge>

              <StyledMenu
                anchorEl={filterAnchor}
                open={Boolean(filterAnchor)}
                onClose={handleFilterClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
              >
                {filters.map((filter, idx) => (
                  <MenuSection key={filter.key}>
                    <MenuLabel>{filter.label}</MenuLabel>
                    {filter.options.map((option) => (
                      <StyledMenuItem
                        key={option.value}
                        selected={activeFilters[filter.key] === option.value}
                        onClick={() => handleFilterSelect(filter.key, option.value)}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                          {option.label}
                          {activeFilters[filter.key] === option.value && (
                            <CheckIcon sx={{ fontSize: 16, color: 'text.primary', ml: 1 }} />
                          )}
                        </Box>
                      </StyledMenuItem>
                    ))}
                    {idx < filters.length - 1 && (
                      <Divider sx={{ my: 1, mx: 2, borderColor: alpha(theme.palette.divider, 0.1) }} />
                    )}
                  </MenuSection>
                ))}
                {activeFilterCount > 0 && (
                  <>
                    <Divider sx={{ my: 1, mx: 2, borderColor: alpha(theme.palette.divider, 0.1) }} />
                    <Box sx={{ px: 2, pb: 1 }}>
                      <Button
                        size="small"
                        onClick={handleClearAllFilters}
                        sx={{ fontSize: '0.75rem', textTransform: 'none' }}
                      >
                        Clear all filters
                      </Button>
                    </Box>
                  </>
                )}
              </StyledMenu>
            </>
          )}

          {/* Active Filter Chips */}
          {Object.entries(activeFilters).map(([key, value]) => {
            const filter = filters.find((f) => f.key === key)
            const option = filter?.options.find((o) => o.value === value)
            return (
              <FilterChip
                key={key}
                label={`${filter?.label}: ${option?.label}`}
                size="small"
                onDelete={() => handleClearFilter(key)}
              />
            )
          })}
        </Stack>

        <Stack direction="row" spacing={0.5}>
          {onRefresh && (
            <Tooltip title="Refresh data" arrow>
              <IconButtonStyled size="small" onClick={onRefresh} aria-label="Refresh data">
                <RefreshIcon sx={{ fontSize: 18 }} />
              </IconButtonStyled>
            </Tooltip>
          )}
          <Tooltip title="More options" arrow>
            <IconButtonStyled size="small" onClick={handleMoreClick} aria-label="More options">
              <MoreVertIcon sx={{ fontSize: 18 }} />
            </IconButtonStyled>
          </Tooltip>
        </Stack>

        <StyledMenu
          anchorEl={moreAnchor}
          open={Boolean(moreAnchor)}
          onClose={handleMoreClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuSection>
            <MenuLabel>Export</MenuLabel>
            <StyledMenuItem
              onClick={handleExportCsv}
              disabled={exportCsvDisabled || !onExportCsv}
            >
              <DownloadIcon sx={{ fontSize: 16, mr: 1.5, color: 'text.secondary' }} />
              Export as CSV
            </StyledMenuItem>
            <StyledMenuItem
              onClick={handleExportJson}
              disabled={exportJsonDisabled || !onExportJson}
            >
              <DownloadIcon sx={{ fontSize: 16, mr: 1.5, color: 'text.secondary' }} />
              Export as JSON
            </StyledMenuItem>
          </MenuSection>
          <Divider sx={{ my: 1, mx: 2, borderColor: alpha(theme.palette.divider, 0.1) }} />
          <MenuSection>
            <MenuLabel>View</MenuLabel>
            <StyledMenuItem onClick={handleOpenColumnSettings} disabled={!canConfigureColumns}>
              <ColumnsIcon sx={{ fontSize: 16, mr: 1.5, color: 'text.secondary' }} />
              Column Settings
            </StyledMenuItem>
          </MenuSection>
        </StyledMenu>
      </Stack>

      <Dialog open={columnSettingsOpen} onClose={handleCloseColumnSettings} maxWidth="xs" fullWidth>
        <DialogTitle>Column Settings</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Choose which columns are visible in the table.
            </Typography>
            <FormGroup>
              {columns.map((column) => {
                if (!column?.field) return null
                const isVisible = !hiddenColumns.includes(column.field)
                const disableToggle = isVisible && visibleColumnCount <= 1
                return (
                  <FormControlLabel
                    key={column.field}
                    control={
                      <Checkbox
                        checked={isVisible}
                        onChange={() => onToggleColumn?.(column.field)}
                        disabled={disableToggle}
                      />
                    }
                    label={column.headerName || column.field}
                  />
                )
              })}
            </FormGroup>
            {visibleColumnCount <= 1 && (
              <Typography variant="caption" color="text.secondary">
                At least one column must remain visible.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => onResetColumns?.()} disabled={!hiddenColumns.length || !onResetColumns}>
            Reset
          </Button>
          <Button onClick={handleCloseColumnSettings} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </ToolbarContainer>
  )
}

// === From: DataTable.jsx ===
/**
 * Premium Data Table Component
 * Sophisticated table with glassmorphism, animations, and advanced interactions
 */

// Import design tokens

const FIGMA_TABLE = {
  headerHeight: figmaComponents.dataTable.headerHeight,  // 60px
  rowHeight: figmaComponents.dataTable.rowHeight,        // 60px
  cellPadding: figmaComponents.dataTable.cellPadding,    // 16px
}


const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`

const dtPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`


const TableWrapper = styled(Box)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.7),
  backdropFilter: 'blur(20px)',
  borderRadius: 8,  // Figma spec: 8px
  border: `1px solid ${alpha(theme.palette.divider, 0.25)}`,
  overflow: 'hidden',
  // In flex layouts, allow the table wrapper to shrink so wide tables don't force horizontal page scroll.
  minWidth: 0,
  maxWidth: '100%',
  boxShadow: `0 4px 24px ${alpha(theme.palette.common.black, 0.06)}`,
  transition: 'all 0.3s ease',
  '&:hover': {
    boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.08)}`,
  },
}))

const StyledTableContainer = styled(TableContainer)(({ theme }) => ({
  overflowX: 'auto',
  '&::-webkit-scrollbar': {
    width: 8,
    height: 8,
  },
  '&::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: alpha(theme.palette.text.primary, 0.1),
    borderRadius: 4,
    '&:hover': {
      backgroundColor: alpha(theme.palette.text.primary, 0.2),
    },
  },
}))

// FIGMA STYLED TABLE HEAD (EXACT from Figma: 60px height, 16px padding)
const StyledTableHead = styled(TableHead)(({ theme }) => ({
  '& .MuiTableCell-head': {
    backgroundColor: theme.palette.mode === 'dark'
      ? alpha(theme.palette.background.paper, 0.5)
      : neutral[50],  // #F9F9F8 from Figma
    fontFamily: fontFamilyBody,  // Lato from Figma
    fontWeight: 500,
    fontSize: '14px',
    textTransform: 'none',  // No uppercase per Figma
    letterSpacing: 'normal',
    color: theme.palette.mode === 'dark' ? theme.palette.text.secondary : neutral[700],  // #63635E
    borderBottom: `1px solid ${theme.palette.mode === 'dark' ? alpha(theme.palette.divider, 0.08) : neutral[200]}`,
    height: FIGMA_TABLE.headerHeight,  // 60px from Figma
    padding: `0 ${FIGMA_TABLE.cellPadding}px`,  // 16px from Figma
    transition: 'background-color 0.2s ease',
    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[100],
    },
  },
}))

// FIGMA STYLED TABLE ROW (EXACT from Figma: 60px height)
const StyledTableRow = styled(TableRow, {
  shouldForwardProp: (prop) => !['rowIndex', 'isClickable'].includes(prop),
})(({ theme, rowIndex, isClickable }) => ({
  height: FIGMA_TABLE.rowHeight,  // 60px from Figma
  animation: `${fadeInUp} 0.4s ease-out`,
  animationDelay: `${rowIndex * 0.03}s`,
  animationFillMode: 'both',
  transition: 'all 0.2s ease',
  cursor: isClickable ? 'pointer' : 'default',
  '& .MuiTableCell-body': {
    fontFamily: fontFamilyBody,  // Lato from Figma
    borderBottom: `1px solid ${theme.palette.mode === 'dark' ? alpha(theme.palette.divider, 0.05) : neutral[200]}`,
    padding: `0 ${FIGMA_TABLE.cellPadding}px`,  // 16px from Figma
    height: FIGMA_TABLE.rowHeight,  // 60px from Figma
    fontSize: '14px',
    color: theme.palette.mode === 'dark' ? theme.palette.text.primary : neutral[900],  // #21201C
    transition: 'all 0.2s ease',
  },
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : alpha(neutral[100], 0.5),
    '& .MuiTableCell-body': {
      color: theme.palette.mode === 'dark' ? theme.palette.text.primary : neutral[900],
    },
    '& .row-actions': {
      opacity: 1,
      transform: 'translateX(0)',
    },
  },
  '&.Mui-selected': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[200],
    },
  },
  '&:last-child .MuiTableCell-body': {
    borderBottom: 'none',
  },
}))

const RowActionsContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: theme.spacing(0.5),
  opacity: 0.5,
  transform: 'translateX(4px)',
  transition: 'all 0.2s ease',
}))

const StyledCheckbox = styled(Checkbox)(({ theme }) => ({
  color: alpha(theme.palette.text.primary, 0.3),
  padding: theme.spacing(0.5),
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100],
  },
  '&.Mui-checked': {
    color: theme.palette.text.primary,
  },
  '&.MuiCheckbox-indeterminate': {
    color: theme.palette.text.primary,
  },
}))

const StyledTableSortLabel = styled(TableSortLabel)(({ theme }) => ({
  color: theme.palette.text.secondary,
  '&:hover': {
    color: theme.palette.text.primary,
  },
  '&.Mui-active': {
    color: theme.palette.text.primary,
    '& .MuiTableSortLabel-icon': {
      color: theme.palette.text.primary,
    },
  },
  '& .MuiTableSortLabel-icon': {
    fontSize: 16,
    transition: 'all 0.2s ease',
  },
}))

const SkeletonRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: theme.spacing(1.5, 2),
  gap: theme.spacing(2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
  animation: `${dtPulse} 1.5s infinite ease-in-out`,
}))

const ShimmerSkeleton = styled(Skeleton)(({ theme }) => ({
  background: `linear-gradient(
    90deg,
    ${alpha(theme.palette.text.primary, 0.06)} 0%,
    ${alpha(theme.palette.text.primary, 0.12)} 50%,
    ${alpha(theme.palette.text.primary, 0.06)} 100%
  )`,
  backgroundSize: '200% 100%',
  animation: `${shimmer} 1.5s infinite`,
  borderRadius: 6,
}))

const StyledPagination = styled(TablePagination)(({ theme }) => ({
  borderTop: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.3),
  '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
    fontSize: 14,
    color: theme.palette.text.secondary,
  },
  '& .MuiTablePagination-select': {
    borderRadius: 8,
    fontSize: 14,
  },
  '& .MuiTablePagination-actions': {
    '& .MuiIconButton-root': {
      color: theme.palette.text.secondary,
      '&:hover': {
        backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
        color: theme.palette.text.primary,
      },
      '&.Mui-disabled': {
        color: alpha(theme.palette.text.primary, 0.2),
      },
    },
  },
}))

const ExpandableRow = styled(TableRow)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.3),
  '& .MuiTableCell-body': {
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
  },
}))


function descendingComparator(a, b, orderBy) {
  if (b[orderBy] < a[orderBy]) return -1
  if (b[orderBy] > a[orderBy]) return 1
  return 0
}

function getComparator(order, orderBy) {
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy)
}

const STORAGE_PREFIX = 'neurareport_table_'

function loadPersistedState(key) {
  if (!key) return null
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function savePersistedState(key, state) {
  if (!key) return
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}


export function DataTable({
  columns,
  data = [],
  loading = false,
  selectable = false,
  expandable = false,
  renderExpandedRow,
  onRowClick,
  onSelectionChange,
  rowActions,
  emptyState,
  filters,
  searchPlaceholder = 'Search...',
  onSearch,
  actions,
  bulkActions = [],
  onBulkDelete,
  title,
  subtitle,
  pagination = null,
  defaultSortField,
  defaultSortOrder = 'asc',
  pageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  stickyHeader = false,
  persistKey = null,
  rowHeight = 'medium', // 'compact', 'medium', 'comfortable'
}) {
  const theme = useTheme()
  // Enable a responsive table layout for phones + tablets (and smaller laptops) to avoid page-level horizontal scrolling.
  const isNarrow = useMediaQuery(theme.breakpoints.down('lg'))
  const persisted = loadPersistedState(persistKey)

  const [order, setOrder] = useState(persisted?.order || defaultSortOrder)
  const [orderBy, setOrderBy] = useState(persisted?.orderBy || defaultSortField || columns[0]?.field)
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(persisted?.rowsPerPage || pageSize)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilters, setActiveFilters] = useState(persisted?.filters || {})
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [hiddenColumns, setHiddenColumns] = useState(persisted?.hiddenColumns || [])

  const visibleColumns = useMemo(() => (
    columns.filter((column) => column?.field && !hiddenColumns.includes(column.field))
  ), [columns, hiddenColumns])

  // Persist state
  useEffect(() => {
    if (!persistKey) return
    savePersistedState(persistKey, {
      order,
      orderBy,
      rowsPerPage,
      filters: activeFilters,
      hiddenColumns,
    })
  }, [persistKey, order, orderBy, rowsPerPage, activeFilters, hiddenColumns])

  useEffect(() => {
    setHiddenColumns((prev) => prev.filter((field) => columns.some((col) => col.field === field)))
  }, [columns])

  useEffect(() => {
    if (!visibleColumns.length) return
    if (!visibleColumns.some((column) => column.field === orderBy)) {
      setOrderBy(visibleColumns[0].field)
    }
  }, [visibleColumns, orderBy])

  const handleRequestSort = useCallback((property) => {
    const isAsc = orderBy === property && order === 'asc'
    setOrder(isAsc ? 'desc' : 'asc')
    setOrderBy(property)
  }, [order, orderBy])

  const handleSelect = useCallback((id) => {
    const selectedIndex = selected.indexOf(id)
    let newSelected = []

    if (selectedIndex === -1) {
      newSelected = [...selected, id]
    } else {
      newSelected = selected.filter((item) => item !== id)
    }

    setSelected(newSelected)
    onSelectionChangeRef.current?.(newSelected)
  }, [selected])

  const handleToggleExpand = useCallback((id) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleToggleColumn = useCallback((field) => {
    if (!field) return
    setHiddenColumns((prev) => {
      const next = new Set(prev)
      if (next.has(field)) {
        next.delete(field)
        return Array.from(next)
      }
      const visibleCount = columns.filter((column) =>
        column?.field && !next.has(column.field)
      ).length
      if (visibleCount <= 1) return prev
      next.add(field)
      return Array.from(next)
    })
  }, [columns])

  const handleResetColumns = useCallback(() => {
    setHiddenColumns([])
  }, [])

  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange

  useEffect(() => {
    if (!selectable) return
    const idSet = new Set(data.map((row) => row?.id).filter(Boolean))
    const nextSelected = selected.filter((id) => idSet.has(id))
    if (nextSelected.length !== selected.length) {
      setSelected(nextSelected)
      onSelectionChangeRef.current?.(nextSelected)
    }
  }, [data, selectable, selected])

  const handleChangePage = useCallback((_, newPage) => {
    if (pagination?.onPageChange) {
      pagination.onPageChange(newPage)
      return
    }
    setPage(newPage)
  }, [pagination])

  const handleChangeRowsPerPage = useCallback((event) => {
    const nextValue = parseInt(event.target.value, 10)
    if (pagination?.onRowsPerPageChange) {
      pagination.onRowsPerPageChange(nextValue)
      return
    }
    setRowsPerPage(nextValue)
    setPage(0)
  }, [pagination])

  const handleSearch = useCallback((query) => {
    setSearchQuery(query)
    if (pagination?.onPageChange) {
      pagination.onPageChange(0)
    } else {
      setPage(0)
    }
    onSearch?.(query)
  }, [onSearch, pagination])

  const handleRowKeyDown = useCallback((event, row, rowIndex) => {
    if (event.key === 'Enter' && onRowClick) {
      event.preventDefault()
      onRowClick(row)
      return
    }
    if ((event.key === ' ' || event.key === 'Spacebar') && selectable) {
      event.preventDefault()
      handleSelect(row.id)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const dir = event.key === 'ArrowDown' ? 1 : -1
      const rows = event.currentTarget.parentElement?.querySelectorAll('tr[data-row-index]')
      const next = rows?.[rowIndex + dir]
      if (next?.focus) next.focus()
    }
  }, [onRowClick, selectable, handleSelect])

  const filteredData = useMemo(() => {
    const filterEntries = Object.entries(activeFilters)
    const baseData = filterEntries.length
      ? data.filter((row) =>
          filterEntries.every(([key, filterValue]) => {
            const cellValue = row[key]
            if (cellValue == null) return false
            if (Array.isArray(cellValue)) return cellValue.includes(filterValue)
            if (typeof cellValue === 'string') {
              return cellValue.toLowerCase() === String(filterValue).toLowerCase()
            }
            return cellValue === filterValue
          })
        )
      : data

    if (!searchQuery) return baseData
    const searchColumns = visibleColumns.length ? visibleColumns : columns
    return baseData.filter((row) =>
      searchColumns.some((col) => {
        const value = row[col.field]
        if (value == null) return false
        return String(value).toLowerCase().includes(searchQuery.toLowerCase())
      })
    )
  }, [data, searchQuery, columns, activeFilters, visibleColumns])

  const sortedData = useMemo(() => {
    return [...filteredData].sort(getComparator(order, orderBy))
  }, [filteredData, order, orderBy])

  const paginatedData = useMemo(() => {
    if (pagination) return sortedData
    return sortedData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
  }, [sortedData, page, rowsPerPage, pagination])

  const handleSelectAll = useCallback((event) => {
    if (event.target.checked) {
      const newSelected = paginatedData.map((row) => row.id)
      setSelected(newSelected)
      onSelectionChangeRef.current?.(newSelected)
      return
    }
    setSelected([])
    onSelectionChangeRef.current?.([])
  }, [paginatedData])

  const isSelected = (id) => selected.includes(id)
  const numSelected = selected.length
  const rowCount = pagination?.total ?? filteredData.length
  const pageRowCount = useMemo(() =>
    pagination ? paginatedData.length : rowCount,
    [pagination, paginatedData, rowCount]
  )
  const effectivePage = pagination?.page ?? page
  const effectiveRowsPerPage = pagination?.rowsPerPage ?? rowsPerPage

  const exportColumns = useMemo(
    () => visibleColumns.filter((column) => column?.exportable !== false && column?.field),
    [visibleColumns],
  )

  const exportRows = useMemo(() => sortedData, [sortedData])

  const getExportValue = useCallback((row, column) => {
    if (typeof column.exportValue === 'function') {
      return column.exportValue(row[column.field], row)
    }
    if (typeof column.valueGetter === 'function') {
      return column.valueGetter(row)
    }
    return row[column.field]
  }, [])

  const formatCsvValue = useCallback((value) => {
    if (value === null || value === undefined) return ''
    if (value instanceof Date) return value.toISOString()
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    const escaped = text.replace(/"/g, '""')
    if (/[",\n\r]/.test(escaped)) {
      return `"${escaped}"`
    }
    return escaped
  }, [])

  const buildExportFileName = useCallback((extension) => {
    const base = String(title || 'table-export').trim().toLowerCase()
    const safeBase = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'table-export'
    return `${safeBase}.${extension}`
  }, [title])

  const downloadFile = useCallback((content, filename, type) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [])

  const handleExportCsv = useCallback(() => {
    if (!exportColumns.length || !exportRows.length) return
    const headers = exportColumns.map((column) => column.headerName || column.field)
    const rows = exportRows.map((row) =>
      exportColumns.map((column) => formatCsvValue(getExportValue(row, column)))
    )
    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n')
    downloadFile(csv, buildExportFileName('csv'), 'text/csv;charset=utf-8;')
  }, [exportColumns, exportRows, formatCsvValue, getExportValue, downloadFile, buildExportFileName])

  const handleExportJson = useCallback(() => {
    if (!exportColumns.length || !exportRows.length) return
    const records = exportRows.map((row) => {
      const record = {}
      exportColumns.forEach((column) => {
        const key = column.field || column.headerName
        record[key] = getExportValue(row, column) ?? null
      })
      return record
    })
    const json = JSON.stringify(records, null, 2)
    downloadFile(json, buildExportFileName('json'), 'application/json;charset=utf-8;')
  }, [exportColumns, exportRows, getExportValue, downloadFile, buildExportFileName])

  const cellPadding = {
    compact: 1,
    medium: 1.5,
    comfortable: 2,
  }[rowHeight] || 1.5

  // Empty state
  if (!loading && data.length === 0 && emptyState) {
    // Avoid rendering duplicate CTAs when both toolbar actions and emptyState define the same label.
    // This commonly happens during first-load (empty list before data arrives) and creates confusing UX
    // + strict-mode selector collisions in e2e.
    const emptyActionLabel = emptyState?.actionLabel
    const actionsForEmpty =
      emptyActionLabel && Array.isArray(actions)
        ? actions.filter((action) => action?.label !== emptyActionLabel)
        : actions

    return (
      <TableWrapper>
        <DataTableToolbar
          title={title}
          subtitle={subtitle}
          searchPlaceholder={searchPlaceholder}
          onSearch={handleSearch}
          filters={filters}
          actions={actionsForEmpty}
          bulkActions={bulkActions}
          onBulkDelete={onBulkDelete}
          numSelected={numSelected}
          onFiltersChange={setActiveFilters}
          columns={columns}
          hiddenColumns={hiddenColumns}
          onToggleColumn={handleToggleColumn}
          onResetColumns={handleResetColumns}
          onExportCsv={handleExportCsv}
          onExportJson={handleExportJson}
          exportCsvDisabled={!exportColumns.length || !exportRows.length}
          exportJsonDisabled={!exportColumns.length || !exportRows.length}
        />
        <DataTableEmptyState {...emptyState} />
      </TableWrapper>
    )
  }

  return (
    <TableWrapper>
      <DataTableToolbar
        title={title}
        subtitle={subtitle}
        searchPlaceholder={searchPlaceholder}
        onSearch={handleSearch}
        filters={filters}
        actions={actions}
        bulkActions={bulkActions}
        onBulkDelete={onBulkDelete}
        numSelected={numSelected}
        onFiltersChange={setActiveFilters}
        columns={columns}
        hiddenColumns={hiddenColumns}
        onToggleColumn={handleToggleColumn}
        onResetColumns={handleResetColumns}
        onExportCsv={handleExportCsv}
        onExportJson={handleExportJson}
        exportCsvDisabled={!exportColumns.length || !exportRows.length}
        exportJsonDisabled={!exportColumns.length || !exportRows.length}
      />

      <StyledTableContainer sx={{ maxHeight: stickyHeader ? 600 : 'none' }}>
        <Table
          stickyHeader={stickyHeader}
          size={rowHeight === 'compact' ? 'small' : 'medium'}
          sx={{
            width: '100%',
            tableLayout: 'auto',
          }}
        >
          <StyledTableHead>
            <TableRow>
              {expandable && <TableCell sx={{ width: 48 }} />}
              {selectable && (
                <TableCell padding="checkbox" sx={{ width: 48 }}>
                  <StyledCheckbox
                    indeterminate={numSelected > 0 && numSelected < pageRowCount}
                    checked={pageRowCount > 0 && numSelected === pageRowCount}
                    onChange={handleSelectAll}
                    inputProps={{ 'aria-label': 'Select all rows' }}
                  />
                </TableCell>
              )}
              {visibleColumns.map((column) => (
                <TableCell
                  key={column.field}
                  align={column.align || 'left'}
                  sx={{
                    width: column.width,
                    minWidth: isNarrow ? (column.minWidth || column.width || 80) : column.minWidth,
                    whiteSpace: 'nowrap',
                  }}
                  sortDirection={orderBy === column.field ? order : false}
                >
                  {column.sortable !== false ? (
                    <StyledTableSortLabel
                      active={orderBy === column.field}
                      direction={orderBy === column.field ? order : 'asc'}
                      onClick={() => handleRequestSort(column.field)}
                    >
                      {column.headerName}
                    </StyledTableSortLabel>
                  ) : (
                    column.headerName
                  )}
                </TableCell>
              ))}
              {rowActions && <TableCell align="right" sx={{ width: 80 }} />}
            </TableRow>
          </StyledTableHead>

          <TableBody>
            {loading ? (
              // Loading skeleton
              Array.from({ length: rowsPerPage }).map((_, index) => (
                <TableRow key={index}>
                  {expandable && (
                    <TableCell sx={{ p: cellPadding }}>
                      <ShimmerSkeleton variant="circular" width={24} height={24} />
                    </TableCell>
                  )}
                  {selectable && (
                    <TableCell padding="checkbox">
                      <ShimmerSkeleton variant="rectangular" width={18} height={18} sx={{ borderRadius: 0.5 }} />
                    </TableCell>
                  )}
                  {visibleColumns.map((column) => (
                    <TableCell
                      key={column.field}
                      sx={{
                        p: cellPadding,
                        ...(isNarrow ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0 } : null),
                      }}
                    >
                      <ShimmerSkeleton
                        variant="text"
                        width={column.width || '80%'}
                        height={20}
                      />
                    </TableCell>
                  ))}
                  {rowActions && (
                    <TableCell sx={{ p: cellPadding }}>
                      <ShimmerSkeleton variant="circular" width={24} height={24} />
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : (
              paginatedData.map((row, rowIndex) => {
                const isItemSelected = isSelected(row.id)
                const isExpanded = expandedRows.has(row.id)
                const rowKey = row.id ?? rowIndex

                return (
                  <Fragment key={rowKey}>
                    <StyledTableRow
                      hover
                      onClick={() => onRowClick?.(row)}
                      onKeyDown={(event) => handleRowKeyDown(event, row, rowIndex)}
                      selected={isItemSelected}
                      data-row-index={rowIndex}
                      data-testid={`table-row-${rowIndex}`}
                      rowIndex={rowIndex}
                      isClickable={!!onRowClick}
                      tabIndex={onRowClick || selectable ? 0 : -1}
                      role={onRowClick ? 'button' : undefined}
                      aria-selected={selectable ? isItemSelected : undefined}
                    >
                      {expandable && (
                        <TableCell sx={{ p: cellPadding }}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleToggleExpand(row.id)
                            }}
                            sx={{
                              transition: 'all 0.2s ease',
                              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                              color: isExpanded ? 'text.primary' : 'text.secondary',
                            }}
                          >
                            <ExpandIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      )}
                      {selectable && (
                        <TableCell padding="checkbox">
                          <StyledCheckbox
                            checked={isItemSelected}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSelect(row.id)
                            }}
                            inputProps={{ 'aria-label': `Select row ${row.id}` }}
                          />
                        </TableCell>
                      )}
                      {visibleColumns.map((column) => (
                        <TableCell
                          key={column.field}
                          align={column.align || 'left'}
                          data-testid={`table-cell-${column.field}`}
                          sx={{
                            p: cellPadding,
                            ...(isNarrow ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0 } : null),
                          }}
                        >
                          {column.renderCell
                            ? column.renderCell(row[column.field], row)
                            : row[column.field]}
                        </TableCell>
                      ))}
                      {rowActions && (
                        <TableCell align="right" onClick={(e) => e.stopPropagation()} sx={{ p: cellPadding }}>
                          <RowActionsContainer className="row-actions">
                            {rowActions(row)}
                          </RowActionsContainer>
                        </TableCell>
                      )}
                    </StyledTableRow>

                    {/* Expandable row content */}
                    {expandable && renderExpandedRow && (
                      <ExpandableRow>
                        <TableCell
                          colSpan={visibleColumns.length + (selectable ? 2 : 1) + (rowActions ? 1 : 0)}
                          sx={{ p: 0 }}
                        >
                          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                            <Box sx={{ p: 3 }}>{renderExpandedRow(row)}</Box>
                          </Collapse>
                        </TableCell>
                      </ExpandableRow>
                    )}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </StyledTableContainer>

      <StyledPagination
        rowsPerPageOptions={pageSizeOptions}
        component="div"
        count={rowCount}
        rowsPerPage={effectiveRowsPerPage}
        page={effectivePage}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        labelRowsPerPage="Rows per page:"
        labelDisplayedRows={({ from, to, count }) => `${from}-${to} of ${count}`}
      />
    </TableWrapper>
  )
}
