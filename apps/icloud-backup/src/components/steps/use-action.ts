import { useCallback, useState } from 'react'

import { ApiError } from 'src/lib/api'

export function errorMessage(error: unknown): string {
  return error instanceof ApiError && error.message
    ? error.message
    : 'Something went wrong. Try again.'
}

export interface UseAction {
  pending: boolean
  /** The last failure's message; cleared when the next run starts. */
  error: string | null
  /** Runs the call; true when it did not throw. */
  run: (call: () => Promise<unknown>) => Promise<boolean>
}

/** In-flight and error state for one button that calls the API. */
export function useAction(): UseAction {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (call: () => Promise<unknown>) => {
    setPending(true)
    setError(null)
    try {
      await call()
      return true
    } catch (caught) {
      setError(errorMessage(caught))
      return false
    } finally {
      setPending(false)
    }
  }, [])

  return { pending, error, run }
}
