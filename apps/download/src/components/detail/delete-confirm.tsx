'use client'

import { cns } from '@lilnas/utils/cns'
import type { DeleteMediaFilesQuery } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'
import { useRef, useState, useTransition } from 'react'

import type { DeleteMediaFilesResult } from 'src/app/actions/media-files'
import type { DeleteVideoJobResult } from 'src/app/actions/video-job'
import type { DeleteCascade } from 'src/components/detail/show-state'
import { Button } from 'src/components/ui/button'
import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'
import { buttonRecipeClassName } from 'src/components/ui/button-recipe'
import { DeleteButton, Modal } from 'src/components/ui/modal'
import { formatBytes } from 'src/lib/format'

/**
 * Exactly what a delete will remove.
 *
 * A discriminated union rather than four optional numbers, because the scope is
 * the one thing this dialog must not get wrong: the same value both *names* the
 * blast radius in the confirm copy and *builds* the query the backend deletes
 * by (see {@link deleteScopeQuery} and {@link deleteConfirmCopy}). There is no
 * arrangement of these props that can make the sentence and the request
 * disagree, which is not true of `{ episodeId?, seasonNumber? }`.
 *
 * Four of the five members are the four `DELETE /download/media/:id/files` can
 * express — it resolves narrowest-first (`episodeId`, then `seasonNumber`,
 * then everything) and a movie has no narrower scope than itself.
 *
 * ⚠️ **`video` is the odd one, and deliberately so.** That route refuses a
 * `video:` key outright; a video's delete is `DELETE /download/videos/:jobId`,
 * which removes a *job's* download rather than a library file. It is a member
 * here anyway because the thing a user meets is the same on all three detail
 * pages — one `bad` trigger, one dialog that names what goes before it goes —
 * and a second bespoke confirm flow for one page would be that promise broken.
 * What differs is carried honestly instead: the member holds a **job id**
 * rather than a file selector, {@link deleteScopeQuery} refuses to build a
 * files query from it, and {@link deleteConfirmCopy} says "download", never
 * "library".
 */
export type DeleteScope =
  | {
      /**
       * What this delete takes *beyond* the episode — see {@link deleteCascade}
       * in `show-state.ts`, which is what computes it. Absent or `'none'` says
       * the sentence the dialog has always said.
       *
       * ⚠️ Copy only. {@link deleteScopeQuery} never reads it, so a wrong
       * prediction can widen a sentence but can never widen a request.
       */
      cascadesTo?: DeleteCascade
      /** Sonarr's episode primary key, *not* the episode number. */
      episodeId: number
      /** For the `S02E05` in the heading. Omitted falls back to "this episode". */
      episodeNumber?: number
      kind: 'episode'
      /** For the `S02E05` in the heading. Omitted falls back to "this episode". */
      seasonNumber?: number
    }
  | { kind: 'movie' }
  | {
      /**
       * What this delete takes *beyond* the season. Only `'series'` is
       * meaningful — a season delete unmonitors its own season by definition.
       * Copy only, exactly as on the `episode` member.
       */
      cascadesTo?: DeleteCascade
      kind: 'season'
      seasonNumber: number
    }
  | { kind: 'series' }
  | {
      /**
       * The **job** whose download goes — `DownloadJob.id`, never the
       * `video:<nanoid>` media key. The `videos` row survives a delete and
       * keeps its history, so the media key is not what is being removed.
       */
      jobId: string
      kind: 'video'
    }

/** Every scope `DELETE /download/media/:id/files` can express — all but `video`. */
export type MediaFilesScope = Exclude<DeleteScope, { kind: 'video' }>

