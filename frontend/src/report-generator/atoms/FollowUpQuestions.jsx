import LightbulbIcon from '@mui/icons-material/Lightbulb'
import { Box, Button, Stack, Typography, alpha } from '@mui/material'

export function FollowUpQuestions({ questions, onQuestionClick }) {
  if (!questions || !Array.isArray(questions) || questions.length === 0) return null

  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 1 }}>
        <LightbulbIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography variant="caption" fontWeight={600} color="text.secondary">
          Suggestions
        </Typography>
      </Stack>
      <Stack spacing={0.75}>
        {questions.map((question, idx) => (
          <Button
            key={idx}
            size="small"
            variant="outlined"
            onClick={() => onQuestionClick(question)}
            sx={{
              textTransform: 'none',
              justifyContent: 'flex-start',
              textAlign: 'left',
              fontWeight: 400,
              fontSize: '0.8125rem',
              color: 'text.secondary',
              borderColor: (theme) => alpha(theme.palette.divider, 0.5),
              '&:hover': {
                borderColor: 'text.secondary',
                bgcolor: (theme) => alpha(theme.palette.action.hover, 0.5),
              },
            }}
          >
            {question}
          </Button>
        ))}
      </Stack>
    </Box>
  )
}
