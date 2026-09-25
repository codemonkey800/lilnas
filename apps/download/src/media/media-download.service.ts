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
  type Release,
  type ShowScope,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { listBadFilesByMediaId } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { mediaId } from 'src/db/media-id'
import { DownloadStateService } from 'src/download/download-state.service'

import { MediaResolverService } from './media-resolver.service'
import { matchesScope, type PollableQueueItem } from './queue-status.util'
import { RadarrService } from './radarr.service'
import { pickBestRelease } from './release-selection.util'
import { SonarrService } from './sonarr.service'

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

/**
 * What a `submit()` can hand back to `request()`. Only ever used to replace
 * the scope the caller asked for with the *resolved* one, once `submit` has
 * been upstream and filled in the display fields.
 *
 * Returned rather than written directly so `request()` stays the only place
 * that touches `DownloadStateService`, and so the resolution rides along on
 * the same `updateJob` that moves the job to `Searching`.
 */
export interface RequestSubmitResult {
  scope?: ShowScope
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
   */
  async requestMovie(
    tmdbId: number,
    requester?: JobRequester | null,
    discordRequester?: DiscordRequester | null,
  ): Promise<DownloadJob> {
    const jobMediaId = mediaId({ tmdbId, type: DownloadType.Movie })

    return this.request({
      action: 'requestMovie',
      discordRequester,
      mediaId: jobMediaId,
      requester,
      // Ensure first, *then* decide - the upstream id doesn't exist until
      // the title is in the library, and both branches need it.
      submit: async () => {
        const ensured = await this.radarrService.ensureMovie(tmdbId)
        this.mediaResolverService.invalidateAfterEnsure(jobMediaId, ensured)
        const { radarrId } = ensured
        const flagged = this.flaggedGuids(jobMediaId)

        if (flagged.size === 0) {
          // Byte-for-byte the pre-Phase-3 path: hand it to Radarr's own
          // scoring and let it pick.
          await this.radarrService.triggerSearch(radarrId)
          return
        }

        const release = this.pickUnflaggedRelease(
          jobMediaId,
          await this.radarrService.getReleases(radarrId),
          flagged,
        )
        await this.radarrService.grabRelease(release.guid, release.indexerId)
      },
      type: DownloadType.Movie,
      upstreamId: tmdbId,
    })
  }

  /**
   * Requests a show, optionally narrowed to one season or one episode.
   *
   * Whatever the scope, the request monitors exactly what it covers, across
   * all three of Sonarr's independent `monitored` flags: a bare request
   * monitors every season flag and every episode, a season request monitors
   * that season's flag and its episodes, and an episode request monitors
   * only the episode and leaves its season's flag alone. A bare
   * `POST /download/shows` is an *explicit* whole-series request, so it
   * passes an empty scope rather than no options at all (see
   * `EnsureSeriesOptions`).
   *
   * With no `scope` there is still no scope-resolution round trip and no
   * `scope` on the job - the search stays the generic `SeriesSearch`.
   */
  async requestShow(
    tvdbId: number,
    requester?: JobRequester | null,
    scope?: ShowScope,
    discordRequester?: DiscordRequester | null,
  ): Promise<DownloadJob> {
    const jobMediaId = mediaId({ tvdbId, type: DownloadType.Show })

    return this.request({
      action: 'requestShow',
      discordRequester,
      mediaId: jobMediaId,
      requester,
      scope,
      submit: async () => {
        // Always an explicit scope now - `{}` is "the whole series", which
        // is what a bare request means. See `EnsureSeriesOptions`.
        const ensured = await this.sonarrService.ensureSeries(tvdbId, {
          monitorEpisodes: scope ?? {},
        })
        this.mediaResolverService.invalidateAfterEnsure(jobMediaId, ensured)
        const { sonarrId } = ensured

        // Season flags after episodes, never before: Sonarr's `PUT /series`
        // may cascade a changed season flag down to that season's episodes,
        // so every episode read that feeds a result has to have happened
        // already. An episode request leaves its season's flag alone.
        if (scope?.episodeId == null) {
          await this.sonarrService.setSeasonsMonitored(
            sonarrId,
            // `!= null`, not truthiness - season 0 is Sonarr's specials.
            scope?.seasonNumber != null ? [scope.seasonNumber] : 'all',
            true,
          )
        }

        // Resolved *after* `ensureSeries`, not before: an episode id can't
        // exist for a series Sonarr has never seen, so resolving first
        // would fail on the one path (a fresh add) where the series has to
        // be created before anything about it can be looked up.
        const resolved = scope
          ? await this.sonarrService.resolveScope(scope)
          : undefined

        const flagged = this.flaggedGuids(jobMediaId)

        if (flagged.size === 0) {
          await this.triggerScopedSearch(sonarrId, resolved)
          return { scope: resolved }
        }

        const release = this.pickUnflaggedRelease(
          jobMediaId,
          resolved
            ? await this.sonarrService.getReleases(sonarrId, resolved)
            : await this.sonarrService.getReleases(sonarrId),
          flagged,
        )
        await this.sonarrService.grabRelease(release.guid, release.indexerId)

        return { scope: resolved }
      },
      type: DownloadType.Show,
      upstreamId: tvdbId,
    })
  }

