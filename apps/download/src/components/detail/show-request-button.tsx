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
 * `(mediaId, scope, qualityTier?)` so the page can pass an unbound
 * server-action reference straight through, the shape `JobAction`,
 * `FlagBadFileAction` and `DeleteMediaFilesAction` all take. `void` is
 * accepted alongside a result so a test spy is assignable.
 *
 * `qualityTier` is optional because only the series-level button carries a
 * picker (plan 024 — Sonarr keeps one profile per series). A season or episode
 * button calls with `(mediaId, scope)` alone, and `ShowDetail` fills the tier
 * in from the header's picker before it reaches the page — see
 * `ShowDetail`'s `requestInSeriesTier`. Omitted all the way to the backend, a
 * request gets `DEFAULT_QUALITY_TIER`.
 */
export type ShowRequestAction = (
  mediaId: string,
  scope: ShowRequestScope,
  qualityTier?: QualityTier,
) => Promise<ShowRequestResult | void> | void

/** `show-detail.pug:45`. */
export const REQUEST_SERIES_LABEL = 'Download series'
/** `show-detail.pug:138`. */
export const REQUEST_SEASON_LABEL = 'Download season'
/** `show-detail.mjs`'s `E5` row. */
export const REQUEST_EPISODE_LABEL = 'Download'
/** `show-detail.pug`'s caption under the series-level tier picker. */
export const SHOW_QUALITY_TIER_HINT = 'Applies to the whole show'

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
  /**
   * Series scope only. The show's own tier, preselected in the picker when
   * uncontrolled — `media.qualityTier`. `null` or omitted (outside the
   * library, or on a profile the app does not manage) preselects
   * `DEFAULT_QUALITY_TIER`.
   */
  defaultQualityTier?: QualityTier | null
  /** Stretch the trigger and the root - the mockups' stacked mobile header. */
  full?: boolean
  /** Overrides the target's default label. */
  label?: string
  /** The `mediaId()` key - `tvdb:121361`, for every scope. */
  mediaId: string
  /** Series scope only. Told about every pick, for a parent that shares the tier. */
  onQualityTierChange?: (qualityTier: QualityTier) => void
  onRequest?: ShowRequestAction
  /**
   * Series scope only. Controls the picker — `ShowDetail` owns the tier so
   * the season and episode buttons further down can request in it too.
   * Omitted leaves the picker to its own state.
   */
  qualityTier?: QualityTier
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
 *
 * **The quality tier picker is series-scope only** (plan 024). Sonarr keeps
 * one quality profile per series, so a picker on every season and episode
 * row would be offering a choice that silently rewrites the whole show. The
 * series button draws the picker in front of itself with "Applies to the
 * whole show" under it, and sends the chosen tier; season and episode
 * buttons draw none and send none of their own.
 */
export function ShowRequestButton({
  className,
  defaultQualityTier,
  full = false,
  label,
  mediaId,
  onQualityTierChange,
  onRequest,
  qualityTier: qualityTierProp,
  size,
  target,
  variant = 'outline',
  ...props
}: ShowRequestButtonProps): JSX.Element {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [ownQualityTier, setOwnQualityTier] = useState<QualityTier>(
    defaultQualityTier ?? DEFAULT_QUALITY_TIER,
  )
  const series = target.kind === 'series'
  const qualityTier = qualityTierProp ?? ownQualityTier

  function chooseQualityTier(next: QualityTier): void {
    setOwnQualityTier(next)
    onQualityTierChange?.(next)
  }

  function request(): void {
    if (!onRequest) {
      return
    }

    setError(null)

    startTransition(async () => {
      const scope = showRequestScope(target)
      // The series button sends its picker's tier; a season or episode has no
      // picker and sends none — see `ShowRequestAction`.
      const result = series
        ? await onRequest(mediaId, scope, qualityTier)
        : await onRequest(mediaId, scope)

      if (result && 'error' in result) {
        setError(result.error)
      }
    })
  }

  const button = (
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
  )

  return (
    <div {...props} className={cns(full && 'w-full', className)}>
      {series ? (
        <div className={cns(QUALITY_TIER_ROW)}>
          <QualityTierSelect
            className={cns(QUALITY_TIER_PICKER)}
            disabled={pending}
            hint={SHOW_QUALITY_TIER_HINT}
            value={qualityTier}
            onChange={chooseQualityTier}
          />
          {button}
        </div>
      ) : (
        button
      )}
      {error ? (
        <p className={cns(ERROR_LINE)} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
