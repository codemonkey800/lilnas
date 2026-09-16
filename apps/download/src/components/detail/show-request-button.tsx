'use client'

import { cns } from '@lilnas/utils/cns'
import type { DownloadJob } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'
import { useState, useTransition } from 'react'

import { Button } from 'src/components/ui/button'
import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'

/**
 * ⚠️ Which part of a series to fetch, as a discriminated union - the mirror of
 * `DeleteConfirm`'s `DeleteScope`, and for the same reason.
 *
 * **Scope lives on the job, never in the media id.** The key stays
 * `tvdb:121361` whether this is a whole series, one season or one episode;
 * that is what lets the gallery group a show into a single card instead of
 * fragmenting it into one per episode, and it is what `ShowScopeSchema`'s own
 * doc comment insists on. A union rather than two optional numbers means there
 * is no arrangement of props that can name one scope in the label and request
 * another.
 */
export type ShowRequestTarget =
  | {
      /** ⚠️ Sonarr's episode primary key (`Episode.id`), *not* `episodeNumber`. */
      episodeId: number
      kind: 'episode'
    }
  | { kind: 'season'; seasonNumber: number }
  | { kind: 'series' }

/**
 * The scope as `RequestShowInput` carries it, minus the `tvdbId` the action
 * derives from the media key.
 *
 * `seasonNumber` is `0` for specials, which is precisely why every check
 * against it in this file is `=== undefined` and never a truthiness test.
 */
export type ShowRequestScope = {
  episodeId?: number
  seasonNumber?: number
}

/**
 * The target, as the backend's input.
 *
 * ⚠️ A `series` request is the **empty** scope, which `POST /download/shows`
 * reads as "the whole series" - the widest request, spelled by an absence.
 * Exactly the shape `deleteScopeQuery` has, and exported for exactly the same
 * reason: so no call site ever assembles one by hand and no stray `undefined`
 * widens a narrower scope by accident.
 */
export function showRequestScope(target: ShowRequestTarget): ShowRequestScope {
  switch (target.kind) {
    case 'episode':
      return { episodeId: target.episodeId }
    case 'season':
      return { seasonNumber: target.seasonNumber }
    case 'series':
      return {}
  }
}

/** What a request answers with. A result, never a throw - see `ReleaseActionResult`. */
export type ShowRequestResult = { error: string } | { job: DownloadJob }

/**
 * What the page hands over for the request itself.
 *
 * `(mediaId, scope)` so the page can pass an unbound server-action reference
 * straight through, the shape `JobAction`, `FlagBadFileAction` and
 * `DeleteMediaFilesAction` all take. `void` is accepted alongside a result so
 * a test spy is assignable.
 */
export type ShowRequestAction = (
  mediaId: string,
  scope: ShowRequestScope,
) => Promise<ShowRequestResult | void> | void

/** `show-detail.pug:45`. */
export const REQUEST_SERIES_LABEL = 'Download series'
/** `show-detail.pug:138`. */
export const REQUEST_SEASON_LABEL = 'Download season'
/** `show-detail.mjs`'s `E5` row. */
export const REQUEST_EPISODE_LABEL = 'Download'

const TRIGGER_LABELS: Record<ShowRequestTarget['kind'], string> = {
  episode: REQUEST_EPISODE_LABEL,
  season: REQUEST_SEASON_LABEL,
  series: REQUEST_SERIES_LABEL,
}

/** The mono error clause `bad-file-flag.tsx` and `delete-confirm.tsx` both write. */
const ERROR_LINE = 'mt-2 font-mono text-[11px] text-bad'

export type ShowRequestButtonProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onSubmit'
> & {
  /** Stretch the trigger and the root - the mockups' stacked mobile header. */
  full?: boolean
  /** Overrides the target's default label. */
  label?: string
  /** The `mediaId()` key - `tvdb:121361`, for every scope. */
  mediaId: string
  onRequest?: ShowRequestAction
  /** Omitted renders `Button`'s 38px default. */
  size?: ButtonSize
  target: ShowRequestTarget
  /** Defaults to the mockups' `outline`. */
  variant?: ButtonVariant
}

/**
 * "Fetch this" at series, season or episode scope - the one control that
 * starts a download from this page.
 *
 * ⚠️ **This writes to the real Sonarr library.** `POST /download/shows` adds
 * or updates the series, sets monitoring for the scope and fires a search, so
 * the press is a genuine mutation even though nothing about it looks
 * destructive. There is no confirm dialog (a download is recoverable in a way
 * a delete is not), but there is also nothing speculative: the action fires
 * from a press and from nothing else.
 *
 * The result is rendered *here*, under the button that caused it, rather than
 * thrown - a thrown server action would hit the route's error boundary and
 * replace the whole show with an error card because one episode could not be
 * queued.
 */
export function ShowRequestButton({
  className,
  full = false,
  label,
  mediaId,
  onRequest,
  size,
  target,
  variant = 'outline',
  ...props
}: ShowRequestButtonProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function request(): void {
    if (!onRequest) {
      return
    }

    setError(null)

    startTransition(async () => {
      const result = await onRequest(mediaId, showRequestScope(target))

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
        {label ?? TRIGGER_LABELS[target.kind]}
      </Button>
      {error ? (
        <p className={cns(ERROR_LINE)} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
