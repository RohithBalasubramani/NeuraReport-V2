/**
 * Feedback Panel — Quality feedback collection UI.
 *
 * Provides thumbs up/down, star rating, and inline correction
 * tools for reports, mappings, and agent results.
 */
import React, { useState, useCallback } from 'react'
import {
  Box,
  Typography,
  IconButton,
  Stack,
  Tooltip,
  TextField,
  Button,
  Rating,
  Chip,
  Collapse,
  Paper,
  Snackbar,
  Alert,
} from '@mui/material'
import {
  ThumbUp as ThumbUpIcon,
  ThumbUpOutlined as ThumbUpOutlinedIcon,
  ThumbDown as ThumbDownIcon,
  ThumbDownOutlined as ThumbDownOutlinedIcon,
  Star as StarIcon,
  Send as SendIcon,
} from '@mui/icons-material'
import { api } from '@/api/client'

/**
 * Inline thumbs up/down feedback widget.
 * Use in report results, agent outputs, etc.
 */
export function ThumbsFeedback({ entityType, entityId, onSubmit, size = 'small' }) {
  const [value, setValue] = useState(null) // null | 'up' | 'down'
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleThumb = useCallback(
    async (thumbValue) => {
      if (submitted) return

      const newValue = value === thumbValue ? null : thumbValue
      setValue(newValue)

      if (newValue === 'down') {
        setShowComment(true)
        return
      }

      if (newValue === 'up') {
        try {
          const payload = {
            entity_type: entityType,
            entity_id: entityId,
            thumbs_up: true,
          }
          if (onSubmit) {
            await onSubmit(payload)
          }
          setSubmitted(true)
        } catch (err) {
          console.error('Failed to submit feedback:', err)
        }
      }
    },
    [value, entityType, entityId, submitted, onSubmit]
  )

  const handleSubmitComment = useCallback(async () => {
    try {
      const payload = {
        entity_type: entityType,
        entity_id: entityId,
        thumbs_up: false,
        comment,
      }
      if (onSubmit) {
        await onSubmit(payload)
      }
      setSubmitted(true)
      setShowComment(false)
    } catch (err) {
      console.error('Failed to submit feedback:', err)
    }
  }, [entityType, entityId, comment, onSubmit])

  if (submitted) {
    return (
      <Typography variant="caption" color="text.secondary">
        Thanks for your feedback!
      </Typography>
    )
  }

  return (
    <Box>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Tooltip title="Helpful">
          <IconButton
            size={size}
            onClick={() => handleThumb('up')}
            color={value === 'up' ? 'primary' : 'default'}
          >
            {value === 'up' ? <ThumbUpIcon fontSize="small" /> : <ThumbUpOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Not helpful">
          <IconButton
            size={size}
            onClick={() => handleThumb('down')}
            color={value === 'down' ? 'error' : 'default'}
          >
            {value === 'down' ? <ThumbDownIcon fontSize="small" /> : <ThumbDownOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>

      <Collapse in={showComment}>
        <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            placeholder="What could be improved?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            sx={{ flex: 1 }}
            multiline
            maxRows={3}
          />
          <Button
            variant="contained"
            size="small"
            onClick={handleSubmitComment}
            disabled={!comment.trim()}
            sx={{ minWidth: 0, px: 1.5 }}
          >
            <SendIcon fontSize="small" />
          </Button>
        </Box>
      </Collapse>
    </Box>
  )
}

/**
 * Star rating feedback widget.
 * Use for report quality ratings.
 */
export function StarRating({ entityType, entityId, onSubmit }) {
  const [rating, setRating] = useState(null)
  const [hover, setHover] = useState(-1)
  const [submitted, setSubmitted] = useState(false)

  const handleRate = useCallback(
    async (event, newValue) => {
      setRating(newValue)
      if (newValue) {
        try {
          const payload = {
            entity_type: entityType,
            entity_id: entityId,
            rating: newValue / 5.0, // Normalize to 0-1
          }
          if (onSubmit) {
            await onSubmit(payload)
          }
          setSubmitted(true)
        } catch (err) {
          console.error('Failed to submit rating:', err)
        }
      }
    },
    [entityType, entityId, onSubmit]
  )

  if (submitted) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Rating value={rating} readOnly size="small" />
        <Typography variant="caption" color="text.secondary">
          Rated!
        </Typography>
      </Stack>
    )
  }

  return (
    <Rating
      value={rating}
      onChange={handleRate}
      onChangeActive={(event, newHover) => setHover(newHover)}
      size="small"
      emptyIcon={<StarIcon style={{ opacity: 0.3 }} fontSize="inherit" />}
    />
  )
}

/**
 * Quality score display badge.
 */
export function QualityBadge({ score, label = 'Quality' }) {
  const getColor = (s) => {
    if (s >= 0.8) return 'success'
    if (s >= 0.6) return 'warning'
    return 'error'
  }

  const getLabel = (s) => {
    if (s >= 0.8) return 'High'
    if (s >= 0.6) return 'Medium'
    return 'Low'
  }

  if (score === null || score === undefined) return null

  return (
    <Tooltip title={`${label}: ${(score * 100).toFixed(0)}%`}>
      <Chip
        label={`${getLabel(score)} (${(score * 100).toFixed(0)}%)`}
        size="small"
        color={getColor(score)}
        variant="outlined"
        sx={{ height: 22, fontSize: '0.7rem' }}
      />
    </Tooltip>
  )
}

/**
 * Full feedback panel — combines thumbs, rating, and correction tools.
 */
export default function FeedbackPanel({
  entityType,
  entityId,
  showRating = true,
  showThumbs = true,
  showQuality = true,
  qualityScore = null,
  onFeedbackSubmit,
}) {
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' })

  const handleSubmit = useCallback(
    async (payload) => {
      try {
        if (onFeedbackSubmit) {
          await onFeedbackSubmit(payload)
        } else {
          // Default: POST directly to feedback API
          if (payload.thumbs_up !== undefined) {
            await api.post('/feedback/thumbs', payload)
          } else if (payload.rating !== undefined) {
            await api.post('/feedback/rating', payload)
          }
        }
        setToast({ open: true, message: 'Feedback submitted!', severity: 'success' })
      } catch (err) {
        setToast({ open: true, message: 'Failed to submit feedback', severity: 'error' })
      }
    },
    [onFeedbackSubmit]
  )

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
        {showQuality && qualityScore !== null && <QualityBadge score={qualityScore} />}

        {showThumbs && (
          <ThumbsFeedback
            entityType={entityType}
            entityId={entityId}
            onSubmit={handleSubmit}
          />
        )}

        {showRating && (
          <StarRating
            entityType={entityType}
            entityId={entityId}
            onSubmit={handleSubmit}
          />
        )}
      </Stack>

      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Paper>
  )
}
