'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  DiscardImportQuery,
  ImportFilesInput,
  ListImportCandidatesQuery,
  ManualImportCandidate,
  ShowScope,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'
import { useEffect, useId, useRef, useState, useTransition } from 'react'

import type {
  DiscardImportResult,
  ImportCandidatesResult,
  ImportFilesResult,
} from 'src/app/actions/media-files'
import { formatRejection } from 'src/components/detail/release-picker'
import { episodeCode } from 'src/components/detail/show-state'
import { Button } from 'src/components/ui/button'
import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'
import { buttonRecipeClassName } from 'src/components/ui/button-recipe'
import { Note } from 'src/components/ui/card'
import { Spinner } from 'src/components/ui/feedback'
import { Icon } from 'src/components/ui/icon'
import { MChip } from 'src/components/ui/mchip'
import { DeleteButton, Modal } from 'src/components/ui/modal'
import { formatBytes, UNKNOWN_VALUE } from 'src/lib/format'

/**
 * The trigger, beside the `needs your decision` chip. `movie-detail.pug:246`.
 *
 * The bare verb, because the chip beside it has already said why it is there.
 */
export const IMPORT_TRIGGER_LABEL = 'Import'

/**
 * The heading when the call site has no title to name — a job lifecycle panel
 * that knows the media key and nothing else.
 *
 * {@link importDialogTitle} is what builds the mockup's `Import "<title>"` when
 * there *is* one.
 */
export const IMPORT_DIALOG_TITLE = 'Import this download'

/**
 * The dialog's one line of prose.
 *
 * ⚠️ The mockup names Radarr ("Radarr just couldn't match the file"), and this
 * dialog serves Sonarr just as often — a stuck season pack reaches exactly this
 * control. So the sentence keeps the mockup's voice and drops the brand: it is
 * the only word in it that could be wrong.
 */
export const IMPORT_DESCRIPTION =
  "The bytes are already down — it just couldn't be matched to the title automatically. Pick what to import, or discard."

/** While the candidate list is being fetched. */
export const IMPORT_LOADING_NOTE = 'Looking at what came down…'

/**
 * A queue item with no importable files at all.
 *
 * Says what is still possible rather than stopping at "nothing here": the queue
 * row is real even when the file list is empty, and Discard is the way out of
 * it — which is why the footer keeps that button in this state and drops
 * Import.
 */
export const IMPORT_EMPTY_NOTE =
  'The download client has no files to import for this. Discarding is the way out.'

/** The footer's commit. `movie-detail.pug:172`. */
export const IMPORT_CONFIRM_LABEL = 'Import'

/** Leaves the download exactly as it was. */
export const IMPORT_CANCEL_LABEL = 'Cancel'

/** The other way out, opposite Import. `movie-detail.pug:176`. */
export const IMPORT_DISCARD_LABEL = 'Discard'

/** The inline confirm's heading. `movie-detail.pug:346`. */
export const IMPORT_DISCARD_TITLE = 'Discard this download?'

/**
 * What Discard actually does, said before it is done. `movie-detail.pug:347`.
 *
 * Every clause earns its place: the files go too (this is not "forget the queue
 * row"), the job ends, and **nothing is blocklisted** — which is the whole
 * reason this sits beside Retry rather than being Retry. The release was fine;
 * the folder name was the problem.
 */
export const IMPORT_DISCARD_NOTE =
  'Removes it from the download client, files and all, and cancels the job. Nothing is blocklisted, so a Retry afterwards can grab the same release again.'

/** Backs out of the discard confirm. `movie-detail.pug:353`. */
export const IMPORT_DISCARD_KEEP_LABEL = 'Keep it'

/**
 * The line under upstream's own rejections. `movie-detail.pug:161`.
 *
 * ⚠️ Load-bearing, not decorative. Upstream's `ManualImport` command builds a
 * **fresh** decision with no rejections, so everything in that note is a reason
 * the *automatic* import declined — a manual one ignores all of it. Without
 * this line the note reads as a blocker, and the user is looking at a row they
 * are perfectly able to import.
 */
export const IMPORT_REJECTION_NOTE =
  'Informational only — a manual import ignores it.'

/**
 * Why a row cannot be taken, when the server said `importable: false` and gave
 * no reason of its own.
 */
export const IMPORT_BLOCKED_REASON = "This file can't be imported."

