import type {
  DownloadQueueSnapshot,
  DownloadQueueStage,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'

import { DISK_SPACE_ERROR } from 'src/media/client-failure.util'
import {
  ABSENT_REMOVED_MS,
  type AbsentJobFacts,
  aggregateQueueItems,
  ATTENTION_DELAY_MS,
  CANCEL_GRACE_MS,
  type ClientReadingLookup,
  deriveQueueItemState,
  deriveStatusFromQueueItem,
  describeQueueItemError,
  isQueueItemMoving,
  isQueueSnapshotEqual,
  type JobDownloadLink,
  matchesScope,
  type PollableQueueItem,
  type QueueItemState,
  REMOVED_FROM_CLIENT_ERROR,
  SAB_LOW_DISK_GB,
  settleAbsentJob,
  STALL_MS,
  toQueueSnapshot,
} from 'src/media/queue-status.util'
import type { SabReading } from 'src/sabnzbd/sab-readings.util'

/**
 * Radarr's queue, read live on 2026-09-21: a movie whose download finished
 * and which Radarr then refused to import, because it couldn't match the
 * release to the movie it grabbed it for. Note `status: 'completed'` *and*
 * `trackedDownloadState: 'importPending'` at the same time - the ordering
 * trap the classifier has to get right.
 */
const STUCK_IMPORT = {
  downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
  id: 152557673,
  size: 1681143972,
  sizeleft: 0,
  status: 'completed',
  statusMessages: [
    {
      messages: [
        'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265',
      ],
      title: 'Game.Night.2018.1080p.BluRay.x265',
    },
  ],
  trackedDownloadState: 'importPending',
  trackedDownloadStatus: 'warning',
}

describe('toQueueSnapshot', () => {
  it('computes progress as a percentage of size downloaded', () => {
    const snapshot = toQueueSnapshot({
      size: 1000,
      sizeleft: 250,
      status: 'downloading',
      timeleft: '00:05:00',
    })

    expect(snapshot).toEqual({
      progress: 75,
      status: 'downloading',
      timeLeft: '00:05:00',
    })
  })

  it('leaves progress undefined when size is missing or zero', () => {
    const snapshot = toQueueSnapshot({ status: 'queued' })

    expect(snapshot.progress).toBeUndefined()
  })

  it('clamps progress into [0, 100]', () => {
    const overshoot = toQueueSnapshot({ size: 100, sizeleft: -50 })
    expect(overshoot.progress).toBe(100)

    const undershoot = toQueueSnapshot({ size: 100, sizeleft: 500 })
    expect(undershoot.progress).toBe(0)
  })
})

describe('isQueueSnapshotEqual', () => {
  it('treats two undefined snapshots as equal', () => {
    expect(isQueueSnapshotEqual(undefined, undefined)).toBe(true)
  })

  it('treats one undefined and one defined snapshot as unequal', () => {
    expect(isQueueSnapshotEqual(undefined, { status: 'downloading' })).toBe(
      false,
    )
  })

  it('compares field-by-field', () => {
    const a = { progress: 50, status: 'downloading', timeLeft: '5m' }
    const b = { progress: 50, status: 'downloading', timeLeft: '5m' }
    const c = { progress: 60, status: 'downloading', timeLeft: '5m' }

    expect(isQueueSnapshotEqual(a, b)).toBe(true)
    expect(isQueueSnapshotEqual(a, c)).toBe(false)
  })

  describe('SABnzbd fields', () => {
    const base: DownloadQueueSnapshot = {
      downloadedBytes: 400,
      etaSeconds: 60,
      progress: 40,
      speedBps: 1_000_000,
      stage: 'downloading',
      status: 'downloading',
      totalBytes: 1000,
    }

    it('ignores speed jitter inside one 10 KiB/s bucket', () => {
      expect(
        isQueueSnapshotEqual(base, { ...base, speedBps: 1_000_000 + 4_000 }),
      ).toBe(true)
    })

    it.each<[string, Partial<DownloadQueueSnapshot>]>([
      ['a 10 KiB/s speed change', { speedBps: 1_000_000 + 10_240 }],
      ['a speed going away', { speedBps: undefined }],
      ['a stage change', { stage: 'post_processing' }],
      ['new bytes', { downloadedBytes: 401 }],
      ['a new total', { totalBytes: 1001 }],
      ['a new ETA', { etaSeconds: 59 }],
      ['a new stage detail', { stageDetail: 'Repairing: 45%' }],
      ['a client pause', { clientPaused: true }],
      ['a low disk', { clientDiskLow: true }],
    ])('tells %s apart', (_label, change) => {
      expect(isQueueSnapshotEqual(base, { ...base, ...change })).toBe(false)
    })
  })
})

describe('toQueueSnapshot with SABnzbd readings', () => {
  const MIB = 1024 * 1024

  const reading = (overrides: Partial<SabReading> = {}): SabReading => ({
    diskFreeGb: 500,
    downloadedBytes: 300 * MIB,
    etaSeconds: 120,
    failMessage: null,
    globallyPaused: false,
    nzoId: 'SABnzbd_nzo_a',
    phase: 'downloading',
    seenAt: 0,
    speedBps: 5 * MIB,
    stage: null,
    stageDetail: null,
    totalBytes: 1000 * MIB,
    ...overrides,
  })

  // A slot SAB's global queue pause is holding: not Force, so `paused`.
  const globalPause = (overrides: Partial<SabReading> = {}): SabReading =>
    reading({
      etaSeconds: null,
      globallyPaused: true,
      phase: 'paused',
      speedBps: null,
      ...overrides,
    })

  const lookup =
    (...readings: SabReading[]): ClientReadingLookup =>
    downloadId =>
      readings.find(r => r.nzoId === downloadId)

  // Radarr's numbers for the same download, deliberately stale: 10%.
  const movieItem: PollableQueueItem = {
    downloadId: 'SABnzbd_nzo_a',
    size: 1000 * MIB,
    sizeleft: 900 * MIB,
    status: 'downloading',
    timeleft: '00:15:00',
  }

  it("keeps Radarr's numbers without a lookup or without a reading", () => {
    const radarrOnly = {
      progress: 10,
      status: 'downloading',
      timeLeft: '00:15:00',
    }

    expect(toQueueSnapshot(movieItem)).toEqual(radarrOnly)
    expect(toQueueSnapshot(movieItem, lookup())).toEqual(radarrOnly)
    expect(
      toQueueSnapshot({ ...movieItem, downloadId: null }, lookup(reading())),
    ).toEqual(radarrOnly)
  })

  it("merges a movie's reading, keeping Radarr's status and timeLeft", () => {
    expect(toQueueSnapshot(movieItem, lookup(reading()))).toEqual({
      downloadedBytes: 300 * MIB,
      etaSeconds: 120,
      progress: 30,
      speedBps: 5 * MIB,
      stage: 'downloading',
      status: 'downloading',
      timeLeft: '00:15:00',
      totalBytes: 1000 * MIB,
    })
  })

  it('clamps and rounds SAB progress like Radarr progress', () => {
    const snapshot = toQueueSnapshot(
      movieItem,
      lookup(reading({ downloadedBytes: 1, totalBytes: 3 })),
    )

    expect(snapshot.progress).toBe(33.33)
  })

  it("keeps Radarr's progress and sends no bytes when SAB's total is 0", () => {
    const snapshot = toQueueSnapshot(
      movieItem,
      lookup(
        reading({
          downloadedBytes: 0,
          etaSeconds: null,
          phase: 'post_processing',
          speedBps: null,
          stage: 'Repairing',
          stageDetail: 'Repairing: 45%',
          totalBytes: 0,
        }),
      ),
    )

    expect(snapshot).toEqual({
      progress: 10,
      stage: 'post_processing',
      stageDetail: 'Repairing: 45%',
      status: 'downloading',
      timeLeft: '00:15:00',
    })
  })

  it('leaves out speed, ETA and detail SAB does not have', () => {
    const snapshot = toQueueSnapshot(
      movieItem,
      lookup(reading({ etaSeconds: null, phase: 'paused', speedBps: null })),
    )

    expect(snapshot.stage).toBe('paused')
    expect(snapshot).not.toHaveProperty('speedBps')
    expect(snapshot).not.toHaveProperty('etaSeconds')
    expect(snapshot).not.toHaveProperty('stageDetail')
    expect(snapshot).not.toHaveProperty('clientPaused')
  })

  it.each(['completed', 'failed', 'gone'] as const)(
    'gives a %s download its bytes but no stage',
    phase => {
      const snapshot = toQueueSnapshot(
        movieItem,
        lookup(
          reading({
            downloadedBytes: 1000 * MIB,
            etaSeconds: null,
            phase,
            speedBps: null,
          }),
        ),
      )

      expect(snapshot.progress).toBe(100)
      expect(snapshot.totalBytes).toBe(1000 * MIB)
      expect(snapshot).not.toHaveProperty('stage')
    },
  )

  describe('over an aggregate', () => {
    // A Sonarr season pack: three episode rows, one download, every row
    // carrying the whole pack's size.
    const packRow = (episodeId: number): PollableQueueItem => ({
      downloadId: 'SABnzbd_nzo_pack',
      episodeId,
      size: 3000 * MIB,
      sizeleft: 3000 * MIB,
      status: 'downloading',
      timeleft: '01:00:00',
    })
    const packReading = reading({
      downloadedBytes: 1500 * MIB,
      nzoId: 'SABnzbd_nzo_pack',
      totalBytes: 3000 * MIB,
    })

    it("counts a season pack's bytes once, not once per episode row", () => {
      const aggregate = aggregateQueueItems([
        packRow(1),
        packRow(2),
        packRow(3),
      ])

      expect(aggregate?.downloadIds).toEqual(['SABnzbd_nzo_pack'])
      expect(toQueueSnapshot(aggregate!, lookup(packReading))).toMatchObject({
        downloadedBytes: 1500 * MIB,
        progress: 50,
        speedBps: 5 * MIB,
        totalBytes: 3000 * MIB,
      })
    })

    it('sums two downloads, takes the largest ETA and the slowest stage', () => {
      const aggregate = aggregateQueueItems([
        { ...movieItem, downloadId: 'SABnzbd_nzo_a', episodeId: 1 },
        { ...movieItem, downloadId: 'SABnzbd_nzo_b', episodeId: 2 },
      ])

      const snapshot = toQueueSnapshot(
        aggregate!,
        lookup(
          reading({ etaSeconds: 30, nzoId: 'SABnzbd_nzo_a' }),
          reading({
            downloadedBytes: 100 * MIB,
            etaSeconds: 900,
            nzoId: 'SABnzbd_nzo_b',
            phase: 'queued',
            speedBps: null,
          }),
        ),
      )

      expect(snapshot).toEqual({
        downloadedBytes: 400 * MIB,
        etaSeconds: 900,
        progress: 20,
        speedBps: 5 * MIB,
        stage: 'queued',
        status: 'downloading',
        timeLeft: '00:15:00',
        totalBytes: 2000 * MIB,
      })
    })

    it('sums speed over every download that has one', () => {
      const aggregate = aggregateQueueItems([
        { ...movieItem, downloadId: 'SABnzbd_nzo_a' },
        { ...movieItem, downloadId: 'SABnzbd_nzo_b' },
      ])

      const snapshot = toQueueSnapshot(
        aggregate!,
        lookup(
          reading({ nzoId: 'SABnzbd_nzo_a', speedBps: 2 * MIB }),
          reading({ nzoId: 'SABnzbd_nzo_b', speedBps: 3 * MIB }),
        ),
      )

      expect(snapshot.speedBps).toBe(5 * MIB)
    })

    it.each<[string, SabReading[], DownloadQueueStage, string | undefined]>([
      [
        'one post-processing download keeps its detail',
        [
          reading({
            etaSeconds: null,
            nzoId: 'SABnzbd_nzo_a',
            phase: 'post_processing',
            speedBps: null,
            stageDetail: 'Unpacking: 3/10',
          }),
          reading({
            downloadedBytes: 1000 * MIB,
            nzoId: 'SABnzbd_nzo_b',
            phase: 'completed',
          }),
        ],
        'post_processing',
        'Unpacking: 3/10',
      ],
      [
        'two post-processing downloads drop it',
        [
          reading({
            nzoId: 'SABnzbd_nzo_a',
            phase: 'post_processing',
            stageDetail: 'Unpacking: 3/10',
          }),
          reading({
            nzoId: 'SABnzbd_nzo_b',
            phase: 'post_processing',
            stageDetail: 'Repairing: 45%',
          }),
        ],
        'post_processing',
        undefined,
      ],
      [
        'a downloading sibling drops the stage below post-processing',
        [
          reading({
            nzoId: 'SABnzbd_nzo_a',
            phase: 'post_processing',
            stageDetail: 'Unpacking: 3/10',
          }),
          reading({ nzoId: 'SABnzbd_nzo_b' }),
        ],
        'downloading',
        'Unpacking: 3/10',
      ],
      [
        'a paused sibling is less advanced than a downloading one',
        [
          reading({ nzoId: 'SABnzbd_nzo_a' }),
          reading({ nzoId: 'SABnzbd_nzo_b', phase: 'paused' }),
        ],
        'paused',
        undefined,
      ],
    ])('%s', (_label, readings, stage, stageDetail) => {
      const aggregate = aggregateQueueItems([
        { ...movieItem, downloadId: 'SABnzbd_nzo_a' },
        { ...movieItem, downloadId: 'SABnzbd_nzo_b' },
      ])

      const snapshot = toQueueSnapshot(aggregate!, lookup(...readings))

      expect(snapshot.stage).toBe(stage)
      expect(snapshot.stageDetail).toBe(stageDetail)
    })

    it.each<[string, PollableQueueItem[]]>([
      [
        'one download has no reading',
        [
          { ...movieItem, downloadId: 'SABnzbd_nzo_a' },
          { ...movieItem, downloadId: 'SABnzbd_nzo_unread' },
        ],
      ],
      [
        'one row has no downloadId',
        [
          { ...movieItem, downloadId: 'SABnzbd_nzo_a' },
          { ...movieItem, downloadId: null },
        ],
      ],
    ])("keeps the whole aggregate on Radarr's numbers when %s", (_l, items) => {
      const aggregate = aggregateQueueItems(items)

      expect(toQueueSnapshot(aggregate!, lookup(reading()))).toEqual(
        toQueueSnapshot(aggregate!),
      )
    })

    it.each<[string, SabReading[], Partial<DownloadQueueSnapshot>]>([
      [
        'a download held by the global pause',
        [
          reading({ nzoId: 'SABnzbd_nzo_a', phase: 'post_processing' }),
          globalPause({ nzoId: 'SABnzbd_nzo_b' }),
        ],
        { clientPaused: true, stage: 'paused' },
      ],
      [
        'a held download on a low disk',
        [
          globalPause({ diskFreeGb: 3, nzoId: 'SABnzbd_nzo_a' }),
          globalPause({ diskFreeGb: 3, nzoId: 'SABnzbd_nzo_b' }),
        ],
        { clientDiskLow: true, clientPaused: true, stage: 'paused' },
      ],
      [
        'a Force download beside one paused on its own',
        [
          reading({ globallyPaused: true, nzoId: 'SABnzbd_nzo_a' }),
          reading({ nzoId: 'SABnzbd_nzo_b', phase: 'paused' }),
        ],
        { stage: 'paused' },
      ],
    ])("flags SAB's pause over %s", (_label, readings, expected) => {
      const aggregate = aggregateQueueItems([
        { ...movieItem, downloadId: 'SABnzbd_nzo_a' },
        { ...movieItem, downloadId: 'SABnzbd_nzo_b' },
      ])

      const snapshot = toQueueSnapshot(aggregate!, lookup(...readings))

      expect({
        clientDiskLow: snapshot.clientDiskLow,
        clientPaused: snapshot.clientPaused,
        stage: snapshot.stage,
      }).toEqual({
        clientDiskLow: undefined,
        clientPaused: undefined,
        ...expected,
      })
    })
  })

  describe('SABnzbd queue pause', () => {
    it('flags a download held by the global pause', () => {
      const snapshot = toQueueSnapshot(movieItem, lookup(globalPause()))

      expect(snapshot.stage).toBe('paused')
      expect(snapshot.clientPaused).toBe(true)
      expect(snapshot).not.toHaveProperty('clientDiskLow')
    })

    it('does not flag a Force download that keeps going through it', () => {
      const snapshot = toQueueSnapshot(
        movieItem,
        lookup(reading({ globallyPaused: true })),
      )

      expect(snapshot.stage).toBe('downloading')
      expect(snapshot).not.toHaveProperty('clientPaused')
      expect(snapshot).not.toHaveProperty('clientDiskLow')
    })

    it('does not flag a download paused on its own with the queue running', () => {
      const snapshot = toQueueSnapshot(
        movieItem,
        lookup(reading({ etaSeconds: null, phase: 'paused', speedBps: null })),
      )

      expect(snapshot.stage).toBe('paused')
      expect(snapshot).not.toHaveProperty('clientPaused')
    })

    it('does not flag a download post-processing through it', () => {
      const snapshot = toQueueSnapshot(
        movieItem,
        lookup(reading({ globallyPaused: true, phase: 'post_processing' })),
      )

      expect(snapshot).not.toHaveProperty('clientPaused')
    })

    it.each<[string, number | null, boolean]>([
      ['well under the threshold', 0.4, true],
      ['just under the threshold', SAB_LOW_DISK_GB - 0.01, true],
      ['at the threshold', SAB_LOW_DISK_GB, false],
      ['plenty of space', 500, false],
      ['an unknown free space', null, false],
    ])('reads %s as a low disk: %s', (_label, diskFreeGb, low) => {
      const snapshot = toQueueSnapshot(
        movieItem,
        lookup(globalPause({ diskFreeGb })),
      )

      expect(snapshot.clientPaused).toBe(true)
      if (low) {
        expect(snapshot.clientDiskLow).toBe(true)
      } else {
        expect(snapshot).not.toHaveProperty('clientDiskLow')
      }
    })

    it('never flags a low disk without a SAB pause', () => {
      const snapshot = toQueueSnapshot(
        movieItem,
        lookup(reading({ diskFreeGb: 0.4 })),
      )

      expect(snapshot).not.toHaveProperty('clientPaused')
      expect(snapshot).not.toHaveProperty('clientDiskLow')
    })
  })
})

describe('describeQueueItemError', () => {
  it('joins all status message strings', () => {
    const message = describeQueueItemError({
      statusMessages: [
        { title: 'a', messages: ['one', 'two'] },
        { title: 'b', messages: ['three'] },
      ],
    })

    expect(message).toBe('one; two; three')
  })

  it('returns undefined when there are no status messages', () => {
    expect(describeQueueItemError({})).toBeUndefined()
    expect(describeQueueItemError({ statusMessages: [] })).toBeUndefined()
  })

  // Sources in priority order: the client's `errorMessage`, then the titles
  // of message-less (item-level) entries, then the per-file messages.
  it.each<[string, PollableQueueItem, string | undefined]>([
    [
      'errorMessage over everything else',
      {
        errorMessage: 'Download failed: par2 repair failed',
        statusMessages: [
          { messages: [], title: 'No files found are eligible for import' },
          { messages: ['Not a sample'], title: 'movie.mkv' },
        ],
      },
      'Download failed: par2 repair failed',
    ],
    [
      'message-less titles over per-file messages',
      {
        errorMessage: null,
        statusMessages: [
          { messages: ['Not a sample'], title: 'movie.mkv' },
          { messages: [], title: 'No files found are eligible for import' },
          { messages: null, title: 'Unable to parse file' },
        ],
      },
      'No files found are eligible for import; Unable to parse file',
    ],
    [
      'per-file messages when nothing else is there',
      {
        errorMessage: '',
        statusMessages: [
          { messages: ['Not a sample', 'Too small'], title: 'movie.mkv' },
        ],
      },
      'Not a sample; Too small',
    ],
    [
      'an empty errorMessage as absent',
      { errorMessage: '', statusMessages: [] },
      undefined,
    ],
    [
      'an entry whose messages are all blank as message-less',
      { statusMessages: [{ messages: [''], title: 'Unable to parse file' }] },
      'Unable to parse file',
    ],
    [
      'a message-less entry with no title as nothing',
      {
        statusMessages: [
          { messages: [], title: null },
          { messages: ['Not a sample'], title: 'movie.mkv' },
        ],
      },
      'Not a sample',
    ],
    [
      'a disk-full reason as the NAS running out of space',
      {
        errorMessage:
          'Unpacking failed, write error or disk is full?  in the file /downloads/incomplete/movie/movie.mkv',
      },
      `${DISK_SPACE_ERROR} (Unpacking failed, write error or disk is full?)`,
    ],
  ])('treats %s', (_label, item, expected) => {
    expect(describeQueueItemError(item)).toBe(expected)
  })
})

describe('deriveStatusFromQueueItem', () => {
  it('maps a failed queue status to Failed', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
        status: 'failed',
      }),
    ).toBe(DownloadJobStatus.Failed)
  })

  it('maps an error tracked-download-status to Failed', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
        status: 'warning',
        trackedDownloadStatus: 'error',
      }),
    ).toBe(DownloadJobStatus.Failed)
  })

  it('maps the importing tracked-download-state to Importing', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
        trackedDownloadState: 'importing',
      }),
    ).toBe(DownloadJobStatus.Importing)
  })

  // The whole point of the status: the bytes are on disk, Radarr/Sonarr has
  // given up on importing them by itself, and nothing moves until a human
  // works the manual-import dialog.
  it('maps the live stuck-import queue item to NeedsAttention', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, STUCK_IMPORT),
    ).toBe(DownloadJobStatus.NeedsAttention)
  })

  it('maps blocked/pending import tracked-download-states to NeedsAttention', () => {
    for (const state of ['importBlocked', 'importPending']) {
      expect(
        deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
          trackedDownloadState: state,
        }),
      ).toBe(DownloadJobStatus.NeedsAttention)
    }
  })

  it('maps a completed item carrying a warning to NeedsAttention', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
        status: 'completed',
        trackedDownloadStatus: 'warning',
      }),
    ).toBe(DownloadJobStatus.NeedsAttention)
  })

  // Radarr/Sonarr also warns about a stalled torrent, a missing category or
  // an unpack in progress. None of those is fixed by a manual import, so
  // only import-stage signals count.
  it('leaves a warning on a still-transferring item as Downloading', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
        status: 'downloading',
        trackedDownloadStatus: 'warning',
      }),
    ).toBe(DownloadJobStatus.Downloading)
  })

  it('maps trackedDownloadState "imported" and status "completed" to Importing', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
        trackedDownloadState: 'imported',
      }),
    ).toBe(DownloadJobStatus.Importing)
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
        status: 'completed',
      }),
    ).toBe(DownloadJobStatus.Importing)
  })

  it('maps everything else (queued, downloading, warning, ...) to Downloading', () => {
    for (const status of ['queued', 'downloading', 'warning']) {
      expect(
        deriveStatusFromQueueItem(DownloadJobStatus.Searching, { status }),
      ).toBe(DownloadJobStatus.Downloading)
    }
  })

  // A movie/show can be paused independently of this app, at the backing
  // download client (qBittorrent, SABnzbd, ...) or from Radarr's/Sonarr's
  // own queue UI. Before this, that fell into the catch-all above and
  // reported as Downloading - actively wrong, not just imprecise.
  it('maps a paused queue status to Paused', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
        status: 'paused',
      }),
    ).toBe(DownloadJobStatus.Paused)
  })
})

