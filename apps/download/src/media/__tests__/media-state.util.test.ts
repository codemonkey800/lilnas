import type { EpisodeResource } from '@lilnas/media/sonarr'
import type { MediaState } from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'

import {
  deriveManagedState,
  deriveManagedStateFromItems,
  deriveVideoState,
  toEpisodeStateEntries,
} from 'src/media/media-state.util'
import type { PollableQueueItem } from 'src/media/queue-status.util'

/**
 * Radarr's queue, read live on 2026-09-21 (the same item
 * `queue-status.util.test.ts` pins): a finished download Radarr refused to
 * import. `status: 'completed'` *and* `trackedDownloadState: 'importPending'`
 * at once.
 */
const STUCK_IMPORT_REASON =
  'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265'

const STUCK_IMPORT: PollableQueueItem = {
  downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
  id: 152557673,
  size: 1681143972,
  sizeleft: 0,
  status: 'completed',
  statusMessages: [
    {
      messages: [STUCK_IMPORT_REASON],
      title: 'Game.Night.2018.1080p.BluRay.x265',
    },
  ],
  trackedDownloadState: 'importPending',
  trackedDownloadStatus: 'warning',
}

const DOWNLOADING: PollableQueueItem = {
  size: 1000,
  sizeleft: 250,
  status: 'downloading',
  timeleft: '00:05:00',
}

describe('deriveManagedState', () => {
  it.each<[string, Parameters<typeof deriveManagedState>[0], MediaState]>([
    // No queue item: the library decides.
    ['a file on disk', { hasFile: true, monitored: true }, 'available'],
    ['an unmonitored file', { hasFile: true, monitored: false }, 'available'],
    ['monitored with no file', { hasFile: false, monitored: true }, 'wanted'],
    [
      'unmonitored with no file',
      { hasFile: false, monitored: false },
      'absent',
    ],
    // A queue item wins over the library.
    [
      'a downloading item',
      { hasFile: false, item: DOWNLOADING, monitored: true },
      'downloading',
    ],
    [
      'a queued item',
      { hasFile: false, item: { status: 'queued' }, monitored: true },
      'downloading',
    ],
    [
      'a warning on a still-transferring item',
      {
        hasFile: false,
        item: { status: 'downloading', trackedDownloadStatus: 'warning' },
        monitored: true,
      },
      'downloading',
    ],
    [
      'an importing item',
      {
        hasFile: false,
        item: { trackedDownloadState: 'importing' },
        monitored: true,
      },
      'importing',
    ],
    [
      'an imported item still in the queue',
      {
        hasFile: false,
        item: { trackedDownloadState: 'imported' },
        monitored: true,
      },
      'importing',
    ],
    [
      'a paused item',
      { hasFile: false, item: { status: 'paused' }, monitored: true },
      'paused',
    ],
    [
      'a failed item',
      { hasFile: false, item: { status: 'failed' }, monitored: true },
      'needs_attention',
    ],
    [
      'an errored item',
      {
        hasFile: false,
        item: { status: 'warning', trackedDownloadStatus: 'error' },
        monitored: true,
      },
      'needs_attention',
    ],
    [
      'a blocked import',
      {
        hasFile: false,
        item: { trackedDownloadState: 'importBlocked' },
        monitored: true,
      },
      'needs_attention',
    ],
    [
      'the live stuck import',
      { hasFile: false, item: STUCK_IMPORT, monitored: true },
      'needs_attention',
    ],
    // An unmonitored title with an item is still under way.
    [
      'an unmonitored title with a downloading item',
      { hasFile: false, item: DOWNLOADING, monitored: false },
      'downloading',
    ],
  ])('%s', (_label, input, expected) => {
    expect(deriveManagedState(input).state).toBe(expected)
  })

  it('carries no snapshot or reason when there is no item', () => {
    expect(deriveManagedState({ hasFile: true, monitored: true })).toEqual({
      state: 'available',
    })
    expect(deriveManagedState({ hasFile: false, monitored: true })).toEqual({
      state: 'wanted',
    })
  })

  // `completed` would otherwise read as importing; the warning plus
  // `importPending` is Radarr saying it has given up, and its sentence is
  // the thing the human needs to read.
  it("marks the live stuck import needs_attention with Radarr's sentence", () => {
    expect(
      deriveManagedState({
        hasFile: false,
        item: STUCK_IMPORT,
        monitored: true,
      }),
    ).toEqual({
      queueSnapshot: {
        progress: 100,
        status: 'completed',
        timeLeft: undefined,
      },
      state: 'needs_attention',
      stateReason: STUCK_IMPORT_REASON,
    })
  })

  it('leaves stateReason off a needs_attention item with no messages', () => {
    const derived = deriveManagedState({
      hasFile: false,
      item: { status: 'failed' },
      monitored: true,
    })

    expect(derived.state).toBe('needs_attention')
    expect(derived).not.toHaveProperty('stateReason')
  })

  // Only needs_attention explains itself - a warning on a transferring item
  // is not something a human has to act on.
  it('sets stateReason only for needs_attention', () => {
    const derived = deriveManagedState({
      hasFile: false,
      item: {
        ...DOWNLOADING,
        statusMessages: [{ messages: ['stalled'], title: 'x' }],
        trackedDownloadStatus: 'warning',
      },
      monitored: true,
    })

    expect(derived.state).toBe('downloading')
    expect(derived).not.toHaveProperty('stateReason')
  })

  // An upgrade in flight: the file on disk doesn't hide the new grab.
  it('reports a movie with a file and a downloading item as downloading', () => {
    expect(
      deriveManagedState({ hasFile: true, item: DOWNLOADING, monitored: true }),
    ).toEqual({
      queueSnapshot: {
        progress: 75,
        status: 'downloading',
        timeLeft: '00:05:00',
      },
      state: 'downloading',
    })
  })

  it('reports an unmonitored movie with no file as absent', () => {
    expect(deriveManagedState({ hasFile: false, monitored: false })).toEqual({
      state: 'absent',
    })
  })
})