/**
 * The scope, as the backend's query.
 *
 * ⚠️ A `series` or `movie` scope is deliberately the **empty** query — which
 * the backend reads as "every file of this title". That is the widest possible
 * request and it is spelled by an *absence*, so this function exists precisely
 * so no call site ever assembles it by hand and no `undefined` ever widens a
 * narrower scope by accident.
 *
 * ⚠️ It takes {@link MediaFilesScope} rather than `DeleteScope`, so handing it
 * a `video` scope is a compile error rather than a fifth empty query — which
 * would be the *widest* request against a route that does not serve videos at
 * all. The one caller that could reach it with a video scope is `confirm()`
 * below, and this signature is what forces it to branch.
 *
 * ⚠️ `cascadesTo` is deliberately **not** read here. It is a sentence the
 * dialog says, derived from what this client happens to know; the cascade the
 * backend actually performs is decided there, from Sonarr's own episodes and
 * queue. Putting it on the wire would let a stale client widen a delete.
 */
export function deleteScopeQuery(
  scope: MediaFilesScope,
): DeleteMediaFilesQuery {
  switch (scope.kind) {
    case 'episode':
      return { episodeId: scope.episodeId }
    case 'season':
      return { seasonNumber: scope.seasonNumber }
    case 'movie':
    case 'series':
      return {}
  }
}

/**
 * The middle clause of a show delete's description — what this delete touches
 * *beyond* the thing named in the heading.
 *
 * ⚠️ A reassurance **or** a warning, never both. When nothing cascades this is
 * the sentence the dialog has always shown, so the description stays
 * byte-identical. When something does, the reassurance is **replaced** rather
 * than appended to: "The rest of the season is left alone. It's the last
 * downloaded episode of the series, so the series is removed from Sonarr."
 * reads as a contradiction, and the half that matters is the half a user
 * skims past.
 *
 * A prediction, not a promise — see {@link deleteCascade}. It is worth saying
 * anyway: "delete this episode" quietly removing the whole series from Sonarr
 * is the single most surprising thing this dialog can do.
 */
function scopeClause(
  scope: Extract<DeleteScope, { kind: 'episode' | 'season' }>,
): string {
  if (scope.cascadesTo === 'series') {
    const last = scope.kind === 'season' ? 'season' : 'episode'

    return `It's the last downloaded ${last} of the series, so the series is removed from Sonarr.`
  }

  // `'season'` on a season scope is meaningless - a season delete unmonitors
  // its own season by definition - so it keeps the reassurance.
  if (scope.cascadesTo === 'season' && scope.kind === 'episode') {
    return "It's the last downloaded episode of the season, so the season is unmonitored too."
  }

  return scope.kind === 'episode'
    ? 'The rest of the season is left alone.'
    : 'Other seasons are left alone.'
}

/** `S02E05` when both numbers are known; "this episode" when they are not. */
function episodeLabel(seasonNumber?: number, episodeNumber?: number): string {
  if (seasonNumber === undefined || episodeNumber === undefined) {
    return 'this episode'
  }

  const season = String(seasonNumber).padStart(2, '0')
  const episode = String(episodeNumber).padStart(2, '0')

  return `S${season}E${episode}`
}

/**
 * The default trigger label per scope — `movie-detail.pug:63`,
 * `show-detail.pug:67,148`, `video-detail.pug:159,235`.
 *
 * A video's is the bare `Delete` the video mockup draws beside `Save to
 * device`, and the same word the movie page uses: on a page about exactly one
 * thing, naming the scope in the trigger would be noise. The scope is named in
 * the dialog, which is where it matters.
 */
const TRIGGER_LABELS: Record<DeleteScope['kind'], string> = {
  episode: 'Delete episode',
  movie: 'Delete',
  season: 'Delete season',
  series: 'Delete series',
  video: 'Delete',
}

export type DeleteConfirmCopy = {
  description: string
  title: string
}

