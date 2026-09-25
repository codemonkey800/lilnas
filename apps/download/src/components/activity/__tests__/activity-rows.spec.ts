import type { DownloadJob, VideoProgress } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import type { ActivityRow } from 'src/components/activity/activity-rows'
import {
  buildActivityRows,
  isMoving,
  jobProgressPct,
  mobileStatusLabel,
} from 'src/components/activity/activity-rows'

const NO_EVICTIONS: ReadonlySet<string> = new Set()

/** A yt-dlp snapshot part-way through the only file. */
const moving: VideoProgress = {
  downloadedBytes: 63_600_000,
  fileIndex: 1,
  percent: 63.6,
  totalBytes: 100_000_000,
}

function video(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:58:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-video',
    linkedDiscord: null,
    media: {
      id: 'video:v1',
      sourceUrl: 'https://example.com/v1',
      title: 'Sourdough starter, day one to seven',
      type: DownloadType.Video,
    },
    requester: null,
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:59:00.000Z',
    ...overrides,
  }
}

function movie(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:50:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-movie',
    linkedDiscord: null,
    media: {
      id: 'tmdb:438631',
      queueSnapshot: { progress: 63.7 },
      title: 'Salt & Ceremony',
      tmdbId: 438631,
      type: DownloadType.Movie,
    },
    requester: { email: 'sam@lilnas.io', userId: 'u_sam' },
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:59:00.000Z',
    ...overrides,
  }
}

function build(options: {
  evicted?: ReadonlySet<string>
  live?: DownloadJob[]
  pages?: DownloadJob[]
  types?: DownloadType[]
}): ActivityRow[] {
  return buildActivityRows({
    evicted: options.evicted ?? NO_EVICTIONS,
    live: new Map((options.live ?? []).map(job => [job.id, job])),
    pages: options.pages ?? [],
    types: options.types ?? [],
  })
}

function ids(rows: ActivityRow[]): string[] {
  return rows.map(row => row.job.id)
}

describe('buildActivityRows', () => {
  it('keeps a server-rendered job that the live feed has not spoken about', () => {
    const rows = build({ pages: [video()] })

    expect(ids(rows)).toEqual(['job-video'])
    expect(rows[0]?.departing).toBe(false)
  })

  it('lets the live copy win over the server copy of the same job', () => {
    const rows = build({
      live: [video({ status: DownloadJobStatus.Converting })],
      pages: [video({ status: DownloadJobStatus.Pending })],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.job.status).toBe(DownloadJobStatus.Converting)
  })

  // The whole point of the feed: a job that finishes has to leave it.
  it.each([
    DownloadJobStatus.Completed,
    DownloadJobStatus.Failed,
    DownloadJobStatus.Cancelled,
  ])('marks a %s job as departing rather than keeping it', status => {
    const rows = build({ live: [video({ status })], pages: [video()] })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.departing).toBe(true)
    expect(rows[0]?.job.status).toBe(status)
  })

  it('drops a departing job once it has been evicted', () => {
    const rows = build({
      evicted: new Set(['job-video']),
      live: [video({ status: DownloadJobStatus.Completed })],
      pages: [video()],
    })

    expect(rows).toEqual([])
  })

  // `paused`/`pausing` are in-progress purely by being absent from
  // TERMINAL_DOWNLOAD_JOB_STATUSES. A paused download is still open work.
  it.each([DownloadJobStatus.Paused, DownloadJobStatus.Pausing])(
    'keeps a %s job on the feed, never departing',
    status => {
      const rows = build({ live: [video({ status })], pages: [video()] })

      expect(rows).toHaveLength(1)
      expect(rows[0]?.departing).toBe(false)
    },
  )

  it('never lets an eviction suppress a job that is still working', () => {
    const rows = build({
      evicted: new Set(['job-video']),
      live: [video({ status: DownloadJobStatus.Paused })],
      pages: [video()],
    })

    expect(ids(rows)).toEqual(['job-video'])
  })

  it('admits a job the live feed announced and the server page never had', () => {
    const rows = build({ live: [movie()], pages: [video()] })

    expect(ids(rows)).toEqual(['job-video', 'job-movie'])
  })

  it('orders by createdAt descending, then id descending, like the API', () => {
    const same = '2026-09-15T11:00:00.000Z'
    const rows = build({
      pages: [
        video({ createdAt: same, id: 'a' }),
        movie({ createdAt: '2026-09-15T12:00:00.000Z', id: 'newest' }),
        video({ createdAt: same, id: 'b' }),
      ],
    })

    expect(ids(rows)).toEqual(['newest', 'b', 'a'])
  })

  it('sorts an unparseable createdAt last instead of poisoning the order', () => {
    const rows = build({
      pages: [video({ createdAt: 'not a date', id: 'broken' }), movie()],
    })

    expect(ids(rows)).toEqual(['job-movie', 'broken'])
  })

  // The socket broadcasts every job; without this the filter the server
  // honoured would silently undo itself the moment anyone started a video.
  it('applies the type filter to live jobs, not just to the fetched pages', () => {
    const rows = build({
      live: [video(), movie()],
      types: [DownloadType.Movie],
    })

    expect(ids(rows)).toEqual(['job-movie'])
  })

  it('applies no filter at all when no type is selected', () => {
    const rows = build({ live: [video(), movie()] })

    expect(ids(rows)).toHaveLength(2)
  })
})

