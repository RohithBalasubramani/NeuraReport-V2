import { useCallback, useEffect, useRef, useState } from 'react'

const LOGGER_URL = 'http://localhost:9847?embedded=true'

/**
 * Manages logger connection state, discovery, and iframe refresh.
 */
export function useLoggerState() {
  const [viewMode, setViewMode] = useState('plugin')
  const [loggerConnections, setLoggerConnections] = useState([])
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discoveryError, setDiscoveryError] = useState(null)
  const [loggerStatus, setLoggerStatus] = useState('checking')
  const iframeRef = useRef(null)

  useEffect(() => {
    fetch(LOGGER_URL, { mode: 'no-cors' })
      .then(() => setLoggerStatus('online'))
      .catch(() => setLoggerStatus('offline'))
  }, [])

  const handleRefreshIframe = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = LOGGER_URL
    }
  }, [])

  const handleConnectionSelect = useCallback((connId) => {
    setSelectedConnectionId(connId)
  }, [])

  return {
    LOGGER_URL,
    viewMode, setViewMode,
    loggerConnections, setLoggerConnections,
    selectedConnectionId, setSelectedConnectionId,
    discovering, setDiscovering,
    discoveryError, setDiscoveryError,
    loggerStatus, setLoggerStatus,
    iframeRef,
    handleRefreshIframe, handleConnectionSelect,
  }
}
