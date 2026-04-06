/**
 * Team Activity — Real-time multi-agent team activity view.
 *
 * Shows which agents are active in a team task, message flow
 * between agents (chat-style view), and individual progress.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react'
import {
  Box,
  Typography,
  Paper,
  Avatar,
  Chip,
  Stack,
  LinearProgress,
  Collapse,
  IconButton,
  Tooltip,
} from '@mui/material'
import {
  SmartToy as AgentIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Groups as TeamIcon,
} from '@mui/icons-material'

const agentColors = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#06B6D4', // cyan
]

function AgentAvatar({ name, index, isActive }) {
  const color = agentColors[index % agentColors.length]
  const initials = name
    .split(/[\s_]+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <Tooltip title={name}>
      <Avatar
        sx={{
          width: 32,
          height: 32,
          bgcolor: color,
          fontSize: '0.75rem',
          fontWeight: 600,
          ...(isActive && {
            boxShadow: `0 0 0 2px ${color}40`,
            animation: 'agentPulse 2s ease-in-out infinite',
            '@keyframes agentPulse': {
              '0%, 100%': { boxShadow: `0 0 0 2px ${color}40` },
              '50%': { boxShadow: `0 0 0 4px ${color}60` },
            },
          }),
        }}
      >
        {initials}
      </Avatar>
    </Tooltip>
  )
}

function MessageBubble({ message, agentIndex }) {
  const color = agentColors[agentIndex % agentColors.length]
  const isSystem = message.agent_name === 'system'

  if (isSystem) {
    return (
      <Box sx={{ textAlign: 'center', py: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
          {message.content}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'flex-start' }}>
      <AgentAvatar name={message.agent_name} index={agentIndex} isActive={false} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.25 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color }}>
            {message.agent_name}
          </Typography>
          {message.role && (
            <Typography variant="caption" color="text.secondary">
              ({message.role})
            </Typography>
          )}
          {message.round_num > 0 && (
            <Chip label={`R${message.round_num}`} size="small" sx={{ height: 16, fontSize: '0.6rem' }} />
          )}
        </Stack>
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: 2,
            borderColor: `${color}30`,
            bgcolor: `${color}08`,
            fontSize: '0.85rem',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {message.content?.length > 500
            ? message.content.slice(0, 500) + '...'
            : message.content}
        </Paper>
      </Box>
    </Box>
  )
}

export default function TeamActivity({ teamData, compact = false }) {
  const [expanded, setExpanded] = useState(!compact)
  const [showAllMessages, setShowAllMessages] = useState(false)
  const chatEndRef = useRef(null)

  const {
    teamName = 'Multi-Agent Team',
    agents = [],
    messages = [],
    currentAgent = null,
    roundsCompleted = 0,
    totalRounds = 0,
    status = 'idle',
    progress = 0,
    usedAutogen = false,
  } = teamData || {}

  // Build agent name -> index mapping
  const agentIndexMap = useMemo(() => {
    const map = {}
    agents.forEach((a, i) => {
      map[a.name || a] = i
    })
    return map
  }, [agents])

  // Auto-scroll to latest message
  useEffect(() => {
    if (chatEndRef.current && expanded) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, expanded])

  const visibleMessages = showAllMessages ? messages : messages.slice(-10)

  if (!teamData) return null

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        overflow: 'hidden',
        borderColor: status === 'running' ? 'primary.main' : undefined,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'action.hover',
          cursor: compact ? 'pointer' : undefined,
        }}
        onClick={compact ? () => setExpanded((e) => !e) : undefined}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <TeamIcon sx={{ fontSize: 20, color: 'primary.main' }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {teamName}
          </Typography>
          <Chip
            label={status}
            size="small"
            color={
              status === 'running' ? 'primary' : status === 'completed' ? 'success' : 'default'
            }
            sx={{ height: 20, textTransform: 'capitalize', fontSize: '0.7rem' }}
          />
          {usedAutogen && (
            <Chip label="AutoGen" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
          )}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          {roundsCompleted > 0 && (
            <Typography variant="caption" color="text.secondary">
              Round {roundsCompleted}/{totalRounds}
            </Typography>
          )}
          {compact && (
            <IconButton size="small">
              {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          )}
        </Stack>
      </Box>

      {status === 'running' && <LinearProgress sx={{ height: 3 }} />}

      <Collapse in={expanded}>
        {/* Agent roster */}
        <Box sx={{ p: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
          {agents.map((agent, i) => {
            const name = agent.name || agent
            const role = agent.role || ''
            const isActive = currentAgent === name

            return (
              <Chip
                key={name}
                avatar={<AgentAvatar name={name} index={i} isActive={isActive} />}
                label={role ? `${name} (${role})` : name}
                size="small"
                variant={isActive ? 'filled' : 'outlined'}
                color={isActive ? 'primary' : 'default'}
                sx={{ borderRadius: 2 }}
              />
            )
          })}
        </Box>

        {/* Message stream */}
        <Box sx={{ p: 1.5, maxHeight: 400, overflow: 'auto' }}>
          {messages.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
              {status === 'running' ? 'Waiting for agent messages...' : 'No messages yet'}
            </Typography>
          ) : (
            <>
              {!showAllMessages && messages.length > 10 && (
                <Box sx={{ textAlign: 'center', mb: 1 }}>
                  <Chip
                    label={`Show ${messages.length - 10} earlier messages`}
                    size="small"
                    onClick={() => setShowAllMessages(true)}
                    sx={{ cursor: 'pointer' }}
                  />
                </Box>
              )}
              {visibleMessages.map((msg, i) => (
                <MessageBubble
                  key={`${msg.agent_name}-${msg.round_num}-${i}`}
                  message={msg}
                  agentIndex={agentIndexMap[msg.agent_name] || 0}
                />
              ))}
              <div ref={chatEndRef} />
            </>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}
