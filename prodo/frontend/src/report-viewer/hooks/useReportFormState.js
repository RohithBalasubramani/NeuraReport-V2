import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Manages the report generation form state (template, dates, batches, history).
 */
export function useReportFormState() {
  const [searchParams] = useSearchParams()

  const [selectedTemplate, setSelectedTemplate] = useState(searchParams.get('template') || '')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [datePreset, setDatePreset] = useState('thisMonth')
  const [keyValues, setKeyValues] = useState({})
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [keyOptions, setKeyOptions] = useState({})
  const [discovering, setDiscovering] = useState(false)
  const [discovery, setDiscovery] = useState(null)
  const [selectedBatches, setSelectedBatches] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [runHistory, setRunHistory] = useState([])
  const [generatingDocx, setGeneratingDocx] = useState(null)
  const [selectedRun, setSelectedRun] = useState(null)
  const [runSummary, setRunSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [queueingSummary, setQueueingSummary] = useState(false)
  const [batchDiscoveryOpen, setBatchDiscoveryOpen] = useState(false)
  const [expandedRunId, setExpandedRunId] = useState(null)

  return {
    selectedTemplate, setSelectedTemplate,
    startDate, setStartDate,
    endDate, setEndDate,
    datePreset, setDatePreset,
    keyValues, setKeyValues,
    loading, setLoading,
    generating, setGenerating,
    result, setResult,
    error, setError,
    keyOptions, setKeyOptions,
    discovering, setDiscovering,
    discovery, setDiscovery,
    selectedBatches, setSelectedBatches,
    historyLoading, setHistoryLoading,
    runHistory, setRunHistory,
    generatingDocx, setGeneratingDocx,
    selectedRun, setSelectedRun,
    runSummary, setRunSummary,
    summaryLoading, setSummaryLoading,
    queueingSummary, setQueueingSummary,
    batchDiscoveryOpen, setBatchDiscoveryOpen,
    expandedRunId, setExpandedRunId,
  }
}
