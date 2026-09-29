import { ReleaseProtocolSchema } from '@lilnas/utils/download/schema'
import {
  type BadFile,
  type DownloadJob,
  DownloadType,
  type FlagBadFileInput,
  type GrabReleaseInput,
  type JobRequester,
  type Release,
  type ReleaseProtocol,
  type ReplaceReleaseInput,
  type ShowScope,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'

import type { ForwardedUser } from 'src/auth/forwarded-user'
import {
  deleteBadFile,
  getBadFileByGuid,
  insertBadFile,
  listBadFilesByMediaId,
  usableReleaseTitle,
} from 'src/db/bad-files.repo'
import { DbService } from 'src/db/db.service'
import { getReleaseTitleByGuid } from 'src/db/media-file-releases.repo'
import { mediaId, mediaIdSuffix } from 'src/db/media-id'
import type { BadFileRow, MediaFileReleaseRow } from 'src/db/schema'

import type { CommandRef, CommandSnapshot } from './arr-command.types'
import { waitForCommand } from './command-wait.util'
import { CurrentReleaseService } from './current-release.service'
import {
  type ResolvedEpisodeFiles,
  resolveEpisodeFileIds,
} from './episode-files.util'
import { syncFlaggedReleases } from './flagged-release-sync.util'
import { mediaMutex } from './keyed-mutex.util'
import { MediaDownloadService } from './media-download.service'
import { MediaResolverService } from './media-resolver.service'
import { RadarrService } from './radarr.service'
import { SdkHttpError } from './sdk-result.util'
import { SonarrService, toSonarrReleaseScope } from './sonarr.service'

/**
 * A media id parsed back into the upstream identifier its service actually
 * keys on. Videos deliberately have no arm - they have no indexer releases -
 * so parsing one is a 404 rather than a case to handle.
 */
export type ReleaseTarget =
  | { tmdbId: number; type: DownloadType.Movie }
  | { tvdbId: number; type: DownloadType.Show }

/** Narrows a release listing (or a grab's monitoring) to part of a show. */
export interface ReleaseScope {
  episodeId?: number
  seasonNumber?: number
}

/**
 * The longest a release listing waits for Radarr/Sonarr to finish the
 * metadata refresh they queue when a title is added, before searching
 * anyway. A search that runs first can miss releases - the alternate titles
 * and translations it matches on arrive with that refresh.
 */
export const BROWSE_REFRESH_WAIT_MS = 30_000

/** How often the refresh wait re-reads the command. */
const BROWSE_REFRESH_POLL_MS = 1_000

/**
 * The 400 for a show release listing that names neither a season nor an
 * episode - see `listReleases`.
 */
export const PICK_A_SCOPE_MESSAGE = 'Pick a season or an episode'

/**
 * The job error for a pick whose release cache entry expired and that a
 * fresh search no longer returns.
 */
const RELEASE_GONE_MESSAGE =
  'That release is no longer available — search again'

/**
 * The canonical media id for a parsed target - the `mediaMutex` key and the
 * resolver cache key. Rebuilt from the target rather than taken from the
 * route so `tmdb:027205` and `tmdb:27205` share one lock.
 */
function targetMediaId(target: ReleaseTarget): string {
  return target.type === DownloadType.Movie
    ? mediaId({ tmdbId: target.tmdbId, type: DownloadType.Movie })
    : mediaId({ tvdbId: target.tvdbId, type: DownloadType.Show })
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
 * The `ShowScope` a grab body implies, or `undefined` for an unscoped one.
 *
 * Movies never get a scope. `GrabReleaseInput` carries the show-only fields
 * regardless of target - they're simply ignored on a `tmdb:` key, exactly as
 * they were before Phase 4 - so this is where that ignoring becomes explicit
 * rather than a new rejection.
 *
 * Keys are omitted rather than set to `undefined` so the persisted JSON is
 * `{"seasonNumber":3}`, not `{"episodeId":null,"seasonNumber":3}`.
 */
function showScopeFromInput(
  target: ReleaseTarget,
  input: GrabReleaseInput,
): ShowScope | undefined {
  if (target.type === DownloadType.Movie) return undefined
  if (input.episodeId == null && input.seasonNumber == null) return undefined

  return {
    ...(input.episodeId != null ? { episodeId: input.episodeId } : {}),
    ...(input.seasonNumber != null ? { seasonNumber: input.seasonNumber } : {}),
  }
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
 * The cached `protocol` string narrowed back to the shared enum. The column
 * is plain `text` - it stores whatever `historyProtocol()` classified - so a
 * value written by an older build (or by hand) reads as "no protocol" rather
 * than leaking a string the wire schema would reject.
 */
function toReleaseProtocol(value: string | null): ReleaseProtocol | undefined {
  const parsed = ReleaseProtocolSchema.safeParse(value)

  return parsed.success ? parsed.data : undefined
}

/**
 * The release currently on disk, rendered as a search result.
 *
 * Hand-built rather than run through `toCommonRelease`: this comes out of
 * `media_file_releases`, not an indexer search, so there is no
 * `CommonReleaseResource` to map. It still follows that mapper's conventions
 * - nulls collapse to `undefined`, an unresolvable indexer id falls back to
 * `0`, and the guid stands in for a missing title.
 *
 * `downloadAllowed: true` / `rejected: false` are deliberate and must stay
 * that way. `ReleaseRow` derives its blocked styling from those two, and this
 * row does not offer a grab at all - it offers the *report* control - so
 * marking it blocked would make a perfectly good row look broken. If the guid
 * really is flagged, `annotateFlagged` sets `flaggedBad` and the row blocks
 * for the right reason.
 *
 * No `quality`: history records no `QualityModel`, and `ReleaseRow` already
 * falls back to the title when quality and size are both absent.
 */
function toCurrentRelease(row: MediaFileReleaseRow): Release {
  return {
    downloadAllowed: true,
    // Filled in by `annotateFlagged`, exactly like every indexer result.
    flaggedBad: false,
    guid: row.releaseGuid,
    indexer: row.indexer ?? undefined,
    indexerId: row.indexerId ?? 0,
    protocol: toReleaseProtocol(row.protocol),
    publishDate: row.publishDate?.toISOString(),
    rejected: false,
    releaseGroup: row.releaseGroup ?? undefined,
    size: row.size ?? undefined,
    title: row.releaseTitle ?? row.releaseGuid,
  }
}

/**
 * Everything that puts a *specific* release in the user's hands: listing what
 * the indexers have, grabbing one, replacing what's already downloaded, and
 * flagging one as bad.
 *
 * Radarr and Sonarr key their release endpoints on their own library ids, so
 * browsing releases for a title nobody has requested yet has to add it
 * first. It is added **unmonitored** and left there: their interactive
 * search and `POST /release` never check `monitored`, so browsing never
 * needs it on, never flips it, and never deletes anything. An unmonitored
 * title with no file reads as `absent`, exactly like one that isn't in the
 * library at all.
 *
 * Only a grab (or a replace) turns monitoring on, and only once the grab has
 * succeeded - so a failed grab leaves the title as it found it. A replace
 * deletes the old files only after that same successful grab, so a failed
 * one leaves them on disk too.
 *
 * Every ensure and every monitor write runs inside `mediaMutex`, keyed by
 * media id, so two browses of one title add it once, and a browse can't
 * interleave its add with a request's.
 */
@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name)

  constructor(
    private readonly currentReleaseService: CurrentReleaseService,
    private readonly dbService: DbService,
    private readonly mediaDownloadService: MediaDownloadService,
    private readonly mediaResolverService: MediaResolverService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  /**
   * Every release the indexers have for a title, with the release currently
   * on disk guaranteed to be among them, all annotated with this app's own
   * `flaggedBad`.
   *
   * Deliberately does **not** ask `MediaResolverService` for a
   * `radarrId`/`sonarrId`: the resolver only has one for titles already in
   * the library, and browsing releases for a not-yet-requested title is the
   * primary use case. `ensureMovie`/`ensureSeries` is where the upstream id
   * comes from instead.
   *
   * A show listing must name a season or an episode, and one that names
   * neither is a 400 before anything is added: Sonarr's unscoped
   * `GET /release` is its RSS feed, not a search (see `SonarrReleaseScope`).
   */
  async listReleases(
    mediaId: string,
    scope: ReleaseScope = {},
  ): Promise<Release[]> {
    const target = parseReleaseTarget(mediaId)
    const showScope =
      target.type === DownloadType.Show
        ? toSonarrReleaseScope(scope)
        : undefined

    if (target.type === DownloadType.Show && !showScope) {
      throw new BadRequestException(PICK_A_SCOPE_MESSAGE)
    }

    const upstreamId = await this.ensureForBrowse(target)

    const found = showScope
      ? await this.sonarrService.getReleases(upstreamId, showScope)
      : await this.radarrService.getReleases(upstreamId)

    // Before `annotateFlagged`, so a synthesized row picks its `flaggedBad`
    // up for free.
    const releases = await this.withCurrentRelease(
      mediaId,
      target,
      upstreamId,
      scope,
      found,
    )

    return this.annotateFlagged(mediaId, releases)
  }

  /**
   * Gets the title into the library for a release listing and returns its
   * upstream id - adding it **unmonitored** when it is missing, and writing
   * nothing when it is already there.
   *
   * On a fresh add, waits (up to `BROWSE_REFRESH_WAIT_MS`) for the refresh
   * Radarr/Sonarr queue on every add, so the search runs against the full
   * metadata. The wait is inside the lock on purpose: a second browse of the
   * same title queues behind it and then finds a title that is both present
   * and refreshed, rather than searching one that is half-built. The cost -
   * a concurrent request for that title waits too, for at most the bound -
   * only arises on the first-ever browse of a title.
   */
  private ensureForBrowse(target: ReleaseTarget): Promise<number> {
    const key = targetMediaId(target)

    return mediaMutex.run(key, async () => {
      if (target.type === DownloadType.Movie) {
        const { radarrId, wasAdded } = await this.radarrService.ensureMovie(
          target.tmdbId,
          { monitored: false },
        )

        if (wasAdded) {
          this.mediaResolverService.invalidate(key)
          await this.awaitAddRefresh(
            key,
            () => this.radarrService.refreshMovie(radarrId, { isNew: true }),
            id => this.radarrService.getCommand(id),
          )
        }

        return radarrId
      }

      const { sonarrId, wasAdded } = await this.sonarrService.ensureSeries(
        target.tvdbId,
        { monitored: false },
      )

      if (wasAdded) {
        this.mediaResolverService.invalidate(key)
        await this.awaitAddRefresh(
          key,
          () => this.sonarrService.refreshSeries(sonarrId, { isNew: true }),
          id => this.sonarrService.getCommand(id),
        )
      }

      return sonarrId
    })
  }

  /**
   * Waits for the refresh Radarr/Sonarr queued when they added a title.
   *
   * `refresh` re-sends that refresh's exact body (`isNew: true`). The *arrs
   * de-dupe a command whose body matches one still queued or running, so
   * this hands back the add's own refresh rather than starting a second,
   * concurrent one.
   *
   * Best effort by design: a timeout, a refresh that ended badly, or a
   * failed read all log and return, and the listing goes ahead. A search on
   * thin metadata may find less; failing the listing would find nothing.
   */
  private async awaitAddRefresh(
    key: string,
    refresh: () => Promise<CommandRef>,
    getCommand: (id: number) => Promise<CommandSnapshot | null>,
  ): Promise<void> {
    try {
      const { id } = await refresh()
      const waited = await waitForCommand(getCommand, id, {
        intervalMs: BROWSE_REFRESH_POLL_MS,
        timeoutMs: BROWSE_REFRESH_WAIT_MS,
      })

      if (waited.outcome === 'timeout') {
        this.logger.warn(
          { action: 'listReleases', commandId: id, mediaId: key },
          `Refresh after adding the title was still running after ${BROWSE_REFRESH_WAIT_MS}ms - listing releases anyway`,
        )
      } else if (
        waited.outcome === 'ended' &&
        waited.command.status !== 'completed'
      ) {
        this.logger.warn(
          {
            action: 'listReleases',
            commandId: id,
            mediaId: key,
            message: waited.command.message,
            status: waited.command.status,
          },
          'Refresh after adding the title did not complete - listing releases anyway',
        )
      }
    } catch (err) {
      this.logger.warn(
        { action: 'listReleases', error: getErrorMessage(err), mediaId: key },
        'Could not wait for the refresh after adding the title - listing releases anyway',
      )
    }
  }

  /**
   * Guarantees the release the file on disk came from is in the list.
   *
   * This listing is a fresh ~30-second indexer search, and a release grabbed
   * months ago usually is not in today's search results - so without this the
   * current release simply has no row, and the report-this-file control that
   * hangs off that row is unreachable for exactly the files most likely to
   * need it. When the search *did* return it, nothing changes: the row is
   * already there and duplicating it would be worse than useless.
   *
   * Prepended, not appended - it is the row the user came for.
   */
  private async withCurrentRelease(
    mediaId: string,
    target: ReleaseTarget,
    upstreamId: number,
    scope: ReleaseScope,
    releases: Release[],
  ): Promise<Release[]> {
    const row = await this.resolveCurrentRelease(
      mediaId,
      target,
      upstreamId,
      scope,
    )

    if (!row || releases.some(release => release.guid === row.releaseGuid)) {
      return releases
    }

    return [toCurrentRelease(row), ...releases]
  }

  /**
   * The `media_file_releases` row behind whatever this listing is scoped to,
   * or `undefined` when there is no single such file.
   *
   * A season- or series-scoped show listing is that `undefined` case by
   * definition: the scope names many files, so there is no one "current
   * release" to pin to the top. Only an episode scope narrows to a single
   * file.
   *
   * `CurrentReleaseService` already swallows its own upstream failures, so
   * this catch covers the episode-file lookup - and either way a failure to
   * resolve is never fatal to the listing. The releases the indexer *did*
   * return are still the answer.
   */
  private async resolveCurrentRelease(
    mediaId: string,
    target: ReleaseTarget,
    upstreamId: number,
    scope: ReleaseScope,
  ): Promise<MediaFileReleaseRow | undefined> {
    try {
      if (target.type === DownloadType.Movie) {
        return await this.currentReleaseService.forMovie(mediaId, upstreamId)
      }

      if (scope.episodeId == null) {
        return undefined
      }

      // The same episode -> file resolution the replace path does, sharing
      // its handling of `episodeFileId: 0` ("no file", so an empty result).
      const {
        fileIds: [fileId],
      } = await resolveEpisodeFileIds(this.sonarrService, upstreamId, scope)

      if (fileId === undefined) {
        return undefined
      }

      const rows = await this.currentReleaseService.forEpisodeFiles(
        mediaId,
        upstreamId,
        [fileId],
      )

      return rows.get(fileId)
    } catch (err) {
      this.logger.warn(
        {
          action: 'listReleases',
          error: getErrorMessage(err),
          mediaId,
          scope,
        },
        'Current release lookup failed - listing only what the indexers returned',
      )

      return undefined
    }
  }

  /**
   * Downloads one specific release the user picked, tracked as an ordinary
   * `DownloadJob`.
   *
   * Two things distinguish it from `listReleases`:
   *
   * 1. **It turns monitoring on - after the grab succeeds.** A grab is a real
   *    choice, so the title (and, for shows, the grabbed episodes) ends up
   *    monitored and Radarr/Sonarr manage the import and future upgrades.
   *    Not before: the grab doesn't need it, and a grab that fails leaves
   *    monitoring exactly as it was.
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
   * Swaps what's on disk for a different release: grab the chosen one, then
   * delete the current file(s). One action, so the user isn't left to do the
   * second half by hand.
   *
   * **Grab first, delete after.** A grab that fails - the release is gone,
   * the indexer is down - deletes nothing, so the user keeps what they had
   * and the job fails as any grab does. Only a successful grab earns the
   * delete. A delete that then fails is logged and the job carries on: the
   * replacement is already downloading, and the worst case is an import
   * Radarr/Sonarr refuse as "not an upgrade" - a state the poller surfaces,
   * not one to fail a working download over.
   *
   * The delete uses the **per-file** endpoints, never `unmonitorAndDelete` -
   * that removes the whole movie/series, and the replacement release needs
   * somewhere to import to. Monitoring is handled exactly as `grabRelease`
   * does, and runs after the delete, so it also re-asserts what Radarr's /
   * Sonarr's "unmonitor deleted files" setting may just have turned off.
   * A downloaded-then-manually-unmonitored title comes out of a replace
   * monitored too.
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
      afterGrab: upstreamId =>
        this.deleteReplacedFiles(mediaId, target, upstreamId, {
          episodeId: input.episodeId,
          seasonNumber: input.seasonNumber,
        }),
      input,
      mediaId,
      requester,
      target,
    })
  }

  /**
   * Replace's delete step, run once the replacement is grabbed. Never
   * throws: a failure here is a warning, not a failed job - see
   * `replaceRelease`.
   *
   * Returns the episodes whose files it set out to delete, for the monitor
   * step to turn back on. That is wider than the scope when a multi-episode
   * file is involved: replacing E01 of `S01E01E02.mkv` takes E02's footage
   * too, and Sonarr's "unmonitor deleted episodes" setting would otherwise
   * leave E02 with neither a file nor monitoring. On a part-way failure it
   * still returns the whole resolved set - monitoring an episode whose file
   * survived only lets Radarr/Sonarr keep upgrading it.
   */
  private async deleteReplacedFiles(
    mediaId: string,
    target: ReleaseTarget,
    upstreamId: number,
    scope: ReleaseScope,
  ): Promise<number[]> {
    let episodeIds: number[] = []

    try {
      const resolved = await this.resolveExistingFiles(
        target,
        upstreamId,
        scope,
      )
      episodeIds = resolved.episodeIds

      await this.deleteExistingFiles(target, resolved.fileIds)

      this.logger.log(
        {
          action: 'replaceRelease',
          deleted: resolved.fileIds.length,
          mediaId,
          scope,
          upstreamId,
        },
        'Grabbed the replacement and deleted the existing files',
      )
    } catch (err) {
      this.logger.warn(
        {
          action: 'replaceRelease',
          error: getErrorMessage(err),
          mediaId,
          scope,
          upstreamId,
        },
        'Grabbed the replacement but could not delete the existing files - the import may be refused as not an upgrade',
      )
    } finally {
      // The library cache still holds the pre-delete entry, so drop it - the
      // next read of `filePath` must see the post-delete truth (or a partial
      // delete's), not a copy from up to a TTL window ago that this app
      // already knows is wrong.
      this.mediaResolverService.invalidate(mediaId)
    }

    return episodeIds
  }

  /**
   * The shared tail of `grabRelease` and `replaceRelease` - ensure the title,
   * hand the pick to Radarr/Sonarr, then monitor it, all wrapped in the
   * tracking job. `afterGrab` is replace's delete step, run between the grab
   * and the monitor step so it only happens once the grab succeeded, gets
   * the same resolved upstream id the grab used, and is followed by the
   * monitor write that re-asserts whatever the delete may have unmonitored.
   * The episode ids it returns are monitored alongside the grab's scope.
   *
   * The ensure and the monitor step each take `mediaMutex` for the title;
   * the grab and `afterGrab` run outside it. Neither touches the library
   * entry or its monitoring, so nothing a concurrent request or browse does
   * in between can change what they do - and a slow grab (Radarr pushing the
   * release to the download client) must not hold up a request for the
   * same title. A grab that misses Radarr/Sonarr's release cache is retried
   * once through a fresh listing - see `grabWithRelist`.
   *
   * Split out so the two paths can never diverge on the monitoring order or
   * on which choke point mints the job.
   */
  private async runGrab({
    action,
    afterGrab,
    input,
    mediaId,
    requester,
    target,
  }: {
    action: string
    afterGrab?: (upstreamId: number) => Promise<readonly number[]>
    input: GrabReleaseInput
    mediaId: string
    requester?: JobRequester | null
    target: ReleaseTarget
  }): Promise<DownloadJob> {
    const scope = showScopeFromInput(target, input)

    return this.mediaDownloadService.request({
      action,
      mediaId,
      requester,
      scope,
      submit: async () => {
        const upstreamId = await this.ensureForGrab(target)

        await this.grabWithRelist(action, target, upstreamId, input)

        const alsoMonitor = (await afterGrab?.(upstreamId)) ?? []

        await this.monitorAfterGrab(
          action,
          target,
          upstreamId,
          { episodeId: input.episodeId, seasonNumber: input.seasonNumber },
          alsoMonitor,
        )

        return scope ? { scope: await this.resolveScope(mediaId, scope) } : {}
      },
      type: target.type,
      upstreamId:
        target.type === DownloadType.Movie ? target.tmdbId : target.tvdbId,
    })
  }

  /**
   * Hands the picked release to Radarr/Sonarr, recovering once from an
   * expired release cache.
   *
   * `POST /release` doesn't search - it looks the pick up in the decisions
   * the last interactive search cached, keyed by guid + indexer, for 30
   * minutes. A picker left open longer than that, or an *arr restart in
   * between, makes the grab 404 even though the release may still be out
   * there. So a 404 re-runs the same listing the picker ran (which refills
   * the cache) and, if the pick is in it, grabs it once more.
   *
   * Exactly one relist and one retry: a 404 on the retry fails as any grab
   * failure does. Anything other than a 404 - a 409 indexer failure, a
   * network error - is not a cache miss and is rethrown untouched.
   *
   * Runs outside `mediaMutex`, like the grab itself: the relist is a full
   * indexer search, and holding the title's lock across it would stall a
   * request for the same title for no benefit.
   */
  private async grabWithRelist(
    action: string,
    target: ReleaseTarget,
    upstreamId: number,
    input: GrabReleaseInput,
  ): Promise<void> {
    const grab = () =>
      target.type === DownloadType.Movie
        ? this.radarrService.grabRelease(input.guid, input.indexerId)
        : this.sonarrService.grabRelease(input.guid, input.indexerId)

    try {
      await grab()
      return
    } catch (err) {
      if (!(err instanceof SdkHttpError) || err.status !== 404) {
        throw err
      }
    }

    const mediaId = targetMediaId(target)
    this.logger.warn(
      { action, guid: input.guid, indexerId: input.indexerId, mediaId },
      'Release is no longer in the release cache - searching again before retrying the grab',
    )

    if (!(await this.isStillListed(action, target, upstreamId, input))) {
      throw new Error(RELEASE_GONE_MESSAGE)
    }

    await grab()
  }

  /**
   * Whether the pick turns up again in a fresh listing of the same scope -
   * the raw indexer search, so the synthesized on-disk row `listReleases`
   * adds can't count as a match. Matched on guid + indexer id, the pair the
   * cache is keyed on.
   *
   * A relist that fails reads as "not listed": the grab already 404'd, and
   * "search again" is still the right next step for the user. So does a
   * show grab with no season or episode, which has no scoped listing to
   * repeat.
   */
  private async isStillListed(
    action: string,
    target: ReleaseTarget,
    upstreamId: number,
    input: GrabReleaseInput,
  ): Promise<boolean> {
    // An unscoped show grab has no listing to repeat - Sonarr's unscoped
    // release list is its RSS feed, not the search the pick came from.
    const showScope =
      target.type === DownloadType.Show
        ? toSonarrReleaseScope(input)
        : undefined

    if (target.type === DownloadType.Show && !showScope) {
      return false
    }

    try {
      const releases = showScope
        ? await this.sonarrService.getReleases(upstreamId, showScope)
        : await this.radarrService.getReleases(upstreamId)

      return releases.some(
        release =>
          release.guid === input.guid && release.indexerId === input.indexerId,
      )
    } catch (err) {
      this.logger.warn(
        {
          action,
          error: getErrorMessage(err),
          guid: input.guid,
          mediaId: targetMediaId(target),
        },
        'Could not search again after the release cache miss',
      )

      return false
    }
  }

  /**
   * The grab path's ensure: the same unmonitored add as a listing, but no
   * refresh wait. A grab re-finds its release in Radarr/Sonarr's cache of
   * the last search, so in practice the title was already added by the
   * listing the pick came from.
   */
  private ensureForGrab(target: ReleaseTarget): Promise<number> {
    const key = targetMediaId(target)

    return mediaMutex.run(key, async () => {
      const { upstreamId, wasAdded } =
        target.type === DownloadType.Movie
          ? await this.radarrService
              .ensureMovie(target.tmdbId, { monitored: false })
              .then(ensured => ({ ...ensured, upstreamId: ensured.radarrId }))
          : await this.sonarrService
              .ensureSeries(target.tvdbId, { monitored: false })
              .then(ensured => ({ ...ensured, upstreamId: ensured.sonarrId }))

      if (wasAdded) {
        this.mediaResolverService.invalidate(key)
      }

      return upstreamId
    })
  }

  /**
   * Turns monitoring on for what a successful grab covers, so Radarr/Sonarr
   * import it and manage upgrades from here on.
   *
   * - A movie: the movie.
   * - A show: the grabbed episodes, then the series. An episode scope is
   *   that episode; a season scope is that season's episodes; an unscoped
   *   grab is every episode **outside season 0** - a whole-series pick is
   *   not a request for the specials.
   * - Plus `alsoMonitor`: the episodes a replace deleted files for (see
   *   `deleteReplacedFiles`), so no episode it emptied is left unmonitored.
   *
   * Non-fatal: the release is already handed over by the time this runs,
   * and Radarr/Sonarr import a grabbed download whether or not the title is
   * monitored. Failing a successful grab over it would report an error for a
   * download that is going ahead anyway.
   */
  private async monitorAfterGrab(
    action: string,
    target: ReleaseTarget,
    upstreamId: number,
    scope: ReleaseScope,
    alsoMonitor: readonly number[] = [],
  ): Promise<void> {
    const key = targetMediaId(target)

    try {
      await mediaMutex.run(key, async () => {
        if (target.type === DownloadType.Movie) {
          await this.radarrService.editMovies([upstreamId], {
            monitored: true,
          })
          return
        }

        await this.monitorGrabbedEpisodes(upstreamId, scope, alsoMonitor)
        // Episodes first and the series flag last, so a monitored series
        // never points at still-unmonitored episodes this grab covers.
        await this.sonarrService.editSeries([upstreamId], { monitored: true })
      })
    } catch (err) {
      this.logger.warn(
        {
          action,
          error: getErrorMessage(err),
          mediaId: key,
          scope,
          upstreamId,
        },
        'Grabbed the release but could not turn monitoring on',
      )
    } finally {
      // Monitoring changed (or may have, part-way) - the cached copy's
      // `monitored` is stale either way.
      this.mediaResolverService.invalidate(key)
    }
  }

  /** `monitorAfterGrab`'s episode half - see there for what a scope covers. */
  private async monitorGrabbedEpisodes(
    sonarrId: number,
    scope: ReleaseScope,
    alsoMonitor: readonly number[],
  ): Promise<void> {
    const episodes = await this.sonarrService.getEpisodes(sonarrId, {
      seasonNumber: scope.seasonNumber,
    })
    const extra = new Set(alsoMonitor)

    // `!= null`, never truthiness - season 0 is Sonarr's specials. A season
    // scope is already narrowed upstream by `getEpisodes`. The episodes in
    // `alsoMonitor` share a file with one in scope, so they sit in the same
    // season and this read already covers them.
    const inScope = episodes.filter(
      episode =>
        (episode.id != null && extra.has(episode.id)) ||
        (scope.episodeId != null
          ? episode.id === scope.episodeId
          : scope.seasonNumber != null ||
            (episode.seasonNumber != null && episode.seasonNumber > 0)),
    )

    const toTurnOn = inScope
      .filter(episode => episode.id != null && episode.monitored !== true)
      .map(episode => episode.id as number)

    await this.sonarrService.setEpisodesMonitored(toTurnOn, true)
  }

  /**
   * Fills in a scope's display fields, falling back to the unresolved scope
   * if Sonarr can't answer.
   *
   * Deliberately non-fatal, and deliberately run *after* the grab: by this
   * point the release is already handed over, and the resolution only
   * enriches what the job renders ("S03E05" rather than "The Wire"). Failing
   * a successful grab because a metadata lookup didn't land would be the
   * wrong trade - the job keeps the scope it was minted with either way.
   */
  private async resolveScope(
    mediaId: string,
    scope: ShowScope,
  ): Promise<ShowScope> {
    try {
      return await this.sonarrService.resolveScope(scope)
    } catch (err) {
      this.logger.warn(
        { action: 'resolveScope', error: getErrorMessage(err), mediaId, scope },
        'Grabbed the release but could not resolve its episode numbering',
      )

      return scope
    }
  }

  /**
   * The files currently backing a title, scoped the same way the release
   * listing was, plus the episodes they back (always empty for a movie). A
   * multi-episode file resolves to one id, so it is deleted once however
   * many of its episodes the scope names.
   */
  private async resolveExistingFiles(
    target: ReleaseTarget,
    upstreamId: number,
    scope: ReleaseScope,
  ): Promise<ResolvedEpisodeFiles> {
    if (target.type === DownloadType.Movie) {
      const files = await this.radarrService.getMovieFiles(upstreamId)

      return {
        episodeIds: [],
        fileIds: files
          .map(file => file.id)
          .filter((id): id is number => id != null),
      }
    }

    // Which files a scope names is shared with `ShowService.deleteFiles` -
    // see `resolveEpisodeFileIds` for why that resolution is asymmetric
    // between an episode scope and a season/series one.
    return resolveEpisodeFileIds(this.sonarrService, upstreamId, scope)
  }

  /**
   * Deletes the files `resolveExistingFiles` named.
   *
   * Sequential rather than `Promise.all`: these are destructive calls against
   * a service that also has to rescan the folder afterwards, and a
   * half-succeeded parallel batch is much harder to reason about than a
   * half-finished sequential one.
   */
  private async deleteExistingFiles(
    target: ReleaseTarget,
    fileIds: readonly number[],
  ): Promise<void> {
    for (const id of fileIds) {
      await (target.type === DownloadType.Movie
        ? this.radarrService.deleteMovieFile(id)
        : this.sonarrService.deleteEpisodeFile(id))
    }
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
   *
   * The title is what Radarr/Sonarr get told to reject (see
   * `mirrorFlags()`), so a flag sent without one - or with the guid standing
   * in for one - takes the title of the file on disk from that release.
   */
  flagBadFile(
    mediaId: string,
    input: FlagBadFileInput,
    user: ForwardedUser,
  ): BadFile {
    const target = parseReleaseTarget(mediaId)
    const releaseTitle =
      usableReleaseTitle(input.title, input.guid) ??
      getReleaseTitleByGuid(this.dbService.db, mediaId, input.guid) ??
      input.title

    const row = insertBadFile(this.dbService.db, {
      flaggedByEmail: user.email,
      flaggedByUserId: user.userId,
      indexerId: input.indexerId,
      mediaId,
      mediaType: target.type,
      reason: input.reason,
      releaseGuid: input.guid,
      releaseTitle,
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

    this.mirrorFlags(target.type)

    return toBadFile(row)
  }

  /** Every flag recorded against a title, newest first. */
  listBadFiles(mediaId: string): BadFile[] {
    parseReleaseTarget(mediaId)

    return listBadFilesByMediaId(this.dbService.db, mediaId).map(toBadFile)
  }

  /**
   * Removes a flag so this app can pick that release again.
   *
   * `deleteBadFile` scopes the delete to `mediaId` itself, so a flag id that
   * exists but belongs to a different title 404s the same as one that
   * doesn't exist at all - the caller learns nothing beyond "no such flag
   * here" either way.
   */
  unflagBadFile(mediaId: string, flagId: number): BadFile {
    const target = parseReleaseTarget(mediaId)

    const row = deleteBadFile(this.dbService.db, mediaId, flagId)

    if (!row) {
      throw new NotFoundException(
        `No bad-file flag '${flagId}' exists for '${mediaId}'`,
      )
    }

    this.logger.log(
      { action: 'unflagBadFile', flagId, mediaId },
      'Removed a bad-file flag',
    )

    this.mirrorFlags(target.type)

    return toBadFile(row)
  }

  /**
   * Plan 024. Re-mirrors every flag of this type into Radarr's/Sonarr's
   * "flagged releases" release profile, after a flag or unflag has already
   * landed in the table. Started, not awaited: the flag is this app's
   * record and stands on its own, so a slow or down Radarr neither holds up
   * the response nor fails it - it's logged, and the next flag or boot syncs
   * the full list again.
   */
  private mirrorFlags(type: DownloadType): void {
    const isMovie = type === DownloadType.Movie
    const owner = isMovie ? this.radarrService : this.sonarrService
    const app = isMovie ? 'Radarr' : 'Sonarr'

    syncFlaggedReleases(this.dbService.db, type, owner, this.logger).catch(
      (error: unknown) => {
        this.logger.warn(
          `Could not mirror the flagged releases into ${app}; the next flag or restart retries: ${getErrorMessage(error)}`,
        )
      },
    )
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
}