describe('deriveQueueItemState', () => {
  const NOW = 1_800_000_000_000
  const {
    Cancelling,
    Downloading,
    Importing,
    NeedsAttention,
    Paused,
    Requested,
    Searching,
  } = DownloadJobStatus

  // `stateSince` as "how long ago the item entered its state"; `undefined`
  // is a state the poller has not timed yet.
  const since = (ms: number | undefined) =>
    ms === undefined ? undefined : NOW - ms
  const JUST = 0
  const BEFORE = ATTENTION_DELAY_MS - 1
  const AFTER = ATTENTION_DELAY_MS

  // Local wall-clock 14:05, so the expected "HH:MM" holds in any time zone.
  const AT_1405 = new Date(2026, 8, 28, 14, 5).toISOString()

  // - SABnzbd's 7z disk-full text: the one Radarr/Sonarr keep as a queue
  //   warning, rather than failing the download.
  const SAB_UNPACK = 'Unpacking failed, write error or disk is full?'
  const SAB_UNPACK_TEXT = `${DISK_SPACE_ERROR} (${SAB_UNPACK})`

  // [label, current, item, stateSinceAgo, expected]
  const rows: Array<
    [
      string,
      DownloadJobStatus,
      PollableQueueItem,
      number | undefined,
      QueueItemState,
    ]
  > = [
    // importPending with an ok status: Radarr retries on its own.
    [
      'importPending, ok',
      Downloading,
      {
        status: 'completed',
        trackedDownloadState: 'importPending',
        trackedDownloadStatus: 'ok',
      },
      AFTER * 10,
      { status: Importing },
    ],
    [
      'a completed item with no tracked state',
      Downloading,
      { status: 'completed' },
      AFTER,
      { status: Importing },
    ],

    // importPending with a warning: Importing until it has persisted.
    [
      'importPending + warning, untimed',
      Downloading,
      STUCK_IMPORT,
      undefined,
      { status: Importing },
    ],
    [
      'importPending + warning, just now',
      Downloading,
      STUCK_IMPORT,
      JUST,
      { status: Importing },
    ],
    [
      'importPending + warning, just under the delay',
      Downloading,
      STUCK_IMPORT,
      BEFORE,
      { status: Importing },
    ],
    [
      'importPending + warning, at the delay',
      Downloading,
      STUCK_IMPORT,
      AFTER,
      {
        errorMessage:
          'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265',
        status: NeedsAttention,
      },
    ],

    // importBlocked: at once, whatever the clock.
    [
      'importBlocked, untimed',
      Downloading,
      {
        statusMessages: [
          { messages: [], title: 'No files found are eligible for import' },
        ],
        trackedDownloadState: 'importBlocked',
      },
      undefined,
      {
        errorMessage: 'No files found are eligible for import',
        status: NeedsAttention,
      },
    ],
    [
      'importBlocked, just now',
      Importing,
      { trackedDownloadState: 'importBlocked' },
      JUST,
      { status: NeedsAttention },
    ],

    // A client warning with its own message: SABnzbd's failed unpack.
    [
      'SAB warning + errorMessage, untimed',
      Downloading,
      {
        errorMessage: SAB_UNPACK,
        status: 'warning',
        trackedDownloadStatus: 'warning',
      },
      undefined,
      { status: Downloading },
    ],
    [
      'SAB warning + errorMessage, just under the delay',
      Downloading,
      {
        errorMessage: SAB_UNPACK,
        status: 'warning',
        trackedDownloadStatus: 'warning',
      },
      BEFORE,
      { status: Downloading },
    ],
    [
      'SAB warning + errorMessage, at the delay',
      Downloading,
      {
        errorMessage: SAB_UNPACK,
        status: 'warning',
        trackedDownloadStatus: 'warning',
      },
      AFTER,
      { errorMessage: SAB_UNPACK_TEXT, status: NeedsAttention },
    ],
    [
      'a warning on a paused item, before the delay',
      Paused,
      {
        errorMessage: SAB_UNPACK,
        status: 'paused',
        trackedDownloadStatus: 'warning',
      },
      BEFORE,
      { status: Paused },
    ],
    [
      'a warning with a blank errorMessage, long past the delay',
      Downloading,
      { errorMessage: '  ', status: 'warning' },
      AFTER * 10,
      { status: Downloading },
    ],
    [
      'a warning with no errorMessage, long past the delay',
      Downloading,
      { status: 'downloading', trackedDownloadStatus: 'warning' },
      AFTER * 10,
      { status: Downloading },
    ],

    // Held by Radarr/Sonarr: nothing on the wire yet, so still searching.
    [
      'delay with a time',
      Requested,
      { estimatedCompletionTime: AT_1405, status: 'delay' },
      JUST,
      { status: Searching, statusNote: 'Delayed by Radarr until 14:05' },
    ],
    [
      'delay with no time',
      Searching,
      { estimatedCompletionTime: null, status: 'delay' },
      JUST,
      { status: Searching, statusNote: 'Delayed by Radarr' },
    ],
    [
      'delay with an unparseable time',
      Searching,
      { estimatedCompletionTime: 'soon', status: 'delay' },
      JUST,
      { status: Searching, statusNote: 'Delayed by Radarr' },
    ],
    [
      'downloadClientUnavailable',
      Downloading,
      { estimatedCompletionTime: AT_1405, status: 'downloadClientUnavailable' },
      AFTER,
      { status: Searching, statusNote: 'Delayed by Radarr until 14:05' },
    ],

    // Failed at the client: history decides, so the job holds its status.
    [
      'status failed',
      Downloading,
      { status: 'failed' },
      JUST,
      { status: Downloading },
    ],
    [
      'failedPending',
      Importing,
      { status: 'completed', trackedDownloadState: 'failedPending' },
      BEFORE,
      { status: Importing },
    ],
    [
      'trackedDownloadStatus error',
      Paused,
      { status: 'warning', trackedDownloadStatus: 'error' },
      undefined,
      { status: Paused },
    ],
    [
      'failed on a searching job',
      Searching,
      { status: 'failed' },
      JUST,
      { status: Downloading },
    ],
    [
      'failed on a requested job',
      Requested,
      { trackedDownloadState: 'failed' },
      JUST,
      { status: Downloading },
    ],
    [
      'failed on a cancelling job',
      Cancelling,
      { status: 'failed' },
      JUST,
      { status: Downloading },
    ],
    [
      'failed long past the delay - no history event is coming',
      Downloading,
      { errorMessage: 'Repair failed', status: 'failed' },
      AFTER,
      { errorMessage: 'Repair failed', status: NeedsAttention },
    ],

    // The rest.
    [
      'importing',
      Downloading,
      { trackedDownloadState: 'importing' },
      JUST,
      { status: Importing },
    ],
    [
      'imported',
      Downloading,
      { trackedDownloadState: 'imported' },
      JUST,
      { status: Importing },
    ],
    ['paused', Downloading, { status: 'paused' }, AFTER, { status: Paused }],
    ['queued', Searching, { status: 'queued' }, JUST, { status: Downloading }],
    [
      'downloading',
      Searching,
      { status: 'downloading' },
      AFTER,
      { status: Downloading },
    ],
  ]

  it.each(rows)('%s (from %s)', (_label, current, item, ago, expected) => {
    expect(
      deriveQueueItemState(current, item, {
        app: 'radarr',
        now: NOW,
        stateSince: since(ago),
      }),
    ).toEqual(expected)
  })

  it('names the app a delay came from', () => {
    expect(
      deriveQueueItemState(
        Searching,
        { status: 'delay' },
        { app: 'sonarr', now: NOW },
      ),
    ).toEqual({ status: Searching, statusNote: 'Delayed by Sonarr' })
  })

  it('waits two minutes before asking for attention', () => {
    expect(ATTENTION_DELAY_MS).toBe(120_000)
  })
})

