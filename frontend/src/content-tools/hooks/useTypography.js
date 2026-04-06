import useDesignStore from '@/stores/app'
import { useCallback, useState } from 'react'

export function useTypography() {
  const { getFontPairings } = useDesignStore()

  const [selectedFont, setSelectedFont] = useState('')
  const [fontPairings, setFontPairings] = useState(null)
  const [fontFilter, setFontFilter] = useState('')

  const handleGetPairings = useCallback(async (fontName) => {
    setSelectedFont(fontName)
    const result = await getFontPairings(fontName)
    if (result) setFontPairings(result)
  }, [getFontPairings])

  return {
    selectedFont, fontPairings,
    fontFilter, setFontFilter,
    handleGetPairings,
  }
}
