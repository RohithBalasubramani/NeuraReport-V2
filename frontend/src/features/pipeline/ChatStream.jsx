/**
 * ChatStream — scrollable message list.
 */
import React, { useEffect, useRef } from 'react'
import { Box } from '@mui/material'
import MessageRenderer from './MessageRenderer'
import usePipelineStore from '@/stores/pipeline'

export default function ChatStream({ onAction }) {
  const messages = usePipelineStore((s) => s.messages)
  const bottomRef = useRef(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content])

  return (
    <Box
      sx={{
        flex: 1,
        overflow: 'auto',
        px: 2,
        py: 2,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {messages.map((msg) => (
        <MessageRenderer key={msg.id} message={msg} onAction={onAction} />
      ))}
      <div ref={bottomRef} />
    </Box>
  )
}
