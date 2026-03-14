'use client'

import { createTheme } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface Palette {
    carbon: Record<string, string>
    phosphor: Record<string, string>
    terminal: string
  }
  interface PaletteOptions {
    carbon?: Record<string, string>
    phosphor?: Record<string, string>
    terminal?: string
  }
}

const MONO_FONT =
  "'JetBrains Mono', ui-monospace, 'Cascadia Code', 'Fira Code', monospace"
const SANS_FONT = "'Space Grotesk', ui-sans-serif, system-ui, sans-serif"

const carbon = {
  950: '#08090a',
  900: '#0d0f0e',
  800: '#151917',
  700: '#1e2422',
  600: '#2a322f',
  500: '#3b4744',
  400: '#576462',
  300: '#7a8b88',
  200: '#a3b0ad',
  100: '#d0d8d6',
  50: '#ecf0ef',
}

const phosphor = {
  950: '#052e05',
  900: '#0a4a0a',
  800: '#0f6b0f',
  700: '#168f16',
  600: '#1fbf1f',
  500: '#2bdf2b',
  main: '#39ff14',
  300: '#6fff54',
  200: '#a5ff8a',
  100: '#d4ffc7',
}

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    primary: {
      main: phosphor.main,
      light: phosphor[300],
      dark: phosphor[700],
      contrastText: carbon[950],
    },
    secondary: {
      main: carbon[300],
      light: carbon[200],
      dark: carbon[500],
      contrastText: carbon[50],
    },
    error: { main: '#ff4444' },
    warning: { main: '#ffaa22' },
    info: { main: '#44aaff' },
    success: { main: '#39ff14' },
    background: {
      default: carbon[900],
      paper: carbon[800],
    },
    text: {
      primary: carbon[200],
      secondary: carbon[300],
      disabled: carbon[400],
    },
    divider: carbon[500],
    carbon,
    phosphor,
    terminal: phosphor.main,
  },
  typography: {
    fontFamily: SANS_FONT,
    h1: { fontFamily: MONO_FONT, fontWeight: 700, letterSpacing: '-0.025em' },
    h2: { fontFamily: MONO_FONT, fontWeight: 700, letterSpacing: '-0.025em' },
    h3: { fontFamily: MONO_FONT, fontWeight: 600, letterSpacing: '-0.025em' },
    h4: { fontFamily: MONO_FONT, fontWeight: 500, letterSpacing: '-0.025em' },
    h5: { fontFamily: MONO_FONT, fontWeight: 500, letterSpacing: '-0.025em' },
    h6: { fontFamily: MONO_FONT, fontWeight: 500, letterSpacing: '-0.025em' },
    button: { fontFamily: MONO_FONT, fontWeight: 500, textTransform: 'none' },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          fontFamily: MONO_FONT,
          fontSize: '0.875rem',
          borderRadius: 6,
          transition: 'all 150ms',
        },
        containedPrimary: {
          backgroundColor: phosphor.main,
          color: carbon[950],
          boxShadow: '0 0 12px rgba(57, 255, 20, 0.3)',
          '&:hover': {
            backgroundColor: phosphor[300],
            boxShadow: '0 0 20px rgba(57, 255, 20, 0.5)',
          },
          '&:active': { backgroundColor: phosphor[500] },
        },
        outlined: {
          borderColor: 'rgba(57, 255, 20, 0.4)',
          color: phosphor.main,
          '&:hover': {
            backgroundColor: 'rgba(57, 255, 20, 0.1)',
            borderColor: phosphor.main,
          },
        },
        text: {
          color: carbon[200],
          '&:hover': { backgroundColor: carbon[700], color: carbon[50] },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: carbon[200],
          transition: 'all 150ms',
          '&:hover': { backgroundColor: carbon[700], color: carbon[50] },
        },
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: {
          backgroundColor: carbon[800],
          borderColor: carbon[500],
          color: carbon[100],
          backgroundImage: 'none',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontFamily: MONO_FONT,
          fontSize: '0.75rem',
          fontWeight: 500,
          borderRadius: 9999,
        },
        colorPrimary: {
          borderColor: 'rgba(57, 255, 20, 0.3)',
          backgroundColor: 'rgba(57, 255, 20, 0.1)',
          color: phosphor.main,
        },
        colorSuccess: {
          borderColor: 'rgba(57, 255, 20, 0.3)',
          backgroundColor: '#0a3d05',
          color: phosphor.main,
        },
        colorError: {
          borderColor: 'rgba(255, 68, 68, 0.3)',
          backgroundColor: '#3d1515',
          color: '#ff4444',
        },
        colorWarning: {
          borderColor: 'rgba(255, 170, 34, 0.3)',
          backgroundColor: '#3d2e0a',
          color: '#ffaa22',
        },
        colorInfo: {
          borderColor: 'rgba(68, 170, 255, 0.3)',
          backgroundColor: '#0a2a3d',
          color: '#44aaff',
        },
        colorSecondary: {
          borderColor: carbon[500],
          backgroundColor: carbon[700],
          color: carbon[200],
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: carbon[800],
          borderColor: carbon[500],
          backgroundImage: 'none',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          fontFamily: MONO_FONT,
          fontSize: '0.875rem',
          borderRadius: 6,
          color: carbon[400],
          '&:hover': {
            backgroundColor: 'rgba(30, 36, 34, 0.5)',
            color: carbon[200],
          },
          '&.Mui-selected': {
            backgroundColor: 'rgba(57, 255, 20, 0.1)',
            color: phosphor.main,
            '&:hover': { backgroundColor: 'rgba(57, 255, 20, 0.15)' },
          },
        },
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: { color: 'inherit', minWidth: 36 },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            fontFamily: MONO_FONT,
            fontSize: '0.875rem',
            backgroundColor: carbon[900],
            color: carbon[100],
            '& fieldset': { borderColor: carbon[500] },
            '&:hover fieldset': { borderColor: carbon[400] },
            '&.Mui-focused fieldset': {
              borderColor: 'rgba(57, 255, 20, 0.6)',
              boxShadow: '0 0 0 2px rgba(57, 255, 20, 0.2)',
            },
          },
          '& .MuiInputBase-input::placeholder': { color: carbon[400] },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontFamily: SANS_FONT,
          fontSize: '0.75rem',
          backgroundColor: carbon[700],
          color: carbon[100],
          border: `1px solid ${carbon[500]}`,
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: carbon[500] },
      },
    },
    MuiSkeleton: {
      styleOverrides: {
        root: { backgroundColor: 'rgba(57, 255, 20, 0.1)' },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          width: 32,
          height: 32,
          border: `1px solid ${carbon[500]}`,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        '*, *::before, *::after': { boxSizing: 'border-box' },
      },
    },
  },
})
