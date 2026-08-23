import { DownloadType, type Release } from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'

import { listBadFilesByMediaId } from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { mediaIdSuffix } from 'src/db/media-id'

import { RadarrService } from './radarr.service'
import { SonarrService } from './sonarr.service'

/**
 * A media id parsed back into the upstream identifier its service actually
 * keys on. Videos deliberately have no arm - they have no indexer releases -
 * so parsing one is a 404 rather than a case to handle.
 */
export type ReleaseTarget =
  | { tmdbId: number; type: DownloadType.Movie }
  | { tvdbId: number; type: DownloadType.Show }

/** Narrows a release listing (and the monitoring borrow) to part of a show. */
export interface ReleaseScope {
  episodeId?: number
  seasonNumber?: number
}

interface WithMonitoringOptions extends ReleaseScope {
  /**
   * `true` for the read path (browsing releases must not leave a title
   * monitored), `false` for grab and replace (the user picked something, so
   * the title stays monitored and Radarr/Sonarr manage the import and future
   * upgrades - exactly the state `requestMovie` leaves behind).
   */
  restore: boolean
}

/**
 * `tmdb:27205` / `tvdb:81189` -> the upstream id its service keys on.
 *
 * Throws `NotFoundException` for a `video:` key or an unrecognized prefix:
 * releases are an indexer concept, and a video has no indexer behind it.
 */
export function parseReleaseTarget(mediaId: string): ReleaseTarget {
  const suffix = Number(mediaIdSuffix(mediaId))

  if (mediaId.startsWith('tmdb:') && Number.isFinite(suffix)) {
    return { tmdbId: suffix, type: DownloadType.Movie }
  }

  if (mediaId.startsWith('tvdb:') && Number.isFinite(suffix)) {
    return { tvdbId: suffix, type: DownloadType.Show }
  }

  throw new NotFoundException(
    `Releases are only available for movies and shows, not '${mediaId}'`,
  )
}

/**
 * Everything that puts a *specific* release in the user's hands: listing what
 * the indexers have, grabbing one, replacing what's already downloaded, and
 * flagging one as bad.
 *
 * The load-bearing idea here is that Radarr and Sonarr won't surface (or let
 * you grab) releases for a title that isn't in the library **and** monitored
 * - so browsing releases for a title nobody has requested yet has to add and
 * monitor it first. Leaving it that way is not acceptable (an RSS sync would
 * eventually grab something nobody asked for), so the read path *borrows*
 * monitoring and puts it back; see `withMonitoring`.
 */
@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name)

  constructor(
    private readonly dbService: DbService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  /**
   * Every release the indexers have for a title, annotated with this app's
   * own `flaggedBad`.
   *
   * Deliberately does **not** ask `MediaResolverService` for a
   * `radarrId`/`sonarrId`: the resolver only has one for titles already in
   * the library, and browsing releases for a not-yet-requested title is the
   * primary use case. `ensureMovie`/`ensureSeries` is where the upstream id
   * comes from instead.
   */
  async listReleases(
    mediaId: string,
    scope: ReleaseScope = {},
  ): Promise<Release[]> {
    const target = parseReleaseTarget(mediaId)

    const releases = await this.withMonitoring(
      target,
      { ...scope, restore: true },
      upstreamId =>
        target.type === DownloadType.Movie
          ? this.radarrService.getReleases(upstreamId)
          : this.sonarrService.getReleases(upstreamId, scope),
    )

    return this.annotateFlagged(mediaId, releases)
  }

  /**
   * Joins `bad_files` onto a release list. One query per listing, not one per
   * release - the flag set for a title is small and the guid match is a plain
   * set lookup.
   */
  private annotateFlagged(mediaId: string, releases: Release[]): Release[] {
    const flagged = new Set(
      listBadFilesByMediaId(this.dbService.db, mediaId).map(
        row => row.releaseGuid,
      ),
    )

    if (flagged.size === 0) {
      return releases
    }

    return releases.map(release =>
      flagged.has(release.guid) ? { ...release, flaggedBad: true } : release,
    )
  }

  /**
   * Runs `fn` with the title guaranteed monitored upstream, then optionally
   * puts monitoring back the way it found it.
   *
   * The rule that makes this safe: **if it was already monitored, change
   * nothing - on the way in or on the way out.** A title with a pending
   * `requestMovie` is monitored on purpose, and blindly unmonitoring after a
   * release listing would silently kill that request. Anything already
   * downloaded is normally monitored too, so this covers that without
   * depending on it being true.
   *
   * A failed restore logs and is swallowed - the caller asked for releases,
   * and failing their request because the cleanup didn't take would be the
   * wrong trade.
   *
   * Accepted race: the borrow window spans one interactive indexer search
   * (seconds to ~a minute). If an RSS sync ticks inside that window *and* the
   * feed carries a matching release, Radarr can self-grab. Small, and
   * strictly better than the permanently-monitored state `requestMovie`
   * already leaves behind.
   */
  private async withMonitoring<T>(
    target: ReleaseTarget,
    opts: WithMonitoringOptions,
    fn: (upstreamId: number) => Promise<T>,
  ): Promise<T> {
    if (target.type === DownloadType.Movie) {
      const { radarrId, wasMonitored } = await this.radarrService.ensureMovie(
        target.tmdbId,
      )

      try {
        return await fn(radarrId)
      } finally {
        if (opts.restore && !wasMonitored) {
          await this.restore('radarr', radarrId, () =>
            this.radarrService.setMonitored(radarrId, false),
          )
        }
      }
    }

    const { sonarrId, turnedOnEpisodeIds, wasMonitored } =
      await this.sonarrService.ensureSeries(target.tvdbId, {
        monitorEpisodes: {
          episodeId: opts.episodeId,
          seasonNumber: opts.seasonNumber,
        },
      })

    try {
      return await fn(sonarrId)
    } finally {
      if (opts.restore) {
        await this.restore('sonarr', sonarrId, async () => {
          // Episodes first, then the series - the reverse of the order they
          // were turned on, and the order that leaves the least time with a
          // monitored series pointing at unmonitored episodes.
          await this.sonarrService.setEpisodesMonitored(
            turnedOnEpisodeIds,
            false,
          )
          if (!wasMonitored) {
            await this.sonarrService.setSeriesMonitored(sonarrId, false)
          }
        })
      }
    }
  }

  /**
   * Runs the restore half of `withMonitoring`, downgrading any failure to a
   * warning. Split out so the `finally` blocks above stay readable and so
   * there is exactly one place that decides a failed restore is non-fatal.
   */
  private async restore(
    source: 'radarr' | 'sonarr',
    upstreamId: number,
    undo: () => Promise<void>,
  ): Promise<void> {
    try {
      await undo()
    } catch (err) {
      this.logger.warn(
        {
          action: 'restoreMonitoring',
          error: getErrorMessage(err),
          source,
          upstreamId,
        },
        'Failed to restore borrowed monitoring - the title may be left monitored',
      )
    }
  }
}
