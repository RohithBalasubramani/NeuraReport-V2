/**
 * ChatInput — multiline text input with file attach, slash commands, and send.
 *
 * The attach button (paperclip) opens a file picker for ANY file type.
 * Files are attached as context/reference for the chat message — images,
 * docs, PDFs, spreadsheets, text files, etc. The LLM can read them.
 *
 * Template creation (PDF/Excel → pipeline) is a separate flow triggered
 * by the Upload panel or drag-drop onto the upload area, NOT this button.
 */
import React, { useCallback, useRef, useState } from 'react'
import {
  Box, Chip, IconButton, InputBase, List, ListItem,
  ListItemText, Paper, Stack, Tooltip, CircularProgress, Typography,
} from '@mui/material'
import {
  Send as SendIcon, AttachFile as AttachIcon,
  Image as ImageIcon, Close as CloseIcon, InsertDriveFile as FileIcon,
} from '@mui/icons-material'
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

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ChatInput({ onSend, onAttach }) {
  const inputValue = usePipelineStore(s => s.inputValue)
  const isProcessing = usePipelineStore(s => s.isProcessing)
  const setInputValue = usePipelineStore(s => s.setInputValue)
  const fileInputRef = useRef(null)
  const inputRef = useRef(null)
  const [showSlash, setShowSlash] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [pendingFiles, setPendingFiles] = useState([])

  const filteredCommands = SLASH_COMMANDS.filter(c =>
    c.command.startsWith(`/${slashFilter}`) || c.label.toLowerCase().includes(slashFilter.toLowerCase())
  )

  const handleSend = useCallback(() => {
    const text = inputValue.trim()
    if (isProcessing) return
    if (!text && pendingFiles.length === 0) return

    // Check for slash command
    if (text) {
      const slashMatch = text.match(/^\/(\w+)/)
      if (slashMatch) {
        const cmd = SLASH_COMMANDS.find(c => c.command === `/${slashMatch[1]}`)
        if (cmd) {
          setInputValue('')
          setShowSlash(false)
          onSend?.(cmd.command)
          return
        }
      }
    }

    setInputValue('')
    setShowSlash(false)

    if (pendingFiles.length > 0) {
      onAttach?.(text || 'Here are the files I attached.', pendingFiles)
      setPendingFiles([])
    } else {
      onSend(text)
    }
  }, [inputValue, isProcessing, setInputValue, onSend, onAttach, pendingFiles])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (showSlash && filteredCommands.length > 0) {
        const cmd = filteredCommands[0]
        setInputValue('')
        setShowSlash(false)
        onSend?.(cmd.command)
      } else {
        handleSend()
      }
    }
    if (e.key === 'Escape') setShowSlash(false)
  }, [handleSend, showSlash, filteredCommands, setInputValue, onSend])

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
    onSend?.(cmd.command)
  }, [setInputValue, onSend])

  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) setPendingFiles(prev => [...prev, ...files])
    if (fileInputRef.current) fileInputRef.current.value = ''
    setTimeout(() => inputRef.current?.querySelector('input, textarea')?.focus(), 100)
  }, [])

  const removeFile = useCallback((idx) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer?.files || [])
    if (files.length > 0) setPendingFiles(prev => [...prev, ...files])
  }, [])

  const isImage = (file) => file.type?.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(file.name)

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

      {/* Pending files bar */}
      {pendingFiles.length > 0 && (
        <Stack direction="row" spacing={0.5} sx={{ mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
          {pendingFiles.map((file, i) => (
            <Chip
              key={`${file.name}-${i}`}
              icon={isImage(file) ? <ImageIcon sx={{ fontSize: 14 }} /> : <FileIcon sx={{ fontSize: 14 }} />}
              label={`${file.name} (${formatSize(file.size)})`}
              size="small"
              variant="outlined"
              onDelete={() => removeFile(i)}
              deleteIcon={<CloseIcon sx={{ fontSize: 14 }} />}
              sx={{ maxWidth: 220, fontSize: '0.7rem' }}
            />
          ))}
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', pl: 0.5 }}>
            Type a message and press Enter
          </Typography>
        </Stack>
      )}

      <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, p: 1, borderRadius: 3 }}>
        <input ref={fileInputRef} type="file" hidden multiple onChange={handleFileSelect} />

        <Tooltip title="Attach files for context">
          <IconButton size="small" onClick={() => fileInputRef.current?.click()} disabled={isProcessing}>
            <AttachIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <InputBase
          ref={inputRef}
          multiline
          maxRows={6}
          placeholder={pendingFiles.length > 0 ? 'Add a message about the attached files...' : 'Type a message or use /commands...'}
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
              <IconButton
                size="small"
                color="primary"
                onClick={handleSend}
                disabled={!inputValue.trim() && pendingFiles.length === 0}
              >
                <SendIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Paper>
    </Box>
  )
}
