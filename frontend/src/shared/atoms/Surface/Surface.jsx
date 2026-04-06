import Paper from '@mui/material/Paper'
import { forwardRef } from 'react'

const baseSx = {
  p: { xs: 3, md: 3.5 },
  display: 'flex',
  flexDirection: 'column',
  gap: { xs: 2, md: 2.5 },
  backgroundColor: 'background.paper',
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
}

export const Surface = forwardRef(function Surface(
  { children, sx = [], variant = 'outlined', elevation = 0, ...props },
  ref,
) {
  const sxArray = Array.isArray(sx) ? sx : [sx]
  return (
    <Paper
      ref={ref}
      variant={variant}
      elevation={elevation}
      {...props}
      sx={[
        baseSx,
        ...sxArray,
      ]}
    >
      {children}
    </Paper>
  )
})
