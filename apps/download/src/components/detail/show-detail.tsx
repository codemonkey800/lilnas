import { cns } from '@lilnas/utils/cns'
import type {
  BadFile,
  DownloadJob,
  Season,
  Show,
} from '@lilnas/utils/download/types'
import type { JSX } from 'react'

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
import { JobHistory, JobLifecycle } from 'src/components/detail/job-lifecycle'
import { latestJob } from 'src/components/detail/job-state'
import { LibraryLink } from 'src/components/detail/library-link'
import type {
  ReleaseAction,
  ReleaseSearchAction,
} from 'src/components/detail/release-picker'
import type { ShowRequestAction } from 'src/components/detail/show-request-button'
import { ShowRequestButton } from 'src/components/detail/show-request-button'
import { ShowSeasons } from 'src/components/detail/show-seasons'
import {
  episodeProgressLabel,
  isMetadataMissing,
  isScopeDownloading,
  seriesProgress,
  seriesScopedJobs,
  showMetaLine,
} from 'src/components/detail/show-state'
import { ButtonLink } from 'src/components/ui/button-link'
import { Note } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'

/** `show-detail.pug:44`. Emby's own word, not "Play". */
export const WATCH_LABEL = 'Watch'

/**
 * Emby has the file but has not finished cataloguing it, so there is no item
 * to open yet. A state, not an error - it resolves on its own.
 */
export const EMBY_INDEXING_LABEL = 'indexing…'

/** What the lifecycle panel says when the library has the show and this app never fetched it. */
export const SERIES_IN_LIBRARY_NOTE =
  'Already in the library. Nothing here was downloaded through this app.'

/** ...and when the library has nothing either. */
export const SERIES_EMPTY_NOTE = 'Nothing grabbed yet.'

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
  /** `MediaDetailResponse.jobs` verbatim, newest first. Scoped downstream. */
  jobs: readonly DownloadJob[]
  media: Show
  /** The instant every relative stamp is measured against, pinned by the page. */
  now: number
  /** `listSeasons` verbatim, **including season 0**. Empty = not in Sonarr yet. */
  seasons: readonly Season[]
  onDelete?: DeleteMediaFilesAction
  onFlag?: FlagBadFileAction
  onGrab?: ReleaseAction
  onReplace?: ReleaseAction
  onRequest?: ShowRequestAction
  /** ⚠️ Reaches a `ReleasePicker` trigger only. Never called on mount. */
  onSearch?: ReleaseSearchAction
  onUnflag?: UnflagBadFileAction
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
 * - **Pause / resume / cancel.** Those three routes are `/download/videos/:id`
 *   only. A show download has no cancel endpoint at any scope, so
 *   `JobLifecycle` is given no handlers and offers none.
 */
export function ShowDetail({
  badFiles,
  jobs,
  media,
  now,
  onDelete,
  onFlag,
  onGrab,
  onReplace,
  onRequest,
  onSearch,
  onUnflag,
  seasons,
}: ShowDetailProps): JSX.Element {
  const seriesJobs = seriesScopedJobs(jobs)
  const latest = latestJob(seriesJobs)
  const progress = seriesProgress(seasons)
  const downloading = isScopeDownloading(seriesJobs)
  const hasFiles =
    progress.files > 0 || seasons.some(s => s.episodeFileCount > 0)

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
              now={now}
              prefix="requested by "
              requester={latest.requester}
              timestamp={latest.createdAt}
            />
          ) : null
        }
        // Nothing on the wire populates a cast on any media type yet; `CastRow`
        // renders `null` for an empty list, so this costs a gap-free nothing.
        cast={<CastRow people={[]} />}
        className={cns('mb-7 sm:mb-8')}
        media={media}
        meta={showMetaLine(media, seasons)}
        synopsis={media.overview}
      />

      <JobLifecycle
        className={cns('mb-7 sm:mb-8')}
        emptyNote={hasFiles ? SERIES_IN_LIBRARY_NOTE : SERIES_EMPTY_NOTE}
        jobs={seriesJobs}
        // ⚠️ The library aggregate, never the job's `queueSnapshot`. A series
        // download does not reach `completed` until the last episode leaves
        // Sonarr's queue, and the queue entry only ever describes the single
        // file moving right now - `14 of 24 episodes` is what the mockup's own
        // legend row prints, and it is the only figure that is true of the
        // whole series.
        progressDetail={episodeProgressLabel(progress)}
        progressPct={downloading ? progress.pct : undefined}
      />

      {/* Renders `null` for a single attempt, so it costs no gap. */}
      <JobHistory className={cns('mb-7 sm:mb-8')} jobs={seriesJobs} now={now} />

      <ShowSeasons
        badFiles={badFiles}
        jobs={jobs}
        media={media}
        seasons={seasons}
        onDelete={onDelete}
        onFlag={onFlag}
        onGrab={onGrab}
        onReplace={onReplace}
        onRequest={onRequest}
        onSearch={onSearch}
        onUnflag={onUnflag}
      />
    </>
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
