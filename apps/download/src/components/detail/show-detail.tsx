import { cns } from '@lilnas/utils/cns'
import type {
  BadFile,
  DownloadJob,
  Season,
  Show,
} from '@lilnas/utils/download/types'
import {
  isMediaInFlight,
  isTerminalDownloadJobStatus,
} from '@lilnas/utils/download/types'
import type { JSX, ReactNode } from 'react'

import { jobUpstreamSource } from 'src/components/activity/activity-requester'
import { AttemptList } from 'src/components/detail/attempt-list'
import type {
  FlagBadFileAction,
  UnflagBadFileAction,
} from 'src/components/detail/bad-file-flag'
import { CastRow } from 'src/components/detail/cast-row'
import type { DeleteMediaFilesAction } from 'src/components/detail/delete-confirm'
import { DeleteConfirm } from 'src/components/detail/delete-confirm'
import {
  DetailAttribution,
  DetailHeader,
} from 'src/components/detail/detail-header'
import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import type { JobAction } from 'src/components/detail/job-actions'
import { latestJob } from 'src/components/detail/job-state'
import { LibraryLink } from 'src/components/detail/library-link'
import { mediaProgress } from 'src/components/detail/media-state'
import { MediaStatus } from 'src/components/detail/media-status'
import type {
  ReleaseAction,
  ReleaseSearchAction,
} from 'src/components/detail/release-picker'
import type { ShowRequestAction } from 'src/components/detail/show-request-button'
import { ShowRequestButton } from 'src/components/detail/show-request-button'
import { ShowSeasons } from 'src/components/detail/show-seasons'
import {
  episodeProgressLabel,
  isDownloadableState,
  isMetadataMissing,
  seriesProgress,
  seriesState,
  showMetaLine,
} from 'src/components/detail/show-state'
import { ButtonLink } from 'src/components/ui/button-link'
import { Note } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { Dot } from 'src/components/ui/status'

/** `show-detail.pug:44`. Emby's own word, not "Play". */
export const WATCH_LABEL = 'Watch'

/**
 * Emby has the file but has not finished cataloguing it, so there is no item
 * to open yet. A state, not an error - it resolves on its own.
 */
export const EMBY_INDEXING_LABEL = 'indexing…'

/**
 * The note beside the series chip when Sonarr's queue is moving and no
 * attempt is behind it — `show-detail.pug`'s "Sonarr upgrading a file on
 * disk" frame. The bar comes off the queue snapshot alone; this says why there
 * is nothing under it to cancel.
 *
 * ⚠️ Worded for an **upgrade** because, since plan 022, that is almost the
 * only time it shows. A download someone starts in Sonarr's own UI is adopted
 * by the poller as an ordinary attempt — Cancel and all, credited to `Sonarr`
 * — which clears the page's no-attempt-in-flight condition. What stays
 * un-adopted is a grab for episodes that already have a file: nobody asked
 * this app for it, so it remains a bare queue snapshot. The one other way here
 * is the ≤ 1 poller tick between Sonarr queueing a fresh grab and its
 * adoption, where the sentence is briefly wrong and then gone.
 */
export const SHOW_EXTERNAL_QUEUE_NOTE =
  "Sonarr is upgrading an episode already on disk — it can't be cancelled here."

/**
 * The marker under a moving series while the live feed is not connected. The
 * same word the movie and video pages use for the same condition.
 */
export const SHOW_STALE_LABEL = 'reconnecting…'

/** The metadata lookup placeholder's explanation. See `isMetadataMissing`. */
export const METADATA_MISSING_NOTE =
  "Sonarr could not be reached, so this show's title, artwork and description are missing. The seasons and episodes below may be incomplete too — reloading in a minute usually fixes it."

/** The loud `Note`, assembled at the call site the way `ui.pug` does it. */
const ALARM_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

/**
 * Stacked and full-width on a phone, inline from `sm`: `show-detail.pug`
 * writes these as two separate frames (`mb-7 flex flex-col gap-2` /
 * `mt-1 flex items-center gap-2.5`), and one responsive document is one row
 * that reflows.
 */
const HEADER_ACTION = 'w-full sm:w-auto'

