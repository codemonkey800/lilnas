import {
  DownloadJobStatus,
  DownloadType,
  MovieDownloadJob,
  ShowDownloadJob,
  VideoDownloadJob,
} from '@lilnas/utils/download/types'

import {
  projectJobForViewer,
  showTrueRequester,
} from 'src/download/attribution'

const REQUESTER = { email: 'alice@example.com', userId: 'user_1' }

function buildVideoJob(
  overrides: Partial<VideoDownloadJob> = {},
): VideoDownloadJob {
  return {
    id: 'video-1',
    requester: REQUESTER,
    status: DownloadJobStatus.Completed,
    type: DownloadType.Video,
    url: 'https://example.com/video',
    ...overrides,
  }
}

function buildMovieJob(
  overrides: Partial<MovieDownloadJob> = {},
): MovieDownloadJob {
  return {
    id: 'movie-1',
    requester: REQUESTER,
    status: DownloadJobStatus.Downloading,
    type: DownloadType.Movie,
    url: 'radarr://tmdb/1',
    ...overrides,
  }
}

function buildShowJob(
  overrides: Partial<ShowDownloadJob> = {},
): ShowDownloadJob {
  return {
    id: 'show-1',
    requester: REQUESTER,
    status: DownloadJobStatus.Importing,
    type: DownloadType.Show,
    url: 'sonarr://tvdb/1',
    ...overrides,
  }
}

describe('showTrueRequester', () => {
  describe('video jobs', () => {
    it('is true when not hidden, regardless of admin status', () => {
      const job = buildVideoJob({ hiddenAttribution: false })

      expect(showTrueRequester(job, false)).toBe(true)
      expect(showTrueRequester(job, true)).toBe(true)
    })

    it('is false for a non-admin viewer when hidden', () => {
      const job = buildVideoJob({ hiddenAttribution: true })

      expect(showTrueRequester(job, false)).toBe(false)
    })

    it('is true for an admin viewer even when hidden', () => {
      const job = buildVideoJob({ hiddenAttribution: true })

      expect(showTrueRequester(job, true)).toBe(true)
    })

    it('treats an unset hiddenAttribution the same as false', () => {
      const job = buildVideoJob({ hiddenAttribution: undefined })

      expect(showTrueRequester(job, false)).toBe(true)
    })
  })

  describe('movie/show jobs', () => {
    it('is always true for a movie job, regardless of admin status', () => {
      const job = buildMovieJob()

      expect(showTrueRequester(job, false)).toBe(true)
      expect(showTrueRequester(job, true)).toBe(true)
    })

    it('is always true for a show job, regardless of admin status', () => {
      const job = buildShowJob()

      expect(showTrueRequester(job, false)).toBe(true)
      expect(showTrueRequester(job, true)).toBe(true)
    })
  })
})

describe('projectJobForViewer', () => {
  it('returns the job unchanged (same requester) when not hidden', () => {
    const job = buildVideoJob({ hiddenAttribution: false })

    expect(projectJobForViewer(job, false).requester).toEqual(REQUESTER)
  })

  it('masks the requester for a non-admin viewer of a hidden video job', () => {
    const job = buildVideoJob({ hiddenAttribution: true })

    const projected = projectJobForViewer(job, false)

    expect(projected.requester).toBeNull()
    // hiddenAttribution itself must survive - non-admin viewers still need
    // it to render the hidden-attribution UI treatment.
    expect(projected.hiddenAttribution).toBe(true)
  })

  it('reveals the true requester to an admin viewer of a hidden video job', () => {
    const job = buildVideoJob({ hiddenAttribution: true })

    const projected = projectJobForViewer(job, true)

    expect(projected.requester).toEqual(REQUESTER)
    expect(projected.hiddenAttribution).toBe(true)
  })

  it('never mutates the original job object', () => {
    const job = buildVideoJob({ hiddenAttribution: true })
    const original = { ...job }

    projectJobForViewer(job, false)

    expect(job).toEqual(original)
  })

  it('never masks a movie job', () => {
    const job = buildMovieJob()

    const projected = projectJobForViewer(job, false)

    expect(projected.requester).toEqual(REQUESTER)
  })

  it('never masks a show job', () => {
    const job = buildShowJob()

    const projected = projectJobForViewer(job, false)

    expect(projected.requester).toEqual(REQUESTER)
  })
})
