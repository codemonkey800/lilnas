'use client'

import { Button, Note } from '@lilnas/ui'
import { type JSX, useCallback, useState } from 'react'

import { ApiError } from 'src/lib/api'
import { usePendingPassword } from 'src/lib/pending-password'
import type { BackupActions } from 'src/lib/use-backup'

/** What a failed action says: the server's message, else a generic line. */
export function messageOf(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

/** The step marker on the sign-in screens: bars, then "Step n of 3 · label". */
export function StepMarker({
  n,
  total = 3,
  label,
}: {
  n: number
  total?: number
  label: string
}): JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span aria-hidden="true" className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            className={
              i < n
                ? 'h-1 w-6 rounded-full bg-accent'
                : 'h-1 w-6 rounded-full bg-surface-3'
            }
            key={i}
          />
        ))}
      </span>
      <span className="text-cap text-ink-3">
        Step {n} of {total} · {label}
      </span>
    </div>
  )
}

/** Title and the one line under it. */
export function Intro({
  title,
  lede,
}: {
  title: string
  lede?: string
}): JSX.Element {
  return (
    <>
      <h1 className="text-h1">{title}</h1>
      {lede ? <p className="mt-2 text-body text-ink-2">{lede}</p> : null}
    </>
  )
}

export function LowSpaceNote({
  className,
}: {
  className?: string
}): JSX.Element {
  return (
    <Note className={className} lead="The server is low on space." tone="warn">
      Backups can&apos;t start right now. Tell Jeremy, and try again once he has
      made room.
    </Note>
  )
}

/**
 * Cancel for every sign-in screen. It forgets any password held for the wait
 * first. `local` replaces the request, for a screen that has no job yet.
 */
export function useCancel(
  actions: BackupActions,
  local?: () => void,
): { cancel: () => Promise<void>; error: string | null } {
  const pending = usePendingPassword()
  const [error, setError] = useState<string | null>(null)

  const cancel = useCallback(async (): Promise<void> => {
    pending.clear()
    setError(null)
    if (local) {
      local()
      return
    }
    try {
      await actions.cancel()
    } catch (err) {
      setError(messageOf(err))
    }
  }, [actions, local, pending])

  return { cancel, error }
}

export function CancelButton({
  onCancel,
  disabled,
}: {
  onCancel: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <Button
      className="max-sm:w-full"
      disabled={disabled}
      variant="ghost"
      onClick={onCancel}
    >
      Cancel
    </Button>
  )
}
