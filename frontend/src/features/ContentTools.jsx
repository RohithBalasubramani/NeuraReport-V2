import { uploadDocument } from '@/api/workspace'
import { ActionButton, FullHeightPageContainer as PageContainer } from '@/styles/styles'
import { neutral, palette, primary } from '@/app/theme'
import { ImportFromMenu, useToast } from '@/components/core'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useIncomingTransfer, useSharedData } from '@/hooks/hooks'
import useDesignStore from '@/stores/app'
import { useKnowledgeStore } from '@/stores/workspace'
import { FeatureKey, TransferAction } from '@/utils/helpers'
import {
  Accessibility as A11yIcon,
  AccountTree as GraphIcon,
  Add as AddIcon,
  AutoAwesome as AIIcon,
  Brush as BrushIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  CloudUpload as UploadIcon,
  ContentCopy as CopyIcon,
  Contrast as ContrastIcon,
  DarkMode as DarkModeIcon,
  Delete as DeleteIcon,
  Description as DocIcon,
  Download as DownloadIcon,
  Edit as EditIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  FileDownload as ExportIcon,
  FileUpload as ImportIcon,
  FilterList as FilterIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  FormatColorFill as ColorIcon,
  LightMode as LightModeIcon,
  LocalOffer as TagIcon,
  MoreVert as MoreIcon,
  Palette as PaletteIcon,
  QuestionAnswer as FaqIcon,
  Search as SearchIcon,
  Star as DefaultIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  TextFields as FontIcon,
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
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemIcon,
  ListItemSecondaryAction,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import React, { useCallback, useEffect, useRef, useState } from 'react'
const Header = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2, 3),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
}))

const ContentArea = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(3),
  overflow: 'auto',
}))

