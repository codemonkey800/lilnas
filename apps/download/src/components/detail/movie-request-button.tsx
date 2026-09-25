'use client'

import { cns } from '@lilnas/utils/cns'
import type { DownloadJob } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'
import { useState, useTransition } from 'react'

import { Button } from 'src/components/ui/button'
import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'

/** What {@link MovieRequestButton} answers with. A result, never a throw — the same shape `ShowRequestButton` and `grabRelease` both use. */
export type MovieRequestResult = { error: string } | { job: DownloadJob }

/**
 * What the page hands over for the request itself.
 *
 * `(mediaId)` alone, unlike `ShowRequestAction` — a movie has no scope to
 * narrow, so there is nothing else to pass. `void` is accepted alongside a
 * result so a test spy is assignable.
 */
export type MovieRequestAction = (
  mediaId: string,
) => Promise<MovieRequestResult | void> | void

/** `movie-detail.pug`'s not-downloaded frame. */
export const MOVIE_REQUEST_LABEL = 'Download'

/** The mono error clause `show-request-button.tsx` and `delete-confirm.tsx` both write. */
const ERROR_LINE = 'mt-2 font-mono text-[11px] text-bad'

export type MovieRequestButtonProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onSubmit'
> & {
  /** Stretch the trigger and the root — the mockups' stacked mobile header. */
  full?: boolean
  /** The `mediaId()` key — `tmdb:438631`. */
  mediaId: string
  onRequest?: MovieRequestAction
  /** Omitted renders `Button`'s 38px default. */
  size?: ButtonSize
  /** Defaults to the mockups' `outline` — a shortcut beside the release picker, not competing advice with it. */
  variant?: ButtonVariant
}

/**
 * "Grab Radarr's best release" — the one-press shortcut next to the release
 * picker, for a movie nothing has been requested for yet.
 *
 * ⚠️ **This writes to the real Radarr library.** `POST /download/movies`
 * ensures the movie is monitored and fires `MoviesSearch`, so the press is a
 * genuine mutation even though nothing about it looks destructive — the
 * mirror of `ShowRequestButton`'s own note. There is no confirm dialog for
 * the same reason: a download is recoverable in a way a delete is not, and
 * there is nothing speculative — the action fires from a press and from
 * nothing else.
 *
 * The result is rendered *here*, under the button that caused it, rather than
 * thrown — a thrown server action would hit the route's error boundary and
 * replace the whole movie with an error card over one refused request.
 */
export function MovieRequestButton({
  className,
  full = false,
  mediaId,
  onRequest,
  size,
  variant = 'outline',
  ...props
}: MovieRequestButtonProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function request(): void {
    if (!onRequest) {
      return
    }

    setError(null)

    startTransition(async () => {
      const result = await onRequest(mediaId)

      if (result && 'error' in result) {
        setError(result.error)
      }
    })
  }

  return (
    <div {...props} className={cns(full && 'w-full', className)}>
      <Button
        aria-disabled={pending || undefined}
        full={full}
        iconEnd="download"
        size={size}
        variant={variant}
        onClick={request}
      >
        {MOVIE_REQUEST_LABEL}
      </Button>
      {error ? (
        <p className={cns(ERROR_LINE)} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
