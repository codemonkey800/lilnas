import {
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  GetDownloadJobResponse,
  isMovieDownloadJob,
  isShowDownloadJob,
  isVideoDownloadJob,
  MovieDownloadJob,
  ShowDownloadJob,
  VideoDownloadJob,
} from 'src/download/types'

function buildVideoJob(
  overrides: Partial<VideoDownloadJob> = {},
): VideoDownloadJob {
  return {
    ...overrides,
    id: overrides.id ?? 'video-1',
    status: overrides.status ?? DownloadJobStatus.Pending,
    type: DownloadType.Video,
    url: overrides.url ?? 'https://example.com/video',
  }
}

function buildMovieJob(
  overrides: Partial<MovieDownloadJob> = {},
): MovieDownloadJob {
  return {
    ...overrides,
    id: overrides.id ?? 'movie-1',
    status: overrides.status ?? DownloadJobStatus.Requested,
    type: DownloadType.Movie,
    url: overrides.url ?? 'https://example.com/movie',
  }
}

function buildShowJob(
  overrides: Partial<ShowDownloadJob> = {},
): ShowDownloadJob {
  return {
    ...overrides,
    id: overrides.id ?? 'show-1',
    status: overrides.status ?? DownloadJobStatus.Requested,
    type: DownloadType.Show,
    url: overrides.url ?? 'https://example.com/show',
  }
}

describe('DownloadType', () => {
  it('has the video, movie, and show members', () => {
    expect(DownloadType.Video).toBe('video')
    expect(DownloadType.Movie).toBe('movie')
    expect(DownloadType.Show).toBe('show')
  })
})

describe('DownloadJobStatus', () => {
  it('keeps all pre-existing members', () => {
    expect(DownloadJobStatus.Cancelled).toBe('cancelled')
    expect(DownloadJobStatus.Cancelling).toBe('cancelling')
    expect(DownloadJobStatus.Cleaning).toBe('cleaning')
    expect(DownloadJobStatus.Completed).toBe('completed')
    expect(DownloadJobStatus.Converting).toBe('converting')
    expect(DownloadJobStatus.Downloading).toBe('downloading')
    expect(DownloadJobStatus.Failed).toBe('failed')
    expect(DownloadJobStatus.Pending).toBe('pending')
    expect(DownloadJobStatus.Uploading).toBe('uploading')
  })

  it('adds the new movie/show lifecycle members', () => {
    expect(DownloadJobStatus.Requested).toBe('requested')
    expect(DownloadJobStatus.Searching).toBe('searching')
    expect(DownloadJobStatus.Importing).toBe('importing')
  })
})

describe('DownloadJob discriminated union', () => {
  const videoJob: DownloadJob = buildVideoJob({
    downloadUrls: ['https://example.com/file.mp4'],
    timeRange: { start: '00:00:00', end: '00:01:00' },
  })
  const movieJob: DownloadJob = buildMovieJob({
    mediaTitle: 'Some Movie',
    radarrId: 42,
  })
  const showJob: DownloadJob = buildShowJob({
    mediaTitle: 'Some Show',
    sonarrId: 7,
  })
  const jobs = [videoJob, movieJob, showJob]

  describe('isVideoDownloadJob', () => {
    it('matches only video jobs', () => {
      expect(jobs.filter(isVideoDownloadJob)).toEqual([videoJob])
    })

    it('narrows to VideoDownloadJob-only fields', () => {
      if (!isVideoDownloadJob(videoJob)) {
        throw new Error('expected videoJob to be narrowed to VideoDownloadJob')
      }

      expect(videoJob.downloadUrls).toEqual(['https://example.com/file.mp4'])
      expect(videoJob.timeRange).toEqual({
        start: '00:00:00',
        end: '00:01:00',
      })
    })
  })

  describe('isMovieDownloadJob', () => {
    it('matches only movie jobs', () => {
      expect(jobs.filter(isMovieDownloadJob)).toEqual([movieJob])
    })

    it('narrows to MovieDownloadJob-only fields', () => {
      if (!isMovieDownloadJob(movieJob)) {
        throw new Error('expected movieJob to be narrowed to MovieDownloadJob')
      }

      expect(movieJob.radarrId).toBe(42)
      expect(movieJob.mediaTitle).toBe('Some Movie')
    })
  })

  describe('isShowDownloadJob', () => {
    it('matches only show jobs', () => {
      expect(jobs.filter(isShowDownloadJob)).toEqual([showJob])
    })

    it('narrows to ShowDownloadJob-only fields', () => {
      if (!isShowDownloadJob(showJob)) {
        throw new Error('expected showJob to be narrowed to ShowDownloadJob')
      }

      expect(showJob.sonarrId).toBe(7)
      expect(showJob.mediaTitle).toBe('Some Show')
    })
  })

  it('every job carries the fields shared across all job types', () => {
    for (const job of jobs) {
      expect(typeof job.id).toBe('string')
      expect(typeof job.status).toBe('string')
      expect(typeof job.url).toBe('string')
    }
  })
})

describe('GetDownloadJobResponse', () => {
  it('accepts exactly the picked video-job fields', () => {
    const response: GetDownloadJobResponse = {
      description: 'a video',
      downloadUrls: ['https://example.com/a.mp4'],
      error: undefined,
      id: 'video-1',
      status: DownloadJobStatus.Completed,
      timeRange: undefined,
      title: 'A video',
      type: DownloadType.Video,
      url: 'https://example.com/video',
    }

    expect(response.type).toBe(DownloadType.Video)
    expect(Object.keys(response).sort()).toEqual(
      [
        'description',
        'downloadUrls',
        'error',
        'id',
        'status',
        'timeRange',
        'title',
        'type',
        'url',
      ].sort(),
    )
  })

  it('is satisfied by a full VideoDownloadJob (minus file/proc)', () => {
    const videoJob = buildVideoJob({
      description: 'a video',
      downloadUrls: ['https://example.com/a.mp4'],
      title: 'A video',
    })

    const response: GetDownloadJobResponse = {
      description: videoJob.description,
      downloadUrls: videoJob.downloadUrls,
      error: videoJob.error,
      id: videoJob.id,
      status: videoJob.status,
      timeRange: videoJob.timeRange,
      title: videoJob.title,
      type: videoJob.type,
      url: videoJob.url,
    }

    expect(response.downloadUrls).toEqual(videoJob.downloadUrls)
  })
})
