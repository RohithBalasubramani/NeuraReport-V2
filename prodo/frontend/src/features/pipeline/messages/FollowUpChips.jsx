import React from 'react'
import { Box, Chip, Stack } from '@mui/material'
import usePipelineStore from '@/stores/pipeline'

export default function FollowUpChips({ message }) {
  const { questions = [] } = message.data || {}

  if (!questions.length) return null

  const handleClick = (question) => {
    usePipelineStore.getState().setInputValue(question)
  }

  return (
    <Box sx={{ mb: 2, pl: 5 }}>
      <Stack direction="row" flexWrap="wrap" gap={0.75}>
        {questions.map((q, i) => (
          <Chip
            key={i}
            label={q}
            size="small"
            variant="outlined"
            color="primary"
            onClick={() => handleClick(q)}
            sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'primary.50' } }}
          />
        ))}
      </Stack>
    </Box>
  )
}
