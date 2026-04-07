import React from 'react'
import { Box, Typography } from '@mui/material'
import { Person as UserIcon, SmartToy as AssistantIcon } from '@mui/icons-material'
import ReactMarkdown from 'react-markdown'

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
        <Box
          sx={{
            lineHeight: 1.6,
            fontSize: '0.875rem',
            '& p': { m: 0, mb: 1, '&:last-child': { mb: 0 } },
            '& ul, & ol': { mt: 0, mb: 1, pl: 2.5 },
            '& li': { mb: 0.5 },
            '& strong': { fontWeight: 600 },
            '& code': {
              bgcolor: 'grey.200',
              px: 0.5,
              borderRadius: 0.5,
              fontSize: '0.8rem',
            },
          }}
        >
          {isUser ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {message.content}
            </Typography>
          ) : (
            <ReactMarkdown>{message.content}</ReactMarkdown>
          )}
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
        </Box>
      </Box>
    </Box>
  )
}
