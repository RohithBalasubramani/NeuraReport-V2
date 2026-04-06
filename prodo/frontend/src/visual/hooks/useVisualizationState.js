import { useState } from 'react'

/**
 * Manages visualization page state (diagram type, input, options).
 */
export function useVisualizationState(activeConnectionId, diagramTypes) {
  const [selectedConnectionId, setSelectedConnectionId] = useState(activeConnectionId || '')
  const [selectedType, setSelectedType] = useState(diagramTypes?.[0])
  const [inputData, setInputData] = useState('')
  const [title, setTitle] = useState('')
  const [options, setOptions] = useState({})
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadedFileName, setUploadedFileName] = useState('')
  const [extractedTable, setExtractedTable] = useState(null)
  const [previewType, setPreviewType] = useState(null)

  return {
    selectedConnectionId, setSelectedConnectionId,
    selectedType, setSelectedType,
    inputData, setInputData,
    title, setTitle,
    options, setOptions,
    uploadingFile, setUploadingFile,
    uploadedFileName, setUploadedFileName,
    extractedTable, setExtractedTable,
    previewType, setPreviewType,
  }
}
