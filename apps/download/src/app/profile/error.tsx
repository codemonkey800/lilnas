'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import {
  PROFILE_TITLE,
  ProfilePageShell,
} from 'src/components/profile/profile-page-shell'
import { Button } from 'src/components/ui/button'
import { Note } from 'src/components/ui/card'

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const ERROR_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

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
      <h1 className={PROFILE_TITLE}>User profile</h1>
      <Note className={cns(ERROR_NOTE)} icon="alert">
        <p className="font-[620] text-ink">This profile could not be loaded</p>
        <p className="mt-1">
          The download service did not answer. Nothing has been lost — every
          download this profile counts is still exactly where it was.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-mono-sm text-ink-4">
            Reference {error.digest}
          </p>
        ) : null}
        <Button
          className="mt-3.5"
          icon="activity"
          onClick={reset}
          size="sm"
          variant="outline"
        >
          Try again
        </Button>
      </Note>
    </ProfilePageShell>
  )
}
