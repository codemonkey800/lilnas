'use client'

import { Button, Icon, Note } from '@lilnas/ui'
import type { JSX } from 'react'

import { ProfilePageShell } from 'src/components/profile/profile-page-shell'

export type ProfileErrorProps = {
  /** Next hands the boundary the thrown error, with a `digest` in production. */
  error: Error & { digest?: string }
  /** Re-renders the segment from scratch. */
  reset: () => void
}

/**
 * The profile's error boundary.
 *
 * Only genuinely unexpected failures reach here. A user with no downloads is an
 * empty profile, a filter that matches nothing is a different empty state, and a
 * profile this viewer may not see is the quiet not-authorized panel — none of
 * the three is an error, and showing any of them here would report a fault that
 * did not happen.
 *
 * ⚠️ `error.message` is deliberately not rendered — in a production build Next
 * replaces it with a generic string anyway, and in development it is a stack
 * trace's first line. The `digest` is shown because it is the one thing that
 * correlates this screen with the server log that explains it.
 */
export default function ProfileError({
  error,
  reset,
}: ProfileErrorProps): JSX.Element {
  return (
    <ProfilePageShell>
      <h1 className="mb-4 text-h2">This profile didn’t load</h1>
      <Note
        icon={<Icon name="alert" />}
        lead="The download service didn’t answer."
        tone="bad"
      >
        Nothing has changed — the numbers just couldn’t be read. Try again in a
        minute.
      </Note>
      <div className="mt-3 flex items-center gap-3">
        <Button icon="refresh" onClick={reset} size="sm" variant="outline">
          Try again
        </Button>
        {error.digest ? (
          <span className="font-mono text-mono-sm text-ink-3">
            digest {error.digest}
          </span>
        ) : null}
      </div>
    </ProfilePageShell>
  )
}
