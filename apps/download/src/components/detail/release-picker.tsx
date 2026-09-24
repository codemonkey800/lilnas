'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  BadFile,
  GrabReleaseInput,
  ListReleasesQuery,
  Release,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'
import { useId, useState, useTransition } from 'react'

import type {
  ReleaseActionResult,
  ReleaseSearchResult,
} from 'src/app/actions/media-files'
import type {
  FlagBadFileAction,
  UnflagBadFileAction,
} from 'src/components/detail/bad-file-flag'
import { BadFileFlag } from 'src/components/detail/bad-file-flag'
import { Button } from 'src/components/ui/button'
import { Card, Note } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { Skeleton } from 'src/components/ui/feedback'
import { StateLineActions } from 'src/components/ui/state-line'
import { formatBytes, UNKNOWN_VALUE } from 'src/lib/format'

/** The section heading. `movie-detail.pug:71`. */
export const RELEASE_SECTION_LABEL = 'Release'

/** The explicit, deliberate trigger. Never fires on mount, hover or focus. */
export const RELEASE_SEARCH_LABEL = 'Find releases'

/** Offered again once results are on screen. */
export const RELEASE_SEARCH_AGAIN_LABEL = 'Search again'

/**
 * ⚠️ Why the list is behind a button rather than simply loaded.
 *
 * `GET /download/media/:id/releases` fires a real interactive search at every
 * configured indexer — 30s+ — and **writes upstream despite being a GET**:
 * Radarr and Sonarr will not surface releases for an unmonitored title, so the
 * backend borrows monitoring and puts it back. Firing that on page load, on
 * hover, or on a prefetch would mutate a user's library as a side effect of
 * *looking* at a page.
 *
 * So the note says what the button will do before it does it, and says that
 * looking is still free.
 */
export const RELEASE_SEARCH_NOTE =
  'Asks every indexer directly, which usually takes about half a minute. Nothing is downloaded until you pick a release.'

/** While the indexers are being asked. */
export const RELEASE_SEARCHING_NOTE =
  'Asking every indexer — this takes a while.'

/** A search that came back with nothing. Not an error. */
export const RELEASE_EMPTY_NOTE =
  'No indexer had anything for this. Try again later — new releases show up all the time.'

/** The chip on the release currently on disk. `movie-detail.pug:93`. */
export const RELEASE_CURRENT_LABEL = 'current'

/** The chip on a reported release. `movie-detail.pug:88`. */
export const RELEASE_FLAGGED_LABEL = 'bad file'

/** Grab a release when there is no file yet. `movie-detail.pug:97`. */
export const RELEASE_GRAB_LABEL = 'Download this'

/**
 * Swap the file on disk for a different release.
 *
 * ⚠️ "Replace", not "Delete then download". This is **one** call —
 * `POST …/releases/replace` deletes and grabs as a single action, so a failure
 * cannot leave the title with a deleted file and no replacement. The label
 * names the atomic operation because that is genuinely what happens; a
 * two-button "delete" / "download" arrangement would be a different, worse
 * flow wearing the same words.
 */
export const RELEASE_REPLACE_LABEL = 'Replace with this'

/**
 * Why a reported release cannot be grabbed, said in the row.
 *
 * The backend answers a grab of a flagged release with **409**, so the choice
 * is between disabling it here with a reason and letting the user find out by
 * clicking. "This app" is doing real work in that sentence — the flag is this
 * app's own `bad_files` row, and Radarr and Sonarr can still pick the release
 * from their own interfaces (the spec's accepted gap, §6). See
 * `REPORT_SCOPE_CAVEAT` in `bad-file-flag.tsx`, which says the same thing from
 * the other side.
 */
export const RELEASE_FLAGGED_REASON =
  "Reported as a bad file — this app won't grab it."

/** Radarr/Sonarr refused this release and gave no reason of their own. */
export const RELEASE_REJECTED_REASON =
  "Rejected — it doesn't meet this title's quality profile."

/**
 * The page-level explanation for a list in which no row can be taken.
 *
 * ⚠️ Says what is **observable**, and nothing else. The real cause of the
 * observed case was a quality profile with `upgradeAllowed: false`, and nothing
 * on the wire says so — `Release` carries the refusal, never the policy behind
 * it. So this states the fact, points at the rows, and
 * {@link blockedReleaseReasons} surfaces upstream's own words underneath it.
 * Guessing at a cause here would be inventing one.
 */
