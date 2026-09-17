import { cns } from '@lilnas/utils/cns'
import type { BadFile, DownloadJob, Movie } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

import type {
  FlagBadFileAction,
  UnflagBadFileAction,
} from 'src/components/detail/bad-file-flag'
import type { CastMember } from 'src/components/detail/cast-row'
import { CastRow } from 'src/components/detail/cast-row'
import type {
  DeleteMediaFilesAction,
  DeleteScope,
} from 'src/components/detail/delete-confirm'
import { DeleteConfirm } from 'src/components/detail/delete-confirm'
import {
  DetailAttribution,
  DetailHeader,
} from 'src/components/detail/detail-header'
import { JobHistory, JobLifecycle } from 'src/components/detail/job-lifecycle'
import { latestJob } from 'src/components/detail/job-state'
import type {
  ReleaseAction,
  ReleaseSearchAction,
} from 'src/components/detail/release-picker'
import { ReleasePicker } from 'src/components/detail/release-picker'
import { SaveLocal } from 'src/components/detail/save-local'
import { ButtonLink } from 'src/components/ui/button-link'
import { Note } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { formatRuntime, UNKNOWN_VALUE } from 'src/lib/format'

/** The Emby handoff. `movie-detail.pug:42`. */
export const MOVIE_WATCH_LABEL = 'Watch'

/**
 * Emby has the file but has not finished indexing it, so there is nothing to
 * link to yet. A chip rather than a disabled Watch button: a disabled control
 * implies the user can do something about it, and nobody can hurry Emby's
 * scanner.
 */
export const MOVIE_INDEXING_LABEL = 'indexing…'

/**
 * `EmbyStatus.state === 'unknown'`, which `EmbyStatusService` sets when its
 * path index lookup *failed* — deliberately not when Emby simply has nothing
 * (that is `indexing`). So this says the player could not be asked, not that
 * the file is missing.
 */
export const MOVIE_EMBY_UNAVAILABLE_LABEL = 'emby unavailable'

/** The eyebrow over the lifecycle panel. */
export const MOVIE_STATUS_LABEL = 'Status'

/**
 * What the lifecycle panel says when a movie has no job and no file.
 *
 * The second sentence points at the one control that changes it, because
 * `JobLifecycle` is given no `emptyActions` — see {@link MovieDetail} for why
 * a movie has no one-press "Download".
 */
export const MOVIE_EMPTY_NOTE =
  'Nothing grabbed yet. Find a release below to download it.'

/**
 * What it says when a movie has no job but *does* have a file.
 *
 * ⚠️ The common case on this page, and the one the empty state reads wrong
 * without this. Radarr's library is full of titles this app never fetched —
 * `getMedia` resolves every one of them, jobs and all, and most have no job at
 * all. `JOB_LIFECYCLE_EMPTY_LABEL` is fixed at `not downloaded`, which is true
 * of the *job* and false of the *file*, so the note beside it has to be the
 * thing that says which. Spotted on the real page: "Nothing grabbed yet" sat
 * next to a working Watch button.
 */
export const MOVIE_LIBRARY_NOTE =
  "Already in the library — this app didn't fetch it, so there is no download to show."

/** Said when the resolver handed back a placeholder instead of a movie. */
export const MOVIE_METADATA_NOTE =
  "Radarr didn't answer, so this movie's title and details are missing — only its id is known. Trying again in a moment usually fixes it."

/**
 * Stacked and full width on a phone, inline from `sm` — `JobLifecycle`'s own
 * `ACTION_BUTTON`, spelled again here because that one is module-private and
 * this row is the header's, not the panel's.
 */
const ACTION_BUTTON = 'w-full sm:w-auto'

/** `movie-detail.pug`'s gap between the header, the status block and the list. */
const SECTION = 'mt-7 sm:mt-8'

/** `movie-detail.pug:351`'s section eyebrow (`Trailer`, here `Status`). */
const EYEBROW =
  'mb-2.5 font-mono text-label tracking-[0.11em] uppercase text-ink-4'

