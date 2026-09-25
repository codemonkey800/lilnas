import {
  DEFAULT_RECONNECT_DELAYS_MS,
  jobEventsSocketUrl,
  parseJobEventFrame,
  parseMediaEventFrame,
  RECONNECT_JITTER_RATIO,
  reconnectDelayMs,
} from 'src/download/job-events'
import {
  DOWNLOAD_JOB_EVENT_TYPE,
  DownloadJob,
  DownloadJobEvent,
  DownloadJobEventType,
  DownloadJobStatus,
  DownloadType,
  EpisodeStateEntry,
  MEDIA_EVENT_TYPE,
  MediaEvent,
  Show,
} from 'src/download/types'

const NOW_ISO = '2026-08-20T12:00:00.000Z'

function buildVideoJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    discordRequester: null,
    hiddenAttribution: false,
    id: 'video-1',
    linkedDiscord: null,
    media: {
      id: 'video:v1',
      sourceUrl: 'https://example.com/video',
      title: 'A video',
      type: DownloadType.Video,
    },
    requester: null,
    status: DownloadJobStatus.Pending,
    updatedAt: NOW_ISO,
    ...overrides,
  }
}

/** A well-formed gateway frame carrying `data`, as a JSON string. */
function buildFrame(
  data: unknown,
  type: string = DOWNLOAD_JOB_EVENT_TYPE,
): string {
  return JSON.stringify({ data, type })
}

/** The common case: a frame announcing `job` with the given event type. */
function buildJobFrame(
  job: DownloadJob,
  type: DownloadJobEventType = DownloadJobEventType.Updated,
): string {
  const event: DownloadJobEvent = { job, type }
  return buildFrame(event)
}

describe('parseJobEventFrame', () => {
  it('returns the job and event type for a well-formed created frame', () => {
    const job = buildVideoJob({ status: DownloadJobStatus.Downloading })

    expect(
      parseJobEventFrame(buildJobFrame(job, DownloadJobEventType.Created)),
    ).toEqual({ job, type: DownloadJobEventType.Created })
  })

  it('returns the job and event type for a well-formed updated frame', () => {
    const job = buildVideoJob({ status: DownloadJobStatus.Completed })

    expect(
      parseJobEventFrame(buildJobFrame(job, DownloadJobEventType.Updated)),
    ).toEqual({ job, type: DownloadJobEventType.Updated })
  })

  // The gateway broadcasts a full snapshot on every event, so an event type
  // nobody has taught this file about yet should still move the UI forward.
  it('normalizes an unrecognized event type to updated', () => {
    const job = buildVideoJob()

    expect(
      parseJobEventFrame(buildFrame({ job, type: 'resurrected' })),
    ).toEqual({ job, type: DownloadJobEventType.Updated })
  })

  it('parses a movie job frame, not just a video one', () => {
    const job = buildVideoJob({
      media: {
        id: 'tmdb:1',
        title: 'A Movie',
        tmdbId: 1,
        type: DownloadType.Movie,
      },
    })

    expect(parseJobEventFrame(buildJobFrame(job))?.job).toEqual(job)
  })

  it('returns undefined when the envelope type is not the job-event type', () => {
    expect(
      parseJobEventFrame(
        buildFrame(
          { job: buildVideoJob(), type: DownloadJobEventType.Updated },
          'some-other-type',
        ),
      ),
    ).toBeUndefined()
  })

  // The duck-type this replaced accepted anything with a `job` key; the
  // schema is the one the backend's wire type is inferred from, so the two
  // cannot drift.
  it('returns undefined when the payload does not parse as a DownloadJob', () => {
    expect(
      parseJobEventFrame(
        buildFrame({
          job: { id: 'video-1', status: 'not-a-real-status' },
          type: DownloadJobEventType.Updated,
        }),
      ),
    ).toBeUndefined()
  })

  it('round-trips a video job frame carrying progress', () => {
    const job = buildVideoJob({
      progress: {
        downloadedBytes: 27851094,
        etaSeconds: 31.97,
        fileIndex: 1,
        fragmentCount: 123,
        fragmentIndex: 4,
        percent: 4.07,
        speedBps: 18432231.02,
        totalBytes: 685111722,
        totalIsEstimate: true,
      },
      status: DownloadJobStatus.Downloading,
    })

    expect(parseJobEventFrame(buildJobFrame(job))).toEqual({
      job,
      type: DownloadJobEventType.Updated,
    })
  })

  // A bad `progress` is a bad field like any other: the whole frame is
  // dropped, not just the field. The page keeps its last good snapshot and
  // the next frame replaces it.
  it('drops a frame whose progress is malformed', () => {
    const job = buildVideoJob({
      progress: { downloadedBytes: 1, fileIndex: 1, percent: 101 },
      status: DownloadJobStatus.Downloading,
    })

    expect(parseJobEventFrame(buildJobFrame(job))).toBeUndefined()
  })

  it('returns undefined for malformed JSON', () => {
    expect(parseJobEventFrame('{not json')).toBeUndefined()
  })

  it('returns undefined when the envelope carries no data', () => {
    expect(
      parseJobEventFrame(JSON.stringify({ type: DOWNLOAD_JOB_EVENT_TYPE })),
    ).toBeUndefined()
  })

  it('returns undefined when the data has no job', () => {
    expect(
      parseJobEventFrame(buildFrame({ type: DownloadJobEventType.Updated })),
    ).toBeUndefined()
  })

  it('returns undefined for non-string message data', () => {
    expect(parseJobEventFrame({ not: 'a string' })).toBeUndefined()
  })
})

