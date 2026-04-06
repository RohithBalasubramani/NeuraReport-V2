import { useState } from 'react'

/**
 * Manages agent runner page state (agent selection, form data, results).
 */
export function useAgentRunnerState(agents, activeConnectionId) {
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId)
  const [selectedAgent, setSelectedAgent] = useState(agents[0])
  const [formData, setFormData] = useState({})
  const [showHistory, setShowHistory] = useState(false)
  const [result, setResult] = useState(null)
  const [recentRuns, setRecentRuns] = useState([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)

  return {
    selectedConnectionId, setSelectedConnectionId,
    selectedAgent, setSelectedAgent,
    formData, setFormData,
    showHistory, setShowHistory,
    result, setResult,
    recentRuns, setRecentRuns,
    runsLoading, setRunsLoading,
    generateDialogOpen, setGenerateDialogOpen,
  }
}
