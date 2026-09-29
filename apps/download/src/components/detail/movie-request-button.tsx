'use client'

import { cns } from '@lilnas/utils/cns'
import type { DownloadJob, QualityTier } from '@lilnas/utils/download/types'
import { DEFAULT_QUALITY_TIER } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'
import { useState, useTransition } from 'react'

import {
  QUALITY_TIER_PICKER,
  QUALITY_TIER_ROW,
  QualityTierSelect,
} from 'src/components/detail/quality-tier-select'
import { Button } from 'src/components/ui/button'
import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'

/** What {@link MovieRequestButton} answers with. A result, never a throw — the same shape `ShowRequestButton` and `grabRelease` both use. */
export type MovieRequestResult = { error: string } | { job: DownloadJob }

/**
 * What the page hands over for the request itself.
 *
 * `(mediaId, qualityTier)` — no scope, unlike `ShowRequestAction`: a movie
 * has exactly one release slot, so the tier picked beside the button is the
 * only thing to add. Always a tier, never omitted: the picker always has one
 * chosen, and it is what the press is asking Radarr for. `void` is accepted
 * alongside a result so a test spy is assignable.
 */
export type MovieRequestAction = (
  mediaId: string,
  qualityTier: QualityTier,
) => Promise<MovieRequestResult | void> | void

/** `movie-detail.pug`'s not-downloaded frame. */
export const MOVIE_REQUEST_LABEL = 'Download'

/** The mono error clause `show-request-button.tsx` and `delete-confirm.tsx` both write. */
const ERROR_LINE = 'mt-2 font-mono text-[11px] text-bad'

export type MovieRequestButtonProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onSubmit'
> & {
  /**
   * The movie's own tier, preselected in the picker — `media.qualityTier`.
   * `null` or omitted (outside the library, or on a profile the app does not
   * manage) preselects `DEFAULT_QUALITY_TIER`. Read once, as an initial
   * value: after that the picker is the user's.
   */
  defaultQualityTier?: QualityTier | null
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
 * picker, for a movie nothing has been requested for yet, with the quality
 * tier picker in front of it (plan 024). The tier is what the press asks
 * Radarr for, so it sits where the press is; a pick from the release list
 * ignores it.
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
  defaultQualityTier,
  full = false,
  mediaId,
  onRequest,
  size,
  variant = 'outline',
  ...props
}: MovieRequestButtonProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [qualityTier, setQualityTier] = useState<QualityTier>(
    defaultQualityTier ?? DEFAULT_QUALITY_TIER,
  )

  function request(): void {
    if (!onRequest) {
      return
    }

    setError(null)

    startTransition(async () => {
      const result = await onRequest(mediaId, qualityTier)

      if (result && 'error' in result) {
        setError(result.error)
      }
    })
  }

  return (
    <div {...props} className={cns(full && 'w-full', className)}>
      <div className={cns(QUALITY_TIER_ROW)}>
        <QualityTierSelect
          className={cns(QUALITY_TIER_PICKER)}
          disabled={pending}
          value={qualityTier}
          onChange={setQualityTier}
        />
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
      </div>
      {error ? (
        <p className={cns(ERROR_LINE)} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
