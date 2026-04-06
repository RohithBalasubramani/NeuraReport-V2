/**
 * MessageRenderer — dispatches to type-specific message components.
 * Chat only contains: text, file_upload, error, follow_up, evolving_progress.
 * All interactive UI (mapping, batches, proposed changes) lives in the right panel.
 */
import React from 'react'
import TextMessage from './messages/TextMessage'
import FileUploadMessage from './messages/FileUploadMessage'
import ErrorMessage from './messages/ErrorMessage'
import FollowUpChips from './messages/FollowUpChips'
import EvolvingProgress from './EvolvingProgress'

const RENDERERS = {
  text: TextMessage,
  file_upload: FileUploadMessage,
  error: ErrorMessage,
  follow_up: FollowUpChips,
  evolving_progress: EvolvingProgress,
}

export default function MessageRenderer({ message }) {
  const Component = RENDERERS[message.type] || TextMessage
  return <Component message={message} />
}
