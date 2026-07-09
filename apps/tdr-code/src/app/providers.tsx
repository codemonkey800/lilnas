'use client'

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'

import { LOG_EVENTS } from 'src/logging/log-events'

import { capMessage, logEvent, logToServer } from './lib/browser-logger'

// Module-scoped, not component-scoped — dedup state should survive a
// QueryProvider remount, and the useState(createQueryClient) factory below
// already exists for the same "survive re-renders" reason. Queries and
// mutations use disjoint key shapes in this app so two separate maps can
// never collide.
const lastLoggedQueryError = new Map<string, string>()
const lastLoggedMutationError = new Map<string, string>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Exported (not just QueryProvider) so tests can exercise this exact config
// directly with fabricated failing/succeeding queryFn/mutationFn's, rather
// than only observing it indirectly through a rendered component.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 10_000,
        gcTime: 60_000,
      },
    },
    // Chokepoint for every queryFn failure across the app — covers query
    // failures with zero per-query wiring. A 5s-interval polling query
    // logs once per NEW failure message (not once per poll) via the dedup
    // map below, and clears on the next successful poll.
    queryCache: new QueryCache({
      onError: (error, query) => {
        const key = JSON.stringify(query.queryKey)
        // Dedup keys on the raw, uncapped message — this Map never leaves
        // the browser either way, and keying on the full message (rather
        // than the capped one) means two distinct failures that happen to
        // share the same first 300 chars still count as different
        // failures for "log once per new failure" purposes.
        const message = errorMessage(error)
        if (lastLoggedQueryError.get(key) === message) return
        lastLoggedQueryError.set(key, message)
        logToServer('warn', LOG_EVENTS.queryError, capMessage(message), {
          queryKey: query.queryKey,
        })
      },
      onSuccess: (_data, query) => {
        lastLoggedQueryError.delete(JSON.stringify(query.queryKey))
      },
    }),
    // Same chokepoint role for mutations — also the only place today that
    // logs config-save/git-identity-upsert failures at all, since neither
    // mutation has its own onError. Note the 5-param callback signature:
    // @tanstack/query-core's MutationCacheConfig is (error, variables,
    // onMutateResult, mutation, context) — position 3 is NOT the mutation
    // object (that's position 4); don't rename position 3 to "context",
    // there's a genuinely distinct 5th param already using that name.
    mutationCache: new MutationCache({
      onError: (error, _variables, _onMutateResult, mutation) => {
        const key = JSON.stringify(mutation.options.mutationKey ?? [])
        // Same raw-message dedup-keying rationale as queryCache's onError
        // above.
        const message = errorMessage(error)
        if (lastLoggedMutationError.get(key) === message) return
        lastLoggedMutationError.set(key, message)
        logToServer('warn', LOG_EVENTS.mutationError, capMessage(message), {
          mutationKey: mutation.options.mutationKey,
        })
      },
      // A click only proves intent, not that the action worked — this is
      // the actual audit signal ("restart succeeded") for this console's
      // state-changing actions. Deliberately mutation-only: a matching
      // query-success log would fire on every successful 5s poll for zero
      // value.
      onSuccess: (_data, _variables, _onMutateResult, mutation) => {
        lastLoggedMutationError.delete(
          JSON.stringify(mutation.options.mutationKey ?? []),
        )
        logEvent(LOG_EVENTS.mutationSuccess, {
          mutationKey: mutation.options.mutationKey,
        })
      },
    }),
  })
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
