import type { HistoryResource as RadarrHistoryResource } from '@lilnas/media/radarr'
import type { HistoryResource as SonarrHistoryResource } from '@lilnas/media/sonarr'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import {
  type ArrEvent,
  type ArrHistoryRecord,
  type ClaimableJob,
  claimGrab,
  normalizeHistory,
} from 'src/media/history-events.util'

// - Fixtures follow prod Radarr 6.4.4 / Sonarr 4.0.20 records: nulls
//   omitted, every `data` value a string, `downloadUrl` carrying the
//   indexer key.
const RADARR_GRAB: RadarrHistoryResource = {
  data: {
    downloadClient: 'SABnzbd',
    downloadUrl: 'https://api.nzbgeek.info/api?t=get&id=abc&apikey=SECRET',
    indexer: 'NzbGeek',
    protocol: '1',
    releaseSource: 'InteractiveSearch',
    size: '4419036486',
  },
  date: '2026-08-22T03:54:14Z',
  downloadId: '16409e20-0c1f-4b8e-9a51-7f1d2c3b4a5e',
  eventType: 'grabbed',
  id: 1124,
  movieId: 119,
  sourceTitle: 'Some.Movie.2026.1080p.WEB-DL-GROUP',
}

const SONARR_GRAB: SonarrHistoryResource = {
  data: {
    downloadUrl: 'https://althub.co.za/api?t=get&id=xyz&apikey=SECRET',
    indexer: 'AltHub',
    protocol: '1',
    releaseSource: 'Rss',
    releaseType: 'SingleEpisode',
    size: '1168284398',
  },
  date: '2026-09-25T08:32:42Z',
  downloadId: '99a62b9e-5d7a-4c3e-8f21-0a9b8c7d6e5f',
  episode: { episodeNumber: 5, id: 22364, seasonNumber: 3, seriesId: 187 },
  episodeId: 22364,
  eventType: 'grabbed',
  id: 16452,
  seriesId: 187,
}

function radarr(overrides: Partial<ArrHistoryRecord> = {}): ArrHistoryRecord {
  return { ...RADARR_GRAB, ...overrides } as ArrHistoryRecord
}

function sonarr(overrides: Partial<ArrHistoryRecord> = {}): ArrHistoryRecord {
  return { ...SONARR_GRAB, ...overrides } as ArrHistoryRecord
}

/** The one event `records` normalize to - fails the test otherwise. */
function first(
  app: 'radarr' | 'sonarr',
  records: readonly ArrHistoryRecord[],
): ArrEvent {
  const events = normalizeHistory(app, records)
  expect(events).toHaveLength(1)
  return events[0] as ArrEvent
}

