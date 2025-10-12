import {
  DownloadingMovie,
  DownloadProtocol,
  RadarrQueueStatus,
} from 'src/media/types/radarr.types'
import { DownloadingSeries } from 'src/media/types/sonarr.types'

// ============================================================================
// Download Fixtures
// ============================================================================

/**
 * Creates a mock downloading movie for testing
 */
export function createMockDownloadingMovie(
  overrides?: Partial<DownloadingMovie>,
): DownloadingMovie {
  return {
    id: 1,
    movieTitle: 'The Matrix',
    progressPercent: 75.5,
    status: RadarrQueueStatus.DOWNLOADING,
    size: 2147483648, // 2GB
    sizeleft: 536870912, // 512MB remaining
    protocol: DownloadProtocol.TORRENT,
    downloadedBytes: 1610612736, // 1.5GB downloaded
    estimatedCompletionTime: new Date(Date.now() + 600000).toISOString(), // 10 minutes
    ...overrides,
  }
}

/**
 * Creates a mock downloading TV series/episode for testing
 */
export function createMockDownloadingSeries(
  overrides?: Partial<DownloadingSeries>,
): DownloadingSeries {
  return {
    id: 1,
    seriesTitle: 'Breaking Bad',
    seasonNumber: 1,
    episodeNumber: 1,
    episodeTitle: 'Pilot',
    progressPercent: 50.0,
    status: 'downloading',
    size: 524288000, // 500MB
    sizeleft: 262144000, // 250MB remaining
    protocol: 'torrent',
    downloadedBytes: 262144000, // 250MB downloaded
    timeleft: '5m 30s',
    isActive: true,
    ...overrides,
  }
}
