import {
  DiscordRequester,
  DownloadJob,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  isManagedMedia,
  isTerminalDownloadJobStatus,
  JobRequester,
  Media,
  type QualityTier,
  type ShowScope,
  type UpstreamCommandKind,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { DbService } from 'src/db/db.service'
import { linkDownload, listForJob } from 'src/db/job-downloads.repo'
import { mediaId } from 'src/db/media-id'
import { DownloadStateService } from 'src/download/download-state.service'
import type { CommandRef, CommandSnapshot } from 'src/media/arr-command.types'

import { mediaMutex } from './keyed-mutex.util'
import { MediaResolverService } from './media-resolver.service'
import { defaultQualityTier } from './quality-tier-default'
import {
  KEPT_PACK_NOTE,
  planQueueCancel,
  type QueueCancelPlan,
} from './queue-cancel.util'
import { matchesScope, type PollableQueueItem } from './queue-status.util'
import { RadarrService } from './radarr.service'
import { findRefreshInFlight } from './refresh-in-flight.util'
import { SonarrService } from './sonarr.service'
import {
  startSearch,
  type StartSearchDeps,
  type StartSearchResult,
} from './start-search'

/**
 * One assertion for both media types, replacing the byte-identical
 * `assertMovieJob`/`assertShowJob` twins - now that a job is a plain object
 * with the union nested at `media`, the only thing that varied between them
 * was the literal in the message.
 */
function assertJobMediaType(
  job: DownloadJobRecord,
  type: DownloadType,
  id: string,
): DownloadJobRecord {
  if (job.type !== type) {
    throw new Error(
      `Expected a ${type} job but got a '${job.type}' job (id: '${id}')`,
    )
  }

  return job
}

/** What `cancelUpstream` did to the job's queue. */
interface CancelUpstreamOutcome {
  /** The season packs left running - see `planQueueCancel`. */
  kept: string[]
  /**
   * Whether it asked for any download to be removed, or found one it could
   * not name - either way, something the poller has to see leave.
   */
  removed: boolean
}

function hasRemovals(plan: QueueCancelPlan): boolean {
  return plan.remove.length > 0 || plan.unnamed.length > 0
}

/**
 * The note a job carries while it waits on the add-time refresh of a title
 * its request just added - wording approved in the plan 024 mockups.
 */
export const ADD_REFRESH_NOTES = {
  [DownloadType.Movie]: 'Waiting for Radarr to finish adding the movie',
  [DownloadType.Show]: 'Waiting for Sonarr to finish adding the show',
} as const

/**
 * What a `submit()` can hand back to `request()`, all of it folded into the
 * one `updateJob` that moves the job on from `Requested`:
 *
 * - `scope`: the *resolved* scope, replacing the one the caller asked for
 *   once `submit` has been upstream and filled in the display fields;
 * - `command`: the Radarr/Sonarr command the job now waits on - the
 *   poller follows it (`upstreamCommandId`/`Kind`/`At`);
 * - `actedAt`: when this app sent a grab itself, with no command to follow
 *   - stored as `upstreamCommandAt`, which `claimGrab` ranks the job by;
 * - `status`: `NotFound` ends the job at once instead of `Searching`;
 * - `statusNote`: the note written with the new status.
 *
 * Returned rather than written directly so `request()` stays the only place
 * that touches `DownloadStateService`.
 */
export interface RequestSubmitResult {
  actedAt?: string
  command?: { kind: UpstreamCommandKind; ref: CommandRef }
  scope?: ShowScope
  status?: DownloadJobStatus.NotFound
  statusNote?: string
}

/**
 * `startSearch`'s outcome as `request()` writes it. A `failed` outcome
 * throws, so it lands through `request()`'s catch like any other failure.
 */
function toSubmitResult(result: StartSearchResult): RequestSubmitResult {
  const scope = result.scope ? { scope: result.scope } : {}

  switch (result.outcome) {
    case 'search':
      return { ...scope, command: { kind: 'search', ref: result.command } }
    case 'grabbed':
      return { ...scope, actedAt: result.grabbedAt }
    case 'not_found':
      return {
        ...scope,
        status: DownloadJobStatus.NotFound,
        ...(result.statusNote != null ? { statusNote: result.statusNote } : {}),
      }
    case 'failed':
      throw new Error(result.error)
  }
}

/** The job's upstream-command columns for what `submit()` handed back. */
function upstreamCommandPatch(
  result: RequestSubmitResult | void,
): Partial<DownloadJobRecord> {
  if (result?.command) {
    return {
      upstreamCommandAt: result.command.ref.queuedAt,
      upstreamCommandId: result.command.ref.id,
      upstreamCommandKind: result.command.kind,
    }
  }

  return result?.actedAt != null ? { upstreamCommandAt: result.actedAt } : {}
}

/**
 * Orchestrates movie/show job lifecycle on top of the shared
 * `DownloadStateService.jobs` map, delegating the actual Radarr/Sonarr API
 * calls to RadarrService/SonarrService. Movie/show jobs are tracked entirely
 * by polling (see MediaPollerService) - they're never handed to
 * DownloadSchedulerService, which is video-pipeline-only.
 *
 * Requesting a title writes **no metadata at all**: Radarr/Sonarr are the
 * system of record for it, so a job stores only the derived `media_id` and
 * every read re-derives the title/poster/overview through
 * `MediaResolverService`.
 */
@Injectable()
export class MediaDownloadService {
  private logger = new Logger(MediaDownloadService.name)

  constructor(
    private readonly dbService: DbService,
    private readonly downloadStateService: DownloadStateService,
    private readonly mediaResolverService: MediaResolverService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  async searchMovies(query: string): Promise<Media[]> {
    return this.radarrService.search(query)
  }

  async searchShows(query: string): Promise<Media[]> {
    return this.sonarrService.search(query)
  }

  /**
   * `requester` and `discordRequester` are the two mutually exclusive ways
   * the resulting job can be attributed; the controller has already picked
   * between them (a forwarded user wins). See
   * `DownloadService.createVideoDownloadJob` for why both are carried
   * separately rather than pre-collapsed.
   *
   * `qualityTier` (default: `defaultQualityTier()`) picks the movie's
   * quality profile - on the add, or by re-profiling a library movie that is
   * on another one. A tier profile Radarr can't provide fails the job; it
   * never falls back to another profile.
   *
   * Never waits on Radarr: a movie already in the library is searched at
   * once (`startSearch`); a fresh add hands the job Radarr's add-time
   * refresh to wait on (see `waitOnRefresh`), and the poller starts the
   * search once that refresh has finished. So does a library movie Radarr
   * is still refreshing - one an earlier request added moments ago (see
   * `refreshInFlight`).
   */
  async requestMovie(
    tmdbId: number,
    requester?: JobRequester | null,
    discordRequester?: DiscordRequester | null,
    qualityTier?: QualityTier,
  ): Promise<DownloadJob> {
    const jobMediaId = mediaId({ tmdbId, type: DownloadType.Movie })

    return this.request({
      action: 'requestMovie',
      discordRequester,
      mediaId: jobMediaId,
      requester,
      // Ensure first, *then* decide - the upstream id doesn't exist until
      // the title is in the library, and both branches need it. Only the
      // ensure holds the title's lock; the refresh check and the search
      // that follow don't touch the library entry.
      submit: async job => {
        // Before the lock and the add: a tier that can't be had stops the
        // request here, with nothing written.
        const qualityProfileId = await this.radarrService.tierProfileId(
          qualityTier ?? defaultQualityTier(),
        )

        const ensured = await mediaMutex.run(jobMediaId, async () => {
          const ensured = await this.radarrService.ensureMovie(tmdbId, {
            monitored: true,
            qualityProfileId,
          })
          const reprofiled = await this.applyQualityProfile(
            ensured.wasAdded,
            ensured.movie.qualityProfileId,
            qualityProfileId,
            () =>
              this.radarrService.editMovies([ensured.radarrId], {
                qualityProfileId,
              }),
          )
          this.invalidateAfterRequestEnsure(jobMediaId, ensured, reprofiled)
          return ensured
        })

        if (ensured.wasAdded) {
          return this.waitOnRefresh(
            await this.radarrService.refreshMovie(ensured.radarrId, {
              isNew: true,
            }),
            ADD_REFRESH_NOTES[DownloadType.Movie],
          )
        }

        return (
          (await this.refreshInFlight(
            DownloadType.Movie,
            ensured.radarrId,
            job.id,
          )) ??
          toSubmitResult(
            await startSearch(this.searchDeps(), job, ensured.radarrId),
          )
        )
      },
      type: DownloadType.Movie,
      upstreamId: tmdbId,
    })
  }

  /**
   * Requests a show, optionally narrowed to one season or one episode - by
   * Sonarr's `episodeId`, or by `seasonNumber` + `episodeNumber`.
   *
   * Whatever the scope, the request monitors exactly what it covers, across
   * all three of Sonarr's independent `monitored` flags: a bare request
   * monitors every season flag and every episode outside season 0 (Sonarr's
   * own `MonitorTypes.All` is `SeasonNumber > 0` - a whole-show request is
   * not a request for the specials), a season request monitors that
   * season's flag and its episodes (season 0 included, when named), and an
   * episode request monitors only the episode and leaves its season's flag
   * alone. A bare `POST /download/shows` is an *explicit* whole-series
   * request, so it passes an empty scope rather than no options at all (see
   * `EnsureSeriesOptions`).
   *
   * `ensureSeries` turns the series flag on (and, for a series that was
   * off, the fileless episodes outside a narrow scope off); `startSearch`
   * monitors the scope and searches. A series already in the library is
   * searched at once. A fresh add - `monitor: 'all'` for the whole series,
   * `'none'` for a narrower scope - waits on Sonarr's add-time refresh
   * instead (see `waitOnRefresh`): the episodes don't exist until it
   * finishes, and a flag written during it is undone by it. The poller runs
   * `startSearch` once it has. A library series Sonarr is still refreshing
   * waits the same way - the second and later requests of a multi-season
   * pick, sent one after another for a show the first one added (see
   * `refreshInFlight`).
   *
   * With no `scope` there is no scope on the job - the search stays the
   * generic `SeriesSearch`.
   *
   * `qualityTier` works as it does for `requestMovie`, and applies to the
   * **whole series** whatever the scope - Sonarr's quality profile is a
   * series-level setting.
   */
  async requestShow(
    tvdbId: number,
    requester?: JobRequester | null,
    scope?: ShowScope,
    discordRequester?: DiscordRequester | null,
    qualityTier?: QualityTier,
  ): Promise<DownloadJob> {
    const jobMediaId = mediaId({ tvdbId, type: DownloadType.Show })

    return this.request({
      action: 'requestShow',
      discordRequester,
      mediaId: jobMediaId,
      requester,
      scope,
      submit: async job => {
        // See `requestMovie`: the tier is settled before anything is written.
        const qualityProfileId = await this.sonarrService.tierProfileId(
          qualityTier ?? defaultQualityTier(),
        )

        const ensured = await mediaMutex.run(jobMediaId, async () => {
          // Always an explicit scope - `{}` is "the whole series", which is
          // what a bare request means. See `EnsureSeriesOptions`.
          const ensured = await this.sonarrService.ensureSeries(tvdbId, {
            monitored: true,
            monitorEpisodes: scope ?? {},
            qualityProfileId,
          })
          const reprofiled = await this.applyQualityProfile(
            ensured.wasAdded,
            ensured.series.qualityProfileId,
            qualityProfileId,
            () =>
              this.sonarrService.editSeries([ensured.sonarrId], {
                qualityProfileId,
              }),
          )
          this.invalidateAfterRequestEnsure(jobMediaId, ensured, reprofiled)
          return ensured
        })

        if (ensured.wasAdded) {
          return this.waitOnRefresh(
            await this.sonarrService.refreshSeries(ensured.sonarrId, {
              isNew: true,
            }),
            ADD_REFRESH_NOTES[DownloadType.Show],
          )
        }

        return (
          (await this.refreshInFlight(
            DownloadType.Show,
            ensured.sonarrId,
            job.id,
          )) ??
          toSubmitResult(
            await startSearch(this.searchDeps(), job, ensured.sonarrId),
          )
        )
      },
      type: DownloadType.Show,
      upstreamId: tvdbId,
    })
  }

  /**
   * What a fresh add leaves the job waiting on: the add-time refresh.
   * Radarr/Sonarr queue it themselves on every add, carrying
   * `isNewMovie`/`isNewSeries`, and dedupe an identical queued or running
   * command - so the `isNew` refresh the caller just pushed hands back that
   * command's id rather than queueing another. Stored with kind `refresh`,
   * so the poller calls `startSearch` once it has finished.
   *
   * Also what `refreshInFlight` hands a library title that is still being
   * refreshed - with no note when the refresh isn't the add-time one.
   */
  private waitOnRefresh(
    refresh: CommandRef,
    statusNote?: string,
  ): RequestSubmitResult {
    return {
      command: { kind: 'refresh', ref: refresh },
      ...(statusNote != null ? { statusNote } : {}),
    }
  }

  /**
   * The refresh a title already in the library is still going through, for
   * the job to wait on like a fresh add's - or `undefined`, to search now.
   *
   * Only the first of several requests for a title that wasn't in the
   * library sees `wasAdded`: the bot sends a multi-season or multi-episode
   * pick as one request per season or episode, and a second web request
   * can land just as quickly. The rest find the title already there while
   * the add-time refresh is still running - a show's episodes may not exist
   * yet, and the refresh re-saves a snapshot read before it fetched, undoing
   * the monitor flags `startSearch` writes. See `findRefreshInFlight` for
   * which refreshes count; the add-time one carries its "Waiting for ..."
   * note, a plain one none.
   *
   * No lock needed: Radarr/Sonarr queue the add-time refresh inside the add
   * call itself, and `mediaMutex` already lets this request's ensure through
   * only after the earlier add returned - so that refresh is on the list by
   * the time this reads it.
   *
   * A failed read is logged and searches now - the request goes ahead as it
   * did before this check existed, rather than failing on it.
   */
  private async refreshInFlight(
    type: DownloadType.Movie | DownloadType.Show,
    upstreamId: number,
    jobId: string,
  ): Promise<RequestSubmitResult | undefined> {
    const action = 'refreshInFlight'
    let commands: CommandSnapshot[]
    try {
      commands =
        type === DownloadType.Movie
          ? await this.radarrService.listCommands()
          : await this.sonarrService.listCommands()
    } catch (err) {
      this.logger.warn(
        { action, error: getErrorMessage(err), jobId, type, upstreamId },
        'Could not read the command list - searching without checking for a refresh',
      )
      return undefined
    }

    const refresh = findRefreshInFlight(commands, type, upstreamId)
    if (!refresh) return undefined

    this.logger.log(
      {
        action,
        commandId: refresh.ref.id,
        isNew: refresh.isNew,
        jobId,
        type,
        upstreamId,
      },
      'Title is still being refreshed - searching once the refresh finishes',
    )

    return this.waitOnRefresh(
      refresh.ref,
      refresh.isNew ? ADD_REFRESH_NOTES[type] : undefined,
    )
  }

  /** `startSearch`'s dependencies, from what this service already holds. */
  private searchDeps(): StartSearchDeps {
    return {
      db: this.dbService.db,
      logger: this.logger,
      radarrService: this.radarrService,
      sonarrService: this.sonarrService,
    }
  }

  /**
   * Moves a library title onto the requested tier's profile when it is on
   * another one, and reports whether it did. A fresh add already got the
   * profile, and a title already on it is left alone - no call either way.
   */
  private async applyQualityProfile(
    wasAdded: boolean,
    currentProfileId: number | undefined,
    wantedProfileId: number,
    edit: () => Promise<void>,
  ): Promise<boolean> {
    if (wasAdded || currentProfileId === wantedProfileId) {
      return false
    }

    await edit()
    return true
  }

  /**
   * `invalidateAfterEnsure`, plus a re-profile: the cached library entry
   * holds the old profile, so the title's tier would read stale until the
   * TTL ran out.
   */
  private invalidateAfterRequestEnsure(
    jobMediaId: string,
    ensured: { wasAdded: boolean; wasMonitored: boolean },
    reprofiled: boolean,
  ): void {
    if (reprofiled) {
      this.mediaResolverService.invalidate(jobMediaId)
    } else {
      this.mediaResolverService.invalidateAfterEnsure(jobMediaId, ensured)
    }
  }

  getMovieJob(id: string): Promise<DownloadJob> {
    return this.getJob(id, DownloadType.Movie)
  }

  getShowJob(id: string): Promise<DownloadJob> {
    return this.getJob(id, DownloadType.Show)
  }

  async deleteMovieJob(id: string): Promise<DownloadJob> {
    return this.deleteJob(id, DownloadType.Movie, radarrId =>
      this.radarrService.unmonitorAndDelete(radarrId),
    )
  }

  async deleteShowJob(id: string): Promise<DownloadJob> {
    return this.deleteJob(id, DownloadType.Show, sonarrId =>
      this.sonarrService.unmonitorAndDelete(sonarrId),
    )
  }

  async cancelMovieJob(id: string): Promise<DownloadJob> {
    return this.cancelJob(id, DownloadType.Movie)
  }

  async cancelShowJob(id: string): Promise<DownloadJob> {
    return this.cancelJob(id, DownloadType.Show)
  }

  /**
   * The single job-creation choke point for movies and shows: mint a
   * `Requested` job, run `submit()`, then move it to `Searching` or `Failed`.
   * Everything downstream - requester attribution, `hiddenAttribution`, the
   * WS `created`/`updated` events, `MediaPollerService` picking the job up
   * off the queue - hangs off `DownloadStateService.addJob()` happening here
   * and nowhere else.
   *
   * Public (rather than private, as it was before Phase 3) so
   * `ReleaseService`'s grab path can reuse it verbatim with a different
   * `submit`. A second job-creation path would have had to re-derive all of
   * the above and would drift the first time either side changed.
   */
  async request({
    action,
    discordRequester,
    mediaId: jobMediaId,
    requester,
    scope,
    submit,
    type,
    upstreamId,
  }: {
    action: string
    /**
     * The Discord account that asked for this, for a tdr-bot call that
     * carried Discord headers and no forwarded identity. Mutually exclusive
     * with `requester` - a record carrying both is rejected by
     * `jobs_origin_matches_requester` on persist.
     */
    discordRequester?: DiscordRequester | null
    mediaId: string
    requester?: JobRequester | null
    /**
     * The scope this job was asked for, as the caller supplied it. Written
     * at mint time so the `created` broadcast is already correct; `submit`
     * can hand back a *resolved* version (with the display fields filled
     * in) to replace it.
     */
    scope?: ShowScope
    /**
     * Handed the job as minted - `startSearch` needs its id, media id and
     * requested scope.
     */
    submit: (job: DownloadJobRecord) => Promise<RequestSubmitResult | void>
    type: DownloadType
    upstreamId: number
  }): Promise<DownloadJob> {
    const id = nanoid()
    const now = new Date().toISOString()

    const record: DownloadJobRecord = {
      completedAt: null,
      createdAt: now,
      // Both required-but-nullable on `DownloadJobSchema`. `linkedDiscord`
      // is never persisted (it is resolved at read time from `apps/auth`'s
      // link table); `discordRequester` is threaded down from the controller
      // when the request arrived from Discord - see
      // `DownloadService.createVideoDownloadJob`.
      discordRequester: discordRequester ?? null,
      // Movies/shows are always attributed - there's no hiding toggle for
      // them by design (spec §Core Concepts).
      hiddenAttribution: false,
      id,
      linkedDiscord: null,
      mediaId: jobMediaId,
      requester: requester ?? null,
      scope,
      status: DownloadJobStatus.Requested,
      type,
      updatedAt: now,
    }
    this.downloadStateService.addJob(record)

    this.logger.log({ action, jobId: id, upstreamId }, 'Requesting download')

    try {
      const result = await submit(record)

      // Re-read, because a cancel can land while `submit()` is out upstream
      // and `updateJob` has no compare-and-set - writing `Searching` blind
      // would un-cancel the job. No `await` between this read and the writes
      // below, so nothing can slip in between them.
      const current = this.downloadStateService.jobs.get(id)

      if (current?.status === DownloadJobStatus.Cancelling) {
        // The resolved scope still lands (the job's own display fields), but
        // the status stays where the cancel put it.
        const record = result?.scope
          ? this.downloadStateService.updateJob(id, { scope: result.scope })
          : current

        return this.cancelAfterSubmit(record, action)
      }

      // The poller got there first (it only moves a job it can see
      // upstream) - its status is fresher than ours. The command is still
      // worth following while the job is open: the poller judges it
      // against the job's status as it finds it.
      if (current && current.status !== DownloadJobStatus.Requested) {
        const commandPatch = upstreamCommandPatch(result)
        return this.downloadStateService.hydrateOne(
          !isTerminalDownloadJobStatus(current.status) &&
            current.upstreamCommandId == null &&
            Object.keys(commandPatch).length > 0
            ? this.downloadStateService.updateJob(id, commandPatch)
            : current,
        )
      }

      if (result?.status === DownloadJobStatus.NotFound) {
        this.logger.log(
          { action, jobId: id, statusNote: result.statusNote, upstreamId },
          'Nothing to grab for the request',
        )
      }

      return this.downloadStateService.hydrateOne(
        this.downloadStateService.updateJob(id, {
          // Folded into the same write that moves the job on rather than a
          // second update - one broadcast, not two, for what is one state
          // change.
          ...(result?.scope ? { scope: result.scope } : {}),
          ...upstreamCommandPatch(result),
          ...(result?.statusNote != null
            ? { statusNote: result.statusNote }
            : {}),
          status: result?.status ?? DownloadJobStatus.Searching,
        }),
      )
    } catch (err) {
      const error = getErrorMessage(err)
      const current = this.downloadStateService.jobs.get(id)

      // A cancelled request that then failed upstream is still a cancel - the
      // user asked for it to stop, and it did. Writing `Failed` over it would
      // report an error for an attempt nobody wants any more.
      if (current?.status === DownloadJobStatus.Cancelling) {
        this.logger.warn(
          { action, jobId: id, upstreamId, error },
          'Request failed after it was cancelled - leaving it cancelling',
        )

        return this.cancelAfterSubmit(current, action)
      }

      this.logger.error(
        { action, jobId: id, upstreamId, error },
        'Failed to request download',
      )

      return this.downloadStateService.hydrateOne(
        this.downloadStateService.updateJob(id, {
          error,
          status: DownloadJobStatus.Failed,
        }),
      )
    }
  }

  private async getJob(id: string, type: DownloadType): Promise<DownloadJob> {
    // Falls back to the durable `jobs` row when the in-memory Map has no
    // entry (e.g. after a restart) - see DownloadStateService's own comment.
    const record = this.downloadStateService.resolveJobRecord(id)

    if (!record) {
      throw new Error(`Job with ID '${id}' not found`)
    }

    return this.downloadStateService.hydrateOne(
      assertJobMediaType(record, type, id),
    )
  }

  /**
   * Unmonitors and deletes upstream, then cancels the job if it was still in
   * flight (a finished one is left as it finished). The upstream id
   * (`radarrId`/`sonarrId`) is read off the *resolved* media rather than a
   * persisted column - it's Radarr's own primary key, so Radarr is the only
   * honest place to get it, and a title that has since been removed from the
   * library simply resolves without one and skips the upstream call.
   */
  private async deleteJob(
    id: string,
    type: DownloadType,
    remove: (upstreamId: number) => Promise<void>,
  ): Promise<DownloadJob> {
    const action = 'deleteJob'
    const job = await this.getJob(id, type)

    const upstreamId = isManagedMedia(job.media)
      ? job.media.type === DownloadType.Movie
        ? job.media.radarrId
        : job.media.sonarrId
      : undefined

    if (upstreamId != null) {
      this.logger.log(
        { action, jobId: id, type, upstreamId },
        'Unmonitoring and deleting from the upstream library',
      )
      await remove(upstreamId)
    }

    // The library cache still holds the pre-delete entry, so drop it - the
    // next read must see Radarr's post-delete truth (no `filePath`), not a
    // stale one from up to a TTL window ago.
    this.mediaResolverService.invalidate(job.media.id)

    // Only an attempt still in flight is cancelled. A finished one keeps its
    // outcome - a completed attempt did download the file, and deleting the
    // file afterwards is a second fact about the title, not a rewrite of the
    // first. Nothing is written to it, so no job event goes out: the job did
    // not change.
    const cancelled = isTerminalDownloadJobStatus(job.status)
      ? undefined
      : this.downloadStateService.updateJob(id, {
          status: DownloadJobStatus.Cancelled,
        })

    // Re-read rather than `job` as-is so the media is the post-delete truth
    // the invalidate above made room for, not the copy the upstream id came
    // off.
    return cancelled
      ? this.downloadStateService.hydrateOne(cancelled)
      : this.getJob(id, type)
  }

  /**
   * Stops an attempt still in flight: pulls its downloads out of the client
   * and unmonitors what it was fetching, then moves the job to `Cancelling` -
   * never straight to `Cancelled`. A search command Radarr/Sonarr is already
   * running can still grab a release after this returns, so the poller owns
   * the last step: it removes a late grab for a `Cancelling` job, and settles
   * it `Cancelled` (or `Completed`, if a file landed first) once nothing is
   * left in the queue.
   *
   * The one exception is a job whose only downloads are season packs that
   * also carry other episodes: those keep running (see `cancelUpstream`), so
   * it goes straight to `Cancelled`, noted `KEPT_PACK_NOTE` and with no
   * `error` - there is no removal to wait for.
   *
   * Upstream first, status last, like `deleteJob`: if the upstream work
   * throws, the job is left exactly as it was and the error propagates, so a
   * second press simply tries again. A library file is never touched.
   */
  private async cancelJob(
    id: string,
    type: DownloadType,
  ): Promise<DownloadJob> {
    const action = 'cancelJob'
    const job = await this.getJob(id, type)

    if (isTerminalDownloadJobStatus(job.status)) {
      throw new Error(`Job with ID '${id}' has already ${job.status}`)
    }

    // A second press (or a double-click) - the first one already did the
    // upstream work, and the poller is finishing it.
    if (job.status === DownloadJobStatus.Cancelling) {
      return job
    }

    const outcome = await this.cancelUpstream(job, action)

    // The library cache still holds the pre-cancel `monitored` flag.
    this.mediaResolverService.invalidate(job.media.id)

    // Re-read, synchronously up to the write: the upstream calls above take
    // seconds, and `updateJob` has no compare-and-set. A job the poller
    // settled meanwhile (say, its file landed) keeps that outcome, and one a
    // concurrent press already moved needs nothing more.
    const current = this.downloadStateService.jobs.get(id)

    if (
      current &&
      (isTerminalDownloadJobStatus(current.status) ||
        current.status === DownloadJobStatus.Cancelling)
    ) {
      return this.downloadStateService.hydrateOne(current)
    }

    // Everything the job had queued is a season pack left running: nothing
    // was removed, so there is no removal for the poller to wait out, and
    // the pack itself would keep a `cancelling` job from ever settling.
    // Anything removed alongside a kept pack goes through `cancelling`, and
    // the poller settles it with the same note once only the pack is left.
    const keptOnly = outcome.kept.length > 0 && !outcome.removed

    const cancelling = this.downloadStateService.updateJob(id, {
      // A job cancelled out of `NeedsAttention` still carries upstream's
      // import error, which says nothing true about a cancelled attempt.
      error: undefined,
      ...(keptOnly
        ? {
            status: DownloadJobStatus.Cancelled,
            statusNote: KEPT_PACK_NOTE,
          }
        : { status: DownloadJobStatus.Cancelling }),
    })

    // What keeps adoption off the kept pack (`keptDownloadIds`). The poller
    // normally linked it already; after the write, so the row it needs is
    // certainly there.
    if (keptOnly) this.linkKeptDownloads(job, outcome.kept, action)

    // The press landed while `request()`'s `submit()` was out upstream, and
    // `submit()` resolved during the upstream calls above - so `request()`
    // saw a job still `Requested`, moved it on, and never knew to clean up.
    // Its `ensure*` may have re-monitored what was just unmonitored, and its
    // search came after the queue read, so run the upstream half once more.
    if (
      job.status === DownloadJobStatus.Requested &&
      current?.status !== DownloadJobStatus.Requested
    ) {
      await this.cancelUpstreamQuietly(
        await this.downloadStateService.hydrateOne(cancelling),
        action,
      )
      this.mediaResolverService.invalidate(job.media.id)
    }

    return this.downloadStateService.hydrateOne(cancelling)
  }

  /**
   * `request()`'s half of a cancel that landed while `submit()` was out
   * upstream. The press itself could do nothing upstream for a title with no
   * upstream id yet (a first request), and even for one that had it, the
   * search `submit()` dispatched may have come after its queue read - so the
   * upstream half runs again now that the title is certainly in the library.
   *
   * Best-effort: the job is already `Cancelling`, and a request that answers
   * with an error for a cancel that did take would be a lie. The poller's
   * `Cancelling` path still removes any late grab each tick.
   */
  private async cancelAfterSubmit(
    record: DownloadJobRecord,
    action: string,
  ): Promise<DownloadJob> {
    // Hydrated after `submit()`, whose `ensure*` already dropped any cached
    // copy that predates the add - so the media carries the upstream id.
    await this.cancelUpstreamQuietly(
      await this.downloadStateService.hydrateOne(record),
      action,
    )
    this.mediaResolverService.invalidate(record.mediaId)

    return this.downloadStateService.hydrateOne(
      this.downloadStateService.jobs.get(record.id) ?? record,
    )
  }

  /**
   * `cancelUpstream`, with a failure logged instead of thrown. Its outcome is
   * dropped: the job is already `Cancelling`, and a season pack it kept is
   * the poller's to settle (`removeLateGrab`).
   */
  private async cancelUpstreamQuietly(
    job: DownloadJob,
    action: string,
  ): Promise<void> {
    try {
      await this.cancelUpstream(job, action)
    } catch (err) {
      this.logger.warn(
        { action, error: getErrorMessage(err), jobId: job.id },
        'Failed to clean up upstream after a cancel - the poller will remove any late grab',
      )
    }
  }

  /**
   * The upstream half of a cancel: removes the job's downloads from the
   * queue (the client drops its partial files; nothing is blocklisted and no
   * re-search is started), then unmonitors only what has no file, so RSS
   * doesn't grab it again and a cancelled *replacement* leaves the title
   * monitored for the copy already on disk. Season and series flags are left
   * alone.
   *
   * The queue is read fresh rather than from `MediaStateService`, whose copy
   * is up to a tick old - exactly the window a just-grabbed release lives in.
   * Rows are handled one download at a time (`planQueueCancel`): each is
   * removed with one DELETE, except a show download that also carries an
   * episode outside the job's scope - a season pack an episode job is part
   * of - which is kept, since removing any of its rows removes all of it. A
   * show job only ever touches downloads inside its own scope, so
   * cancelling one episode leaves a sibling episode's download running.
   *
   * A movie also matches the rows Radarr could not tie to any movie (no
   * `movieId`), by the downloads the job is linked to - only the unfiltered
   * queue read returns those.
   *
   * No upstream id (a first request `submit()` hasn't added yet) means there
   * is nothing upstream to undo.
   */
  private async cancelUpstream(
    job: DownloadJob,
    action: string,
  ): Promise<CancelUpstreamOutcome> {
    const nothing: CancelUpstreamOutcome = { kept: [], removed: false }
    if (!isManagedMedia(job.media)) return nothing

    if (job.media.type === DownloadType.Movie) {
      const { radarrId } = job.media
      if (radarrId == null) return nothing

      const linked = new Set(
        listForJob(this.downloadStateService.db, job.id).flatMap(link =>
          link.failedAt == null ? [link.downloadId] : [],
        ),
      )
      const queue = await this.radarrService.getQueue(
        linked.size > 0 ? undefined : [radarrId],
      )
      const plan = planQueueCancel(
        queue.filter(
          item =>
            item.movieId === radarrId ||
            (item.movieId == null &&
              item.downloadId != null &&
              linked.has(item.downloadId)),
        ),
        queue,
      )
      await this.removeQueueItems(
        job,
        plan,
        queueId => this.radarrService.removeQueueItem(queueId),
        action,
      )
      await this.radarrService.unmonitorIfMissing(radarrId)
      return { kept: [], removed: hasRemovals(plan) }
    }

    const { sonarrId } = job.media
    if (sonarrId == null) return nothing

    const queue = await this.sonarrService.getQueue([sonarrId])
    const inScope = (item: PollableQueueItem) =>
      item.seriesId === sonarrId && matchesScope(item, job.scope)
    const plan = planQueueCancel(queue.filter(inScope), queue, inScope)

    if (plan.kept.length > 0) {
      this.logger.log(
        { action, downloadIds: plan.kept, jobId: job.id },
        'Kept a season download that also carries other episodes',
      )
    }

    await this.removeQueueItems(
      job,
      plan,
      queueId => this.sonarrService.removeQueueItem(queueId),
      action,
    )
    await this.sonarrService.unmonitorScope(sonarrId, job.scope ?? {}, {
      withoutFileOnly: true,
    })
    return { kept: plan.kept, removed: hasRemovals(plan) }
  }

  /**
   * Links a pack-cancelled job to the downloads it left running, logged
   * rather than thrown: the cancel already took, and a link the poller has
   * not written yet only means adoption may pick the pack up.
   */
  private linkKeptDownloads(
    job: DownloadJob,
    downloadIds: readonly string[],
    action: string,
  ): void {
    for (const downloadId of downloadIds) {
      try {
        linkDownload(this.downloadStateService.db, {
          app: 'sonarr',
          downloadId,
          grabbedAt: null,
          jobId: job.id,
        })
      } catch (err) {
        this.logger.warn(
          { action, downloadId, error: getErrorMessage(err), jobId: job.id },
          'Failed to link a kept season download to its cancelled job',
        )
      }
    }
  }

  /**
   * Removes each planned download with one DELETE, best-effort. A partial
   * failure is logged and swallowed rather than thrown: the job still moves
   * to `Cancelling`, and the poller removes whatever is left of a
   * `Cancelling` job's queue on its next tick.
   */
  private async removeQueueItems(
    job: DownloadJob,
    plan: QueueCancelPlan,
    remove: (queueId: number) => Promise<void>,
    action: string,
  ): Promise<void> {
    const removable = plan.remove

    if (plan.unnamed.length > 0) {
      this.logger.log(
        { action, jobId: job.id },
        'Skipped a queue item with no id - there is no row to remove',
      )
    }

    const removals = await Promise.allSettled(
      removable.map(item => remove(item.id)),
    )

    for (const [index, result] of removals.entries()) {
      if (result.status === 'fulfilled') continue

      this.logger.warn(
        {
          action,
          error: getErrorMessage(result.reason),
          jobId: job.id,
          queueId: removable[index]?.id,
        },
        'Failed to remove a cancelled queue item - the poller will retry',
      )
    }

    this.logger.log(
      { action, jobId: job.id, queueCount: removable.length },
      'Removed the cancelled queue items',
    )
  }
}
