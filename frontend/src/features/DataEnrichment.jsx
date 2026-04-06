import { neutral, palette } from '@/app/theme'
import { ActionButton, FullHeightPageContainer as PageContainer } from '@/styles/styles'
import { ConnectionSelector, ImportFromMenu, SendToMenu, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { ConfirmModal } from '@/components/modals'
import { AiUsageNotice } from '@/components/ux'
import { useCrossPageActions, useIncomingTransfer, useSharedData } from '@/hooks/hooks'
import { useEnrichmentStore, useSearchStore } from '@/stores/content'
import { FeatureKey, OutputType, TransferAction, sanitizeHighlight } from '@/utils/helpers'
import {
  Add as AddIcon,
  AutoFixHigh as EnrichIcon,
  Bookmark as SavedIcon,
  BookmarkBorder as SaveIcon,
  Cached as CacheIcon,
  Clear as ClearIcon,
  Code as RegexIcon,
  DataObject as BooleanIcon,
  Delete as DeleteIcon,
  Description as DocIcon,
  ExpandLess as CollapseIcon,
  ExpandMore as ExpandIcon,
  FilterList as FilterIcon,
  Folder as FolderIcon,
  History as HistoryIcon,
  PlayArrow as RunIcon,
  Preview as PreviewIcon,
  Psychology as SemanticIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
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
import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
const SearchHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const ContentArea = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
}))

const MainPanel = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(3),
  overflow: 'auto',
}))

const Sidebar = styled(Box)(({ theme }) => ({
  width: 280,
  borderLeft: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.6),
  display: 'flex',
  flexDirection: 'column',
}))

const SearchInput = styled(TextField)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    // Figma spec: Background #F1F0EF, Border 1px solid #E2E1DE, Border-radius 8px
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.background.paper, 0.6) : neutral[100],
    borderRadius: 8,  // Figma spec: 8px
    '& fieldset': {
      borderColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.12) : neutral[200],
    },
    '&:hover': {
      '& fieldset': {
        borderColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.2) : neutral[300],
      },
    },
    '&.Mui-focused': {
      '& fieldset': {
        borderColor: theme.palette.mode === 'dark' ? theme.palette.text.secondary : neutral[500],
        borderWidth: 1,
      },
    },
  },
}))

const ResultCard = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(2),
  marginBottom: theme.spacing(2),
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
  },
}))

const FacetSection = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}))

const SEARCH_TYPES = [
  { type: 'fulltext', label: 'Full Text', icon: SearchIcon },
  { type: 'semantic', label: 'Semantic', icon: SemanticIcon },
  { type: 'regex', label: 'Regex', icon: RegexIcon },
  { type: 'boolean', label: 'Boolean', icon: BooleanIcon },
]


