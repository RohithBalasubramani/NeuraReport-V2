// ==========================================================================
// MUI Theme — built from design tokens
// ==========================================================================
import { alpha, createTheme } from '@mui/material/styles'
import {
  neutral,
  primary,
  status,
  palette,
  fontFamilyDisplay,
  fontFamilyHeading,
  fontFamilyBody,
  fontFamilyMono,
  figmaShadow,
  figmaSpacing,
  figmaComponents,
} from './tokens'

// ---------------------------------------------------------------------------
// Dark / Light palette presets
// ---------------------------------------------------------------------------
const darkTheme = {
  palette: {
    mode: 'dark',
    primary: {
      main: palette.scale[200],
      light: palette.scale[100],
      dark: palette.scale[300],
      lighter: alpha(palette.scale[200], 0.15),
      contrastText: '#000000',
    },
    secondary: {
      main: palette.scale[400],
      light: palette.scale[300],
      dark: palette.scale[500],
      lighter: alpha(palette.scale[400], 0.1),
      contrastText: '#FFFFFF',
    },
    success: {
      main: palette.green[400],
      light: palette.green[300],
      dark: palette.green[500],
      lighter: alpha(palette.green[400], 0.15),
      contrastText: '#000000',
    },
    warning: {
      main: palette.yellow[400],
      light: palette.yellow[300],
      dark: palette.yellow[500],
      lighter: alpha(palette.yellow[400], 0.15),
      contrastText: '#000000',
    },
    error: {
      main: palette.red[500],
      light: palette.red[400],
      dark: palette.red[600],
      lighter: alpha(palette.red[500], 0.15),
      contrastText: '#FFFFFF',
    },
    info: {
      main: palette.scale[400],
      light: palette.scale[300],
      dark: palette.scale[500],
      lighter: alpha(palette.scale[400], 0.1),
      contrastText: '#FFFFFF',
    },
    background: {
      default: palette.scale[1100],
      paper: palette.scale[1000],
      surface: palette.scale[900],
      overlay: palette.scale[800],
    },
    text: {
      primary: palette.scale[100],
      secondary: palette.scale[400],
      disabled: palette.scale[600],
    },
    divider: alpha(palette.scale[100], 0.08),
    action: {
      hover: alpha(palette.scale[100], 0.05),
      selected: alpha(palette.scale[100], 0.08),
      disabled: alpha(palette.scale[100], 0.3),
      disabledBackground: alpha(palette.scale[100], 0.12),
      focus: alpha(palette.scale[100], 0.12),
    },
    grey: palette.scale,
  },
}

const lightTheme = {
  palette: {
    mode: 'light',
    primary: {
      main: primary[500],
      light: primary[300],
      dark: primary[600],
      lighter: primary[50],
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: neutral[700],
      light: neutral[500],
      dark: neutral[900],
      lighter: neutral[100],
      contrastText: '#FFFFFF',
    },
    success: {
      main: status.success,
      light: '#4ADE80',
      dark: '#16A34A',
      lighter: '#D1F4E0',
      contrastText: '#FFFFFF',
    },
    warning: {
      main: status.warning,
      light: '#FBBF24',
      dark: '#D97706',
      lighter: '#FEF3C7',
      contrastText: '#000000',
    },
    error: {
      main: status.destructive,
      light: '#F87171',
      dark: '#DC2626',
      lighter: '#FEE2E2',
      contrastText: '#FFFFFF',
    },
    info: {
      main: neutral[500],
      light: neutral[400],
      dark: neutral[700],
      lighter: neutral[100],
      contrastText: neutral[900],
    },
    background: {
      default: neutral[50],
      paper: '#FFFFFF',
      surface: '#FFFFFF',
      overlay: neutral[100],
      sidebar: neutral[50],
    },
    text: {
      primary: neutral[900],
      secondary: neutral[700],
      disabled: neutral[400],
    },
    divider: neutral[200],
    action: {
      hover: 'rgba(0, 0, 0, 0.04)',
      selected: 'rgba(0, 0, 0, 0.06)',
      disabled: 'rgba(0, 0, 0, 0.26)',
      disabledBackground: 'rgba(0, 0, 0, 0.06)',
      focus: 'rgba(0, 0, 0, 0.08)',
    },
    grey: palette.scale,
  },
}

