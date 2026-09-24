import {
  DownloadJobStatus,
  DownloadType,
  isMovie,
  isShow,
  type Season,
  type ShowScope,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'

import type { MediaFileReleaseRow } from 'src/db/schema'
import { DownloadStateService } from 'src/download/download-state.service'

import { CurrentReleaseService } from './current-release.service'
import { planShowDelete, type ShowDeleteCascade } from './delete-cascade.util'
import { MediaResolverService } from './media-resolver.service'
import { MediaStateService } from './media-state.service'
import { RadarrService } from './radarr.service'
import { parseReleaseTarget } from './release.service'
import { SonarrService } from './sonarr.service'

/**
 * Statuses a job can never leave. Deliberately a second copy of the set in
 * media-poller.service.ts rather than an import from it: four members are
 * cheaper to duplicate than a dependency from this service onto the poller,
 * which it otherwise has nothing to do with.
 */
const TERMINAL_STATUSES = new Set<DownloadJobStatus>([
  DownloadJobStatus.Cancelled,
  DownloadJobStatus.Completed,
  DownloadJobStatus.Failed,
])

/** What a delete removed, and how far up the title it reached. */
export interface DeleteFilesResult {
  /** Widest level the delete reached. Always `'none'` for a movie. */
  cascade: ShowDeleteCascade
  /** Files on disk the delete removed. Zero is a legitimate success. */
  deletedCount: number
  /** Whether the title itself is gone from Sonarr/Radarr now. */
  removedFromLibrary: boolean
}

/**
 * The season/episode half of Phase 4: browsing a series' structure, and
 * deleting what's on disk for a title.
 *
 * Neither operation rewrites a `DownloadJob`'s own fields - existing jobs for
 * the title keep their history either way. A delete here **can** remove the
 * library entry: a movie delete always removes the movie from Radarr, and a
 * show delete that leaves nothing behind removes the series from Sonarr.
 * When that happens the gallery, built from the library, stops listing the
 * title on its own, while its jobs stay intact as history.
 * The job-keyed `DELETE /download/shows/:jobId` is no longer the only way a
 * title leaves the library.
 */
@Injectable()
export class ShowService {
  private readonly logger = new Logger(ShowService.name)

  // `DownloadStateService` arrives across the DownloadModule <-> MediaModule
  // forwardRef, exactly as it does for MediaDownloadService and
  // MediaPollerService - see media.module.ts for why that cycle exists.
  constructor(
    private readonly currentReleaseService: CurrentReleaseService,
    private readonly downloadStateService: DownloadStateService,
    private readonly mediaResolverService: MediaResolverService,
    private readonly mediaStateService: MediaStateService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  /**
   * Every season of a show with its episodes, each episode stamped with the
   * release that produced the file on disk where that is recoverable, and
   * with its state (`downloading` + `queueSnapshot` while in the queue,
   * otherwise `available`/`wanted`/`absent` off its own file and monitored
   * flag) - the show page's per-episode truth.
   *
   * Deliberately does **not** call `ensureSeries`, unlike the release listing
   * path: browsing the season list of a show nobody has added has nothing to
   * show, and adding a series to the library as a side effect of a GET would
   * be a genuine surprise. A show that isn't in the library is a 404.
   */
  async listSeasons(mediaId: string): Promise<Season[]> {
    const target = parseReleaseTarget(mediaId)

    if (target.type === DownloadType.Movie) {
      throw new NotFoundException(
        `Seasons are only available for shows, not '${mediaId}'`,
      )
    }

    const sonarrId = await this.resolveUpstreamId(mediaId, DownloadType.Show)
    if (sonarrId == null) {
      throw new NotFoundException(
        `Show '${mediaId}' is not in the library, so it has no seasons yet`,
      )
    }

    const seasons = await this.annotateCurrentReleases(
      mediaId,
      sonarrId,
      await this.sonarrService.listSeasons(sonarrId),
    )

    // Synchronous and in place - it reads the Sonarr queue the poller last
    // fed `MediaStateService`, so this costs no upstream call of its own.
    this.mediaStateService.annotateEpisodes(sonarrId, seasons)

    this.logger.log(
      {
        action: 'listSeasons',
        episodeCount: seasons.reduce((n, s) => n + s.episodes.length, 0),
        mediaId,
        seasonCount: seasons.length,
        sonarrId,
      },
      'Listed a series’ seasons',
    )

    return seasons
  }

  /**
   * Copies the seasons through, stamping `currentReleaseGuid` onto every
   * episode whose file resolves to a release.
   *
   * The file ids come free off the episodes Sonarr already returned, and
   * Sonarr's history is per-*series*, so the whole listing costs exactly one
   * resolution call no matter how many seasons it spans - which is why this
   * flattens first rather than running a pass per season.
   *
   * An episode the resolver has no answer for keeps the field absent and
   * renders exactly as it did before this existed.
   */
  private async annotateCurrentReleases(
    mediaId: string,
    sonarrId: number,
    seasons: Season[],
  ): Promise<Season[]> {
    // `episodeFileId: 0` is Sonarr's "no file" - the mapper omits the zero,
    // so truthiness is the right check here rather than a null guard.
    const fileIds = seasons.flatMap(season =>
      season.episodes
        .map(episode => episode.episodeFileId)
        .filter((id): id is number => !!id),
    )

    if (fileIds.length === 0) {
      return seasons
    }

    const releases = await this.resolveCurrentReleases(
      mediaId,
      sonarrId,
      fileIds,
    )

    if (releases.size === 0) {
      return seasons
    }

    return seasons.map(season => ({
      ...season,
      episodes: season.episodes.map(episode => {
        const guid = episode.episodeFileId
          ? releases.get(episode.episodeFileId)?.releaseGuid
          : undefined

        return guid ? { ...episode, currentReleaseGuid: guid } : episode
      }),
    }))
  }

  /**
   * `CurrentReleaseService` already degrades to an empty map on an upstream
   * failure, so this catch is belt-and-braces: the guid is an enrichment on a
   * page that reads perfectly well without it, and nothing about it is worth
   * failing the season list over.
   */
  private async resolveCurrentReleases(
    mediaId: string,
    sonarrId: number,
    fileIds: readonly number[],
  ): Promise<Map<number, MediaFileReleaseRow>> {
    try {
      return await this.currentReleaseService.forEpisodeFiles(
        mediaId,
        sonarrId,
        fileIds,
      )
    } catch (err) {
      this.logger.warn(
        { action: 'listSeasons', error: getErrorMessage(err), mediaId },
        'Current release lookup failed - listing seasons without release guids',
      )
      return new Map()
    }
  }

  /**
   * Deletes the files a scope names and reports what went. Narrowest first:
   * `episodeId` is one file, `seasonNumber` is that season's, neither is
   * every file of the title.
   *
   * **Deleting zero files is a success**, not a 404 - the caller asked for a
   * state and that state already held.
   *
   * The unmonitor afterwards is what makes a partial delete stick, and it
   * runs even when nothing was deleted: to Sonarr a monitored episode with no
   * file is a *missing* episode, which is exactly the thing the next RSS sync
   * would re-grab. A delete that leaves nothing behind goes further and
   * removes the title from the library outright, so there is no monitoring
   * state left to get wrong.
   *
   * A removal also cancels the title's in-flight jobs. Nothing upstream is
   * searching for them any more, and `MediaPollerService.trackedJobs` skips
   * any job whose media no longer resolves to an upstream id - so left alone
   * they would sit at `Searching` forever, until a restart failed them with
   * "Interrupted by a service restart".
   */
  async deleteFiles(
    mediaId: string,
    scope: ShowScope,
  ): Promise<DeleteFilesResult> {
    const target = parseReleaseTarget(mediaId)

    const result =
      target.type === DownloadType.Movie
        ? await this.deleteMovieFiles(mediaId, scope)
        : await this.deleteShowFiles(mediaId, scope)

    // The library cache still holds the pre-delete entry, so drop it - the
    // next read of `filePath` must see the post-delete truth rather than a
    // copy from up to a TTL window ago that this app already knows is wrong.
    this.mediaResolverService.invalidate(mediaId)

    // A season or episode delete leaves the title in the library, so its
    // jobs are still perfectly pollable and are left alone.
    if (result.removedFromLibrary) {
      this.cancelInFlightJobs(mediaId)
    }

    return result
  }

  /**
   * Moves every non-terminal job of a removed title to `Cancelled`.
   *
   * Iterates the live Map rather than the `jobs` table on purpose: those are
   * exactly the records `updateJob` can write, and it *throws* on anything
   * else. A job the Map has never seen (one from before a restart) needs no
   * help here - it is either already terminal or the next boot sweep fails
   * it.
   *
   * Best-effort by design. The delete has already succeeded upstream by the
   * time this runs, so a write that fails here is a logged inconsistency,
   * never a failed delete - and the guard sits inside the loop so one bad
   * record cannot cost the title's other jobs their cancellation.
   */
  private cancelInFlightJobs(mediaId: string): void {
    for (const record of this.downloadStateService.jobs.values()) {
      if (record.mediaId !== mediaId || TERMINAL_STATUSES.has(record.status))
        continue

      try {
        this.downloadStateService.updateJob(record.id, {
          error: 'Removed from the library',
          status: DownloadJobStatus.Cancelled,
        })
      } catch (err) {
        this.logger.warn(
          {
            action: 'deleteFiles',
            error: getErrorMessage(err),
            jobId: record.id,
            mediaId,
          },
          'Removed the title but failed to cancel one of its in-flight jobs',
        )
      }
    }
  }

  private async deleteMovieFiles(
    mediaId: string,
    scope: ShowScope,
  ): Promise<DeleteFilesResult> {
    // Checked before resolving anything upstream: a season or episode on a
    // movie key is malformed regardless of what the library holds, and
    // ignoring it silently would let a caller believe they had deleted one
    // episode of something that has none.
    if (scope.episodeId != null || scope.seasonNumber != null) {
      throw new BadRequestException(
        `'${mediaId}' is a movie - it has no seasons or episodes to scope a delete to`,
      )
    }

    const radarrId = await this.resolveUpstreamId(mediaId, DownloadType.Movie)
    if (radarrId == null) {
      throw new NotFoundException(`Movie '${mediaId}' is not in the library`)
    }

    // Read before the removal purely for the count - Radarr deletes the
    // files itself, so this is the last moment anything can say how many
    // there were.
    const files = await this.radarrService.getMovieFiles(radarrId)

    // A movie has exactly one scope, so every movie delete is a whole-title
    // delete: there is no "some of it is left" state to unmonitor towards.
    // `unmonitorAndDelete` cancels any in-flight queue item first, then
    // removes the movie and its files in one upstream call.
    await this.radarrService.unmonitorAndDelete(radarrId, true)

    this.logger.log(
      {
        action: 'deleteFiles',
        cascade: 'none',
        deletedCount: files.length,
        mediaId,
        radarrId,
      },
      'Deleted a movie’s files and removed it from Radarr',
    )

    return {
      cascade: 'none',
      deletedCount: files.length,
      removedFromLibrary: true,
    }
  }

  private async deleteShowFiles(
    mediaId: string,
    scope: ShowScope,
  ): Promise<DeleteFilesResult> {
    const sonarrId = await this.resolveUpstreamId(mediaId, DownloadType.Show)
    if (sonarrId == null) {
      throw new NotFoundException(`Show '${mediaId}' is not in the library`)
    }

    // One snapshot of the series decides everything. The queue **must** be
    // filtered to this series: `planShowDelete` takes no series id and reads
    // every item it is handed as belonging here, so a whole-instance queue
    // would make the series look permanently "remaining" and no delete would
    // ever cascade.
    const [episodes, queue] = await Promise.all([
      this.sonarrService.getEpisodes(sonarrId),
      this.sonarrService.getQueue([sonarrId]),
    ])

    const plan = planShowDelete(episodes, queue, scope)

    if (plan.cascade === 'series') {
      // Nothing is left once this scope goes, so the series itself goes -
      // no per-file deletes, Sonarr removes the folder. A throw here has
      // destroyed nothing yet, so it propagates rather than degrading.
      await this.sonarrService.unmonitorAndDelete(sonarrId, true)
    } else {
      // Sequential rather than Promise.all, matching the replace path: these
      // are destructive calls against a service that rescans the folder
      // afterwards, and a half-succeeded parallel batch is much harder to
      // reason about than a half-finished sequential one.
      for (const id of plan.fileIds) {
        await this.sonarrService.deleteEpisodeFile(id)
      }

      await this.unmonitor('sonarr', mediaId, async () => {
        // Episodes first, then the season flag: Sonarr's `PUT /series` may
        // cascade a changed `seasons[].monitored` down to that season's
        // episodes, and `unmonitorScope` re-reads the episodes to decide
        // what to write.
        // Always set on a non-series plan; `scope` is an equivalent fallback
        // that only exists to satisfy the optional field's type.
        await this.sonarrService.unmonitorScope(
          sonarrId,
          plan.unmonitorScope ?? scope,
        )
        await this.sonarrService.setSeasonsMonitored(
          sonarrId,
          plan.seasonNumbersToUnmonitor,
          false,
        )
      })
    }

    this.logger.log(
      {
        action: 'deleteFiles',
        cascade: plan.cascade,
        deletedCount: plan.fileCount,
        episodeId: scope.episodeId,
        mediaId,
        seasonNumber: scope.seasonNumber,
        seasonNumbersToUnmonitor: plan.seasonNumbersToUnmonitor,
        sonarrId,
      },
      plan.cascade === 'series'
        ? 'Deleted a show’s files and removed the series from Sonarr'
        : 'Deleted a show’s files and unmonitored the scope',
    )

    return {
      cascade: plan.cascade,
      deletedCount: plan.fileCount,
      removedFromLibrary: plan.cascade === 'series',
    }
  }

  /**
   * The upstream library id for a media key, or `undefined` when the title
   * isn't in the library. `resolve()` never throws - it emits a placeholder
   * with no `radarrId`/`sonarrId` when the lookup degrades - so "no id" is
   * the single answer covering both "not added" and "Radarr is down".
   */
  private async resolveUpstreamId(
    mediaId: string,
    type: DownloadType,
  ): Promise<number | undefined> {
    const { media } = await this.mediaResolverService.resolve([
      { mediaId, type },
    ])

    const resolved = media.get(mediaId)
    if (!resolved) return undefined

    if (isMovie(resolved)) return resolved.radarrId
    if (isShow(resolved)) return resolved.sonarrId
    return undefined
  }

  /**
   * Runs the unmonitor half of a partial delete, downgrading a failure to a
   * warning the way `ReleaseService.restore()` does.
   *
   * The files are already gone by the time this runs, so failing the caller
   * now helps nobody - but the warning has to say what was left monitored,
   * because that title is now a candidate for re-grabbing. A full removal
   * never comes through here: it deletes nothing before the upstream call,
   * so there is nothing to downgrade and the error propagates.
   */
  private async unmonitor(
    source: 'sonarr',
    mediaId: string,
    undo: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await undo()
    } catch (err) {
      this.logger.warn(
        {
          action: 'deleteFiles',
          error: getErrorMessage(err),
          mediaId,
          source,
        },
        'Deleted the files but failed to unmonitor - the title may be re-grabbed',
      )
    }
  }
}
