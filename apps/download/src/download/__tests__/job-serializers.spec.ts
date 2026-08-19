import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import type { JobRow } from 'src/db/schema'
import {
  getJobResponse,
  getMovieJobResponse,
  getShowJobResponse,
  serializeJobListItem,
} from 'src/download/job-serializers'

function buildRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    description: null,
    downloadUrls: null,
    error: null,
    filePath: null,
    hiddenAttribution: false,
    id: 'row-1',
    mediaTitle: null,
    origin: 'service',
    overview: null,
    posterUrl: null,
    queueSnapshot: null,
    radarrId: null,
    requesterEmail: null,
    requesterUserId: null,
    sonarrId: null,
    status: DownloadJobStatus.Completed,
    timeRange: null,
    title: null,
    type: 'video',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    url: 'https://example.com/video',
    ...overrides,
  }
}

function hiddenVideoRow(overrides: Partial<JobRow> = {}): JobRow {
  return buildRow({
    hiddenAttribution: true,
    origin: 'web',
    requesterEmail: 'alice@example.com',
    requesterUserId: 'user_1',
    type: 'video',
    ...overrides,
  })
}

describe('getJobResponse / getMovieJobResponse / getShowJobResponse masking', () => {
  const admin = true
  const nonAdmin = false

  it('masks a hidden video job requester for a non-admin viewer', () => {
    const job = {
      hiddenAttribution: true,
      id: 'v1',
      requester: { email: 'alice@example.com', userId: 'u1' },
      status: DownloadJobStatus.Completed,
      type: DownloadType.Video as const,
      url: 'https://example.com/v',
    }

    expect(getJobResponse(job, nonAdmin).requester).toBeNull()
    expect(getJobResponse(job, admin).requester).toEqual(job.requester)
  })

  it('never masks a non-hidden video job', () => {
    const job = {
      hiddenAttribution: false,
      id: 'v2',
      requester: { email: 'alice@example.com', userId: 'u1' },
      status: DownloadJobStatus.Completed,
      type: DownloadType.Video as const,
      url: 'https://example.com/v',
    }

    expect(getJobResponse(job, nonAdmin).requester).toEqual(job.requester)
  })

  it('throws when given a non-video job', () => {
    const job = {
      id: 'm1',
      requester: null,
      status: DownloadJobStatus.Completed,
      type: DownloadType.Movie as const,
      url: 'radarr://tmdb/1',
    }

    expect(() => getJobResponse(job, nonAdmin)).toThrow(/Expected a video job/)
  })

  it('never masks a movie job, even one flagged hidden at the row level', () => {
    const job = {
      id: 'm2',
      requester: { email: 'alice@example.com', userId: 'u1' },
      status: DownloadJobStatus.Completed,
      type: DownloadType.Movie as const,
      url: 'radarr://tmdb/1',
    }

    expect(getMovieJobResponse(job, nonAdmin).requester).toEqual(job.requester)
  })

  it('never masks a show job', () => {
    const job = {
      id: 's1',
      requester: { email: 'alice@example.com', userId: 'u1' },
      status: DownloadJobStatus.Completed,
      type: DownloadType.Show as const,
      url: 'sonarr://tvdb/1',
    }

    expect(getShowJobResponse(job, nonAdmin).requester).toEqual(job.requester)
  })
})

describe('serializeJobListItem', () => {
  it('dispatches a video row to the video serializer and masks when hidden', () => {
    const row = hiddenVideoRow()

    const nonAdmin = serializeJobListItem(row, false)
    const admin = serializeJobListItem(row, true)

    expect(nonAdmin.type).toBe(DownloadType.Video)
    expect(nonAdmin.requester).toBeNull()
    expect(admin.requester).toEqual({
      email: 'alice@example.com',
      userId: 'user_1',
    })
  })

  it('dispatches a movie row to the movie serializer, never masking', () => {
    const row = buildRow({
      id: 'movie-1',
      mediaTitle: 'A Movie',
      origin: 'web',
      radarrId: 7,
      requesterEmail: 'alice@example.com',
      requesterUserId: 'user_1',
      type: 'movie',
    })

    const item = serializeJobListItem(row, false)

    expect(item.type).toBe(DownloadType.Movie)
    expect(item.requester).toEqual({
      email: 'alice@example.com',
      userId: 'user_1',
    })
    if (item.type === DownloadType.Movie) {
      expect(item.radarrId).toBe(7)
    }
  })

  it('dispatches a show row to the show serializer, never masking', () => {
    const row = buildRow({
      id: 'show-1',
      mediaTitle: 'A Show',
      origin: 'web',
      requesterEmail: 'bob@example.com',
      requesterUserId: 'user_2',
      sonarrId: 9,
      type: 'show',
    })

    const item = serializeJobListItem(row, false)

    expect(item.type).toBe(DownloadType.Show)
    expect(item.requester).toEqual({
      email: 'bob@example.com',
      userId: 'user_2',
    })
    if (item.type === DownloadType.Show) {
      expect(item.sonarrId).toBe(9)
    }
  })

  it('emits createdAt as an ISO string', () => {
    const row = buildRow({
      createdAt: new Date('2026-03-04T05:06:07.000Z'),
    })

    const item = serializeJobListItem(row, false)

    expect(item.createdAt).toBe('2026-03-04T05:06:07.000Z')
  })

  it('emits completedAt: null when absent, and an ISO string when present', () => {
    const incomplete = serializeJobListItem(
      buildRow({ completedAt: null }),
      false,
    )
    const completed = serializeJobListItem(
      buildRow({ completedAt: new Date('2026-02-01T00:00:00.000Z') }),
      false,
    )

    expect(incomplete.completedAt).toBeNull()
    expect(completed.completedAt).toBe('2026-02-01T00:00:00.000Z')
  })
})