describe('deriveVideoState', () => {
  // Every `DownloadJobStatus`, with and without a file. The `Record` in the
  // implementation fails type-check on a new status; this table fails the
  // test until the new status is covered here too.
  const cases: Record<
    DownloadJobStatus,
    { withFile: MediaState; withoutFile: MediaState }
  > = {
    [DownloadJobStatus.Cancelled]: {
      withFile: 'available',
      withoutFile: 'absent',
    },
    [DownloadJobStatus.Cancelling]: {
      withFile: 'downloading',
      withoutFile: 'downloading',
    },
    [DownloadJobStatus.Cleaning]: {
      withFile: 'importing',
      withoutFile: 'importing',
    },
    [DownloadJobStatus.Completed]: {
      withFile: 'available',
      withoutFile: 'absent',
    },
    [DownloadJobStatus.Converting]: {
      withFile: 'importing',
      withoutFile: 'importing',
    },
    [DownloadJobStatus.Downloading]: {
      withFile: 'downloading',
      withoutFile: 'downloading',
    },
    [DownloadJobStatus.Failed]: {
      withFile: 'available',
      withoutFile: 'absent',
    },
    [DownloadJobStatus.Importing]: {
      withFile: 'importing',
      withoutFile: 'importing',
    },
    [DownloadJobStatus.NeedsAttention]: {
      withFile: 'needs_attention',
      withoutFile: 'needs_attention',
    },
    [DownloadJobStatus.Paused]: { withFile: 'paused', withoutFile: 'paused' },
    [DownloadJobStatus.Pausing]: { withFile: 'paused', withoutFile: 'paused' },
    [DownloadJobStatus.Pending]: { withFile: 'wanted', withoutFile: 'wanted' },
    [DownloadJobStatus.Requested]: {
      withFile: 'wanted',
      withoutFile: 'wanted',
    },
    [DownloadJobStatus.Searching]: {
      withFile: 'downloading',
      withoutFile: 'downloading',
    },
    [DownloadJobStatus.Uploading]: {
      withFile: 'importing',
      withoutFile: 'importing',
    },
  }

  it.each(Object.values(DownloadJobStatus))('%s', status => {
    const expected = cases[status]

    expect(deriveVideoState(true, status)).toBe(expected.withFile)
    expect(deriveVideoState(false, status)).toBe(expected.withoutFile)
  })

  it('falls through to the file when there is no job', () => {
    expect(deriveVideoState(true, undefined)).toBe('available')
    expect(deriveVideoState(false, undefined)).toBe('absent')
  })

  it('reports a video with no file and a cancelled job as absent', () => {
    expect(deriveVideoState(false, DownloadJobStatus.Cancelled)).toBe('absent')
  })
})

describe('deriveManagedStateFromItems', () => {
  const library = { hasFile: true, monitored: true }

  it('leaves it to the library when there are no items', () => {
    expect(deriveManagedStateFromItems(library, [])).toEqual({
      state: 'available',
    })
    expect(
      deriveManagedStateFromItems({ hasFile: false, monitored: false }, []),
    ).toEqual({ state: 'absent' })
  })

  it('derives a single item the same as deriveManagedState', () => {
    expect(deriveManagedStateFromItems(library, [DOWNLOADING])).toEqual(
      deriveManagedState({ ...library, item: DOWNLOADING }),
    )
  })

  it("takes the highest-precedence item with that item's snapshot and reason", () => {
    expect(
      deriveManagedStateFromItems(library, [DOWNLOADING, STUCK_IMPORT]),
    ).toEqual(deriveManagedState({ ...library, item: STUCK_IMPORT }))
  })

  it('keeps the first of two items with equal precedence', () => {
    const later: PollableQueueItem = { ...DOWNLOADING, sizeleft: 0 }

    expect(
      deriveManagedStateFromItems(library, [DOWNLOADING, later]).queueSnapshot
        ?.progress,
    ).toBe(75)
  })
})

