import {
  type DiscardImportResponse,
  DownloadJobStatus,
  DownloadType,
  type ImportFilesInput,
  type ImportFilesResponse,
  isManagedMedia,
  isMovie,
  type ManualImportCandidate,
  type Media,
  type ShowScope,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'

import { mediaTypeFromKey } from 'src/db/media-id'
import { DownloadStateService } from 'src/download/download-state.service'

import {
  type RadarrManualImportResource,
  type SonarrManualImportResource,
  toMovieCandidate,
  toShowCandidate,
} from './manual-import-mapper.util'
import { MediaResolverService } from './media-resolver.service'
import { matchesScope, type PollableQueueItem } from './queue-status.util'
import { type RadarrManualImportFile, RadarrService } from './radarr.service'
import { type SonarrManualImportFile, SonarrService } from './sonarr.service'

/** The two media types that can have a stuck import - a video has no queue. */
type ImportableType = DownloadType.Movie | DownloadType.Show

/** A mapped candidate kept next to the upstream resource it came from. */
interface CandidateEntry<TResource> {
  candidate: ManualImportCandidate
  resource: TResource
}

/**
 * What a media id plus a scope resolves to before any candidate is fetched:
 * the upstream library id, the queue rows in scope, and the title to fall
 * back on when upstream echoes none.
 */
interface ResolvedTarget {
  items: PollableQueueItem[]
  title: string
  type: ImportableType
  upstreamId: number
}

/**
 * A listing plus the raw resources behind it. `candidates` is the flat wire
 * list (and the only thing path validation needs); `entries` keeps each
 * candidate paired with the **upstream** resource, because that - never the
 * browser's copy - is what the `ManualImport` command is built from.
 *
 * Spelled as an intersection with a two-arm union rather than two whole
 * shapes so `collected.type` narrows `entries` while `candidates`/`items`
 * stay readable without narrowing at all.
 */
type CollectedCandidates = {
  candidates: ManualImportCandidate[]
  items: PollableQueueItem[]
  upstreamId: number
} & (
  | {
      entries: CandidateEntry<RadarrManualImportResource>[]
      type: DownloadType.Movie
    }
  | {
      entries: CandidateEntry<SonarrManualImportResource>[]
      type: DownloadType.Show
    }
)

/**
 * A resolved `Media`'s Radarr/Sonarr id.
 *
 * A deliberate copy of the same one-liner in media-poller.service.ts rather
 * than an import from it: this service has nothing else to do with the
 * poller, and three lines are cheaper to duplicate than a dependency from
 * the importer onto the polling loop.
 */
function upstreamLibraryId(media: Media | undefined): number | undefined {
  if (!media || !isManagedMedia(media)) return undefined
  return isMovie(media) ? media.radarrId : media.sonarrId
}

/** The `ShowScope` an import body implies, or `undefined` for an unscoped one. */
function scopeFromInput(input: ImportFilesInput): ShowScope | undefined {
  if (input.episodeId == null && input.seasonNumber == null) return undefined

  return {
    ...(input.episodeId != null ? { episodeId: input.episodeId } : {}),
    ...(input.seasonNumber != null ? { seasonNumber: input.seasonNumber } : {}),
  }
}

/**
 * Whether a job's own scope is answered by an import/discard made at
 * `requestScope`.
 *
 * Deliberately *not* `matchesScope` (which asks the opposite question, of a
 * queue item): a job is what gets moved to `Importing`/`Cancelled`, and a
 * job can be broader than the request that resolves it.
 *
 * - An unscoped job covers the whole series, so anything imported for that
 *   series moves it.
 * - A season job covers its season - but only for a season-level or unscoped
 *   request. An episode-level request cannot move it: the season may still
 *   have other episodes waiting, and calling the season done because one
 *   episode imported would be a lie the poller then has to undo.
 * - An episode job covers only its own episode, so only a request naming
 *   that exact episode moves it.
 */
export function jobScopeCovers(
  jobScope: ShowScope | undefined,
  requestScope: ShowScope | undefined,
): boolean {
  if (!jobScope) return true
  if (jobScope.episodeId == null && jobScope.seasonNumber == null) return true

  if (jobScope.episodeId != null) {
    return requestScope?.episodeId === jobScope.episodeId
  }

  if (requestScope?.episodeId != null) return false
  if (requestScope?.seasonNumber == null) return true

  return requestScope.seasonNumber === jobScope.seasonNumber
}

/**
 * The in-app manual importer (plan 020): what Radarr's and Sonarr's own
 * manual-import dialogs do, for a download that finished and was never
 * imported - the `NeedsAttention` state.
 *
 * Keyed on **media plus scope**, never on a job id. The candidate list
 * belongs to a title's download, not to a job, and one title can have
 * several jobs pointed at the same queue item (a series job and an episode
 * job). Answering per media answers all of them at once.
 *
 * Nothing about the download client is persisted. The `downloadId` a
 * candidate list is fetched by lives on the queue item and is re-read from
 * the queue on every call: a column would be a second copy of transient
 * upstream state that goes stale the moment Radarr/Sonarr re-queues.
 *
 * The client names files by `path` and nothing else. Every other field the
 * `ManualImport` command carries - quality, languages, release group,
 * indexer flags, folder name, `downloadId` - is rebuilt here from a **fresh**
 * candidate list, which is the same trust boundary `GrabReleaseInputSchema`
 * draws with `guid`.
 */
@Injectable()
export class ManualImportService {
  private readonly logger = new Logger(ManualImportService.name)

  // `DownloadStateService` arrives across the DownloadModule <-> MediaModule
  // forwardRef, exactly as it does for ShowService and MediaPollerService -
  // see media.module.ts for why that cycle exists.
  constructor(
    private readonly downloadStateService: DownloadStateService,
    private readonly mediaResolverService: MediaResolverService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  /**
   * Every file upstream is offering for the title's stuck download(s), in
   * scope, flattened into one list.
   *
   * An empty list is a legitimate answer - the import may have gone through
   * between the poller's last tick and this call - so it is never an error
   * here. Only `importFiles` cares that there is nothing to work on.
   */
  async listCandidates(
    mediaId: string,
    scope: ShowScope | undefined,
  ): Promise<ManualImportCandidate[]> {
    const collected = await this.collect(mediaId, scope)

    this.logger.log(
      {
        action: 'listCandidates',
        candidates: collected.candidates.length,
        mediaId,
        queueItems: collected.items.length,
        scope,
      },
      'Listed manual-import candidates',
    )

    return collected.candidates
  }

  /**
   * Commits the named files through upstream's `ManualImport` command.
   *
   * The listing is re-run first, and the command is built from *its*
   * resources: the browser supplies paths, the server supplies everything
   * else. A path that is no longer on offer, or that is on offer but not
   * importable, is a 400 rather than a silently-dropped file.
   *
   * The command is fire-and-forget at upstream's end - it queues - so
   * `importedCount` is how many files were **submitted**, not how many
   * landed. The jobs move to `Importing` rather than `Completed` for the
   * same reason: the poller's existing "no queue entry while
   * Downloading/Importing/NeedsAttention -> Completed" branch finishes them
   * a tick or two after upstream drops the row, and if the import fails at
   * upstream's end the row stays with a new warning and the poller puts the
   * job straight back to `NeedsAttention` with the new sentence.
   */
  async importFiles(
    mediaId: string,
    input: ImportFilesInput,
  ): Promise<ImportFilesResponse> {
    const action = 'importFiles'
    const scope = scopeFromInput(input)
    const collected = await this.collect(mediaId, scope)

    if (collected.items.length === 0) {
      throw new NotFoundException(
        `Nothing is waiting to be imported for '${mediaId}'`,
      )
    }

    // De-duplicated because the command is keyed on path: the same path twice
    // would be two identical files in one command, which upstream would
    // happily try to import twice.
    const paths = Array.from(new Set(input.paths))
    const byPath = new Map(
      collected.candidates.map(candidate => [candidate.path, candidate]),
    )

    const unknown = paths.filter(path => !byPath.has(path))
    if (unknown.length > 0) {
      throw new BadRequestException(
        `These files are not waiting to be imported for '${mediaId}': ${unknown.join(', ')}`,
      )
    }

    const blocked = paths.filter(path => byPath.get(path)?.importable === false)
    if (blocked.length > 0) {
      throw new BadRequestException(
        `These files can't be imported from here: ${blocked.join(', ')}`,
      )
    }

    const wanted = new Set(paths)
    let importedCount: number

    // One command per upstream, carrying every file: upstream processes a
    // ManualImport command as a unit, and one call per file would be N
    // independent commands racing over the same folder.
    if (collected.type === DownloadType.Movie) {
      const files: RadarrManualImportFile[] = collected.entries
        .filter(entry => wanted.has(entry.candidate.path))
        .map(({ candidate, resource }) => ({
          downloadId: resource.downloadId,
          folderName: resource.folderName,
          indexerFlags: resource.indexerFlags,
          languages: resource.languages,
          movieId: collected.upstreamId,
          path: candidate.path,
          quality: resource.quality,
          releaseGroup: resource.releaseGroup,
        }))

      await this.radarrService.commitManualImport(files)
      importedCount = files.length
    } else {
      const files: SonarrManualImportFile[] = collected.entries
        .filter(entry => wanted.has(entry.candidate.path))
        .map(({ candidate, resource }) => ({
          downloadId: resource.downloadId,
          episodeFileId: resource.episodeFileId,
          // Non-empty by construction: a candidate with no episodes is not
          // importable, and an un-importable path was rejected above.
          episodeIds: (candidate.episodes ?? []).map(episode => episode.id),
          folderName: resource.folderName,
          indexerFlags: resource.indexerFlags,
          languages: resource.languages,
          path: candidate.path,
          quality: resource.quality,
          releaseGroup: resource.releaseGroup,
          releaseType: resource.releaseType ?? 'unknown',
          seriesId: collected.upstreamId,
        }))

      await this.sonarrService.commitManualImport(files)
      importedCount = files.length
    }

    this.logger.log(
      { action, importedCount, mediaId, paths, scope },
      'Submitted a manual import',
    )

    this.moveJobs(mediaId, scope, DownloadJobStatus.Importing, action)

    // The library entry's `filePath` is about to change - a cached "no file"
    // would otherwise outlive the import by up to the resolver's TTL.
    this.mediaResolverService.invalidate(mediaId)

    return { importedCount }
  }

  /**
   * The give-up path: drops every queue row in scope, download-client files
   * included, and cancels the jobs waiting on them.
   *
   * Deliberately **not** a retry. The bytes are already on disk, so a retry
   * would re-search and re-grab a file that is sitting right there. Nor does
   * it blocklist: the release was fine - the folder name was the problem -
   * and blocklisting it would stop upstream picking the same release next
   * time.
   *
   * Discarding zero items is a success, not a 404, for the reason
   * `DeleteMediaFilesResponse` gives: the caller asked for a state, and that
   * state already held. Only a removal that was attempted and failed for
   * *every* item is an error.
   */
  async discard(
    mediaId: string,
    scope: ShowScope | undefined,
  ): Promise<DiscardImportResponse> {
    const action = 'discard'
    const target = await this.resolveTarget(mediaId, scope)

    const removable = target.items.filter(
      (item): item is PollableQueueItem & { id: number } => item.id != null,
    )

    if (removable.length !== target.items.length) {
      this.logger.warn(
        { action, mediaId, scope },
        'Skipped a queue item with no id - there is no row to remove',
      )
    }

    let discardedCount = 0

    if (removable.length > 0) {
      const removals = await Promise.allSettled(
        removable.map(item =>
          target.type === DownloadType.Movie
            ? this.radarrService.removeQueueItem(item.id)
            : this.sonarrService.removeQueueItem(item.id),
        ),
      )

      for (const [index, result] of removals.entries()) {
        if (result.status === 'fulfilled') {
          discardedCount += 1
          continue
        }

        this.logger.warn(
          {
            action,
            error: getErrorMessage(result.reason),
            mediaId,
            queueId: removable[index]?.id,
          },
          'Failed to discard a stuck queue item',
        )
      }

      if (discardedCount === 0) {
        throw new ServiceUnavailableException(
          `Couldn't discard the stuck download for '${mediaId}' - try again shortly`,
        )
      }
    }

    this.logger.log(
      { action, discardedCount, mediaId, scope },
      'Discarded stuck queue items',
    )

    // A poller tick landing between the removal above and this write can
    // briefly stamp the job `Completed` (its "queue row gone while
    // NeedsAttention" branch), completedAt included. The `Cancelled` write
    // below simply wins, and the stamp is harmless - not a race worth a lock.
    this.moveJobs(mediaId, scope, DownloadJobStatus.Cancelled, action)
    this.mediaResolverService.invalidate(mediaId)

    return { discardedCount }
  }

  /**
   * The listing every public method starts from, mapped **and** raw.
   *
   * One `getManualImportCandidates` call per distinct `downloadId` in scope,
   * concatenated: two blocked episodes of one season are two queue items,
   * two candidate lists and - later - one command carrying both files.
   */
  private async collect(
    mediaId: string,
    scope: ShowScope | undefined,
  ): Promise<CollectedCandidates> {
    const target = await this.resolveTarget(mediaId, scope)
    const downloadIds = this.downloadIdsOf(mediaId, target.items)

    if (target.type === DownloadType.Movie) {
      const entries: CandidateEntry<RadarrManualImportResource>[] = []

      for (const downloadId of downloadIds) {
        const resources = await this.radarrService.getManualImportCandidates(
          downloadId,
          target.upstreamId,
        )

        for (const resource of resources) {
          const candidate = toMovieCandidate(resource, target.title)

          if (!candidate) {
            this.warnUnaddressable(mediaId, downloadId)
            continue
          }

          entries.push({ candidate, resource })
        }
      }

      return {
        candidates: entries.map(entry => entry.candidate),
        entries,
        items: target.items,
        type: DownloadType.Movie,
        upstreamId: target.upstreamId,
      }
    }

    const entries: CandidateEntry<SonarrManualImportResource>[] = []

    for (const downloadId of downloadIds) {
      const resources = await this.sonarrService.getManualImportCandidates(
        downloadId,
        target.upstreamId,
        scope?.seasonNumber,
      )

      for (const resource of resources) {
        const candidate = toShowCandidate(resource, scope)

        if (!candidate) {
          this.warnUnaddressable(mediaId, downloadId)
          continue
        }

        entries.push({ candidate, resource })
      }
    }

    return {
      candidates: entries.map(entry => entry.candidate),
      entries,
      items: target.items,
      type: DownloadType.Show,
      upstreamId: target.upstreamId,
    }
  }

  /**
   * `mediaId` + scope -> the upstream id and the queue rows in scope.
   *
   * The scope checks happen before anything upstream is touched: a season or
   * an episode on a movie key is malformed regardless of what the library
   * holds, exactly as `DELETE /media/:id/files` treats it.
   */
  private async resolveTarget(
    mediaId: string,
    scope: ShowScope | undefined,
  ): Promise<ResolvedTarget> {
    const type = mediaTypeFromKey(mediaId)

    if (type !== DownloadType.Movie && type !== DownloadType.Show) {
      throw new NotFoundException(
        `Manual imports are only available for movies and shows, not '${mediaId}'`,
      )
    }

    if (
      type === DownloadType.Movie &&
      (scope?.episodeId != null || scope?.seasonNumber != null)
    ) {
      throw new BadRequestException(
        `'${mediaId}' is a movie - it has no seasons or episodes to scope an import to`,
      )
    }

    const { media } = await this.mediaResolverService.resolve([
      { mediaId, type },
    ])
    const resolved = media.get(mediaId)
    const upstreamId = upstreamLibraryId(resolved)

    if (upstreamId == null) {
      throw new NotFoundException(`Media '${mediaId}' is not in the library`)
    }

    return {
      items: await this.queueItems(type, upstreamId, scope),
      title: resolved?.title ?? mediaId,
      type,
      upstreamId,
    }
  }

  /**
   * The queue rows belonging to this title, narrowed to the request's scope.
   *
   * The `movieId`/`seriesId` re-check is not redundant with the query
   * parameter: upstream treats the id list as a hint, and a queue read that
   * came back unfiltered would otherwise let another title's stuck download
   * be imported or discarded under this media id.
   */
  private async queueItems(
    type: ImportableType,
    upstreamId: number,
    scope: ShowScope | undefined,
  ): Promise<PollableQueueItem[]> {
    if (type === DownloadType.Movie) {
      const queue = await this.radarrService.getQueue([upstreamId])
      return queue.filter(item => item.movieId === upstreamId)
    }

    const queue = await this.sonarrService.getQueue([upstreamId])
    return queue.filter(
      item => item.seriesId === upstreamId && matchesScope(item, scope),
    )
  }

  /**
   * The distinct download-client ids across the matched queue rows, in the
   * order upstream reported them.
   *
   * Distinct because Sonarr queues one row *per episode*: a season pack is
   * several rows sharing one `downloadId`, and asking for its candidates
   * once per row would list every file N times. An item with no
   * `downloadId` is skipped and logged - there is nothing to ask upstream
   * about.
   */
  private downloadIdsOf(mediaId: string, items: PollableQueueItem[]): string[] {
    const downloadIds: string[] = []

    for (const item of items) {
      if (!item.downloadId) {
        this.logger.warn(
          { action: 'collect', mediaId, queueId: item.id },
          'Queue item has no downloadId - cannot ask for its import candidates',
        )
        continue
      }

      if (!downloadIds.includes(item.downloadId)) {
        downloadIds.push(item.downloadId)
      }
    }

    return downloadIds
  }

  private warnUnaddressable(mediaId: string, downloadId: string): void {
    this.logger.warn(
      { action: 'collect', downloadId, mediaId },
      'Skipped a manual-import candidate with no path - it cannot be addressed',
    )
  }

  /**
   * Moves every `NeedsAttention` job of this title that the request answers
   * into `status`, clearing the reason it was carrying.
   *
   * `{ error: undefined }` is load-bearing and must be explicit: `updateJob`
   * spreads the patch over the record and never touches `error` on its own,
   * and `buildJobRow` writes `record.error ?? null` - so without it a job
   * would carry "was not found in the grabbed release" into its history
   * forever, long after the import that fixed it.
   *
   * Iterates the live Map rather than the `jobs` table for the reason
   * `ShowService.cancelInFlightJobs` gives: those are exactly the records
   * `updateJob` can write, and it throws on anything else. Best-effort per
   * record - the upstream call has already happened by the time this runs,
   * so a failed write is a logged inconsistency, never a failed import.
   */
  private moveJobs(
    mediaId: string,
    scope: ShowScope | undefined,
    status: DownloadJobStatus,
    action: string,
  ): string[] {
    const moved: string[] = []

    for (const record of this.downloadStateService.jobs.values()) {
      if (record.mediaId !== mediaId) continue
      if (record.status !== DownloadJobStatus.NeedsAttention) continue
      if (
        record.type === DownloadType.Show &&
        !jobScopeCovers(record.scope, scope)
      ) {
        continue
      }

      try {
        this.downloadStateService.updateJob(record.id, {
          error: undefined,
          status,
        })
        moved.push(record.id)
      } catch (err) {
        this.logger.warn(
          {
            action,
            error: getErrorMessage(err),
            jobId: record.id,
            mediaId,
          },
          'Failed to move a stuck job out of NeedsAttention',
        )
      }
    }

    this.logger.log(
      { action, jobIds: moved, mediaId, scope, status },
      'Moved stuck jobs',
    )

    return moved
  }
}
