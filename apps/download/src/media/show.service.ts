import {
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

import { resolveEpisodeFileIds } from './episode-files.util'
import { MediaResolverService } from './media-resolver.service'
import { RadarrService } from './radarr.service'
import { parseReleaseTarget } from './release.service'
import { SonarrService } from './sonarr.service'

/**
 * The season/episode half of Phase 4: browsing a series' structure, and
 * deleting part of what's on disk for a title.
 *
 * Neither operation touches a `DownloadJob`. A delete here removes **files**,
 * not the library entry - the series or movie stays in Sonarr/Radarr, and
 * existing jobs for the title keep their history. Removing a title outright
 * is still the job-keyed `DELETE /download/shows/:jobId`.
 */
@Injectable()
export class ShowService {
  private readonly logger = new Logger(ShowService.name)

  constructor(
    private readonly mediaResolverService: MediaResolverService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  /**
   * Every season of a show with its episodes.
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

    const seasons = await this.sonarrService.listSeasons(sonarrId)

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
   * Deletes the files a scope names and returns how many went. Narrowest
   * first: `episodeId` is one file, `seasonNumber` is that season's, neither
   * is every file of the title.
   *
   * **Deleting zero files is a success**, not a 404 - the caller asked for a
   * state and that state already held.
   *
   * The unmonitor afterwards is what makes the delete stick, and it runs even
   * when nothing was deleted: to Sonarr a monitored episode with no file is a
   * *missing* episode, which is exactly the thing the next RSS sync would
   * re-grab.
   */
  async deleteFiles(mediaId: string, scope: ShowScope): Promise<number> {
    const target = parseReleaseTarget(mediaId)

    const deletedCount =
      target.type === DownloadType.Movie
        ? await this.deleteMovieFiles(mediaId, scope)
        : await this.deleteShowFiles(mediaId, scope)

    // The library cache still holds the pre-delete entry, so drop it - the
    // next read of `filePath` must see the post-delete truth rather than a
    // copy from up to a TTL window ago that this app already knows is wrong.
    this.mediaResolverService.invalidate(mediaId)

    return deletedCount
  }

  private async deleteMovieFiles(
    mediaId: string,
    scope: ShowScope,
  ): Promise<number> {
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

    const files = await this.radarrService.getMovieFiles(radarrId)
    const fileIds = files
      .map(file => file.id)
      .filter((id): id is number => id != null)

    // Sequential rather than Promise.all, matching the replace path: these
    // are destructive calls against a service that rescans the folder
    // afterwards, and a half-succeeded parallel batch is much harder to
    // reason about than a half-finished sequential one.
    for (const id of fileIds) {
      await this.radarrService.deleteMovieFile(id)
    }

    await this.unmonitor('radarr', mediaId, () =>
      this.radarrService.setMonitored(radarrId, false),
    )

    this.logger.log(
      {
        action: 'deleteFiles',
        deletedCount: fileIds.length,
        mediaId,
        radarrId,
      },
      'Deleted a movie’s files and unmonitored it',
    )

    return fileIds.length
  }

  private async deleteShowFiles(
    mediaId: string,
    scope: ShowScope,
  ): Promise<number> {
    const sonarrId = await this.resolveUpstreamId(mediaId, DownloadType.Show)
    if (sonarrId == null) {
      throw new NotFoundException(`Show '${mediaId}' is not in the library`)
    }

    const fileIds = await resolveEpisodeFileIds(
      this.sonarrService,
      sonarrId,
      scope,
    )

    for (const id of fileIds) {
      await this.sonarrService.deleteEpisodeFile(id)
    }

    await this.unmonitor('sonarr', mediaId, () =>
      this.sonarrService.unmonitorScope(sonarrId, scope),
    )

    this.logger.log(
      {
        action: 'deleteFiles',
        deletedCount: fileIds.length,
        episodeId: scope.episodeId,
        mediaId,
        seasonNumber: scope.seasonNumber,
        sonarrId,
      },
      'Deleted a show’s files and unmonitored the scope',
    )

    return fileIds.length
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
   * Runs the unmonitor half of a delete, downgrading a failure to a warning
   * the way `ReleaseService.restore()` does.
   *
   * The files are already gone by the time this runs, so failing the caller
   * now helps nobody - but the warning has to say what was left monitored,
   * because that title is now a candidate for re-grabbing.
   */
  private async unmonitor(
    source: 'radarr' | 'sonarr',
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