export function SearchPageContainer() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const { connections, activeConnectionId } = useSharedData()
  const {
    results,
    totalResults,
    facets,
    savedSearches,
    searchHistory,
    loading,
    searching,
    error,
    search,
    semanticSearch,
    regexSearch,
    booleanSearch,
    saveSearch,
    fetchSavedSearches,
    deleteSavedSearch,
    runSavedSearch,
    clearResults,
    reset,
  } = useSearchStore()

  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState('fulltext')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({})
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [searchName, setSearchName] = useState('')

  useEffect(() => {
    fetchSavedSearches()
    return () => reset()
  }, [fetchSavedSearches, reset])

  const handleSearch = useCallback(async (overrideQuery) => {
    const searchQuery = (overrideQuery ?? query).trim()
    if (!searchQuery) return

    const searchFilters = selectedConnectionId
      ? { ...filters, connectionId: selectedConnectionId }
      : filters

    const searchAction = async () => {
      let searchResult = null
      switch (searchType) {
        case 'semantic':
          searchResult = await semanticSearch(searchQuery, { filters: searchFilters })
          break
        case 'regex':
          searchResult = await regexSearch(searchQuery, { filters: searchFilters })
          break
        case 'boolean':
          searchResult = await booleanSearch(searchQuery, { filters: searchFilters })
          break
        default:
          searchResult = await search(searchQuery, { searchType: 'fulltext', filters: searchFilters })
      }
      return searchResult
    }

    return execute({
      type: InteractionType.EXECUTE,
      label: 'Search documents',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: { source: 'search', query: searchQuery, searchType },
      action: searchAction,
    })
  }, [booleanSearch, execute, filters, query, regexSearch, search, searchType, selectedConnectionId, semanticSearch])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }, [handleSearch])

  const handleSaveSearch = useCallback(async () => {
    if (!searchName.trim() || !query.trim()) return

    return execute({
      type: InteractionType.CREATE,
      label: 'Save search',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'search', name: searchName },
      action: async () => {
        await saveSearch(searchName, query, { searchType, filters })
        toast.show('Search saved', 'success')
        setSearchName('')
        setSaveDialogOpen(false)
      },
    })
  }, [execute, filters, query, saveSearch, searchName, searchType, toast])

  const handleRunSavedSearch = useCallback(async (savedSearch) => {
    setQuery(savedSearch.query)
    setSearchType(savedSearch.search_type || 'fulltext')
    await runSavedSearch(savedSearch.id)
  }, [runSavedSearch])

  const handleClearSearch = useCallback(() => {
    setQuery('')
    clearResults()
  }, [clearResults])

  return (
    <PageContainer>
      {/* Search Header */}
      <SearchHeader>
        <Box sx={{ maxWidth: 800, mx: 'auto' }}>
          <Typography variant="h5" sx={{ fontWeight: 600, mb: 3 }}>
            Search & Discovery
          </Typography>

          {/* Search Type Tabs */}
          <Tabs
            value={searchType}
            onChange={(_, v) => setSearchType(v)}
            sx={{ mb: 2 }}
          >
            {SEARCH_TYPES.map((st) => (
              <Tab
                key={st.type}
                value={st.type}
                label={st.label}
                icon={<st.icon fontSize="small" />}
                iconPosition="start"
              />
            ))}
          </Tabs>

          {/* Search Input */}
          <SearchInput
            fullWidth
            placeholder={
              searchType === 'regex'
                ? 'Enter regex pattern...'
                : searchType === 'boolean'
                ? 'e.g., (revenue AND growth) OR profit'
                : searchType === 'semantic'
                ? 'Describe what you\'re looking for...'
                : 'Search documents...'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            inputProps={{ 'aria-label': 'Search query' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  {query && (
                    <IconButton size="small" onClick={handleClearSearch}>
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  )}
                  <IconButton
                    onClick={() => setShowFilters(!showFilters)}
                    color={showFilters ? 'primary' : 'default'}
                  >
                    <FilterIcon />
                  </IconButton>
                  <ActionButton
                    variant="contained"
                    onClick={handleSearch}
                    disabled={!query.trim() || searching}
                    sx={{ ml: 1 }}
                  >
                    {searching ? <CircularProgress size={20} /> : 'Search'}
                  </ActionButton>
                </InputAdornment>
              ),
            }}
          />

          {/* Filters */}
          <Collapse in={showFilters}>
            <Paper sx={{ mt: 2, p: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={4}>
                  <ConnectionSelector
                    value={selectedConnectionId}
                    onChange={setSelectedConnectionId}
                    label="Data Source"
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Document Type</InputLabel>
                    <Select
                      value={filters.documentType || ''}
                      label="Document Type"
                      onChange={(e) => setFilters({ ...filters, documentType: e.target.value })}
                    >
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="pdf">PDF</MenuItem>
                      <MenuItem value="docx">Word</MenuItem>
                      <MenuItem value="xlsx">Excel</MenuItem>
                      <MenuItem value="txt">Text</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Date From"
                    type="date"
                    InputLabelProps={{ shrink: true }}
                    value={filters.dateFrom || ''}
                    onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Date To"
                    type="date"
                    InputLabelProps={{ shrink: true }}
                    value={filters.dateTo || ''}
                    onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                  />
                </Grid>
              </Grid>
            </Paper>
          </Collapse>
        </Box>
      </SearchHeader>

      <ContentArea>
        {/* Results */}
        <MainPanel>
          {results.length > 0 ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="subtitle1">
                  {totalResults} results found
                </Typography>
                <ActionButton
                  size="small"
                  startIcon={<SaveIcon />}
                  onClick={() => setSaveDialogOpen(true)}
                >
                  Save Search
                </ActionButton>
              </Box>

              {results.map((result, index) => (
                <ResultCard key={result.id || index} variant="outlined">
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                    <DocIcon color="inherit" />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {result.title || result.filename || 'Untitled'}
                      </Typography>
                      {result.highlight && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.5 }}
                          dangerouslySetInnerHTML={{ __html: sanitizeHighlight(result.highlight) }}
                        />
                      )}
                      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        {result.score && (
                          <Chip size="small" label={`Score: ${(result.score * 100).toFixed(0)}%`} />
                        )}
                        {result.type && (
                          <Chip size="small" label={result.type.toUpperCase()} variant="outlined" />
                        )}
                      </Box>
                    </Box>
                  </Box>
                </ResultCard>
              ))}
            </>
          ) : !searching ? (
            <Box
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                maxWidth: 500,
                mx: 'auto',
              }}
            >
              <SearchIcon sx={{ fontSize: 64, color: 'text.secondary', opacity: 0.3, mb: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                Search Your Documents
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Find what you need across all your documents using different search modes.
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%', maxWidth: 300 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'left', mb: 0.5 }}>
                  Try these example searches:
                </Typography>
                {[
                  { query: 'quarterly revenue', type: 'fulltext', label: 'Full Text' },
                  { query: 'documents about marketing strategy', type: 'semantic', label: 'Semantic' },
                  { query: '(budget AND 2024) OR forecast', type: 'boolean', label: 'Boolean' },
                ].map((example) => (
                  <Button
                    key={example.query}
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setQuery(example.query)
                      setSearchType(example.type)
                    }}
                    sx={{ justifyContent: 'flex-start', textTransform: 'none', textAlign: 'left' }}
                  >
                    <Chip size="small" label={example.label} sx={{ mr: 1, pointerEvents: 'none' }} />
                    <Typography variant="body2" noWrap>{example.query}</Typography>
                  </Button>
                ))}
              </Box>
            </Box>
          ) : null}
        </MainPanel>

        {/* Sidebar */}
        <Sidebar>
          {/* Saved Searches */}
          <FacetSection>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Saved Searches
              </Typography>
              <SavedIcon fontSize="small" color="action" />
            </Box>
            <List dense>
              {savedSearches.slice(0, 5).map((saved) => (
                <ListItem
                  key={saved.id}
                  button
                  onClick={() => handleRunSavedSearch(saved)}
                  sx={{ borderRadius: 1 }}
                >
                  <ListItemText
                    primary={saved.name}
                    secondary={saved.query}
                    primaryTypographyProps={{ variant: 'body2' }}
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                </ListItem>
              ))}
              {savedSearches.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  No saved searches
                </Typography>
              )}
            </List>
          </FacetSection>

          {/* Recent Searches */}
          <FacetSection>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Recent Searches
              </Typography>
              <HistoryIcon fontSize="small" color="action" />
            </Box>
            <List dense>
              {searchHistory.slice(0, 5).map((item, index) => (
                <ListItem
                  key={index}
                  button
                  onClick={() => {
                    setQuery(item.query)
                    handleSearch(item.query)
                  }}
                  sx={{ borderRadius: 1 }}
                >
                  <ListItemText
                    primary={item.query}
                    secondary={`${item.resultCount} results`}
                    primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                  />
                </ListItem>
              ))}
              {searchHistory.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                  No recent searches
                </Typography>
              )}
            </List>
          </FacetSection>

          {/* Facets */}
          {Object.keys(facets).length > 0 && (
            <FacetSection>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                Refine Results
              </Typography>
              {Object.entries(facets).map(([facetName, facetValues]) => (
                <Box key={facetName} sx={{ mb: 2 }}>
                  <Typography variant="caption" color="text.secondary">
                    {facetName.replace(/_/g, ' ').toUpperCase()}
                  </Typography>
                  {Object.entries(facetValues).slice(0, 5).map(([value, count]) => (
                    <FormControlLabel
                      key={value}
                      control={<Checkbox size="small" />}
                      label={
                        <Typography variant="body2">
                          {value} ({count})
                        </Typography>
                      }
                    />
                  ))}
                </Box>
              ))}
            </FacetSection>
          )}
        </Sidebar>
      </ContentArea>

      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          {error}
        </Alert>
      )}
    </PageContainer>
  )
}

