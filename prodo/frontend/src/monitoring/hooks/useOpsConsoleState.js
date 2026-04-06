import { useMemo, useState } from 'react'

/**
 * Manages all form state for the Ops Console API testing page.
 * Extracts ~40 useState calls from the monolithic OpsConsolePage.
 */
export function useOpsConsoleState() {
  const [busy, setBusy] = useState(false)
  const [lastResponse, setLastResponse] = useState(null)

  // Auth
  const [apiKey, setApiKey] = useState('')
  const [bearerToken, setBearerToken] = useState('')

  // Register
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerName, setRegisterName] = useState('')

  // Login
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // User
  const [userId, setUserId] = useState('')

  // Job form
  const [jobTemplateId, setJobTemplateId] = useState('')
  const [jobConnectionId, setJobConnectionId] = useState('')
  const [jobStartDate, setJobStartDate] = useState('')
  const [jobEndDate, setJobEndDate] = useState('')
  const [jobDocx, setJobDocx] = useState(false)
  const [jobXlsx, setJobXlsx] = useState(false)
  const [jobKeyValues, setJobKeyValues] = useState('')
  const [jobBatchIds, setJobBatchIds] = useState('')
  const [jobLimit, setJobLimit] = useState(20)

  // Schedule
  const [scheduleId, setScheduleId] = useState('')

  // Compare
  const [compareId1, setCompareId1] = useState('')
  const [compareId2, setCompareId2] = useState('')

  // Comments
  const [commentAnalysisId, setCommentAnalysisId] = useState('')
  const [commentUserId, setCommentUserId] = useState('')
  const [commentUserName, setCommentUserName] = useState('')
  const [commentContent, setCommentContent] = useState('')
  const [commentElementType, setCommentElementType] = useState('')
  const [commentElementId, setCommentElementId] = useState('')

  // Sharing
  const [shareAnalysisId, setShareAnalysisId] = useState('')
  const [shareAccessLevel, setShareAccessLevel] = useState('view')
  const [shareExpiresHours, setShareExpiresHours] = useState('')
  const [shareAllowedEmails, setShareAllowedEmails] = useState('')
  const [sharePasswordProtected, setSharePasswordProtected] = useState(false)

  // Enrichment
  const [enrichmentSourceId, setEnrichmentSourceId] = useState('')

  // Chart
  const [chartData, setChartData] = useState('[{"month":"Jan","value":120},{"month":"Feb","value":140}]')
  const [chartType, setChartType] = useState('bar')
  const [chartXField, setChartXField] = useState('month')
  const [chartYFields, setChartYFields] = useState('value')
  const [chartTitle, setChartTitle] = useState('')
  const [chartMaxSuggestions, setChartMaxSuggestions] = useState(3)

  const authHeaders = useMemo(() => {
    const headers = {}
    const trimmedKey = apiKey.trim()
    const trimmedToken = bearerToken.trim()
    if (trimmedKey) headers['X-API-Key'] = trimmedKey
    if (trimmedToken) headers.Authorization = `Bearer ${trimmedToken}`
    return headers
  }, [apiKey, bearerToken])

  return {
    busy, setBusy, lastResponse, setLastResponse,
    apiKey, setApiKey, bearerToken, setBearerToken,
    registerEmail, setRegisterEmail, registerPassword, setRegisterPassword,
    registerName, setRegisterName,
    loginEmail, setLoginEmail, loginPassword, setLoginPassword,
    userId, setUserId,
    jobTemplateId, setJobTemplateId, jobConnectionId, setJobConnectionId,
    jobStartDate, setJobStartDate, jobEndDate, setJobEndDate,
    jobDocx, setJobDocx, jobXlsx, setJobXlsx,
    jobKeyValues, setJobKeyValues, jobBatchIds, setJobBatchIds,
    jobLimit, setJobLimit,
    scheduleId, setScheduleId,
    compareId1, setCompareId1, compareId2, setCompareId2,
    commentAnalysisId, setCommentAnalysisId,
    commentUserId, setCommentUserId, commentUserName, setCommentUserName,
    commentContent, setCommentContent,
    commentElementType, setCommentElementType, commentElementId, setCommentElementId,
    shareAnalysisId, setShareAnalysisId, shareAccessLevel, setShareAccessLevel,
    shareExpiresHours, setShareExpiresHours, shareAllowedEmails, setShareAllowedEmails,
    sharePasswordProtected, setSharePasswordProtected,
    enrichmentSourceId, setEnrichmentSourceId,
    chartData, setChartData, chartType, setChartType,
    chartXField, setChartXField, chartYFields, setChartYFields,
    chartTitle, setChartTitle, chartMaxSuggestions, setChartMaxSuggestions,
    authHeaders,
  }
}
