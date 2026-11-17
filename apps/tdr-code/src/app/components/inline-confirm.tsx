'use client'

import { Button } from '@lilnas/ui'
import { type JSX, useState } from 'react'

/**
 * The two-step confirm that swaps in place for a low-stakes destructive
 * action in a list: the `bad` outline button becomes Confirm (`bad` filled)
 * and Cancel (`ghost`). The filled red is the confirm step only, by design:
 * a dialog is for the high-stakes cases.
 *
 * `onConfirm` fires once per Confirm press; while `pending` the Confirm button
 * is busy and Cancel is disabled, so the choice can't be taken back mid-flight.
 */
export function InlineConfirm({
  label,
  confirmLabel = 'Confirm',
  prompt,
  onConfirm,
  pending = false,
  disabled = false,
  'data-track-id': trackId,
}: {
  label: string
  confirmLabel?: string
  /** A short question or consequence shown before Confirm / Cancel. */
  prompt?: string
  onConfirm: () => void
  pending?: boolean
  /** Disables the first-step button (not a confirm already open). */
  disabled?: boolean
  'data-track-id'?: string
}): JSX.Element {
  const [confirming, setConfirming] = useState(false)

  if (!confirming && !pending) {
    return (
      <Button
        data-track-id={trackId}
        disabled={disabled}
        onClick={() => setConfirming(true)}
        size="sm"
        variant="bad"
      >
        {label}
      </Button>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {prompt ? <span className="text-cap text-ink-2">{prompt}</span> : null}
      <Button
        className="bg-bad text-bg-sunk hover:bg-bad hover:opacity-90"
        data-track-id={trackId ? `${trackId}-confirm` : undefined}
        loading={pending}
        onClick={() => {
          onConfirm()
          setConfirming(false)
        }}
        size="sm"
        variant="bad"
      >
        {confirmLabel}
      </Button>
      <Button
        data-track-id={trackId ? `${trackId}-cancel` : undefined}
        disabled={pending}
        onClick={() => setConfirming(false)}
        size="sm"
        variant="ghost"
      >
        Cancel
      </Button>
    </span>
  )
}