/** The mockup's heading, `Import "<title>"`, or {@link IMPORT_DIALOG_TITLE}. */
export function importDialogTitle(title?: string): string {
  return title === undefined ? IMPORT_DIALOG_TITLE : `Import "${title}"`
}

/**
 * The row's third value — what this file was resolved *to*.
 *
 * A movie candidate carries `movieTitle`; an episode candidate carries the
 * episodes it covers, which are rendered as the codes a user recognises
 * (`S02E05`, and `S02E05 · S02E06` for a double-length file). Neither means the
 * em dash, exactly as `ReleaseRow` does it.
 *
 * ⚠️ The codes come from the *candidate*, never from `ShowScope`: a season-scoped
 * job has no `episodeNumber` at all, and a file can cover episodes the scope
 * never named.
 */
export function importCandidateSecondary(
  candidate: ManualImportCandidate,
): string {
  if (candidate.movieTitle) {
    return candidate.movieTitle
  }

  const codes = (candidate.episodes ?? []).map(episode =>
    episodeCode(episode.seasonNumber, episode.episodeNumber),
  )

  return codes.length > 0 ? codes.join(' · ') : UNKNOWN_VALUE
}

/**
 * Upstream's refusals, cleaned and de-duplicated across the whole list.
 *
 * The mockup draws one file and therefore one rejection; a real list can repeat
 * the same sentence on every row, so the note carries each distinct one once.
 * `formatRejection` is `release-picker.tsx`'s, unchanged — the same artifact
 * (`[]`, an empty custom-format list) leaks through both endpoints.
 */
export function importRejections(
  candidates: readonly ManualImportCandidate[],
): readonly string[] {
  const distinct = new Set(
    candidates.flatMap(candidate =>
      candidate.rejections.map(formatRejection).filter(Boolean),
    ),
  )

  return [...distinct]
}

/**
 * The mockup's selected-file row: a bordered block that tints `uv` when it is
 * chosen. `movie-detail.pug:146`, plus `[&+&]:mt-2` from the `reason` mixin,
 * which is what spaces a *list* of them.
 */
const ROW_BASE = cns(
  'flex w-full items-start gap-2.5 rounded-md border px-3 py-[11px] text-left',
  'transition-[border-color,background-color] duration-200 ease-uv',
  '[&+&]:mt-2',
)

const ROW_CHECKED = 'border-uv/40 bg-uv-ghost'
const ROW_IDLE = 'border-line'

/** The dimming `movie-detail.pug` gives a row that cannot be acted on. */
const ROW_BLOCKED = 'opacity-55'

/**
 * A square box rather than the mockup's round dot, and that is the one thing
 * this row changes: the mockup draws a single file, where a dot reads as "the
 * one". This dialog renders a *list*, several rows of which can be committed
 * together, and a round indicator would be promising a radio group. The
 * geometry, the border weight and the `uv` are the mixin's.
 */
const BOX_BASE = 'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[5px]'

const BOX_CHECKED = 'border-[1.5px] border-uv bg-uv-ghost text-uv'
const BOX_IDLE = 'border-[1.5px] border-line-loud'

/** The file's own name — the only column that identifies it. `ink`, not `ink-3`. */
const ROW_TITLE = 'truncate font-mono text-mono-sm text-ink'

/** The metadata run under the name. `movie-detail.pug:155`. */
const ROW_META =
  'flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-mono-sm text-ink-3'

/** A sentence, so `ink-3` — and its own line, as in `ReleaseRow`. */
const ROW_REASON = 'text-cap text-ink-3'

const ERROR_LINE = 'font-mono text-[11px] text-bad'

/**
 * The three calls this dialog makes, supplied by the page.
 *
 * `void` is accepted from each so a test spy or a client-side stub is
 * assignable, matching `ReleaseSearchAction` and `ReleaseAction` in
 * `release-picker.tsx`. The real implementations are `listImportCandidates`,
 * `importFiles` and `discardImport` in `src/app/actions/media-files.ts`, whose
 * signatures these match exactly — a page passes the unbound server-action
 * references straight through.
 */
export type ImportDialogActions = {
  commit: (
    mediaId: string,
    input: ImportFilesInput,
  ) => Promise<ImportFilesResult | void> | void
  discard: (
    mediaId: string,
    query: DiscardImportQuery,
  ) => Promise<DiscardImportResult | void> | void
  list: (
    mediaId: string,
    query: ListImportCandidatesQuery,
  ) => Promise<ImportCandidatesResult | void> | void
}

