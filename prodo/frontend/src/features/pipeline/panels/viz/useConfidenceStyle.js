/**
 * useConfidenceStyle — cross-cutting hook for confidence-as-opacity.
 * No numbers shown. Strong data = solid, weak = faded.
 */
export default function useConfidenceStyle(confidence) {
  if (confidence == null || confidence >= 0.8) return { opacity: 1 }
  if (confidence >= 0.5) return { opacity: 0.65, filter: 'saturate(0.6)' }
  return { opacity: 0.35, filter: 'saturate(0.3)' }
}

export function confidenceSx(confidence) {
  if (confidence == null || confidence >= 0.8) return {}
  if (confidence >= 0.5) return { opacity: 0.65, filter: 'saturate(0.6)' }
  return { opacity: 0.35, filter: 'saturate(0.3)' }
}

/**
 * useHighlightStyle — cross-panel field glow when highlightedField matches.
 * Apply to any element that represents a field to get consistent glow.
 */
export function useHighlightStyle(field, highlightedField, color) {
  if (!highlightedField || field !== highlightedField) return {}
  return {
    boxShadow: `0 0 0 2px ${color || '#2196f3'}`,
    outline: `2px solid ${color || '#2196f3'}44`,
    animation: 'pulse 2s infinite',
    zIndex: 1,
  }
}
