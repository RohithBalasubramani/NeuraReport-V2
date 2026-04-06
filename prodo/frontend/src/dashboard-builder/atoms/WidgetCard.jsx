import { neutral } from '@/app/theme'
import { Box, Card, Typography, alpha, styled } from '@mui/material'

export const WidgetCardStyled = styled(Card)(({ theme }) => ({
  cursor: 'pointer',
  padding: theme.spacing(1.5),
  borderRadius: 8,
  border: `1px solid ${theme.palette.divider}`,
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
    transform: 'translateY(-2px)',
    boxShadow: theme.palette.mode === 'dark'
      ? `0 4px 12px ${alpha(theme.palette.common.black, 0.3)}`
      : '0 4px 12px rgba(0,0,0,0.08)',
  },
}))

export function WidgetCard({ icon: Icon, label, description, onClick }) {
  return (
    <WidgetCardStyled onClick={onClick}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {Icon && <Icon fontSize="small" color="action" />}
        <Box>
          <Typography variant="body2" fontWeight={600}>{label}</Typography>
          {description && (
            <Typography variant="caption" color="text.secondary">{description}</Typography>
          )}
        </Box>
      </Box>
    </WidgetCardStyled>
  )
}