export type ImportDialogProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'title'
> & {
  /** The three calls. See {@link ImportDialogActions}. */
  actions: ImportDialogActions
  /** Stretch the trigger to its container. */
  full?: boolean
  /** Trigger label. Defaults to {@link IMPORT_TRIGGER_LABEL}. */
  label?: ReactNode
  /** The `mediaId()` key — `tmdb:438631`, `tvdb:121361`. */
  mediaId: string
  /** Stack the footer and stretch its buttons, as `DeleteConfirm` does. */
  mobile?: boolean
  /** Called after a successful import or discard, once the dialog has closed. */
  onDone?: (outcome: 'discarded' | 'imported') => void
  /**
   * The job's scope — forwarded to every action. Absent for a movie or a
   * series-wide job.
   */
  scope?: ShowScope
  /** Trigger size. Defaults to the mockup's `sm`. */
  size?: ButtonSize
  /** The title, for the dialog heading. See {@link importDialogTitle}. */
  title?: string
  /** Trigger weight. Defaults to the mockup's `outline`. */
  variant?: ButtonVariant
}

/**
 * The in-app mirror of Radarr's and Sonarr's own manual-import picker: the
 * files they found, and the two ways out of a download they refuse to import.
 *
 * Ports `movie-detail.pug`'s `importModal` and `discardBtn`, plus the
 * `Import — flow` and `Discard — flow` storyboards. What the mockup draws is a
 * still of the common case — one file, one rejection — and three things here
 * are deliberately more than that:
 *
 * - **A list, not a file.** A stuck download can span several queue items and
 *   several files, so every row is selectable and the importable ones start
 *   checked. A row the server marked `importable: false` is unchecked,
 *   `aria-disabled` and carries its reason — never silently missing.
 * - **Rejections never block a row.** Upstream's `ManualImport` command builds
 *   a fresh decision with no rejections at all, so they are reported (in the
 *   mockup's alert note) and then explicitly discounted by
 *   {@link IMPORT_REJECTION_NOTE}. `importable` is the only thing that gates a
 *   row, and it is decided server-side.
 * - **Discard is confirmed inline.** It removes the download client's files and
 *   cancels the job, which is not something to do on a mis-click — so the
 *   footer swaps to {@link IMPORT_DISCARD_TITLE} and its note, and "Keep it"
 *   puts the footer back. It deliberately does *not* blocklist: the release was
 *   fine, the folder name was the problem, and a later Retry should be able to
 *   grab the very same release.
 *
 * Nothing is fetched while the dialog is closed — `GET …/imports` asks upstream
 * about live queue items, and a detail page that rendered this control once per
 * episode row would ask once per row on load. The list is requested on open,
 * once.
 *
 * Like `DeleteConfirm`, every call is a callback rather than an import: the
 * server actions live in `src/app/actions/media-files.ts` and the *page* wires
 * them, which is also what makes this testable with no backend anywhere near
 * it.
 */
