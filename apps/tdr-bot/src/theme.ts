'use client'

import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#7c3aed',
      light: '#a78bfa',
      dark: '#5b21b6',
    },
    secondary: {
      main: '#a855f7',
      light: '#d8b4fe',
      dark: '#7e22ce',
    },
    background: {
      default: '#0f0b1a',
      paper: '#1a1428',
    },
    text: {
      primary: '#f5f3ff',
      secondary: '#c4b5fd',
    },
    divider: 'rgba(167, 139, 250, 0.15)',
  },
  typography: {
    fontFamily: 'inherit',
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#120d20',
          borderBottom: '1px solid rgba(167, 139, 250, 0.15)',
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          height: '100%',
        },
        body: {
          height: '100%',
          margin: 0,
        },
      },
    },
  },
})
