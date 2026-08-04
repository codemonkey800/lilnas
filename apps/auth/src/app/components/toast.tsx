'use client'

import { cns } from '@lilnas/utils/cns'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Icon } from './icons'

// Mirrors the design mockups' `showToast()` — a single bottom-center toast
// that auto-clears after 2200ms. Each page owns its own `useToast()` hook
// instance (no global provider) and renders one `<Toast>` for it.
const TOAST_VISIBLE_MS = 2200

export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  const showToast = useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setMessage(null), TOAST_VISIBLE_MS)
  }, [])

  return { message, showToast }
}

export type ToastProps = {
  message: string | null
}

export function Toast({ message }: ToastProps) {
  return (
    <div
      className={cns('toast', message ? 'is-visible' : undefined)}
      role="status"
      aria-live="polite"
    >
      {message ? (
        <>
          <Icon name="check" />
          <span>{message}</span>
        </>
      ) : null}
    </div>
  )
}
