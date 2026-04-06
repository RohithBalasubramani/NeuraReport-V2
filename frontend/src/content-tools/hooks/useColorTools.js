import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { useToast } from '@/components/core'
import useDesignStore from '@/stores/app'
import { primary } from '@/app/theme'
import { useCallback, useState } from 'react'

export function useColorTools() {
  const toast = useToast()
  const { execute } = useInteraction()
  const { generateColorPalette, getColorContrast, suggestAccessibleColors } = useDesignStore()

  const [baseColor, setBaseColor] = useState(primary[500])
  const [colorScheme, setColorScheme] = useState('complementary')
  const [generatedPalette, setGeneratedPalette] = useState(null)
  const [contrastFg, setContrastFg] = useState('#000000')
  const [contrastBg, setContrastBg] = useState('#ffffff')
  const [contrastResult, setContrastResult] = useState(null)
  const [a11yBg, setA11yBg] = useState('#1976d2')
  const [a11ySuggestions, setA11ySuggestions] = useState(null)

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

  const handleCopyColor = (color) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(color)
    } else {
      const ta = Object.assign(document.createElement('textarea'), {
        value: color, style: 'position:fixed;opacity:0',
      })
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    toast.show(`Copied ${color}`, 'success')
  }

  return {
    baseColor, setBaseColor,
    colorScheme, setColorScheme,
    generatedPalette,
    contrastFg, setContrastFg,
    contrastBg, setContrastBg,
    contrastResult,
    a11yBg, setA11yBg,
    a11ySuggestions,
    handleGeneratePalette, handleCheckContrast,
    handleSuggestA11y, handleCopyColor,
  }
}