/**
 * ⚠️ A movie passes **no** `episodeId` and **no** `seasonNumber` anywhere —
 * Radarr's release and delete endpoints key on the movie alone and ignore
 * both. `{ kind: 'movie' }` is what `deleteScopeQuery` turns into the empty
 * query, which the backend reads as "every file of this title"; a movie has
 * exactly one, so widest and narrowest are the same request.
 */
const MOVIE_SCOPE: DeleteScope = { kind: 'movie' }

/**
 * ⚠️ Nothing on the wire populates a cast. `MediaBase` carries
 * `certification`, `genres`, `overview`, `posterUrl`, `ratingValue`,
 * `releaseDate`, `runtime`, `title` and `year` — and no cast field on any
 * media type. `CastRow` renders `null` for an empty list, so the slot is
 * wired up and draws nothing until one lands.
 */
const NO_CAST: readonly CastMember[] = []

/** What the header's Watch slot can be. */
export type MovieWatchState = 'indexed' | 'indexing' | 'none' | 'unknown'

/**
 * Which Emby affordance a movie has earned.
 *
 * Three facts, and the difference between them is the whole reason this is a
 * function rather than an `embyStatus?.state === 'indexed'` at the call site:
 *
 * - **`none`** — `embyStatus` is absent entirely, which `MediaResolverService`
 *   only does for a title with no file on disk. Emby was never consulted, so
 *   there is nothing to say and no control to draw.
 * - **`indexing`** — there is a file, and Emby has not indexed it yet.
 * - **`indexed`** — there is a file and Emby has it, so `watchUrl` is the
 *   place to watch it.
 *
 * ⚠️ `indexed` with no `watchUrl` degrades to `unknown` rather than rendering
 * a link to nowhere. The schema documents the two as arriving together, and
 * this is the one line that would have to be right for that to stay true.
 */
export function movieWatchState(movie: Movie): MovieWatchState {
  const status = movie.embyStatus

  if (!status) {
    return 'none'
  }

  switch (status.state) {
    case 'indexed':
      return status.watchUrl ? 'indexed' : 'unknown'
    case 'indexing':
      return 'indexing'
    case 'unknown':
      return 'unknown'
  }
}

/**
 * The one metadata line under the title — `2024 · 2h 04m · PG-13 · 7.4/10 ·
 * Drama, Thriller`.
 *
 * `movie-detail.pug`'s `META` is `year · runtime · genres`; certification and
 * rating are the two fields `MediaBase` carries that the mockup's sample
 * string happens not to show, and they go where they are cheapest to read —
 * after the two numbers everyone scans for and before the genre list, which is
 * the only part with a variable length.
 *
 * ⚠️ **`runtime` is seconds** (`toMovie()` multiplies Radarr's minutes by 60),
 * so `'hours'` — `2h 04m`. Every part is dropped rather than rendered as
 * {@link UNKNOWN_VALUE}: a metadata line made of em dashes says nothing that
 * its own absence does not, and `formatRuntime` already answers the dash for
 * the `0` upstream reports when it does not know a runtime.
 *
 * `null` when a movie has none of them, which is exactly the degraded
 * placeholder — see {@link isMetadataUnavailable}.
 */
export function movieMetaLine(movie: Movie): string | null {
  const runtime = formatRuntime(movie.runtime, 'hours')
  const rating = movie.ratingValue

  const parts = [
    movie.year === undefined ? null : String(movie.year),
    runtime === UNKNOWN_VALUE ? null : runtime,
    movie.certification ? movie.certification : null,
    rating !== undefined && Number.isFinite(rating) && rating > 0
      ? `${rating.toFixed(1)}/10`
      : null,
    movie.genres && movie.genres.length > 0 ? movie.genres.join(', ') : null,
  ].filter((part): part is string => part !== null)

  return parts.length === 0 ? null : parts.join(' · ')
}

/**
 * Whether this is the resolver's placeholder rather than a real movie.
 *
 * ⚠️ A `tmdb:` key **always resolves** — unlike a `video:` key, which 404s when
 * no row backs it. When Radarr's library cache and its per-id lookup both
 * fail, `MediaResolverService.resolveMovies` emits `{ id, title: id, tmdbId,
 * type }` and flags the source degraded, so the page is handed a movie whose
 * title is the literal string `tmdb:438631`. That is a metadata outage, not a
 * missing title, and answering it with `notFound()` would tell the user their
 * movie does not exist when Radarr was simply down.
 *
 * The test is `title === id` because `degradedSources` is not on
 * `MediaDetailResponse` — the detail endpoint drops it — and that equality is
 * precisely what the placeholder constructs. No real title is ever its own
 * media key.
 */
