import { cns } from '@lilnas/utils/cns'
import type { DownloadJob, Video } from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import {
  DetailAttribution,
  DetailHeader,
} from 'src/components/detail/detail-header'
import type {
  JobAction,
  JobLifecycleLink,
  JobLifecycleProps,
} from 'src/components/detail/job-lifecycle'
import { JobHistory, JobLifecycle } from 'src/components/detail/job-lifecycle'
import { latestJob } from 'src/components/detail/job-state'
import { canSaveLocal, mediaFileHref } from 'src/components/detail/save-local'
import { VideoPlayer } from 'src/components/detail/video-player'
import { ButtonLink } from 'src/components/ui/button-link'
import { Note } from 'src/components/ui/card'
import { formatRuntime, UNKNOWN_VALUE } from 'src/lib/format'

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
 * The video route's page frame, shared by the page, its loading skeleton, its
 * error boundary and its not-found state so all four occupy exactly the same
 * column and nothing shifts as one replaces another.
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

/** `video-detail.pug:166` — what the panel says before anything has been fetched. */
export const VIDEO_EMPTY_NOTE = 'Ready to grab whenever.'

/** The clause beside the status chip when yt-dlp refused the link outright. */
export const VIDEO_UNRECOGNIZED_EXPLAIN =
  'That link isn’t one yt-dlp recognises.'

/**
 * What to do about it — `video-detail.pug:184` in the register the real page
 * needs rather than the legend's one-liner.
 *
 * ⚠️ It points at the nav bar and **never at a retry**. The same link will be
 * refused by the same extractor every time, so an offer to try again is an
 * offer to fail again; `VideoDetail` withholds `onRetry` for this state and
 * `JobLifecycle` renders nothing for an action with no handler.
 */
export const VIDEO_UNRECOGNIZED_GUIDANCE =
  'Paste a different link in the search field at the top of the page. Nothing was downloaded, and asking for this one again would fail the same way.'

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const UNRECOGNIZED_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

/**
 * yt-dlp's own phrasing for "no extractor claims this URL", matched
 * case-insensitively.
 *
 * ⚠️ The error string is all there is to go on. `DownloadService` records
 * `getErrorMessage(err)` on the job and nothing structured, and the download
 * step throws yt-dlp's `stderrTail` verbatim — so these two patterns are the
 * two sentences yt-dlp actually prints, not a guess at a taxonomy. Anything
 * else stays a plain `failed` with its message beside the chip and a Retry
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
   * `MediaDetailResponse.jobs` verbatim — **every** job for this `video:` key,
   * newest first. `JobLifecycle` picks the newest itself and `JobHistory`
   * renders the rest, both from this same unsliced list.
   *
   * A re-paste of the same link lands here rather than on a second page:
   * `videos.naturalKey` is uniquely indexed and `upsertVideoByNaturalKey()`
   * keeps the first-minted id, so one source URL is always one `video:<id>`
   * and every prior attempt is already in this array.
   */
  jobs: readonly DownloadJob[]
  media: Video
  /** The instant every relative stamp is measured against, pinned by the page. */
  now: number
  onCancel?: JobAction
  onPause?: JobAction
  onResume?: JobAction
  onRetry?: JobAction
}

/**
 * The body of `/videos/<videoId>` — `video-detail.pug`'s two frames reconciled
 * into one responsive document.
 *
 * ⚠️ **No progress bar, ever.** `video-detail.pug` draws `fragment 4 of 9` and
 * `412 MB / 640 MB · 3.1 MB/s` over a 64% bar; none of it exists. The only
 * progress on the wire is `ManagedMediaBase.queueSnapshot`, which is a
 * Radarr/Sonarr queue entry and therefore movies and shows only — a video job
 * has no progress field anywhere in `DownloadJob`, and the backend does not
 * merely fail to expose one: `download-video.service.ts` pipes yt-dlp's stdout
 * into a log file and never parses it. `jobProgress()` answers `null` for a
 * video and `JobLifecycle` draws no bar, which is the honest rendering — a 0%
 * bar is a claim. Where a mockup and the API disagree about content, the API
 * wins. E1 left `progressPct`/`progressDetail`/`progressNote` on the props so
 * a later backend change can feed real numbers in with no signature change;
 * they are deliberately unused here.
 *
 * Two more places the mockup is not followed, both in the same direction:
 *
 * - **The status chip does not stretch.** `video-detail.pug:122` gives it
 *   `w-fit` on desktop but `flex w-fit` in a stretch container on mobile,
 *   which the designs README lists as an unreconciled quirk. `JobLifecycle`
 *   renders it intrinsic at both widths.
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
  onPause,
  onResume,
  onRetry,
  ...props
}: VideoDetailProps): JSX.Element {
  const job = latestJob(jobs)
  const unrecognized = job !== null && isUnrecognizedLink(job)
  const complete = job?.status === DownloadJobStatus.Completed
  const href = sourcePostHref(media.sourceUrl)

  // E7's guard and E7's URL builder, rather than E7's button: `JobLifecycle`
  // takes `save` as a `JobLifecycleLink` and renders the control itself, which
  // is what keeps "Save to device" in the same row and the same order as the
  // lifecycle controls it sits with. A second `SaveLocal` here would be a
  // duplicate button one status out of step with the panel's own.
  const save: JobLifecycleLink | undefined = canSaveLocal(media, {})
    ? { href: mediaFileHref(media.id, {}) }
    : undefined

  // ⚠️ `JobLifecycleProps` intersects `ComponentPropsWithoutRef<'div'>`
  // without removing the two DOM event names it reuses, so its `onCancel` and
  // `onPause` are typed `ReactEventHandler<HTMLDivElement> & JobAction` and no
  // plain `(jobId: string) => Promise<void>` is assignable to either. Asserted
  // here, at the one call site, rather than reopening `job-lifecycle.tsx`:
  // that component is shipped and two sibling detail pages are rendering it
  // concurrently. The fix that belongs there is the same `Omit` this file
  // makes on `VideoDetailProps`; reported rather than made.
  //
  // Sound at runtime regardless — `JobLifecycle` only ever calls these with a
  // job id, which is what these functions take.
  const handlers = {
    onCancel,
    onPause,
    onResume,
    // Withheld for a link yt-dlp refused: the same URL fails the same way, so
    // `JobLifecycle` renders no Retry at all rather than one that cannot work.
    onRetry: unrecognized ? undefined : onRetry,
  } as Pick<JobLifecycleProps, 'onCancel' | 'onPause' | 'onResume' | 'onRetry'>

  return (
    <div {...props} className={className}>
      <DetailHeader
        attribution={
          job ? (
            <DetailAttribution
              now={now}
              prefix="downloaded by "
              requester={job.requester}
              timestamp={job.createdAt}
            />
          ) : null
        }
        lifecycle={
          <div className={cns('flex flex-col gap-[14px]')}>
            <JobLifecycle
              {...handlers}
              emptyNote={VIDEO_EMPTY_NOTE}
              explain={unrecognized ? VIDEO_UNRECOGNIZED_EXPLAIN : undefined}
              jobs={jobs}
              save={save}
            />
            {unrecognized ? (
              <Note
                className={cns('max-w-[480px]', UNRECOGNIZED_NOTE)}
                icon="alert"
              >
                <p>{VIDEO_UNRECOGNIZED_GUIDANCE}</p>
                {job?.error ? (
                  <p className={cns('mt-2 font-mono text-mono-sm text-ink-4')}>
                    {job.error}
                  </p>
                ) : null}
              </Note>
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
      <JobHistory className={cns('mt-8 sm:mt-10')} jobs={jobs} now={now} />
    </div>
  )
}
