import { useState } from 'react'

/**
 * Manages settings page state.
 */
export function useSettingsState() {
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState(null)
  const [error, setError] = useState(null)
  const [tokenUsage, setTokenUsage] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [selectedTimezone, setSelectedTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  )
  const [selectedLanguage, setSelectedLanguage] = useState('en')
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [showTwoFactorSetup, setShowTwoFactorSetup] = useState(false)

  return {
    loading, setLoading,
    health, setHealth,
    error, setError,
    tokenUsage, setTokenUsage,
    exporting, setExporting,
    selectedTimezone, setSelectedTimezone,
    selectedLanguage, setSelectedLanguage,
    twoFactorEnabled, setTwoFactorEnabled,
    showTwoFactorSetup, setShowTwoFactorSetup,
  }
}
