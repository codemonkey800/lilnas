import { Button, Note } from '@lilnas/ui'
import type { JSX } from 'react'

/**
 * What broke, why, and what to press, with the machine string in mono after
 * it. `onRetry` adds the Retry button.
 */
export function ErrorState({
  message,
  lead = "Couldn't load this.",
  code,
  onRetry,
  retryLabel = 'Retry',
  retryTrackId,
}: {
  /** The detail after the bold lead. */
  message?: string
  lead?: string
  /** The raw error text, shown in mono. */
  code?: string
  onRetry?: () => void
  retryLabel?: string
  retryTrackId?: string
}): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-3">
      <Note className="w-full" lead={lead} tone="bad">
        {message ?? 'Something went wrong. Try again.'}
        {code ? (
          <span className="mt-0.5 block font-mono text-mono-sm text-ink-3">
            {code}
          </span>
        ) : null}
      </Note>
      {onRetry ? (
        <Button
          data-track-id={retryTrackId}
          icon="refresh"
          onClick={onRetry}
          size="sm"
          variant="accent"
        >
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
