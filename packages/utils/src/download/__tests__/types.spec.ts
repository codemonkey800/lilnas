import {
  DEFAULT_QUALITY_TIER,
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  EmbyStatus,
  Episode,
  IN_PROGRESS_DOWNLOAD_JOB_STATUSES,
  isInProgressDownloadJobStatus,
  isManagedMedia,
  isMovie,
  isShow,
  isTerminalDownloadJobStatus,
  isVideo,
  Media,
  Movie,
  QUALITY_TIER_LABELS,
  QUALITY_TIERS,
  QualityTier,
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
    discordRequester: overrides.discordRequester ?? null,
    hiddenAttribution: overrides.hiddenAttribution ?? false,
    id: overrides.id ?? 'job-1',
    linkedDiscord: overrides.linkedDiscord ?? null,
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

  it('adds the plan 020 needs-attention member', () => {
    expect(DownloadJobStatus.NeedsAttention).toBe('needs_attention')
  })

  it('adds the plan 024 not-found member', () => {
    expect(DownloadJobStatus.NotFound).toBe('not_found')
  })
})

describe('QualityTier', () => {
  // Wire values: the server persists and maps these, so they never change.
  it('pins the wire value of every member', () => {
    expect(QualityTier.UpTo4k).toBe('up_to_4k')
    expect(QualityTier.Hd).toBe('hd')
    expect(QualityTier.UpTo720p).toBe('up_to_720p')
  })

  it('QUALITY_TIERS lists every member exactly once, best first', () => {
    expect(QUALITY_TIERS).toEqual([
      QualityTier.UpTo4k,
      QualityTier.Hd,
      QualityTier.UpTo720p,
    ])
    expect([...QUALITY_TIERS].sort()).toEqual(Object.values(QualityTier).sort())
  })

  it('QUALITY_TIER_LABELS labels every member', () => {
    for (const tier of Object.values(QualityTier)) {
      expect(QUALITY_TIER_LABELS[tier]).toEqual(expect.any(String))
      expect(QUALITY_TIER_LABELS[tier]).not.toBe('')
    }
    expect(Object.keys(QUALITY_TIER_LABELS).sort()).toEqual(
      Object.values(QualityTier).sort(),
    )
  })

  // A UI iterating the map renders it in insertion order.
  it('QUALITY_TIER_LABELS iterates best first', () => {
    expect(Object.entries(QUALITY_TIER_LABELS)).toEqual([
      [QualityTier.UpTo4k, 'Up to 4K'],
      [QualityTier.Hd, 'HD (up to 1080p)'],
      [QualityTier.UpTo720p, 'Up to 720p'],
    ])
  })

  it('defaults to HD', () => {
    expect(DEFAULT_QUALITY_TIER).toBe(QualityTier.Hd)
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

  it('marks cancelled/completed/failed/not_found as terminal', () => {
    expect(TERMINAL_DOWNLOAD_JOB_STATUSES).toEqual(
      expect.arrayContaining([
        DownloadJobStatus.Cancelled,
        DownloadJobStatus.Completed,
        DownloadJobStatus.Failed,
        DownloadJobStatus.NotFound,
      ]),
    )
    expect(TERMINAL_DOWNLOAD_JOB_STATUSES).toHaveLength(4)
  })

  // Plan 024. A search that finds nothing is over - without a terminal
  // `not_found` the job would sit in `searching` forever, and
  // `DownloadClient.waitForJob()` would never resolve for it.
  it('treats not_found as terminal, never in-progress', () => {
    const status = DownloadJobStatus.NotFound

    expect(isTerminalDownloadJobStatus(status)).toBe(true)
    expect(isInProgressDownloadJobStatus(status)).toBe(false)
    expect(IN_PROGRESS_DOWNLOAD_JOB_STATUSES).not.toContain(status)
  })

  // Phase 5. `paused`/`pausing` land in "in progress" purely by being absent
  // from the terminal list - which is the whole point of deriving the
  // in-progress set by complement. Two consequences ride on it: a paused job
  // keeps its slot on the Activity feed, and `reconcileInterruptedJobs()`
  // (apps/download/src/db/reconcile-interrupted-jobs.ts) sweeps a paused
  // video to `failed` on the next boot. Both are intended, not fallout.
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
    expect(TERMINAL_DOWNLOAD_JOB_STATUSES).toHaveLength(4)
  })

  // Plan 020. `needs_attention` is a finished-but-unimported job: the bytes
  // are on disk and a human still has to act, so it is neither `failed` (a
  // Retry would re-grab a file we already have) nor terminal. It reaches the
  // in-progress set the same way `paused` does - by being absent from the
  // terminal list - which keeps it on the Activity feed. Unlike a paused
  // video it is meant to survive a restart whatever its type, so
  // `reconcileInterruptedJobs()`
  // (apps/download/src/db/reconcile-interrupted-jobs.ts) has to exempt it
  // rather than sweep it to `failed`.
  it('treats needs_attention as in-progress, never terminal', () => {
    const status = DownloadJobStatus.NeedsAttention

    expect(isTerminalDownloadJobStatus(status)).toBe(false)
    expect(isInProgressDownloadJobStatus(status)).toBe(true)
    expect(IN_PROGRESS_DOWNLOAD_JOB_STATUSES).toContain(status)
    expect(TERMINAL_DOWNLOAD_JOB_STATUSES).not.toContain(status)

    // Pinned: adding a status must not grow the terminal list.
    expect(TERMINAL_DOWNLOAD_JOB_STATUSES).toHaveLength(4)
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

describe('EmbyStatus', () => {
  const embyStatus: EmbyStatus = {
    itemId: 'a1b2c3',
    state: 'indexed',
    watchUrl: 'https://emby.lilnas.io/web/index.html#!/item?id=a1b2c3',
  }

  it('is assignable to a Movie and a Show', () => {
    expect(buildMovie({ embyStatus }).embyStatus).toEqual(embyStatus)
    expect(buildShow({ embyStatus }).embyStatus).toEqual(embyStatus)
  })

  it('needs only state - itemId/watchUrl are for the indexed case', () => {
    const indexing: EmbyStatus = { state: 'indexing' }
    expect(buildShow({ embyStatus: indexing }).embyStatus).toEqual(indexing)
  })

  // Video extends MediaBase, not ManagedMediaBase - the compile-time half of
  // schema.spec.ts's "stripped from a video rather than rejected".
  it('is not a field on Video', () => {
    // @ts-expect-error - `embyStatus` must never reach the video arm.
    const video: Video = buildVideo({ embyStatus })

    expect(isVideo(video)).toBe(true)
  })
})

describe('currentReleaseGuid', () => {
  const currentReleaseGuid = 'indexer://f00ba7'

  it('is assignable to a Movie and to an Episode', () => {
    expect(buildMovie({ currentReleaseGuid }).currentReleaseGuid).toBe(
      currentReleaseGuid,
    )

    const episode: Episode = {
      currentReleaseGuid,
      episodeNumber: 5,
      hasFile: true,
      id: 4412,
      monitored: true,
      seasonNumber: 3,
    }
    expect(episode.currentReleaseGuid).toBe(currentReleaseGuid)
  })

  it('stays optional on both - absence is the normal case', () => {
    expect(buildMovie().currentReleaseGuid).toBeUndefined()
  })

  // A series has no single current release - the guid is per-episode - so
  // Show never gained the field. The compile-time half of schema.spec.ts's
  // "is stripped from a show rather than carried".
  it('is not a field on Show', () => {
    // @ts-expect-error - `currentReleaseGuid` must never reach the show arm.
    const show: Show = buildShow({ currentReleaseGuid })

    expect(isShow(show)).toBe(true)
  })
})
