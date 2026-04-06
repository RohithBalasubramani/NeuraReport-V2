import { neutral } from '@/app/theme'
import KeyboardIcon from '@mui/icons-material/Keyboard'
import { Box, Stack, Typography, alpha } from '@mui/material'
import { EDITOR_SHORTCUTS } from '../hooks/useEditorKeyboardShortcuts'
import { ShortcutDisplay } from '../atoms/ShortcutKey'

export function KeyboardShortcutsPanel({ compact = false }) {
  if (compact) {
    return (
      <Stack
        direction="row"
        spacing={2}
        sx={{
          py: 1, px: 1.5, borderRadius: 1,
          bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.04) : neutral[50],
          border: '1px solid',
          borderColor: (theme) => alpha(theme.palette.divider, 0.1),
        }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center">
          <KeyboardIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          <Typography variant="caption" color="text.disabled">Shortcuts:</Typography>
        </Stack>
        {EDITOR_SHORTCUTS.slice(0, 3).map((shortcut) => (
          <Stack key={shortcut.key} direction="row" spacing={0.5} alignItems="center">
            <ShortcutDisplay shortcutKey={shortcut.key} />
            <Typography variant="caption" color="text.secondary">{shortcut.label}</Typography>
          </Stack>
        ))}
      </Stack>
    )
  }

  return (
    <Box sx={{ p: 2, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        <KeyboardIcon fontSize="small" color="action" />
        <Typography variant="subtitle2">Keyboard Shortcuts</Typography>
      </Stack>
      <Stack spacing={1.5}>
        {EDITOR_SHORTCUTS.map((shortcut) => (
          <Stack key={shortcut.key} direction="row" justifyContent="space-between" alignItems="center">
            <Box>
              <Typography variant="body2">{shortcut.label}</Typography>
              <Typography variant="caption" color="text.secondary">{shortcut.description}</Typography>
            </Box>
            <ShortcutDisplay shortcutKey={shortcut.key} />
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}