/**
 * ⚠️ `DeleteConfirm`'s `full` stretches its `<div>` root *and* the trigger
 * inside it, with no `sm:` half, so the desktop width has to reach the trigger
 * through the wrapper from here. Call-site fix with a comment, per the
 * established precedent - `delete-confirm.tsx` is shipped and shared.
 */
const HEADER_DELETE = cns('w-full sm:w-auto', 'sm:[&>button]:w-auto')

export type ShowDetailProps = {
  /** `client.listBadFiles(id)` - this title's flags, joined per release guid. */
  badFiles?: readonly BadFile[]
  /**
   * The three importer server actions. Reaches the series panel here *and*
   * every season panel inside `ShowSeasons` - see {@link ShowDetail}.
   */
  imports?: ImportDialogActions
  /** `MediaDetailResponse.jobs` verbatim, newest first. Scoped downstream. */
  jobs: readonly DownloadJob[]
  media: Show
  /** The instant every relative stamp is measured against, pinned by the page. */
  now: number
  /** `listSeasons` verbatim, **including season 0**. Empty = not in Sonarr yet. */
  seasons: readonly Season[]
  /**
   * Cancels an in-flight attempt, at any scope — its card in the Attempts
   * lists and its episode row's Cancel. Omitted offers none; the page wires
   * the show's own cancel route (see {@link ShowDetail}).
   */
  onCancel?: JobAction
  onDelete?: DeleteMediaFilesAction
  onFlag?: FlagBadFileAction
  onGrab?: ReleaseAction
  onReplace?: ReleaseAction
  onRequest?: ShowRequestAction
  /**
   * Retries the newest attempt when it failed or was cancelled — offered only
   * while its scope is `absent` or `wanted`. See `AttemptListProps.retryable`.
   */
  onRetry?: JobAction
  /** ⚠️ Reaches a `ReleasePicker` trigger only. Never called on mount. */
  onSearch?: ReleaseSearchAction
  onUnflag?: UnflagBadFileAction
  /**
   * Whether the live feed is currently **not** connected — `!connected` off
   * the socket, handed in by `ShowDetailLive` so this stays a plain function
   * of its props. Drives {@link SHOW_STALE_LABEL}, and only while something
   * is moving: a settled series has no frame to miss.
   */
  stale?: boolean
}

/**
 * `/shows/<tvdbId>` - the whole screen.
 *
 * Ports `show-detail.pug`'s `libraryLink` + `showHeader` + `seasonTabs` +
 * `episodeList`, reconciling the mockup's two side-by-side viewport frames into
 * one document that responds.
 *
 * ## Three scopes, one media key
 *
 * ⚠️ Series, season and episode downloads and deletes all address
 * **`tvdb:121361`**. The scope travels as `episodeId`/`seasonNumber` on the
 * job (`ShowScopeSchema`) or on the delete query (`deleteScopeQuery`), and
 * *never* by rewriting the media id - that is what keeps one show one card in
 * the gallery and one row in history. `showRequestScope` and
 * `deleteScopeQuery` are the two functions that build those, and nothing on
 * this page assembles either by hand.
 *
 * ## No back prop on `AppBar`
 *
 * The back affordance is `LibraryLink`, rendered here in the page body, which
 * is exactly what the mockup's `libraryLink` mixin is. `AppBar`'s own `back`
 * prop is left unwired.
 *
 * ## What is deliberately absent
 *
 * - **Cast.** `MediaBase` carries no cast field on any type, so `CastRow` gets
 *   `[]` and renders nothing. The component is here so that the day a cast
 *   field lands, this is a one-word change.
 * - **Profile links.** `/profile` exists as a route constant but the page does
 *   not ship until a later task, and `DetailAttribution` deliberately does not
 *   anchor - the same call D2 made for the gallery avatars.
 * - **Pause / resume.** Those two routes are `/download/videos/:id` only, and
 *   a show has no equivalent, so no attempt offers them. Cancel and Retry are
 *   not absent: the page wires `onCancel` to the show's own
 *   `PATCH /download/shows/:id/cancel` and `onRetry` to a fresh request at the
 *   attempt's own scope, and both are threaded to every scope.
 *
 * ## State from the media, attempts from the jobs
 *
 * ⚠️ The chip reads `seriesState` — every non-special episode's own `state`,
 * rolled up — and never the newest job: a failed attempt over a series that
 * is on disk reads `in library`, with the failure listed under it. A queue
 * item Sonarr is running on its own draws the chip and the bar off the show's
 * `queueSnapshot` either way: once adopted it is an ordinary attempt credited
 * to `Sonarr`, and an upgrade — never adopted — has no attempt anywhere.
 *
 * `AttemptList` then lists **every** attempt at this show, any scope — an
 * episode grab is an attempt on this show, and its card says which episode.
 * Each season's panel lists the ones scoped to it again, so a stuck season
 * pack is resolved from the season it belongs to as well.
 *
 * **Import** is the attempts' one control beyond Cancel and Retry: a Sonarr
 * download that finished and then refused to import sits in `needs_attention`
 * until a human picks the files or discards them. `imports` carries the three
 * server actions to every Attempts list and every episode row; none of them
 * assembles a scope here — each reads it off the attempt or the episode it
 * renders.
 */
