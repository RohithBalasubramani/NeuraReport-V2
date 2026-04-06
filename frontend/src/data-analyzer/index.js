/**
 * data-analyzer domain barrel.
 *
 * Default export = EnhancedAnalyzePageContainer
 * Named exports  = AnalyzePageContainer, hooks, atoms
 */

// Organisms (page-level containers)
export { default } from './organisms/AnalyzerShell'
export { AnalyzePageContainer } from './organisms/AnalyzerShell'

// Hooks
export { useAnalysisState } from './hooks/useAnalysisState'
export { useEnhancedAnalysisState } from './hooks/useEnhancedAnalysisState'

// Atoms
export { DocumentUpload } from './atoms/DocumentUpload'
export { MetricCard } from './atoms/MetricCard'
export { TabPanel } from './atoms/TabPanel'
