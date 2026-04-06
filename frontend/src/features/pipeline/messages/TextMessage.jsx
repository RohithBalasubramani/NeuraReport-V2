import React from 'react'
import { Box, Typography } from '@mui/material'
import { Person as UserIcon, SmartToy as AssistantIcon } from '@mui/icons-material'

export default function TextMessage({ message }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        alignItems: 'flex-start',
        flexDirection: isUser ? 'row-reverse' : 'row',
        mb: 2,
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: isUser ? 'primary.main' : isSystem ? 'grey.400' : 'secondary.main',
          color: 'white',
          flexShrink: 0,
        }}
      >
        {isUser ? <UserIcon sx={{ fontSize: 18 }} /> : <AssistantIcon sx={{ fontSize: 18 }} />}
      </Box>
      <Box
        sx={{
          maxWidth: '75%',
          bgcolor: isUser ? 'primary.50' : 'grey.50',
          borderRadius: 2,
          px: 2,
          py: 1.5,
          position: 'relative',
        }}
      >
        <Typography
          variant="body2"
          sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
        >
          {message.content}
          {message.streaming && (
            <Box
              component="span"
              sx={{
                display: 'inline-block',
                width: 6,
                height: 16,
                bgcolor: 'text.primary',
                ml: 0.5,
                animation: 'blink 1s step-end infinite',
                '@keyframes blink': { '50%': { opacity: 0 } },
              }}
            />
          )}
        </Typography>
      </Box>
    </Box>
  )
}