// === From: enrichment.jsx ===
/**
 * Data Enrichment Configuration Page
 */

// Fallback sources in case API is unavailable
const FALLBACK_SOURCES = [
  { id: 'company', name: 'Company Information', description: 'Enrich with company details (industry, size, revenue)' },
  { id: 'address', name: 'Address Standardization', description: 'Standardize and validate addresses' },
  { id: 'exchange', name: 'Currency Exchange', description: 'Convert currencies to target currency' },
];

const SOURCE_TYPES = [
  { value: 'company_info', label: 'Company Information' },
  { value: 'address', label: 'Address Standardization' },
  { value: 'exchange_rate', label: 'Currency Exchange' },
];

export function EnrichmentConfigPage() {
  const {
    sources,
    customSources,
    cacheStats,
    previewResult,
    enrichmentResult,
    loading,
    error,
    fetchSources,
    createSource,
    deleteSource,
    fetchCacheStats,
    clearCache,
    previewEnrichment,
    enrichData,
    reset,
  } = useEnrichmentStore();
  const { execute } = useInteraction();
  const { registerOutput } = useCrossPageActions(FeatureKey.ENRICHMENT);

  // Cross-page: accept table/dataset for enrichment from Query, Spreadsheets, etc.
  useIncomingTransfer(FeatureKey.ENRICHMENT, {
    [TransferAction.ENRICH]: async (payload) => {
      const rows = payload.data?.rows || payload.data;
      if (Array.isArray(rows)) {
        setParsedData(rows);
        setInputData(JSON.stringify(rows, null, 2));
      }
    },
  });

  const { connections, activeConnectionId } = useSharedData();
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId || '');

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab = tabParam === 'cache' ? 1 : 0;

  const [initialLoading, setInitialLoading] = useState(true);

  const handleTabChange = useCallback((e, newValue) => {
    setSearchParams(newValue === 1 ? { tab: 'cache' } : {}, { replace: true });
  }, [setSearchParams]);

  const [inputData, setInputData] = useState('');
  const [selectedSources, setSelectedSources] = useState([]);
  const [parsedData, setParsedData] = useState(null);

  // Create Source Dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceType, setNewSourceType] = useState('company_info');
  const [newSourceDescription, setNewSourceDescription] = useState('');
  const [newSourceCacheTtl, setNewSourceCacheTtl] = useState(24);

  // Confirmation dialogs
  const [deleteSourceConfirm, setDeleteSourceConfirm] = useState({ open: false, sourceId: null, sourceName: '' });
  const [clearCacheConfirm, setClearCacheConfirm] = useState({ open: false, sourceId: null, sourceName: '' });

  useEffect(() => {
    const init = async () => {
      setInitialLoading(true);
      await Promise.all([fetchSources(), fetchCacheStats()]);
      setInitialLoading(false);
    };
    init();
    return () => reset();
  }, [fetchSources, fetchCacheStats, reset]);

  const handleParseData = useCallback(() => {
    try {
      // Try to parse as JSON array
      const data = JSON.parse(inputData);
      if (Array.isArray(data)) {
        setParsedData(data);
      } else {
        setParsedData([data]);
      }
    } catch (err) {
      // Try to parse as CSV
      const lines = inputData.trim().split('\n');
      if (lines.length > 1) {
        const headers = lines[0].split(',').map(h => h.trim());
        const data = lines.slice(1).map(line => {
          const values = line.split(',');
          const obj = {};
          headers.forEach((h, i) => {
            obj[h] = values[i]?.trim() || '';
          });
          return obj;
        });
        setParsedData(data);
      }
    }
  }, [inputData]);

  const handlePreview = async () => {
    if (!parsedData || selectedSources.length === 0) return;
    await execute({
      type: InteractionType.ANALYZE,
      label: 'Preview enrichment',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        sourceIds: selectedSources,
        action: 'preview_enrichment',
      },
      action: async () => {
        const result = await previewEnrichment(parsedData, selectedSources, 3);
        if (!result) {
          throw new Error('Preview enrichment failed');
        }
        return result;
      },
    });
  };

  const handleEnrich = async () => {
    if (!parsedData || selectedSources.length === 0) return;
    await execute({
      type: InteractionType.GENERATE,
      label: 'Enrich data',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        sourceIds: selectedSources,
        action: 'enrich_data',
      },
      action: async () => {
        const result = await enrichData(parsedData, selectedSources);
        if (!result) {
          throw new Error('Enrichment failed');
        }
        // Register enriched data for cross-page use
        const rows = result.enriched_data || [];
        const columns = rows.length > 0 ? Object.keys(rows[0]).map((k) => ({ name: k })) : [];
        registerOutput({
          type: OutputType.TABLE,
          title: `Enriched Data (${rows.length} rows)`,
          summary: `Enriched with ${selectedSources.length} source(s)`,
          data: { columns, rows },
          format: 'table',
        });
        return result;
      },
    });
  };

  const toggleSource = (sourceId) => {
    setSelectedSources(prev =>
      prev.includes(sourceId)
        ? prev.filter(s => s !== sourceId)
        : [...prev, sourceId]
    );
  };

  const handleCreateSource = async () => {
    if (!newSourceName.trim()) return;

    await execute({
      type: InteractionType.CREATE,
      label: 'Create enrichment source',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        sourceType: newSourceType,
        action: 'create_enrichment_source',
      },
      action: async () => {
        const result = await createSource({
          name: newSourceName,
          type: newSourceType,
          description: newSourceDescription,
          config: {},
          cacheTtlHours: newSourceCacheTtl,
        });

        if (result) {
          setCreateDialogOpen(false);
          setNewSourceName('');
          setNewSourceType('company_info');
          setNewSourceDescription('');
          setNewSourceCacheTtl(24);
        }
        if (!result) {
          throw new Error('Create source failed');
        }
        return result;
      },
    });
  };

  const handleClearCache = async () => {
    await execute({
      type: InteractionType.DELETE,
      label: 'Clear enrichment cache',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        action: 'clear_enrichment_cache',
      },
      action: async () => {
        const result = await clearCache();
        if (result == null) {
          throw new Error('Clear cache failed');
        }
        return result;
      },
    });
  };

  const handleDeleteSourceConfirm = async () => {
    const sourceId = deleteSourceConfirm.sourceId;
    const sourceName = deleteSourceConfirm.sourceName;
    setDeleteSourceConfirm({ open: false, sourceId: null, sourceName: '' });
    if (!sourceId) return;
    await execute({
      type: InteractionType.DELETE,
      label: 'Delete enrichment source',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        sourceId,
        sourceName,
        action: 'delete_enrichment_source',
      },
      action: async () => {
        const result = await deleteSource(sourceId);
        if (!result) {
          throw new Error('Delete source failed');
        }
        return result;
      },
    });
  };

  const handleClearCacheConfirm = async () => {
    const sourceId = clearCacheConfirm.sourceId || null;
    const sourceName = clearCacheConfirm.sourceName;
    setClearCacheConfirm({ open: false, sourceId: null, sourceName: '' });
    await execute({
      type: InteractionType.DELETE,
      label: 'Clear enrichment cache',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        sourceId,
        sourceName,
        action: 'clear_enrichment_cache',
      },
      action: async () => {
        const result = await clearCache(sourceId);
        if (result == null) {
          throw new Error('Clear cache failed');
        }
        return result;
      },
    });
  };

  // Use API sources if available, fallback to static list
  const usingFallbackSources = sources.length === 0 && !initialLoading;
  const availableSources = sources.length > 0 ? sources : FALLBACK_SOURCES;
  const allSources = [...availableSources, ...customSources];

  // Show loading during initial fetch
  if (initialLoading) {
    return (
      <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <EnrichIcon />
          <Typography variant="h5">Data Enrichment</Typography>
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <EnrichIcon /> Data Enrichment
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Enrich your data with external information sources using AI
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Add Custom Source
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => reset()}>
          {error}
        </Alert>
      )}

      <AiUsageNotice
        title="AI enrichment"
        description="Enrichment adds fields to a new output based on the sources you select. Preview before running."
        chips={[
          { label: 'Source: Input data', color: 'info', variant: 'outlined' },
          { label: 'Confidence: Review results', color: 'warning', variant: 'outlined' },
          { label: 'Original data unchanged', color: 'success', variant: 'outlined' },
        ]}
        dense
        sx={{ mb: 2 }}
      />

      {usingFallbackSources && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Using default enrichment sources. Create custom sources below to configure specific enrichment behavior.
        </Alert>
      )}

      <Tabs value={activeTab} onChange={handleTabChange} sx={{ mb: 3 }}>
        <Tab label="Enrich Data" />
        <Tab label="Cache Admin" icon={<CacheIcon />} iconPosition="start" />
      </Tabs>

      {activeTab === 0 && (
        <Grid container spacing={3}>
          {/* Input Section */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={{ p: 3, height: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="h6">
                  Input Data
                </Typography>
                <ImportFromMenu
                  currentFeature={FeatureKey.ENRICHMENT}
                  onImport={(output) => {
                    const rows = output.data?.rows || output.data;
                    if (Array.isArray(rows)) {
                      setParsedData(rows);
                      setInputData(JSON.stringify(rows, null, 2));
                    }
                  }}
                  size="small"
                />
              </Box>
              <ConnectionSelector
                value={selectedConnectionId}
                onChange={setSelectedConnectionId}
                label="Data Source (Optional)"
                size="small"
                showStatus
                sx={{ mb: 2 }}
              />
              {selectedConnectionId && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Data will be pulled from the selected database connection
                </Alert>
              )}
              <TextField
                fullWidth
                multiline
                rows={10}
                placeholder={'Paste JSON array or CSV data:\n\n[\n  {"name": "Acme Corp", "address": "123 Main St"},\n  {"name": "Tech Inc", "address": "456 Oak Ave"}\n]\n\nOr CSV:\nname,address\nAcme Corp,123 Main St\nTech Inc,456 Oak Ave'}
                value={inputData}
                onChange={(e) => setInputData(e.target.value)}
                sx={{ mb: 2, fontFamily: 'monospace' }}
              />
              <Button
                variant="outlined"
                onClick={handleParseData}
                disabled={!inputData.trim()}
              >
                Parse Data
              </Button>

              {parsedData && (
                <Alert severity="success" sx={{ mt: 2 }}>
                  Parsed {parsedData.length} records with columns: {Object.keys(parsedData[0] || {}).join(', ')}
                </Alert>
              )}
            </Paper>
          </Grid>

          {/* Sources Section */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={{ p: 3, height: '100%' }}>
              <Typography variant="h6" gutterBottom>
                Enrichment Sources
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {allSources.map((source) => {
                  const isCustom = customSources.some((cs) => cs.id === source.id)
                  return (
                    <Card
                      key={source.id}
                      variant="outlined"
                      sx={{
                        cursor: 'pointer',
                        borderColor: selectedSources.includes(source.id) ? 'text.secondary' : 'divider',
                        bgcolor: selectedSources.includes(source.id) ? 'action.selected' : 'background.paper',
                      }}
                      onClick={() => toggleSource(source.id)}
                    >
                      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Box>
                            <Typography variant="subtitle1">{source.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {source.description}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {isCustom ? (
                              <Chip label="Custom" size="small" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
                            ) : (
                              <Chip label="Built-in" size="small" variant="outlined" />
                            )}
                            {selectedSources.includes(source.id) && (
                              <Chip label="Selected" size="small" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
                            )}
                            {isCustom && (
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteSourceConfirm({ open: true, sourceId: source.id, sourceName: source.name })
                                }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            )}
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  )
                })}
              </Box>

              <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
                <Button
                  variant="outlined"
                  startIcon={loading ? <CircularProgress size={20} /> : <PreviewIcon />}
                  onClick={handlePreview}
                  disabled={!parsedData || selectedSources.length === 0 || loading}
                >
                  Preview
                </Button>
                <Button
                  variant="contained"
                  startIcon={loading ? <CircularProgress size={20} /> : <RunIcon />}
                  onClick={handleEnrich}
                  disabled={!parsedData || selectedSources.length === 0 || loading}
                >
                  Enrich All
                </Button>
              </Box>
            </Paper>
          </Grid>

          {/* Results Section */}
          {(previewResult || enrichmentResult) && (
            <Grid size={12}>
              <Paper sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="h6">
                    {enrichmentResult ? 'Enrichment Results' : 'Preview Results'}
                  </Typography>
                  {enrichmentResult && (
                    <SendToMenu
                      outputType={OutputType.TABLE}
                      payload={{
                        title: `Enriched Data (${enrichmentResult.enriched_data?.length || 0} rows)`,
                        content: JSON.stringify(enrichmentResult.enriched_data),
                        data: {
                          columns: Object.keys(enrichmentResult.enriched_data?.[0] || {}).map((k) => ({ name: k })),
                          rows: enrichmentResult.enriched_data || [],
                        },
                      }}
                      sourceFeature={FeatureKey.ENRICHMENT}
                    />
                  )}
                </Box>
                <TableContainer sx={{ maxHeight: 400 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        {Object.keys((enrichmentResult?.enriched_data || previewResult?.preview)?.[0] || {}).map((col) => (
                          <TableCell key={col}>{col}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(enrichmentResult?.enriched_data || previewResult?.preview || []).map((row, idx) => (
                        <TableRow key={idx}>
                          {Object.values(row).map((val, cidx) => (
                            <TableCell key={cidx}>
                              {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Grid>
          )}
        </Grid>
      )}

      {activeTab === 1 && (
        <Grid container spacing={3}>
          {/* Cache Stats */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Cache Statistics</Typography>
                <Tooltip title="Refresh cache stats">
                  <IconButton onClick={fetchCacheStats} size="small" aria-label="Refresh cache stats">
                    <RefreshIcon />
                  </IconButton>
                </Tooltip>
              </Box>

              {cacheStats ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box>
                    <Typography variant="body2" color="text.secondary">Total Entries</Typography>
                    <Typography variant="h4">{cacheStats.total_entries || 0}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="body2" color="text.secondary">Hit Rate</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <LinearProgress
                        variant="determinate"
                        value={(cacheStats.hit_rate || 0) * 100}
                        sx={{ flex: 1, height: 10, borderRadius: 1 }}
                      />
                      <Typography variant="body1">
                        {((cacheStats.hit_rate || 0) * 100).toFixed(1)}%
                      </Typography>
                    </Box>
                  </Box>
                  <Box>
                    <Typography variant="body2" color="text.secondary">Cache Hits / Misses</Typography>
                    <Typography variant="body1">
                      {cacheStats.hits || 0} hits / {cacheStats.misses || 0} misses
                    </Typography>
                  </Box>
                  {cacheStats.size_bytes && (
                    <Box>
                      <Typography variant="body2" color="text.secondary">Cache Size</Typography>
                      <Typography variant="body1">
                        {(cacheStats.size_bytes / 1024).toFixed(2)} KB
                      </Typography>
                    </Box>
                  )}
                </Box>
              ) : (
                <Typography color="text.secondary">No cache stats available</Typography>
              )}
            </Paper>
          </Grid>

          {/* Cache Actions */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>Cache Management</Typography>

              <Alert severity="info" sx={{ mb: 3 }}>
                Clearing the cache will remove all cached enrichment results.
                New enrichment requests will fetch fresh data from sources.
              </Alert>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Button
                  variant="outlined"
                  startIcon={loading ? <CircularProgress size={20} /> : <DeleteIcon />}
                  onClick={() => setClearCacheConfirm({ open: true, sourceId: null, sourceName: 'all sources' })}
                  disabled={loading}
                  sx={{ color: 'text.secondary', borderColor: 'divider' }}
                >
                  Clear All Cache
                </Button>

                <Divider sx={{ my: 1 }} />

                <Typography variant="subtitle2" color="text.secondary">
                  Clear cache for specific source:
                </Typography>

                {allSources.map((source) => (
                  <Box key={source.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{source.name}</Typography>
                    <Button
                      size="small"
                      onClick={() => setClearCacheConfirm({ open: true, sourceId: source.id, sourceName: source.name })}
                      disabled={loading}
                    >
                      Clear
                    </Button>
                  </Box>
                ))}
              </Box>
            </Paper>
          </Grid>
        </Grid>
      )}

      {/* Create Source Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Custom Enrichment Source</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Source Name"
            value={newSourceName}
            onChange={(e) => setNewSourceName(e.target.value)}
            sx={{ mt: 2, mb: 2 }}
          />
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Source Type</InputLabel>
            <Select
              value={newSourceType}
              label="Source Type"
              onChange={(e) => setNewSourceType(e.target.value)}
            >
              {SOURCE_TYPES.map((type) => (
                <MenuItem key={type.value} value={type.value}>
                  {type.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            fullWidth
            label="Description"
            value={newSourceDescription}
            onChange={(e) => setNewSourceDescription(e.target.value)}
            multiline
            rows={2}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Cache TTL (hours)"
            type="number"
            value={newSourceCacheTtl}
            onChange={(e) => setNewSourceCacheTtl(parseInt(e.target.value) || 24)}
            inputProps={{ min: 1, max: 720 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateSource}
            disabled={!newSourceName.trim() || loading}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmModal
        open={deleteSourceConfirm.open}
        onClose={() => setDeleteSourceConfirm({ open: false, sourceId: null, sourceName: '' })}
        onConfirm={handleDeleteSourceConfirm}
        title="Delete Source"
        message={`Are you sure you want to delete "${deleteSourceConfirm.sourceName}"? This will remove the source configuration and all associated cache data.`}
        confirmLabel="Delete"
        severity="error"
      />

      <ConfirmModal
        open={clearCacheConfirm.open}
        onClose={() => setClearCacheConfirm({ open: false, sourceId: null, sourceName: '' })}
        onConfirm={handleClearCacheConfirm}
        title="Clear Cache"
        message={`Are you sure you want to clear cache for ${clearCacheConfirm.sourceName}? New enrichment requests will fetch fresh data from the source.`}
        confirmLabel="Clear Cache"
        severity="warning"
      />
    </Box>
  );
}