export function ShowDetail({
  badFiles,
  imports,
  jobs,
  media,
  now,
  onCancel,
  onDelete,
  onFlag,
  onGrab,
  onReplace,
  onRequest,
  onRetry,
  onSearch,
  onUnflag,
  seasons,
  stale = false,
}: ShowDetailProps): JSX.Element {
  const state = seriesState(media, seasons)
  const progress = seriesProgress(seasons)
  const inFlight = isMediaInFlight(state)
  const hasFiles =
    progress.files > 0 || seasons.some(s => s.episodeFileCount > 0)
  const queue = mediaProgress(media)
  const attemptInFlight = jobs.some(
    job => !isTerminalDownloadJobStatus(job.status),
  )
  // Attribution only — who asked last, at any scope, whatever became of it.
  // Nothing on this page reads a job's status as the series'.
  const latest = latestJob(jobs)
  // `0 of 0 episodes` — a series Sonarr lists with no seasons yet, or whose
  // only files are specials — is a worse thing to print than nothing.
  const count = progress.total > 0 ? episodeProgressLabel(progress) : null

  // The bar: Sonarr's queue snapshot for the whole grab when there is one —
  // `MediaStatus`'s own default — else the files-on-disk rollup while an
  // episode is in flight. Under it, the count and the queue's time estimate.
  const hasBar = queue !== null || inFlight
  const detail = [count, queue?.timeLeft ? `~${queue.timeLeft} left` : null]
    .filter(Boolean)
    .join(' · ')

  // ⚠️ Disconnected **and** something to miss — the same guard the movie and
  // video pages make.
  const reconnecting = stale && (inFlight || attemptInFlight)

  return (
    <>
      <LibraryLink />
      {isMetadataMissing(media) ? (
        <Note className={cns('mb-[22px]', ALARM_NOTE)} icon="alert">
          {METADATA_MISSING_NOTE}
        </Note>
      ) : null}
      <DetailHeader
        actions={
          <div
            className={cns(
              'mt-1 flex flex-col gap-2',
              'sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5',
            )}
          >
            <WatchAction media={media} />
            <ShowRequestButton
              className={cns(HEADER_ACTION)}
              full
              mediaId={media.id}
              target={{ kind: 'series' }}
              onRequest={onRequest}
            />
            {hasFiles ? (
              <DeleteConfirm
                className={cns(HEADER_DELETE)}
                full
                mediaId={media.id}
                scope={{ kind: 'series' }}
                title={media.title}
                onDelete={onDelete}
              />
            ) : null}
          </div>
        }
        attribution={
          latest ? (
            <DetailAttribution
              discordRequester={latest.discordRequester}
              linkedDiscord={latest.linkedDiscord}
              now={now}
              prefix="requested by "
              requester={latest.requester}
              timestamp={latest.createdAt}
              upstreamSource={jobUpstreamSource(latest)}
            />
          ) : null
        }
        // Nothing on the wire populates a cast on any media type yet; `CastRow`
        // renders `null` for an empty list, so this costs a gap-free nothing.
        cast={<CastRow people={[]} />}
        className={cns('mb-7 sm:mb-8')}
        lifecycle={
          <div className={cns('flex flex-col gap-[14px]')}>
            <MediaStatus
              data-scope="series"
              explain={seriesNote({
                count: hasBar ? null : count,
                external: queue !== null && !attemptInFlight,
                reason: media.stateReason,
              })}
              media={media}
              progressDetail={hasBar && detail ? detail : undefined}
              progressPct={
                queue === null && inFlight ? progress.pct : undefined
              }
              scopeState={state}
            />
            {reconnecting ? (
              // `w-fit` because this is a flex column — see the same marker on
              // the movie and video pages.
              <Chip className={cns('w-fit')} tone="warn">
                <Dot tone="warn" />
                {SHOW_STALE_LABEL}
              </Chip>
            ) : null}
          </div>
        }
        media={media}
        meta={showMetaLine(media, seasons)}
        synopsis={media.overview}
      />

      <AttemptList
        className={cns('mb-7 sm:mb-8')}
        imports={imports}
        jobs={jobs}
        now={now}
        onCancel={onCancel}
        onRetry={onRetry}
        // From the series, never the attempt: a failed newest grab over a
        // series on disk must not offer to grab it again.
        retryable={isDownloadableState(state)}
      />

      <ShowSeasons
        badFiles={badFiles}
        imports={imports}
        jobs={jobs}
        media={media}
        now={now}
        seasons={seasons}
        onCancel={onCancel}
        onDelete={onDelete}
        onFlag={onFlag}
        onGrab={onGrab}
        onReplace={onReplace}
        onRequest={onRequest}
        onRetry={onRetry}
        onSearch={onSearch}
        onUnflag={onUnflag}
      />
    </>
  )
}

