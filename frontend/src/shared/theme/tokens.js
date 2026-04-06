// ==========================================================================
// Design System v4 — Design Tokens
// Single source of truth for color palettes, typography, spacing, and
// component tokens. Every value here maps 1-to-1 to the Figma design spec.
// ==========================================================================

// ---------------------------------------------------------------------------
// FONT STACKS
// ---------------------------------------------------------------------------
export const fontFamilyDisplay = '"Space Grotesk", "Inter", system-ui, sans-serif'
export const fontFamilyHeading = '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
export const fontFamilyBody = '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
export const fontFamilyMono = '"Courier New", SFMono-Regular, Menlo, Monaco, Consolas, monospace'
// Backward compat alias -- Inter serves both heading and UI roles
export const fontFamilyUI = fontFamilyBody

// ---------------------------------------------------------------------------
// NEUTRAL PALETTE (50-900) — warm paper tones for light surfaces
// Rules: 50-100 never for text. 900 never as background.
// ---------------------------------------------------------------------------
export const neutral = {
  50: '#fdfdfc',     // Warm paper page backgrounds
  100: '#f4f2ed',    // Warm cream cards, background fills
  200: '#d4d2cc',    // Borders, dividers
  300: '#d4d2cc',    // Input outlines, separators
  400: '#9CA3AF',    // Disabled icons
  500: '#6f6f69',    // Muted / helper text
  700: '#374151',    // Default body text
  900: '#111827',    // Headings, high-emphasis text
}

// ---------------------------------------------------------------------------
// PRIMARY PALETTE (Brand / Action) — blue accent
// Rules: Only 500-600 for CTAs. Never replace status colors.
// ---------------------------------------------------------------------------
export const primary = {
  50: '#EFF6FF',     // Subtle blue backgrounds, hover fills
  100: '#DBEAFE',    // Light blue accents
  300: '#6A9EFA',    // Secondary blue emphasis
  500: '#3B82F6',    // Primary CTAs, links (blue-500)
  600: '#2563EB',    // Hover / active states (blue-600)
  900: '#1D4ED8',    // Strong emphasis (blue-700)
}

// ---------------------------------------------------------------------------
// STATUS COLORS — semantic only, never decorative
// ---------------------------------------------------------------------------
export const status = {
  success: '#22C55E',
  warning: '#F59E0B',
  destructive: '#EF4444',
}

// ---------------------------------------------------------------------------
// SECONDARY (ACCENT) PALETTES — charts, tags, badges, categorization only
// Rules: Forbidden for primary CTAs, body text, headings, or destructive states.
// ---------------------------------------------------------------------------
export const secondarySlate = {
  50: '#F8FAFC', 100: '#F1F5F9', 200: '#E2E8F0', 300: '#CBD5E1',
  400: '#94A3B8', 500: '#64748B', 600: '#475569', 700: '#334155',
  800: '#1E293B', 900: '#0F172A',
}
export const secondaryZinc = {
  50: '#FAFAFA', 100: '#F4F4F5', 200: '#E4E4E7', 300: '#D4D4D8',
  400: '#A1A1AA', 500: '#71717A', 600: '#52525B', 700: '#3F3F46',
  800: '#27272A', 900: '#18181B',
}
export const secondaryStone = {
  50: '#FAFAF9', 100: '#F5F5F4', 200: '#E7E5E4', 300: '#D6D3D1',
  400: '#A8A29E', 500: '#78716C', 600: '#57534E', 700: '#44403C',
  800: '#292524', 900: '#1C1917',
}
export const secondaryTeal = {
  50: '#F0FDFA', 100: '#CCFBF1', 200: '#99F6E4', 300: '#5EEAD4',
  400: '#2DD4BF', 500: '#14B8A6', 600: '#0D9488', 700: '#0F766E',
  800: '#115E59', 900: '#134E4A',
}
export const secondaryEmerald = {
  50: '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7',
  400: '#34D399', 500: '#10B981', 600: '#059669', 700: '#047857',
  800: '#065F46', 900: '#064E3B',
}
export const secondaryCyan = {
  50: '#ECFEFF', 100: '#CFFAFE', 200: '#A5F3FC', 300: '#67E8F9',
  400: '#22D3EE', 500: '#06B6D4', 600: '#0891B2', 700: '#0E7490',
  800: '#155E75', 900: '#164E63',
}
export const secondaryViolet = {
  50: '#F5F3FF', 100: '#EDE9FE', 200: '#DDD6FE', 300: '#C4B5FD',
  400: '#A78BFA', 500: '#8B5CF6', 600: '#7C3AED', 700: '#6D28D9',
  800: '#5B21B6', 900: '#4C1D95',
}
export const secondaryFuchsia = {
  50: '#FDF4FF', 100: '#FAE8FF', 200: '#F5D0FE', 300: '#F0ABFC',
  400: '#E879F9', 500: '#D946EF', 600: '#C026D3', 700: '#A21CAF',
  800: '#86198F', 900: '#701A75',
}
export const secondaryRose = {
  50: '#FFF1F2', 100: '#FFE4E6', 200: '#FECDD3', 300: '#FDA4AF',
  400: '#FB7185', 500: '#F43F5E', 600: '#E11D48', 700: '#BE123C',
  800: '#9F1239', 900: '#881337',
}