export function isMetadataUnavailable(movie: Movie): boolean {
  return movie.title === movie.id
}

export type MovieDetailProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /** `client.listBadFiles(movie.id)` — passed through to the release list. */
  badFiles?: readonly BadFile[]
  /** `MediaDetailResponse.jobs` verbatim, newest first. */
  jobs: readonly DownloadJob[]
  movie: Movie
  /** The instant every relative stamp is measured against, pinned by the page. */
  now: number
  onDelete?: DeleteMediaFilesAction
  onFlag?: FlagBadFileAction
  onGrab?: ReleaseAction
  onReplace?: ReleaseAction
  onSearch?: ReleaseSearchAction
  onUnflag?: UnflagBadFileAction
}

/**
 * `/movies/<tmdbId>` — everything a movie card leads to.
 *
 * Composes E1's header/lifecycle, E6's release picker and delete confirm and
 * E7's local save. It owns no state and no `'use client'` directive: the page
 * renders it on the server and hands the six server actions straight through,
 * and every interactive part below it is already a client component of its
 * own.
 *
 * Five call-site decisions worth stating, because each of them is a place the
 * mockup, the API or a sibling page says something different:
 *
 * - **Watch is a link to Emby, never an in-app player.** `ButtonLink`, not a
 *   `Button` — it navigates, so ⌘-click and "copy link address" have to work —
 *   and the URL is `embyStatus.watchUrl` exactly as it arrives. That string is
 *   built server-side from `EMBY_EXTERNAL_URL`, which is the browser-reachable
 *   host; `EMBY_URL` is the in-network one and is not. Nothing here constructs
 *   a URL.
 * - **The lifecycle panel is read-only.** Pause, resume and cancel are
 *   `PATCH /download/videos/:id/…` — *video-only* routes. There is no movie
 *   equivalent, so `JobLifecycle` is given no `onPause`/`onCancel`/`onRetry`
 *   and renders the status chip and the queue progress alone. It renders no
 *   `watch`/`save` link either: both live in the header row instead, because
 *   the panel only offers them while the newest job is `completed`, and a
 *   library movie with a file and no job at all — a common state here — would
 *   otherwise lose both.
 * - **There is no one-press "Download".** The mockup's state legend draws one;
 *   the real path to a file is the release picker, which is strictly better
 *   (the user picks) and is the only one this page has an action for.
 * - **Attribution is unconditional and has no hide toggle.** `requester`
 *   arrives already masked by `projectJobForViewer`, so `null` means "not
 *   yours to see" and `DetailAttribution` draws the dashed avatar for it. The
 *   rule is never re-derived here.
 * - **`currentGuid` is the payload's, and is often absent.** `GET /media/:id`
 *   annotates a movie with `currentReleaseGuid` — the release whose grab
 *   produced the file on disk, recovered from Radarr's history — and
 *   `ReleasePicker` hangs both the `current` chip and the report control off
 *   exactly that row. The backend guarantees the row is in the list it
 *   returns, synthesizing it from its own record when the indexers no longer
 *   have a months-old release. Absent means the guid could not be recovered (a
 *   manually imported file, or history since pruned), and the picker degrades
 *   to no chip and no report control rather than guessing at one.
 */