describe('normalizeHistory', () => {
  it('accepts both SDK HistoryResource types as records', () => {
    // - Compile-time check: the generated types assign without a cast.
    const radarrRecords: ArrHistoryRecord[] = [RADARR_GRAB]
    const sonarrRecords: ArrHistoryRecord[] = [SONARR_GRAB]
    expect(radarrRecords).toHaveLength(1)
    expect(sonarrRecords).toHaveLength(1)
  })

  it('normalizes a Radarr grab to exactly the picked keys', () => {
    expect(normalizeHistory('radarr', [RADARR_GRAB])).toStrictEqual([
      {
        app: 'radarr',
        date: '2026-08-22T03:54:14Z',
        downloadId: '16409e20-0c1f-4b8e-9a51-7f1d2c3b4a5e',
        id: 1124,
        interactive: true,
        kind: 'grabbed',
        movieId: 119,
      },
    ])
  })

  it('normalizes a Sonarr grab, copying season/episode from the included episode', () => {
    expect(normalizeHistory('sonarr', [SONARR_GRAB])).toStrictEqual([
      {
        app: 'sonarr',
        date: '2026-09-25T08:32:42Z',
        downloadId: '99a62b9e-5d7a-4c3e-8f21-0a9b8c7d6e5f',
        episodeId: 22364,
        episodeNumber: 5,
        id: 16452,
        interactive: false,
        kind: 'grabbed',
        seasonNumber: 3,
        seriesId: 187,
      },
    ])
  })

  it('omits season/episode numbers when the record has no episode', () => {
    const event = first('sonarr', [sonarr({ episode: undefined })])
    expect(event).not.toHaveProperty('seasonNumber')
    expect(event).not.toHaveProperty('episodeNumber')
    expect(event.episodeId).toBe(22364)
  })

  it('keeps season 0', () => {
    const event = first('sonarr', [
      sonarr({ episode: { episodeNumber: 1, seasonNumber: 0 } }),
    ])
    expect(event.seasonNumber).toBe(0)
  })

  it('never copies data keys other than the ones it reads', () => {
    const events = normalizeHistory('radarr', [RADARR_GRAB])
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('SECRET')
    expect(serialized).not.toContain('downloadUrl')
    expect(serialized).not.toContain('NzbGeek')
    expect(events[0]).not.toHaveProperty('data')
    expect(events[0]).not.toHaveProperty('sourceTitle')
  })

  it.each([
    ['grabbed', 'grabbed'],
    ['downloadFolderImported', 'imported'],
    ['downloadFailed', 'failed'],
    ['downloadIgnored', 'ignored'],
  ] as const)('maps the string eventType %s to %s', (eventType, kind) => {
    for (const app of ['radarr', 'sonarr'] as const) {
      const record =
        app === 'radarr' ? radarr({ eventType }) : sonarr({ eventType })
      expect(normalizeHistory(app, [record])[0]?.kind).toBe(kind)
    }
  })

  it.each([
    ['radarr', 1, 'grabbed'],
    ['radarr', 3, 'imported'],
    ['radarr', 4, 'failed'],
    ['radarr', 9, 'ignored'],
    ['sonarr', 1, 'grabbed'],
    ['sonarr', 3, 'imported'],
    ['sonarr', 4, 'failed'],
    ['sonarr', 7, 'ignored'],
  ] as const)('maps %s numeric eventType %i to %s', (app, eventType, kind) => {
    const record =
      app === 'radarr' ? radarr({ eventType }) : sonarr({ eventType })
    expect(normalizeHistory(app, [record])[0]?.kind).toBe(kind)
  })

  it('accepts a numeric eventType sent as a digit string', () => {
    expect(
      normalizeHistory('sonarr', [sonarr({ eventType: '7' })])[0]?.kind,
    ).toBe('ignored')
  })

  it.each([
    ['radarr', 0],
    ['radarr', 2],
    ['radarr', 5],
    ['radarr', 6],
    ['radarr', 7],
    ['radarr', 8],
    ['sonarr', 0],
    ['sonarr', 2],
    ['sonarr', 5],
    ['sonarr', 6],
    ['sonarr', 9],
  ] as const)('drops %s numeric eventType %i', (app, eventType) => {
    const record =
      app === 'radarr' ? radarr({ eventType }) : sonarr({ eventType })
    expect(normalizeHistory(app, [record])).toEqual([])
  })

  it.each([
    'unknown',
    'movieFileDeleted',
    'movieFileRenamed',
    'movieFolderImported',
    'episodeFileDeleted',
    'episodeFileRenamed',
    'seriesFolderImported',
    'toString',
    'constructor',
  ])('drops the %s event type', eventType => {
    expect(normalizeHistory('radarr', [radarr({ eventType })])).toEqual([])
    expect(normalizeHistory('sonarr', [sonarr({ eventType })])).toEqual([])
  })

  it('drops records without a downloadId, id or valid date', () => {
    expect(
      normalizeHistory('radarr', [
        radarr({ downloadId: undefined }),
        radarr({ downloadId: null }),
        radarr({ downloadId: '' }),
        radarr({ id: undefined }),
        radarr({ date: undefined }),
        radarr({ date: 'not a date' }),
        radarr({ eventType: undefined }),
      ]),
    ).toEqual([])
  })

  it('sorts by (date, id), including a tie whose ids descend', () => {
    const events = normalizeHistory('sonarr', [
      sonarr({ date: '2026-09-25T08:32:43Z', id: 10 }),
      sonarr({ date: '2026-09-25T08:32:42Z', id: 16460 }),
      sonarr({ date: '2026-09-25T08:32:42Z', id: 16455 }),
      sonarr({ date: '2026-09-25T08:32:42Z', id: 16452 }),
      sonarr({ date: '2026-09-25T08:32:41Z', id: 99999 }),
    ])
    expect(events.map(event => event.id)).toEqual([
      99999, 16452, 16455, 16460, 10,
    ])
  })

  it('sorts by instant, not by string, across date formats', () => {
    const events = normalizeHistory('radarr', [
      radarr({ date: '2026-08-22T03:54:14Z', id: 1 }),
      radarr({ date: '2026-08-22T03:54:13.500Z', id: 2 }),
    ])
    expect(events.map(event => event.id)).toEqual([2, 1])
  })

  describe('failures', () => {
    const failed = (data: Record<string, string>) => ({
      data,
      eventType: 'downloadFailed',
    })

    it.each([
      'Aborted, cannot be completed - https://sabnzbd.org/not-complete',
      'Repair failed, not enough repair blocks (3 short)',
      'Unpacking failed, see logfile',
    ])('keeps an automatic failure as failed with its message: %s', message => {
      for (const app of ['radarr', 'sonarr'] as const) {
        const record =
          app === 'radarr'
            ? radarr(failed({ message }))
            : sonarr(failed({ message }))
        const event = first(app, [record])
        expect(event.kind).toBe('failed')
        expect(event.message).toBe(message)
        // - A failed record carries no releaseSource; the poller looks the
        //   grab up for that.
        expect(event).not.toHaveProperty('interactive')
      }
    })

    it('marks a manual failure by its message', () => {
      const event = first('radarr', [
        radarr(failed({ message: 'Manually marked as failed' })),
      ])
      expect(event.kind).toBe('manualFailed')
      expect(event.message).toBe('Manually marked as failed')
    })

    it('marks a Sonarr v5 manual failure by data.source', () => {
      const event = first('sonarr', [
        sonarr(failed({ message: 'Marked as failed', source: 'UI' })),
      ])
      expect(event.kind).toBe('manualFailed')
    })

    // - v5's queue "mark failed" stores the caller's `X-Sonarr-Client`
    //   header (`Sonarr` from its own web UI) or a client parsed from the
    //   User-Agent, alongside whatever message the caller gave.
    it.each(['Sonarr', 'LunaSea'])(
      'marks a Sonarr v5 failure from client %s as manual whatever its message',
      source => {
        const event = first('sonarr', [
          sonarr(failed({ message: 'Wrong language', source })),
        ])
        expect(event.kind).toBe('manualFailed')
        expect(event.message).toBe('Wrong language')
      },
    )

    it('keeps a Sonarr v5 automatic failure as failed', () => {
      const event = first('sonarr', [
        sonarr(
          failed({
            message: 'Unpacking failed, see logfile',
            source: 'Sonarr Failed Download Handling',
          }),
        ),
      ])
      expect(event.kind).toBe('failed')
    })
  })

  it('reads an ignored event and its message', () => {
    const event = first('radarr', [
      radarr({
        data: { message: 'Manually ignored' },
        eventType: 'downloadIgnored',
      }),
    ])
    expect(event).toMatchObject({
      kind: 'ignored',
      message: 'Manually ignored',
    })
  })

  it.each([
    ['InteractiveSearch', true],
    ['Rss', false],
    ['Search', false],
    ['UserInvokedSearch', false],
    ['ReleasePush', false],
    ['Unknown', false],
  ])('sets interactive from releaseSource %s', (releaseSource, interactive) => {
    const event = first('radarr', [radarr({ data: { releaseSource } })])
    expect(event.interactive).toBe(interactive)
  })

  it('leaves interactive and message undefined with no data at all', () => {
    const event = first('radarr', [radarr({ data: undefined })])
    expect(event).not.toHaveProperty('interactive')
    expect(event).not.toHaveProperty('message')
  })

  it('normalizes each episode of a season pack to its own event', () => {
    const pack = [16452, 16453, 16454].map((id, index) =>
      sonarr({
        data: { releaseSource: 'Search', releaseType: 'SeasonPack' },
        episode: { episodeNumber: index + 1, seasonNumber: 3 },
        episodeId: 22364 + index,
        id,
      }),
    )
    const events = normalizeHistory('sonarr', pack)
    expect(events.map(event => event.episodeId)).toEqual([22364, 22365, 22366])
    expect(new Set(events.map(event => event.downloadId)).size).toBe(1)
  })
})

