import { useState } from 'react'

/**
 * Hook encapsulating the enhanced analysis state
 * (Q&A, chart generation, export, preferences).
 */
export function useEnhancedAnalysisState() {
  // Q&A state
  const [question, setQuestion] = useState('')
  const [isAskingQuestion, setIsAskingQuestion] = useState(false)
  const [qaHistory, setQaHistory] = useState([])

  // Chart generation state
  const [chartQuery, setChartQuery] = useState('')
  const [isGeneratingCharts, setIsGeneratingCharts] = useState(false)
  const [generatedCharts, setGeneratedCharts] = useState([])
  const [suggestedQuestions, setSuggestedQuestions] = useState([])

  // Export state
  const [exportMenuAnchor, setExportMenuAnchor] = useState(null)
  const [isExporting, setIsExporting] = useState(false)

  // Preferences
  const [preferences] = useState({
    analysis_depth: 'standard',
    focus_areas: [],
    output_format: 'executive',
    industry: null,
    enable_predictions: true,
    auto_chart_generation: true,
    max_charts: 10,
  })

  return {
    question, setQuestion,
    isAskingQuestion, setIsAskingQuestion,
    qaHistory, setQaHistory,
    chartQuery, setChartQuery,
    isGeneratingCharts, setIsGeneratingCharts,
    generatedCharts, setGeneratedCharts,
    suggestedQuestions, setSuggestedQuestions,
    exportMenuAnchor, setExportMenuAnchor,
    isExporting, setIsExporting,
    preferences,
  }
}
