import { Injectable } from '@nestjs/common'
import { Counter, Gauge, Histogram, register } from 'prom-client'

type MediaType = 'movie' | 'episode'
type DownloadScope = 'movie' | 'episode' | 'season' | 'series'
type DownloadStatus = 'completed' | 'failed' | 'cancelled' | 'not_found'
type LibraryOperation = 'add' | 'remove'
type LibraryMediaType = 'movie' | 'show'
type SearchType = 'library' | 'release'
type ExternalService = 'radarr' | 'sonarr'
type AuthMethod = 'google' | 'agent'
type AuthStatus = 'success' | 'failure'

const downloadsInitiatedTotal = new Counter({
  name: 'yoink_downloads_initiated_total',
  help: 'Total number of downloads initiated',
  labelNames: ['media_type', 'scope'],
  registers: [register],
})

const downloadsCompletedTotal = new Counter({
  name: 'yoink_downloads_completed_total',
  help: 'Total number of downloads that reached a terminal state',
  labelNames: ['media_type', 'status'],
  registers: [register],
})

const downloadsActive = new Gauge({
  name: 'yoink_downloads_active',
  help: 'Number of downloads currently being tracked',
  registers: [register],
})

const pendingCancels = new Gauge({
  name: 'yoink_pending_cancels',
  help: 'Number of episodes awaiting deferred cancellation',
  registers: [register],
})

const libraryOperationsTotal = new Counter({
  name: 'yoink_library_operations_total',
  help: 'Total number of library add/remove operations',
  labelNames: ['operation', 'media_type'],
  registers: [register],
})

const searchesTotal = new Counter({
  name: 'yoink_searches_total',
  help: 'Total number of search requests by type',
  labelNames: ['type'],
  registers: [register],
})

const externalApiErrorsTotal = new Counter({
  name: 'yoink_external_api_errors_total',
  help: 'Total number of errors from external API calls',
  labelNames: ['service'],
  registers: [register],
})

const pollDurationSeconds = new Histogram({
  name: 'yoink_poll_duration_seconds',
  help: 'Duration of each download poller tick',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
})

const pollErrorsTotal = new Counter({
  name: 'yoink_poll_errors_total',
  help: 'Total number of errors during download polling',
  registers: [register],
})

const authLoginsTotal = new Counter({
  name: 'yoink_auth_logins_total',
  help: 'Total number of authentication logins by method and status',
  labelNames: ['method', 'status'],
  registers: [register],
})

const websocketConnections = new Gauge({
  name: 'yoink_websocket_connections',
  help: 'Number of active WebSocket connections',
  registers: [register],
})

@Injectable()
export class YoinkMetricsService {
  downloadInitiated(scope: DownloadScope): void {
    const mediaType: MediaType = scope === 'movie' ? 'movie' : 'episode'
    downloadsInitiatedTotal.inc({ media_type: mediaType, scope })
  }

  downloadCompleted(mediaType: MediaType, status: DownloadStatus): void {
    downloadsCompletedTotal.inc({ media_type: mediaType, status })
  }

  setActiveDownloads(count: number): void {
    downloadsActive.set(count)
  }

  setPendingCancels(count: number): void {
    pendingCancels.set(count)
  }

  libraryOperation(
    operation: LibraryOperation,
    mediaType: LibraryMediaType,
  ): void {
    libraryOperationsTotal.inc({ operation, media_type: mediaType })
  }

  search(type: SearchType): void {
    searchesTotal.inc({ type })
  }

  externalApiError(service: ExternalService): void {
    externalApiErrorsTotal.inc({ service })
  }

  startPollTimer(): () => void {
    return pollDurationSeconds.startTimer()
  }

  pollError(): void {
    pollErrorsTotal.inc()
  }

  authLogin(method: AuthMethod, status: AuthStatus): void {
    authLoginsTotal.inc({ method, status })
  }

  setWebsocketConnections(count: number): void {
    websocketConnections.set(count)
  }
}