describe('isMoving', () => {
  it('is true exactly when the machine is working the job', () => {
    expect(isMoving(video({ status: DownloadJobStatus.Downloading }))).toBe(
      true,
    )
    expect(isMoving(video({ status: DownloadJobStatus.Uploading }))).toBe(true)
  })

  it('is false for queued, intervened-on and finished jobs', () => {
    expect(isMoving(video({ status: DownloadJobStatus.Pending }))).toBe(false)
    expect(isMoving(video({ status: DownloadJobStatus.Paused }))).toBe(false)
    expect(isMoving(video({ status: DownloadJobStatus.Completed }))).toBe(false)
  })
})

describe('jobProgressPct', () => {
  it('rounds the Radarr/Sonarr queue snapshot', () => {
    expect(jobProgressPct(movie())).toBe(64)
  })

  // A video has no queue snapshot — its figure is the job's own yt-dlp one.
  it("rounds a video's yt-dlp snapshot", () => {
    expect(jobProgressPct(video({ progress: moving }))).toBe(64)
  })

  it('has nothing to report for a video with no yt-dlp snapshot', () => {
    expect(jobProgressPct(video())).toBeNull()
  })

  // yt-dlp leaves `percent` off when it does not know the total size.
  it('has nothing to report for a video whose total is unknown', () => {
    expect(
      jobProgressPct(
        video({ progress: { downloadedBytes: 1024, fileIndex: 1 } }),
      ),
    ).toBeNull()
  })

  it('still reports progress for a paused video', () => {
    expect(
      jobProgressPct(
        video({ progress: moving, status: DownloadJobStatus.Paused }),
      ),
    ).toBe(64)
  })

  // Cannot happen — the server drops the snapshot with the process — but a
  // terminal job has nothing to report however it arrives.
  it('has nothing to report for a completed video carrying a stale snapshot', () => {
    expect(
      jobProgressPct(
        video({ progress: moving, status: DownloadJobStatus.Completed }),
      ),
    ).toBeNull()
  })

  // The snapshot is the media's, shared by every attempt at the same title, so
  // a finished attempt would otherwise show the live attempt's percentage.
  it.each([
    DownloadJobStatus.Completed,
    DownloadJobStatus.Failed,
    DownloadJobStatus.Cancelled,
  ])('has nothing to report once the job is %s', status => {
    expect(jobProgressPct(movie({ status }))).toBeNull()
  })

  it('still reports progress for a paused job', () => {
    expect(jobProgressPct(movie({ status: DownloadJobStatus.Paused }))).toBe(64)
  })

  it('has nothing to report for a movie with no queue snapshot yet', () => {
    expect(
      jobProgressPct(
        movie({
          media: {
            id: 'tmdb:1',
            title: 'Paper Weather',
            tmdbId: 1,
            type: DownloadType.Movie,
          },
        }),
      ),
    ).toBeNull()
  })
})

describe('mobileStatusLabel', () => {
  it('lets the percentage stand alone while the job is moving', () => {
    expect(mobileStatusLabel(movie())).toBe('64%')
  })

  it('names the state as well once the job has stopped moving', () => {
    expect(mobileStatusLabel(movie({ status: DownloadJobStatus.Paused }))).toBe(
      'paused · 64%',
    )
  })

  it("lets a moving video's percentage stand alone", () => {
    expect(mobileStatusLabel(video({ progress: moving }))).toBe('64%')
  })

  it('names the state as well once a video has stopped moving', () => {
    expect(
      mobileStatusLabel(
        video({ progress: moving, status: DownloadJobStatus.Paused }),
      ),
    ).toBe('paused · 64%')
  })

  it('falls back to the bare state when there is no progress', () => {
    expect(mobileStatusLabel(video())).toBe('downloading')
  })
})
