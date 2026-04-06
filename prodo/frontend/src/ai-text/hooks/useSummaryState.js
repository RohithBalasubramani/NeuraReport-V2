import { useState } from 'react'

/**
 * Manages summary page form state (content, tone, focus areas, history).
 */
export function useSummaryState() {
  const [content, setContent] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [tone, setTone] = useState('formal')
  const [maxSentences, setMaxSentences] = useState(5)
  const [focusAreas, setFocusAreas] = useState([])
  const [customFocus, setCustomFocus] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [copied, setCopied] = useState(false)
  const [queueing, setQueueing] = useState(false)
  const [queuedJobId, setQueuedJobId] = useState(null)
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false)
  const [reportRuns, setReportRuns] = useState([])
  const [loadingReports, setLoadingReports] = useState(false)

  return {
    content, setContent,
    selectedConnectionId, setSelectedConnectionId,
    tone, setTone,
    maxSentences, setMaxSentences,
    focusAreas, setFocusAreas,
    customFocus, setCustomFocus,
    showHistory, setShowHistory,
    copied, setCopied,
    queueing, setQueueing,
    queuedJobId, setQueuedJobId,
    clearHistoryConfirmOpen, setClearHistoryConfirmOpen,
    reportRuns, setReportRuns,
    loadingReports, setLoadingReports,
  }
}
