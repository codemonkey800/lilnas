import {
  type BadFile,
  type DownloadJob,
  DownloadType,
  type FlagBadFileInput,
  type GrabReleaseInput,
  type JobRequester,
  type Release,
  type ReplaceReleaseInput,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'

import type { ForwardedUser } from 'src/auth/forwarded-user'
import {
  getBadFileByGuid,
  insertBadFile,
  listBadFilesByMediaId,
} from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { mediaIdSuffix } from 'src/db/media-id'
import type { BadFileRow } from 'src/db/schema'

import { MediaDownloadService } from './media-download.service'
import { MediaResolverService } from './media-resolver.service'
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
 * A `bad_files` row on the wire. The two flagger columns collapse into one
 * nested `flaggedBy` so the shape matches `DownloadJob.requester` - both
 * answer "who did this", and having them differ would be gratuitous.
 */
function toBadFile(row: BadFileRow): BadFile {
  return {
    createdAt: row.createdAt.toISOString(),
    flaggedBy: { email: row.flaggedByEmail, userId: row.flaggedByUserId },
    id: row.id,
    indexerId: row.indexerId,
    mediaId: row.mediaId,
    reason: row.reason,
    releaseGuid: row.releaseGuid,
    releaseTitle: row.releaseTitle,
  }
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
    private readonly mediaDownloadService: MediaDownloadService,
    private readonly mediaResolverService: MediaResolverService,
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
   * Downloads one specific release the user picked, tracked as an ordinary
   * `DownloadJob`.
   *
   * Two things distinguish it from `listReleases`:
   *
   * 1. **Monitoring is not restored.** A grab is a real choice, so the title
   *    (and, for shows, the target episodes) stays monitored afterwards so
   *    Radarr/Sonarr manage the import and future upgrades - exactly the
   *    state `requestMovie` already leaves behind.
   * 2. **The job goes through `MediaDownloadService.request()`**, the same
   *    choke point `requestMovie`/`requestShow` use, so requester
   *    attribution, `hiddenAttribution`, the WS events and the queue poller
   *    all behave identically. There is deliberately no second
   *    job-creation path.
   *
   * A flagged guid is refused outright with a `ConflictException` before any
   * job exists - no override path, by design.
   */
  async grabRelease(
    mediaId: string,
    input: GrabReleaseInput,
    requester?: JobRequester | null,
  ): Promise<DownloadJob> {
    const target = parseReleaseTarget(mediaId)
    this.assertNotFlagged(mediaId, input.guid)

    return this.runGrab({
      action: 'grabRelease',
      input,
      mediaId,
      requester,
      target,
    })
  }

  /**
   * Swaps what's on disk for a different release: delete the current file(s),
   * then grab the chosen one. One action, so the user isn't left with a
   * deleted movie and no replacement if they wander off halfway.
   *
   * The delete uses the **per-file** endpoints, never `unmonitorAndDelete` -
   * that removes the whole movie/series, and the replacement release needs
   * somewhere to import to. Monitoring normally no-ops here (a title with
   * files is already in the library and monitored), but the grab still goes
   * through `withMonitoring` because a downloaded-then-manually-unmonitored
   * title is possible and would otherwise fail the grab.
   *
   * Deleting zero files is **not** an error - nothing to replace just means
   * this is a plain grab.
   */
  async replaceRelease(
    mediaId: string,
    input: ReplaceReleaseInput,
    requester?: JobRequester | null,
  ): Promise<DownloadJob> {
    const target = parseReleaseTarget(mediaId)
    this.assertNotFlagged(mediaId, input.guid)

    return this.runGrab({
      action: 'replaceRelease',
      input,
      mediaId,
      prepare: async upstreamId => {
        const deleted = await this.deleteExistingFiles(target, upstreamId, {
          episodeId: input.episodeId,
          seasonNumber: input.seasonNumber,
        })

        // The library cache still holds the pre-delete entry, so drop it -
        // the next read of `filePath` must see the post-delete truth, not a
        // copy from up to a TTL window ago that this app already knows is
        // wrong.
        this.mediaResolverService.invalidate(mediaId)

        this.logger.log(
          { action: 'replaceRelease', deleted, mediaId, upstreamId },
          'Deleted existing files before grabbing the replacement',
        )
      },
      requester,
      target,
    })
  }

  /**
   * The shared tail of `grabRelease` and `replaceRelease` - everything from
   * "monitor the title" through "hand the pick to Radarr/Sonarr" wrapped in
   * the tracking job. `prepare` is replace's delete step, run *inside* the
   * monitoring borrow so it gets the same resolved upstream id the grab uses
   * rather than resolving it twice.
   *
   * Split out so the two paths can never diverge on `restore: false` or on
   * which choke point mints the job.
   */
  private async runGrab({
    action,
    input,
    mediaId,
    prepare,
    requester,
    target,
  }: {
    action: string
    input: GrabReleaseInput
    mediaId: string
    prepare?: (upstreamId: number) => Promise<void>
    requester?: JobRequester | null
    target: ReleaseTarget
  }): Promise<DownloadJob> {
    return this.mediaDownloadService.request({
      action,
      mediaId,
      requester,
      submit: () =>
        this.withMonitoring(
          target,
          {
            episodeId: input.episodeId,
            // A grab is an explicit choice - the title stays monitored.
            restore: false,
            seasonNumber: input.seasonNumber,
          },
          async upstreamId => {
            await prepare?.(upstreamId)

            return target.type === DownloadType.Movie
              ? this.radarrService.grabRelease(input.guid, input.indexerId)
              : this.sonarrService.grabRelease(input.guid, input.indexerId)
          },
        ),
      type: target.type,
      upstreamId:
        target.type === DownloadType.Movie ? target.tmdbId : target.tvdbId,
    })
  }

  /**
   * Deletes the files currently backing a title, scoped the same way the
   * release listing was, and returns how many it removed.
   *
   * Sequential rather than `Promise.all`: these are destructive calls against
   * a service that also has to rescan the folder afterwards, and a
   * half-succeeded parallel batch is much harder to reason about than a
   * half-finished sequential one.
   */
  private async deleteExistingFiles(
    target: ReleaseTarget,
    upstreamId: number,
    scope: ReleaseScope,
  ): Promise<number> {
    if (target.type === DownloadType.Movie) {
      const files = await this.radarrService.getMovieFiles(upstreamId)
      const fileIds = files
        .map(file => file.id)
        .filter((id): id is number => id != null)

      for (const id of fileIds) {
        await this.radarrService.deleteMovieFile(id)
      }

      return fileIds.length
    }

    // Sonarr's episode-file list carries `seasonNumber` but no episode id, so
    // a single-episode scope has to go the other way round: find the episode,
    // then delete the file it points at.
    if (scope.episodeId != null) {
      const episodes = await this.sonarrService.getEpisodes(upstreamId, {
        seasonNumber: scope.seasonNumber,
      })
      // `episodeFileId: 0` is Sonarr's "no file", so truthiness is the right
      // check here rather than a null guard.
      const fileId = episodes.find(
        episode => episode.id === scope.episodeId,
      )?.episodeFileId

      if (!fileId) {
        return 0
      }

      await this.sonarrService.deleteEpisodeFile(fileId)
      return 1
    }

    const files = await this.sonarrService.getEpisodeFiles(upstreamId)
    const fileIds = files
      .filter(
        file =>
          scope.seasonNumber == null ||
          file.seasonNumber === scope.seasonNumber,
      )
      .map(file => file.id)
      .filter((id): id is number => id != null)

    for (const id of fileIds) {
      await this.sonarrService.deleteEpisodeFile(id)
    }

    return fileIds.length
  }

  /**
   * Records a release as bad for this title. Idempotent on
   * `(mediaId, releaseGuid)` - re-flagging returns the original row rather
   * than erroring, so a double-click is harmless and the first flagger's
   * identity is the one that sticks.
   *
   * Flagging is the one action here gated behind `ForwardedUserGuard`,
   * because a flag records a judgement *someone* made and an anonymous one
   * would be unattributable.
   */
  flagBadFile(
    mediaId: string,
    input: FlagBadFileInput,
    user: ForwardedUser,
  ): BadFile {
    const target = parseReleaseTarget(mediaId)

    const row = insertBadFile(this.dbService.db, {
      flaggedByEmail: user.email,
      flaggedByUserId: user.userId,
      indexerId: input.indexerId,
      mediaId,
      mediaType: target.type,
      reason: input.reason,
      releaseGuid: input.guid,
      releaseTitle: input.title,
    })

    this.logger.log(
      {
        action: 'flagBadFile',
        flaggedBy: user.email,
        guid: input.guid,
        mediaId,
      },
      'Flagged a release as a bad file',
    )

    return toBadFile(row)
  }

  /** Every flag recorded against a title, newest first. */
  listBadFiles(mediaId: string): BadFile[] {
    parseReleaseTarget(mediaId)

    return listBadFilesByMediaId(this.dbService.db, mediaId).map(toBadFile)
  }

  /**
   * Refuses a release the user (or someone else) already marked as bad.
   * Checked before the job is minted, so a refusal is a plain 409 rather than
   * a job that exists only to record a failure.
   */
  private assertNotFlagged(mediaId: string, guid: string): void {
    const flagged = getBadFileByGuid(this.dbService.db, mediaId, guid)

    if (flagged) {
      throw new ConflictException(
        `Release '${flagged.releaseTitle ?? guid}' is flagged as a bad file for this title`,
      )
    }
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
