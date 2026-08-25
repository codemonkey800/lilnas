import {
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  GetDownloadJobResponse,
  IN_PROGRESS_DOWNLOAD_JOB_STATUSES,
  isInProgressDownloadJobStatus,
  isManagedMedia,
  isMovie,
  isShow,
  isTerminalDownloadJobStatus,
  isVideo,
  Media,
  Movie,
  Show,
  TERMINAL_DOWNLOAD_JOB_STATUSES,
  Video,
} from 'src/download/types'

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: overrides.id ?? 'video:1',
    sourceUrl: overrides.sourceUrl ?? 'https://example.com/video',
    title: overrides.title ?? 'A video',
    type: DownloadType.Video,
    ...overrides,
  }
}

function buildMovie(overrides: Partial<Movie> = {}): Movie {
  return {
    id: overrides.id ?? 'tmdb:1',
    title: overrides.title ?? 'Dune',
    tmdbId: overrides.tmdbId ?? 1,
    type: DownloadType.Movie,
    ...overrides,
  }
}

function buildShow(overrides: Partial<Show> = {}): Show {
  return {
    id: overrides.id ?? 'tvdb:1',
    title: overrides.title ?? 'Some Show',
    tvdbId: overrides.tvdbId ?? 1,
    type: DownloadType.Show,
    ...overrides,
  }
}

function buildJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: overrides.completedAt ?? null,
    createdAt: overrides.createdAt ?? '2026-08-20T12:00:00.000Z',
    hiddenAttribution: overrides.hiddenAttribution ?? false,
    id: overrides.id ?? 'job-1',
    media: overrides.media ?? buildVideo(),
    requester: overrides.requester ?? null,
    status: overrides.status ?? DownloadJobStatus.Requested,
    updatedAt: overrides.updatedAt ?? '2026-08-20T12:00:00.000Z',
    ...overrides,
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

  it('adds the Phase 5 pause members', () => {
    expect(DownloadJobStatus.Paused).toBe('paused')
    expect(DownloadJobStatus.Pausing).toBe('pausing')
  })
})

describe('TERMINAL_DOWNLOAD_JOB_STATUSES / IN_PROGRESS_DOWNLOAD_JOB_STATUSES', () => {
  const allStatuses = Object.values(DownloadJobStatus)

  it('partition all status members exactly - no overlap, no gaps', () => {
    const terminal = new Set<DownloadJobStatus>(TERMINAL_DOWNLOAD_JOB_STATUSES)
    const inProgress = new Set<DownloadJobStatus>(
      IN_PROGRESS_DOWNLOAD_JOB_STATUSES,
    )

    expect(terminal.size + inProgress.size).toBe(allStatuses.length)
    for (const status of allStatuses) {
      expect(terminal.has(status) !== inProgress.has(status)).toBe(true)
    }
  })

  it('marks cancelled/completed/failed as terminal', () => {
    expect(TERMINAL_DOWNLOAD_JOB_STATUSES).toEqual(
      expect.arrayContaining([
        DownloadJobStatus.Cancelled,
        DownloadJobStatus.Completed,
        DownloadJobStatus.Failed,
      ]),
    )
    expect(TERMINAL_DOWNLOAD_JOB_STATUSES).toHaveLength(3)
  })

  // Phase 5. `paused`/`pausing` land in "in progress" purely by being absent
  // from the terminal list - which is the whole point of deriving the
  // in-progress set by complement. Two consequences ride on it: a paused job
  // keeps its slot on the Activity feed, and `reconcileInterruptedJobs()`
  // (apps/download/src/db/reconcile-interrupted-jobs.ts) sweeps it to
  // `failed` on the next boot. Both are intended, not fallout.
  it('treats paused/pausing as in-progress, never terminal', () => {
    for (const status of [
      DownloadJobStatus.Paused,
      DownloadJobStatus.Pausing,
    ]) {
      expect(isTerminalDownloadJobStatus(status)).toBe(false)
      expect(isInProgressDownloadJobStatus(status)).toBe(true)
      expect(IN_PROGRESS_DOWNLOAD_JOB_STATUSES).toContain(status)
      expect(TERMINAL_DOWNLOAD_JOB_STATUSES).not.toContain(status)
    }

    // Pinned: adding a status must not grow the terminal list.
    expect(TERMINAL_DOWNLOAD_JOB_STATUSES).toHaveLength(3)
  })

  it('isTerminalDownloadJobStatus agrees with the two sets', () => {
    for (const status of allStatuses) {
      expect(isTerminalDownloadJobStatus(status)).toBe(
        (
          TERMINAL_DOWNLOAD_JOB_STATUSES as readonly DownloadJobStatus[]
        ).includes(status),
      )
    }
  })
})

