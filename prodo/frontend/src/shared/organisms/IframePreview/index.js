// ScaledIframePreview remains in components/core.jsx (300+ LOC with helpers).
// This barrel re-exports it so the shared/ hierarchy is complete.
// NOTE: components/core.jsx is NOT a pure bridge -- it retains code for
// non-extracted components like ScaledIframePreview, FavoriteButton, etc.
export { ScaledIframePreview } from '@/components/core'