/**
 * The two sentences the dialog is made of, derived from the scope alone.
 *
 * Exported so E4/E5 (and the specs) can assert what a scope *says* without
 * rendering a dialog, and so the wording has exactly one home.
 *
 * The shape is the mockups': a `Delete "…"?` heading over one line of prose
 * that names what goes, what stays, and that it is final. The movie and series
 * headings are `movie-detail.pug:137` / `show-detail.pug:298` verbatim; season
 * and episode have no mockup, so they extend the same pattern with the scope
 * named in the heading — a bare `Delete "Harbor Watch"?` over a season-scoped
 * delete would be actively misleading.
 *
 * ⚠️ "from the library", not the mockup's "from Emby". The files live in
 * `/storage/media-library`; Emby indexes that directory and is one of several
 * things that will notice. Naming the player rather than the thing being
 * deleted would understate what happens.
 *
 * ⚠️ The "removes the movie/series from Radarr/Sonarr" clause is not a
 * flourish — it is what `DELETE /download/media/:id/files` now does for a
 * `movie` or `series` scope. Those two are the arr's real `DELETE /movie/{id}`
 * / `DELETE /series/{id}` with `deleteFiles=true`: the title goes from the
 * library **and** from Radarr/Sonarr, so a user who reads "delete" as "just the
 * files" would otherwise be surprised to find the request itself gone. "Can be
 * requested again later" is the honest replacement for "can be downloaded
 * again" — a re-request re-adds the title rather than re-fetching one that is
 * still there.
 *
 * ⚠️ A `season` or `episode` scope swaps its middle sentence when the delete
 * cascades — see {@link scopeClause}. `DELETE /download/media/:id/files` now
 * cascades *upwards*: the last downloaded episode of a season unmonitors the
 * season, and the last downloaded season removes the series from Sonarr. A
 * dialog that promised "the rest of the season is left alone" and then took
 * the series would be the worst kind of wrong this component can be, so the
 * promise is withdrawn rather than contradicted a sentence later.
 *
 * ⚠️ The `video` sentence deliberately says neither "library" nor "Radarr".
 * A video was never in `/storage/media-library` and no arr ever knew about it:
 * `deleteVideoJob` removes the objects the download produced and clears the
 * URLs that pointed at them. Inheriting the movie phrasing would have the
 * dialog claim a file is leaving a library it was never in. What survives is
 * the `videos` row and therefore this page — keyed on `(sourceUrl,
 * timeRange)`, which is why the same link can simply be fetched again — so the
 * clause in the same position as "removes the movie from Radarr" says exactly
 * that.
 */
export function deleteConfirmCopy(
  scope: DeleteScope,
  options: { freesBytes?: number; title: string },
): DeleteConfirmCopy {
  const { freesBytes, title } = options
  const frees =
    freesBytes === undefined ? '' : ` and frees ${formatBytes(freesBytes)}`

  switch (scope.kind) {
    case 'episode':
      return {
        description: `Removes the file for this one episode from the library${frees}. ${scopeClause(scope)} This can't be undone.`,
        title: `Delete ${episodeLabel(scope.seasonNumber, scope.episodeNumber)} of "${title}"?`,
      }
    case 'season':
      return {
        description: `Removes the file for every episode in season ${scope.seasonNumber} from the library${frees}. ${scopeClause(scope)} This can't be undone.`,
        title: `Delete season ${scope.seasonNumber} of "${title}"?`,
      }
    case 'series':
      return {
        description: `Removes every episode of every season from the library${frees} and removes the series from Sonarr. It can be requested again later. This can't be undone.`,
        title: `Delete "${title}"?`,
      }
    case 'movie':
      return {
        description: `Removes this movie's file from the library${frees} and removes the movie from Radarr. It can be requested again later. This can't be undone.`,
        title: `Delete "${title}"?`,
      }
    case 'video':
      return {
        description: `Removes this video's downloaded file${frees}. The source link stays on this page, so it can be downloaded again. This can't be undone.`,
        title: `Delete "${title}"?`,
      }
  }
}

/**
 * What a page hands over for the delete itself.
 *
 * `(mediaId, query)` matches `deleteMediaFiles` in
 * `src/app/actions/media-files.ts` exactly, so the page passes the unbound
 * server-action reference straight through. The component builds `query` from
 * its own `scope` — the caller never assembles one.
 */
export type DeleteMediaFilesAction = (
  mediaId: string,
  query: DeleteMediaFilesQuery,
) => Promise<DeleteMediaFilesResult | void> | void

