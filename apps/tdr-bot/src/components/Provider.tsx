'use client'

import { ToastProvider, Tooltip } from '@lilnas/ui'
import {
  isServer,
  QueryClient,
  QueryClientProvider as BaseQueryClientProvider,
} from '@tanstack/react-query'
import { ReactNode } from 'react'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined = undefined

function getQueryClient() {
  if (isServer) {
    return makeQueryClient()
  } else {
    if (!browserQueryClient) browserQueryClient = makeQueryClient()
    return browserQueryClient
  }
}

function QueryClientProvider({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient()
  return (
    <BaseQueryClientProvider client={queryClient}>
      {children}
    </BaseQueryClientProvider>
  )
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider>
      <ToastProvider>
        <Tooltip.Provider>{children}</Tooltip.Provider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
