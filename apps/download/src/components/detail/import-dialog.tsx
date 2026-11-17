'use client'

import {
  Button,
  type ButtonSize,
  type ButtonVariant,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Icon,
  Note,
  Spinner,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import {
  type DiscardImportQuery,
  DownloadType,
  type ImportFilesInput,
  type ListImportCandidatesQuery,
  type ManualImportCandidate,
  type ShowScope,
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
import { Reason, ReasonGroup } from 'src/components/ui/reason'
import { mediaTypeFromKey } from 'src/db/media-id'
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
 * The movie list's accessible name. A movie takes exactly one file, so its rows
 * are a `radiogroup` and this is what a screen reader announces on entering it.
 */
export const IMPORT_MOVIE_GROUP_LABEL = 'File to import'

/** The same list for a show, which takes every file it can: checkboxes, not radios. */
export const IMPORT_FILES_GROUP_LABEL = 'Files to import'

/** The note's lead. The one word that differs is whoever refused the file. */
export const IMPORT_REJECTION_LEAD_RADARR = 'Radarr said:'
export const IMPORT_REJECTION_LEAD_SONARR = 'Sonarr said:'

/** The `label` caption over the file list, as the mockup's `legend`. */
const LEGEND = 'text-label text-ink-3 uppercase'

/**
 * Whether upstream flagged this file as a sample — any rejection mentioning
 * "sample", case-insensitively. A sample is never what anyone came to import,
 * so it never starts checked; it stays pickable, because rejections are
 * informational (see {@link IMPORT_REJECTION_NOTE}).
 */
export function isSampleCandidate(candidate: ManualImportCandidate): boolean {
  return candidate.rejections.some(rejection => /sample/i.test(rejection))
}

/**
 * The rows that start checked.
 *
 * - **A movie** (`single`) takes one file: the largest importable non-sample
 *   one, or nothing when there is none — Radarr imports one file per movie.
 * - **A show** takes several: every importable non-sample row.
 */
export function defaultImportSelection(
  candidates: readonly ManualImportCandidate[],
  single: boolean,
): ReadonlySet<string> {
  const eligible = candidates.filter(
    candidate => candidate.importable && !isSampleCandidate(candidate),
  )

  if (!single) {
    return new Set(eligible.map(candidate => candidate.path))
  }

  const largest = eligible.reduce<ManualImportCandidate | undefined>(
    (best, candidate) =>
      best === undefined || (candidate.size ?? 0) > (best.size ?? 0)
        ? candidate
        : best,
    undefined,
  )

  return new Set(largest ? [largest.path] : [])
}

/**
 * The mockup's file row: a sunk, bordered block with the name, then one mono
 * line of what it is. `movie-detail.pug`'s import dialog. The radio or box and
 * its label come from the package; this is only the row around them.
 */
const ROW =
  'flex w-full items-start gap-2.5 rounded-md border border-line bg-bg-sunk p-2.5 has-data-checked:border-accent-dim has-data-checked:bg-accent-ghost'

/** The dimming a row that cannot be acted on gets. */
const ROW_BLOCKED = 'opacity-55'

/** The file's own name - the only line that identifies it. */
const ROW_TITLE = 'font-mono text-mono-sm break-all text-ink'

/** What it is: size, quality, what it resolved to, language. */
const ROW_META = 'font-mono text-mono-sm text-ink-3'

/** A sentence, so Geist and `ink-3`. */
const ROW_NOTE = 'text-cap text-ink-3'

/** Shown under a file Radarr or Sonarr marked as a sample. */
export const IMPORT_SAMPLE_NOTE =
  'Marked as a sample. Informational only — a manual import ignores it.'

const ERROR_LINE = 'text-cap text-bad'

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
 *   several files, so every row is rendered. A show's rows are checkboxes and
 *   several can go in at once; a movie's are a radio group, because Radarr
 *   imports one file per movie. {@link defaultImportSelection} decides what
 *   starts checked, and a sample never does. A row the server marked
 *   `importable: false` is unchecked, `aria-disabled` and carries its reason —
 *   never silently missing.
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

  // Radarr imports one file per movie, so a movie's list is single-select.
  const single = mediaTypeFromKey(mediaId) === DownloadType.Movie

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
      // Pre-checked so the common case is one press: the user came here to
      // import. See `defaultImportSelection` for which rows.
      setSelected(defaultImportSelection(found, single))
    })
  }, [episodeId, list, mediaId, open, seasonNumber, single])

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

    // A radio is chosen, never un-chosen: picking a file replaces the last one.
    if (single) {
      setSelected(new Set([candidate.path]))

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

  const rejectionLead = single
    ? IMPORT_REJECTION_LEAD_RADARR
    : IMPORT_REJECTION_LEAD_SONARR

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
      <Dialog.Root
        open={open}
        onOpenChange={next => {
          if (!next) {
            close()
          }
        }}
      >
        <Dialog.Popup initialFocus={cancelRef}>
          <Dialog.Title>{importDialogTitle(title)}</Dialog.Title>
          <Dialog.Description>{IMPORT_DESCRIPTION}</Dialog.Description>
          {candidates === null ? (
            <div className={cns('flex items-center gap-2.5')}>
              <Spinner className={cns('size-4')} />
              <p className={cns('text-sm text-ink-3')}>{IMPORT_LOADING_NOTE}</p>
            </div>
          ) : candidates.length === 0 ? (
            <p className={cns('text-sm text-ink-3')}>{IMPORT_EMPTY_NOTE}</p>
          ) : single ? (
            <ReasonGroup
              aria-label={IMPORT_MOVIE_GROUP_LABEL}
              value={[...selected][0] ?? ''}
              onValueChange={path => {
                const candidate = candidates.find(entry => entry.path === path)

                if (candidate) {
                  toggle(candidate)
                }
              }}
            >
              <span className={cns(LEGEND)}>{IMPORT_MOVIE_GROUP_LABEL}</span>
              {candidates.map((candidate, index) => (
                <ImportRow
                  candidate={candidate}
                  checked={selected.has(candidate.path)}
                  key={candidate.path}
                  reasonId={`${rowIdBase}-${index}`}
                  single
                  onToggle={toggle}
                />
              ))}
            </ReasonGroup>
          ) : (
            <div
              aria-label={IMPORT_FILES_GROUP_LABEL}
              className={cns('flex flex-col gap-2')}
              role="group"
            >
              <span className={cns(LEGEND)}>{IMPORT_FILES_GROUP_LABEL}</span>
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
            <Note icon={<Icon name="alert" />} lead={rejectionLead} tone="warn">
              {rejections.map(rejection => (
                <span className={cns('block')} key={rejection}>
                  {rejection}
                </span>
              ))}
            </Note>
          ) : null}
          <div>
            <Button
              aria-disabled={pending || undefined}
              icon="trash"
              size="sm"
              variant="bad"
              onClick={() => setConfirmingDiscard(true)}
            >
              {IMPORT_DISCARD_LABEL}
            </Button>
          </div>
          {error && !confirmingDiscard ? (
            <p className={cns(ERROR_LINE)} role="alert">
              {error}
            </p>
          ) : null}
          <Dialog.Actions>
            <Button ref={cancelRef} size="sm" variant="ghost" onClick={close}>
              {IMPORT_CANCEL_LABEL}
            </Button>
            {importable ? (
              <Button
                aria-disabled={pending || selected.size === 0 || undefined}
                iconEnd="check"
                size="sm"
                variant="accent"
                onClick={commit}
              >
                {IMPORT_CONFIRM_LABEL}
              </Button>
            ) : null}
          </Dialog.Actions>
          <ConfirmDialog
            body={
              <>
                {IMPORT_DISCARD_NOTE}
                {error ? (
                  <span className={cns(ERROR_LINE, 'mt-3 block')} role="alert">
                    {error}
                  </span>
                ) : null}
              </>
            }
            cancelLabel={IMPORT_DISCARD_KEEP_LABEL}
            confirmLabel={IMPORT_DISCARD_LABEL}
            open={confirmingDiscard}
            pending={working}
            title={IMPORT_DISCARD_TITLE}
            onConfirm={discard}
            onOpenChange={next => {
              if (!next) {
                setConfirmingDiscard(false)
                setError(null)
              }
            }}
          />
        </Dialog.Popup>
      </Dialog.Root>
    </div>
  )
}