/**
 * What the video page hands over instead.
 *
 * `(jobId)` matches `deleteVideoJob` in `src/app/actions/video-job.ts` exactly,
 * so `/videos/<videoId>` passes the unbound server-action reference straight
 * through — the same shape `JobAction` has, and for the same reason: every
 * video mutation is addressed by job.
 *
 * A second prop rather than a widened `onDelete`, because the two actions do
 * not share a signature and a page that wired the wrong one would otherwise
 * only find out at runtime. With the scope deciding which prop is read, a
 * `video` scope with no `onDeleteVideo` is inert in exactly the way a movie
 * scope with no `onDelete` already is.
 */
export type DeleteVideoJobAction = (
  jobId: string,
) => Promise<DeleteVideoJobResult | void> | void

/** Whatever the scope's own action answered with. */
type DeleteResult = DeleteMediaFilesResult | DeleteVideoJobResult

/** The scope's delete, with its arguments already bound. */
type DeleteRun = () => Promise<DeleteResult | void> | void

/**
 * The one request this scope means, or `null` when the page wired no handler
 * for it.
 *
 * ⚠️ Two endpoints behind one dialog. A `video` scope is
 * `deleteVideoJob(jobId)` and every other scope is `deleteMediaFiles(mediaId,
 * query)` — different routes, different arguments, different meanings of the
 * word "delete". Resolved here, once, so `confirm()` has exactly one thing to
 * await and `mediaId` is never quietly passed where a job id belongs.
 *
 * A free function rather than a closure inside the component because `scope`
 * has to be a `const` binding for its discriminant to still be narrowed inside
 * the returned thunk; a destructured prop is not one.
 */
function deleteRun(options: {
  mediaId: string
  onDelete?: DeleteMediaFilesAction
  onDeleteVideo?: DeleteVideoJobAction
  scope: DeleteScope
}): DeleteRun | null {
  const { mediaId, onDelete, onDeleteVideo, scope } = options

  if (scope.kind === 'video') {
    return onDeleteVideo ? () => onDeleteVideo(scope.jobId) : null
  }

  return onDelete ? () => onDelete(mediaId, deleteScopeQuery(scope)) : null
}

const CANCEL_LABEL = 'Cancel'
const CONFIRM_LABEL = 'Delete'

/** The mono error clause, the same idiom `start-video-download.ts` writes to. */
const ERROR_LINE = 'mt-3 font-mono text-[11px] text-bad'

/**
 * `onSubmit` and `title` are real `<div>` attributes this component wants for
 * its own meaning — `title` especially, since ours is the media title the
 * dialog names and the native one would render a tooltip instead.
 */
export type DeleteConfirmProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onSubmit' | 'title'
> & {
  /** Overrides the derived description entirely. */
  description?: ReactNode
  /** Bytes the delete reclaims, when the page knows — `Season.sizeOnDisk` and friends. */
  freesBytes?: number
  /** Stretch the trigger and the root, e.g. the mockups' stacked mobile header. */
  full?: boolean
  /** Overrides the scope's default trigger label. */
  label?: string
  /**
   * The `mediaId()` key — `tmdb:438631`, `tvdb:121361`, `video:V1StGXR8_Z5`.
   *
   * ⚠️ Unused by a `video` scope, which deletes by **job** id and carries that
   * id itself. Still required, and still the real key: it is what identifies
   * the page this trigger sits on, and a prop that is sometimes a media key and
   * sometimes a job id would be the exact confusion `DeleteScope` exists to
   * prevent.
   */
  mediaId: string
  /** Stack the dialog's buttons — the mockups' mobile frame. */
  mobile?: boolean
  /** The delete for every scope but `video`. */
  onDelete?: DeleteMediaFilesAction
  /** The delete for a `video` scope, which is a different endpoint entirely. */
  onDeleteVideo?: DeleteVideoJobAction
  /**
   * Fired after a delete the backend accepted, with the count it reported
   * (`null` when the action returned nothing). Where a page navigates away,
   * refetches, or says "nothing left here" — this component only closes.
   */
  onDeleted?: (deletedCount: number | null) => void
  scope: DeleteScope
  /** Size for the trigger. Omitted renders `Button`'s 38px default. */
  size?: ButtonSize
  /** The media title the heading names. */
  title: string
  /** Weight for the trigger. Defaults to the mockups' `bad`. */
  variant?: ButtonVariant
}

