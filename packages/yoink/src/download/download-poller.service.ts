import {
  getApiV3QueueDetails as radarrGetQueueDetails,
  type QueueResource as RadarrQueueItem,
} from '@lilnas/media/radarr-next'
import {
  getApiV3QueueDetails as sonarrGetQueueDetails,
  type QueueResource as SonarrQueueItem,
} from '@lilnas/media/sonarr'
import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'

import { getRadarrClient, getSonarrClient } from 'src/media/clients'

import { DownloadService } from './download.service'
import {
  DownloadEvents,
  type TrackedEpisodeDownload,
  type TrackedMovieDownload,
} from './download.types'

const POLL_INTERVAL_MS = 3_000

const FAILURE_STATES = new Set(['failed', 'failedPending', 'importFailed'])

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
    if (tracked.size === 0) return

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
        if (entry.kind === 'movie') {
          this.processMovieEntry(
            key,
            entry,
            radarrByMovieId.get(entry.radarrMovieId),
          )
        } else {
          this.processEpisodeEntry(
            key,
            entry,
            sonarrByEpisodeId.get(entry.sonarrEpisodeId),
          )
        }
      }
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
   * State machine for a tracked movie download. Transitions:
   * - No queue item + had queueId -> completed (import finished)
   * - First appearance in queue -> grabbing
   * - Queue item in failure state -> failed
   * - Otherwise -> progress update (only emitted when values change)
   */
  private processMovieEntry(
    key: string,
    entry: TrackedMovieDownload,
    queueItem: RadarrQueueItem | undefined,
  ): void {
    if (!queueItem) {
      if (entry.queueId !== null) {
        // Was in queue, now gone -> import completed
        this.downloadService.emitEvent({
          event: DownloadEvents.COMPLETED,
          mediaType: 'movie',
          tmdbId: entry.tmdbId,
        })
        this.downloadService.removeTracked(key)
        this.logger.log(`Movie download completed tmdbId=${entry.tmdbId}`)
      }
      return
    }

    const queueId = queueItem.id ?? null

    // First appearance in queue
    if (entry.queueId === null && queueId !== null) {
      this.downloadService.updateTracked(key, { queueId })
      this.downloadService.emitEvent({
        event: DownloadEvents.GRABBING,
        mediaType: 'movie',
        tmdbId: entry.tmdbId,
        title: queueItem.title ?? null,
        size: queueItem.size ?? 0,
      })
      this.logger.log(
        `Movie release grabbed tmdbId=${entry.tmdbId} title="${queueItem.title}"`,
      )
    }

    // Check for failure
    if (this.isFailed(queueItem)) {
      this.downloadService.emitEvent({
        event: DownloadEvents.FAILED,
        mediaType: 'movie',
        tmdbId: entry.tmdbId,
        error:
          queueItem.errorMessage ??
          queueItem.trackedDownloadStatus ??
          'Download failed',
      })
      this.downloadService.removeTracked(key)
      this.logger.warn(`Movie download failed tmdbId=${entry.tmdbId}`)
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
      })
      this.downloadService.emitEvent({
        event: DownloadEvents.PROGRESS,
        mediaType: 'movie',
        tmdbId: entry.tmdbId,
        progress,
        size: queueItem.size ?? 0,
        sizeleft: queueItem.sizeleft ?? 0,
        eta: queueItem.estimatedCompletionTime ?? null,
        status: queueItem.status ?? 'queued',
      })
    }
  }

  /** Same state machine as {@link processMovieEntry} but for Sonarr episodes. */
  private processEpisodeEntry(
    key: string,
    entry: TrackedEpisodeDownload,
    queueItem: SonarrQueueItem | undefined,
  ): void {
    if (!queueItem) {
      if (entry.queueId !== null) {
        this.downloadService.emitEvent({
          event: DownloadEvents.COMPLETED,
          mediaType: 'episode',
          tvdbId: entry.tvdbId,
          episodeId: entry.sonarrEpisodeId,
        })
        this.downloadService.removeTracked(key)
        this.logger.log(
          `Episode download completed tvdbId=${entry.tvdbId} episodeId=${entry.sonarrEpisodeId}`,
        )
      }
      return
    }

    const queueId = queueItem.id ?? null

    if (entry.queueId === null && queueId !== null) {
      this.downloadService.updateTracked(key, { queueId })
      this.downloadService.emitEvent({
        event: DownloadEvents.GRABBING,
        mediaType: 'episode',
        tvdbId: entry.tvdbId,
        episodeId: entry.sonarrEpisodeId,
        title: queueItem.title ?? null,
        size: queueItem.size ?? 0,
      })
      this.logger.log(
        `Episode release grabbed tvdbId=${entry.tvdbId} episodeId=${entry.sonarrEpisodeId} title="${queueItem.title}"`,
      )
    }

    if (this.isFailed(queueItem)) {
      this.downloadService.emitEvent({
        event: DownloadEvents.FAILED,
        mediaType: 'episode',
        tvdbId: entry.tvdbId,
        episodeId: entry.sonarrEpisodeId,
        error:
          queueItem.errorMessage ??
          queueItem.trackedDownloadStatus ??
          'Download failed',
      })
      this.downloadService.removeTracked(key)
      this.logger.warn(
        `Episode download failed tvdbId=${entry.tvdbId} episodeId=${entry.sonarrEpisodeId}`,
      )
      return
    }

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
      })
      this.downloadService.emitEvent({
        event: DownloadEvents.PROGRESS,
        mediaType: 'episode',
        tvdbId: entry.tvdbId,
        episodeId: entry.sonarrEpisodeId,
        progress,
        size: queueItem.size ?? 0,
        sizeleft: queueItem.sizeleft ?? 0,
        eta: queueItem.estimatedCompletionTime ?? null,
        status: queueItem.status ?? 'queued',
      })
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

  /** Fetches all items from the Radarr download queue. */
  private async fetchRadarrQueue(): Promise<RadarrQueueItem[]> {
    const client = getRadarrClient()
    const result = await radarrGetQueueDetails({ client })
    return (result.data ?? []) as RadarrQueueItem[]
  }

  /** Fetches all items from the Sonarr download queue. */
  private async fetchSonarrQueue(): Promise<SonarrQueueItem[]> {
    const client = getSonarrClient()
    const result = await sonarrGetQueueDetails({ client })
    return (result.data ?? []) as SonarrQueueItem[]
  }
}

/** Computes download completion as an integer percentage (0-100), or null if size data is unavailable. */
function computeProgress(
  size: number | undefined,
  sizeleft: number | undefined,
): number | null {
  if (size == null || sizeleft == null || size <= 0) return null
  return Math.round(((size - sizeleft) / size) * 100)
}