const BrandKitCard = styled(Card)(({ theme, isDefault }) => ({
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  border: isDefault
    ? `2px solid ${theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}`
    : `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: `0 8px 24px ${alpha(theme.palette.text.primary, 0.15)}`,
  },
}))

const ColorSwatch = styled(Box)(({ color: bgColor, size = 40 }) => ({
  width: size,
  height: size,
  borderRadius: 8,
  backgroundColor: bgColor,
  border: '2px solid rgba(0,0,0,0.1)',
  cursor: 'pointer',
  transition: 'transform 0.2s',
  flexShrink: 0,
  '&:hover': {
    transform: 'scale(1.1)',
  },
}))

const ThemeCard = styled(Paper)(({ theme, isActive }) => ({
  padding: theme.spacing(2),
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  border: isActive
    ? `2px solid ${theme.palette.mode === 'dark' ? neutral[500] : neutral[700]}`
    : `1px solid ${alpha(theme.palette.divider, 0.2)}`,
  '&:hover': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? alpha(theme.palette.text.primary, 0.05)
        : neutral[50],
  },
}))

const ContrastBar = styled(Box)(({ ratio }) => {
  const pct = Math.min((ratio / 21) * 100, 100)
  const hue = ratio >= 7 ? 120 : ratio >= 4.5 ? 60 : 0
  return {
    height: 8,
    borderRadius: 4,
    background: `linear-gradient(90deg, hsl(${hue},70%,50%) ${pct}%, transparent ${pct}%)`,
    backgroundColor: 'rgba(0,0,0,0.08)',
    width: '100%',
  }
})

const FontSample = styled(Typography)(({ fontFamily }) => ({
  fontFamily: `"${fontFamily}", sans-serif`,
  lineHeight: 1.4,
}))


const COLOR_SCHEMES = [
  { name: 'Complementary', value: 'complementary', desc: 'Opposite on the color wheel' },
  { name: 'Analogous', value: 'analogous', desc: 'Adjacent colors' },
  { name: 'Triadic', value: 'triadic', desc: 'Three equally spaced' },
  { name: 'Split-Comp.', value: 'split-complementary', desc: 'Complementary with neighbors' },
  { name: 'Tetradic', value: 'tetradic', desc: 'Four colors in rectangle' },
]

const EMPTY_KIT_FORM = {
  name: '',
  description: '',
  primary_color: '#1976d2',
  secondary_color: '#dc004e',
  accent_color: '#ff9800',
  text_color: '#333333',
  background_color: '#ffffff',
  font_family: 'Inter',
  heading_font: '',
  body_font: '',
}

const EMPTY_THEME_FORM = {
  name: '',
  description: '',
  mode: 'light',
  primary: '#1976d2',
  secondary: '#dc004e',
  background: '#ffffff',
  surface: '#f5f5f5',
  text: '#333333',
}


export function DesignPageContainer() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const { templates } = useSharedData()
  const importRef = useRef(null)
  const {
    brandKits,
    themes,
    fonts,
    loading,
    error,
    fetchBrandKits,
    fetchThemes,
    fetchFonts,
    createBrandKit,
    updateBrandKit,
    deleteBrandKit,
    setDefaultBrandKit,
    createTheme,
    deleteTheme,
    setActiveTheme,
    generateColorPalette,
    getColorContrast,
    suggestAccessibleColors,
    getFontPairings,
    exportBrandKit,
    importBrandKit,
    reset,
  } = useDesignStore()

  // --- Tab state ---
  const [activeTab, setActiveTab] = useState(0) // 0: Brand Kits, 1: Themes, 2: Color Tools, 3: Typography

  // --- Brand Kit dialog state ---
  const [kitDialogOpen, setKitDialogOpen] = useState(false)
  const [kitDialogMode, setKitDialogMode] = useState('create') // 'create' | 'edit'
  const [editingKitId, setEditingKitId] = useState(null)
  const [kitForm, setKitForm] = useState({ ...EMPTY_KIT_FORM })
  const [kitFormExpanded, setKitFormExpanded] = useState(false)

  // --- Theme dialog state ---
  const [themeDialogOpen, setThemeDialogOpen] = useState(false)
  const [themeForm, setThemeForm] = useState({ ...EMPTY_THEME_FORM })

  // --- Color tools state ---
  const [baseColor, setBaseColor] = useState(primary[500])
  const [colorScheme, setColorScheme] = useState('complementary')
  const [generatedPalette, setGeneratedPalette] = useState(null)
  const [contrastFg, setContrastFg] = useState('#000000')
  const [contrastBg, setContrastBg] = useState('#ffffff')
  const [contrastResult, setContrastResult] = useState(null)
  const [a11yBg, setA11yBg] = useState('#1976d2')
  const [a11ySuggestions, setA11ySuggestions] = useState(null)

  // --- Typography state ---
  const [selectedFont, setSelectedFont] = useState('')
  const [fontPairings, setFontPairings] = useState(null)
  const [fontFilter, setFontFilter] = useState('')

  useEffect(() => {
    fetchBrandKits()
    fetchThemes()
    fetchFonts()
    return () => reset()
  }, [fetchBrandKits, fetchFonts, fetchThemes, reset])

  // =========================================================================
  // BRAND KIT HANDLERS
  // =========================================================================

  const openCreateKit = () => {
    setKitDialogMode('create')
    setEditingKitId(null)
    setKitForm({ ...EMPTY_KIT_FORM })
    setKitFormExpanded(false)
    setKitDialogOpen(true)
  }

  const openEditKit = (kit) => {
    setKitDialogMode('edit')
    setEditingKitId(kit.id)
    setKitForm({
      name: kit.name || '',
      description: kit.description || '',
      primary_color: kit.primary_color || '#1976d2',
      secondary_color: kit.secondary_color || '#dc004e',
      accent_color: kit.accent_color || '#ff9800',
      text_color: kit.text_color || '#333333',
      background_color: kit.background_color || '#ffffff',
      font_family: kit.typography?.font_family || 'Inter',
      heading_font: kit.typography?.heading_font || '',
      body_font: kit.typography?.body_font || '',
    })
    setKitFormExpanded(true)
    setKitDialogOpen(true)
  }

  const handleSaveKit = useCallback(async () => {
    if (!kitForm.name.trim()) return

    const payload = {
      name: kitForm.name,
      description: kitForm.description || undefined,
      primary_color: kitForm.primary_color,
      secondary_color: kitForm.secondary_color,
      accent_color: kitForm.accent_color,
      text_color: kitForm.text_color,
      background_color: kitForm.background_color,
      typography: {
        font_family: kitForm.font_family || 'Inter',
        heading_font: kitForm.heading_font || undefined,
        body_font: kitForm.body_font || undefined,
      },
    }

    const isEdit = kitDialogMode === 'edit'
    return execute({
      type: isEdit ? InteractionType.UPDATE : InteractionType.CREATE,
      label: isEdit ? 'Update brand kit' : 'Create brand kit',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'design', name: kitForm.name },
      action: async () => {
        if (isEdit) {
          await updateBrandKit(editingKitId, payload)
          toast.show('Brand kit updated', 'success')
        } else {
          await createBrandKit(payload)
          toast.show('Brand kit created', 'success')
        }
        setKitDialogOpen(false)
      },
    })
  }, [kitForm, kitDialogMode, editingKitId, createBrandKit, updateBrandKit, execute, toast])

  const handleDeleteKit = useCallback(
    async (kitId) => {
      return execute({
        type: InteractionType.DELETE,
        label: 'Delete brand kit',
        reversibility: Reversibility.SYSTEM_MANAGED,
        intent: { source: 'design', brandKitId: kitId },
        action: async () => {
          await deleteBrandKit(kitId)
          toast.show('Brand kit deleted', 'success')
        },
      })
    },
    [deleteBrandKit, execute, toast],
  )

  const handleSetDefault = useCallback(
    async (kitId) => {
      return execute({
        type: InteractionType.UPDATE,
        label: 'Set default brand kit',
        reversibility: Reversibility.FULLY_REVERSIBLE,
        intent: { source: 'design', brandKitId: kitId },
        action: async () => {
          await setDefaultBrandKit(kitId)
          toast.show('Default brand kit updated', 'success')
        },
      })
    },
    [execute, setDefaultBrandKit, toast],
  )

  const handleExportKit = useCallback(
    async (kitId) => {
      const data = await exportBrandKit(kitId)
      if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `brand-kit-${kitId}.json`
        a.click()
        URL.revokeObjectURL(url)
        toast.show('Brand kit exported', 'success')
      }
    },
    [exportBrandKit, toast],
  )

  const handleImportKit = useCallback(
    async (evt) => {
      const file = evt.target.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        // The exported format wraps the kit in { brand_kit: {...} }
        const kitData = data.brand_kit || data
        await execute({
          type: InteractionType.CREATE,
          label: 'Import brand kit',
          reversibility: Reversibility.SYSTEM_MANAGED,
          intent: { source: 'design', action: 'import' },
          action: async () => {
            await importBrandKit(kitData)
            toast.show('Brand kit imported', 'success')
          },
        })
      } catch {
        toast.show('Invalid brand kit file', 'error')
      }
      // Reset file input
      evt.target.value = ''
    },
    [execute, importBrandKit, toast],
  )

  // =========================================================================
  // THEME HANDLERS
  // =========================================================================

  const openCreateTheme = () => {
    setThemeForm({ ...EMPTY_THEME_FORM })
    setThemeDialogOpen(true)
  }

  const handleSaveTheme = useCallback(async () => {
    if (!themeForm.name.trim()) return

    return execute({
      type: InteractionType.CREATE,
      label: 'Create theme',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'design', name: themeForm.name },
      action: async () => {
        await createTheme({
          name: themeForm.name,
          description: themeForm.description || undefined,
          mode: themeForm.mode,
          colors: {
            primary: themeForm.primary,
            secondary: themeForm.secondary,
            background: themeForm.background,
            surface: themeForm.surface,
            text: themeForm.text,
          },
        })
        toast.show('Theme created', 'success')
        setThemeDialogOpen(false)
      },
    })
  }, [createTheme, execute, themeForm, toast])

  const handleDeleteTheme = useCallback(
    async (themeId) => {
      return execute({
        type: InteractionType.DELETE,
        label: 'Delete theme',
        reversibility: Reversibility.SYSTEM_MANAGED,
        intent: { source: 'design', themeId },
        action: async () => {
          await deleteTheme(themeId)
          toast.show('Theme deleted', 'success')
        },
      })
    },
    [deleteTheme, execute, toast],
  )

  const handleActivateTheme = useCallback(
    async (themeId) => {
      return execute({
        type: InteractionType.UPDATE,
        label: 'Activate theme',
        reversibility: Reversibility.FULLY_REVERSIBLE,
        intent: { source: 'design', themeId },
        action: async () => {
          await setActiveTheme(themeId)
          toast.show('Theme activated', 'success')
        },
      })
    },
    [execute, setActiveTheme, toast],
  )

  // =========================================================================
  // COLOR TOOL HANDLERS
  // =========================================================================

  const handleGeneratePalette = useCallback(async () => {
    return execute({
      type: InteractionType.GENERATE,
      label: 'Generate color palette',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: { source: 'design', baseColor, colorScheme, action: 'generate_palette' },
      action: async () => {
        const palette = await generateColorPalette(baseColor, colorScheme)
        if (palette) {
          setGeneratedPalette(palette)
          toast.show('Palette generated', 'success')
        }
        return palette
      },
    })
  }, [baseColor, colorScheme, generateColorPalette, toast, execute])

  const handleCheckContrast = useCallback(async () => {
    const result = await getColorContrast(contrastFg, contrastBg)
    if (result) setContrastResult(result)
  }, [contrastFg, contrastBg, getColorContrast])

  const handleSuggestA11y = useCallback(async () => {
    const result = await suggestAccessibleColors(a11yBg)
    if (result) setA11ySuggestions(result)
  }, [a11yBg, suggestAccessibleColors])

  // =========================================================================
  // TYPOGRAPHY HANDLERS
  // =========================================================================

  const handleGetPairings = useCallback(
    async (fontName) => {
      setSelectedFont(fontName)
      const result = await getFontPairings(fontName)
      if (result) setFontPairings(result)
    },
    [getFontPairings],
  )

  const handleCopyColor = (color) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(color)
    } else {
      const ta = Object.assign(document.createElement('textarea'), { value: color, style: 'position:fixed;opacity:0' })
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
    }
    toast.show(`Copied ${color}`, 'success')
  }

  const filteredFonts = fonts.filter(
    (f) =>
      !fontFilter ||
      f.name.toLowerCase().includes(fontFilter.toLowerCase()) ||
      f.category.toLowerCase().includes(fontFilter.toLowerCase()),
  )

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <PageContainer>
      <Header>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <PaletteIcon sx={{ color: 'text.secondary', fontSize: 28 }} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Brand Kit
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Colors, fonts, themes & accessibility tools
              </Typography>
            </Box>
          </Box>
          <Stack direction="row" spacing={1}>
            {activeTab === 0 && (
              <>
                <input
                  type="file"
                  ref={importRef}
                  accept=".json"
                  onChange={handleImportKit}
                  style={{ display: 'none' }}
                />
                <ActionButton
                  variant="outlined"
                  size="small"
                  startIcon={<ImportIcon />}
                  onClick={() => importRef.current?.click()}
                >
                  Import
                </ActionButton>
                <ActionButton
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={openCreateKit}
                  data-testid="design-create-button"
                >
                  New Brand Kit
                </ActionButton>
              </>
            )}
            {activeTab === 1 && (
              <ActionButton
                variant="contained"
                startIcon={<AddIcon />}
                onClick={openCreateTheme}
                data-testid="design-create-theme-button"
              >
                New Theme
              </ActionButton>
            )}
          </Stack>
        </Box>
      </Header>

      <ContentArea>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={{ mb: 3 }}
          data-testid="design-tabs"
        >
          <Tab
            icon={<BrushIcon />}
            label="Brand Kits"
            iconPosition="start"
            data-testid="design-tab-brand-kits"
          />
          <Tab
            icon={<ColorIcon />}
            label="Themes"
            iconPosition="start"
            data-testid="design-tab-themes"
          />
          <Tab
            icon={<PaletteIcon />}
            label="Color Tools"
            iconPosition="start"
            data-testid="design-tab-color-tools"
          />
          <Tab
            icon={<FontIcon />}
            label="Typography"
            iconPosition="start"
            data-testid="design-tab-typography"
          />
        </Tabs>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => {}}>
            {error}
          </Alert>
        )}

        {/* =============================================================== */}
        {/* BRAND KITS TAB                                                  */}
        {/* =============================================================== */}
        {activeTab === 0 && (
          <Grid container spacing={3}>
            {brandKits.map((kit) => (
              <Grid item xs={12} sm={6} md={4} key={kit.id}>
                <BrandKitCard
                  isDefault={kit.is_default}
                  data-testid={`brand-kit-card-${kit.id}`}
                >
                  <CardContent>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        mb: 1,
                      }}
                    >
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {kit.name}
                      </Typography>
                      {kit.is_default && (
                        <Chip
                          size="small"
                          label="Default"
                          icon={<DefaultIcon />}
                          sx={{
                            bgcolor:
                              theme.palette.mode === 'dark'
                                ? alpha(theme.palette.text.primary, 0.1)
                                : neutral[200],
                            color: 'text.secondary',
                          }}
                        />
                      )}
                    </Box>

                    {kit.description && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {kit.description}
                      </Typography>
                    )}

                    {/* Color strip */}
                    <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
                      {[
                        kit.primary_color,
                        kit.secondary_color,
                        kit.accent_color,
                        kit.text_color,
                        kit.background_color,
                      ]
                        .filter(Boolean)
                        .map((c, i) => (
                          <Tooltip key={i} title={c} arrow>
                            <ColorSwatch
                              color={c}
                              size={28}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleCopyColor(c)
                              }}
                            />
                          </Tooltip>
                        ))}
                      {kit.colors?.slice(0, 3).map((c, i) => (
                        <Tooltip key={`extra-${i}`} title={`${c.name}: ${c.hex}`} arrow>
                          <ColorSwatch
                            color={c.hex}
                            size={28}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopyColor(c.hex)
                            }}
                          />
                        </Tooltip>
                      ))}
                    </Box>

                    {/* Live mini preview */}
                    <Box
                      sx={{
                        mt: 1,
                        p: 1.5,
                        borderRadius: 1,
                        border: '1px solid rgba(0,0,0,0.08)',
                        backgroundColor: kit.background_color || '#ffffff',
                        overflow: 'hidden',
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          fontFamily: `"${kit.typography?.heading_font || kit.typography?.font_family || 'Inter'}", sans-serif`,
                          fontWeight: 700,
                          color: kit.text_color || '#333',
                          display: 'block',
                          fontSize: 11,
                          mb: 0.5,
                        }}
                      >
                        Report Title Preview
                      </Typography>
                      <Box
                        sx={{
                          display: 'flex',
                          gap: 0,
                          borderRadius: 0.5,
                          overflow: 'hidden',
                          mb: 0.5,
                        }}
                      >
                        <Box sx={{ flex: 1, height: 16, backgroundColor: kit.primary_color, display: 'flex', alignItems: 'center', px: 0.5 }}>
                          <Typography sx={{ fontSize: 7, color: '#fff', fontWeight: 600 }}>Header</Typography>
                        </Box>
                        <Box sx={{ flex: 1, height: 16, backgroundColor: kit.secondary_color, display: 'flex', alignItems: 'center', px: 0.5 }}>
                          <Typography sx={{ fontSize: 7, color: '#fff', fontWeight: 600 }}>Column</Typography>
                        </Box>
                        <Box sx={{ flex: 1, height: 16, backgroundColor: kit.accent_color, display: 'flex', alignItems: 'center', px: 0.5 }}>
                          <Typography sx={{ fontSize: 7, color: '#fff', fontWeight: 600 }}>Accent</Typography>
                        </Box>
                      </Box>
                      <Typography
                        variant="caption"
                        sx={{
                          fontFamily: `"${kit.typography?.body_font || kit.typography?.font_family || 'Inter'}", sans-serif`,
                          color: alpha(kit.text_color || '#333', 0.7),
                          fontSize: 9,
                          lineHeight: 1.3,
                        }}
                      >
                        Body text sample in {kit.typography?.font_family || 'Inter'}
                      </Typography>
                    </Box>

                    {/* Font info */}
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      <FontIcon
                        fontSize="inherit"
                        sx={{ mr: 0.5, verticalAlign: 'middle' }}
                      />
                      {kit.typography?.font_family || 'Inter'}
                      {kit.typography?.heading_font &&
                        ` / ${kit.typography.heading_font}`}
                    </Typography>
                  </CardContent>
                  <CardActions sx={{ px: 2, pb: 1.5 }}>
                    {!kit.is_default && (
                      <Button
                        size="small"
                        onClick={() => handleSetDefault(kit.id)}
                        data-testid="set-default-brand-kit"
                      >
                        Set Default
                      </Button>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Tooltip title="Export">
                      <IconButton
                        size="small"
                        onClick={() => handleExportKit(kit.id)}
                      >
                        <ExportIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => openEditKit(kit)}
                        data-testid="edit-brand-kit"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteKit(kit.id)}
                        data-testid="delete-brand-kit"
                        aria-label="Delete brand kit"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </CardActions>
                </BrandKitCard>
              </Grid>
            ))}

            {brandKits.length === 0 && !loading && (
              <Grid item xs={12}>
                <Box sx={{ textAlign: 'center', py: 8 }}>
                  <BrushIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                  <Typography variant="h6" color="text.secondary">
                    No brand kits yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Create a brand kit to define your colors, fonts, and visual identity
                  </Typography>
                  <ActionButton variant="contained" startIcon={<AddIcon />} onClick={openCreateKit}>
                    Create Brand Kit
                  </ActionButton>
                </Box>
              </Grid>
            )}
          </Grid>
        )}

        {/* =============================================================== */}
        {/* THEMES TAB                                                      */}
        {/* =============================================================== */}
        {activeTab === 1 && (
          <Grid container spacing={2}>
            {themes.map((t) => (
              <Grid item xs={12} sm={6} md={4} key={t.id}>
                <ThemeCard isActive={t.is_active} data-testid={`theme-card-${t.id}`}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      mb: 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {t.mode === 'dark' ? (
                        <DarkModeIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      ) : (
                        <LightModeIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      )}
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {t.name}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {t.is_active && (
                        <Chip size="small" label="Active" icon={<CheckIcon />} color="default" />
                      )}
                    </Stack>
                  </Box>

                  {t.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      {t.description}
                    </Typography>
                  )}

                  <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
                    {Object.entries(t.colors || {}).map(([name, hex]) => (
                      <Tooltip key={name} title={`${name}: ${hex}`} arrow>
                        <ColorSwatch
                          color={hex}
                          size={28}
                          onClick={() => handleCopyColor(hex)}
                        />
                      </Tooltip>
                    ))}
                    {(!t.colors || Object.keys(t.colors).length === 0) && (
                      <Typography variant="caption" color="text.disabled">
                        No colors defined
                      </Typography>
                    )}
                  </Box>

                  <Chip
                    label={t.mode || 'light'}
                    size="small"
                    variant="outlined"
                    sx={{ mb: 1.5 }}
                  />

                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 0.5 }}>
                    {!t.is_active ? (
                      <Button size="small" onClick={() => handleActivateTheme(t.id)} data-testid="activate-theme">
                        Activate
                      </Button>
                    ) : (
                      <Box />
                    )}
                    <IconButton
                      size="small"
                      onClick={() => handleDeleteTheme(t.id)}
                      data-testid="delete-theme"
                      aria-label="Delete theme"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </ThemeCard>
              </Grid>
            ))}

            {themes.length === 0 && !loading && (
              <Grid item xs={12}>
                <Box sx={{ textAlign: 'center', py: 8 }}>
                  <ColorIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                  <Typography variant="h6" color="text.secondary">
                    No themes yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Create themes to switch between visual styles for your reports
                  </Typography>
                  <ActionButton variant="contained" startIcon={<AddIcon />} onClick={openCreateTheme}>
                    Create Theme
                  </ActionButton>
                </Box>
              </Grid>
            )}
          </Grid>
        )}

        {/* =============================================================== */}
        {/* COLOR TOOLS TAB                                                 */}
        {/* =============================================================== */}
        {activeTab === 2 && (
          <Grid container spacing={3}>
            {/* --- Palette Generator --- */}
            <Grid item xs={12}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                Palette Generator
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <TextField
                  fullWidth
                  label="Base Color"
                  type="color"
                  value={baseColor}
                  onChange={(e) => setBaseColor(e.target.value)}
                  sx={{ mb: 2 }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                          {baseColor}
                        </Typography>
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  fullWidth
                  select
                  label="Harmony"
                  value={colorScheme}
                  onChange={(e) => setColorScheme(e.target.value)}
                  sx={{ mb: 2 }}
                  SelectProps={{ native: false }}
                >
                  {COLOR_SCHEMES.map((s) => (
                    <MenuItem key={s.value} value={s.value}>
                      <Box>
                        <Typography variant="body2">{s.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {s.desc}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </TextField>
                <ActionButton
                  variant="contained"
                  fullWidth
                  onClick={handleGeneratePalette}
                  disabled={loading}
                  data-testid="generate-palette-button"
                >
                  Generate Palette
                </ActionButton>
              </Paper>
            </Grid>
            <Grid item xs={12} md={8}>
              {generatedPalette ? (
                <Paper sx={{ p: 3 }}>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    {colorScheme.charAt(0).toUpperCase() + colorScheme.slice(1)} palette from{' '}
                    <code>{generatedPalette.base_color}</code>
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    {generatedPalette.colors?.map((color, index) => {
                      const hex = typeof color === 'string' ? color : color.hex
                      const name = typeof color === 'string' ? `Color ${index + 1}` : color.name
                      return (
                        <Box key={index} sx={{ textAlign: 'center' }}>
                          <ColorSwatch
                            color={hex}
                            size={60}
                            onClick={() => handleCopyColor(hex)}
                            data-testid={`generated-color-${index}`}
                          />
                          <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', mt: 0.5 }}>
                            {hex}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {name}
                          </Typography>
                        </Box>
                      )
                    })}
                  </Box>
                </Paper>
              ) : (
                <Paper
                  sx={{
                    height: 200,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px dashed ${alpha(theme.palette.divider, 0.3)}`,
                    backgroundColor: 'transparent',
                  }}
                  elevation={0}
                >
                  <Typography color="text.secondary">
                    Choose a base color and harmony type, then generate
                  </Typography>
                </Paper>
              )}
            </Grid>

            {/* --- Contrast Checker --- */}
            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 2, mb: 2 }}>
                WCAG Contrast Checker
              </Typography>
            </Grid>
            <Grid item xs={12} md={5}>
              <Paper sx={{ p: 3 }}>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      type="color"
                      label="Foreground"
                      value={contrastFg}
                      onChange={(e) => setContrastFg(e.target.value)}
                    />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {contrastFg}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      type="color"
                      label="Background"
                      value={contrastBg}
                      onChange={(e) => setContrastBg(e.target.value)}
                    />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {contrastBg}
                    </Typography>
                  </Grid>
                </Grid>
                <ActionButton
                  variant="contained"
                  fullWidth
                  sx={{ mt: 2 }}
                  onClick={handleCheckContrast}
                  disabled={loading}
                  data-testid="check-contrast-button"
                >
                  Check Contrast
                </ActionButton>
              </Paper>
            </Grid>
            <Grid item xs={12} md={7}>
              {contrastResult ? (
                <Paper sx={{ p: 3 }}>
                  {/* Preview */}
                  <Box
                    sx={{
                      backgroundColor: contrastResult.color2,
                      color: contrastResult.color1,
                      p: 3,
                      borderRadius: 2,
                      mb: 2,
                      textAlign: 'center',
                    }}
                  >
                    <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
                      Sample Text
                    </Typography>
                    <Typography variant="body2">
                      The quick brown fox jumps over the lazy dog
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
                    <Typography variant="h4" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
                      {contrastResult.contrast_ratio}:1
                    </Typography>
                    <ContrastBar ratio={contrastResult.contrast_ratio} />
                  </Box>

                  <Grid container spacing={1}>
                    {[
                      { label: 'AA Normal (4.5:1)', pass: contrastResult.wcag_aa_normal },
                      { label: 'AA Large (3:1)', pass: contrastResult.wcag_aa_large },
                      { label: 'AAA Normal (7:1)', pass: contrastResult.wcag_aaa_normal },
                      { label: 'AAA Large (4.5:1)', pass: contrastResult.wcag_aaa_large },
                    ].map(({ label, pass }) => (
                      <Grid item xs={6} key={label}>
                        <Chip
                          label={label}
                          size="small"
                          icon={pass ? <CheckIcon /> : <CloseIcon />}
                          color={pass ? 'success' : 'default'}
                          variant={pass ? 'filled' : 'outlined'}
                          sx={{ width: '100%', justifyContent: 'flex-start' }}
                        />
                      </Grid>
                    ))}
                  </Grid>
                </Paper>
              ) : (
                <Paper
                  sx={{
                    height: 200,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px dashed ${alpha(theme.palette.divider, 0.3)}`,
                    backgroundColor: 'transparent',
                  }}
                  elevation={0}
                >
                  <Typography color="text.secondary">
                    Pick two colors and check their WCAG contrast ratio
                  </Typography>
                </Paper>
              )}
            </Grid>

            {/* --- Accessible Color Suggestions --- */}
            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 2, mb: 2 }}>
                Accessible Color Finder
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 3 }}>
                <TextField
                  fullWidth
                  type="color"
                  label="Background Color"
                  value={a11yBg}
                  onChange={(e) => setA11yBg(e.target.value)}
                  sx={{ mb: 1 }}
                />
                <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block', mb: 2 }}>
                  {a11yBg}
                </Typography>
                <ActionButton
                  variant="contained"
                  fullWidth
                  onClick={handleSuggestA11y}
                  disabled={loading}
                  data-testid="suggest-a11y-button"
                  startIcon={<A11yIcon />}
                >
                  Find Accessible Text Colors
                </ActionButton>
              </Paper>
            </Grid>
            <Grid item xs={12} md={8}>
              {a11ySuggestions ? (
                <Paper sx={{ p: 3 }}>
                  <Typography variant="subtitle2" sx={{ mb: 2 }}>
                    Text colors that pass WCAG AA on{' '}
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        backgroundColor: a11ySuggestions.background_color,
                        border: '1px solid rgba(0,0,0,0.2)',
                        verticalAlign: 'middle',
                        mr: 0.5,
                      }}
                    />
                    <code>{a11ySuggestions.background_color}</code>
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                    {a11ySuggestions.colors?.map((s, i) => (
                      <Tooltip
                        key={i}
                        title={`${s.label} — ${s.contrast_ratio}:1`}
                        arrow
                      >
                        <Box
                          sx={{ textAlign: 'center', cursor: 'pointer' }}
                          onClick={() => handleCopyColor(s.hex)}
                        >
                          <Box
                            sx={{
                              width: 56,
                              height: 56,
                              borderRadius: 2,
                              backgroundColor: a11ySuggestions.background_color,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              border: '1px solid rgba(0,0,0,0.1)',
                              mb: 0.5,
                            }}
                          >
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 700, color: s.hex }}
                            >
                              Aa
                            </Typography>
                          </Box>
                          <Typography
                            variant="caption"
                            display="block"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {s.hex}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {s.contrast_ratio}:1
                          </Typography>
                        </Box>
                      </Tooltip>
                    ))}
                    {a11ySuggestions.colors?.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        No strongly accessible text colors found for this background.
                      </Typography>
                    )}
                  </Box>
                </Paper>
              ) : (
                <Paper
                  sx={{
                    height: 160,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px dashed ${alpha(theme.palette.divider, 0.3)}`,
                    backgroundColor: 'transparent',
                  }}
                  elevation={0}
                >
                  <Typography color="text.secondary">
                    Pick a background color to find accessible text colors
                  </Typography>
                </Paper>
              )}
            </Grid>
          </Grid>
        )}

        {/* =============================================================== */}
        {/* TYPOGRAPHY TAB                                                  */}
        {/* =============================================================== */}
        {activeTab === 3 && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={5}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                  Font Library
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search fonts..."
                  value={fontFilter}
                  onChange={(e) => setFontFilter(e.target.value)}
                  sx={{ mb: 2 }}
                />
                <Box sx={{ maxHeight: 480, overflow: 'auto' }}>
                  {filteredFonts.map((f) => (
                    <Box
                      key={f.name}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        py: 1,
                        px: 1.5,
                        borderRadius: 1,
                        cursor: 'pointer',
                        backgroundColor:
                          selectedFont === f.name
                            ? alpha(theme.palette.primary.main, 0.08)
                            : 'transparent',
                        '&:hover': {
                          backgroundColor: alpha(theme.palette.primary.main, 0.04),
                        },
                      }}
                      onClick={() => handleGetPairings(f.name)}
                    >
                      <Box>
                        <FontSample variant="body1" fontFamily={f.name} sx={{ fontWeight: 600 }}>
                          {f.name}
                        </FontSample>
                        <Typography variant="caption" color="text.secondary">
                          {f.category} &middot; {f.weights?.length || 0} weights
                        </Typography>
                      </Box>
                      <Chip label={f.category} size="small" variant="outlined" />
                    </Box>
                  ))}
                  {filteredFonts.length === 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                      No fonts match your search
                    </Typography>
                  )}
                </Box>
              </Paper>
            </Grid>

            <Grid item xs={12} md={7}>
              {selectedFont && fontPairings ? (
                <Paper sx={{ p: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                    Pairing suggestions for{' '}
                    <FontSample component="span" fontFamily={selectedFont}>
                      {selectedFont}
                    </FontSample>
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Recommended body fonts to pair with your heading font
                  </Typography>

                  {fontPairings.pairings?.map((p, i) => (
                    <Box key={i} sx={{ mb: 3 }}>
                      <Box
                        sx={{
                          border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                          borderRadius: 2,
                          p: 2.5,
                          mb: 1,
                        }}
                      >
                        <FontSample
                          variant="h5"
                          fontFamily={selectedFont}
                          sx={{ fontWeight: 700, mb: 1 }}
                        >
                          Heading in {selectedFont}
                        </FontSample>
                        <FontSample
                          variant="body1"
                          fontFamily={p.font}
                          sx={{ color: 'text.secondary' }}
                        >
                          Body text in {p.font}. The quick brown fox jumps over the lazy dog.
                          Design is not just what it looks like — design is how it works.
                        </FontSample>
                      </Box>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {p.font}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {p.category} &middot; {p.reason}
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  ))}
                </Paper>
              ) : (
                <Paper
                  sx={{
                    height: 300,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px dashed ${alpha(theme.palette.divider, 0.3)}`,
                    backgroundColor: 'transparent',
                  }}
                  elevation={0}
                >
                  <FontIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
                  <Typography color="text.secondary">
                    Select a font to see pairing suggestions
                  </Typography>
                </Paper>
              )}

              {/* Type scale preview */}
              {selectedFont && (
                <Paper sx={{ p: 3, mt: 3 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
                    Type Scale Preview
                  </Typography>
                  {[
                    { label: 'Display', variant: 'h3', weight: 800 },
                    { label: 'Heading 1', variant: 'h4', weight: 700 },
                    { label: 'Heading 2', variant: 'h5', weight: 600 },
                    { label: 'Heading 3', variant: 'h6', weight: 600 },
                    { label: 'Body', variant: 'body1', weight: 400 },
                    { label: 'Caption', variant: 'caption', weight: 400 },
                  ].map(({ label, variant, weight }) => (
                    <Box key={label} sx={{ display: 'flex', alignItems: 'baseline', gap: 2, mb: 1 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ width: 80, flexShrink: 0 }}
                      >
                        {label}
                      </Typography>
                      <FontSample variant={variant} fontFamily={selectedFont} sx={{ fontWeight: weight }}>
                        Almost before we knew it, we had left the ground.
                      </FontSample>
                    </Box>
                  ))}
                </Paper>
              )}
            </Grid>
          </Grid>
        )}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        )}
      </ContentArea>

      {/* ================================================================= */}
      {/* BRAND KIT CREATE / EDIT DIALOG                                    */}
      {/* ================================================================= */}
      <Dialog
        open={kitDialogOpen}
        onClose={() => setKitDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {kitDialogMode === 'edit' ? 'Edit Brand Kit' : 'Create Brand Kit'}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={kitForm.name}
            onChange={(e) => setKitForm({ ...kitForm, name: e.target.value })}
            sx={{ mt: 2, mb: 2 }}
            required
          />
          <TextField
            fullWidth
            label="Description"
            value={kitForm.description}
            onChange={(e) => setKitForm({ ...kitForm, description: e.target.value })}
            sx={{ mb: 2 }}
            multiline
            rows={2}
            placeholder="What is this brand kit for?"
          />

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Colors
          </Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={4}>
              <TextField
                fullWidth
                type="color"
                label="Primary"
                value={kitForm.primary_color}
                onChange={(e) => setKitForm({ ...kitForm, primary_color: e.target.value })}
                size="small"
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                fullWidth
                type="color"
                label="Secondary"
                value={kitForm.secondary_color}
                onChange={(e) => setKitForm({ ...kitForm, secondary_color: e.target.value })}
                size="small"
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                fullWidth
                type="color"
                label="Accent"
                value={kitForm.accent_color}
                onChange={(e) => setKitForm({ ...kitForm, accent_color: e.target.value })}
                size="small"
              />
            </Grid>
          </Grid>

          {/* Advanced section */}
          <Box
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mb: 1 }}
            onClick={() => setKitFormExpanded(!kitFormExpanded)}
          >
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
              Advanced options
            </Typography>
            {kitFormExpanded ? (
              <ExpandLessIcon fontSize="small" sx={{ ml: 0.5 }} />
            ) : (
              <ExpandMoreIcon fontSize="small" sx={{ ml: 0.5 }} />
            )}
          </Box>

          <Collapse in={kitFormExpanded}>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  type="color"
                  label="Text Color"
                  value={kitForm.text_color}
                  onChange={(e) => setKitForm({ ...kitForm, text_color: e.target.value })}
                  size="small"
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  type="color"
                  label="Background"
                  value={kitForm.background_color}
                  onChange={(e) => setKitForm({ ...kitForm, background_color: e.target.value })}
                  size="small"
                />
              </Grid>
            </Grid>

            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Typography
            </Typography>
            <TextField
              fullWidth
              select
              label="Primary Font"
              value={kitForm.font_family}
              onChange={(e) => setKitForm({ ...kitForm, font_family: e.target.value })}
              sx={{ mb: 2 }}
              size="small"
              SelectProps={{ native: false }}
            >
              {fonts.map((f) => (
                <MenuItem key={f.name} value={f.name}>
                  {f.name}
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    ({f.category})
                  </Typography>
                </MenuItem>
              ))}
              {fonts.length === 0 && (
                <MenuItem value={kitForm.font_family}>{kitForm.font_family}</MenuItem>
              )}
            </TextField>
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  select
                  label="Heading Font"
                  value={kitForm.heading_font}
                  onChange={(e) => setKitForm({ ...kitForm, heading_font: e.target.value })}
                  size="small"
                  SelectProps={{ native: false }}
                >
                  <MenuItem value="">
                    <em>Same as primary</em>
                  </MenuItem>
                  {fonts.map((f) => (
                    <MenuItem key={f.name} value={f.name}>
                      {f.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={6}>
                <TextField
                  fullWidth
                  select
                  label="Body Font"
                  value={kitForm.body_font}
                  onChange={(e) => setKitForm({ ...kitForm, body_font: e.target.value })}
                  size="small"
                  SelectProps={{ native: false }}
                >
                  <MenuItem value="">
                    <em>Same as primary</em>
                  </MenuItem>
                  {fonts.map((f) => (
                    <MenuItem key={f.name} value={f.name}>
                      {f.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            </Grid>
          </Collapse>

          {/* Color preview strip */}
          <Box sx={{ mt: 2, display: 'flex', gap: 1, justifyContent: 'center' }}>
            {[kitForm.primary_color, kitForm.secondary_color, kitForm.accent_color, kitForm.text_color, kitForm.background_color]
              .filter(Boolean)
              .map((c, i) => (
                <ColorSwatch key={i} color={c} size={32} />
              ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKitDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveKit} disabled={!kitForm.name.trim()}>
            {kitDialogMode === 'edit' ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================= */}
      {/* THEME CREATE DIALOG                                               */}
      {/* ================================================================= */}
      <Dialog
        open={themeDialogOpen}
        onClose={() => setThemeDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Theme</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={themeForm.name}
            onChange={(e) => setThemeForm({ ...themeForm, name: e.target.value })}
            sx={{ mt: 2, mb: 2 }}
            required
          />
          <TextField
            fullWidth
            label="Description"
            value={themeForm.description}
            onChange={(e) => setThemeForm({ ...themeForm, description: e.target.value })}
            sx={{ mb: 2 }}
            placeholder="Describe this theme..."
          />
          <TextField
            fullWidth
            select
            label="Mode"
            value={themeForm.mode}
            onChange={(e) => setThemeForm({ ...themeForm, mode: e.target.value })}
            sx={{ mb: 2 }}
            SelectProps={{ native: false }}
          >
            <MenuItem value="light">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LightModeIcon fontSize="small" /> Light
              </Box>
            </MenuItem>
            <MenuItem value="dark">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <DarkModeIcon fontSize="small" /> Dark
              </Box>
            </MenuItem>
          </TextField>

          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Colors
          </Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={4}>
              <TextField
                fullWidth
                type="color"
                label="Primary"
                value={themeForm.primary}
                onChange={(e) => setThemeForm({ ...themeForm, primary: e.target.value })}
                size="small"
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                fullWidth
                type="color"
                label="Secondary"
                value={themeForm.secondary}
                onChange={(e) => setThemeForm({ ...themeForm, secondary: e.target.value })}
                size="small"
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                fullWidth
                type="color"
                label="Background"
                value={themeForm.background}
                onChange={(e) => setThemeForm({ ...themeForm, background: e.target.value })}
                size="small"
              />
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField
                fullWidth
                type="color"
                label="Surface"
                value={themeForm.surface}
                onChange={(e) => setThemeForm({ ...themeForm, surface: e.target.value })}
                size="small"
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                fullWidth
                type="color"
                label="Text"
                value={themeForm.text}
                onChange={(e) => setThemeForm({ ...themeForm, text: e.target.value })}
                size="small"
              />
            </Grid>
          </Grid>

          {/* Preview */}
          <Box
            sx={{
              mt: 2,
              p: 2,
              borderRadius: 2,
              backgroundColor: themeForm.background,
              border: '1px solid rgba(0,0,0,0.1)',
            }}
          >
            <Typography variant="body2" sx={{ color: themeForm.text, fontWeight: 600, mb: 0.5 }}>
              Theme Preview
            </Typography>
            <Box sx={{ backgroundColor: themeForm.surface, p: 1.5, borderRadius: 1, mb: 1 }}>
              <Typography variant="caption" sx={{ color: themeForm.text }}>
                Surface area with text
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Box sx={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: themeForm.primary }} />
              <Box sx={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: themeForm.secondary }} />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setThemeDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveTheme} disabled={!themeForm.name.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  )
}

// === From: knowledge.jsx ===
/**
 * Knowledge Library Page Container
 * Document library and knowledge management interface.
 */


const KnPageContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: 'calc(100vh - 64px)',
  backgroundColor: theme.palette.background.default,
}))

const KnHeader = styled(Box)(({ theme }) => ({
  padding: theme.spacing(2, 3),
  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.8),
}))

const KnContentArea = styled(Box)(({ theme }) => ({
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
}))

const Sidebar = styled(Box)(({ theme }) => ({
  width: 260,
  borderRight: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  backgroundColor: alpha(theme.palette.background.paper, 0.6),
  display: 'flex',
  flexDirection: 'column',
}))

const MainPanel = styled(Box)(({ theme }) => ({
  flex: 1,
  padding: theme.spacing(3),
  overflow: 'auto',
}))

const DocumentCard = styled(Card)(({ theme }) => ({
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: `0 8px 24px ${alpha(theme.palette.text.primary, 0.05)}`,
  },
}))

const CollectionItem = styled(ListItem)(({ theme, selected }) => ({
  borderRadius: 8,
  marginBottom: 4,
  backgroundColor: selected ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100]) : 'transparent',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
  },
}))

const KnActionButton = styled(Button)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
}))

const UploadDropzone = styled(Box)(({ theme, isDragActive }) => ({
  border: `2px dashed ${isDragActive ? (theme.palette.mode === 'dark' ? neutral[500] : neutral[700]) : alpha(theme.palette.divider, 0.3)}`,
  borderRadius: 8,  // Figma spec: 8px
  padding: theme.spacing(6),
  textAlign: 'center',
  backgroundColor: isDragActive ? (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50]) : alpha(theme.palette.background.paper, 0.5),
  cursor: 'pointer',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.02) : neutral[50],
  },
}))


export function KnowledgePageContainer() {
  const theme = useTheme()
  const toast = useToast()
  const { execute } = useInteraction()
  const { connections, templates } = useSharedData()

  // Cross-page: accept documents from other features (Agents, Synthesis, etc.)
  useIncomingTransfer(FeatureKey.KNOWLEDGE, {
    [TransferAction.SAVE_TO]: async (payload) => {
      // Create a Blob from the content and upload it
      const content = typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content)
      const blob = new Blob([content], { type: 'text/plain' })
      const file = new File([blob], `${payload.title || 'Imported'}.txt`, { type: 'text/plain' })
      await uploadDocument(file, payload.title || 'Imported Document', selectedCollection?.id)
      fetchDocuments()
    },
  })

  const {
    documents,
    collections,
    tags,
    currentDocument,
    currentCollection,
    searchResults,
    relatedDocuments,
    knowledgeGraph,
    faq,
    stats,
    totalDocuments,
    loading,
    searching,
    error,
    fetchDocuments,
    fetchCollections,
    fetchTags,
    createCollection,
    deleteDocument,
    toggleFavorite,
    searchDocuments,
    autoTag,
    findRelated,
    buildKnowledgeGraph,
    generateFaq,
    fetchStats,
    reset,
  } = useKnowledgeStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCollection, setSelectedCollection] = useState(null)
  const [view, setView] = useState('all') // 'all', 'favorites', 'recent', 'graph', 'faq'
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false)
  const [newCollectionName, setNewCollectionName] = useState('')
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [selectedDoc, setSelectedDoc] = useState(null)
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    fetchDocuments()
    fetchCollections()
    fetchTags()
    fetchStats()
    return () => reset()
  }, [fetchCollections, fetchDocuments, fetchStats, fetchTags, reset])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      fetchDocuments()
      return
    }

    return execute({
      type: InteractionType.EXECUTE,
      label: 'Search library',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: { source: 'knowledge', query: searchQuery },
      action: () => searchDocuments(searchQuery),
    })
  }, [execute, fetchDocuments, searchDocuments, searchQuery])

  const handleSelectCollection = useCallback((collection) => {
    setSelectedCollection(collection)
    if (collection) {
      fetchDocuments({ collectionId: collection.id })
    } else {
      fetchDocuments()
    }
  }, [fetchDocuments])

  const handleToggleFavorite = useCallback(async (docId) => {
    return execute({
      type: InteractionType.UPDATE,
      label: 'Toggle favorite',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      intent: { source: 'knowledge', documentId: docId },
      action: () => toggleFavorite(docId),
    })
  }, [execute, toggleFavorite])

  const handleDeleteDocument = useCallback(async (docId) => {
    return execute({
      type: InteractionType.DELETE,
      label: 'Delete document',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'knowledge', documentId: docId },
      action: async () => {
        await deleteDocument(docId)
        toast.show('Document deleted', 'success')
      },
    })
  }, [deleteDocument, execute, toast])

  const handleAutoTag = useCallback(async (docId) => {
    return execute({
      type: InteractionType.UPDATE,
      label: 'Auto-tag document',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      intent: { source: 'knowledge', documentId: docId },
      action: async () => {
        await autoTag(docId)
        toast.show('Tags generated', 'success')
      },
    })
  }, [autoTag, execute, toast])

  const handleFindRelated = useCallback(async (docId) => {
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Find related documents',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      intent: { source: 'knowledge', documentId: docId },
      action: () => findRelated(docId),
    })
  }, [execute, findRelated])

  const handleBuildGraph = useCallback(async () => {
    const documentIds = documents
      .map((doc) => doc?.id)
      .filter(Boolean)

    return execute({
      type: InteractionType.EXECUTE,
      label: 'Build knowledge graph',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      intent: { source: 'knowledge' },
      action: async () => {
        await buildKnowledgeGraph({ collectionId: selectedCollection?.id, documentIds })
        setView('graph')
        toast.show('Knowledge graph built', 'success')
      },
    })
  }, [buildKnowledgeGraph, documents, execute, selectedCollection?.id, toast])

  const handleGenerateFaq = useCallback(async () => {
    const documentIds = documents
      .map((doc) => doc?.id)
      .filter(Boolean)

    if (!documentIds.length) {
      toast.show('Upload at least one document before generating FAQ', 'warning')
      return null
    }

    return execute({
      type: InteractionType.EXECUTE,
      label: 'Generate FAQ',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      blocksNavigation: true,
      intent: { source: 'knowledge' },
      action: async () => {
        const response = await generateFaq({
          collectionId: selectedCollection?.id,
          documentIds,
          background: false,
        })
        if (response?.status === 'queued') {
          toast.show('FAQ generation queued', 'info')
        } else {
          setView('faq')
          toast.show('FAQ generated', 'success')
        }
      },
    })
  }, [documents, execute, generateFaq, selectedCollection?.id, toast])

  const handleCreateCollection = useCallback(async () => {
    if (!newCollectionName.trim()) return

    return execute({
      type: InteractionType.CREATE,
      label: 'Create collection',
      reversibility: Reversibility.SYSTEM_MANAGED,
      intent: { source: 'knowledge', name: newCollectionName },
      action: async () => {
        await createCollection({ name: newCollectionName })
        toast.show('Collection created', 'success')
        setNewCollectionName('')
        setCreateCollectionOpen(false)
      },
    })
  }, [createCollection, execute, newCollectionName, toast])

  const handleMenuOpen = (event, doc) => {
    setMenuAnchor(event.currentTarget)
    setSelectedDoc(doc)
  }

  const handleMenuClose = () => {
    setMenuAnchor(null)
    setSelectedDoc(null)
  }

  const handleUploadDocument = useCallback(async () => {
    if (!uploadFile) {
      toast.show('Please select a file to upload', 'warning')
      return
    }

    return execute({
      type: InteractionType.CREATE,
      label: 'Upload document',
      reversibility: Reversibility.SYSTEM_MANAGED,
      blocksNavigation: true,
      intent: { source: 'knowledge', fileName: uploadFile.name },
      action: async () => {
        setUploading(true)
        try {
          await uploadDocument(
            uploadFile,
            uploadTitle || uploadFile.name,
            selectedCollection?.id
          )

          toast.show('Document uploaded successfully!', 'success')
          setUploadDialogOpen(false)
          setUploadFile(null)
          setUploadTitle('')
          fetchDocuments()
        } catch (err) {
          toast.show(err.userMessage || err.message || 'Failed to upload document', 'error')
        } finally {
          setUploading(false)
        }
      },
    })
  }, [execute, fetchDocuments, selectedCollection, toast, uploadFile, uploadTitle])

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0]
    if (file) {
      setUploadFile(file)
      if (!uploadTitle) {
        setUploadTitle(file.name.replace(/\.[^/.]+$/, ''))
      }
    }
  }

  const displayedDocs = view === 'favorites'
    ? documents.filter((d) => d.is_favorite)
    : searchQuery && searchResults.length > 0
    ? searchResults
    : documents

  return (
    <KnPageContainer>
      <KnHeader>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FolderOpenIcon sx={{ color: 'text.secondary', fontSize: 28 }} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Knowledge Library
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Typography variant="body2" color="text.secondary">
                  {stats?.total_documents || 0} documents in {stats?.total_collections || 0} collections
                </Typography>
                {connections.length > 0 && (
                  <Chip label={`${connections.length} connections`} size="small" variant="outlined" />
                )}
                {templates.length > 0 && (
                  <Chip label={`${templates.length} templates`} size="small" variant="outlined" />
                )}
              </Box>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <ImportFromMenu
              currentFeature={FeatureKey.KNOWLEDGE}
              onImport={async (output) => {
                const content = typeof output.data === 'string' ? output.data : JSON.stringify(output.data)
                const blob = new Blob([content], { type: 'text/plain' })
                const file = new File([blob], `${output.title || 'Imported'}.txt`, { type: 'text/plain' })
                await uploadDocument(file, output.title || 'Imported', selectedCollection?.id)
                fetchDocuments()
                toast.show(`"${output.title}" saved to library`, 'success')
              }}
            />
            <KnActionButton
              variant="contained"
              startIcon={<UploadIcon />}
              onClick={() => setUploadDialogOpen(true)}
            >
              Upload Document
            </KnActionButton>
            <KnActionButton
              startIcon={<GraphIcon />}
              onClick={handleBuildGraph}
              disabled={loading}
            >
              Knowledge Graph
            </KnActionButton>
            <KnActionButton
              startIcon={<FaqIcon />}
              onClick={handleGenerateFaq}
              disabled={loading}
            >
              Generate FAQ
            </KnActionButton>
          </Box>
        </Box>
      </KnHeader>

      <KnContentArea>
        {/* Sidebar */}
        <Sidebar>
          <Box sx={{ p: 2 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          {/* Quick Filters */}
          <List dense sx={{ px: 1 }}>
            <CollectionItem
              button
              selected={view === 'all' && !selectedCollection}
              onClick={() => {
                setView('all')
                setSelectedCollection(null)
                fetchDocuments()
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <DocIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="All Documents" />
            </CollectionItem>
            <CollectionItem
              button
              selected={view === 'favorites'}
              onClick={() => {
                setView('favorites')
                setSelectedCollection(null)
                fetchDocuments({ favoritesOnly: true })
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <StarIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </ListItemIcon>
              <ListItemText primary="Favorites" />
            </CollectionItem>
            <CollectionItem
              button
              selected={view === 'graph'}
              onClick={() => setView('graph')}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <GraphIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </ListItemIcon>
              <ListItemText
                primary="Knowledge Graph"
                secondary={knowledgeGraph ? `${knowledgeGraph.nodes?.length || 0} nodes` : null}
              />
            </CollectionItem>
            <CollectionItem
              button
              selected={view === 'faq'}
              onClick={() => setView('faq')}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <FaqIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              </ListItemIcon>
              <ListItemText
                primary="FAQ"
                secondary={faq.length ? `${faq.length} items` : null}
              />
            </CollectionItem>
          </List>

          <Divider sx={{ my: 1 }} />

          {/* Collections */}
          <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              COLLECTIONS
            </Typography>
            <IconButton size="small" onClick={() => setCreateCollectionOpen(true)}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Box>
          <List dense sx={{ px: 1, flex: 1, overflow: 'auto' }}>
            {collections.map((collection) => (
              <CollectionItem
                key={collection.id}
                button
                selected={selectedCollection?.id === collection.id}
                onClick={() => handleSelectCollection(collection)}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <FolderIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </ListItemIcon>
                <ListItemText
                  primary={collection.name}
                  secondary={`${collection.document_count || 0} docs`}
                />
              </CollectionItem>
            ))}
          </List>

          {/* Tags */}
          <Box sx={{ p: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
            <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
              TAGS
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {tags.slice(0, 10).map((tag) => (
                <Chip
                  key={tag.id}
                  size="small"
                  label={tag.name}
                  variant="filled"
                  onClick={() => fetchDocuments({ tags: [tag.name] })}
                />
              ))}
            </Box>
          </Box>
        </Sidebar>

        {/* Main Panel */}
        <MainPanel>
          {loading && !documents.length && view !== 'graph' && view !== 'faq' ? (
            <Grid container spacing={2}>
              {Array.from({ length: 6 }).map((_, i) => (
                <Grid item xs={12} sm={6} md={4} key={i}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                      <Box sx={{ width: '70%', height: 20, bgcolor: alpha(theme.palette.text.primary, 0.08), borderRadius: 1 }} />
                      <Box sx={{ width: 24, height: 24, bgcolor: alpha(theme.palette.text.primary, 0.05), borderRadius: '50%' }} />
                    </Box>
                    <Box sx={{ width: '50%', height: 14, bgcolor: alpha(theme.palette.text.primary, 0.05), borderRadius: 1, mb: 1.5 }} />
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Box sx={{ width: 48, height: 20, bgcolor: alpha(theme.palette.text.primary, 0.05), borderRadius: 1 }} />
                      <Box sx={{ width: 56, height: 20, bgcolor: alpha(theme.palette.text.primary, 0.05), borderRadius: 1 }} />
                    </Box>
                  </Card>
                </Grid>
              ))}
            </Grid>
          ) : view === 'graph' ? (
            /* Knowledge Graph View */
            knowledgeGraph ? (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      Knowledge Graph
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {knowledgeGraph.nodes?.length || 0} nodes, {knowledgeGraph.edges?.length || 0} relationships
                    </Typography>
                  </Box>
                  <KnActionButton
                    startIcon={<GraphIcon />}
                    onClick={handleBuildGraph}
                    disabled={loading}
                  >
                    Rebuild
                  </KnActionButton>
                </Box>

                {/* Nodes */}
                <Typography variant="overline" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                  Entities
                </Typography>
                <Grid container spacing={1.5} sx={{ mb: 3 }}>
                  {knowledgeGraph.nodes?.map((node) => (
                    <Grid item xs={12} sm={6} md={4} key={node.id}>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 2,
                          borderRadius: 1,
                          transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
                          '&:hover': { borderColor: 'text.secondary', transform: 'translateY(-1px)' },
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Chip
                            size="small"
                            label={node.type}
                            color={node.type === 'document' ? 'primary' : node.type === 'entity' ? 'secondary' : 'default'}
                            variant="outlined"
                          />
                        </Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {node.label}
                        </Typography>
                        {node.properties?.description && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                            {node.properties.description}
                          </Typography>
                        )}
                      </Paper>
                    </Grid>
                  ))}
                </Grid>

                {/* Edges */}
                {knowledgeGraph.edges?.length > 0 && (
                  <>
                    <Typography variant="overline" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                      Relationships
                    </Typography>
                    <Paper variant="outlined" sx={{ borderRadius: 1 }}>
                      <List dense>
                        {knowledgeGraph.edges.map((edge, idx) => {
                          const sourceNode = knowledgeGraph.nodes?.find((n) => n.id === edge.source)
                          const targetNode = knowledgeGraph.nodes?.find((n) => n.id === edge.target)
                          return (
                            <ListItem key={idx} divider={idx < knowledgeGraph.edges.length - 1}>
                              <ListItemText
                                primary={
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {sourceNode?.label || edge.source}
                                    </Typography>
                                    <Chip size="small" label={edge.type} variant="outlined" />
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {targetNode?.label || edge.target}
                                    </Typography>
                                  </Box>
                                }
                              />
                            </ListItem>
                          )
                        })}
                      </List>
                    </Paper>
                  </>
                )}
              </Box>
            ) : (
              <Box
                sx={{
                  height: '50vh',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <GraphIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No knowledge graph yet
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center', maxWidth: 400 }}>
                  Build a knowledge graph to visualize relationships between your documents, entities, and concepts.
                </Typography>
                <KnActionButton
                  variant="contained"
                  size="large"
                  startIcon={<GraphIcon />}
                  onClick={handleBuildGraph}
                  disabled={loading || !documents.length}
                >
                  Build Knowledge Graph
                </KnActionButton>
              </Box>
            )
          ) : view === 'faq' ? (
            /* FAQ View */
            faq.length > 0 ? (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      Frequently Asked Questions
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {faq.length} question{faq.length !== 1 ? 's' : ''} generated from your documents
                    </Typography>
                  </Box>
                  <KnActionButton
                    startIcon={<FaqIcon />}
                    onClick={handleGenerateFaq}
                    disabled={loading}
                  >
                    Regenerate
                  </KnActionButton>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {faq.map((item, idx) => (
                    <Paper
                      key={idx}
                      variant="outlined"
                      sx={{ p: 2.5, borderRadius: 1 }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                        <FaqIcon sx={{ color: 'text.secondary', fontSize: 20, mt: 0.25, flexShrink: 0 }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
                            {item.question}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                            {item.answer}
                          </Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
                            {item.category && (
                              <Chip size="small" label={item.category} variant="outlined" />
                            )}
                            {item.confidence != null && (
                              <Chip
                                size="small"
                                label={`${Math.round(item.confidence * 100)}% confidence`}
                                variant="outlined"
                                color={item.confidence >= 0.8 ? 'success' : item.confidence >= 0.5 ? 'warning' : 'default'}
                              />
                            )}
                          </Box>
                        </Box>
                      </Box>
                    </Paper>
                  ))}
                </Box>
              </Box>
            ) : (
              <Box
                sx={{
                  height: '50vh',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <FaqIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No FAQ generated yet
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center', maxWidth: 400 }}>
                  Generate FAQ from your documents to surface the most important questions and answers.
                </Typography>
                <KnActionButton
                  variant="contained"
                  size="large"
                  startIcon={<FaqIcon />}
                  onClick={handleGenerateFaq}
                  disabled={loading || !documents.length}
                >
                  Generate FAQ
                </KnActionButton>
              </Box>
            )
          ) : (
            /* Documents View (default) */
            <>
              <Grid container spacing={2}>
                {displayedDocs.map((doc) => (
                  <Grid item xs={12} sm={6} md={4} key={doc.id}>
                    <DocumentCard>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
                              {doc.title}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              {doc.file_type?.toUpperCase()} - {new Date(doc.updated_at).toLocaleDateString()}
                            </Typography>
                          </Box>
                          <IconButton
                            size="small"
                            onClick={() => handleToggleFavorite(doc.id)}
                          >
                            {doc.is_favorite ? <StarIcon sx={{ color: 'text.secondary' }} /> : <StarBorderIcon />}
                          </IconButton>
                        </Box>
                        {doc.tags?.length > 0 && (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                            {doc.tags.slice(0, 3).map((tag) => (
                              <Chip key={tag} size="small" label={tag} variant="outlined" />
                            ))}
                          </Box>
                        )}
                      </CardContent>
                      <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
                        <IconButton size="small" onClick={(e) => handleMenuOpen(e, doc)}>
                          <MoreIcon fontSize="small" />
                        </IconButton>
                      </CardActions>
                    </DocumentCard>
                  </Grid>
                ))}
              </Grid>

              {displayedDocs.length === 0 && !loading && (
                <Box
                  sx={{
                    height: '50vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FolderOpenIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                  <Typography variant="h6" color="text.secondary" gutterBottom>
                    No documents found
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center', maxWidth: 400 }}>
                    Upload your first document to start building your knowledge base.
                    We support PDF, Word, Text, and Markdown files.
                  </Typography>
                  <KnActionButton
                    variant="contained"
                    size="large"
                    startIcon={<UploadIcon />}
                    onClick={() => setUploadDialogOpen(true)}
                  >
                    Upload Your First Document
                  </KnActionButton>
                </Box>
              )}
            </>
          )}
        </MainPanel>
      </KnContentArea>

      {/* Context Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={() => { handleAutoTag(selectedDoc?.id); handleMenuClose(); }}>
          <ListItemIcon><AIIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Auto-tag</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { handleFindRelated(selectedDoc?.id); handleMenuClose(); }}>
          <ListItemIcon><SearchIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Find Related</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { handleDeleteDocument(selectedDoc?.id); handleMenuClose(); }}>
          <ListItemIcon><DeleteIcon fontSize="small" sx={{ color: 'text.secondary' }} /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Create Collection Dialog */}
      <Dialog open={createCollectionOpen} onClose={() => setCreateCollectionOpen(false)}>
        <DialogTitle>Create Collection</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Collection Name"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateCollectionOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateCollection}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Upload Document Dialog */}
      <Dialog
        open={uploadDialogOpen}
        onClose={() => !uploading && setUploadDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Upload Document</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Upload a document to add it to your knowledge library. Supported formats: PDF, DOCX, TXT, MD, HTML
          </Typography>

          <UploadDropzone
            onClick={() => document.getElementById('document-upload-input')?.click()}
            sx={{ mb: 3 }}
          >
            <input
              id="document-upload-input"
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md,.html"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <UploadIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            {uploadFile ? (
              <>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {uploadFile.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {(uploadFile.size / 1024 / 1024).toFixed(2)} MB - Click to change
                </Typography>
              </>
            ) : (
              <>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  Click to select a file
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  or drag and drop here
                </Typography>
              </>
            )}
          </UploadDropzone>

          <TextField
            fullWidth
            label="Document Title"
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            placeholder="Enter a title for this document"
            sx={{ mb: 2 }}
          />

          {selectedCollection && (
            <Alert severity="info">
              This document will be added to the "{selectedCollection.name}" collection.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleUploadDocument}
            disabled={!uploadFile || uploading}
            startIcon={uploading ? <CircularProgress size={16} /> : <UploadIcon />}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </Button>
        </DialogActions>
      </Dialog>

      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          {error}
        </Alert>
      )}
    </KnPageContainer>
  )
}
