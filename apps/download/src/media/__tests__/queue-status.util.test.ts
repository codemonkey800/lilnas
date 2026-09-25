import { DownloadJobStatus } from '@lilnas/utils/download/types'

import {
  aggregateQueueItems,
  CANCEL_GRACE_MS,
  dequeuedOutcome,
  deriveStatusFromQueueItem,
  describeQueueItemError,
  isQueueSnapshotEqual,
  LEFT_QUEUE_WITHOUT_FILE_ERROR,
  matchesScope,
  QUEUE_ABSENCE_GRACE_MS,
  QUEUE_REMOVAL_CONFIRM_MS,
  settleWithoutQueueItem,
  toQueueSnapshot,
} from 'src/media/queue-status.util'

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

describe('settleWithoutQueueItem', () => {
  const GRACE = QUEUE_ABSENCE_GRACE_MS
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
    Paused,
    Pausing,
    Pending,
    Requested,
    Searching,
    Uploading,
  } = DownloadJobStatus

  // [current, fileLanded, absentForMs, expected] - `undefined` is "leave the
  // job unchanged".
  const rows: Array<
    [DownloadJobStatus, boolean, number, DownloadJobStatus | undefined]
  > = [
    // A file landed: completed, whatever the job last looked like - that
    // includes a whole download that ran between two ticks while the job
    // still read `searching`, and a blocked import a human finished.
    [Requested, true, 0, Completed],
    [Searching, true, 0, Completed],
    [Downloading, true, 0, Completed],
    [Importing, true, 0, Completed],
    [NeedsAttention, true, 0, Completed],
    [Paused, true, 0, Completed],
    [Downloading, true, GRACE * 10, Completed],

    // Grabbed, no file, inside the grace period: the import may be racing
    // the file listing.
    [Downloading, false, 0, undefined],
    [Downloading, false, GRACE - 1, undefined],
    [Importing, false, 0, undefined],
    [Importing, false, GRACE - 1, undefined],
    [Paused, false, GRACE - 1, undefined],

    // Grabbed, no file, grace spent: the download left and nothing landed.
    [Downloading, false, GRACE, Failed],
    [Downloading, false, GRACE + 1_000, Failed],
    [Importing, false, GRACE, Failed],
    [Paused, false, GRACE, Failed],

    // Never grabbed, or waiting on a human: an empty queue is expected, and
    // no amount of waiting makes it a failure.
    [Requested, false, 0, undefined],
    [Requested, false, GRACE * 10, undefined],
    [Searching, false, 0, undefined],
    [Searching, false, GRACE * 10, undefined],
    [NeedsAttention, false, 0, undefined],
    [NeedsAttention, false, GRACE * 10, undefined],

    // Cancelling with no history to go on (never grabbed, or after a
    // restart): a file that landed anyway means the cancel came late;
    // otherwise cancelled once a still-running search has had its chance to
    // grab.
    [Cancelling, true, 0, Completed],
    [Cancelling, true, CANCEL_GRACE_MS, Completed],
    [Cancelling, false, 0, undefined],
    [Cancelling, false, QUEUE_REMOVAL_CONFIRM_MS, undefined],
    [Cancelling, false, CANCEL_GRACE_MS - 1, undefined],
    [Cancelling, false, CANCEL_GRACE_MS, Cancelled],
    [Cancelling, false, GRACE, Cancelled],

    // Video-only statuses a movie/show job never holds: never moved.
    ...[Cleaning, Converting, Pausing, Pending, Uploading].flatMap(
      (status): Array<[DownloadJobStatus, boolean, number, undefined]> => [
        [status, true, GRACE, undefined],
        [status, false, GRACE, undefined],
      ],
    ),

    // Terminal: already settled.
    ...[Cancelled, Completed, Failed].flatMap(
      (status): Array<[DownloadJobStatus, boolean, number, undefined]> => [
        [status, true, GRACE, undefined],
        [status, false, GRACE, undefined],
      ],
    ),
  ]

  it.each(rows)(
    '%s, file landed %s, absent %d ms -> %s',
    (current, fileLanded, absentForMs, expected) => {
      expect(settleWithoutQueueItem(current, fileLanded, absentForMs)).toBe(
        expected,
      )
    },
  )

  it('covers every job status', () => {
    const covered = new Set(rows.map(([status]) => status))

    expect(Array.from(covered).sort()).toEqual(
      Object.values(DownloadJobStatus).sort(),
    )
  })

  it('waits a minute', () => {
    expect(QUEUE_ABSENCE_GRACE_MS).toBe(60_000)
    expect(LEFT_QUEUE_WITHOUT_FILE_ERROR).toBe(
      'Left the queue without producing a file',
    )
  })

  it('waits half a minute on a cancel', () => {
    expect(CANCEL_GRACE_MS).toBe(30_000)
  })
})

