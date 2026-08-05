import { DownloadJobStatus } from '@lilnas/utils/download/types'

import {
  deriveStatusFromQueueItem,
  describeQueueItemError,
  isQueueSnapshotEqual,
  toQueueSnapshot,
} from 'src/media/queue-status.util'

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
  it('completes a job that was downloading/importing once it drops out of the queue', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Downloading, undefined),
    ).toBe(DownloadJobStatus.Completed)
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Importing, undefined),
    ).toBe(DownloadJobStatus.Completed)
  })

  it('leaves a not-yet-grabbed job alone when there is no queue entry', () => {
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Requested, undefined),
    ).toBe(DownloadJobStatus.Requested)
    expect(
      deriveStatusFromQueueItem(DownloadJobStatus.Searching, undefined),
    ).toBe(DownloadJobStatus.Searching)
  })

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

  it('maps importing tracked-download-states to Importing', () => {
    for (const state of ['importBlocked', 'importPending', 'importing']) {
      expect(
        deriveStatusFromQueueItem(DownloadJobStatus.Downloading, {
          trackedDownloadState: state,
        }),
      ).toBe(DownloadJobStatus.Importing)
    }
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

  it('maps everything else (queued, downloading, paused, ...) to Downloading', () => {
    for (const status of ['queued', 'downloading', 'paused', 'warning']) {
      expect(
        deriveStatusFromQueueItem(DownloadJobStatus.Searching, { status }),
      ).toBe(DownloadJobStatus.Downloading)
    }
  })
})
