import { cns } from '@lilnas/utils/cns'
import type { DownloadJob, Video } from '@lilnas/utils/download/types'
import {
  DownloadJobStatus,
  isMediaInFlight,
  isTerminalDownloadJobStatus,
  mediaState,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { AttemptList } from 'src/components/detail/attempt-list'
import type {
  DeleteScope,
  DeleteVideoJobAction,
} from 'src/components/detail/delete-confirm'
import { DeleteConfirm } from 'src/components/detail/delete-confirm'
import {
  DetailAttribution,
  DetailHeader,
} from 'src/components/detail/detail-header'
import type { JobAction } from 'src/components/detail/job-actions'
import { ACTION_BUTTON, ActionRow } from 'src/components/detail/job-actions'
import { latestJob } from 'src/components/detail/job-state'
import { MediaStatus } from 'src/components/detail/media-status'
import {
  canSaveLocal,
  mediaFileHref,
  SaveLocal,
} from 'src/components/detail/save-local'
import { VideoDownloadButton } from 'src/components/detail/video-detail-download'
import { VideoPlayer } from 'src/components/detail/video-player'
import { ButtonLink } from 'src/components/ui/button-link'
import { Note } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { Dot } from 'src/components/ui/status'
import { formatRuntime, isInProgress, UNKNOWN_VALUE } from 'src/lib/format'

/**
 * `mock.pug`'s `appBody` at both widths around `video-detail.pug`'s
 * `mx-auto max-w-[1080px]` column.
 *
 * ⚠️ `<main>` is the scroll container, not `<body>` — the same note
 * `GalleryPageShell` and `ActivityPageShell` carry. The shell's `<body>` is
 * `h-full flex flex-col` with the app bar `shrink-0` above this, and the nav
 * search's mobile overlay is `fixed` against the viewport top, which making the
 * document scroll would slide the bar out from under.
 */
const VIDEO_DETAIL_SHELL = cns(
  'flex-auto overflow-y-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

export type VideoDetailShellProps = ComponentPropsWithoutRef<'main'>

/**
 * The video route's page frame, shared by the page, its error boundary and its
 * not-found state so all three occupy exactly the same column and nothing
 * shifts as one replaces another. (No loading skeleton, deliberately — see
 * `src/app/videos/[videoId]/not-found.tsx`.)
 */
export function VideoDetailShell({
  children,
  className,
  ...props
}: VideoDetailShellProps): JSX.Element {
  return (
    <main {...props} className={cns(VIDEO_DETAIL_SHELL, className)}>
      <div className="mx-auto max-w-[1080px]">{children}</div>
    </main>
  )
}

/** `video-detail.pug:118` — the out-of-app link to where the video came from. */
export const VIDEO_SOURCE_LABEL = 'View original post'

/**
 * `video-detail.pug`'s `not downloaded` legend line — what the chip says
 * beside itself before anything has ever been fetched.
 */
export const VIDEO_EMPTY_NOTE = 'Ready to grab whenever.'

/** The clause beside the media chip when yt-dlp refused the link outright. */
export const VIDEO_UNRECOGNIZED_EXPLAIN =
  'That link isn’t one yt-dlp recognises.'

/**
 * What to do about it — `video-detail.pug`'s "not recognized" line in the
 * register the real page needs rather than the legend's one-liner.
 *
 * ⚠️ It points at the nav bar and **never at a retry**. The same link will be
 * refused by the same extractor every time, so an offer to try again is an
 * offer to fail again; `VideoDetail` draws no Download for this state, so
 * there is nothing to press at all.
 */
export const VIDEO_UNRECOGNIZED_GUIDANCE =
  'Paste a different link in the search field at the top of the page. Nothing was downloaded, and asking for this one again would fail the same way.'

/**
 * The marker beside a still-running job when the live feed is not connected.
 *
 * The same word `/activity` uses for the same condition, deliberately — the
 * two pages read the same `connected` flag off the same socket, and giving one
 * state two names across two screens is how a vocabulary rots.
 */
export const VIDEO_STALE_LABEL = 'reconnecting…'

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const UNRECOGNIZED_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

/**
 * Full-width on a phone, intrinsic from `sm` — `ACTION_BUTTON`'s shape, which
 * `Save to device` beside it wears too, because they share one `ActionRow`.
 *
 * ⚠️ On `DeleteConfirm` this pairs with its `full`, exactly as
 * `MovieDetail` does it: the component renders a `<div>` root, so `full` is
 * the only way to stretch the trigger inside it, and `full`'s unconditional
 * `w-full` then has to be narrowed back on the root from `sm`.
 */
const DELETE_BUTTON = 'w-full sm:w-auto'

/**
 * yt-dlp's own phrasing for "no extractor claims this URL", matched
 * case-insensitively.
 *
 * ⚠️ The error string is all there is to go on. `DownloadService` records
 * `getErrorMessage(err)` on the job and nothing structured, and the download
 * step throws yt-dlp's `stderrTail` verbatim — so these two patterns are the
 * two sentences yt-dlp actually prints, not a guess at a taxonomy. Anything
 * else stays a plain `failed` attempt with its message on its row and a Retry
 * offered, which is the honest default: "we do not know why, try again" is
 * true of a timeout and false of an unsupported site.
 */
const UNRECOGNIZED_PATTERNS: readonly RegExp[] = [
  /unsupported url/i,
  /is not a valid url/i,
]

/**
 * Whether a job failed because yt-dlp would not accept the link at all.
 *
 * Only a `Failed` job can be this: a cancel is a user's decision and a job
 * still in flight has not reached an extractor's verdict.
 */
export function isUnrecognizedLink(job: DownloadJob): boolean {
  if (job.status !== DownloadJobStatus.Failed) {
    return false
  }

  const { error } = job

  return error !== undefined && UNRECOGNIZED_PATTERNS.some(re => re.test(error))
}

/**
 * `sourceUrl` as something safe to put in an `href`, or `null`.
 *
 * ⚠️ `Video.sourceUrl` is a plain `z.string()` on the read model and is
 * deliberately **not** URL-validated there (`MediaResolverService` emits a
 * degraded placeholder carrying `''`), so this is the boundary that has to
 * cope. Anything unparseable yields `null` and the link is simply not drawn.
 *
 * The protocol check is the security half rather than a tidiness one: a
 * `javascript:` or `data:` value in an `href` is script the user runs by
 * clicking a link that says "View original post", and the request boundary
 * (`CreateDownloadJobInputSchema.url`) is the only thing that ever validated
 * this string.
 */
export function sourcePostHref(sourceUrl: string): string | null {
  let url: URL

  try {
    url = new URL(sourceUrl)
  } catch {
    return null
  }

  return url.protocol === 'http:' || url.protocol === 'https:'
    ? url.toString()
    : null
}

/**
 * The one metadata line under the title — `youtube.com · 14:02`.
 *
 * ⚠️ The mockup writes `@slowferment · 14:02`, and **there is no author
 * anywhere on the wire**: `MediaBase` carries title, overview, poster,
 * runtime, year and ratings, the `videos` table adds only `sourceUrl` and
 * `timeRange`, and nothing parses yt-dlp's uploader out of its metadata. The
 * host is what is actually known about where a video came from, so that is
 * what is rendered; inventing a handle would be a guess wearing a fact's
 * clothes.
 *
 * A missing part is dropped rather than dashed, exactly as
 * `GalleryItemCard.metaLabel` does it: `youtube.com · —` announces an absence
 * nobody asked about, where `youtube.com` is the true and complete thing that
 * is known. Both missing yields the em dash, because the line still has to say
 * something.
 */
export function videoMetaLabel(media: Video): string {
  const href = sourcePostHref(media.sourceUrl)
  const host =
    href === null ? null : new URL(href).hostname.replace(/^www\./, '')
  const runtime = formatRuntime(media.runtime, 'clock')

  const parts = [host, runtime === UNKNOWN_VALUE ? null : runtime].filter(
    (part): part is string => part !== null,
  )

  return parts.length > 0 ? parts.join(' · ') : UNKNOWN_VALUE
}

/**
 * What the in-app player plays.
 *
 * `downloadUrls[0]` is the object this job actually produced; the media-file
 * endpoint is the fallback for a completed video whose URL list the backend
 * has since cleared (a delete) or never wrote. Resolved here rather than in
 * `VideoPlayer`, which takes a `string` and never reaches for a client — the
 * page is the only thing holding the `Video`.
 */
export function videoPlayerSrc(media: Video): string {
  return media.downloadUrls?.[0] ?? mediaFileHref(media.id, {})
}

/**
 * The attempt the header attributes the video to, and whose id a delete goes
 * through.
 *
 * Once the video is `downloaded`, that is the newest **completed** attempt —
 * the one that actually produced the file — rather than whatever was tried
 * last: a later failure over a playable video says nothing about who put the
 * file there. Otherwise it is simply the newest attempt, which is the one in
 * flight when anything is. `null` for a video nobody has ever fetched.
 *
 * `jobs` is newest first, the order `MediaDetailResponse.jobs` and
 * `useLiveMedia` both keep.
 */
export function videoSourceJob(
  jobs: readonly DownloadJob[],
  available: boolean,
): DownloadJob | null {
  const completed = available
    ? jobs.find(job => job.status === DownloadJobStatus.Completed)
    : undefined

  return completed ?? latestJob(jobs)
}

/**
 * ⚠️ `onCancel` and `onPause` are real `<div>` DOM events — React's
 * `DOMAttributes` puts the media events on every element — so they have to be
 * removed before ours can take those names, exactly as `SaveLocal` removes
 * `media` and `part`. Left in, each intersects to
 * `ReactEventHandler<HTMLDivElement> & JobAction` and no page can pass a
 * `(jobId: string) => …` server action to either. `children` is removed
 * because this component composes its own.
 */
export type VideoDetailProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onCancel' | 'onPause'
> & {
  /**
   * `MediaDetailResponse.jobs` verbatim — **every** attempt at this `video:`
   * key, newest first. `AttemptList` draws all of them; none of them decides
   * the chip.
   *
   * A re-paste of the same link lands here rather than on a second page:
   * `videos.naturalKey` is uniquely indexed and `upsertVideoByNaturalKey()`
   * keeps the first-minted id, so one source URL is always one `video:<id>`
   * and every prior attempt is already in this array.
   */
  jobs: readonly DownloadJob[]
  /** The video, whose `state` is what the page's chip, player and actions read. */
  media: Video
  /** The instant every relative stamp is measured against, pinned by the page. */
  now: number
  onCancel?: JobAction
  /**
   * `deleteVideoJob` — the downloaded video's destructive control.
   *
   * ⚠️ Not a `JobAction`, even though it too takes a job id: it answers with a
   * `DeleteVideoJobResult` so the dialog can keep itself open and say what went
   * wrong, where the attempt actions can only log and return. See
   * `video-job.ts`.
   */
  onDelete?: DeleteVideoJobAction
  onPause?: JobAction
  onResume?: JobAction
  /**
   * `retryVideoJob` — what the page's **Download** fires, with the newest
   * attempt's id, while the video has no file. It asks for the same source
   * again as a new attempt, so the one it names keeps its outcome.
   *
   * Not handed to `AttemptList`: one verb, one button. See {@link VideoDetail}.
   */
  onRetry?: JobAction
  /**
   * Whether the live feed is currently **not** connected — `!connected` from
   * `useLiveMedia`, handed in as a prop rather than read here so this stays a
   * plain function of its arguments that renders without a
   * `<JobEventsProvider>` ancestor. `VideoDetailLive` is what supplies it.
   *
   * ⚠️ `connected` means strictly "a socket is OPEN right now": it is `false`
   * for the whole of the first connect and for every backoff window. On its
   * own that would make a marker flicker on a page where nothing is happening,
   * which is why the marker it drives is withheld unless something is
   * actually in flight — see the render below.
   */
  stale?: boolean
}

/**
 * The body of `/videos/<videoId>` — `video-detail.pug`'s frames reconciled
 * into one responsive document.
 *
 * Plan 021: the chip under the title is the **video's** state
 * (`MediaStatus`), not the newest job's status, and the attempts sit under it
 * as a list (`AttemptList`) whose in-flight card carries its own Pause,
 * Cancel and Resume. The player, `Save to device` and Delete read the state
 * too — `downloaded` means a file is behind the page, whatever the newest
 * attempt did. The bug this exists to prevent: a video whose file was later
 * deleted used to read `completed` off its old job and draw a player with
 * nothing to play.
 *
 * **The progress lives on the attempt, not the chip.** `video-detail.pug`'s
 * `fragment 4 of 9` over a 64% bar with `412 MB / 640 MB · 3.1 MB/s · ~2m
 * left` under it is yt-dlp's own tick, carried on the job as
 * `DownloadJob.progress` while the process lives and pushed over the
 * `download-job` frame — so the in-flight attempt card draws it, off
 * `jobProgress()`. A video has no `queueSnapshot` (that is a Radarr/Sonarr
 * queue entry), so `mediaProgress()` still answers `null` and `MediaStatus`
 * draws no bar of its own. An attempt with no tick yet, or no percentage (no
 * total known), draws no bar either — a 0% bar is a claim.
 *
 * **Download, never Retry.** The mockup's `not downloaded` frame draws a
 * Download, and it is the page's one way back to a file whatever the newest
 * attempt did: deleted after completing (a delete leaves a completed attempt
 * completed, so no attempt row would offer anything), failed or cancelled.
 * `AttemptList` gets no `onRetry`, so a failed row never draws a second
 * button for the same request — the movie page's arrangement too. It needs
 * an attempt to name the source by, so a page with none (only a degraded
 * payload produces one — a `videos` row exists because a job minted it)
 * keeps `VIDEO_EMPTY_NOTE` beside the chip instead.
 *
 * Two more places the mockup is not followed:
 *
 * - **No state legend.** `video-detail.pug`'s "Other states" panel is the
 *   mockup documenting its own vocabulary, not something the page shows.
 * - **The poster carries no play mark while there is no file.** The mockup
 *   draws one on the downloading frame; pressing it would play nothing.
 *
 * The player replaces the poster rather than sitting beside it. `VideoPlayer`
 * is built to `Poster`'s `wide` shape and default radius precisely so the page
 * does not reflow when a download finishes, and it arrives through
 * `DetailHeader`'s `posterOverlay` slot — the slot E1 documents as "the video
 * page's player controls" — pinned over the gradient with `absolute inset-0`.
 * That is a call-site fix rather than a change to `DetailHeader`, which always
 * draws a poster and has no seam to swap it out through.
 */
export function VideoDetail({
  className,
  jobs,
  media,
  now,
  onCancel,
  onDelete,
  onPause,
  onResume,
  onRetry,
  stale = false,
  ...props
}: VideoDetailProps): JSX.Element {
  const state = mediaState(media)
  const complete = state === 'available'
  const newest = latestJob(jobs)
  const source = videoSourceJob(jobs, complete)
  // Only the newest attempt can be the link yt-dlp refused *now* — an older
  // refusal a later attempt already got past is history, not guidance.
  const unrecognized = newest !== null && isUnrecognizedLink(newest)
  const href = sourcePostHref(media.sourceUrl)

  // ⚠️ Disconnected **and** something to miss. A socket that is down while
  // nothing is moving costs the reader nothing — no frame is coming — so
  // saying "reconnecting…" there would raise a doubt about a page that cannot
  // change. While a download is genuinely moving, the opposite is true: a
  // `downloading` chip that stopped advancing is indistinguishable from one
  // that is still advancing, and this marker is the only thing that tells the
  // two apart.
  //
  // Either side counts: the media in flight (which keeps `paused` on the
  // marked side — a paused download is still open work whose resume this tab
  // would otherwise silently fail to hear about), or an attempt still open
  // whose next frame has not moved the media yet.
  const reconnecting =
    stale &&
    (isMediaInFlight(state) || jobs.some(job => isInProgress(job.status)))

  // Download is offered from the video's state, never an attempt's: only
  // while there is no file (a failed attempt over a downloaded video would
  // re-fetch what is already here), only while nothing is already fetching it
  // (a press beside a live attempt would race it), and never for a link
  // yt-dlp refused, which would fail the same way again. It names the newest
  // attempt, which by then is a finished one.
  const attemptInFlight = jobs.some(
    job => !isTerminalDownloadJobStatus(job.status),
  )
  const downloadFrom =
    (state === 'absent' || state === 'wanted') &&
    !attemptInFlight &&
    !unrecognized &&
    onRetry !== undefined
      ? newest
      : null

  // `video-detail.pug`'s completed frame: `Save to device` whenever the video
  // is downloaded *and* there is an object to hand over — `canSaveLocal`
  // reading `downloadUrls`, the same guard `SaveLocal` applies itself.
  const saveable = complete && canSaveLocal(media, {})

  // ⚠️ Delete is offered on exactly the frame `video-detail.pug` draws it on:
  // a downloaded video. Three conditions, none of which implies another.
  //
  // - **Downloaded**, the media state rather than a job's status: a video
  //   being fetched again is `downloading`, and the control that means "stop
  //   this" is the attempt's Cancel. Two buttons for one verb is how a user
  //   presses the wrong one.
  // - **With a file**, the same `canSaveLocal` test that decides whether
  //   `Save to device` is drawn — an offer to remove nothing is a lie the same
  //   size as a link that 404s.
  // - **Wired**, rather than a control whose dialog would confirm a request
  //   nobody is listening for.
  //
  // The scope carries a **job** id: `deleteVideoJob` is
  // `DELETE /download/videos/:jobId`, and `media.id` is a `video:` key the
  // media-files route refuses outright. The backend deletes the video's
  // objects whichever attempt names it; `videoSourceJob` picks the one that
  // produced them.
  const deleteScope: DeleteScope | null =
    source !== null && saveable && onDelete !== undefined
      ? { jobId: source.id, kind: 'video' }
      : null

  return (
    <div {...props} className={className}>
      <DetailHeader
        attribution={
          source ? (
            <DetailAttribution
              discordRequester={source.discordRequester}
              linkedDiscord={source.linkedDiscord}
              now={now}
              prefix="downloaded by "
              requester={source.requester}
              timestamp={source.createdAt}
            />
          ) : null
        }
        lifecycle={
          <div className={cns('flex flex-col gap-[14px]')}>
            <MediaStatus
              explain={
                unrecognized
                  ? VIDEO_UNRECOGNIZED_EXPLAIN
                  : jobs.length === 0 && state === 'absent'
                    ? VIDEO_EMPTY_NOTE
                    : undefined
              }
              media={media}
            />
            {reconnecting ? (
              // `w-fit` because this is a flex column: an `inline-flex` chip
              // is still stretched to the column's width by the default
              // `align-items: stretch`, and the chip is a badge rather than a
              // banner. The same intrinsic sizing `MediaStatus` gives the
              // chip it sits under.
              //
              // Not a live region, matching `/activity`, which keeps its one
              // polite region for row departures and leaves this marker
              // visual. A socket flapping through the backoff ladder would
              // otherwise announce itself once per window.
              <Chip className={cns('w-fit')} tone="warn">
                <Dot tone="warn" />
                {VIDEO_STALE_LABEL}
              </Chip>
            ) : null}
            {unrecognized ? (
              // The refusal itself is on the attempt's own row below; this is
              // only what to do about it.
              <Note
                className={cns('max-w-[480px]', UNRECOGNIZED_NOTE)}
                icon="alert"
              >
                <p>{VIDEO_UNRECOGNIZED_GUIDANCE}</p>
              </Note>
            ) : null}
            <AttemptList
              className={cns('mt-1.5 max-w-[480px]')}
              jobs={jobs}
              now={now}
              onCancel={onCancel}
              onPause={onPause}
              onResume={onResume}
            />
            {downloadFrom && onRetry ? (
              // The same media-actions slot Save and Delete take once there
              // is a file — the two never show together.
              <ActionRow>
                <VideoDownloadButton
                  className={cns(ACTION_BUTTON)}
                  jobId={downloadFrom.id}
                  onDownload={onRetry}
                />
              </ActionRow>
            ) : null}
            {saveable ? (
              // Media actions, under the attempts — `video-detail.pug`'s
              // completed frame, Save then Delete in one row.
              <ActionRow>
                <SaveLocal className={cns(ACTION_BUTTON)} media={media} />
                {deleteScope ? (
                  <DeleteConfirm
                    className={cns(DELETE_BUTTON)}
                    full
                    mediaId={media.id}
                    onDeleteVideo={onDelete}
                    scope={deleteScope}
                    title={media.title}
                  />
                ) : null}
              </ActionRow>
            ) : null}
          </div>
        }
        links={
          href === null ? null : (
            // `ButtonLink`, not a fourth hand-rolled anchor wearing the
            // button recipe. `ghost` is the quietest weight the recipe has and
            // the negative margin cancels its padding, so the label still
            // lines up with the title above it the way the mockup's bare link
            // does.
            <ButtonLink
              className={cns('-ml-[11px] w-fit')}
              href={href}
              icon="external"
              rel="noreferrer"
              size="sm"
              target="_blank"
              variant="ghost"
            >
              {VIDEO_SOURCE_LABEL}
            </ButtonLink>
          )
        }
        media={media}
        meta={
          <span className={cns('font-mono text-mono-sm')}>
            {videoMetaLabel(media)}
          </span>
        }
        posterOverlay={
          complete ? (
            <VideoPlayer
              className={cns('absolute inset-0')}
              poster={media.posterUrl}
              src={videoPlayerSrc(media)}
              title={media.title}
            />
          ) : null
        }
        posterShape="wide"
      />
    </div>
  )
}
