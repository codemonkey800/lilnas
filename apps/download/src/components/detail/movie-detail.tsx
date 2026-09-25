import { cns } from '@lilnas/utils/cns'
import type {
  BadFile,
  DownloadJob,
  MediaState,
  Movie,
} from '@lilnas/utils/download/types'
import {
  isMediaInFlight,
  isTerminalDownloadJobStatus,
  mediaState,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

import { jobUpstreamSource } from 'src/components/activity/activity-requester'
import { AttemptList } from 'src/components/detail/attempt-list'
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
import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import type { JobAction } from 'src/components/detail/job-actions'
import { latestJob } from 'src/components/detail/job-state'
import { mediaProgress } from 'src/components/detail/media-state'
import { MediaStatus } from 'src/components/detail/media-status'
import type { MovieRequestAction } from 'src/components/detail/movie-request-button'
import { MovieRequestButton } from 'src/components/detail/movie-request-button'
import type {
  ReleaseAction,
  ReleaseSearchAction,
} from 'src/components/detail/release-picker'
import { ReleasePicker } from 'src/components/detail/release-picker'
import { SaveLocal } from 'src/components/detail/save-local'
import { ButtonLink } from 'src/components/ui/button-link'
import { Note } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { Dot } from 'src/components/ui/status'
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

/**
 * The note beside a download's progress when no attempt is behind it —
 * `movie-detail.pug`'s "Radarr upgrading the file on disk" frame. Progress
 * comes off the queue snapshot alone, so the bar still draws; this says why
 * there is nothing under it to cancel.
 *
 * ⚠️ Worded for an **upgrade** because, since plan 022, that is almost the
 * only time it shows. A download someone starts in Radarr's own UI is adopted
 * by the poller as an ordinary attempt — Cancel and all, credited to `Radarr`
 * — which clears the page's no-attempt-in-flight condition. What stays
 * un-adopted is a grab for a movie that already has a file: nobody asked this
 * app for it, so it remains a bare queue snapshot. The one other way here is
 * the ≤ 1 poller tick between Radarr queueing a fresh grab and its adoption,
 * where the sentence is briefly wrong and then gone.
 */
export const MOVIE_EXTERNAL_QUEUE_NOTE =
  "Radarr is upgrading the file already on disk — it can't be cancelled here."

/**
 * The marker under a moving download while the live feed is not connected.
 * The same word the video page and `/activity` use for the same condition.
 */
export const MOVIE_STALE_LABEL = 'reconnecting…'

/** Said when the resolver handed back a placeholder instead of a movie. */
export const MOVIE_METADATA_NOTE =
  "Radarr didn't answer, so this movie's title and details are missing — only its id is known. Trying again in a moment usually fixes it."

/**
 * Stacked and full width on a phone, inline from `sm` — `job-actions.tsx`'s
 * `ACTION_BUTTON`, spelled again here because that module is `'use client'`,
 * and a server render importing a plain string from one gets a client
 * reference back instead of the string.
 */
const ACTION_BUTTON = 'w-full sm:w-auto'

/** `movie-detail.pug`'s gap between the header, the attempts and the releases. */
const SECTION = 'mt-7 sm:mt-8'

/**
 * The states the header's one-press Download is offered in — nothing on disk
 * and nothing in Radarr's queue. Everything else either has a file or already
 * has a download under way.
 */
const DOWNLOADABLE_STATES: ReadonlySet<MediaState> = new Set<MediaState>([
  'absent',
  'wanted',
])

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

/**
 * Whether this movie has a file on disk, derived from what the payload
 * actually carries.
 *
 * ⚠️ **`Movie` has no `hasFile`.** `EpisodeSchema` has one; `MovieSchema` does
 * not, and never has — so anything keyed on a movie's `hasFile` reads
 * `undefined` for a movie that plainly is downloaded. Two fields stand in for
 * it, and both are `hasFile` in disguise:
 *
 * - **`filePath`** — `RadarrService.toMovie` populates it *only* when Radarr
 *   reports `hasFile`, so its presence is Radarr's own answer. It is still the
 *   primary test, and the one `canSaveLocal` makes.
 * - **`embyStatus`** — `MediaResolverService` consults Emby *only* for a title
 *   with a file, so its mere presence is a second, independent witness. It
 *   covers the case `filePath` alone misses: a movie resolved from Radarr's
 *   library cache, where `movieFile` was not expanded and `filePath` is
 *   therefore absent even though the file exists. That is exactly the payload
 *   shape the live page was handed — `embyStatus.state: 'indexed'`, a working
 *   Watch button, and no `filePath`.
 *
 * `state` is deliberately not inspected: `indexing` means Emby has the file and
 * has not catalogued it, `unknown` means Emby could not be asked. Neither is
 * "there is no file" — that case is `embyStatus` being absent entirely.
 */
export function movieHasFile(movie: Movie): boolean {
  return movie.filePath !== undefined || movie.embyStatus !== undefined
}

/**
 * ⚠️ `onCancel` and `onPause` are real `<div>` attributes (React's
 * `DOMAttributes` puts the media events on every element), so they are removed
 * before ours take those names — the same note `AttemptListProps` carries.
 */
export type MovieDetailProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onCancel' | 'onPause'
> & {
  /** `client.listBadFiles(movie.id)` — passed through to the release list. */
  badFiles?: readonly BadFile[]
  /**
   * The three importer server actions, handed to the attempts list. Omitted
   * renders no Import control — see {@link MovieDetail}.
   */
  imports?: ImportDialogActions
  /** `MediaDetailResponse.jobs` verbatim, newest first. */
  jobs: readonly DownloadJob[]
  media: Movie
  /** The instant every relative stamp is measured against, pinned by the page. */
  now: number
  /**
   * An in-flight attempt's controls, handed to the attempts list. Omitted
   * renders none — see {@link MovieDetail} for which ones the page passes.
   */
  onCancel?: JobAction
  onDelete?: DeleteMediaFilesAction
  onFlag?: FlagBadFileAction
  onGrab?: ReleaseAction
  onPause?: JobAction
  onReplace?: ReleaseAction
  /** Fires `MovieRequestButton` — see {@link MovieDetail}. */
  onRequest?: MovieRequestAction
  onResume?: JobAction
  /**
   * Retries the newest attempt when it failed or was cancelled — offered only
   * while the movie is `absent` or `wanted`. See `AttemptListProps.retryable`.
   */
  onRetry?: JobAction
  onSearch?: ReleaseSearchAction
  onUnflag?: UnflagBadFileAction
  /**
   * Whether the live feed is currently **not** connected — `!connected` off
   * the socket, handed in by `MovieDetailLive` so this stays a plain function
   * of its props that renders without a `<JobEventsProvider>`. Drives
   * {@link MOVIE_STALE_LABEL}, and only while a download is under way: a
   * settled movie has no frame to miss.
   */
  stale?: boolean
}

/**
 * `/movies/<tmdbId>` — everything a movie card leads to.
 *
 * Composes the header, the media status, the attempts list, the release
 * picker, the delete confirm and the local save. It owns no state and no
 * `'use client'` directive: every interactive part below it is already a
 * client component of its own, and `MovieDetailLive` is what keeps its props
 * current off the socket.
 *
 * Plan 021's rule is the spine of it: **the chip reads the movie, never a
 * job.** `MediaStatus` takes the media's own `state` (derived from Radarr on
 * every poll), and `AttemptList` takes the jobs — so a failed restart over a
 * playable file (*Cars*) reads `in library` with the failure listed as an
 * attempt under it, not `failed` beside a working Watch button.
 *
 * Call-site decisions worth stating, because each of them is a place the
 * mockup, the API or a sibling page says something different:
 *
 * - **The status sits in the header's `lifecycle` slot.** `movie-detail.pug`
 *   draws the chip directly under the metadata line; `DetailHeader` has no
 *   slot there (its `meta` is a `<p>`, which cannot hold `MediaStatus`'s
 *   `<div>`), so it lands in the one slot it has, just above the actions it
 *   gates. One `MediaStatus`, so the chip is drawn once and its progress bar —
 *   whenever the queue snapshot has one, attempt or not — goes with it.
 * - **Watch is a link to Emby, never an in-app player.** `ButtonLink`, not a
 *   `Button` — it navigates, so ⌘-click and "copy link address" have to work —
 *   and the URL is `embyStatus.watchUrl` exactly as it arrives. That string is
 *   built server-side from `EMBY_EXTERNAL_URL`, which is the browser-reachable
 *   host; `EMBY_URL` is the in-network one and is not. Nothing here constructs
 *   a URL.
 * - **Watch, Save and Delete follow the file; Download follows the state.**
 *   The first three need a file on disk (`movieHasFile`). The one-press
 *   Download shows while the movie is `absent` or `wanted` **and** no attempt
 *   is in flight — a press beside a pending grab would race it. It is a
 *   shortcut, not the recommended path: the release picker below stays
 *   visible the whole time, and `MovieRequestButton` is `outline`, not
 *   Watch's `uv`, so it never reads as competing advice.
 * - **The attempts list offers Cancel, Retry and Import — never Pause or
 *   Resume.** The page wires `onCancel` and `onRetry` to the movie's own
 *   `PATCH /download/movies/:id/cancel` and a fresh request, so an in-flight
 *   attempt carries Cancel and the newest failed or cancelled one carries
 *   Retry while the movie is `absent` or `wanted`. Pause and resume are still
 *   `/download/videos/:id/…` — *video-only* routes with no movie equivalent —
 *   so the page wires neither `onPause` nor `onResume` and both are simply
 *   absent from the list. `needs_attention` goes through `imports`, which is
 *   what the list mounts `ImportDialog` from.
 * - **Attribution reads the newest attempt, if any.** A movie is never masked
 *   (`showTrueAttribution`), so a `null` requester with no Discord pair is an
 *   attempt adopted from Radarr's own UI, and `DetailAttribution` reads it as
 *   `Radarr · 12m ago` through `jobUpstreamSource`. A movie this app never
 *   fetched has no attempt and so no attribution.
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
  imports,
  jobs,
  media,
  now,
  onCancel,
  onDelete,
  onFlag,
  onGrab,
  onPause,
  onReplace,
  onRequest,
  onResume,
  onRetry,
  onSearch,
  onUnflag,
  stale = false,
  ...props
}: MovieDetailProps): JSX.Element {
  const watch = movieWatchState(media)
  const watchUrl = media.embyStatus?.watchUrl
  // ⚠️ Not `movie.filePath !== undefined`, which is what this used to be and
  // what read false for every downloaded movie on the live page. See
  // `movieHasFile`.
  const hasFile = movieHasFile(media)
  const state = mediaState(media)
  const downloadable = DOWNLOADABLE_STATES.has(state)
  const attemptInFlight = jobs.some(
    job => !isTerminalDownloadJobStatus(job.status),
  )
  // Attribution only — who asked last, whatever became of it. Nothing on this
  // page reads a job's status as the movie's.
  const job = latestJob(jobs)
  const degraded = isMetadataUnavailable(media)

  // A bar with no attempt behind it — Radarr upgrading the file on disk, or a
  // fresh Radarr grab in the one poller tick before it is adopted as an
  // attempt (see `MOVIE_EXTERNAL_QUEUE_NOTE`). The server's own reason wins
  // when there is one — it is the more specific sentence.
  const externalQueue =
    mediaProgress(media) !== null && !attemptInFlight && !media.stateReason

  // ⚠️ Disconnected **and** something to miss — the same guard the video page
  // makes. A socket down while the movie is settled costs the reader nothing;
  // while it is moving, a bar that stopped advancing is indistinguishable
  // from one that is still advancing, and this marker tells the two apart.
  const reconnecting = stale && (isMediaInFlight(state) || attemptInFlight)

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

  if (downloadable && !attemptInFlight) {
    actions.push(
      <MovieRequestButton
        className={cns(ACTION_BUTTON)}
        key="request"
        mediaId={media.id}
        onRequest={onRequest}
      />,
    )
  }

  if (hasFile) {
    actions.push(
      <SaveLocal className={cns(ACTION_BUTTON)} key="save" media={media} />,
      // ⚠️ `full` **and** `w-full sm:w-auto`. `DeleteConfirm` renders a `<div>`
      // root, so `full` is the only way to stretch the trigger inside it; the
      // className then narrows the root itself back to content width from `sm`,
      // which `full`'s unconditional `w-full` cannot express on its own.
      <DeleteConfirm
        className={cns(ACTION_BUTTON)}
        full
        key="delete"
        mediaId={media.id}
        onDelete={onDelete}
        scope={MOVIE_SCOPE}
        title={media.title}
      />,
    )
  }

  const releaseProps = {
    badFiles,
    currentGuid: media.currentReleaseGuid,
    // Every pick is a replace once there is a file — one call that deletes and
    // grabs together, never a delete followed by a grab. Passed explicitly
    // because the prop otherwise defaults off `currentGuid`, and the two are
    // not the same question: a file whose originating release could not be
    // recovered has no guid and still has to replace rather than grab.
    // `filePath` is the fact that decides it.
    hasFile,
    mediaId: media.id,
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
      <h1 className={cns('sr-only')}>{media.title}</h1>
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
              discordRequester={job.discordRequester}
              linkedDiscord={job.linkedDiscord}
              now={now}
              requester={job.requester}
              timestamp={job.completedAt ?? job.createdAt}
              upstreamSource={jobUpstreamSource(job)}
            />
          ) : null
        }
        cast={<CastRow people={NO_CAST} />}
        lifecycle={
          <div className={cns('flex flex-col gap-[14px]')}>
            <MediaStatus
              explain={externalQueue ? MOVIE_EXTERNAL_QUEUE_NOTE : undefined}
              media={media}
            />
            {reconnecting ? (
              // `w-fit` because this is a flex column — see the same marker on
              // the video page.
              <Chip className={cns('w-fit')} tone="warn">
                <Dot tone="warn" />
                {MOVIE_STALE_LABEL}
              </Chip>
            ) : null}
          </div>
        }
        media={media}
        meta={movieMetaLine(media)}
        synopsis={media.overview}
      />
      <AttemptList
        className={cns(SECTION)}
        imports={imports}
        jobs={jobs}
        now={now}
        onCancel={onCancel}
        onPause={onPause}
        onResume={onResume}
        onRetry={onRetry}
        // From the movie, never the attempt: a failed newest job over a file
        // on disk (*Cars*) must not offer to grab the title again.
        retryable={downloadable}
      />
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