/**
 * What sits beside the series chip. The server's `stateReason` wins when there
 * is one — `undefined` hands it back to `MediaStatus`, which reads it itself;
 * then the upgrade note (`SHOW_EXTERNAL_QUEUE_NOTE`); then, on a settled
 * series, the count — `show-detail.pug`'s "14 of 24 episodes" prose, which
 * used to be a second chip.
 */
function seriesNote({
  count,
  external,
  reason,
}: {
  count: string | null
  external: boolean
  reason: string | undefined
}): ReactNode {
  if (reason) {
    return undefined
  }

  if (external) {
    return SHOW_EXTERNAL_QUEUE_NOTE
  }

  return count === null ? undefined : (
    <span className={cns('font-mono text-mono-sm')}>{count}</span>
  )
}

type WatchActionProps = {
  media: Show
}

/**
 * The handoff to Emby, or the honest absence of one.
 *
 * ⚠️ **Series-level, and only ever series-level.** Emby's `Path` for a show is
 * the series *folder*, so `embyStatus.watchUrl` addresses the series item;
 * there is no per-episode Emby URL anywhere on the wire, which is why no
 * episode row offers a Watch button.
 *
 * ⚠️ `watchUrl` is the one to use. It is built server-side from
 * `EMBY_EXTERNAL_URL` and is reachable from a browser; `EMBY_URL` is the
 * container-network address and is not. Nothing here constructs a URL.
 *
 * Three states, matching `EmbyStatusSchema` exactly:
 *
 * - `indexed` with a `watchUrl` - a real `ButtonLink`, external, new tab.
 * - `indexing` - a chip and no action, because there is no item to open yet.
 * - absent entirely - Emby was never consulted (there is no file), so neither.
 */
function WatchAction({ media }: WatchActionProps): JSX.Element | null {
  const status = media.embyStatus

  if (!status) {
    return null
  }

  if (status.state === 'indexing') {
    return (
      <Chip className={cns('w-fit')} label={EMBY_INDEXING_LABEL} tone="warn" />
    )
  }

  if (status.state !== 'indexed' || !status.watchUrl) {
    return null
  }

  return (
    <ButtonLink
      className={cns(HEADER_ACTION)}
      href={status.watchUrl}
      iconEnd="eye"
      rel="noreferrer"
      target="_blank"
      variant="uv"
    >
      {WATCH_LABEL}
    </ButtonLink>
  )
}
