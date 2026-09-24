import type { ShowScope } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import {
  type AdoptionCandidate,
  type AdoptionOpenJob,
  isAdoptable,
  planAdoptions,
} from 'src/media/adoption.util'
import type { PollableQueueItem } from 'src/media/queue-status.util'

const NO_CLAIMS: ReadonlySet<string> = new Set()

function movieItem(
  overrides: Partial<PollableQueueItem> = {},
): PollableQueueItem {
  return {
    downloadId: 'movie-dl',
    id: 1,
    movieId: 10,
    size: 1000,
    sizeleft: 500,
    status: 'downloading',
    trackedDownloadState: 'downloading',
    trackedDownloadStatus: 'ok',
    ...overrides,
  }
}

function episodeItem(
  episodeId: number,
  seasonNumber: number,
  overrides: Partial<PollableQueueItem> = {},
): PollableQueueItem {
  return {
    downloadId: `ep-dl-${episodeId}`,
    episodeId,
    id: episodeId + 1000,
    seasonNumber,
    seriesId: 20,
    size: 1000,
    sizeleft: 500,
    status: 'downloading',
    trackedDownloadState: 'downloading',
    trackedDownloadStatus: 'ok',
    ...overrides,
  }
}

/** Three S2 episodes Sonarr queued from one season pack. */
const SEASON_PACK = [
  episodeItem(201, 2, { downloadId: 'pack', id: 1 }),
  episodeItem(202, 2, { downloadId: 'pack', id: 2 }),
  episodeItem(203, 2, { downloadId: 'pack', id: 3 }),
]

