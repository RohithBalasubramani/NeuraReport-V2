import { checkHealth } from '@/api/monitoring'
import { useCallback, useEffect, useState } from 'react'

/**
 * Hook to detect network connectivity status
 * Returns online status and a function to manually check connectivity
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [lastChecked, setLastChecked] = useState(null)

  const checkConnectivity = useCallback(async () => {
    const online = typeof navigator !== 'undefined' ? navigator.onLine : false
    setIsOnline(online)
    setLastChecked(new Date())
    return online
  }, [])

  const checkServer = useCallback(async () => {
    const browserOnline = typeof navigator !== 'undefined' ? navigator.onLine : false
    if (!browserOnline) return false
    try {
      return await checkHealth({ timeoutMs: 5000 })
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setLastChecked(new Date())
    }

    const handleOffline = () => {
      setIsOnline(false)
      setLastChecked(new Date())
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true)
    setLastChecked(new Date())

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return {
    isOnline,
    lastChecked,
    checkConnectivity,
    checkServer,
  }
}
