'use client'

import { cns } from '@lilnas/utils/cns'
import type { DeleteMediaFilesQuery } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'
import { useRef, useState, useTransition } from 'react'

import type { DeleteMediaFilesResult } from 'src/app/actions/media-files'
import { formatBytes } from 'src/components/detail/release-picker'
import { Button } from 'src/components/ui/button'
import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'
import { buttonRecipeClassName } from 'src/components/ui/button-recipe'
import { DeleteButton, Modal } from 'src/components/ui/modal'

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
 * The four members are the four the backend can express — `DELETE
 * /download/media/:id/files` resolves narrowest-first (`episodeId`, then
 * `seasonNumber`, then everything) and a movie has no narrower scope than
 * itself.
 */
export type DeleteScope =
  | {
      /** Sonarr's episode primary key, *not* the episode number. */
      episodeId: number
      /** For the `S02E05` in the heading. Omitted falls back to "this episode". */
      episodeNumber?: number
      kind: 'episode'
      /** For the `S02E05` in the heading. Omitted falls back to "this episode". */
      seasonNumber?: number
    }
  | { kind: 'movie' }
  | { kind: 'season'; seasonNumber: number }
  | { kind: 'series' }

/**
 * The scope, as the backend's query.
 *
 * ⚠️ A `series` or `movie` scope is deliberately the **empty** query — which
 * the backend reads as "every file of this title". That is the widest possible
 * request and it is spelled by an *absence*, so this function exists precisely
 * so no call site ever assembles it by hand and no `undefined` ever widens a
 * narrower scope by accident.
 */
export function deleteScopeQuery(scope: DeleteScope): DeleteMediaFilesQuery {
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

/** `S02E05` when both numbers are known; "this episode" when they are not. */
function episodeLabel(seasonNumber?: number, episodeNumber?: number): string {
  if (seasonNumber === undefined || episodeNumber === undefined) {
    return 'this episode'
  }

  const season = String(seasonNumber).padStart(2, '0')
  const episode = String(episodeNumber).padStart(2, '0')

  return `S${season}E${episode}`
}

/** The default trigger label per scope — `movie-detail.pug:63`, `show-detail.pug:67,148`. */
const TRIGGER_LABELS: Record<DeleteScope['kind'], string> = {
  episode: 'Delete episode',
  movie: 'Delete',
  season: 'Delete season',
  series: 'Delete series',
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
 * The "stays in Radarr/Sonarr" clause is not reassurance — it is
 * `DeleteMediaFilesResponse`'s documented behaviour. This route removes
 * **files**, never the library entry, and a user who reads "delete" as
 * "un-request it" would otherwise be surprised twice.
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
        description: `Removes the file for this one episode from the library${frees}. The rest of the season is left alone. This can't be undone.`,
        title: `Delete ${episodeLabel(scope.seasonNumber, scope.episodeNumber)} of "${title}"?`,
      }
    case 'season':
      return {
        description: `Removes the file for every episode in season ${scope.seasonNumber} from the library${frees}. Other seasons are left alone. This can't be undone.`,
        title: `Delete season ${scope.seasonNumber} of "${title}"?`,
      }
    case 'series':
      return {
        description: `Removes the file for every episode of every season from the library${frees}. The series stays in Sonarr, so it can be downloaded again. This can't be undone.`,
        title: `Delete "${title}"?`,
      }
    case 'movie':
      return {
        description: `Removes this movie's file from the library${frees}. The movie stays in Radarr, so it can be downloaded again. This can't be undone.`,
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
  /** The `mediaId()` key — `tmdb:438631`, `tvdb:121361`. */
  mediaId: string
  /** Stack the dialog's buttons — the mockups' mobile frame. */
  mobile?: boolean
  onDelete?: DeleteMediaFilesAction
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
 * - **The dialog names the scope, every time.** Four scopes, four sentences —
 *   see {@link deleteConfirmCopy}. A user cannot reach the confirm button
 *   without having been told whether this takes one episode, one season, a
 *   whole series, or a movie.
 * - **Cancel holds the initial focus**, which is APG's rule for a destructive
 *   confirm: the dialog opens on the way *out*, not on the trigger. It is a
 *   bare `<button>` wearing `buttonRecipeClassName()` because `Button` does not
 *   forward a ref and `Modal.initialFocusRef` needs one — the same reason
 *   `FiltersButton` declares its own.
 * - **`dismissible` stays true.** Escape and a scrim click cancel, which is the
 *   safe direction; the irreversible half needs a deliberate press either way.
 *
 * The delete itself is a callback, never an import: the server action lives in
 * `src/app/actions/media-files.ts` and the *page* wires it, exactly as
 * `JobLifecycle` takes `onCancel`. That is also what makes this component
 * testable without a backend anywhere near it.
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
    if (!onDelete) {
      return
    }

    setError(null)

    startTransition(async () => {
      const result = await onDelete(mediaId, deleteScopeQuery(scope))

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