// ---------------------------------------------------------------------------
// createAppTheme(mode) — full MUI theme factory
// ---------------------------------------------------------------------------
export function createAppTheme(mode = 'dark') {
  const themeOptions = mode === 'dark' ? darkTheme : lightTheme
  const isDark = mode === 'dark'

  return createTheme({
    ...themeOptions,
    shape: {
      borderRadius: 8,
    },
    spacing: 8,

    // ======================================================================
    // TYPOGRAPHY
    // ======================================================================
    typography: {
      fontFamily: fontFamilyBody,
      fontWeightLight: 400,
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightBold: 600,

      displayLarge: {
        fontFamily: fontFamilyDisplay,
        fontSize: '52px',
        fontWeight: 600,
        lineHeight: '56px',
        letterSpacing: '-0.04em',
        '@media (max-width: 768px)': {
          fontSize: '44px',
          lineHeight: '48px',
        },
      },
      displaySmall: {
        fontFamily: fontFamilyDisplay,
        fontSize: '44px',
        fontWeight: 600,
        lineHeight: '48px',
        letterSpacing: '-0.04em',
        '@media (max-width: 768px)': {
          fontSize: '36px',
          lineHeight: '44px',
        },
      },
      h1: {
        fontFamily: fontFamilyHeading,
        fontSize: '40px',
        fontWeight: 600,
        lineHeight: '48px',
        letterSpacing: '0.02em',
        '@media (max-width: 768px)': {
          fontSize: '36px',
          lineHeight: '44px',
        },
      },
      h2: {
        fontFamily: fontFamilyHeading,
        fontSize: '36px',
        fontWeight: 600,
        lineHeight: '44px',
        letterSpacing: '0.02em',
        '@media (max-width: 768px)': {
          fontSize: '32px',
          lineHeight: '40px',
        },
      },
      h3: {
        fontFamily: fontFamilyHeading,
        fontSize: '32px',
        fontWeight: 600,
        lineHeight: '40px',
        letterSpacing: 0,
        '@media (max-width: 768px)': {
          fontSize: '28px',
          lineHeight: '36px',
        },
      },
      h4: {
        fontFamily: fontFamilyHeading,
        fontSize: '28px',
        fontWeight: 500,
        lineHeight: '36px',
        letterSpacing: 0,
        '@media (max-width: 768px)': {
          fontSize: '24px',
          lineHeight: '32px',
        },
      },
      h5: {
        fontFamily: fontFamilyHeading,
        fontSize: '24px',
        fontWeight: 500,
        lineHeight: '32px',
        letterSpacing: 0,
        '@media (max-width: 768px)': {
          fontSize: '20px',
          lineHeight: '28px',
        },
      },
      h6: {
        fontFamily: fontFamilyHeading,
        fontSize: '20px',
        fontWeight: 500,
        lineHeight: '28px',
        letterSpacing: 0,
        '@media (max-width: 768px)': {
          fontSize: '18px',
          lineHeight: '24px',
        },
      },
      subtitle1: {
        fontFamily: fontFamilyBody,
        fontSize: '16px',
        fontWeight: 500,
        lineHeight: '18px',
        letterSpacing: 0,
      },
      subtitle2: {
        fontFamily: fontFamilyBody,
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: '16px',
        letterSpacing: 0,
      },
      body1: {
        fontFamily: fontFamilyBody,
        fontSize: '16px',
        fontWeight: 400,
        lineHeight: '24px',
        letterSpacing: 0,
      },
      body2: {
        fontFamily: fontFamilyBody,
        fontSize: '14px',
        fontWeight: 400,
        lineHeight: '20px',
        letterSpacing: 0,
      },
      caption: {
        fontFamily: fontFamilyBody,
        fontSize: '12px',
        fontWeight: 500,
        lineHeight: '16px',
        letterSpacing: '0.02em',
      },
      overline: {
        fontFamily: fontFamilyBody,
        fontSize: '10px',
        fontWeight: 500,
        lineHeight: '14px',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      },
      button: {
        fontFamily: fontFamilyBody,
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: '16px',
        letterSpacing: 0,
        textTransform: 'none',
      },
      code: {
        fontFamily: fontFamilyMono,
        fontSize: '14px',
      },
      paragraphLarge: {
        fontFamily: fontFamilyBody,
        fontSize: '18px',
        fontWeight: 400,
        lineHeight: '28px',
        letterSpacing: 0,
      },
      paragraphXSmall: {
        fontFamily: fontFamilyBody,
        fontSize: '12px',
        fontWeight: 400,
        lineHeight: '20px',
        letterSpacing: 0,
      },
      navigationItem: {
        fontFamily: fontFamilyBody,
        fontSize: '16px',
        fontWeight: 500,
        lineHeight: '18px',
      },
      smallText: {
        fontFamily: fontFamilyBody,
        fontSize: '12px',
        fontWeight: 500,
        lineHeight: '16px',
        letterSpacing: '0.02em',
      },
      tinyText: {
        fontFamily: fontFamilyBody,
        fontSize: '10px',
        fontWeight: 500,
        lineHeight: '14px',
        letterSpacing: '0.04em',
      },
    },

    // ======================================================================
    // COMPONENT OVERRIDES
    // ======================================================================
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': {
            colorScheme: mode,
            '--font-body': fontFamilyBody,
            '--font-mono': fontFamilyMono,
            '--border-color': isDark ? 'rgba(255,255,255,0.08)' : neutral[200],
            '--surface-color': isDark ? palette.scale[900] : '#FFFFFF',
            '--sidebar-color': isDark ? palette.scale[1000] : '#FFFFFF',
          },
          html: {
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
          },
          body: {
            margin: 0,
            padding: 0,
            backgroundColor: isDark ? palette.scale[1100] : neutral[50],
            color: isDark ? palette.scale[100] : neutral[900],
            fontFamily: fontFamilyBody,
            fontSize: '0.875rem',
            lineHeight: 1.5,
          },
          '#root': {
            minHeight: '100vh',
          },
          '*, *::before, *::after': {
            boxSizing: 'border-box',
          },
          'code, pre': {
            fontFamily: fontFamilyMono,
          },
          '::selection': {
            backgroundColor: alpha(primary[500], 0.2),
            color: 'inherit',
          },
          '::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '::-webkit-scrollbar-track': {
            backgroundColor: 'transparent',
          },
          '::-webkit-scrollbar-thumb': {
            backgroundColor: isDark ? alpha(palette.scale[100], 0.15) : alpha(neutral[900], 0.15),
            borderRadius: 4,
            '&:hover': {
              backgroundColor: isDark ? alpha(palette.scale[100], 0.25) : alpha(neutral[900], 0.25),
            },
          },
          '@keyframes fadeIn': {
            from: { opacity: 0 },
            to: { opacity: 1 },
          },
          '@keyframes slideUp': {
            from: { opacity: 0, transform: 'translateY(8px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
        },
      },

      // PAPER
      MuiPaper: {
        defaultProps: { elevation: 1 },
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: isDark ? palette.scale[1000] : '#FFFFFF',
            borderRadius: 8,
            border: 'none',
          },
          outlined: {
            border: `1px solid ${isDark ? alpha(palette.scale[100], 0.08) : neutral[200]}`,
            boxShadow: 'none',
          },
          elevation0: { boxShadow: 'none' },
          elevation1: {
            boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.3)' : figmaShadow.xsmall,
          },
          elevation2: {
            boxShadow: isDark
              ? '0 6px 16px rgba(0,0,0,0.35)'
              : '0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 8px rgba(16, 24, 40, 0.04)',
          },
          elevation3: {
            boxShadow: isDark
              ? '0 8px 24px rgba(0,0,0,0.4)'
              : '0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 8px rgba(16, 24, 40, 0.06), 0 8px 16px rgba(16, 24, 40, 0.04)',
          },
        },
      },

      // CARD
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: isDark ? palette.scale[1000] : neutral[50],
            border: `1px solid ${isDark ? alpha(palette.scale[100], 0.08) : neutral[200]}`,
            boxShadow: isDark ? 'none' : figmaShadow.xsmall,
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            '&:not(:has(.MuiCardContent-root))': {
              padding: 24,
            },
            '&:hover': {
              borderColor: isDark ? alpha(palette.scale[100], 0.15) : neutral[300],
            },
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: 24,
            '&:last-child': { paddingBottom: 24 },
          },
        },
      },

      // BUTTON
      MuiButtonBase: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          root: {
            transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
            '&:active': {
              transform: 'scale(0.97)',
            },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 500,
            fontSize: '0.875rem',
            lineHeight: 1.143,
            padding: '8px 12px',
            minHeight: 40,
            transition: 'all 150ms ease',
            '&:focus-visible': {
              outline: `2px solid ${isDark ? palette.scale[400] : neutral[900]}`,
              outlineOffset: 2,
              boxShadow: `0 0 0 4px ${isDark ? alpha(palette.scale[400], 0.25) : alpha(neutral[900], 0.15)}`,
            },
          },
          contained: {
            backgroundColor: isDark ? palette.scale[300] : neutral[900],
            color: isDark ? palette.scale[1100] : '#FFFFFF',
            '&:hover': {
              backgroundColor: isDark ? palette.scale[200] : neutral[700],
            },
            '&:active': {
              backgroundColor: isDark ? palette.scale[100] : neutral[800],
            },
            '&.Mui-disabled': {
              backgroundColor: isDark ? palette.scale[800] : neutral[200],
              color: isDark ? palette.scale[600] : neutral[500],
              cursor: 'not-allowed',
              pointerEvents: 'auto',
            },
          },
          containedSecondary: {
            backgroundColor: isDark ? palette.scale[800] : neutral[100],
            color: isDark ? palette.scale[100] : neutral[700],
            border: `1px solid ${isDark ? palette.scale[700] : neutral[200]}`,
            boxShadow: 'none',
            '&:hover': {
              backgroundColor: isDark ? palette.scale[700] : neutral[200],
              boxShadow: 'none',
            },
          },
          outlined: {
            borderColor: isDark ? palette.scale[700] : neutral[300],
            color: isDark ? palette.scale[100] : neutral[700],
            backgroundColor: isDark ? alpha(palette.scale[100], 0.05) : neutral[100],
            '&:hover': {
              backgroundColor: isDark ? alpha(palette.scale[100], 0.08) : neutral[200],
              borderColor: isDark ? palette.scale[600] : neutral[400],
            },
            '&.Mui-disabled': {
              color: isDark ? palette.scale[600] : neutral[400],
              borderColor: isDark ? palette.scale[800] : neutral[200],
              backgroundColor: isDark ? alpha(palette.scale[100], 0.03) : neutral[50],
              cursor: 'not-allowed',
              pointerEvents: 'auto',
            },
          },
          text: {
            color: isDark ? palette.scale[400] : neutral[700],
            '&:hover': {
              backgroundColor: isDark ? alpha(palette.scale[100], 0.05) : 'rgba(0,0,0,0.04)',
              color: isDark ? palette.scale[200] : neutral[900],
            },
          },
          sizeSmall: {
            padding: '6px 8px',
            fontSize: '0.75rem',
            minHeight: 32,
          },
          sizeLarge: {
            padding: '12px 16px',
            fontSize: '1rem',
            minHeight: 44,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            color: isDark ? palette.scale[500] : neutral[500],
            transition: 'all 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
            '&:hover': {
              backgroundColor: isDark ? alpha(palette.scale[100], 0.06) : 'rgba(0,0,0,0.03)',
              color: isDark ? palette.scale[200] : neutral[700],
              '& .MuiSvgIcon-root': {
                filter: `drop-shadow(0 0 4px ${alpha(primary[500], 0.3)})`,
              },
            },
            '&:focus-visible': {
              outline: `2px solid ${isDark ? palette.scale[400] : neutral[900]}`,
              outlineOffset: 2,
              boxShadow: `0 0 0 4px ${isDark ? alpha(palette.scale[400], 0.25) : alpha(neutral[900], 0.15)}`,
            },
          },
          sizeSmall: { padding: 6 },
          sizeMedium: { padding: 8 },
        },
      },

      // CHIP
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: figmaSpacing.pillBorderRadius,
            fontFamily: fontFamilyBody,
            fontWeight: 500,
            fontSize: '12px',
            height: 24,
          },
          filled: {
            backgroundColor: isDark ? alpha(palette.scale[100], 0.1) : neutral[100],
          },
          outlined: {
            borderColor: isDark ? alpha(palette.scale[100], 0.15) : neutral[200],
          },
          colorSuccess: {
            backgroundColor: isDark ? alpha(palette.green[400], 0.15) : palette.green[100],
            color: isDark ? palette.green[400] : palette.green[600],
            borderColor: 'transparent',
          },
          colorError: {
            backgroundColor: isDark ? alpha(palette.red[500], 0.15) : palette.red[100],
            color: isDark ? palette.red[400] : status.destructive,
            borderColor: 'transparent',
          },
          colorWarning: {
            backgroundColor: isDark ? alpha(palette.yellow[400], 0.15) : palette.yellow[100],
            color: isDark ? palette.yellow[400] : palette.yellow[600],
            borderColor: 'transparent',
          },
          colorInfo: {
            backgroundColor: isDark ? alpha(palette.scale[100], 0.1) : neutral[100],
            color: isDark ? palette.scale[300] : neutral[700],
            borderColor: 'transparent',
          },
          sizeSmall: {
            height: 20,
            fontSize: '10px',
          },
        },
      },

      // INPUT / TEXT FIELD
      MuiTextField: {
        defaultProps: { size: 'small', variant: 'outlined' },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontFamily: fontFamilyBody,
            fontSize: '14px',
            backgroundColor: isDark ? palette.scale[900] : neutral[100],
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: isDark ? alpha(palette.scale[100], 0.12) : neutral[300],
              borderWidth: 1,
              transition: 'border-color 150ms ease',
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: isDark ? alpha(palette.scale[100], 0.25) : neutral[400],
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: isDark ? palette.scale[300] : neutral[900],
              borderWidth: 2,
            },
            '&.Mui-error .MuiOutlinedInput-notchedOutline': {
              borderColor: status.destructive,
            },
          },
          input: {
            padding: '8px 12px',
            height: '24px',
            lineHeight: '20px',
            '&::placeholder': {
              fontFamily: fontFamilyBody,
              color: isDark ? palette.scale[500] : neutral[500],
              opacity: 1,
            },
          },
          inputSizeSmall: {
            padding: '6px 12px',
            height: '20px',
          },
          adornedStart: {
            paddingLeft: 12,
            '& .MuiInputAdornment-root': { marginRight: 8 },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            fontFamily: fontFamilyBody,
            fontSize: '12px',
            fontWeight: 500,
            lineHeight: '16px',
            letterSpacing: 'normal',
            color: isDark ? palette.scale[400] : neutral[700],
            '&.Mui-focused': {
              color: isDark ? palette.scale[200] : neutral[900],
            },
          },
        },
      },
      MuiFormHelperText: {
        styleOverrides: {
          root: {
            marginTop: 6,
            fontSize: '0.75rem',
            color: isDark ? palette.scale[500] : neutral[500],
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          icon: { color: isDark ? palette.scale[500] : neutral[500] },
        },
      },

      // MENU / DROPDOWN
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 8,
            backgroundColor: isDark ? palette.scale[900] : 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${isDark ? alpha(palette.scale[100], 0.1) : neutral[200]}`,
            boxShadow: isDark
              ? '0 4px 24px rgba(0,0,0,0.4)'
              : '0 2px 8px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.1)',
            marginTop: 4,
          },
          list: { padding: 4 },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            fontSize: '0.875rem',
            padding: '8px 12px',
            margin: '2px 0',
            minHeight: 36,
            color: isDark ? palette.scale[300] : neutral[700],
            '&:hover': {
              backgroundColor: isDark ? alpha(palette.scale[100], 0.05) : 'rgba(0,0,0,0.03)',
              color: isDark ? palette.scale[100] : neutral[900],
            },
            '&.Mui-selected': {
              backgroundColor: isDark ? alpha(palette.scale[100], 0.08) : 'rgba(0,0,0,0.04)',
              color: isDark ? palette.scale[100] : neutral[900],
              '&:hover': {
                backgroundColor: isDark ? alpha(palette.scale[100], 0.1) : 'rgba(0,0,0,0.05)',
              },
            },
          },
        },
      },

      // NAVIGATION ITEMS
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            padding: '10px 12px',
            minHeight: 40,
            gap: 8,
            transition: 'all 150ms ease',
            color: isDark ? palette.scale[400] : neutral[700],
            '&:hover': {
              backgroundColor: isDark ? alpha(palette.scale[100], 0.05) : neutral[100],
              color: isDark ? palette.scale[200] : neutral[900],
            },
            '&.Mui-selected': {
              backgroundColor: isDark ? alpha(palette.scale[100], 0.08) : neutral[200],
              color: isDark ? palette.scale[100] : neutral[900],
              '&:hover': {
                backgroundColor: isDark ? alpha(palette.scale[100], 0.1) : neutral[200],
              },
            },
          },
        },
      },
      MuiListItemIcon: {
        styleOverrides: {
          root: {
            minWidth: 28,
            width: 20,
            height: 20,
            color: isDark ? palette.scale[500] : neutral[500],
            '.Mui-selected &': {
              color: isDark ? palette.scale[200] : neutral[700],
            },
          },
        },
      },
      MuiListItemText: {
        styleOverrides: {
          primary: {
            fontFamily: fontFamilyBody,
            fontSize: '16px',
            fontWeight: 500,
            lineHeight: 'normal',
            color: 'inherit',
          },
          secondary: {
            fontFamily: fontFamilyBody,
            fontSize: '12px',
            color: isDark ? palette.scale[500] : neutral[500],
          },
        },
      },

      MuiDivider: {
        styleOverrides: {
          root: {
            borderColor: isDark ? alpha(palette.scale[100], 0.08) : neutral[200],
          },
        },
      },

      // AVATAR
      MuiAvatar: {
        styleOverrides: {
          root: {
            width: figmaComponents.userAvatar.size,
            height: figmaComponents.userAvatar.size,
            border: isDark ? `1px solid ${palette.scale[600]}` : `1px solid ${neutral[400]}`,
            borderRadius: figmaComponents.userAvatar.borderRadius,
            backgroundColor: isDark ? palette.scale[800] : neutral[100],
            color: isDark ? palette.scale[300] : neutral[700],
            fontSize: '12px',
            fontFamily: fontFamilyBody,
            fontWeight: 500,
          },
        },
      },
      MuiBadge: {
        styleOverrides: {
          badge: { fontWeight: 600, fontSize: '0.625rem' },
        },
      },

      // TOOLTIP
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: isDark ? palette.scale[800] : palette.scale[1000],
            color: isDark ? palette.scale[100] : palette.scale[100],
            fontSize: '0.75rem',
            fontWeight: 500,
            padding: '6px 10px',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          },
          arrow: {
            color: isDark ? palette.scale[800] : palette.scale[1000],
          },
        },
      },

      // DIALOG
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            backgroundColor: isDark ? palette.scale[1000] : '#FFFFFF',
            border: `1px solid ${isDark ? alpha(palette.scale[100], 0.1) : neutral[200]}`,
            boxShadow: isDark
              ? '0 16px 48px rgba(0,0,0,0.4)'
              : '0 2px 8px rgba(0,0,0,0.06), 0 16px 48px rgba(0,0,0,0.12)',
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontSize: '1rem',
            fontWeight: 500,
            padding: '20px 24px 12px',
            color: isDark ? palette.scale[100] : neutral[900],
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: { padding: '12px 24px' },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: { padding: '12px 24px 20px', gap: 8, flexWrap: 'wrap' },
        },
      },

      // DRAWER / SIDEBAR
      MuiDrawer: {
        styleOverrides: {
          paper: {
            width: figmaSpacing.sidebarWidth,
            backgroundColor: isDark ? palette.scale[1000] : neutral[50],
            borderRight: 'none',
            borderRadius: 0,
            boxShadow: 'none',
            padding: '20px 16px',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? palette.scale[1000] : 'rgba(255, 255, 255, 0.85)',
            backdropFilter: 'blur(12px)',
            borderBottom: `1px solid ${isDark ? alpha(palette.scale[100], 0.08) : neutral[200]}`,
            boxShadow: 'none',
          },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: {
            minHeight: 56,
            '@media (min-width: 600px)': { minHeight: 56 },
          },
        },
      },

      // TABS
      MuiTabs: {
        styleOverrides: {
          root: {
            minHeight: 40,
            borderBottom: isDark
              ? `1px solid ${alpha(palette.scale[100], 0.1)}`
              : `1px solid ${neutral[200]}`,
          },
          indicator: {
            height: 2,
            borderRadius: 0,
            backgroundColor: isDark ? palette.scale[100] : neutral[900],
          },
          flexContainer: { gap: 0 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontFamily: fontFamilyBody,
            fontWeight: 500,
            fontSize: '14px',
            minHeight: 40,
            padding: '8px 32px',
            borderBottom: '2px solid transparent',
            color: isDark ? palette.scale[500] : neutral[700],
            backgroundColor: 'transparent',
            transition: 'all 150ms ease',
            '&.Mui-selected': {
              fontWeight: 500,
              color: isDark ? palette.scale[100] : neutral[900],
              backgroundColor: isDark ? alpha(palette.scale[100], 0.08) : neutral[100],
            },
            '&:hover': {
              color: isDark ? palette.scale[300] : neutral[700],
              backgroundColor: isDark ? alpha(palette.scale[100], 0.04) : neutral[50],
            },
          },
        },
      },

      // TABLE
      MuiTable: {
        styleOverrides: {
          root: {
            borderCollapse: 'separate',
            borderSpacing: 0,
            backgroundColor: isDark ? palette.scale[1000] : '#FFFFFF',
          },
        },
      },
      MuiTableContainer: {
        styleOverrides: {
          root: { border: 'none', borderRadius: 0 },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: {
            '& .MuiTableCell-head': {
              backgroundColor: isDark ? palette.scale[900] : neutral[50],
              fontFamily: fontFamilyBody,
              fontWeight: 500,
              fontSize: '12px',
              letterSpacing: '0.02em',
              color: isDark ? palette.scale[400] : neutral[700],
              textTransform: 'none',
              borderBottom: `1px solid ${isDark ? alpha(palette.scale[100], 0.08) : neutral[200]}`,
              height: 60,
              padding: `0 ${figmaComponents.dataTable.cellPadding}px`,
            },
          },
        },
      },
      MuiTableBody: {
        styleOverrides: {
          root: {
            '& .MuiTableRow-root': {
              '&:nth-of-type(even)': {
                backgroundColor: isDark ? 'transparent' : neutral[50],
              },
              '&:hover': {
                backgroundColor: isDark ? alpha(palette.scale[100], 0.02) : alpha(neutral[100], 0.5),
              },
            },
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: { height: 60 },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            fontFamily: fontFamilyBody,
            fontSize: '14px',
            color: isDark ? palette.scale[200] : neutral[900],
            padding: `0 ${figmaComponents.dataTable.cellPadding}px`,
            height: 60,
            borderBottom: `1px solid ${isDark ? alpha(palette.scale[100], 0.06) : neutral[200]}`,
            borderLeft: 'none',
            borderRight: 'none',
          },
        },
      },
      MuiTablePagination: {
        styleOverrides: {
          root: {
            borderTop: `1px solid ${isDark ? alpha(palette.scale[100], 0.08) : 'rgba(0,0,0,0.05)'}`,
          },
          selectLabel: { fontSize: '0.75rem', color: isDark ? palette.scale[500] : neutral[500] },
          displayedRows: { fontSize: '0.75rem', color: isDark ? palette.scale[500] : neutral[500] },
        },
      },

      // CHECKBOX / SWITCH
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: isDark ? palette.scale[600] : neutral[400],
            padding: 8,
            '&.Mui-checked': {
              color: isDark ? palette.scale[200] : neutral[900],
            },
            '&:hover': {
              backgroundColor: isDark ? alpha(palette.scale[100], 0.04) : alpha(neutral[900], 0.04),
            },
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 44, height: 24, padding: 0 },
          switchBase: {
            padding: 2,
            '&.Mui-checked': {
              transform: 'translateX(20px)',
              color: '#FFFFFF',
              '& + .MuiSwitch-track': {
                backgroundColor: isDark ? palette.scale[200] : '#22c55e',
                opacity: 1,
              },
            },
          },
          thumb: { width: 20, height: 20, boxShadow: '0 2px 4px rgba(0,0,0,0.2)' },
          track: {
            borderRadius: 12,
            backgroundColor: isDark ? palette.scale[700] : neutral[400],
            opacity: 1,
          },
        },
      },

      // PROGRESS
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            height: 4,
            borderRadius: 2,
            backgroundColor: isDark ? palette.scale[800] : neutral[200],
          },
          bar: {
            borderRadius: 2,
            backgroundColor: isDark ? palette.scale[400] : primary[500],
          },
        },
      },
      MuiCircularProgress: {
        styleOverrides: {
          root: {
            color: isDark ? palette.scale[400] : primary[500],
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? alpha(palette.scale[100], 0.1) : alpha(neutral[900], 0.11),
          },
        },
      },

      // ALERT
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontSize: '0.875rem',
            alignItems: 'flex-start',
            padding: '12px 16px',
            backgroundColor: isDark ? alpha(palette.scale[100], 0.05) : neutral[50],
            color: isDark ? palette.scale[200] : neutral[900],
            border: `1px solid ${isDark ? alpha(palette.scale[100], 0.1) : neutral[200]}`,
          },
          standardSuccess: {
            backgroundColor: isDark ? alpha(palette.green[400], 0.08) : '#f0fdf4',
            color: isDark ? palette.scale[200] : neutral[900],
            border: `1px solid ${isDark ? alpha(palette.green[400], 0.2) : '#bbf7d0'}`,
            '& .MuiAlert-icon': { color: isDark ? palette.green[400] : palette.green[600] },
          },
          standardError: {
            backgroundColor: isDark ? alpha(palette.red[500], 0.08) : '#fef2f2',
            color: isDark ? palette.scale[200] : neutral[900],
            border: `1px solid ${isDark ? alpha(palette.red[500], 0.2) : '#fecaca'}`,
            '& .MuiAlert-icon': { color: isDark ? palette.red[400] : palette.red[600] },
          },
          standardWarning: {
            backgroundColor: isDark ? alpha(palette.yellow[400], 0.08) : '#fffbeb',
            color: isDark ? palette.scale[200] : neutral[900],
            border: `1px solid ${isDark ? alpha(palette.yellow[400], 0.2) : '#fde68a'}`,
            '& .MuiAlert-icon': { color: isDark ? palette.yellow[400] : palette.yellow[600] },
          },
          standardInfo: {
            backgroundColor: isDark ? alpha(palette.blue[400], 0.08) : '#eff6ff',
            color: isDark ? palette.scale[200] : neutral[900],
            border: `1px solid ${isDark ? alpha(palette.blue[400], 0.2) : '#bfdbfe'}`,
            '& .MuiAlert-icon': { color: isDark ? palette.blue[400] : palette.blue[500] },
          },
          icon: {
            marginRight: 12,
            padding: 0,
            opacity: 1,
          },
        },
      },
      MuiSnackbar: {
        styleOverrides: {
          root: {
            '& .MuiAlert-root': {
              boxShadow: isDark
                ? '0 4px 24px rgba(0,0,0,0.4)'
                : '0 4px 24px rgba(0,0,0,0.1)',
            },
          },
        },
      },

      // BREADCRUMBS & LINK
      MuiBreadcrumbs: {
        styleOverrides: {
          separator: {
            color: isDark ? palette.scale[600] : neutral[400],
            marginLeft: 8,
            marginRight: 8,
          },
          li: {
            '& .MuiTypography-root': { fontSize: '0.875rem' },
          },
        },
      },
      MuiLink: {
        styleOverrides: {
          root: {
            color: isDark ? palette.scale[300] : primary[500],
            textDecorationColor: isDark ? alpha(palette.scale[300], 0.4) : alpha(primary[500], 0.4),
            '&:hover': {
              color: isDark ? palette.scale[100] : primary[600],
              textDecorationColor: isDark ? palette.scale[100] : primary[600],
            },
          },
        },
      },

      // ACCORDION
      MuiAccordion: {
        defaultProps: { disableGutters: true, elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: isDark ? palette.scale[1000] : neutral[50],
            border: `1px solid ${isDark ? alpha(palette.scale[100], 0.08) : neutral[200]}`,
            borderRadius: 8,
            '&:before': { display: 'none' },
            '&:not(:last-child)': { marginBottom: 8 },
            '&.Mui-expanded': {
              margin: 0,
              '&:not(:last-child)': { marginBottom: 8 },
            },
          },
        },
      },
      MuiAccordionSummary: {
        styleOverrides: {
          root: {
            padding: '0 16px',
            minHeight: 56,
            '&.Mui-expanded': { minHeight: 56 },
          },
          content: {
            margin: '12px 0',
            '&.Mui-expanded': { margin: '12px 0' },
          },
          expandIconWrapper: {
            color: isDark ? palette.scale[500] : neutral[400],
          },
        },
      },
      MuiAccordionDetails: {
        styleOverrides: {
          root: {
            padding: '0 16px 16px',
            fontFamily: fontFamilyBody,
            fontSize: '14px',
            lineHeight: '20px',
            color: isDark ? palette.scale[400] : neutral[500],
          },
        },
      },
    },
  })
}

// Default light theme
const theme = createAppTheme('light')
export default theme
