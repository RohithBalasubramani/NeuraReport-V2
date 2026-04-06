import { Button as MuiButton } from '@mui/material'
import { styled } from '@mui/material/styles'

/** Standard action button with consistent border-radius and weight */
export const ActionButton = styled(MuiButton)(({ theme }) => ({
  borderRadius: 8,
  textTransform: 'none',
  fontWeight: 500,
}))
