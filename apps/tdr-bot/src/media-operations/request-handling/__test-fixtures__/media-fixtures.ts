import { mediaId } from '@lilnas/utils/download/media-id'
import {
  type DownloadJob,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'

import {
  MovieLibrarySearchResult,
  MovieSearchResult,
  RadarrMinimumAvailability,
  RadarrMovieStatus,
  UnmonitorAndDeleteResult,
} from 'src/media/types/radarr.types'
import {
  LibrarySearchResult,
  SeriesSearchResult,
  SonarrSeriesStatus,
  SonarrSeriesType,
  UnmonitorAndDeleteSeriesResult,
} from 'src/media/types/sonarr.types'

// ============================================================================
// Movie Fixtures
// ============================================================================

export function createMockMovie(
  overrides?: Partial<MovieSearchResult>,
): MovieSearchResult {
  return {
    tmdbId: 603,
    imdbId: 'tt0133093',
    title: 'The Matrix',
    originalTitle: 'The Matrix',
    year: 1999,
    overview: 'Set in the 22nd century, The Matrix tells the story...',
    runtime: 136,
    genres: ['Action', 'Science Fiction'],
    rating: 8.2,
    posterPath: '/path/to/matrix-poster.jpg',
    backdropPath: '/path/to/matrix-backdrop.jpg',
    status: RadarrMovieStatus.RELEASED,
    certification: 'R',
    studio: 'Warner Bros.',
    popularity: 85.5,
    ...overrides,
  }
}

export function createMockMovieList(count: number): MovieSearchResult[] {
  return Array.from({ length: count }, (_, i) =>
    createMockMovie({
      tmdbId: 600 + i,
      title: `Movie ${i + 1}`,
      year: 2000 + i,
    }),
  )
}

export function createMockLibraryMovie(
  overrides?: Partial<MovieLibrarySearchResult>,
): MovieLibrarySearchResult {
  return {
    id: 1,
    tmdbId: 603,
    imdbId: 'tt0133093',
    title: 'The Matrix',
    originalTitle: 'The Matrix',
    year: 1999,
    overview: 'Set in the 22nd century, The Matrix tells the story...',
    runtime: 136,
    genres: ['Action', 'Science Fiction'],
    rating: 8.2,
    posterPath: '/path/to/matrix-poster.jpg',
    backdropPath: '/path/to/matrix-backdrop.jpg',
    status: RadarrMovieStatus.RELEASED,
    certification: 'R',
    studio: 'Warner Bros.',
    popularity: 85.5,
    isAvailable: true,
    monitored: true,
    hasFile: true,
    path: '/movies/The Matrix (1999)',
    added: '2023-01-01T00:00:00Z',
    sizeOnDisk: 5368709120,
    qualityProfileId: 1,
    rootFolderPath: '/movies',
    minimumAvailability: RadarrMinimumAvailability.RELEASED,
    ...overrides,
  }
}

export function createMockLibraryMovieList(
  count: number,
): MovieLibrarySearchResult[] {
  return Array.from({ length: count }, (_, i) =>
    createMockLibraryMovie({
      id: i + 1,
      tmdbId: 600 + i,
      title: `Library Movie ${i + 1}`,
      year: 2000 + i,
    }),
  )
}

// ============================================================================
// TV Show Fixtures
// ============================================================================

export function createMockShow(
  overrides?: Partial<SeriesSearchResult>,
): SeriesSearchResult {
  return {
    tvdbId: 81189,
    tmdbId: 1396,
    imdbId: 'tt0903747',
    title: 'Breaking Bad',
    titleSlug: 'breaking-bad',
    year: 2008,
    overview: 'A high school chemistry teacher turned meth cook...',
    runtime: 47,
    network: 'AMC',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
      { seasonNumber: 3, monitored: false },
    ],
    genres: ['Drama', 'Crime', 'Thriller'],
    rating: 9.5,
    posterPath: '/path/to/breaking-bad-poster.jpg',
    certification: 'TV-MA',
    ended: true,
    ...overrides,
  }
}

