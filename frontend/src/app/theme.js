// app/theme.js — BRIDGE
// Re-exports everything from shared/theme so all existing consumer imports
// continue to work without changes. New code should import from
// '@/shared/theme' or '@/shared/theme/tokens' directly.

// Design tokens (palettes, fonts, layout constants)
export {
  neutral,
  primary,
  status,
  secondary,
  palette,
  fontFamilyDisplay,
  fontFamilyHeading,
  fontFamilyBody,
  fontFamilyMono,
  fontFamilyUI,
  figmaShadow,
  figmaSpacing,
  figmaComponents,
  // Individual secondary palettes (not currently imported, but exported for completeness)
  secondarySlate,
  secondaryZinc,
  secondaryStone,
  secondaryTeal,
  secondaryEmerald,
  secondaryCyan,
  secondaryViolet,
  secondaryFuchsia,
  secondaryRose,
} from '../shared/theme/tokens'

// MUI theme object (default export) and factory
export { createAppTheme } from '../shared/theme/muiTheme'
export { default } from '../shared/theme/muiTheme'
