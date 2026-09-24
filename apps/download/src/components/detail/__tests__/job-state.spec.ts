import type {
  DownloadJob,
  Movie,
  Video,
  VideoProgress,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import type { JobActionKey } from 'src/components/detail/job-state'
import {
  handoffDetail,
  jobActionState,
  jobHandoff,
  jobProgress,
  jobStatusLabel,
  jobTransferLine,
  latestJob,
} from 'src/components/detail/job-state'

const EVERY_STATUS = Object.values(DownloadJobStatus)

const MOVIE: Movie = {
  id: 'tmdb:11660',
  title: 'Following',
  tmdbId: 11660,
  type: DownloadType.Movie,
}

const VIDEO: Video = {
  id: 'video:abc123',
  sourceUrl: 'https://youtube.com/watch?v=abc',
  title: 'Sourdough starter',
  type: DownloadType.Video,
}

const MB = 1024 * 1024

/** A video job carrying one yt-dlp tick. */
function videoJob(progress?: VideoProgress): DownloadJob {
  return job({ media: VIDEO, ...(progress ? { progress } : {}) })
}

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job_1',
    linkedDiscord: null,
    media: MOVIE,
    requester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_1' },
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:30:00.000Z',
    ...overrides,
  }
}

/**
 * The whole state table, spelled out once. Every status appears, so a status
 * added to the enum fails the exhaustiveness check below rather than quietly
 * inheriting whatever the `switch` happened to fall through to.
 */
const EXPECTED: Record<
  DownloadJobStatus,
  Partial<Record<JobActionKey, 'acknowledged' | 'offered'>>
> = {
  [DownloadJobStatus.Requested]: { cancel: 'offered' },
  [DownloadJobStatus.Pending]: { cancel: 'offered' },
  [DownloadJobStatus.Searching]: { cancel: 'offered' },
  [DownloadJobStatus.Downloading]: { cancel: 'offered', pause: 'offered' },
  [DownloadJobStatus.Pausing]: {
    cancel: 'offered',
    pause: 'acknowledged',
  },
  [DownloadJobStatus.Paused]: { cancel: 'offered', resume: 'offered' },
  [DownloadJobStatus.Converting]: { cancel: 'offered' },
  [DownloadJobStatus.Uploading]: { cancel: 'offered' },
  [DownloadJobStatus.Importing]: { cancel: 'offered' },
  [DownloadJobStatus.NeedsAttention]: { cancel: 'offered', import: 'offered' },
  [DownloadJobStatus.Cleaning]: { cancel: 'offered' },
  [DownloadJobStatus.Cancelling]: { cancel: 'acknowledged' },
  [DownloadJobStatus.Completed]: { save: 'offered', watch: 'offered' },
  [DownloadJobStatus.Failed]: { retry: 'offered' },
  [DownloadJobStatus.Cancelled]: { retry: 'offered' },
}

const ACTION_KEYS: JobActionKey[] = [
  'cancel',
  'import',
  'pause',
  'resume',
  'retry',
  'save',
  'watch',
]

describe('jobActionState', () => {
  it.each(EVERY_STATUS)('answers every action for %s', status => {
    const expected = EXPECTED[status]

    for (const action of ACTION_KEYS) {
      expect([status, action, jobActionState(status, action)]).toEqual([
        status,
        action,
        expected[action] ?? 'none',
      ])
    }
  })

  it('offers pause only while downloading, and only acknowledges it while pausing', () => {
    // The API answers 409 for a pause on anything else, so anywhere this
    // returns 'offered' outside these two is a button that can only error.
    const offering = EVERY_STATUS.filter(
      status => jobActionState(status, 'pause') === 'offered',
    )
    const acknowledging = EVERY_STATUS.filter(
      status => jobActionState(status, 'pause') === 'acknowledged',
    )

    expect(offering).toEqual([DownloadJobStatus.Downloading])
    expect(acknowledging).toEqual([DownloadJobStatus.Pausing])
  })

  it('never offers cancel on a terminal status', () => {
    const terminal = [
      DownloadJobStatus.Cancelled,
      DownloadJobStatus.Completed,
      DownloadJobStatus.Failed,
    ]

    for (const status of terminal) {
      expect(jobActionState(status, 'cancel')).toBe('none')
    }
  })

  it('offers import on needs_attention only', () => {
    // Import resolves a decision upstream is waiting on. Every other status
    // either has nothing on disk yet or nobody waiting on a choice, so an
    // Import control anywhere else would be a button with nothing to decide.
    const offering = EVERY_STATUS.filter(
      status => jobActionState(status, 'import') === 'offered',
    )

    expect(offering).toEqual([DownloadJobStatus.NeedsAttention])
  })

  it('keeps a stuck import cancellable and un-retryable, because it is not over', () => {
    // Non-terminal: the job is still open work, so the way out is to cancel
    // it rather than to ask again for something already sitting on disk.
    expect(jobActionState(DownloadJobStatus.NeedsAttention, 'cancel')).toBe(
      'offered',
    )
    expect(jobActionState(DownloadJobStatus.NeedsAttention, 'retry')).toBe(
      'none',
    )
  })

  it('offers retry on every terminal status except success', () => {
    expect(jobActionState(DownloadJobStatus.Failed, 'retry')).toBe('offered')
    expect(jobActionState(DownloadJobStatus.Cancelled, 'retry')).toBe('offered')
    expect(jobActionState(DownloadJobStatus.Completed, 'retry')).toBe('none')
  })
})

