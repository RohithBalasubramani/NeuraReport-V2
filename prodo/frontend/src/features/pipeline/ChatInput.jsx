/**
 * ChatInput — multiline text input with file drop, slash commands, and send.
 */
import React, { useCallback, useRef, useState } from 'react'
import {
  Box, IconButton, InputBase, List, ListItem, ListItemText, Paper, Popper, Tooltip, CircularProgress,
} from '@mui/material'
import { Send as SendIcon, AttachFile as AttachIcon } from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'

const SLASH_COMMANDS = [
  { command: '/edit', label: 'Make changes to the report', action: 'edit' },
  { command: '/connect', label: 'Connect my database', action: 'map' },
  { command: '/approve', label: 'Looks good, continue', action: 'approve' },
  { command: '/check', label: 'Check for problems', action: 'validate' },
  { command: '/create', label: 'Create my reports', action: 'generate' },
  { command: '/search', label: 'Search the web', action: 'web_search' },
  { command: '/help', label: 'I need help', action: 'clarify' },
  { command: '/status', label: 'Show progress', action: 'status' },
]

export default function ChatInput({ onSend, onFileUpload, onSlashCommand }) {
  const inputValue = usePipelineStore(s => s.inputValue)
  const isProcessing = usePipelineStore(s => s.isProcessing)
  const setInputValue = usePipelineStore(s => s.setInputValue)
  const fileInputRef = useRef(null)
  const inputRef = useRef(null)
  const [showSlash, setShowSlash] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')

  const filteredCommands = SLASH_COMMANDS.filter(c =>
    c.command.startsWith(`/${slashFilter}`) || c.label.toLowerCase().includes(slashFilter.toLowerCase())
  )

  const handleSend = useCallback(() => {
    const text = inputValue.trim()
    if (!text || isProcessing) return

    // Check for slash command
    const slashMatch = text.match(/^\/(\w+)/)
    if (slashMatch) {
      const cmd = SLASH_COMMANDS.find(c => c.command === `/${slashMatch[1]}`)
      if (cmd) {
        setInputValue('')
        setShowSlash(false)
        onSlashCommand?.(cmd.action)
        return
      }
    }

    setInputValue('')
    setShowSlash(false)
    onSend(text)
  }, [inputValue, isProcessing, setInputValue, onSend, onSlashCommand])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (showSlash && filteredCommands.length > 0) {
        // Select first slash command
        const cmd = filteredCommands[0]
        setInputValue('')
        setShowSlash(false)
        onSlashCommand?.(cmd.action)
      } else {
        handleSend()
      }
    }
    if (e.key === 'Escape') {
      setShowSlash(false)
    }
  }, [handleSend, showSlash, filteredCommands, setInputValue, onSlashCommand])

  const handleChange = useCallback((e) => {
    const val = e.target.value
    setInputValue(val)
    if (val.startsWith('/')) {
      setShowSlash(true)
      setSlashFilter(val.slice(1))
    } else {
      setShowSlash(false)
    }
  }, [setInputValue])

  const handleSlashSelect = useCallback((cmd) => {
    setInputValue('')
    setShowSlash(false)
    onSlashCommand?.(cmd.action)
  }, [setInputValue, onSlashCommand])

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) onFileUpload?.(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [onFileUpload])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) onFileUpload?.(file)
  }, [onFileUpload])

  return (
    <Box onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
      {/* Slash command popup */}
      {showSlash && filteredCommands.length > 0 && (
        <Paper variant="outlined" sx={{ mb: 0.5, maxHeight: 200, overflow: 'auto' }}>
          <List dense>
            {filteredCommands.map(cmd => (
              <ListItem
                key={cmd.command}
                onClick={() => handleSlashSelect(cmd)}
                sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'primary.50' } }}
              >
                <ListItemText
                  primary={cmd.command}
                  secondary={cmd.label}
                  primaryTypographyProps={{ fontFamily: 'monospace', fontWeight: 600 }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, p: 1, borderRadius: 3 }}>
        <input ref={fileInputRef} type="file" accept=".pdf,.xlsx,.xls" hidden onChange={handleFileSelect} />
        <Tooltip title="Attach PDF or Excel file">
          <IconButton size="small" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
            <AttachIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <InputBase
          ref={inputRef}
          multiline
          maxRows={6}
          placeholder="Type a message or use /commands..."
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={isProcessing}
          sx={{ flex: 1, fontSize: '0.9rem', px: 1 }}
        />

        {isProcessing ? (
          <CircularProgress size={24} sx={{ m: 0.5 }} />
        ) : (
          <Tooltip title="Send (Enter)">
            <span>
              <IconButton size="small" color="primary" onClick={handleSend} disabled={!inputValue.trim()}>
                <SendIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Paper>
    </Box>
  )
}
