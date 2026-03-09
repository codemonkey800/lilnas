import {
  getApiV3QueueDetails as radarrGetQueueDetails,
  postApiV3Command as radarrPostCommand,
  type QueueResource as RadarrQueueItem,
} from '@lilnas/media/radarr-next'
import {
  deleteApiV3QueueById as sonarrDeleteQueueById,
  getApiV3QueueDetails as sonarrGetQueueDetails,
  postApiV3Command as sonarrPostCommand,
  putApiV3EpisodeMonitor,
  type QueueResource as SonarrQueueItem,
} from '@lilnas/media/sonarr'
import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'

import { getRadarrClient, getSonarrClient } from 'src/media/clients'
import {
  recordEpisodesNotFound,
  recordMovieNotFound,
} from 'src/media/search-results'

import { DownloadService } from './download.service'
import {
  computeProgress,
  DownloadEvents,
  type TrackedDownload,
  type TrackedEpisodeDownload,
  type TrackedMovieDownload,
} from './download.types'

const POLL_INTERVAL_MS = 3_000
const SEARCH_TIMEOUT_MS = 30_000

const FAILURE_STATES = new Set(['failed', 'failedPending', 'importFailed'])

/** Extracts the media-type discriminant and ID fields for event payloads from a tracked entry. */
function eventIdsFromEntry(entry: TrackedDownload) {
  if (entry.kind === 'movie') {
    return { mediaType: 'movie' as const, tmdbId: entry.tmdbId }
  }
  return {
    mediaType: 'episode' as const,
    tvdbId: entry.tvdbId,
    episodeId: entry.sonarrEpisodeId,
  }
}

function logLabel(entry: TrackedDownload): string {
  if (entry.kind === 'movie') return `Movie tmdbId=${entry.tmdbId}`
  return `Episode tvdbId=${entry.tvdbId} episodeId=${entry.sonarrEpisodeId}`
}

@Injectable()
export class DownloadPollerService {
  private readonly logger = new Logger(DownloadPollerService.name)

  constructor(private readonly downloadService: DownloadService) {}