describe('GetDownloadJobResponse', () => {
  // The deprecated tdr-bot compatibility shape (see client.ts's
  // TODO(tdr-bot-migration) block). Pinned here so a field can't quietly
  // disappear from under tdr-bot while it still reads this shape.
  it('carries exactly the flat pre-Media video fields', () => {
    const response: GetDownloadJobResponse = {
      description: 'a video',
      downloadUrls: ['https://example.com/a.mp4'],
      error: undefined,
      hiddenAttribution: false,
      id: 'video-1',
      requester: null,
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
        'hiddenAttribution',
        'id',
        'requester',
        'status',
        'timeRange',
        'title',
        'type',
        'url',
      ].sort(),
    )
  })
})

describe('isInProgressDownloadJobStatus', () => {
  it('agrees with the IN_PROGRESS_DOWNLOAD_JOB_STATUSES set', () => {
    for (const status of Object.values(DownloadJobStatus)) {
      expect(isInProgressDownloadJobStatus(status)).toBe(
        (
          IN_PROGRESS_DOWNLOAD_JOB_STATUSES as readonly DownloadJobStatus[]
        ).includes(status),
      )
    }
  })

  it('is the negation of isTerminalDownloadJobStatus', () => {
    for (const status of Object.values(DownloadJobStatus)) {
      expect(isInProgressDownloadJobStatus(status)).toBe(
        !isTerminalDownloadJobStatus(status),
      )
    }
  })
})

describe('Media guards', () => {
  const video: Media = buildVideo()
  const movie: Media = buildMovie()
  const show: Media = buildShow()
  const media = [video, movie, show]

  describe('isVideo', () => {
    it('matches only the video arm', () => {
      expect(media.filter(isVideo)).toEqual([video])
    })

    it('narrows to Video-only fields', () => {
      if (!isVideo(video)) {
        throw new Error('expected video to narrow to Video')
      }
      expect(video.sourceUrl).toBe('https://example.com/video')
    })
  })

  describe('isMovie', () => {
    it('matches only the movie arm', () => {
      expect(media.filter(isMovie)).toEqual([movie])
    })

    it('narrows to Movie-only fields', () => {
      if (!isMovie(movie)) {
        throw new Error('expected movie to narrow to Movie')
      }
      expect(movie.tmdbId).toBe(1)
    })
  })

  describe('isShow', () => {
    it('matches only the show arm', () => {
      expect(media.filter(isShow)).toEqual([show])
    })

    it('narrows to Show-only fields', () => {
      if (!isShow(show)) {
        throw new Error('expected show to narrow to Show')
      }
      expect(show.tvdbId).toBe(1)
    })
  })

  describe('isManagedMedia', () => {
    it('matches movie and show but not video', () => {
      expect(media.filter(isManagedMedia)).toEqual([movie, show])
    })
  })
})

describe('DownloadJob', () => {
  it('nests a Media object at .media and carries the shared job facts', () => {
    const job = buildJob({ media: buildMovie({ radarrId: 42 }) })

    expect(job.media.type).toBe(DownloadType.Movie)
    if (!isMovie(job.media)) {
      throw new Error('expected job.media to narrow to Movie')
    }
    expect(job.media.radarrId).toBe(42)
    expect(job.status).toBe(DownloadJobStatus.Requested)
    expect(job.completedAt).toBeNull()
  })

  it('accepts each media arm without a discriminant on DownloadJob itself', () => {
    const jobs = [
      buildJob({ media: buildVideo() }),
      buildJob({ media: buildMovie() }),
      buildJob({ media: buildShow() }),
    ]

    expect(jobs.map(job => job.media.type)).toEqual([
      DownloadType.Video,
      DownloadType.Movie,
      DownloadType.Show,
    ])
  })
})