export function createMockShowList(count: number): SeriesSearchResult[] {
  return Array.from({ length: count }, (_, i) =>
    createMockShow({
      tvdbId: 80000 + i,
      title: `Show ${i + 1}`,
      year: 2000 + i,
      titleSlug: `show-${i + 1}`,
    }),
  )
}

export function createMockLibraryShow(
  overrides?: Partial<LibrarySearchResult>,
): LibrarySearchResult {
  return {
    id: 1,
    tvdbId: 81189,
    tmdbId: 1396,
    imdbId: 'tt0903747',
    title: 'Breaking Bad',
    titleSlug: 'breaking-bad',
    year: 2008,
    overview: 'A high school chemistry teacher turned meth cook...',
    runtime: 45,
    network: 'AMC',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
      { seasonNumber: 3, monitored: true },
    ],
    genres: ['Drama', 'Crime', 'Thriller'],
    rating: 9.5,
    posterPath: '/path/to/breaking-bad-poster.jpg',
    backdropPath: '/path/to/breaking-bad-backdrop.jpg',
    certification: 'TV-MA',
    ended: true,
    monitored: true,
    path: '/tv/Breaking Bad',
    added: '2023-01-01T00:00:00Z',
    statistics: {
      seasonCount: 5,
      episodeFileCount: 62,
      episodeCount: 62,
      totalEpisodeCount: 62,
      sizeOnDisk: 30000000000,
      percentOfEpisodes: 100,
    },
    ...overrides,
  }
}

export function createMockLibraryShowList(
  count: number,
): LibrarySearchResult[] {
  return Array.from({ length: count }, (_, i) =>
    createMockLibraryShow({
      id: i + 1,
      tvdbId: 80000 + i,
      title: `Library Show ${i + 1}`,
      year: 2000 + i,
      titleSlug: `library-show-${i + 1}`,
    }),
  )
}

// ============================================================================
// Result Fixtures
// ============================================================================

/**
 * The job `POST /download/movies` answers with - by default a fresh request
 * for The Matrix, still `searching`.
 */
export function createMockMovieJob(
  overrides: Partial<DownloadJob> = {},
): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-603',
    linkedDiscord: null,
    media: {
      id: mediaId({ type: DownloadType.Movie, tmdbId: 603 }),
      title: 'The Matrix',
      tmdbId: 603,
      type: DownloadType.Movie,
      year: 1999,
    },
    requester: null,
    status: DownloadJobStatus.Searching,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * The job `POST /download/shows` answers with - by default a fresh
 * whole-series request for Breaking Bad, still `searching`. Pass `scope` for
 * a season or episode job.
 */
export function createMockShowJob(
  overrides: Partial<DownloadJob> = {},
): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-81189',
    linkedDiscord: null,
    media: {
      id: mediaId({ type: DownloadType.Show, tvdbId: 81189 }),
      title: 'Breaking Bad',
      tvdbId: 81189,
      type: DownloadType.Show,
      year: 2008,
    },
    requester: null,
    status: DownloadJobStatus.Searching,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export const mockMovieDeleteSuccess: UnmonitorAndDeleteResult = {
  success: true,
  movieDeleted: true,
  filesDeleted: true,
}

export const mockMovieDeleteFailure: UnmonitorAndDeleteResult = {
  success: false,
  movieDeleted: false,
  filesDeleted: false,
  error: 'Failed to delete movie from Radarr',
}

export const mockTvDeleteSuccess: UnmonitorAndDeleteSeriesResult = {
  success: true,
  seriesDeleted: true,
  episodesUnmonitored: false,
  downloadsCancel: false,
  canceledDownloads: 0,
  changes: [{ season: 1, action: 'deleted_series' }],
}

export const mockTvDeleteFailure: UnmonitorAndDeleteSeriesResult = {
  success: false,
  seriesDeleted: false,
  episodesUnmonitored: false,
  downloadsCancel: false,
  canceledDownloads: 0,
  changes: [],
  error: 'Failed to delete series from Sonarr',
}