describe('isQueueItemMoving', () => {
  const NOW = 1_800_000_000_000
  const DOWNLOADING: PollableQueueItem = {
    size: 1000,
    sizeleft: 500,
    status: 'downloading',
  }
  const moving = (item: PollableQueueItem, unchangedFor: number) =>
    isQueueItemMoving(item, 'radarr', NOW - unchangedFor, NOW)

  it('counts a download that changed within STALL_MS', () => {
    expect(moving(DOWNLOADING, 0)).toBe(true)
    expect(moving(DOWNLOADING, STALL_MS - 1)).toBe(true)
  })

  it('stops counting a download that has read the same for STALL_MS', () => {
    expect(moving(DOWNLOADING, STALL_MS)).toBe(false)
    expect(
      moving({ ...DOWNLOADING, trackedDownloadStatus: 'warning' }, STALL_MS),
    ).toBe(false)
  })

  it('stops counting an import Radarr keeps retrying once it stalls', () => {
    expect(moving(STUCK_IMPORT, STALL_MS - 1)).toBe(true)
    expect(moving(STUCK_IMPORT, STALL_MS)).toBe(false)
  })

  it('counts an import that is running, however long it has been', () => {
    const importing: PollableQueueItem = {
      ...DOWNLOADING,
      sizeleft: 0,
      status: 'completed',
      trackedDownloadState: 'importing',
    }

    expect(moving(importing, 10 * STALL_MS)).toBe(true)
  })

  it.each<[string, PollableQueueItem]>([
    ['failed', { ...DOWNLOADING, status: 'failed' }],
    [
      'failedPending',
      { ...DOWNLOADING, trackedDownloadState: 'failedPending' },
    ],
    ['in error', { ...DOWNLOADING, trackedDownloadStatus: 'error' }],
    ['delayed', { ...DOWNLOADING, status: 'delay' }],
    [
      'held for its client',
      { ...DOWNLOADING, status: 'downloadClientUnavailable' },
    ],
    [
      'blocked from import',
      { ...STUCK_IMPORT, trackedDownloadState: 'importBlocked' },
    ],
    ['paused', { ...DOWNLOADING, status: 'paused' }],
  ])('never counts an item %s, even one that just changed', (_, item) => {
    expect(moving(item, 0)).toBe(false)
  })
})