describe('claimGrab', () => {
  const GRAB_DATE = '2026-09-25T08:32:42Z'

  function grab(overrides: Partial<ArrEvent> = {}): ArrEvent {
    return {
      app: 'sonarr',
      date: GRAB_DATE,
      downloadId: 'dl-1',
      episodeId: 22364,
      episodeNumber: 5,
      id: 1,
      kind: 'grabbed',
      seasonNumber: 3,
      seriesId: 187,
      ...overrides,
    }
  }

  function movieGrab(overrides: Partial<ArrEvent> = {}): ArrEvent {
    return {
      app: 'radarr',
      date: GRAB_DATE,
      downloadId: 'dl-m',
      id: 2,
      kind: 'grabbed',
      movieId: 119,
      ...overrides,
    }
  }

  function job(
    overrides: Partial<ClaimableJob> & { id: string },
  ): ClaimableJob {
    return {
      createdAt: '2026-09-25T08:30:00Z',
      scope: undefined,
      status: DownloadJobStatus.Searching,
      type: DownloadType.Show,
      upstreamId: 187,
      ...overrides,
    }
  }

  function movieJob(
    overrides: Partial<ClaimableJob> & { id: string },
  ): ClaimableJob {
    return job({ type: DownloadType.Movie, upstreamId: 119, ...overrides })
  }

  describe('rule 1: open, same type and title', () => {
    it('claims a movie grab for the movie job', () => {
      expect(claimGrab(movieGrab(), [movieJob({ id: 'm' })])).toBe('m')
    })

    it('ignores a job for another title', () => {
      expect(
        claimGrab(movieGrab(), [movieJob({ id: 'm', upstreamId: 120 })]),
      ).toBeUndefined()
    })

    it('ignores a job of the other type with the same upstream id', () => {
      expect(
        claimGrab(movieGrab({ movieId: 187 }), [job({ id: 'show' })]),
      ).toBeUndefined()
      expect(
        claimGrab(grab({ seriesId: 119 }), [movieJob({ id: 'movie' })]),
      ).toBeUndefined()
    })

    it('ignores a video job and an unresolved job', () => {
      expect(
        claimGrab(movieGrab(), [
          movieJob({ id: 'video', type: DownloadType.Video }),
          movieJob({ id: 'unresolved', upstreamId: null }),
        ]),
      ).toBeUndefined()
    })

    it.each([
      DownloadJobStatus.Completed,
      DownloadJobStatus.Failed,
      DownloadJobStatus.Cancelled,
    ])('ignores a %s job', status => {
      expect(
        claimGrab(movieGrab(), [movieJob({ id: 'm', status })]),
      ).toBeUndefined()
    })

    it('claims nothing for an event with no title id', () => {
      expect(
        claimGrab(movieGrab({ movieId: undefined }), [movieJob({ id: 'm' })]),
      ).toBeUndefined()
    })

    it('claims nothing for a non-grab event', () => {
      expect(
        claimGrab(movieGrab({ kind: 'failed' }), [movieJob({ id: 'm' })]),
      ).toBeUndefined()
    })
  })

  describe('rule 2: scope covers the event', () => {
    it('an episode job covers only its episode', () => {
      const jobs = [
        job({ id: 'e', scope: { episodeId: 22364, seasonNumber: 3 } }),
      ]
      expect(claimGrab(grab(), jobs)).toBe('e')
      expect(claimGrab(grab({ episodeId: 22365 }), jobs)).toBeUndefined()
    })

    it('a season job covers only its season', () => {
      const jobs = [job({ id: 's', scope: { seasonNumber: 3 } })]
      expect(claimGrab(grab(), jobs)).toBe('s')
      expect(claimGrab(grab({ seasonNumber: 4 }), jobs)).toBeUndefined()
    })

    it('a season job cannot claim an event with no season', () => {
      expect(
        claimGrab(grab({ seasonNumber: undefined }), [
          job({ id: 's', scope: { seasonNumber: 3 } }),
        ]),
      ).toBeUndefined()
    })

    it('a whole-series job covers any episode, with or without a season', () => {
      const jobs = [job({ id: 'series', scope: null })]
      expect(claimGrab(grab(), jobs)).toBe('series')
      expect(claimGrab(grab({ seasonNumber: undefined }), jobs)).toBe('series')
    })

    it('treats season 0 as a real season', () => {
      const jobs = [
        job({ id: 's0', scope: { seasonNumber: 0 } }),
        job({ id: 's1', scope: { seasonNumber: 1 } }),
      ]
      expect(claimGrab(grab({ seasonNumber: 0 }), jobs)).toBe('s0')
      expect(claimGrab(grab({ seasonNumber: 1 }), jobs)).toBe('s1')
    })
  })

  describe('rule 3: status', () => {
    it.each([
      DownloadJobStatus.Requested,
      DownloadJobStatus.Searching,
      DownloadJobStatus.Downloading,
      DownloadJobStatus.Importing,
      DownloadJobStatus.Cancelling,
    ])('claims for a %s job', status => {
      expect(claimGrab(movieGrab(), [movieJob({ id: 'm', status })])).toBe('m')
    })

    it.each([
      DownloadJobStatus.Pending,
      DownloadJobStatus.Paused,
      DownloadJobStatus.Pausing,
      DownloadJobStatus.NeedsAttention,
      DownloadJobStatus.Converting,
      DownloadJobStatus.Uploading,
      DownloadJobStatus.Cleaning,
    ])('does not claim for a %s job', status => {
      expect(
        claimGrab(movieGrab(), [movieJob({ id: 'm', status })]),
      ).toBeUndefined()
    })
  })

  describe('rule 4: created no later than 5 s after the grab', () => {
    it.each([
      ['2026-09-25T08:32:47Z', 'm'],
      ['2026-09-25T08:32:47.000Z', 'm'],
      ['2026-09-25T08:32:47.001Z', undefined],
      ['2026-09-25T08:33:00Z', undefined],
    ])('createdAt %s -> %s', (createdAt, expected) => {
      expect(claimGrab(movieGrab(), [movieJob({ createdAt, id: 'm' })])).toBe(
        expected,
      )
    })

    it('accepts Date values from a job row', () => {
      expect(
        claimGrab(movieGrab(), [
          movieJob({ createdAt: new Date('2026-09-25T08:32:45Z'), id: 'm' }),
        ]),
      ).toBe('m')
    })
  })

  describe('rule 5: tie-breaks', () => {
    it('prefers the narrowest scope: episode, then season, then series', () => {
      const series = job({ createdAt: '2026-09-25T08:00:00Z', id: 'series' })
      const season = job({
        createdAt: '2026-09-25T08:10:00Z',
        id: 'season',
        scope: { seasonNumber: 3 },
      })
      const episode = job({
        createdAt: '2026-09-25T08:20:00Z',
        id: 'episode',
        scope: { episodeId: 22364, seasonNumber: 3 },
      })
      expect(claimGrab(grab(), [series, season, episode])).toBe('episode')
      expect(claimGrab(grab(), [series, season])).toBe('season')
    })

    it('then prefers the oldest job', () => {
      expect(
        claimGrab(grab(), [
          job({
            createdAt: '2026-09-25T08:31:00Z',
            id: 'newer',
            scope: { seasonNumber: 3 },
          }),
          job({
            createdAt: '2026-09-25T08:30:00Z',
            id: 'older',
            scope: { seasonNumber: 3 },
          }),
        ]),
      ).toBe('older')
    })

    it('prefers a job whose command predates the grab over a narrower, older one', () => {
      const episode = job({
        createdAt: '2026-09-25T08:00:00Z',
        id: 'episode',
        scope: { episodeId: 22364 },
      })
      const series = job({
        createdAt: '2026-09-25T08:30:00Z',
        id: 'series',
        upstreamCommandAt: '2026-09-25T08:32:40Z',
      })
      expect(claimGrab(grab(), [episode, series])).toBe('series')
    })

    it('ignores a command sent after the grab', () => {
      const older = movieJob({ createdAt: '2026-09-25T08:00:00Z', id: 'older' })
      const later = movieJob({
        createdAt: '2026-09-25T08:30:00Z',
        id: 'later',
        upstreamCommandAt: '2026-09-25T08:32:43Z',
      })
      expect(claimGrab(movieGrab(), [later, older])).toBe('older')
    })

    it('compares the command time at the grab date’s second precision', () => {
      const older = movieJob({ createdAt: '2026-09-25T08:00:00Z', id: 'older' })
      const commanded = movieJob({
        createdAt: '2026-09-25T08:30:00Z',
        id: 'commanded',
        upstreamCommandAt: new Date('2026-09-25T08:32:42.400Z'),
      })
      expect(claimGrab(movieGrab(), [older, commanded])).toBe('commanded')
    })

    it('when every candidate was commanded, still prefers the narrowest', () => {
      const commandAt = '2026-09-25T08:32:00Z'
      expect(
        claimGrab(grab(), [
          job({
            createdAt: '2026-09-25T08:00:00Z',
            id: 'series',
            upstreamCommandAt: commandAt,
          }),
          job({
            createdAt: '2026-09-25T08:10:00Z',
            id: 'season',
            scope: { seasonNumber: 3 },
            upstreamCommandAt: commandAt,
          }),
        ]),
      ).toBe('season')
    })
  })

  it('gives every per-episode grab of a season pack the same job', () => {
    const records = [22364, 22365, 22366].map((episodeId, index) =>
      sonarr({
        data: { releaseSource: 'Search', releaseType: 'SeasonPack' },
        episode: { episodeNumber: index + 1, seasonNumber: 3 },
        episodeId,
        id: 16452 - index,
      }),
    )
    const jobs = [
      job({ createdAt: '2026-09-25T08:00:00Z', id: 'series' }),
      job({
        createdAt: '2026-09-25T08:30:00Z',
        id: 'season-3',
        scope: { seasonNumber: 3 },
        status: DownloadJobStatus.Searching,
        upstreamCommandAt: '2026-09-25T08:30:01Z',
      }),
      job({ id: 'season-4', scope: { seasonNumber: 4 } }),
    ]

    const events = normalizeHistory('sonarr', records)
    expect(events).toHaveLength(3)
    expect(events.map(event => claimGrab(event, jobs))).toEqual([
      'season-3',
      'season-3',
      'season-3',
    ])
  })
})
