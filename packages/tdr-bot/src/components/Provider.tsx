// In Next.js, this file would be called: app/providers.tsx
'use client'

import { ThemeProvider } from '@mui/material'
// Since QueryClientProvider relies on useContext under the hood, we have to put 'use client' on top
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter'
import {
  isServer,
  QueryClient,
  QueryClientProvider as BaseQueryClientProvider,
} from '@tanstack/react-query'
import { ReactNode } from 'react'

import { theme } from 'src/theme'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 60 * 1000,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  if (isServer) {
    // Server: always make a new query client
    return makeQueryClient()
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important, so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient()
    return browserQueryClient
  }
}

function QueryClientProvider({ children }: { children: ReactNode }) {
  // NOTE: Avoid useState when initializing the query client if you don't
  //       have a suspense boundary between this and the code that may
  //       suspend because React will throw away the client on the initial
  //       render if it suspends and there is no boundary
  const queryClient = getQueryClient()

  return (
    <BaseQueryClientProvider client={queryClient}>
      {children}
    </BaseQueryClientProvider>
  )
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <AppRouterCacheProvider>
        <QueryClientProvider>{children}</QueryClientProvider>
      </AppRouterCacheProvider>
    </ThemeProvider>
  )
}
