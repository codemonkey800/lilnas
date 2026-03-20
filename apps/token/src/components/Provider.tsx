'use client'

import createCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import {
  isServer,
  QueryClient,
  QueryClientProvider as BaseQueryClientProvider,
} from '@tanstack/react-query'
import { useServerInsertedHTML } from 'next/navigation'
import { ReactNode, useState } from 'react'

import { theme } from 'src/theme'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
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

function useEmotionCache() {
  const [{ cache, flush }] = useState(() => {
    const cache = createCache({ key: 'mui' })
    cache.compat = true
    const prevInsert = cache.insert
    let inserted: string[] = []
    cache.insert = (...args) => {
      const serialized = args[1]
      if (cache.inserted[serialized.name] === undefined) {
        inserted.push(serialized.name)
      }
      return prevInsert(...args)
    }
    const flush = () => {
      const prevInserted = inserted
      inserted = []
      return prevInserted
    }
    return { cache, flush }
  })

  useServerInsertedHTML(() => {
    const names = flush()
    if (names.length === 0) return null
    let styles = ''
    for (const name of names) {
      styles += cache.inserted[name]
    }
    return (
      <style
        key={cache.key}
        data-emotion={`${cache.key} ${names.join(' ')}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    )
  })

  return cache
}

export default function Providers({ children }: { children: ReactNode }) {
  const cache = useEmotionCache()

  return (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <QueryClientProvider>{children}</QueryClientProvider>
      </ThemeProvider>
    </CacheProvider>
  )
}
