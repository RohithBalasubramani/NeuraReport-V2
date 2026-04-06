import { useCallback, useRef, useState } from 'react'

/**
 * Hook encapsulating the core analysis state shared by both
 * AnalyzePageContainer and EnhancedAnalyzePageContainer.
 */
export function useAnalysisState() {
  const [selectedFile, setSelectedFile] = useState(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [progressStage, setProgressStage] = useState('')
  const [analysisResult, setAnalysisResult] = useState(null)
  const [error, setError] = useState(null)
  const abortControllerRef = useRef(null)

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setSelectedFile(null)
    setIsAnalyzing(false)
    setAnalysisProgress(0)
    setProgressStage('')
    setAnalysisResult(null)
    setError(null)
  }, [])

  return {
    selectedFile,
    setSelectedFile,
    isAnalyzing,
    setIsAnalyzing,
    analysisProgress,
    setAnalysisProgress,
    progressStage,
    setProgressStage,
    analysisResult,
    setAnalysisResult,
    error,
    setError,
    abortControllerRef,
    reset,
  }
}
