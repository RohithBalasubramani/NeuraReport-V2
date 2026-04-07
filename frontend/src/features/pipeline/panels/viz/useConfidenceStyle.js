/**
 * useConfidenceStyle — Cross-cutting confidence visualization hook.
 *
 * References:
 *   - Apple Health app: opacity tiers for data certainty
 *   - Figma Auto Layout: confidence indicators without numbers
 *
 * Covers:
 *   V6: Confidence as opacity (3-tier: solid / faded / very faded)
 *   S5: Confidence/certainty (opacity-based, no percentages shown)
 *
 * Three tiers:
 *   >= 0.8  → fully solid, normal saturation
 *   0.5-0.8 → 65% opacity, slight desaturation
 *   < 0.5   → 35% opacity, heavy desaturation
 *
 * Usage:
 *   const style = useConfidenceStyle(0.7)  // → { opacity: 0.65, filter: 'saturate(0.6)' }
 *   <Box sx={confidenceSx(0.3)} />          // MUI sx shorthand
 *   <Box sx={useHighlightStyle('field', 'field', '#f00')} />  // glow when highlighted
 */

// Hook version — returns inline style object
export default function useConfidenceStyle(confidence) {
  if (confidence == null || confidence >= 0.8) return { opacity: 1 }
  if (confidence >= 0.5) return { opacity: 0.65, filter: 'saturate(0.6)' }
  return { opacity: 0.35, filter: 'saturate(0.3)' }
}

// MUI sx version — returns sx-compatible object
export function confidenceSx(confidence) {
  if (confidence == null || confidence >= 0.8) return {}
  if (confidence >= 0.5) return { opacity: 0.65, filter: 'saturate(0.6)' }
  return { opacity: 0.35, filter: 'saturate(0.3)' }
}

/**
 * useHighlightStyle — Cross-panel field glow.
 *
 * Apply to any element representing a field to get consistent
 * highlight glow when `highlightedField` matches.
 *
 * @param {string} field - This element's field identifier
 * @param {string|null} highlightedField - Currently highlighted field from store
 * @param {string} color - Glow color (default: blue)
 * @returns {object} MUI sx object with glow + pulse animation
 */
export function useHighlightStyle(field, highlightedField, color) {
  if (!highlightedField || field !== highlightedField) return {}
  const c = color || '#1976d2'
  return {
    boxShadow: `0 0 0 2px ${c}`,
    outline: `2px solid ${c}44`,
    animation: 'fieldGlowPulse 2s infinite',
    zIndex: 1,
    '@keyframes fieldGlowPulse': {
      '0%, 100%': { boxShadow: `0 0 0 2px ${c}44` },
      '50%': { boxShadow: `0 0 0 3px ${c}88` },
    },
  }
}