describe('planAdoptions', () => {
  describe('movies', () => {
    it('makes one candidate of a movie item no job covers', () => {
      const item = movieItem()

      expect(planAdoptions(DownloadType.Movie, [item], [], NO_CLAIMS)).toEqual<
        AdoptionCandidate[]
      >([
        {
          downloadId: 'movie-dl',
          items: [item],
          scope: undefined,
          status: DownloadJobStatus.Downloading,
          type: DownloadType.Movie,
          upstreamId: 10,
        },
      ])
    })

    it.each<[string, number, AdoptionOpenJob[], ReadonlySet<string>]>([
      ['an open job on the same movie', 0, [{ upstreamId: 10 }], NO_CLAIMS],
      ['an open job on another movie', 1, [{ upstreamId: 11 }], NO_CLAIMS],
      ['its downloadId claimed', 0, [], new Set(['movie-dl'])],
      ['another downloadId claimed', 1, [], new Set(['other'])],
    ])('with %s, adopts %i', (_label, expected, openJobs, claimed) => {
      expect(
        planAdoptions(DownloadType.Movie, [movieItem()], openJobs, claimed),
      ).toHaveLength(expected)
    })

    it.each<[string, Partial<PollableQueueItem>]>([
      ['status failed', { status: 'failed' }],
      ['trackedDownloadStatus error', { trackedDownloadStatus: 'error' }],
    ])('skips an item whose derived status is terminal (%s)', (_l, fields) => {
      expect(
        planAdoptions(DownloadType.Movie, [movieItem(fields)], [], NO_CLAIMS),
      ).toEqual([])
    })

    it.each<[string, Partial<PollableQueueItem>, DownloadJobStatus]>([
      [
        'a finished download still importing',
        { status: 'completed', trackedDownloadState: 'importing' },
        DownloadJobStatus.Importing,
      ],
      [
        'a stuck import',
        { status: 'completed', trackedDownloadState: 'importPending' },
        DownloadJobStatus.NeedsAttention,
      ],
      ['a paused download', { status: 'paused' }, DownloadJobStatus.Paused],
    ])('adopts %s with its derived status', (_l, fields, status) => {
      const [candidate] = planAdoptions(
        DownloadType.Movie,
        [movieItem(fields)],
        [],
        NO_CLAIMS,
      )

      expect(candidate?.status).toBe(status)
    })

    it('skips a group when any of its items has failed', () => {
      const items = [
        movieItem({ id: 1 }),
        movieItem({ id: 2, status: 'failed' }),
      ]

      expect(planAdoptions(DownloadType.Movie, items, [], NO_CLAIMS)).toEqual(
        [],
      )
    })

    it.each([
      ['null', null],
      ['absent', undefined],
    ])('ignores an item whose movieId is %s', (_l, movieId) => {
      expect(
        planAdoptions(
          DownloadType.Movie,
          [movieItem({ movieId })],
          [],
          NO_CLAIMS,
        ),
      ).toEqual([])
    })

    it('ignores a Sonarr item when planning movies', () => {
      expect(
        planAdoptions(DownloadType.Movie, [episodeItem(1, 1)], [], NO_CLAIMS),
      ).toEqual([])
    })

    it('makes a separate candidate of each item with no downloadId', () => {
      const items = [
        movieItem({ downloadId: null, id: 1 }),
        movieItem({ downloadId: undefined, id: 2 }),
      ]

      const candidates = planAdoptions(DownloadType.Movie, items, [], NO_CLAIMS)

      expect(candidates.map(candidate => candidate.items)).toEqual([
        [items[0]],
        [items[1]],
      ])
      expect(candidates.map(candidate => candidate.downloadId)).toEqual([
        undefined,
        undefined,
      ])
    })

    it('does not merge two items with neither a downloadId nor an id', () => {
      const items = [
        movieItem({ downloadId: null, id: undefined }),
        movieItem({ downloadId: null, id: undefined }),
      ]

      expect(
        planAdoptions(DownloadType.Movie, items, [], NO_CLAIMS),
      ).toHaveLength(2)
    })

    it('keeps one downloadId on two movies as two candidates', () => {
      const items = [
        movieItem({ id: 1, movieId: 10 }),
        movieItem({ id: 2, movieId: 11 }),
      ]

      expect(
        planAdoptions(DownloadType.Movie, items, [], NO_CLAIMS).map(
          candidate => candidate.upstreamId,
        ),
      ).toEqual([10, 11])
    })

    it('returns candidates in queue order', () => {
      const items = [
        movieItem({ downloadId: 'c', id: 1, movieId: 3 }),
        movieItem({ downloadId: 'a', id: 2, movieId: 1 }),
        movieItem({ downloadId: 'b', id: 3, movieId: 2 }),
        movieItem({ downloadId: 'a', id: 4, movieId: 1 }),
      ]

      expect(
        planAdoptions(DownloadType.Movie, items, [], NO_CLAIMS).map(
          candidate => candidate.downloadId,
        ),
      ).toEqual(['c', 'a', 'b'])
    })
  })

  describe('shows', () => {
    it('makes one season-scoped candidate of a season pack', () => {
      const candidates = planAdoptions(
        DownloadType.Show,
        SEASON_PACK,
        [],
        NO_CLAIMS,
      )

      expect(candidates).toEqual<AdoptionCandidate[]>([
        {
          downloadId: 'pack',
          items: SEASON_PACK,
          scope: { seasonNumber: 2 },
          status: DownloadJobStatus.Downloading,
          type: DownloadType.Show,
          upstreamId: 20,
        },
      ])
    })

    it.each<[string, PollableQueueItem[], ShowScope | undefined]>([
      [
        'one episode',
        [episodeItem(203, 2)],
        { episodeId: 203, seasonNumber: 2 },
      ],
      [
        'one special (season 0)',
        [episodeItem(5, 0)],
        { episodeId: 5, seasonNumber: 0 },
      ],
      [
        'one episode with no season number',
        [episodeItem(203, 2, { seasonNumber: null })],
        { episodeId: 203 },
      ],
      [
        'several specials',
        [
          episodeItem(5, 0, { downloadId: 'x' }),
          episodeItem(6, 0, { downloadId: 'x' }),
        ],
        { seasonNumber: 0 },
      ],
      [
        'episodes spanning seasons',
        [
          episodeItem(101, 1, { downloadId: 'x' }),
          episodeItem(201, 2, { downloadId: 'x' }),
        ],
        undefined,
      ],
      [
        'the same episode twice',
        [
          episodeItem(203, 2, { downloadId: 'x', id: 1 }),
          episodeItem(203, 2, { downloadId: 'x', id: 2 }),
        ],
        { episodeId: 203, seasonNumber: 2 },
      ],
      [
        'one episode plus an unattributed item',
        [
          episodeItem(203, 2, { downloadId: 'x' }),
          episodeItem(0, 2, { downloadId: 'x', episodeId: null }),
        ],
        { episodeId: 203, seasonNumber: 2 },
      ],
      [
        'only unattributed items',
        [
          episodeItem(0, 2, { downloadId: 'x', episodeId: null, id: 1 }),
          episodeItem(0, 3, { downloadId: 'x', episodeId: undefined, id: 2 }),
        ],
        undefined,
      ],
    ])('scopes %s', (_label, items, scope) => {
      const candidates = planAdoptions(DownloadType.Show, items, [], NO_CLAIMS)

      expect(candidates).toHaveLength(1)
      expect(candidates[0]?.scope).toEqual(scope)
    })

    it('never sets episodeNumber', () => {
      const [candidate] = planAdoptions(
        DownloadType.Show,
        [episodeItem(203, 2)],
        [],
        NO_CLAIMS,
      )

      expect(candidate?.scope).not.toHaveProperty('episodeNumber')
    })

    it.each<[string, AdoptionOpenJob[], number[]]>([
      [
        'an E3 episode job covers only E3',
        [{ scope: { episodeId: 3, seasonNumber: 1 }, upstreamId: 20 }],
        [4, 201],
      ],
      [
        'an S1 season job covers every S1 group, not S2',
        [{ scope: { seasonNumber: 1 }, upstreamId: 20 }],
        [201],
      ],
      [
        'a whole-series job covers everything on the series',
        [{ upstreamId: 20 }],
        [],
      ],
      [
        'a whole-series job on another series covers nothing',
        [{ upstreamId: 21 }],
        [3, 4, 201],
      ],
      [
        'a season 0 job covers nothing outside the specials',
        [{ scope: { seasonNumber: 0 }, upstreamId: 20 }],
        [3, 4, 201],
      ],
    ])('%s', (_label, openJobs, expectedEpisodes) => {
      const queue = [episodeItem(3, 1), episodeItem(4, 1), episodeItem(201, 2)]

      expect(
        planAdoptions(DownloadType.Show, queue, openJobs, NO_CLAIMS).map(
          candidate => candidate.scope?.episodeId,
        ),
      ).toEqual(expectedEpisodes)
    })

    it('does not treat an episode job as covering the season pack it sits in', () => {
      const openJobs: AdoptionOpenJob[] = [
        { scope: { episodeId: 202, seasonNumber: 2 }, upstreamId: 20 },
      ]

      expect(
        planAdoptions(DownloadType.Show, SEASON_PACK, openJobs, NO_CLAIMS),
      ).toHaveLength(1)
    })

    it('skips a season pack whose downloadId is claimed', () => {
      expect(
        planAdoptions(DownloadType.Show, SEASON_PACK, [], new Set(['pack'])),
      ).toEqual([])
    })

    it('makes a separate candidate of each episode with no downloadId', () => {
      const items = [
        episodeItem(201, 2, { downloadId: null, id: 1 }),
        episodeItem(202, 2, { downloadId: null, id: 2 }),
      ]

      expect(
        planAdoptions(DownloadType.Show, items, [], NO_CLAIMS).map(
          candidate => candidate.scope,
        ),
      ).toEqual([
        { episodeId: 201, seasonNumber: 2 },
        { episodeId: 202, seasonNumber: 2 },
      ])
    })

    it.each([
      ['null', null],
      ['absent', undefined],
    ])('ignores an item whose seriesId is %s', (_l, seriesId) => {
      expect(
        planAdoptions(
          DownloadType.Show,
          [episodeItem(1, 1, { seriesId })],
          [],
          NO_CLAIMS,
        ),
      ).toEqual([])
    })

    it('skips a failed episode but keeps a live one', () => {
      const queue = [episodeItem(3, 1, { status: 'failed' }), episodeItem(4, 1)]

      expect(
        planAdoptions(DownloadType.Show, queue, [], NO_CLAIMS).map(
          candidate => candidate.scope?.episodeId,
        ),
      ).toEqual([4])
    })
  })
})

