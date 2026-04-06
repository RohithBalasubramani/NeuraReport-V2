import { Box } from '@mui/material'
import { styled } from '@mui/material/styles'
import { fadeInUp } from '@/styles/styles'

/** Padded page with max-width constraint (reports, connections, jobs, etc.) */
export const PaddedPageContainer = styled(Box)(({ theme }) => ({
  padding: theme.spacing(3),
  maxWidth: 1400,
  margin: '0 auto',
  width: '100%',
  minHeight: '100vh',
  backgroundColor: theme.palette.background.default,
  animation: `${fadeInUp} 0.5s ease-out`,
}))

/** Full-height flex page (dashboards, documents, agents, etc.) */
export const FullHeightPageContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: 'calc(100vh - 64px)',
  backgroundColor: theme.palette.background.default,
}))