describe('jobStatusLabel', () => {
  it('has a non-empty label for every status', () => {
    for (const status of EVERY_STATUS) {
      expect(jobStatusLabel(status)).not.toBe('')
    }
  })

  it('renames the wait for a slot to the word the UI uses for it', () => {
    expect(jobStatusLabel(DownloadJobStatus.Pending)).toBe('queued')
  })

  it('marks the two acknowledgement states as in flight', () => {
    expect(jobStatusLabel(DownloadJobStatus.Pausing)).toBe('pausing…')
    expect(jobStatusLabel(DownloadJobStatus.Cancelling)).toBe('cancelling…')
  })

  it('names what the reader has to do about a stuck import', () => {
    // The mockup's words. `needs_attention` describes the condition; the chip
    // has to say whose move it is.
    expect(jobStatusLabel(DownloadJobStatus.NeedsAttention)).toBe(
      'needs your decision',
    )
  })
})

describe('latestJob', () => {
  it('takes the head of a newest-first list', () => {
    const newest = job({ id: 'job_2' })
    const older = job({ id: 'job_1' })

    expect(latestJob([newest, older])?.id).toBe('job_2')
  })

  it('answers null for a title this app never fetched', () => {
    expect(latestJob([])).toBeNull()
  })
})

describe('jobProgress', () => {
  it('reads a managed title from its queue snapshot', () => {
    const progress = jobProgress(
      job({
        media: {
          ...MOVIE,
          queueSnapshot: {
            progress: 47.25,
            status: 'downloading',
            timeLeft: '00:12:34',
          },
        },
      }),
    )

    // The queue carries no bytes, so a movie never has a transfer line.
    expect(progress).toEqual({
      detail: null,
      note: 'downloading',
      pct: 47.25,
      timeLeft: '00:12:34',
    })
  })

  it('answers null for a video with no progress on it', () => {
    expect(jobProgress(videoJob())).toBeNull()
  })

  it('answers null for a video whose total yt-dlp does not know yet', () => {
    const noTotal = videoJob({
      downloadedBytes: 412 * MB,
      fileIndex: 1,
      speedBps: 3.25e6,
    })

    // A `0%` bar would be a claim - the activity goes on the transfer line.
    expect(jobProgress(noTotal)).toBeNull()
    expect(jobTransferLine(noTotal)).toBe('412 MB · 3.1 MB/s')
  })

  it('answers null for a video whose percentage is not a finite number', () => {
    expect(
      jobProgress(
        videoJob({ downloadedBytes: MB, fileIndex: 1, percent: Number.NaN }),
      ),
    ).toBeNull()
  })

  it('reads a progressive video tick in full', () => {
    expect(
      jobProgress(
        videoJob({
          downloadedBytes: 412 * MB,
          etaSeconds: 125,
          fileCount: 2,
          fileIndex: 1,
          percent: 64,
          speedBps: 3.25e6,
          totalBytes: 640 * MB,
        }),
      ),
    ).toEqual({
      detail: '412 MB / 640 MB · 3.1 MB/s',
      note: 'file 1 of 2',
      pct: 64,
      timeLeft: '~2m left',
    })
  })

  it('reads an HLS tick, fragments and an estimated total included', () => {
    expect(
      jobProgress(
        videoJob({
          downloadedBytes: 412 * MB,
          etaSeconds: 125,
          fileCount: 2,
          fileIndex: 1,
          fragmentCount: 123,
          fragmentIndex: 4,
          percent: 3.25,
          speedBps: 3.25e6,
          totalBytes: 640 * MB,
          totalIsEstimate: true,
        }),
      ),
    ).toEqual({
      detail: '412 MB / ~640 MB · 3.1 MB/s',
      note: 'file 1 of 2 · fragment 4 of 123',
      pct: 3.25,
      timeLeft: '~2m left',
    })
  })

  it('names a second file even when the count is unknown', () => {
    expect(
      jobProgress(
        videoJob({
          downloadedBytes: 412 * MB,
          fileIndex: 2,
          percent: 50,
          totalBytes: 824 * MB,
        }),
      ),
    ).toMatchObject({ note: 'file 2' })
  })

  it('leaves the file counter off a single-file grab', () => {
    expect(
      jobProgress(
        videoJob({
          downloadedBytes: 412 * MB,
          fileCount: 1,
          fileIndex: 1,
          percent: 50,
          totalBytes: 824 * MB,
        }),
      ),
    ).toMatchObject({ note: null })
  })

  it('omits the rate and the estimate when yt-dlp has neither', () => {
    expect(
      jobProgress(
        videoJob({
          downloadedBytes: 412 * MB,
          fileIndex: 1,
          percent: 50,
          totalBytes: 824 * MB,
        }),
      ),
    ).toEqual({
      detail: '412 MB / 824 MB',
      note: null,
      pct: 50,
      timeLeft: null,
    })
  })

  it('answers null when the queue reported no percentage', () => {
    expect(
      jobProgress(
        job({ media: { ...MOVIE, queueSnapshot: { status: 'delay' } } }),
      ),
    ).toBeNull()
  })

  it('answers null when there is no queue snapshot at all', () => {
    expect(jobProgress(job())).toBeNull()
  })
})