describe('isAdoptable', () => {
  function candidateOf(
    type: DownloadType.Movie | DownloadType.Show,
    items: PollableQueueItem[],
  ): AdoptionCandidate {
    const [candidate] = planAdoptions(type, items, [], NO_CLAIMS)
    if (!candidate) throw new Error('expected a candidate')
    return candidate
  }

  it.each([
    ['has a file', false, true],
    ['has no file', true, false],
  ])('a movie that %s -> adoptable %s', (_l, expected, fileExists) => {
    const hasFile = jest.fn(() => fileExists)

    expect(
      isAdoptable(candidateOf(DownloadType.Movie, [movieItem()]), hasFile),
    ).toBe(expected)
    expect(hasFile).toHaveBeenCalledWith()
  })

  it.each<[string, boolean, number[]]>([
    ['all three episodes have files', false, [201, 202, 203]],
    ['one of three is missing a file', true, [201, 203]],
    ['none has a file', true, []],
  ])('a season pack where %s -> adoptable %s', (_l, expected, withFiles) => {
    const hasFile = (episodeId?: number) =>
      episodeId != null && withFiles.includes(episodeId)

    expect(
      isAdoptable(candidateOf(DownloadType.Show, SEASON_PACK), hasFile),
    ).toBe(expected)
  })

  it('adopts a show group with an unattributed item even if every known episode has a file', () => {
    const candidate = candidateOf(DownloadType.Show, [
      episodeItem(201, 2, { downloadId: 'x' }),
      episodeItem(0, 2, { downloadId: 'x', episodeId: null }),
    ])

    expect(isAdoptable(candidate, () => true)).toBe(true)
  })
})