describe('parseMediaEventFrame', () => {
  const show: Show = {
    episodeCount: 10,
    episodeFileCount: 4,
    id: 'tvdb:121361',
    queueSnapshot: {
      progress: 42,
      status: 'downloading',
      timeLeft: '00:10:00',
    },
    sonarrId: 7,
    state: 'downloading',
    stateReason: 'Grabbing S01E05',
    title: 'A Show',
    tvdbId: 121361,
    type: DownloadType.Show,
  }

  const episodes: EpisodeStateEntry[] = [
    {
      episodeId: 101,
      queueSnapshot: { progress: 42 },
      seasonNumber: 1,
      state: 'downloading',
    },
    { episodeId: 102, seasonNumber: 0, state: 'available' },
  ]

  function buildMediaFrame(data: unknown): string {
    return buildFrame(data, MEDIA_EVENT_TYPE)
  }

  it('returns the media and episodes for a well-formed show frame', () => {
    const event: MediaEvent = { episodes, media: show }

    expect(parseMediaEventFrame(buildMediaFrame(event))).toEqual(event)
  })

  it('returns the media alone when the frame carries no episodes', () => {
    const media = {
      id: 'tmdb:1',
      state: 'available',
      title: 'A Movie',
      tmdbId: 1,
      type: DownloadType.Movie,
    }

    const event = parseMediaEventFrame(buildMediaFrame({ media }))

    expect(event).toEqual({ media })
    expect(event).not.toHaveProperty('episodes')
  })

  // The state chip reads `media`; a bad episode row must not freeze it.
  it('returns the media with episodes omitted when episodes fail the schema', () => {
    const event = parseMediaEventFrame(
      buildMediaFrame({
        episodes: [{ episodeId: -1, seasonNumber: 1, state: 'not-a-state' }],
        media: show,
      }),
    )

    expect(event).toEqual({ media: show })
    expect(event).not.toHaveProperty('episodes')
  })

  it('returns the media with episodes omitted when episodes is not an array', () => {
    expect(
      parseMediaEventFrame(buildMediaFrame({ episodes: null, media: show })),
    ).toEqual({ media: show })
  })

  it('returns undefined when the media does not parse as a Media', () => {
    expect(
      parseMediaEventFrame(
        buildMediaFrame({
          episodes,
          media: { ...show, state: 'not-a-real-state' },
        }),
      ),
    ).toBeUndefined()
  })

  it('returns undefined when the data has no media', () => {
    expect(parseMediaEventFrame(buildMediaFrame({ episodes }))).toBeUndefined()
  })

  it('returns undefined when the envelope carries no data', () => {
    expect(
      parseMediaEventFrame(JSON.stringify({ type: MEDIA_EVENT_TYPE })),
    ).toBeUndefined()
  })

  it('returns undefined when the envelope type is not the media-event type', () => {
    expect(
      parseMediaEventFrame(buildFrame({ media: show }, 'some-other-type')),
    ).toBeUndefined()
  })

  it('returns undefined for an envelope without a string type', () => {
    expect(
      parseMediaEventFrame(JSON.stringify({ data: { media: show } })),
    ).toBeUndefined()
  })

  it('returns undefined for malformed JSON', () => {
    expect(parseMediaEventFrame('{not json')).toBeUndefined()
  })

  it('returns undefined for non-string message data', () => {
    expect(parseMediaEventFrame({ media: show })).toBeUndefined()
  })

  // The two parsers share one socket; each must ignore the other's frames.
  it('returns undefined for a job frame', () => {
    expect(parseMediaEventFrame(buildJobFrame(buildVideoJob()))).toBeUndefined()
  })

  it('leaves parseJobEventFrame returning undefined for a media frame', () => {
    expect(
      parseJobEventFrame(buildMediaFrame({ episodes, media: show })),
    ).toBeUndefined()
  })
})

describe('jobEventsSocketUrl', () => {
  it('maps an absolute http base to ws, keeping host:port', () => {
    expect(jobEventsSocketUrl('http://download:8081')).toBe(
      'ws://download:8081/ws',
    )
  })

  it('maps an absolute https base to wss, keeping host:port', () => {
    expect(jobEventsSocketUrl('https://download.lilnas.io:8443')).toBe(
      'wss://download.lilnas.io:8443/ws',
    )
  })

  it('maps an absolute http base with no explicit port', () => {
    expect(jobEventsSocketUrl('http://localhost:8081')).toBe(
      'ws://localhost:8081/ws',
    )
  })

  it('derives the origin from location for a relative base', () => {
    expect(
      jobEventsSocketUrl('/api', {
        host: 'download.lilnas.io',
        protocol: 'https:',
      }),
    ).toBe('wss://download.lilnas.io/ws')
  })

  it('throws when a relative base is given with no location', () => {
    expect(() => jobEventsSocketUrl('/api')).toThrow()
  })
})

describe('reconnectDelayMs', () => {
  it('clamps to the last rung and jitters within ±20% of it', () => {
    const delays = DEFAULT_RECONNECT_DELAYS_MS
    const lastRung = delays[delays.length - 1] ?? 0
    const minDelay = Math.round(lastRung * (1 - RECONNECT_JITTER_RATIO))
    const maxDelay = Math.round(lastRung * (1 + RECONNECT_JITTER_RATIO))

    // An attempt far beyond the ladder's length still clamps to the last
    // rung rather than indexing past the end of the array.
    const delay = reconnectDelayMs(delays.length + 5, delays, Math.random)

    expect(delay).toBeGreaterThanOrEqual(minDelay)
    expect(delay).toBeLessThanOrEqual(maxDelay)
  })
})