export const RELEASE_ALL_BLOCKED_NOTE =
  'Nothing in this list can be downloaded right now. Each row says why.'

/**
 * How many distinct reasons the page-level note repeats before it stops.
 *
 * A 72-row list can carry 72 near-identical refusals; the note is a summary,
 * and every row still carries its own — which is what
 * {@link RELEASE_ALL_BLOCKED_NOTE} points at.
 */
const BLOCKED_REASON_LIMIT = 3

/**
 * An upstream rejection string, cleaned of the one artifact it is known to
 * leak.
 *
 * Observed live: `Existing file meets cutoff: WORKPRINT []`, where `[]` is an
 * empty custom-format list serialized literally. The episode list rendered the
 * same sentence as `… cutoff: SDTV`, with no brackets at all — so the same
 * refusal reaches this app two different ways and only one of them is
 * readable.
 *
 * ⚠️ Deliberately narrow. Upstream's own words say far more than any sentence
 * written here ("Quality WEBDL-2160p is wanted"), so this removes an empty
 * bracket group and closes up the double space it leaves behind, and
 * re-authors nothing else. Returns `''` for a rejection that was *only* an
 * artifact, which {@link releaseBlockReason} reads as "upstream gave no
 * reason".
 */
export function formatRejection(rejection: string): string {
  return rejection
    .replace(/\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Why this row cannot be taken, or `null` when it can.
 *
 * The blocking rule in one place, because three callers need the same answer:
 * the row (to dim, strike and disable itself), the picker (to decide whether
 * the *whole list* is dead and needs a page-level explanation), and the tests.
 *
 * ⚠️ **A row wearing the `current` chip is never blocked.** The backend already
 * forces `downloadAllowed: true` / `rejected: false` on the current release it
 * *synthesizes*, precisely so that row does not look broken — but that only
 * covers the synthesized row. When an indexer search genuinely returns the
 * release already on disk, it arrives carrying upstream's rejection (`Existing
 * file meets cutoff: …`, which is upstream describing *itself*), and the row
 * rendered dimmed and struck through while still chipped green `current`.
 * Observed on seven titles. The rejection is true and useless: it says the file
 * you have is the file you have.
 *
 * A **flagged** release is still blocked even when it is the current one — that
 * is this app's own refusal, the user asked for it, and the chip reads
 * `bad file` rather than `current` in that case.
 */
export function releaseBlockReason(
  release: Release,
  current = false,
): string | null {
  // Flagged first: it is this app's own refusal and the one the user can do
  // something about.
  if (release.flaggedBad) {
    return RELEASE_FLAGGED_REASON
  }

  if (current) {
    return null
  }

  if (!release.rejected && release.downloadAllowed) {
    return null
  }

  // An upstream rejection is reported in upstream's words when it gave any,
  // because "Quality WEBDL-2160p is wanted" says far more than any sentence
  // written here could.
  return (
    release.rejections?.map(formatRejection).find(Boolean) ??
    RELEASE_REJECTED_REASON
  )
}

/**
 * The distinct reasons a dead list gives, in the order the rows give them and
 * capped at {@link BLOCKED_REASON_LIMIT}.
 *
 * Exported for the picker's page-level note and for its test — the note repeats
 * what upstream said rather than summarising it, which is the difference
 * between explaining and guessing.
 */
export function blockedReleaseReasons(
  reasons: readonly (string | null)[],
): readonly string[] {
  const distinct = new Set(
    reasons.filter((reason): reason is string => reason !== null),
  )

  return [...distinct].slice(0, BLOCKED_REASON_LIMIT)
}

/**
 * `flex px-1 py-[13px]` and the self-drawn divider are `movie-detail.pug`'s
 * `release` mixin verbatim. `flex-wrap` is the one addition: a blocked row
 * carries a reason line, and wrapping is what lets that line sit under the
 * columns without turning the mixin's row into a column container.
 */
const ROW_BASE = cns(
  'flex flex-wrap px-1 py-[13px]',
  '[&+&]:border-t [&+&]:border-line-soft',
)

const ROW_DESKTOP = 'items-center gap-[14px]'
const ROW_MOBILE = 'flex-col items-start gap-[9px]'

/** The dimming `movie-detail.pug` gives a struck-through, unusable row. */
const ROW_BLOCKED = 'opacity-55'

const ROW_PRIMARY = 'font-mono text-mono-sm text-ink-3'

/**
 * The scene name. `ink-3`, not `ink-4`, and that is the point of the column:
 * this is the only field that genuinely identifies a release, so it is not
 * allowed to sit below AA. Truncated rather than wrapped, with the full value
 * still on the row's `title` attribute.
 */
const ROW_TITLE = 'font-mono text-mono-sm text-ink-3'

/** A machine annotation — the indexer's own name — which is what `ink-4` is for. */
const ROW_SECONDARY = 'font-mono text-mono-sm text-ink-4'

/** A sentence, so `ink-3`. Full-width, which is what wraps it onto its own line. */
const ROW_REASON = 'w-full text-cap text-ink-3'

const ERROR_LINE = 'font-mono text-[11px] text-bad'

/**
 * What the explicit interactive search answers with.
 *
 * `void` is accepted so a test spy or a client-side stub is assignable; a
 * resolved value with no `error` and no `releases` is read as "nothing found".
 */
export type ReleaseSearchAction = (
  mediaId: string,
  query: ListReleasesQuery,
) => Promise<ReleaseSearchResult | void> | void

/**
 * What a page hands over for a grab or a replace.
 *
 * One type for both, because `ReplaceReleaseInputSchema` *is*
 * `GrabReleaseInputSchema` — aliased upstream rather than re-declared, so the
 * two can never drift. `(mediaId, input)` matches `grabRelease` and
 * `replaceRelease` in `src/app/actions/media-files.ts` exactly, so a page
 * passes the unbound server-action reference straight through.
 */
export type ReleaseAction = (
  mediaId: string,
  input: GrabReleaseInput,
) => Promise<ReleaseActionResult | void> | void

export type ReleasePickerProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onSelect'
> & {
  /**
   * The flags this title already carries — `client.listBadFiles(id)`. Joined
   * to a row on `releaseGuid`, so the report control on the current release
   * knows it has already been used and `BadFileFlag` can offer the undo.
   *
   * Independent of `Release.flaggedBad`, which the backend annotates for the
   * same reason: a row can be flagged without this list being loaded, and the
   * row is still disabled either way.
   */
  badFiles?: readonly BadFile[]
  /**
   * The guid of the release currently on disk, when the page knows it. Drives
   * the `current` chip, and defaults {@link ReleasePickerProps.hasFile}.
   */
  currentGuid?: string
  /**
   * **Show only.** Sonarr's episode primary key. Scopes the search, the grab
   * and the replace to one episode; a movie caller passes neither this nor
   * `seasonNumber`, and Radarr ignores both.
   */
  episodeId?: number
  /**
   * Whether there is a file on disk for this scope. `true` turns every pick
   * into a **replace** — one call that deletes and grabs together. Defaults to
   * `currentGuid !== undefined`.
   */
  hasFile?: boolean
  /** The section heading. `null` suppresses it when the page draws its own. */
  label?: ReactNode
  /** The `mediaId()` key — `tmdb:438631`, `tvdb:121361`. */
  mediaId: string
  /**
   * Stack each row and its actions, which is the mockups' mobile frame. A
   * layout switch rather than a breakpoint, matching `StateLine`.
   */
  mobile?: boolean
  /** Omitted renders no report control on the current release. */
  onFlag?: FlagBadFileAction
  onGrab?: ReleaseAction
  onReplace?: ReleaseAction
  /**
   * ⚠️ The interactive search. Called **only** from a click on the picker's own
   * trigger — never on mount, never on hover, never on focus. See
   * {@link RELEASE_SEARCH_NOTE} for why that is a correctness rule and not a
   * performance one.
   */
  onSearch?: ReleaseSearchAction
  /** Passed through to the report control. Omitted renders no undo. */
  onUnflag?: UnflagBadFileAction
  /** Reason list for the report dialog — a show passes `REPORT_REASONS_EPISODE`. */
  reportReasons?: readonly string[]
  /** Dialog heading for the report control — a show passes `REPORT_PROMPT_EPISODE`. */
  reportPrompt?: ReactNode
  /**
   * Results the page already holds, if it has any. Normally omitted: loading
   * them costs an indexer sweep, so the usual state is "nothing yet, here is
   * the button". A search run from this component wins over this prop; pass a
   * `key` to reset.
   */
  releases?: readonly Release[]
  /** **Show only.** Scopes the search and the grab to one season. */
  seasonNumber?: number
}

/**
 * The list of what Radarr/Sonarr actually found, and the two things you can do
 * with a row: take it, or report it.
 *
 * Ports `movie-detail.pug`'s `releaseList`/`release` mixins. One structural
 * departure from the mockup, and it is the whole design of this component:
 *
 * ⚠️ **The list is behind an explicit button.** The mockups draw it already
 * populated, which is a fine thing for a still image and an unsafe thing for an
 * app: `GET /download/media/:id/releases` fires a 30s+ interactive search at
 * every indexer *and can write upstream*, because Radarr and Sonarr will not
 * surface releases for an unmonitored title and the backend borrows monitoring
 * to ask. Rendering the populated list on page load would mutate a library as a
 * side effect of navigation, and Next's link prefetching would do it for pages
 * nobody even opened. So the search is a user action, it says what it will do
 * first, and this component never calls `onSearch` from anything but a press.
 *
 * The rest follows the mockup:
 *
 * - A **flagged** row is dimmed, struck through, chipped `bad file`, **and its
 *   grab control is left in place, disabled, with the reason beside it**. The
 *   mockup simply omits the control; a disabled control that explains itself is
 *   the better answer to "grabbing this is a 409", and it is `aria-disabled`
 *   rather than `disabled` so the reason stays reachable by keyboard (the
 *   button is `type="button"`, so `Button`'s swallowed `onClick` genuinely
 *   stops it).
 * - Picking a row when a file is already there is a **replace**: one call, not
 *   a delete followed by a grab. This component is given no delete action at
 *   all, which is the structural guarantee.
 * - The **current** row offers `BadFileFlag` rather than a grab, which is what
 *   `movie-detail.pug` draws.
 */
export function ReleasePicker({
  badFiles,
  className,
  currentGuid,
  episodeId,
  hasFile,
  label = RELEASE_SECTION_LABEL,
  mediaId,
  mobile = false,
  onFlag,
  onGrab,
  onReplace,
  onSearch,
  onUnflag,
  releases,
  reportPrompt,
  reportReasons,
  seasonNumber,
  ...props
}: ReleasePickerProps): JSX.Element {
  const [searched, setSearched] = useState<readonly Release[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, startSearch] = useTransition()
  const [picking, startPick] = useTransition()
  const reasonIdBase = useId()

  // A search run here wins over whatever the page supplied, because it is
  // strictly newer. No effect syncs the two — this package lints
  // `setState` in an effect as an error, and a `key` is the sanctioned reset.
  const list = searched ?? releases ?? null
  const replacing = hasFile ?? currentGuid !== undefined

  function search(): void {
    if (!onSearch) {
      return
    }

    setError(null)

    startSearch(async () => {
      // ⚠️ Reached only from the trigger's `onClick`. Nothing else in this
      // file calls `search()`.
      const result = await onSearch(mediaId, { episodeId, seasonNumber })

      if (result && 'error' in result) {
        setError(result.error)

        return
      }

      setSearched(result && 'releases' in result ? result.releases : [])
    })
  }

  function pick(release: Release): void {
    const action = replacing ? onReplace : onGrab

    if (!action) {
      return
    }

    setError(null)

    startPick(async () => {
      const result = await action(mediaId, {
        episodeId,
        guid: release.guid,
        indexerId: release.indexerId,
        seasonNumber,
      })

      if (result && 'error' in result) {
        setError(result.error)
      }
    })
  }

  // One pass over the list, so the row and the page-level note can never
  // disagree about which rows are dead. See `releaseBlockReason`.
  const rows = (list ?? []).map(release => {
    const current = currentGuid !== undefined && release.guid === currentGuid

    return { current, reason: releaseBlockReason(release, current), release }
  })

  // ⚠️ The whole-list explanation, and the condition is deliberately "nothing
  // here is actionable" rather than "everything is rejected": the current row
  // is not blocked and still offers nothing to download, and a list of one
  // current release plus twenty-five refusals is exactly as dead as a list of
  // twenty-six refusals. Only claimed when there is a pick action at all —
  // a read-only picker refuses nothing.
  const pickable = onGrab !== undefined || onReplace !== undefined
  const stuck =
    pickable && rows.length > 0 && rows.every(row => row.current || row.reason)
  const stuckReasons = stuck
    ? blockedReleaseReasons(rows.map(row => row.reason))
    : []

  return (
    <div {...props} className={cns('flex flex-col', className)}>
      {label === null ? null : <h2 className={cns('mb-3 text-h2')}>{label}</h2>}
      {list === null ? (
        <SearchPrompt
          mobile={mobile}
          pending={searching}
          onSearch={onSearch ? search : undefined}
        />
      ) : (
        <>
          {stuck ? (
            <Note className={cns('mb-2.5')}>
              <p>{RELEASE_ALL_BLOCKED_NOTE}</p>
              {stuckReasons.length > 0 ? (
                <ul className={cns('mt-1.5 flex flex-col gap-1 text-cap')}>
                  {stuckReasons.map(reason => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </Note>
          ) : null}
          <Card className={cns(mobile ? 'px-[14px] py-1' : 'px-4 py-1')} sunk>
            {rows.length === 0 ? (
              <p className={cns('py-[13px] text-sm text-ink-3')}>
                {RELEASE_EMPTY_NOTE}
              </p>
            ) : (
              rows.map(({ current, reason, release }, index) => (
                <ReleaseRow
                  badFiles={badFiles}
                  current={current}
                  key={release.guid}
                  mediaId={mediaId}
                  mobile={mobile}
                  pending={picking}
                  reason={reason}
                  reasonId={`${reasonIdBase}-${index}`}
                  release={release}
                  replacing={replacing}
                  reportPrompt={reportPrompt}
                  reportReasons={reportReasons}
                  onFlag={onFlag}
                  onPick={onGrab || onReplace ? pick : undefined}
                  onUnflag={onUnflag}
                />
              ))
            )}
          </Card>
          {onSearch ? (
            <div className={cns('mt-2.5 flex')}>
              <Button
                aria-disabled={searching || undefined}
                icon="search"
                size="sm"
                variant="ghost"
                onClick={search}
              >
                {searching
                  ? RELEASE_SEARCHING_NOTE
                  : RELEASE_SEARCH_AGAIN_LABEL}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <p className={cns('mt-2', ERROR_LINE)} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

type SearchPromptProps = {
  mobile: boolean
  onSearch?: () => void
  pending: boolean
}

/**
 * The "nothing has been asked yet" state, which is the state a detail page
 * loads in. Says what the button will do — and how long it takes — before it
 * does it.
 */
function SearchPrompt({
  mobile,
  onSearch,
  pending,
}: SearchPromptProps): JSX.Element {
  if (pending) {
    return <ReleaseListSkeleton mobile={mobile} />
  }

  return (
    <Card className={cns(mobile ? 'px-[14px] py-4' : 'px-4 py-[18px]')} sunk>
      <p className={cns('mb-[14px] text-sm text-ink-3')}>
        {RELEASE_SEARCH_NOTE}
      </p>
      <Button
        full={mobile}
        icon="search"
        size="sm"
        variant="outline"
        onClick={onSearch}
      >
        {RELEASE_SEARCH_LABEL}
      </Button>
    </Card>
  )
}

/**
 * Column widths for {@link ReleaseRowSkeleton}, varied so the placeholder list
 * does not read as a checkerboard — the same reasoning as `search-skeletons.tsx`'s
 * `GRID_SKELETONS`.
 */
const SKELETON_ROWS: ReadonlyArray<{ secondary: string; title: string }> = [
  { secondary: '30%', title: '62%' },
  { secondary: '42%', title: '48%' },
  { secondary: '24%', title: '70%' },
  { secondary: '36%', title: '55%' },
]

/**
 * One placeholder row, shaped like {@link ReleaseRow} — same columns, same
 * `sm`-sized action bar — so the list does not jump when the real rows land.
 */
function ReleaseRowSkeleton({
  mobile,
  secondary,
  title,
}: {
  mobile: boolean
  secondary: string
  title: string
}): JSX.Element {
  if (mobile) {
    return (
      <div className={cns(ROW_BASE, ROW_MOBILE)}>
        <Skeleton className={cns('h-[13px] w-[90px]')} />
        <Skeleton className={cns('h-[13px] w-full')} style={{ width: title }} />
        <Skeleton className={cns('h-[11px]')} style={{ width: secondary }} />
      </div>
    )
  }

  return (
    <div className={cns(ROW_BASE, ROW_DESKTOP)}>
      <Skeleton className={cns('h-[13px] w-[110px] shrink-0')} />
      <Skeleton
        className={cns('h-[13px] w-[340px] min-w-0 shrink')}
        style={{ width: title }}
      />
      <Skeleton
        className={cns('h-[11px] min-w-0 flex-1')}
        style={{ maxWidth: secondary }}
      />
      <Skeleton className={cns('h-[30px] w-[130px] shrink-0 rounded-md')} />
    </div>
  )
}

/**
 * The shape of the answer before the answer arrives, shown while
 * {@link ReleasePicker} is asking every indexer. Same `Card` the real list
 * lands in, so nothing about the frame around it changes when the rows do.
 */
function ReleaseListSkeleton({ mobile }: { mobile: boolean }): JSX.Element {
  return (
    <Card className={cns(mobile ? 'px-[14px] py-1' : 'px-4 py-1')} sunk>
      {SKELETON_ROWS.map((widths, index) => (
        <ReleaseRowSkeleton key={index} mobile={mobile} {...widths} />
      ))}
    </Card>
  )
}

type ReleaseRowProps = {
  badFiles?: readonly BadFile[]
  current: boolean
  mediaId: string
  mobile: boolean
  onFlag?: FlagBadFileAction
  onPick?: (release: Release) => void
  onUnflag?: UnflagBadFileAction
  pending: boolean
  /** {@link releaseBlockReason}'s answer, computed once by the picker. */
  reason: string | null
  reasonId: string
  release: Release
  replacing: boolean
  reportPrompt?: ReactNode
  reportReasons?: readonly string[]
}

/**
 * One row: what the release is, where it came from, and what you can do about
 * it.
 *
 * Three mono columns rather than the mockup's two, and the added one is the
 * **release title**. It used to ride along on the row's `title` attribute
 * alone, which is invisible on touch and unreliable to a screen reader — and
 * the cost of that has now been measured on the real page: one title returned
 * 72 rows all reading `WEBDL-1080p · 2.5 GB / NzbGeek`, many of them
 * byte-identical. `Release.title` is the only field that truly identifies a
 * release, so it gets a column, truncated to hold the row to one line, with the
 * full value still on the `title` attribute for a hover.
 *
 * Everything else a `Release` carries — seeders, age, custom-format score — is
 * still deliberately column-less: the row is a row, not a table.
 */
function ReleaseRow({
  badFiles,
  current,
  mediaId,
  mobile,
  onFlag,
  onPick,
  onUnflag,
  pending,
  reason,
  reasonId,
  release,
  replacing,
  reportPrompt,
  reportReasons,
}: ReleaseRowProps): JSX.Element {
  const quality = release.quality?.name
  const size = release.size === undefined ? null : formatBytes(release.size)
  // The title is its own column now, so an unqualified release falls back to
  // the em dash rather than repeating the name two columns over.
  const primary = [quality, size].filter(Boolean).join(' · ') || UNKNOWN_VALUE
  const secondary = release.indexer ?? release.releaseGroup ?? UNKNOWN_VALUE

  const blocked = reason !== null
  const flag = badFiles?.find(entry => entry.releaseGuid === release.guid)

  const chip = release.flaggedBad ? (
    <Chip label={RELEASE_FLAGGED_LABEL} tone="bad" />
  ) : current ? (
    <Chip label={RELEASE_CURRENT_LABEL} tone="ok" />
  ) : null

  // The current release is the one already on disk, so there is nothing to
  // take — `movie-detail.pug` draws exactly that split and it still holds.
  const pick =
    current || !onPick ? null : (
      <Button
        // ⚠️ `aria-disabled`, not `disabled`. A real `disabled` attribute drops
        // the control out of the focus order, and with it the
        // `aria-describedby` that carries the *reason* — which is the entire
        // point of disabling it here rather than letting the click come back
        // 409. `Button` swallows `onClick` while this is truthy, and it is
        // `type="button"`, so nothing native routes around it.
        aria-describedby={blocked ? reasonId : undefined}
        aria-disabled={blocked || pending || undefined}
        full={mobile}
        iconEnd="download"
        size="sm"
        variant="outline"
        onClick={() => onPick(release)}
      >
        {replacing ? RELEASE_REPLACE_LABEL : RELEASE_GRAB_LABEL}
      </Button>
    )

  // ⚠️ **Every** row, not just the current one. Reporting a bad file you have
  // not downloaded is a valid thing to want to do — a release that is mislabeled
  // or a fake is worth excluding *before* it lands — and the control reaching
  // only the current row was an accident of how this list was first built, not
  // a considered restriction. Before this, the only way to flag anything else
  // was the API.
  const report = onFlag ? (
    <BadFileFlag
      flag={flag ?? null}
      full={mobile}
      mediaId={mediaId}
      mobile={mobile}
      prompt={reportPrompt}
      reasons={reportReasons}
      release={{
        guid: release.guid,
        indexerId: release.indexerId,
        title: release.title,
      }}
      onFlag={onFlag}
      onUnflag={onUnflag}
    />
  ) : null

  const actions = pick || report

  if (mobile) {
    return (
      <div
        className={cns(ROW_BASE, ROW_MOBILE, blocked && ROW_BLOCKED)}
        title={release.title}
      >
        <span className={cns('flex w-full items-center gap-2')}>
          <span className={cns(ROW_PRIMARY, blocked && 'line-through')}>
            {primary}
          </span>
          {chip}
        </span>
        <span
          className={cns(
            'w-full truncate',
            ROW_TITLE,
            blocked && 'line-through',
          )}
        >
          {release.title}
        </span>
        <span className={cns(ROW_SECONDARY)}>{secondary}</span>
        {reason ? (
          <p className={cns(ROW_REASON)} id={reasonId}>
            {reason}
          </p>
        ) : null}
        {actions ? (
          // ⚠️ Stacked, not `StateLineActions`' usual side-by-side split.
          // Measured at 390px: `Replace with this` (177px) beside `Report a
          // problem` (170px) needs 355px of a 304px line, and `Button` is
          // `whitespace-nowrap`, so the second label simply ran out past the
          // card. Stacking full-width controls on a phone is what every other
          // action row in this app does anyway.
          <StateLineActions className={cns('flex-col')}>
            {pick}
            {report}
          </StateLineActions>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cns(ROW_BASE, ROW_DESKTOP, blocked && ROW_BLOCKED)}
      title={release.title}
    >
      <span
        className={cns(
          'w-[200px] shrink-0',
          ROW_PRIMARY,
          blocked && 'line-through',
        )}
      >
        {primary}
      </span>
      {/*
        ⚠️ A fixed width that may shrink, **not** `flex-1`. The indexer keeps
        the mockup's `flex-1` — it is still the column that absorbs the row's
        slack — because a title on `flex-1` would take a different width on
        every row (a row with a grab control has ~177px less to give than one
        without) and drag the indexer to a different x behind it. A column that
        does not line up is not a column. `shrink` keeps it honest below `sm`,
        and `min-w-0` is what lets `truncate` work inside a flex item at all.
      */}
      <span
        className={cns(
          'w-[340px] min-w-0 shrink truncate',
          ROW_TITLE,
          blocked && 'line-through',
        )}
      >
        {release.title}
      </span>
      <span className={cns('min-w-0 flex-1 truncate', ROW_SECONDARY)}>
        {secondary}
      </span>
      {chip}
      {pick}
      {report}
      {reason ? (
        <p className={cns(ROW_REASON)} id={reasonId}>
          {reason}
        </p>
      ) : null}
    </div>
  )
}