  /**
   * Runs every {@link POLL_INTERVAL_MS}ms. Fetches current Radarr and Sonarr
   * queues and reconciles them against tracked downloads, emitting state
   * transition events (grabbing, progress, failed, completed) as needed.
   */
  @Interval(POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    const tracked = this.downloadService.getTracked()
    const pendingCancels = this.downloadService.getPendingCancelEpisodes()
    if (tracked.size === 0 && pendingCancels.size === 0) return

    try {
      const [radarrQueue, sonarrQueue] = await Promise.all([
        this.fetchRadarrQueue(),
        this.fetchSonarrQueue(),
      ])
      // Index queue items by their media ID for O(1) lookup
      const radarrByMovieId = new Map<number, RadarrQueueItem>()
      for (const item of radarrQueue) {
        if (item.movieId != null) radarrByMovieId.set(item.movieId, item)
      }

      const sonarrByEpisodeId = new Map<number, SonarrQueueItem>()
      for (const item of sonarrQueue) {
        if (item.episodeId != null) sonarrByEpisodeId.set(item.episodeId, item)
      }

      for (const [key, entry] of tracked) {
        const queueItem =
          entry.kind === 'movie'
            ? radarrByMovieId.get(entry.radarrMovieId)
            : sonarrByEpisodeId.get(entry.sonarrEpisodeId)
        this.processEntry(key, entry, queueItem)
      }

      await this.processPendingCancels(sonarrByEpisodeId)
    } catch (err) {
      this.logger.error(
        'Error during download poll',
        err instanceof Error ? err.stack : String(err),
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Per-entry processing
  // ---------------------------------------------------------------------------

  /**
   * Unified state machine for any tracked download. Transitions:
   * - No queue item + had queueId -> completed (import finished)
   * - No queue item + timed out -> failed (no releases found)
   * - First appearance in queue -> grabbing
   * - Queue item in failure state -> failed
   * - Otherwise -> progress update (only emitted when values change)
   */
  private processEntry(
    key: string,
    entry: TrackedDownload,
    queueItem: RadarrQueueItem | SonarrQueueItem | undefined,
  ): void {
    const ids = eventIdsFromEntry(entry)
    const label = logLabel(entry)

    if (!queueItem) {
      if (entry.queueId !== null) {
        this.downloadService.emitEvent({
          event: DownloadEvents.COMPLETED,
          ...ids,
        })
        this.downloadService.removeTracked(key)
        this.logger.log(`${label} download completed`)
      } else if (Date.now() - entry.initiatedAt > SEARCH_TIMEOUT_MS) {
        this.handleSearchTimeout(key, entry)
      }
      return
    }

    const queueId = queueItem.id ?? null

    // First appearance in queue
    if (entry.queueId === null && queueId !== null) {
      this.downloadService.updateTracked(key, {
        queueId,
        lastTitle: queueItem.title ?? null,
        lastSize: queueItem.size ?? null,
      })
      this.downloadService.emitEvent({
        event: DownloadEvents.GRABBING,
        ...ids,
        title: queueItem.title ?? null,
        size: queueItem.size ?? 0,
      })
      this.logger.log(`${label} release grabbed title="${queueItem.title}"`)
    }

    // Failure check
    if (this.isFailed(queueItem)) {
      this.downloadService.emitEvent({
        event: DownloadEvents.FAILED,
        ...ids,
        error:
          queueItem.errorMessage ??
          queueItem.trackedDownloadStatus ??
          'Download failed',
      })
      this.downloadService.removeTracked(key)
      this.logger.warn(`${label} download failed`)
      return
    }

    // Progress update
    const progress = computeProgress(queueItem.size, queueItem.sizeleft)
    if (
      progress !== null &&
      (progress !== entry.lastProgress ||
        (queueItem.sizeleft ?? null) !== entry.lastSizeleft)
    ) {
      this.downloadService.updateTracked(key, {
        lastProgress: progress,
        lastSizeleft: queueItem.sizeleft ?? null,
        lastStatus: queueItem.status ?? null,
        lastSize: queueItem.size ?? null,
        lastEta: queueItem.estimatedCompletionTime ?? null,
      })
      this.downloadService.emitEvent({
        event: DownloadEvents.PROGRESS,
        ...ids,
        progress,
        size: queueItem.size ?? 0,
        sizeleft: queueItem.sizeleft ?? 0,
        eta: queueItem.estimatedCompletionTime ?? null,
        status: queueItem.status ?? 'queued',
      })
    }
  }

  private handleSearchTimeout(key: string, entry: TrackedDownload): void {
    if (entry.kind === 'movie') {
      this.handleMovieSearchTimeout(key, entry)
    } else {
      this.handleEpisodeSearchTimeout(key, entry)
    }
  }

  private handleMovieSearchTimeout(
    key: string,
    entry: TrackedMovieDownload,
  ): void {
    this.downloadService.emitEvent({
      event: DownloadEvents.FAILED,
      mediaType: 'movie',
      tmdbId: entry.tmdbId,
      error: 'No releases found',
    })
    this.downloadService.removeTracked(key)
    this.logger.warn(
      `Movie search timed out (no releases) tmdbId=${entry.tmdbId}`,
    )

    void recordMovieNotFound(entry.tmdbId).catch(() => {})
  }

  private handleEpisodeSearchTimeout(
    key: string,
    entry: TrackedEpisodeDownload,
  ): void {
    this.downloadService.emitEvent({
      event: DownloadEvents.FAILED,
      mediaType: 'episode',
      tvdbId: entry.tvdbId,
      episodeId: entry.sonarrEpisodeId,
      error: 'No releases found',
    })
    this.downloadService.removeTracked(key)
    this.logger.warn(
      `Episode search timed out (no releases) tvdbId=${entry.tvdbId} episodeId=${entry.sonarrEpisodeId}`,
    )

    void recordEpisodesNotFound(entry.tvdbId, [
      {
        seasonNumber: entry.seasonNumber,
        episodeNumber: entry.episodeNumber,
      },
    ]).catch(() => {})
  }

  /**
   * Removes Sonarr queue items for episodes whose cancel was issued while
   * a search was still in-flight. Expires stale entries after SEARCH_TIMEOUT_MS.
   */
  private async processPendingCancels(
    sonarrByEpisodeId: Map<number, SonarrQueueItem>,
  ): Promise<void> {
    const pending = this.downloadService.getPendingCancelEpisodes()
    if (pending.size === 0) return

    const client = getSonarrClient()
    for (const [episodeId, meta] of pending) {
      const queueItem = sonarrByEpisodeId.get(episodeId)
      if (queueItem?.id != null) {
        try {
          await sonarrDeleteQueueById({
            client,
            path: { id: queueItem.id },
            query: { removeFromClient: true, blocklist: false },
          })
          await putApiV3EpisodeMonitor({
            client,
            body: { episodeIds: [episodeId], monitored: false },
          })
        } catch (err) {
          this.logger.warn(
            `Failed to cancel pending episode ${episodeId}`,
            err instanceof Error ? err.message : String(err),
          )
        }
        this.downloadService.removePendingCancel(episodeId)
        this.logger.log(
          `Cancelled late queue item for episode ${episodeId} tvdbId=${meta.tvdbId}`,
        )
      } else if (Date.now() - meta.cancelledAt > SEARCH_TIMEOUT_MS) {
        this.downloadService.removePendingCancel(episodeId)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Checks whether a queue item is in any recognized failure state. */
  private isFailed(item: RadarrQueueItem | SonarrQueueItem): boolean {
    return (
      FAILURE_STATES.has(item.trackedDownloadState ?? '') ||
      item.trackedDownloadStatus === 'error' ||
      item.status === 'failed'
    )
  }

  /** Tells Radarr to refresh its download client cache, then fetches the queue. */
  private async fetchRadarrQueue(): Promise<RadarrQueueItem[]> {
    const client = getRadarrClient()
    await radarrPostCommand({
      client,
      body: { name: 'RefreshMonitoredDownloads' } as Record<string, unknown>,
    })
    const result = await radarrGetQueueDetails({ client })
    return (result.data ?? []) as RadarrQueueItem[]
  }

  /** Tells Sonarr to refresh its download client cache, then fetches the queue. */
  private async fetchSonarrQueue(): Promise<SonarrQueueItem[]> {
    const client = getSonarrClient()
    await sonarrPostCommand({
      client,
      body: { name: 'RefreshMonitoredDownloads' } as Record<string, unknown>,
    })
    const result = await sonarrGetQueueDetails({ client })
    return (result.data ?? []) as SonarrQueueItem[]
  }
}
