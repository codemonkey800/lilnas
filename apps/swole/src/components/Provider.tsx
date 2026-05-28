'use client'

import { ThemeProvider } from '@mui/material'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import { ReactNode } from 'react'

import { ToastProvider } from 'src/components/toast-provider'
import { theme } from 'src/theme'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <AppRouterCacheProvider>
        <ToastProvider>{children}</ToastProvider>
      </AppRouterCacheProvider>
    </ThemeProvider>
  )
}