describe('aggregateQueueItems', () => {
  // The same thing `queue.find()` returns for "no entry", so the poller
  // hands both to settleAbsentJob the same way.
  it('returns undefined for an empty list', () => {
    expect(aggregateQueueItems([])).toBeUndefined()
  })

  it('returns the single item untouched', () => {
    const item = { size: 100, sizeleft: 40, status: 'downloading' }

    expect(aggregateQueueItems([item])).toBe(item)
  })

  it('sums size and sizeleft across every match', () => {
    const aggregate = aggregateQueueItems([
      { size: 100, sizeleft: 40 },
      { size: 200, sizeleft: 10 },
      { size: 50, sizeleft: 0 },
    ])

    expect(aggregate).toMatchObject({ size: 350, sizeleft: 50 })
    // Progress is over the whole scope, not over one episode.
    expect(toQueueSnapshot(aggregate!).progress).toBeCloseTo(85.71, 1)
  })

  // One failed episode has to surface as a failure rather than being
  // averaged away by nine healthy ones.
  it('lets a single failed item dominate everything else', () => {
    const aggregate = aggregateQueueItems([
      { size: 1, sizeleft: 0, trackedDownloadState: 'importing' },
      { size: 1, sizeleft: 1, status: 'downloading' },
      { size: 1, sizeleft: 1, status: 'failed' },
    ])

    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, aggregate!),
    ).toBe(DownloadJobStatus.Failed)
  })

  // A block is the one thing in the list a person can act on *now*, so it
  // outranks siblings that are still transferring - hiding it behind
  // "downloading" until the last episode lands would surface it minutes
  // late. The summed bytes still drive the progress bar.
  it('lets a single needs-attention item dominate downloading siblings', () => {
    const aggregate = aggregateQueueItems([
      { size: 1, sizeleft: 1, status: 'downloading' },
      { ...STUCK_IMPORT, size: 1, sizeleft: 0 },
      { size: 1, sizeleft: 1, status: 'queued' },
    ])

    expect(aggregate).toMatchObject({ size: 3, sizeleft: 2 })
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, aggregate!),
    ).toBe(DownloadJobStatus.NeedsAttention)
  })

  it('still lets a failed item dominate a needs-attention one', () => {
    const aggregate = aggregateQueueItems([
      { trackedDownloadState: 'importBlocked' },
      { status: 'failed' },
    ])

    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, aggregate!),
    ).toBe(DownloadJobStatus.Failed)
  })

  it('concatenates statusMessages across a needs-attention fold', () => {
    const aggregate = aggregateQueueItems([
      { statusMessages: [{ messages: ['still downloading'], title: 'a' }] },
      STUCK_IMPORT,
    ])

    expect(describeQueueItemError(aggregate!)).toBe(
      'still downloading; Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265',
    )
  })

  // The bug this whole function exists to prevent: a season must not report
  // "Importing" while half of it is still on the wire.
  it('ranks downloading above importing', () => {
    const aggregate = aggregateQueueItems([
      { trackedDownloadState: 'importing' },
      { status: 'queued' },
    ])

    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, aggregate!),
    ).toBe(DownloadJobStatus.Downloading)
  })

  // Paused sits outside STATUS_PRECEDENCE on purpose: a season with one
  // paused episode and others still moving must report the season as
  // Downloading, not Paused - only reporting Paused once every match is.
  it('does not let one paused episode override an otherwise-downloading season', () => {
    const aggregate = aggregateQueueItems([
      { status: 'paused' },
      { status: 'queued' },
    ])

    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, aggregate!),
    ).toBe(DownloadJobStatus.Downloading)
  })

  it('reports Paused when every match is paused', () => {
    const aggregate = aggregateQueueItems([
      { status: 'paused' },
      { status: 'paused' },
    ])

    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, aggregate!),
    ).toBe(DownloadJobStatus.Paused)
  })

  it('reports Importing only when every match is importing', () => {
    const aggregate = aggregateQueueItems([
      { trackedDownloadState: 'importing' },
      { trackedDownloadState: 'imported' },
    ])

    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, aggregate!),
    ).toBe(DownloadJobStatus.Importing)
  })

  // The item that finishes last is the one that answers "when is this done".
  it('takes timeleft and estimatedCompletionTime from the largest sizeleft', () => {
    expect(
      aggregateQueueItems([
        {
          estimatedCompletionTime: '2026-08-20T12:05:00Z',
          sizeleft: 10,
          timeleft: '00:05:00',
        },
        {
          estimatedCompletionTime: '2026-08-20T12:40:00Z',
          sizeleft: 900,
          timeleft: '00:40:00',
        },
        {
          estimatedCompletionTime: '2026-08-20T12:10:00Z',
          sizeleft: 100,
          timeleft: '00:10:00',
        },
      ]),
    ).toMatchObject({
      estimatedCompletionTime: '2026-08-20T12:40:00Z',
      timeleft: '00:40:00',
    })
  })

  it('concatenates statusMessages so every failure is still reported', () => {
    const aggregate = aggregateQueueItems([
      { statusMessages: [{ messages: ['unpack failed'], title: 'a' }] },
      { statusMessages: null },
      { statusMessages: [{ messages: ['no matching series'], title: 'b' }] },
    ])

    expect(describeQueueItemError(aggregate!)).toBe(
      'unpack failed; no matching series',
    )
  })

  it('leaves statusMessages undefined when no match had any', () => {
    const aggregate = aggregateQueueItems([
      { sizeleft: 1 },
      { statusMessages: null },
    ])

    expect(aggregate?.statusMessages).toBeUndefined()
    expect(describeQueueItemError(aggregate!)).toBeUndefined()
  })

  it('treats a missing size/sizeleft as zero rather than NaN', () => {
    expect(
      aggregateQueueItems([{ status: 'queued' }, { size: 10 }]),
    ).toMatchObject({ size: 10, sizeleft: 0 })
  })
})

