import { ThemeProvider as MuiThemeProvider, CssBaseline } from '@mui/material'
import theme from './muiTheme'

export function ThemeProvider({ children }) {
  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  )
}