  /**
   * Picks the narrowest search command the scope allows: one episode, one
   * season, or the whole series. Only reached when the title has no flagged
   * releases - once it does, this app picks the release itself, because none
   * of these commands can be told "anything but that one".
   */
  private async triggerScopedSearch(
    sonarrId: number,
    scope: ShowScope | undefined,
  ): Promise<void> {
    if (scope?.episodeId != null) {
      return this.sonarrService.triggerEpisodeSearch([scope.episodeId])
    }

    // `!= null`, not truthiness - season 0 is Sonarr's specials season.
    if (scope?.seasonNumber != null) {
      return this.sonarrService.triggerSeasonSearch(
        sonarrId,
        scope.seasonNumber,
      )
    }

    return this.sonarrService.triggerSearch(sonarrId)
  }

  /**
   * Every release guid flagged as bad for a title. An empty set is the
   * common case and the one that matters most - it's what keeps a title with
   * no flags on the untouched command path.
   */
  private flaggedGuids(jobMediaId: string): Set<string> {
    return new Set(
      listBadFilesByMediaId(this.dbService.db, jobMediaId).map(
        row => row.releaseGuid,
      ),
    )
  }

  /**
   * The app's own pick, used only once a title has flagged releases: the
   * generic `MoviesSearch`/`SeriesSearch` command has no way to be told
   * "anything but that one", so this app has to do the choosing itself.
   *
   * Throws when nothing survives the filter. That failure lands on the job
   * (via `request()`'s catch) with a message that says *why* - which beats a
   * job that sits in `Searching` forever waiting for a grab that will never
   * come.
   */
  private pickUnflaggedRelease(
    jobMediaId: string,
    releases: Release[],
    flagged: ReadonlySet<string>,
  ): Release {
    const release = pickBestRelease(releases, flagged)

    if (!release) {
      throw new Error(
        `No usable release for ${jobMediaId}: all ${releases.length} ` +
          `release(s) were either rejected upstream or flagged as bad files`,
      )
    }

    this.logger.log(
      {
        action: 'pickUnflaggedRelease',
        candidates: releases.length,
        flaggedCount: flagged.size,
        guid: release.guid,
        mediaId: jobMediaId,
      },
      'Picked a release ourselves - this title has flagged bad files',
    )

    return release
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
    submit: () => Promise<RequestSubmitResult | void>
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
      const result = await submit()

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
      // upstream) - its status is fresher than ours.
      if (current && current.status !== DownloadJobStatus.Requested) {
        return this.downloadStateService.hydrateOne(current)
      }

      return this.downloadStateService.hydrateOne(
        this.downloadStateService.updateJob(id, {
          // Folded into the same write that moves the job to Searching
          // rather than a second update - one broadcast, not two, for what
          // is one state change.
          ...(result?.scope ? { scope: result.scope } : {}),
          status: DownloadJobStatus.Searching,
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

    await this.cancelUpstream(job, action)

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

    const cancelling = this.downloadStateService.updateJob(id, {
      // A job cancelled out of `NeedsAttention` still carries upstream's
      // import error, which says nothing true about a cancelled attempt.
      error: undefined,
      status: DownloadJobStatus.Cancelling,
    })

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

  /** `cancelUpstream`, with a failure logged instead of thrown. */
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
   * The upstream half of a cancel: removes the job's queue items (the client
   * drops its partial files; nothing is blocklisted and no re-search is
   * started), then unmonitors only what has no file, so RSS doesn't grab it
   * again and a cancelled *replacement* leaves the title monitored for the
   * copy already on disk. Season and series flags are left alone.
   *
   * The queue is read fresh rather than from `MediaStateService`, whose copy
   * is up to a tick old - exactly the window a just-grabbed release lives in.
   * A show job only ever touches items inside its own scope, so cancelling
   * one episode leaves a sibling episode's download running.
   *
   * No upstream id (a first request `submit()` hasn't added yet) means there
   * is nothing upstream to undo.
   */
  private async cancelUpstream(
    job: DownloadJob,
    action: string,
  ): Promise<void> {
    if (!isManagedMedia(job.media)) return

    if (job.media.type === DownloadType.Movie) {
      const { radarrId } = job.media
      if (radarrId == null) return

      const queue = await this.radarrService.getQueue([radarrId])
      await this.removeQueueItems(
        job,
        queue.filter(item => item.movieId === radarrId),
        queueId => this.radarrService.removeQueueItem(queueId),
        action,
      )
      await this.radarrService.unmonitorIfMissing(radarrId)
      return
    }

    const { sonarrId } = job.media
    if (sonarrId == null) return

    const queue = await this.sonarrService.getQueue([sonarrId])
    await this.removeQueueItems(
      job,
      queue.filter(
        item => item.seriesId === sonarrId && matchesScope(item, job.scope),
      ),
      queueId => this.sonarrService.removeQueueItem(queueId),
      action,
    )
    await this.sonarrService.unmonitorScope(sonarrId, job.scope ?? {}, {
      withoutFileOnly: true,
    })
  }

  /**
   * Removes every item, best-effort. A partial failure is logged and
   * swallowed rather than thrown: the job still moves to `Cancelling`, and
   * the poller removes whatever is left of a `Cancelling` job's queue on its
   * next tick.
   */
  private async removeQueueItems(
    job: DownloadJob,
    items: PollableQueueItem[],
    remove: (queueId: number) => Promise<void>,
    action: string,
  ): Promise<void> {
    const removable = items.filter(
      (item): item is PollableQueueItem & { id: number } => item.id != null,
    )

    if (removable.length !== items.length) {
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
