import { useEffect, useState } from 'react'

/**
 * `Date.now()` that re-renders its component every `intervalMs`, for text that
 * counts (`updated 4s ago`, `up 3h 12m`). Starts at the render time and does not
 * tick while `intervalMs` is `null`.
 */
export function useNow(intervalMs: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (intervalMs === null) return

    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
