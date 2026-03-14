import {
  getApiV3CommandById as radarrGetCommandById,
  getApiV3QueueDetails as radarrGetQueueDetails,
  postApiV3Command as radarrPostCommand,
  type QueueResource as RadarrQueueItem,
} from '@lilnas/media/radarr-next'
import {
  deleteApiV3QueueById as sonarrDeleteQueueById,
  getApiV3CommandById as sonarrGetCommandById,
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

import { DownloadGateway } from './download.gateway'
import { DownloadService } from './download.service'
import {
  computeProgress,
  DownloadEvents,
  type TrackedDownload,
  type TrackedEpisodeDownload,
  type TrackedMovieDownload,
} from './download.types'

const POLL_INTERVAL_MS = 3_000
const REFRESH_INTERVAL_MS = 15_000
const SEARCH_TIMEOUT_MS = 30_000

/**
 * How long to wait after a search command reaches a terminal state before
 * declaring "no releases found". Radarr/Sonarr may briefly lag between
 * marking a search complete and adding the grabbed release to the queue.
 */
const COMMAND_TERMINAL_GRACE_MS = 15_000

const FAILURE_STATES = new Set(['failed', 'failedPending', 'importFailed'])

/** Command statuses that indicate the search has finished (successfully or not). */
const TERMINAL_COMMAND_STATUSES = new Set([
  'completed',
  'failed',
  'aborted',
  'cancelled',
  'orphaned',
])

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

  /** Timestamp of the last RefreshMonitoredDownloads command sent to Radarr/Sonarr. */
  private lastRefreshAt = 0

  constructor(
    private readonly downloadService: DownloadService,
    private readonly downloadGateway: DownloadGateway,
  ) {}

  /**
   * Runs every {@link POLL_INTERVAL_MS}ms. Only proceeds when at least one
   * WebSocket client is connected, or there are pending cancels that need
   * processing regardless of UI presence.
   *
   * `RefreshMonitoredDownloads` is throttled to once per {@link REFRESH_INTERVAL_MS}
   * to avoid hammering Radarr/Sonarr on every 3s tick.
   */
  @Interval(POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    const tracked = this.downloadService.getTracked()
    const pendingCancels = this.downloadService.getPendingCancelEpisodes()

    // Skip entirely when nothing to do and no clients are watching.
    if (
      tracked.size === 0 &&
      pendingCancels.size === 0 &&
      !this.downloadGateway.hasConnectedClients()
    ) {
      return
    }

    // If there are tracked downloads but no connected clients, we still need
    // to advance state (e.g. detect completion), but skip when truly idle.
    if (tracked.size === 0 && pendingCancels.size === 0) return

    try {
      const shouldRefresh =
        Date.now() - this.lastRefreshAt >= REFRESH_INTERVAL_MS
      if (shouldRefresh) this.lastRefreshAt = Date.now()

      const [radarrQueue, sonarrQueue] = await Promise.all([
        this.fetchRadarrQueue(shouldRefresh),
        this.fetchSonarrQueue(shouldRefresh),
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

      // Collect command IDs that need status checks (still searching, no queue item)
      const radarrCommandIds = new Set<number>()
      const sonarrCommandIds = new Set<number>()
      for (const entry of tracked.values()) {
        if (entry.commandId == null || entry.queueId !== null) continue
        const hasQueueItem =
          entry.kind === 'movie'
            ? radarrByMovieId.has(entry.radarrMovieId)
            : sonarrByEpisodeId.has(entry.sonarrEpisodeId)
        if (!hasQueueItem) {
          if (entry.kind === 'movie') {
            radarrCommandIds.add(entry.commandId)
          } else {
            sonarrCommandIds.add(entry.commandId)
          }
        }
      }

      // Fetch command statuses in parallel
      const [radarrCommandStatuses, sonarrCommandStatuses] = await Promise.all([
        this.fetchRadarrCommandStatuses(radarrCommandIds),
        this.fetchSonarrCommandStatuses(sonarrCommandIds),
      ])

      for (const [key, entry] of tracked) {
        const queueItem =
          entry.kind === 'movie'
            ? radarrByMovieId.get(entry.radarrMovieId)
            : sonarrByEpisodeId.get(entry.sonarrEpisodeId)
        this.processEntry(
          key,
          entry,
          queueItem,
          radarrCommandStatuses,
          sonarrCommandStatuses,
        )
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
   * - No queue item + commandId terminal -> failed (no releases found)
   * - No queue item + no commandId + timed out -> failed (fallback for direct grabs)
   * - First appearance in queue -> grabbing
   * - Queue item in failure state -> failed
   * - Otherwise -> progress update (only emitted when values change)
   */
  private processEntry(
    key: string,
    entry: TrackedDownload,
    queueItem: RadarrQueueItem | SonarrQueueItem | undefined,
    radarrCommandStatuses: Map<number, string>,
    sonarrCommandStatuses: Map<number, string>,
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
      } else if (entry.commandId != null) {
        const statuses =
          entry.kind === 'movie' ? radarrCommandStatuses : sonarrCommandStatuses
        const commandStatus = statuses.get(entry.commandId)
        if (commandStatus && TERMINAL_COMMAND_STATUSES.has(commandStatus)) {
          if (entry.commandTerminalAt == null) {
            // First poll where we see a terminal command with no queue item.
            // Record the timestamp and wait — Radarr/Sonarr may lag before the
            // grabbed release appears in the queue.
            this.downloadService.updateTracked(key, {
              commandTerminalAt: Date.now(),
            })
          } else if (
            Date.now() - entry.commandTerminalAt >=
            COMMAND_TERMINAL_GRACE_MS
          ) {
            // Grace period has elapsed with still no queue item — truly no releases.
            this.handleSearchNotFound(key, entry)
          }
          // else: still within grace period — wait for next poll
        }
        // else: still searching or status fetch failed — wait for next poll
      } else if (Date.now() - entry.initiatedAt > SEARCH_TIMEOUT_MS) {
        // Fallback for direct grabs (postApiV3Release) which have no commandId
        this.handleSearchNotFound(key, entry)
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

  private handleSearchNotFound(key: string, entry: TrackedDownload): void {
    if (entry.kind === 'movie') {
      this.handleMovieSearchNotFound(key, entry)
    } else {
      this.handleEpisodeSearchNotFound(key, entry)
    }
  }

  private handleMovieSearchNotFound(
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
    this.logger.warn(`Movie search found no releases tmdbId=${entry.tmdbId}`)

    void recordMovieNotFound(entry.tmdbId).catch(() => {})
  }

  private handleEpisodeSearchNotFound(
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
      `Episode search found no releases tvdbId=${entry.tvdbId} episodeId=${entry.sonarrEpisodeId}`,
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

  /**
   * Fetches the status string for each Radarr command ID.
   * Uses `Promise.allSettled` so a single failed lookup does not block others.
   * Returns a map of commandId -> status string; missing entries mean the fetch failed.
   */
  private async fetchRadarrCommandStatuses(
    commandIds: Set<number>,
  ): Promise<Map<number, string>> {
    if (commandIds.size === 0) return new Map()
    const client = getRadarrClient()
    const results = await Promise.allSettled(
      Array.from(commandIds).map(async id => {
        const result = await radarrGetCommandById({ client, path: { id } })
        const status = (result.data as { status?: string } | null)?.status
        return { id, status }
      }),
    )
    return this.buildStatusMap(results)
  }

  /**
   * Fetches the status string for each Sonarr command ID.
   * Uses `Promise.allSettled` so a single failed lookup does not block others.
   * Returns a map of commandId -> status string; missing entries mean the fetch failed.
   */
  private async fetchSonarrCommandStatuses(
    commandIds: Set<number>,
  ): Promise<Map<number, string>> {
    if (commandIds.size === 0) return new Map()
    const client = getSonarrClient()
    const results = await Promise.allSettled(
      Array.from(commandIds).map(async id => {
        const result = await sonarrGetCommandById({ client, path: { id } })
        const status = (result.data as { status?: string } | null)?.status
        return { id, status }
      }),
    )
    return this.buildStatusMap(results)
  }

  private buildStatusMap(
    results: PromiseSettledResult<{ id: number; status: string | undefined }>[],
  ): Map<number, string> {
    const statuses = new Map<number, string>()
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.status) {
        statuses.set(result.value.id, result.value.status)
      }
    }
    return statuses
  }

  /** Checks whether a queue item is in any recognized failure state. */
  private isFailed(item: RadarrQueueItem | SonarrQueueItem): boolean {
    return (
      FAILURE_STATES.has(item.trackedDownloadState ?? '') ||
      item.trackedDownloadStatus === 'error' ||
      item.status === 'failed'
    )
  }

  /**
   * Optionally triggers RefreshMonitoredDownloads, then fetches the Radarr queue.
   * The caller determines whether to refresh based on the shared {@link lastRefreshAt} timestamp.
   */
  private async fetchRadarrQueue(refresh: boolean): Promise<RadarrQueueItem[]> {
    const client = getRadarrClient()
    if (refresh) {
      await radarrPostCommand({
        client,
        body: { name: 'RefreshMonitoredDownloads' } as Record<string, unknown>,
      })
    }
    const result = await radarrGetQueueDetails({ client })
    return (result.data ?? []) as RadarrQueueItem[]
  }

  /**
   * Optionally triggers RefreshMonitoredDownloads, then fetches the Sonarr queue.
   * The caller determines whether to refresh based on the shared {@link lastRefreshAt} timestamp.
   */
  private async fetchSonarrQueue(refresh: boolean): Promise<SonarrQueueItem[]> {
    const client = getSonarrClient()
    if (refresh) {
      await sonarrPostCommand({
        client,
        body: { name: 'RefreshMonitoredDownloads' } as Record<string, unknown>,
      })
    }
    const result = await sonarrGetQueueDetails({ client })
    return (result.data ?? []) as SonarrQueueItem[]
  }
}
