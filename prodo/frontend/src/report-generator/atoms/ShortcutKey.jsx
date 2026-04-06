import { Box, Stack, alpha } from '@mui/material'
import { getShortcutDisplay } from '../hooks/useEditorKeyboardShortcuts'

export function ShortcutKey({ children }) {
  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        px: 0.75, py: 0.25, minWidth: 24, height: 22, borderRadius: 0.5,
        bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
        boxShadow: (theme) => `0 1px 0 ${alpha(theme.palette.common.black, 0.1)}`,
        fontFamily: 'monospace', fontSize: '12px', fontWeight: 600, color: 'text.secondary',
      }}
    >
      {children}
    </Box>
  )
}

export function ShortcutDisplay({ shortcutKey }) {
  const display = getShortcutDisplay(shortcutKey)
  const parts = display.split('+')
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {parts.map((part, idx) => (
        <ShortcutKey key={idx}>{part}</ShortcutKey>
      ))}
    </Stack>
  )
}