describe('settleWithoutQueueItem with a dequeued outcome', () => {
  const CONFIRM = QUEUE_REMOVAL_CONFIRM_MS
  const {
    Cancelled,
    Cancelling,
    Completed,
    Downloading,
    Failed,
    Importing,
    NeedsAttention,
  } = DownloadJobStatus
  const removed = { kind: 'removed' } as const
  const failed = { kind: 'failed', reason: 'Repair failed' } as const
  const imported = { kind: 'imported' } as const

  it.each([
    // Removed upstream: cancelled once two reads agree, not on the first.
    [Downloading, removed, 0, undefined],
    [Downloading, removed, CONFIRM - 1, undefined],
    [Downloading, removed, CONFIRM, Cancelled],
    [Importing, removed, CONFIRM, Cancelled],
    // Someone gave up on a blocked import in Radarr's own UI.
    [NeedsAttention, removed, CONFIRM, Cancelled],
    // The client failed it: no need to wait out the grace period.
    [Downloading, failed, CONFIRM, Failed],
    [NeedsAttention, failed, CONFIRM, Failed],
    // Imported: the file is coming, so the grace period still rules.
    [Downloading, imported, CONFIRM, undefined],
    [Downloading, imported, QUEUE_ABSENCE_GRACE_MS, Failed],
    [NeedsAttention, imported, QUEUE_ABSENCE_GRACE_MS, undefined],
    // Cancelling, the download removed or failed: cancelled once two reads
    // agree, the same confirmation as a removal made upstream.
    [Cancelling, removed, 0, undefined],
    [Cancelling, removed, CONFIRM - 1, undefined],
    [Cancelling, removed, CONFIRM, Cancelled],
    [Cancelling, failed, CONFIRM - 1, undefined],
    [Cancelling, failed, CONFIRM, Cancelled],
    // Cancelling, an import recorded: the file may yet land, so wait out the
    // cancel grace rather than the removal confirmation.
    [Cancelling, imported, CONFIRM, undefined],
    [Cancelling, imported, CANCEL_GRACE_MS - 1, undefined],
    [Cancelling, imported, CANCEL_GRACE_MS, Cancelled],
  ] as const)(
    '%s, %o, absent %d ms -> %s',
    (current, outcome, absentForMs, expected) => {
      expect(settleWithoutQueueItem(current, false, absentForMs, outcome)).toBe(
        expected,
      )
    },
  )

  it('still completes a job whose file landed, whatever the history says', () => {
    expect(settleWithoutQueueItem(Downloading, true, CONFIRM, removed)).toBe(
      Completed,
    )
  })

  it.each([removed, failed, imported])(
    'completes a cancelling job whose file landed anyway, %o',
    outcome => {
      expect(settleWithoutQueueItem(Cancelling, true, 0, outcome)).toBe(
        Completed,
      )
    },
  )

  it('leaves a terminal job alone', () => {
    expect(
      settleWithoutQueueItem(Cancelled, false, CONFIRM, removed),
    ).toBeUndefined()
  })
})

describe('dequeuedOutcome', () => {
  const OWN = new Set(['abc'])
  const grabbed = { downloadId: 'abc', eventType: 'grabbed' }

  it('reads a download with nothing after its grab as removed', () => {
    expect(dequeuedOutcome([grabbed], OWN)).toEqual({ kind: 'removed' })
  })

  it('reads a recorded import as imported', () => {
    expect(
      dequeuedOutcome(
        [grabbed, { downloadId: 'abc', eventType: 'downloadFolderImported' }],
        OWN,
      ),
    ).toEqual({ kind: 'imported' })
  })

  it("reads a client failure as failed, with the client's reason", () => {
    expect(
      dequeuedOutcome(
        [
          grabbed,
          {
            data: { message: 'Repair failed, not enough repair blocks' },
            downloadId: 'abc',
            eventType: 'downloadFailed',
          },
        ],
        OWN,
      ),
    ).toEqual({
      kind: 'failed',
      reason: 'Repair failed, not enough repair blocks',
    })
  })

  it('reads a blocklisted or ignored removal as removed', () => {
    expect(
      dequeuedOutcome(
        [
          grabbed,
          {
            data: { message: 'Manually marked as failed' },
            downloadId: 'abc',
            eventType: 'downloadFailed',
          },
        ],
        OWN,
      ),
    ).toEqual({ kind: 'removed' })
    expect(
      dequeuedOutcome(
        [grabbed, { downloadId: 'abc', eventType: 'downloadIgnored' }],
        OWN,
      ),
    ).toEqual({ kind: 'removed' })
  })

  it("ignores every other download's records", () => {
    expect(
      dequeuedOutcome(
        [
          grabbed,
          { downloadId: 'other', eventType: 'downloadFolderImported' },
          { downloadId: null, eventType: 'downloadFailed' },
        ],
        OWN,
      ),
    ).toEqual({ kind: 'removed' })
  })
})

describe('aggregateQueueItems', () => {
  // The same thing `queue.find()` returns for "no entry", so the poller
  // hands both to settleWithoutQueueItem the same way.
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
      { statusMessages: [{ messages: ['disk full'], title: 'a' }] },
      { statusMessages: null },
      { statusMessages: [{ messages: ['no matching series'], title: 'b' }] },
    ])

    expect(describeQueueItemError(aggregate!)).toBe(
      'disk full; no matching series',
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
