'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState, useTransition } from 'react'

import { startVideoDownload } from 'src/app/actions/start-video-download'
import type { QueryClassification } from 'src/lib/url-classify'
import { classifyQuery } from 'src/lib/url-classify'

/** Where a title query lands. `/search` owns results, filters and sort. */
export const SEARCH_ROUTE = '/search'

export type SearchOrDownload = {
  value: string
  setValue: (value: string) => void
  /** What the field currently holds: nothing, a title, or a link. */
  classification: QueryClassification
  /** The failed create's message, until the next keystroke. */
  error: string | null
  /** A video download is being created. */
  pending: boolean
  /** Forget the value and any error (a route change, a closed field). */
  reset: () => void
  clearError: () => void
  submit: () => void
}

/**
 * The one field behind both of this app's jobs: paste a video link and it goes
 * to yt-dlp, type a title and it goes to `/search`. The nav bar and the home
 * hero share it, so the two can never disagree about what a string means.
 *
 * Classification is instant and client-side (`src/lib/url-classify.ts`).
 * `submit` re-classifies from the current value, so it can never act on a
 * stale reading, and it is a no-op while a create is in flight — the guard that
 * makes a second press harmless.
 */
export function useSearchOrDownload(): SearchOrDownload {
  const router = useRouter()

  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const classification = classifyQuery(value)

  const reset = useCallback(() => {
    setValue('')
    setError(null)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const submit = useCallback(() => {
    if (pending) {
      return
    }

    const current = classifyQuery(value)

    if (current.kind === 'idle') {
      return
    }

    setError(null)

    if (current.kind === 'search') {
      router.push(`${SEARCH_ROUTE}?q=${encodeURIComponent(current.query)}`)
      return
    }

    startTransition(async () => {
      // The action's return type is `… | undefined` for a reason: on success
      // it redirects and never returns, and Next resolves the call with
      // `undefined`. Getting a value back at all means the create failed.
      const result = await startVideoDownload(current.url)

      if (result) {
        setError(result.error)
      }
    })
  }, [pending, router, value])

  return {
    value,
    setValue,
    classification,
    error,
    pending,
    reset,
    clearError,
    submit,
  }
}