export function MovieDetail({
  badFiles,
  className,
  jobs,
  movie,
  now,
  onDelete,
  onFlag,
  onGrab,
  onReplace,
  onSearch,
  onUnflag,
  ...props
}: MovieDetailProps): JSX.Element {
  const job = latestJob(jobs)
  const watch = movieWatchState(movie)
  const watchUrl = movie.embyStatus?.watchUrl
  // The same test `canSaveLocal` makes for a movie, and the one Radarr itself
  // makes: `filePath` is the movie *file*, populated only once `hasFile`.
  const hasFile = movie.filePath !== undefined
  const degraded = isMetadataUnavailable(movie)

  const actions: ReactNode[] = []

  if (watch === 'indexed' && watchUrl !== undefined) {
    actions.push(
      <ButtonLink
        className={cns(ACTION_BUTTON)}
        href={watchUrl}
        iconEnd="eye"
        key="watch"
        rel="noreferrer"
        target="_blank"
        variant="uv"
      >
        {MOVIE_WATCH_LABEL}
      </ButtonLink>,
    )
  } else if (watch !== 'none') {
    actions.push(
      <Chip
        key="emby"
        label={
          watch === 'indexing'
            ? MOVIE_INDEXING_LABEL
            : MOVIE_EMBY_UNAVAILABLE_LABEL
        }
        tone={watch === 'indexing' ? 'uv' : 'mute'}
      />,
    )
  }

  if (hasFile) {
    actions.push(
      <SaveLocal className={cns(ACTION_BUTTON)} key="save" media={movie} />,
      // ⚠️ `full` **and** `w-full sm:w-auto`. `DeleteConfirm` renders a `<div>`
      // root, so `full` is the only way to stretch the trigger inside it; the
      // className then narrows the root itself back to content width from `sm`,
      // which `full`'s unconditional `w-full` cannot express on its own.
      <DeleteConfirm
        className={cns(ACTION_BUTTON)}
        full
        key="delete"
        mediaId={movie.id}
        onDelete={onDelete}
        scope={MOVIE_SCOPE}
        title={movie.title}
      />,
    )
  }

  const releaseProps = {
    badFiles,
    currentGuid: movie.currentReleaseGuid,
    // Every pick is a replace once there is a file — one call that deletes and
    // grabs together, never a delete followed by a grab. Passed explicitly
    // because the prop otherwise defaults off `currentGuid`, and the two are
    // not the same question: a file whose originating release could not be
    // recovered has no guid and still has to replace rather than grab.
    // `filePath` is the fact that decides it.
    hasFile,
    mediaId: movie.id,
    onFlag,
    onGrab,
    onReplace,
    onSearch,
    onUnflag,
  }

  return (
    <div {...props} className={className}>
      {/*
        The document's heading. `DetailHeader` renders the title as a
        `text-h1` paragraph and is a shipped component this task may not
        reopen, so the structure is supplied here — the same call `gallery`
        made for its own unlabelled screen.
      */}
      <h1 className={cns('sr-only')}>{movie.title}</h1>
      {degraded ? (
        <Note className={cns('mb-4')}>{MOVIE_METADATA_NOTE}</Note>
      ) : null}
      <DetailHeader
        actions={
          actions.length === 0 ? null : (
            <div
              className={cns(
                'flex flex-col gap-2',
                'sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5',
              )}
            >
              {actions}
            </div>
          )
        }
        attribution={
          job ? (
            <DetailAttribution
              now={now}
              requester={job.requester}
              timestamp={job.completedAt ?? job.createdAt}
            />
          ) : null
        }
        cast={<CastRow people={NO_CAST} />}
        media={movie}
        meta={movieMetaLine(movie)}
        synopsis={movie.overview}
      />
      <div className={cns(SECTION)}>
        <h2 className={cns(EYEBROW)}>{MOVIE_STATUS_LABEL}</h2>
        <JobLifecycle
          emptyNote={hasFile ? MOVIE_LIBRARY_NOTE : MOVIE_EMPTY_NOTE}
          jobs={jobs}
        />
      </div>
      <JobHistory className={cns(SECTION)} jobs={jobs} now={now} />
      {/*
        Two layouts, one of them `display: none` at any given width — the same
        arrangement `ActivityFeed` makes, and for the same reason: `mobile` is a
        layout switch rather than a breakpoint, and the stacked row is a genuine
        re-ordering rather than a reflow. Each copy keeps its own search state,
        which is harmless: a search is only ever started by pressing the visible
        copy's own trigger, and `display: none` takes the other one out of the
        accessible tree and the tab order both.
      */}
      <div className={cns(SECTION, 'hidden sm:block')}>
        <ReleasePicker {...releaseProps} />
      </div>
      <div className={cns(SECTION, 'sm:hidden')}>
        <ReleasePicker {...releaseProps} mobile />
      </div>
    </div>
  )
}
