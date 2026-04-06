import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'

const ACCEPTED_TYPES = '.pdf,.xlsx,.xls,.csv'
const MAX_FILE_SIZE_MB = 50

function validateDocumentFile(file) {
  if (!file) return { valid: false, error: 'No file selected.' }
  const ext = file.name.split('.').pop()?.toLowerCase()
  const allowed = ['pdf', 'xlsx', 'xls', 'csv']
  if (!allowed.includes(ext)) {
    return { valid: false, error: `Unsupported file type .${ext}. Allowed: ${allowed.join(', ')}` }
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return { valid: false, error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.` }
  }
  return { valid: true, error: null }
}

export function DocumentUpload({
  onFileSelect,
  isUploading = false,
  progress = 0,
  progressStage = '',
  error = null,
  disabled = false,
}) {
  const [dragActive, setDragActive] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [validationError, setValidationError] = useState(null)

  const handleDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }, [])

  const processFile = useCallback((file) => {
    setValidationError(null)
    const validation = validateDocumentFile(file)
    if (!validation.valid) {
      setValidationError(validation.error)
      setSelectedFile(null)
      return
    }
    setSelectedFile(file)
    onFileSelect?.(file)
  }, [onFileSelect])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (disabled || isUploading) return
    const files = e.dataTransfer?.files
    if (files && files.length > 0) processFile(files[0])
  }, [disabled, isUploading, processFile])

  const handleFileInput = useCallback((e) => {
    const files = e.target?.files
    if (files && files.length > 0) processFile(files[0])
    e.target.value = ''
  }, [processFile])

  const handleClear = useCallback(() => {
    setSelectedFile(null)
    setValidationError(null)
    onFileSelect?.(null)
  }, [onFileSelect])

  const displayError = error || validationError

  return (
    <Paper
      variant="outlined"
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      sx={{
        p: 4, textAlign: 'center',
        cursor: disabled || isUploading ? 'default' : 'pointer',
        transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
        borderStyle: 'dashed', borderWidth: 2,
        borderColor: dragActive ? 'text.secondary' : displayError ? 'text.secondary' : selectedFile ? 'text.secondary' : 'divider',
        bgcolor: dragActive ? 'action.hover' : displayError ? 'error.lighter' : selectedFile ? 'success.lighter' : 'background.paper',
        '&:hover': { borderColor: disabled || isUploading ? undefined : 'text.secondary', bgcolor: disabled || isUploading ? undefined : 'action.hover' },
      }}
    >
      <input type="file" accept={ACCEPTED_TYPES} onChange={handleFileInput} disabled={disabled || isUploading} style={{ display: 'none' }} id="document-upload-input" />
      {isUploading ? (
        <Stack spacing={2} alignItems="center">
          <Typography variant="body1" color="text.secondary">{progressStage || 'Analyzing document...'}</Typography>
          <Box sx={{ width: '100%', maxWidth: 400 }}><LinearProgress variant="determinate" value={progress} /></Box>
          <Typography variant="body2" color="text.secondary">{progress}% complete</Typography>
        </Stack>
      ) : selectedFile ? (
        <Stack spacing={2} alignItems="center">
          <CheckCircleIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
          <Stack direction="row" spacing={1} alignItems="center">
            <InsertDriveFileIcon color="action" />
            <Typography variant="body1">{selectedFile.name}</Typography>
            <Chip size="small" label={`${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`} variant="outlined" />
          </Stack>
          <Button variant="outlined" size="small" onClick={handleClear}>Choose different file</Button>
        </Stack>
      ) : (
        <label htmlFor="document-upload-input" style={{ cursor: disabled ? 'default' : 'pointer' }}>
          <Stack spacing={2} alignItems="center">
            <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
            <Typography variant="h6" color="text.primary">Drop a document here or click to browse</Typography>
            <Typography variant="body2" color="text.secondary">Supports PDF and Excel files (max 50MB)</Typography>
            <Stack direction="row" spacing={1}>
              <Chip label="PDF" size="small" variant="outlined" />
              <Chip label="XLSX" size="small" variant="outlined" />
              <Chip label="XLS" size="small" variant="outlined" />
            </Stack>
          </Stack>
        </label>
      )}
      {displayError && <Alert severity="error" sx={{ mt: 2, textAlign: 'left' }}>{displayError}</Alert>}
    </Paper>
  )
}