describe('aggregateQueueItems per download', () => {
  const GB = 1_000_000_000

  // Sonarr's shape for a season pack: one row per episode, each carrying the
  // whole pack's size.
  const pack = (episodeId: number): PollableQueueItem => ({
    downloadId: 'SABnzbd_nzo_pack',
    episodeId,
    size: 10 * GB,
    sizeleft: 4 * GB,
    status: 'downloading',
  })

  it.each<[string, PollableQueueItem[], { size: number; sizeleft: number }]>([
    [
      'a season pack counts once',
      [pack(1), pack(2), pack(3)],
      { size: 10 * GB, sizeleft: 4 * GB },
    ],
    [
      'a pack plus a single-episode grab',
      [
        pack(1),
        pack(2),
        {
          downloadId: 'SABnzbd_nzo_single',
          episodeId: 3,
          size: GB,
          sizeleft: GB,
        },
      ],
      { size: 11 * GB, sizeleft: 5 * GB },
    ],
    [
      'rows with no downloadId each count',
      [
        { size: 100, sizeleft: 40 },
        { downloadId: null, size: 100, sizeleft: 40 },
      ],
      { size: 200, sizeleft: 80 },
    ],
  ])('%s', (_label, items, expected) => {
    expect(aggregateQueueItems(items)).toMatchObject(expected)
  })

  it('reads pack progress over the pack, not over its episode rows', () => {
    const aggregate = aggregateQueueItems([pack(1), pack(2), pack(3)])

    expect(toQueueSnapshot(aggregate!).progress).toBe(60)
  })

  it.each<[string, PollableQueueItem[], string | undefined]>([
    [
      'the first non-empty errorMessage',
      [
        { errorMessage: null },
        { errorMessage: '' },
        { errorMessage: 'Unpacking failed' },
        { errorMessage: 'later' },
      ],
      'Unpacking failed',
    ],
    ['none when no item has one', [{}, { errorMessage: null }], undefined],
  ])('carries %s', (_label, items, expected) => {
    expect(aggregateQueueItems(items)?.errorMessage).toBe(expected)
  })

  it.each<[string, PollableQueueItem[], boolean | undefined]>([
    [
      'every item has a file',
      [{ episodeHasFile: true }, { episodeHasFile: true }],
      true,
    ],
    [
      'one item lacks a file',
      [{ episodeHasFile: true }, { episodeHasFile: false }],
      false,
    ],
    ['one item does not say', [{ episodeHasFile: true }, {}], false],
    ['no item says (Radarr)', [{}, {}], undefined],
  ])('sets episodeHasFile when %s', (_label, items, expected) => {
    expect(aggregateQueueItems(items)?.episodeHasFile).toBe(expected)
  })

  it('lets a multi-item job surface the client errorMessage', () => {
    const aggregate = aggregateQueueItems([
      { status: 'downloading' },
      { errorMessage: 'Unpacking failed', status: 'warning' },
    ])

    expect(describeQueueItemError(aggregate!)).toBe('Unpacking failed')
  })
})