describe('toEpisodeStateEntries', () => {
  const episode = (overrides: Partial<EpisodeResource>): EpisodeResource => ({
    hasFile: false,
    monitored: true,
    seasonNumber: 1,
    ...overrides,
  })

  it('returns one entry per episode, from the library when nothing is queued', () => {
    expect(
      toEpisodeStateEntries(
        [
          episode({ hasFile: true, id: 1 }),
          episode({ id: 2 }),
          episode({ id: 3, monitored: false }),
          // Sonarr numbers specials as season 0.
          episode({ hasFile: true, id: 4, monitored: false, seasonNumber: 0 }),
        ],
        [],
      ),
    ).toEqual([
      { episodeId: 1, seasonNumber: 1, state: 'available' },
      { episodeId: 2, seasonNumber: 1, state: 'wanted' },
      { episodeId: 3, seasonNumber: 1, state: 'absent' },
      { episodeId: 4, seasonNumber: 0, state: 'available' },
    ])
  })

  it('treats a missing hasFile/monitored as false', () => {
    expect(toEpisodeStateEntries([{ id: 9, seasonNumber: 2 }], [])).toEqual([
      { episodeId: 9, seasonNumber: 2, state: 'absent' },
    ])
  })

  it('attributes each queue item to its own episode only', () => {
    expect(
      toEpisodeStateEntries(
        [episode({ id: 1 }), episode({ id: 2 }), episode({ id: 3 })],
        [
          { ...DOWNLOADING, episodeId: 1, seasonNumber: 1 },
          { ...STUCK_IMPORT, episodeId: 2, seasonNumber: 1 },
        ],
      ),
    ).toEqual([
      {
        episodeId: 1,
        queueSnapshot: {
          progress: 75,
          status: 'downloading',
          timeLeft: '00:05:00',
        },
        seasonNumber: 1,
        state: 'downloading',
      },
      {
        episodeId: 2,
        queueSnapshot: {
          progress: 100,
          status: 'completed',
          timeLeft: undefined,
        },
        seasonNumber: 1,
        state: 'needs_attention',
      },
      { episodeId: 3, seasonNumber: 1, state: 'wanted' },
    ])
  })

  // A season-level fold has no episode id; matching must happen per item,
  // and an item Sonarr can't attribute to an episode is no evidence about
  // any of them.
  it('ignores items with no episodeId', () => {
    expect(
      toEpisodeStateEntries(
        [episode({ hasFile: true, id: 1 })],
        [{ ...DOWNLOADING, seasonNumber: 1 }, { episodeId: null }],
      ),
    ).toEqual([{ episodeId: 1, seasonNumber: 1, state: 'available' }])
  })

  it('lets a queue item win over an episode that already has a file', () => {
    const [entry] = toEpisodeStateEntries(
      [episode({ hasFile: true, id: 1 })],
      [{ episodeId: 1, trackedDownloadState: 'importing' }],
    )

    expect(entry?.state).toBe('importing')
    expect(entry?.queueSnapshot).toBeDefined()
  })

  it.each<[string, PollableQueueItem[], MediaState, string | undefined]>([
    [
      'needs_attention over downloading',
      [
        { episodeId: 1, status: 'downloading' },
        { episodeId: 1, status: 'failed' },
      ],
      'needs_attention',
      'failed',
    ],
    [
      'downloading over importing',
      [
        { episodeId: 1, trackedDownloadState: 'importing' },
        { episodeId: 1, status: 'queued' },
      ],
      'downloading',
      'queued',
    ],
    [
      'importing over paused',
      [
        { episodeId: 1, status: 'paused' },
        { episodeId: 1, status: 'completed' },
      ],
      'importing',
      'completed',
    ],
    [
      'the first of two equal items',
      [
        { episodeId: 1, status: 'downloading' },
        { episodeId: 1, status: 'queued' },
      ],
      'downloading',
      'downloading',
    ],
  ])(
    'takes the highest-precedence of several items: %s',
    (_label, items, state, snapshotStatus) => {
      const [entry] = toEpisodeStateEntries([episode({ id: 1 })], items)

      expect(entry?.state).toBe(state)
      // The snapshot is the winning item's, not a fold.
      expect(entry?.queueSnapshot?.status).toBe(snapshotStatus)
    },
  )

  it('skips an episode Sonarr returned without an id or season', () => {
    expect(
      toEpisodeStateEntries(
        [{ seasonNumber: 1 }, { id: 2 }, episode({ id: 3 })],
        [],
      ),
    ).toEqual([{ episodeId: 3, seasonNumber: 1, state: 'wanted' }])
  })
})