/**
 * ⚠️ The most destructive control in the app: the trigger, and the dialog that
 * makes the user name what they are about to lose.
 *
 * Ports `movie-detail.pug`'s `deleteModal` and `show-detail.pug`'s, plus the
 * `Delete — confirm flow` storyboard beside each. Three things are deliberate
 * rather than decorative:
 *
 * - **The dialog names the scope, every time.** Five scopes, five sentences —
 *   see {@link deleteConfirmCopy}. A user cannot reach the confirm button
 *   without having been told whether this takes one episode, one season, a
 *   whole series, a movie, or a video's download.
 * - **Cancel holds the initial focus**, which is APG's rule for a destructive
 *   confirm: the dialog opens on the way *out*, not on the trigger. It is a
 *   bare `<button>` wearing `buttonRecipeClassName()` because `Button` does not
 *   forward a ref and `Modal.initialFocusRef` needs one — the same reason
 *   `FiltersButton` declares its own.
 * - **`dismissible` stays true.** Escape and a scrim click cancel, which is the
 *   safe direction; the irreversible half needs a deliberate press either way.
 *
 * The delete itself is a callback, never an import: the server actions live in
 * `src/app/actions/media-files.ts` and `src/app/actions/video-job.ts` and the
 * *page* wires one, exactly as `AttemptList` takes `onCancel`. That is also
 * what makes this component testable without a backend anywhere near it.
 */
export function DeleteConfirm({
  className,
  description,
  freesBytes,
  full = false,
  label,
  mediaId,
  mobile = false,
  onDelete,
  onDeleted,
  onDeleteVideo,
  scope,
  size,
  title,
  variant = 'bad',
  ...props
}: DeleteConfirmProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const cancelRef = useRef<HTMLButtonElement>(null)

  const copy = deleteConfirmCopy(scope, { freesBytes, title })

  function close(): void {
    setOpen(false)
    setError(null)
  }

  function confirm(): void {
    const run = deleteRun({ mediaId, onDelete, onDeleteVideo, scope })

    if (!run) {
      return
    }

    setError(null)

    startTransition(async () => {
      const result = await run()

      if (result && 'error' in result) {
        setError(result.error)

        return
      }

      setOpen(false)
      onDeleted?.(
        result && 'deletedCount' in result ? result.deletedCount : null,
      )
    })
  }

  const cancel = (
    <button
      ref={cancelRef}
      type="button"
      className={buttonRecipeClassName({
        className: mobile ? 'w-full' : undefined,
        size: 'sm',
        variant: 'ghost',
      })}
      onClick={close}
    >
      {CANCEL_LABEL}
    </button>
  )

  const confirmButton = (
    <DeleteButton
      aria-disabled={pending || undefined}
      full={mobile}
      onClick={confirm}
    >
      {CONFIRM_LABEL}
    </DeleteButton>
  )

  return (
    <div {...props} className={cns(full && 'w-full', className)}>
      <Button
        full={full}
        iconEnd="trash"
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
      >
        {label ?? TRIGGER_LABELS[scope.kind]}
      </Button>
      <Modal
        description={description ?? copy.description}
        initialFocusRef={cancelRef}
        open={open}
        title={copy.title}
        onClose={close}
      >
        <div className={cns('flex gap-2', mobile ? 'flex-col' : 'justify-end')}>
          {mobile ? (
            <>
              {confirmButton}
              {cancel}
            </>
          ) : (
            <>
              {cancel}
              {confirmButton}
            </>
          )}
        </div>
        {error ? (
          <p className={cns(ERROR_LINE)} role="alert">
            {error}
          </p>
        ) : null}
      </Modal>
    </div>
  )
}