export function ImportDialog({
  actions,
  className,
  full = false,
  label,
  mediaId,
  mobile = false,
  onDone,
  scope,
  size = 'sm',
  title,
  variant = 'outline',
  ...props
}: ImportDialogProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<
    readonly ManualImportCandidate[] | null
  >(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, startLoad] = useTransition()
  const [working, startWork] = useTransition()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const requestedRef = useRef<string | null>(null)
  const rowIdBase = useId()

  const { commit: commitAction, discard: discardAction, list } = actions

  // ⚠️ The two keys the wire actually carries, read off the scope rather than
  // spread from it: `ShowScope` also has `episodeNumber`, which is display-only
  // and belongs in no request. Pulling them apart here is also what keeps the
  // fetch effect's dependencies primitive — see below.
  const episodeId = scope?.episodeId
  const seasonNumber = scope?.seasonNumber

  useEffect(() => {
    if (!open) {
      requestedRef.current = null

      return
    }

    // ⚠️ Once per open, and once only. `actions` is an object prop, so a parent
    // re-render re-runs this effect with an identical scope; the key records
    // what has already been asked so a re-run is a no-op rather than a second
    // round trip to upstream.
    const key = `${mediaId}|${episodeId ?? ''}|${seasonNumber ?? ''}`

    if (requestedRef.current === key) {
      return
    }

    requestedRef.current = key

    startLoad(async () => {
      const result = await list(mediaId, { episodeId, seasonNumber })

      if (result && 'error' in result) {
        setError(result.error)
        setCandidates([])

        return
      }

      const found = result && 'candidates' in result ? result.candidates : []

      setCandidates(found)
      // Everything the server said it can import starts checked: the user came
      // here to import, and the common case is one file and one press.
      setSelected(
        new Set(
          found
            .filter(candidate => candidate.importable)
            .map(candidate => candidate.path),
        ),
      )
    })
  }, [episodeId, list, mediaId, open, seasonNumber])

  function close(): void {
    setOpen(false)
    setConfirmingDiscard(false)
    setError(null)
    setCandidates(null)
    setSelected(new Set())
    requestedRef.current = null
  }

  function toggle(candidate: ManualImportCandidate): void {
    if (!candidate.importable) {
      return
    }

    setSelected(current => {
      const next = new Set(current)

      if (!next.delete(candidate.path)) {
        next.add(candidate.path)
      }

      return next
    })
  }

  function commit(): void {
    // Filtered out of the list rather than read off the selection, so the paths
    // go out in the order they were shown and a stale selection cannot survive.
    const paths = (candidates ?? [])
      .filter(candidate => selected.has(candidate.path))
      .map(candidate => candidate.path)

    if (paths.length === 0) {
      return
    }

    setError(null)

    startWork(async () => {
      const result = await commitAction(mediaId, {
        episodeId,
        paths,
        seasonNumber,
      })

      if (result && 'error' in result) {
        setError(result.error)

        return
      }

      close()
      onDone?.('imported')
    })
  }

  function discard(): void {
    setError(null)

    startWork(async () => {
      const result = await discardAction(mediaId, { episodeId, seasonNumber })

      if (result && 'error' in result) {
        setError(result.error)

        return
      }

      close()
      onDone?.('discarded')
    })
  }

  const rejections = importRejections(candidates ?? [])
  const pending = loading || working
  // Hidden rather than disabled when there is nothing to import: an empty list
  // is a queue item with no files, and the only honest control left is Discard.
  const importable = (candidates?.length ?? 0) > 0

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
      {IMPORT_CANCEL_LABEL}
    </button>
  )

  const discardButton = (
    <DeleteButton
      aria-disabled={pending || undefined}
      full={mobile}
      onClick={() => setConfirmingDiscard(true)}
    >
      {IMPORT_DISCARD_LABEL}
    </DeleteButton>
  )

  const confirmButton = importable ? (
    <Button
      aria-disabled={pending || selected.size === 0 || undefined}
      full={mobile}
      iconEnd="check"
      size="sm"
      variant="uv"
      onClick={commit}
    >
      {IMPORT_CONFIRM_LABEL}
    </Button>
  ) : null

  const footer = confirmingDiscard ? (
    <div>
      <p className={cns('mb-1.5 text-h3')}>{IMPORT_DISCARD_TITLE}</p>
      <p className={cns('mb-4 text-sm text-ink-3')}>{IMPORT_DISCARD_NOTE}</p>
      <div className={cns('flex gap-2', mobile ? 'flex-col' : 'justify-end')}>
        {mobile ? (
          <>
            <DeleteButton
              aria-disabled={pending || undefined}
              full
              onClick={discard}
            >
              {IMPORT_DISCARD_LABEL}
            </DeleteButton>
            <button
              type="button"
              className={buttonRecipeClassName({
                className: 'w-full',
                size: 'sm',
                variant: 'ghost',
              })}
              onClick={() => setConfirmingDiscard(false)}
            >
              {IMPORT_DISCARD_KEEP_LABEL}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={buttonRecipeClassName({
                size: 'sm',
                variant: 'ghost',
              })}
              onClick={() => setConfirmingDiscard(false)}
            >
              {IMPORT_DISCARD_KEEP_LABEL}
            </button>
            <DeleteButton
              aria-disabled={pending || undefined}
              onClick={discard}
            >
              {IMPORT_DISCARD_LABEL}
            </DeleteButton>
          </>
        )}
      </div>
    </div>
  ) : mobile ? (
    <div className={cns('flex flex-col gap-2')}>
      {confirmButton}
      {cancel}
      {discardButton}
    </div>
  ) : (
    <div className={cns('flex items-center justify-between gap-2')}>
      {discardButton}
      <div className={cns('flex gap-2')}>
        {cancel}
        {confirmButton}
      </div>
    </div>
  )

  return (
    <div {...props} className={cns(full && 'w-full', className)}>
      <Button
        full={full}
        iconEnd="check"
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
      >
        {label ?? IMPORT_TRIGGER_LABEL}
      </Button>
      <Modal
        description={IMPORT_DESCRIPTION}
        initialFocusRef={cancelRef}
        open={open}
        title={importDialogTitle(title)}
        onClose={close}
      >
        {candidates === null ? (
          <div className={cns('mb-3 flex items-center gap-2.5')}>
            <Spinner className={cns('h-4 w-4')} />
            <p className={cns('text-sm text-ink-3')}>{IMPORT_LOADING_NOTE}</p>
          </div>
        ) : candidates.length === 0 ? (
          <p className={cns('mb-3 text-sm text-ink-3')}>{IMPORT_EMPTY_NOTE}</p>
        ) : (
          <div className={cns('mb-3')}>
            {candidates.map((candidate, index) => (
              <ImportRow
                candidate={candidate}
                checked={selected.has(candidate.path)}
                key={candidate.path}
                reasonId={`${rowIdBase}-${index}`}
                onToggle={toggle}
              />
            ))}
          </div>
        )}
        {rejections.length > 0 ? (
          <Note className={cns('mb-3')}>
            {rejections.map(rejection => (
              <p className={cns('text-sm text-ink-2')} key={rejection}>
                {rejection}
              </p>
            ))}
            <p className={cns('mt-1 text-xs text-ink-4')}>
              {IMPORT_REJECTION_NOTE}
            </p>
          </Note>
        ) : null}
        {footer}
        {error ? (
          <p className={cns('mt-2', ERROR_LINE)} role="alert">
            {error}
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

type ImportRowProps = {
  candidate: ManualImportCandidate
  checked: boolean
  onToggle: (candidate: ManualImportCandidate) => void
  reasonId: string
}

/**
 * One candidate file: whether it is going in, what it is, and what it was
 * resolved to.
 *
 * A real `<button role="checkbox">` rather than the mockup's `<div>`, for the
 * same reason `Reason` in `modal.tsx` is a `<button role="radio">`: the row is
 * genuinely activatable, and a button brings its own activation, its own
 * keyboard handling and the theme's `:focus-visible` ring with it.
 *
 * ⚠️ A blocked row is `aria-disabled`, never `disabled`. A real `disabled`
 * attribute drops the row out of the focus order and takes the
 * `aria-describedby` that carries the *reason* with it — which is the entire
 * point of rendering the row rather than omitting it. Nothing native routes
 * around the guard, because the handler itself refuses a non-importable
 * candidate.
 */
function ImportRow({
  candidate,
  checked,
  onToggle,
  reasonId,
}: ImportRowProps): JSX.Element {
  const quality = candidate.quality?.name
  const size = candidate.size === undefined ? null : formatBytes(candidate.size)
  const primary = [quality, size].filter(Boolean).join(' · ') || UNKNOWN_VALUE
  // The path is the commit key and the last resort for a name: a candidate with
  // neither a relative path nor a name still has to be identifiable.
  const name = candidate.relativePath ?? candidate.name ?? candidate.path
  const secondary = importCandidateSecondary(candidate)
  const languages = candidate.languages?.length
    ? candidate.languages.join(', ')
    : null

  const blocked = !candidate.importable
  const reason = blocked
    ? (candidate.blockedReason ?? IMPORT_BLOCKED_REASON)
    : null

  return (
    <button
      type="button"
      aria-checked={checked}
      aria-describedby={blocked ? reasonId : undefined}
      aria-disabled={blocked || undefined}
      className={cns(
        ROW_BASE,
        checked ? ROW_CHECKED : ROW_IDLE,
        blocked && ROW_BLOCKED,
      )}
      role="checkbox"
      title={candidate.path}
      onClick={() => onToggle(candidate)}
    >
      <span className={cns(BOX_BASE, checked ? BOX_CHECKED : BOX_IDLE)}>
        {checked ? (
          <Icon className={cns('h-[11px] w-[11px]')} name="check" />
        ) : null}
      </span>
      <span className={cns('flex min-w-0 flex-1 flex-col gap-1.5')}>
        <span className={cns(ROW_TITLE)}>{name}</span>
        <span className={cns(ROW_META)}>
          <MChip label={primary} />
          <MChip label={secondary} />
          {languages ? <MChip label={languages} /> : null}
        </span>
        {reason ? (
          <span className={cns(ROW_REASON)} id={reasonId}>
            {reason}
          </span>
        ) : null}
      </span>
    </button>
  )
}
