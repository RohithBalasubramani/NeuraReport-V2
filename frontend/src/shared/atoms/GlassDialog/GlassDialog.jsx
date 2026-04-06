import { Dialog, alpha } from '@mui/material'
import { styled } from '@mui/material/styles'
import { fadeInUp } from '@/styles/styles'

/** Glass-morphism dialog used across features */
export const GlassDialog = styled(Dialog)(({ theme }) => ({
  '& .MuiBackdrop-root': {
    backgroundColor: alpha(theme.palette.common.black, 0.6),
    backdropFilter: 'blur(8px)',
  },
  '& .MuiDialog-paper': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    borderRadius: '8px',
    boxShadow: `0 24px 64px ${alpha(theme.palette.common.black, 0.25)}`,
    animation: `${fadeInUp} 0.3s ease-out`,
  },
}))
