import { useState } from 'react'

/**
 * Manages template selection/upload step state in setup wizard.
 */
export function useSetupTemplateState(wizardState) {
  const [templateKind, setTemplateKind] = useState(wizardState.templateKind || 'pdf')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [verifyResult, setVerifyResult] = useState(null)
  const [error, setError] = useState(null)
  const [queueInBackground, setQueueInBackground] = useState(false)
  const [queuedJobId, setQueuedJobId] = useState(null)
  const [selectedGalleryTemplate, setSelectedGalleryTemplate] = useState(null)
  const [showUpload, setShowUpload] = useState(false)

  return {
    templateKind, setTemplateKind,
    uploading, setUploading,
    uploadProgress, setUploadProgress,
    uploadedFile, setUploadedFile,
    verifyResult, setVerifyResult,
    error, setError,
    queueInBackground, setQueueInBackground,
    queuedJobId, setQueuedJobId,
    selectedGalleryTemplate, setSelectedGalleryTemplate,
    showUpload, setShowUpload,
  }
}