export const secondary = {
  slate: secondarySlate,
  zinc: secondaryZinc,
  stone: secondaryStone,
  teal: secondaryTeal,
  emerald: secondaryEmerald,
  cyan: secondaryCyan,
  violet: secondaryViolet,
  fuchsia: secondaryFuchsia,
  rose: secondaryRose,
}

// ---------------------------------------------------------------------------
// BACKWARD-COMPATIBLE LEGACY PALETTE
// Maps old token names to Design System v4 values so all consumer files
// continue to work without code changes.
// ---------------------------------------------------------------------------
export const palette = {
  brand: {
    primary: neutral[900],
    secondary: neutral[900],
  },
  scale: {
    100: '#EDEDED',
    200: '#DEDEDE',
    300: '#BBBBBB',
    400: '#999999',
    500: '#7E7E7E',
    600: '#656565',
    700: '#444444',
    800: '#2A2A2A',
    900: '#1F1F1F',
    1000: '#1A1A1A',
    1100: '#111111',
    1200: '#0A0A0A',
  },
  green: {
    100: '#D1F4E0', 200: '#A3E9C1', 300: '#08C18F', 400: '#08C18F',
    500: '#22C55E', 600: '#16A34A', 700: '#15803D', 800: '#166534', 900: '#14532D',
  },
  blue: {
    100: '#D5E4FF', 200: '#A5C4FC', 300: '#6A9EFA', 400: '#3B82F6',
    500: '#2563EB', 600: '#1D4ED8', 700: '#1E40AF', 800: '#1E3A8A', 900: '#172554',
  },
  yellow: {
    100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D', 400: '#FBBF24',
    500: '#F59E0B', 600: '#D97706', 700: '#B45309', 800: '#92400E', 900: '#78350F',
  },
  red: {
    100: '#FEE2E2', 200: '#FECACA', 300: '#FCA5A5', 400: '#F87171',
    500: '#EF4444', 600: '#DC2626', 700: '#B91C1C', 800: '#991B1B', 900: '#7F1D1D',
  },
  purple: {
    100: '#EDE9FE', 200: '#DDD6FE', 300: '#C4B5FD', 400: '#A78BFA',
    500: '#8B5CF6', 600: '#7C3AED', 700: '#6D28D9', 800: '#5B21B6', 900: '#4C1D95',
  },
}

// ---------------------------------------------------------------------------
// FIGMA LAYOUT & COMPONENT TOKENS
// ---------------------------------------------------------------------------
export const figmaShadow = {
  xsmall: '0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
  aiPanel: '0px 4px 8.4px rgba(0,0,0,0.25)',
}

export const figmaSpacing = {
  sidebarWidth: 250,
  detailsPanelWidth: 400,
  taskbarHeight: 48,
  contentPadding: 20,
  cardBorderRadius: 8,
  buttonBorderRadius: 8,
  pillBorderRadius: 24,
  circleBorderRadius: 100,
}

export const figmaComponents = {
  tabs: {
    height: 40,
    borderBottom: `1px solid ${neutral[200]}`,
    paddingHorizontal: 32,
    paddingVertical: 8,
  },
  searchInput: { width: 240, height: 40, iconSize: 20 },
  filterButton: { height: 40, gap: 8 },
  viewToggle: { borderRadius: 8 },
  zoomControls: { height: 40, borderRadius: 35, iconSize: 24, gap: 12 },
  dataTable: { headerHeight: 60, rowHeight: 60, cellPadding: 16 },
  deviceDetailsPanel: { width: 400, sectionHeaderHeight: 40, rowHeight: 40, padding: 20 },
  aiAssistantPanel: { width: 394, minHeight: 114, borderRadius: '4px 4px 0 0', inputHeight: 48, padding: 16 },
  notificationCard: { width: 394, borderRadius: '4px 4px 0 0', padding: 16 },
  userAvatar: { size: 28, borderRadius: 32 },
  statusIndicator: { dotSize: 8, gap: 6 },
  scrollbar: { width: 20.156, borderRadius: 4 },
}