describe('settleAbsentJob', () => {
  const {
    Cancelled,
    Cancelling,
    Cleaning,
    Completed,
    Converting,
    Downloading,
    Failed,
    Importing,
    NeedsAttention,
    NotFound,
    Paused,
    Pausing,
    Pending,
    Requested,
    Searching,
    Uploading,
  } = DownloadJobStatus
  const GONE = ABSENT_REMOVED_MS
  // How long a cancelling job's resolved links must agree with an empty
  // queue before the cancel is called done - two separate reads.
  const CONFIRM = 5_000
  const TWENTY_MIN = 1_200_000
  const T = '2026-09-28T12:00:00Z'

  const open: JobDownloadLink = { downloadId: 'a' }
  const imported: JobDownloadLink = { downloadId: 'b', importedAt: T }
  const failed: JobDownloadLink = { downloadId: 'c', failedAt: T }

  const facts = (overrides: Partial<AbsentJobFacts>): AbsentJobFacts => ({
    absentForMs: 0,
    clientHealthyForMs: 0,
    fileLanded: false,
    links: [],
    ...overrides,
  })

  // [label, current, facts, expected] - `undefined` is "leave the job
  // unchanged".
  const rows: Array<
    [string, DownloadJobStatus, AbsentJobFacts, DownloadJobStatus | undefined]
  > = [
    // A landed file completes the job, links or not.
    ['file landed, no link', Searching, facts({ fileLanded: true }), Completed],
    [
      'file landed, requested',
      Requested,
      facts({ fileLanded: true }),
      Completed,
    ],
    [
      'file landed, open link',
      Downloading,
      facts({ fileLanded: true, links: [open] }),
      Completed,
    ],
    [
      'file landed, blocked import',
      NeedsAttention,
      facts({ fileLanded: true, links: [open] }),
      Completed,
    ],
    [
      'file landed, paused',
      Paused,
      facts({ fileLanded: true, links: [open] }),
      Completed,
    ],

    // No link: never settled by absence, however long and however healthy.
    [
      'no link, searching, long gone',
      Searching,
      facts({ absentForMs: GONE * 10, clientHealthyForMs: GONE * 10 }),
      undefined,
    ],
    [
      'no link, requested, long gone',
      Requested,
      facts({ absentForMs: GONE * 10, clientHealthyForMs: GONE * 10 }),
      undefined,
    ],
    [
      'no link, downloading, long gone',
      Downloading,
      facts({ absentForMs: GONE * 10, clientHealthyForMs: GONE * 10 }),
      undefined,
    ],

    // Imported links: completed once every link is imported or failed.
    ['one imported link', Importing, facts({ links: [imported] }), Completed],
    [
      'imported + failed',
      Downloading,
      facts({ links: [imported, failed] }),
      Completed,
    ],
    [
      'imported + open',
      Importing,
      facts({
        absentForMs: GONE - 1,
        clientHealthyForMs: GONE,
        links: [imported, open],
      }),
      undefined,
    ],
    [
      'imported + open, removed at the client',
      Importing,
      facts({
        absentForMs: GONE,
        clientHealthyForMs: GONE,
        links: [imported, open],
      }),
      Completed,
    ],

    // Only failures: 3·C1's retry logic decides, never absence.
    ['only failed links', Downloading, facts({ links: [failed] }), undefined],
    [
      'only failed links, long gone',
      Searching,
      facts({
        absentForMs: GONE * 10,
        clientHealthyForMs: GONE * 10,
        links: [failed, { ...failed, downloadId: 'd' }],
      }),
      undefined,
    ],

    // An open link, absent with the client healthy the whole time.
    [
      'open link, just gone',
      Downloading,
      facts({ absentForMs: 0, clientHealthyForMs: GONE, links: [open] }),
      undefined,
    ],
    [
      'open link, just under the wait',
      Downloading,
      facts({
        absentForMs: GONE - 1,
        clientHealthyForMs: GONE * 2,
        links: [open],
      }),
      undefined,
    ],
    [
      'open link, at the wait',
      Downloading,
      facts({ absentForMs: GONE, clientHealthyForMs: GONE, links: [open] }),
      Cancelled,
    ],
    [
      'open link, importing',
      Importing,
      facts({ absentForMs: GONE, clientHealthyForMs: GONE * 2, links: [open] }),
      Cancelled,
    ],
    [
      'open link, paused',
      Paused,
      facts({ absentForMs: GONE, clientHealthyForMs: GONE, links: [open] }),
      Cancelled,
    ],
    [
      'open link, blocked import given up on',
      NeedsAttention,
      facts({ absentForMs: GONE, clientHealthyForMs: GONE, links: [open] }),
      Cancelled,
    ],
    [
      'open link after a failed one',
      Downloading,
      facts({
        absentForMs: GONE,
        clientHealthyForMs: GONE,
        links: [failed, open],
      }),
      Cancelled,
    ],

    // The client was unhealthy during the absence: the queue proves nothing.
    [
      'SAB unreachable for 20 min',
      Downloading,
      facts({ absentForMs: TWENTY_MIN, clientHealthyForMs: 0, links: [open] }),
      undefined,
    ],
    [
      'SAB back only partway through',
      Downloading,
      facts({
        absentForMs: TWENTY_MIN,
        clientHealthyForMs: TWENTY_MIN - 1,
        links: [open],
      }),
      undefined,
    ],
    [
      'SAB unreachable, blocked import',
      NeedsAttention,
      facts({ absentForMs: TWENTY_MIN, clientHealthyForMs: 0, links: [open] }),
      undefined,
    ],

    // Cancelling: settleCancelling, the links read as its outcome.
    [
      'cancelling, file landed anyway',
      Cancelling,
      facts({ fileLanded: true, links: [open] }),
      Completed,
    ],
    [
      'cancelling, no link, inside the grace',
      Cancelling,
      facts({ absentForMs: CANCEL_GRACE_MS - 1 }),
      undefined,
    ],
    [
      'cancelling, no link, grace spent',
      Cancelling,
      facts({ absentForMs: CANCEL_GRACE_MS }),
      Cancelled,
    ],
    [
      'cancelling, open link, inside the grace',
      Cancelling,
      facts({ absentForMs: CANCEL_GRACE_MS - 1, links: [open] }),
      undefined,
    ],
    [
      'cancelling, failed link, not yet confirmed',
      Cancelling,
      facts({ absentForMs: CONFIRM - 1, links: [failed] }),
      undefined,
    ],
    [
      'cancelling, failed link, confirmed',
      Cancelling,
      facts({ absentForMs: CONFIRM, links: [failed] }),
      Cancelled,
    ],
    [
      'cancelling, imported link, inside the grace',
      Cancelling,
      facts({ absentForMs: CONFIRM, links: [imported] }),
      undefined,
    ],
    [
      'cancelling, imported link, grace spent',
      Cancelling,
      facts({ absentForMs: CANCEL_GRACE_MS, links: [imported] }),
      Cancelled,
    ],

    // Video-only and terminal statuses: never moved.
    ...[
      Cleaning,
      Converting,
      Pausing,
      Pending,
      Uploading,
      Cancelled,
      Completed,
      Failed,
      NotFound,
    ].map((status): [string, DownloadJobStatus, AbsentJobFacts, undefined] => [
      'not a live movie/show status',
      status,
      facts({
        absentForMs: GONE,
        clientHealthyForMs: GONE,
        fileLanded: true,
        links: [imported, open],
      }),
      undefined,
    ]),
  ]

  it.each(rows)('%s (%s)', (_label, current, input, expected) => {
    expect(settleAbsentJob(current, input)).toBe(expected)
  })

  it('covers every job status', () => {
    const covered = new Set(rows.map(([, status]) => status))

    expect(Array.from(covered).sort()).toEqual(
      Object.values(DownloadJobStatus).sort(),
    )
  })

  it('waits ten minutes before calling a download removed', () => {
    expect(ABSENT_REMOVED_MS).toBe(600_000)
    expect(REMOVED_FROM_CLIENT_ERROR).toBe('Removed from the download client')
  })

  it('waits half a minute on a cancel with nothing to confirm it', () => {
    expect(CANCEL_GRACE_MS).toBe(30_000)
  })
})

