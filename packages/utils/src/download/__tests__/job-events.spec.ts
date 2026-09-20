import {
  DEFAULT_RECONNECT_DELAYS_MS,
  jobEventsSocketUrl,
  parseJobEventFrame,
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
