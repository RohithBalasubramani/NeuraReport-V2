import { neutral } from '@/app/theme'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined'
import { Box, Stack, Typography, alpha } from '@mui/material'

const ROLE_CONFIG = {
  user: {
    icon: PersonOutlineIcon,
    label: 'You',
    bgcolor: neutral[900],
    textColor: 'common.white',
  },
  assistant: {
    icon: SmartToyOutlinedIcon,
    label: 'NeuraReport',
    bgcolor: 'background.paper',
    textColor: 'text.primary',
  },
}

export function ChatMessage({ message }) {
  const { role, content, timestamp } = message
  const config = ROLE_CONFIG[role] || ROLE_CONFIG.assistant
  const Icon = config.icon
  const isUser = role === 'user'

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 1.5,
        px: 2,
        py: 1.5,
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          bgcolor: config.bgcolor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon sx={{ fontSize: 18, color: config.textColor }} />
      </Box>
      <Box sx={{ maxWidth: '80%', minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <Typography variant="caption" fontWeight={600} color="text.secondary">
            {config.label}
          </Typography>
          {timestamp && (
            <Typography variant="caption" color="text.disabled">
              {new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </Typography>
          )}
        </Stack>
        <Box
          sx={{
            py: 1.5,
            px: 2,
            borderRadius: 1.5,
            bgcolor: isUser
              ? (theme) => (theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100])
              : 'background.paper',
            border: isUser ? 'none' : '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.6,
            }}
          >
            {content}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