type ImportRowProps = {
  candidate: ManualImportCandidate
  checked: boolean
  onToggle: (candidate: ManualImportCandidate) => void
  reasonId: string
  /** A movie's row: a `radio` with a round dot rather than a `checkbox`. */
  single?: boolean
}

/**
 * One candidate file: whether it is going in, what it is, and what it was
 * resolved to.
 *
 * A real `<button role="checkbox">` — or `role="radio"` for a movie's row,
 * inside `ReasonGroup` — rather than the mockup's `<div>`, for the same reason
 * `Reason` in `reason.tsx` is a `<button role="radio">`: the row is genuinely
 * activatable, and a button brings its own activation, its own keyboard
 * handling and the theme's `:focus-visible` ring with it.
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
  single = false,
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
  const meta = [primary, secondary, languages].filter(Boolean).join(' · ')

  const blocked = !candidate.importable
  const reason = blocked
    ? (candidate.blockedReason ?? IMPORT_BLOCKED_REASON)
    : null

  // One label, so a screen reader reads the file, what it is and why it is
  // greyed out as one thing.
  const body = (
    <span
      className={cns('flex min-w-0 flex-col gap-0.5')}
      title={candidate.path}
    >
      <span className={cns(ROW_TITLE)}>{name}</span>
      <span className={cns(ROW_META)}>{meta}</span>
      {isSampleCandidate(candidate) ? (
        <span className={cns(ROW_NOTE)}>{IMPORT_SAMPLE_NOTE}</span>
      ) : null}
      {reason ? (
        <span className={cns(ROW_NOTE)} id={reasonId}>
          {reason}
        </span>
      ) : null}
    </span>
  )
  const className = cns(ROW, blocked && ROW_BLOCKED)

  // ⚠️ `disabled`, not `aria-disabled`: the package's radio and checkbox have
  // no inert-but-focusable state, and the reason is part of the row's own
  // label rather than a description hanging off it, so nothing is lost when
  // the control leaves the tab order.
  return single ? (
    <Reason
      className={className}
      disabled={blocked}
      label={body}
      value={candidate.path}
    />
  ) : (
    <Checkbox
      checked={checked}
      className={className}
      disabled={blocked}
      label={body}
      onCheckedChange={() => onToggle(candidate)}
    />
  )
}