describe('matchesScope', () => {
  it('matches an episode-scoped job only on that exact episode', () => {
    expect(matchesScope({ episodeId: 42 }, { episodeId: 42 })).toBe(true)
    expect(matchesScope({ episodeId: 43 }, { episodeId: 42 })).toBe(false)
  })

  // An item Sonarr can't attribute to an episode is not evidence about
  // *this* episode, so it must never match an episode-scoped job.
  it('never matches an episode scope on a null or absent episodeId', () => {
    expect(matchesScope({ episodeId: null }, { episodeId: 42 })).toBe(false)
    expect(matchesScope({}, { episodeId: 42 })).toBe(false)
  })

  it('matches a season-scoped job on the season number', () => {
    expect(matchesScope({ seasonNumber: 3 }, { seasonNumber: 3 })).toBe(true)
    expect(matchesScope({ seasonNumber: 4 }, { seasonNumber: 3 })).toBe(false)
  })

  // Season 0 is Sonarr's specials season, so the scope check is `!= null`
  // rather than truthiness - truthiness would silently widen a specials job
  // to the whole series.
  it('treats season 0 as a real season', () => {
    expect(matchesScope({ seasonNumber: 0 }, { seasonNumber: 0 })).toBe(true)
    expect(matchesScope({ seasonNumber: 1 }, { seasonNumber: 0 })).toBe(false)
  })

  it('prefers the episode scope over the season scope', () => {
    expect(
      matchesScope(
        { episodeId: 7, seasonNumber: 9 },
        { episodeId: 7, seasonNumber: 3 },
      ),
    ).toBe(true)
  })

  it('matches every item of the series for an unscoped job', () => {
    expect(matchesScope({ episodeId: 1, seasonNumber: 2 }, undefined)).toBe(
      true,
    )
    expect(matchesScope({}, {})).toBe(true)
  })
})
