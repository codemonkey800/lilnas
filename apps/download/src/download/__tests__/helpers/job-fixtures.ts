import {
  DownloadJob,
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
  Media,
  Movie,
  Show,
  Video,
} from '@lilnas/utils/download/types'

export const REQUESTER = { email: 'alice@example.com', userId: 'user_1' }

export const NOW_ISO = '2026-08-20T12:00:00.000Z'

export function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video:v1',
    sourceUrl: 'https://example.com/video',
    title: 'A video',
    type: DownloadType.Video,
    ...overrides,
  }
}

export function buildMovie(overrides: Partial<Movie> = {}): Movie {
  return {
    id: 'tmdb:1',
    title: 'A Movie',
    tmdbId: 1,
    type: DownloadType.Movie,
    ...overrides,
  }
}

export function buildShow(overrides: Partial<Show> = {}): Show {
  return {
    id: 'tvdb:1',
    title: 'A Show',
    tvdbId: 1,
    type: DownloadType.Show,
    ...overrides,
  }
}

/** A persisted/in-memory job record - no `media`, just the derived key. */
export function buildRecord(
  overrides: Partial<DownloadJobRecord> = {},
): DownloadJobRecord {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    hiddenAttribution: false,
    id: 'job-1',
    mediaId: 'video:v1',
    requester: REQUESTER,
    status: DownloadJobStatus.Pending,
    type: DownloadType.Video,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

/** The wire/domain shape: a record with its media resolved. */
export function buildJob(
  media: Media = buildVideo(),
  overrides: Partial<DownloadJob> = {},
): DownloadJob {
  const { mediaId: _mediaId, type: _type, ...record } = buildRecord()
  void _mediaId
  void _type

  return { ...record, media, ...overrides }
}