describe('jobTransferLine', () => {
  it('answers null for a video that already draws a bar', () => {
    expect(
      jobTransferLine(
        videoJob({
          downloadedBytes: 412 * MB,
          fileIndex: 1,
          percent: 64,
          speedBps: 3.25e6,
          totalBytes: 640 * MB,
        }),
      ),
    ).toBeNull()
  })

  it('answers null for a video with no progress on it', () => {
    expect(jobTransferLine(videoJob())).toBeNull()
  })

  it('answers null for a movie, whose queue carries no bytes', () => {
    expect(
      jobTransferLine(
        job({ media: { ...MOVIE, queueSnapshot: { status: 'delay' } } }),
      ),
    ).toBeNull()
  })

  it('drops a rate yt-dlp has not measured yet', () => {
    expect(
      jobTransferLine(videoJob({ downloadedBytes: 412 * MB, fileIndex: 1 })),
    ).toBe('412 MB')
  })
})

describe('jobHandoff', () => {
  it('calls a download with nothing left to download finishing', () => {
    expect(jobHandoff(DownloadJobStatus.Downloading, 100)).toBe('finishing')
  })

  it('leaves a download short of 100% transferring', () => {
    expect(jobHandoff(DownloadJobStatus.Downloading, 99.99)).toBeNull()
    expect(jobHandoff(DownloadJobStatus.Downloading, null)).toBeNull()
  })

  it('calls an import importing, whatever its percentage', () => {
    expect(jobHandoff(DownloadJobStatus.Importing, 100)).toBe('importing')
    expect(jobHandoff(DownloadJobStatus.Importing, undefined)).toBe('importing')
  })

  it('calls a video past its transfer processing, whatever its percentage', () => {
    for (const status of [
      DownloadJobStatus.Converting,
      DownloadJobStatus.Uploading,
      DownloadJobStatus.Cleaning,
    ]) {
      expect(jobHandoff(status, 100)).toBe('processing')
      expect(jobHandoff(status, undefined)).toBe('processing')
    }
  })

  it('leaves a full bar that is stopped alone', () => {
    // A stuck import and a paused client are not moving - settling them would
    // promise progress that is not coming.
    expect(jobHandoff(DownloadJobStatus.NeedsAttention, 100)).toBeNull()
    expect(jobHandoff(DownloadJobStatus.Paused, 100)).toBeNull()
  })
})

describe('handoffDetail', () => {
  it('names the importer for the media type', () => {
    expect(handoffDetail('finishing', DownloadType.Movie)).toBe(
      'All downloaded. Radarr imports it next.',
    )
    expect(handoffDetail('importing', DownloadType.Show)).toBe(
      'Sonarr is moving it into the library.',
    )
  })

  it('has nothing to say for a video, which never draws a bar', () => {
    expect(handoffDetail('finishing', DownloadType.Video)).toBeNull()
  })

  it('leaves processing to the chip, which already names the step', () => {
    expect(handoffDetail('processing', DownloadType.Video)).toBeNull()
    expect(handoffDetail('processing', DownloadType.Movie)).toBeNull()
  })
})
