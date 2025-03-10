'use client'

import { purple } from '@mui/material/colors'
import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: purple,
  },

  typography: {
    fontFamily: 'var(--font-roboto)',
  },
})
