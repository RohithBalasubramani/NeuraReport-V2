import { useState } from 'react'

/**
 * Manages feedback component state (thumbs, ratings).
 */
export function useFeedbackState() {
  const [value, setValue] = useState(null)
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)

  return {
    value, setValue,
    showComment, setShowComment,
    comment, setComment,
    submitted, setSubmitted,
  }
}
