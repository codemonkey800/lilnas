import '@testing-library/jest-dom'

import type {
  DownloadJob,
  Video,
  VideoProgress,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { VideoDetailProps } from 'src/components/detail/video-detail'
import {
  isUnrecognizedLink,
  sourcePostHref,
  VIDEO_EMPTY_NOTE,
  VIDEO_SOURCE_LABEL,
  VIDEO_STALE_LABEL,
  VIDEO_UNRECOGNIZED_EXPLAIN,
  VIDEO_UNRECOGNIZED_GUIDANCE,
  VideoDetail,
  videoMetaLabel,
  videoPlayerSrc,
  videoSourceJob,
} from 'src/components/detail/video-detail'
import { VIDEO_DOWNLOAD_LABEL } from 'src/components/detail/video-detail-download'
import type { VideoDetailLiveProps } from 'src/components/detail/video-detail-live'
import { VideoDetailLive } from 'src/components/detail/video-detail-live'
import { VIDEO_PLAYER_LABEL } from 'src/components/detail/video-player'
import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildJobFrame,
  buildMediaFrame,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'
import { UNKNOWN_VALUE } from 'src/lib/format'

const MEDIA_ID = 'video:V1StGXR8_Z5'
const SOURCE_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
const OBJECT_URL = 'https://storage.lilnas.io/videos/V1StGXR8_Z5/part-0.mp4'
const FILE_HREF = `/api/download/media/${encodeURIComponent(MEDIA_ID)}/file`

/** 2026-09-15T12:00:00Z, the instant every relative stamp below is read at. */
const NOW = Date.parse('2026-09-15T12:00:00.000Z')

/**
 * The video as the server serves it. `downloading` by default, matching
 * `job()`'s default status, so the plain render is one coherent page.
 */
function video(overrides: Partial<Video> = {}): Video {
  return {
    id: MEDIA_ID,
    runtime: 842,
    sourceUrl: SOURCE_URL,
    state: 'downloading',
    title: 'Sourdough starter, day one to seven',
    type: DownloadType.Video,
    ...overrides,
  }
}

/** A downloaded video — `available`, with the object that makes it so. */
function downloaded(overrides: Partial<Video> = {}): Video {
  return video({ downloadUrls: [OBJECT_URL], state: 'available', ...overrides })
}

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:48:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job_1',
    linkedDiscord: null,
    media: video(),
    requester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_jeremy' },
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:59:00.000Z',
    ...overrides,
  }
}

const MB = 1024 * 1024

/** yt-dlp's tick as the wire carries it: 64% of a 640 MB merge at 3.1 MB/s. */
function tick(overrides: Partial<VideoProgress> = {}): VideoProgress {
  return {
    downloadedBytes: 412 * MB,
    etaSeconds: 125,
    fileCount: 2,
    fileIndex: 1,
    percent: 64,
    speedBps: 3.25e6,
    totalBytes: 640 * MB,
    ...overrides,
  }
}

function completedJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return job({
    completedAt: '2026-09-15T11:59:00.000Z',
    status: DownloadJobStatus.Completed,
    ...overrides,
  })
}

function renderDetail(overrides: Partial<VideoDetailProps> = {}) {
  const props: VideoDetailProps = {
    jobs: [job()],
    media: video(),
    now: NOW,
    ...overrides,
  }

  return render(<VideoDetail {...props} />)
}

/**
 * `MediaStatus`'s root — the media-state chip and its note. Scoped because an
 * attempt card can carry the same word (`downloading`, `paused`) for its own
 * job status, and a test about the chip must not pass on the attempt's.
 */
function mediaPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('div[data-state]')
  if (!panel) throw new Error('Expected the media status panel to render')
  return panel
}

function attempts(): HTMLElement {
  return screen.getByRole('region', { name: 'Attempts' })
}

function downloadButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: VIDEO_DOWNLOAD_LABEL })
}

describe('isUnrecognizedLink', () => {
  it('matches yt-dlp’s own refusal on a failed job', () => {
    expect(
      isUnrecognizedLink(
        job({
          error: 'ERROR: Unsupported URL: https://example.com/not-a-video',
          status: DownloadJobStatus.Failed,
        }),
      ),
    ).toBe(true)
  })

  it('matches the "is not a valid URL" refusal too', () => {
    expect(
      isUnrecognizedLink(
        job({
          error: 'ERROR: "wat" is not a valid URL. Set --default-search',
          status: DownloadJobStatus.Failed,
        }),
      ),
    ).toBe(true)
  })

  // The distinction the whole state exists for: a transport failure is worth
  // retrying and an unsupported site is not.
  it('leaves an ordinary failure alone', () => {
    expect(
      isUnrecognizedLink(
        job({ error: 'ETIMEDOUT', status: DownloadJobStatus.Failed }),
      ),
    ).toBe(false)
  })

  it('is never true for a job that has not failed', () => {
    expect(
      isUnrecognizedLink(
        job({
          error: 'ERROR: Unsupported URL: https://example.com',
          status: DownloadJobStatus.Cancelled,
        }),
      ),
    ).toBe(false)
  })

  it('is false when a failed job carries no message at all', () => {
    expect(isUnrecognizedLink(job({ status: DownloadJobStatus.Failed }))).toBe(
      false,
    )
  })
})

describe('sourcePostHref', () => {
  it('passes an http(s) URL through', () => {
    expect(sourcePostHref(SOURCE_URL)).toBe(SOURCE_URL)
  })

  // `MediaResolverService` emits a degraded placeholder carrying exactly this.
  it('rejects the degraded placeholder’s empty source', () => {
    expect(sourcePostHref('')).toBeNull()
  })

  it('rejects a value that is not a URL at all', () => {
    expect(sourcePostHref('not a url')).toBeNull()
  })

  // The security half: `Video.sourceUrl` is deliberately unvalidated on the
  // read model, so this is the only thing between a stored string and an href.
  it('rejects a javascript: payload', () => {
    expect(sourcePostHref('javascript:alert(1)')).toBeNull()
  })

  it('rejects a data: payload', () => {
    expect(
      sourcePostHref('data:text/html,<script>alert(1)</script>'),
    ).toBeNull()
  })
})

describe('videoMetaLabel', () => {
  it('reads host then duration, with the www dropped', () => {
    expect(videoMetaLabel(video())).toBe('youtube.com · 14:02')
  })

  // `videos.runtime` is a column nothing currently writes, so this is the
  // common case rather than an edge one.
  it('drops the duration rather than dashing it when it is unknown', () => {
    expect(videoMetaLabel(video({ runtime: undefined }))).toBe('youtube.com')
  })

  it('drops the host when the source is unusable', () => {
    expect(videoMetaLabel(video({ sourceUrl: '' }))).toBe('14:02')
  })

  it('falls back to the em dash when nothing is known', () => {
    expect(videoMetaLabel(video({ runtime: undefined, sourceUrl: '' }))).toBe(
      UNKNOWN_VALUE,
    )
  })
})

describe('videoPlayerSrc', () => {
  it('prefers the object this job produced', () => {
    expect(videoPlayerSrc(video({ downloadUrls: [OBJECT_URL] }))).toBe(
      OBJECT_URL,
    )
  })

  it('falls back to the media-file endpoint', () => {
    expect(videoPlayerSrc(video())).toBe(
      `/api/download/media/${encodeURIComponent(MEDIA_ID)}/file`,
    )
  })
})

describe('videoSourceJob', () => {
  const failedLater = job({
    createdAt: '2026-09-15T11:55:00.000Z',
    id: 'job_3',
    status: DownloadJobStatus.Failed,
  })
  const produced = completedJob({ id: 'job_2' })

  // A later failure over a playable video says nothing about who put the
  // file there.
  it('is the newest completed attempt once the video is downloaded', () => {
    expect(videoSourceJob([failedLater, produced], true)?.id).toBe('job_2')
  })

  it('is the newest attempt while there is no file', () => {
    expect(videoSourceJob([failedLater, produced], false)?.id).toBe('job_3')
  })

  it('falls back to the newest attempt when none completed', () => {
    expect(videoSourceJob([failedLater], true)?.id).toBe('job_3')
  })

  it('is null for a video nobody has fetched', () => {
    expect(videoSourceJob([], false)).toBeNull()
  })
})

describe('VideoDetail', () => {
  it('links back to the original post, in a new tab with no referrer', () => {
    renderDetail()

    const link = screen.getByRole('link', { name: VIDEO_SOURCE_LABEL })

    expect(link).toHaveAttribute('href', SOURCE_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('draws no source link at all for an unusable source URL', () => {
    renderDetail({ media: video({ sourceUrl: 'javascript:alert(1)' }) })

    expect(
      screen.queryByRole('link', { name: VIDEO_SOURCE_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('renders the title the backend guarantees, never the source URL', () => {
    renderDetail()

    expect(
      screen.getByText('Sourdough starter, day one to seven'),
    ).toBeInTheDocument()
    expect(screen.getByText('youtube.com · 14:02')).toBeInTheDocument()
  })

  /**
   * ⚠️ The motivating bug, video-shaped. The newest job completed, and the
   * file was deleted afterwards — `downloadUrls: []`, state `absent`. The
   * page used to read `completed` off the job and draw a player with nothing
   * to play; the chip now reads the video.
   */
  describe('a completed attempt whose file was later deleted', () => {
    const deleted = video({ downloadUrls: [], state: 'absent' })

    it('reads "not downloaded", not "completed"', () => {
      renderDetail({ jobs: [completedJob()], media: deleted })

      expect(mediaPanel()).toHaveAttribute('data-state', 'absent')
      expect(within(mediaPanel()).getByText('not downloaded')).toBeVisible()
      expect(
        within(mediaPanel()).queryByText('completed'),
      ).not.toBeInTheDocument()
    })

    // The attempt itself did complete, and the history says so honestly.
    it('still lists the attempt as completed', () => {
      renderDetail({ jobs: [completedJob()], media: deleted })

      expect(within(attempts()).getByText('completed')).toBeInTheDocument()
    })

    it('shows no player, no Save and no Delete', () => {
      const { container } = renderDetail({
        jobs: [completedJob()],
        media: deleted,
        onDelete: jest.fn(),
      })

      expect(container.querySelector('video')).toBeNull()
      expect(
        screen.queryByRole('link', { name: 'Save to device' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Delete' }),
      ).not.toBeInTheDocument()
    })

    // What the page's own Delete leaves behind: the attempt stays
    // `completed` (it did download the file), so no attempt row offers
    // anything — the page's Download is the way back.
    it('offers Download, and it asks again through the newest attempt', async () => {
      const onRetry = jest.fn()
      renderDetail({
        jobs: [
          completedJob({ id: 'job_2' }),
          completedJob({ createdAt: '2026-09-14T12:00:00.000Z', id: 'job_1' }),
        ],
        media: deleted,
        onRetry,
      })

      await userEvent.click(
        screen.getByRole('button', { name: VIDEO_DOWNLOAD_LABEL }),
      )

      expect(onRetry).toHaveBeenCalledTimes(1)
      expect(onRetry).toHaveBeenCalledWith('job_2')
    })

    // One verb, one button: the attempt rows never draw a Retry beside it.
    it('offers no Retry off the completed attempt itself', () => {
      renderDetail({
        jobs: [completedJob()],
        media: deleted,
        onRetry: jest.fn(),
      })

      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument()
    })

    it('draws no Download when the page wired no action for it', () => {
      renderDetail({ jobs: [completedJob()], media: deleted })

      expect(downloadButton()).not.toBeInTheDocument()
    })

    // `wanted` is also "no file and nothing moving" — the movie page's rule.
    it('offers Download for a wanted video too', () => {
      renderDetail({
        jobs: [completedJob()],
        media: video({ downloadUrls: [], state: 'wanted' }),
        onRetry: jest.fn(),
      })

      expect(downloadButton()).toBeInTheDocument()
    })
  })

  describe('downloaded', () => {
    const jobs = [completedJob()]

    it('offers no Download — the file is already here', () => {
      renderDetail({ jobs, media: downloaded(), onRetry: jest.fn() })

      expect(downloadButton()).not.toBeInTheDocument()
    })

    it('reads "downloaded"', () => {
      renderDetail({ jobs, media: downloaded() })

      expect(within(mediaPanel()).getByText('downloaded')).toBeInTheDocument()
      expect(mediaPanel().querySelector('.dot-live')).toBeNull()
    })

    it('plays in app, from the object the download produced', () => {
      const { container } = renderDetail({ jobs, media: downloaded() })

      expect(
        screen.getByRole('region', {
          name: `${downloaded().title} — ${VIDEO_PLAYER_LABEL}`,
        }),
      ).toBeInTheDocument()
      expect(container.querySelector('video')).toHaveAttribute(
        'src',
        OBJECT_URL,
      )
    })

    it('names the player region generically when the title is missing', () => {
      renderDetail({ jobs, media: downloaded({ title: '' }) })

      expect(
        screen.getByRole('region', { name: VIDEO_PLAYER_LABEL }),
      ).toBeInTheDocument()
    })

    // Media state, not job status: a playable video with no job on the page
    // at all (a degraded payload) is still playable.
    it('plays even when no attempt is on the page', () => {
      const { container } = renderDetail({ jobs: [], media: downloaded() })

      expect(container.querySelector('video')).not.toBeNull()
    })

    it('offers Save to device as a real link to the media-file route', () => {
      renderDetail({ jobs, media: downloaded() })

      expect(
        screen.getByRole('link', { name: 'Save to device' }),
      ).toHaveAttribute('href', FILE_HREF)
    })

    it('offers no Watch — the player is on this page, not in Emby', () => {
      renderDetail({ jobs, media: downloaded() })

      expect(
        screen.queryByRole('link', { name: 'Watch' }),
      ).not.toBeInTheDocument()
    })

    it('lists the attempt that produced it', () => {
      renderDetail({ jobs, media: downloaded() })

      expect(within(attempts()).getByText('completed')).toBeInTheDocument()
    })

    describe('Delete', () => {
      it('sits in one row with Save to device, Save first', () => {
        renderDetail({ jobs, media: downloaded(), onDelete: jest.fn() })

        // `video-detail.pug`'s completed frame — the two controls, in that
        // order, in one `ActionRow`. `DeleteConfirm` renders its own `<div>`
        // root, so the row is `Save to device`'s parent.
        const row = screen.getByRole('link', {
          name: 'Save to device',
        }).parentElement

        expect(row).not.toBeNull()
        expect(
          Array.from(row?.querySelectorAll('button, a') ?? []).map(
            element => element.textContent,
          ),
        ).toEqual(['Save to device', 'Delete'])
      })

      it('raises no dialog until it is pressed', () => {
        renderDetail({ jobs, media: downloaded(), onDelete: jest.fn() })

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      it('names the video and says the link survives', async () => {
        renderDetail({ jobs, media: downloaded(), onDelete: jest.fn() })

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

        const dialog = screen.getByRole('dialog')

        expect(dialog).toHaveAccessibleName(`Delete "${downloaded().title}"?`)
        // ⚠️ The copy is the `video` scope's own. A video's file was never in
        // the media library and no arr ever knew about it.
        expect(dialog).toHaveAccessibleDescription(
          expect.stringContaining("this video's downloaded file"),
        )
        expect(dialog).toHaveAccessibleDescription(
          expect.not.stringMatching(/library|radarr/i),
        )
      })

      // ⚠️ A job id, not `video:V1StGXR8_Z5` — `deleteVideoJob` is
      // `DELETE /download/videos/:jobId` — and the attempt that produced the
      // file, not a later one that failed over it.
      it('deletes through the attempt that produced the file', async () => {
        const onDelete = jest.fn().mockResolvedValue({ job: { id: 'job_42' } })
        renderDetail({
          jobs: [
            job({
              createdAt: '2026-09-15T11:55:00.000Z',
              id: 'job_43',
              status: DownloadJobStatus.Failed,
            }),
            completedJob({ id: 'job_42' }),
          ],
          media: downloaded(),
          onDelete,
        })

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
        await userEvent.click(
          screen.getByRole('button', { name: 'Delete', hidden: false }),
        )

        expect(onDelete).toHaveBeenCalledWith('job_42')
      })

      it('is not offered when the page wired no delete action', () => {
        renderDetail({ jobs, media: downloaded() })

        expect(
          screen.getByRole('link', { name: 'Save to device' }),
        ).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Delete' }),
        ).not.toBeInTheDocument()
      })
    })
  })

  describe('downloading', () => {
    it('reads "downloading" with the live dot', () => {
      renderDetail()

      expect(within(mediaPanel()).getByText('downloading')).toBeInTheDocument()
      expect(mediaPanel().querySelector('.dot-live')).not.toBeNull()
    })

    it('draws the in-flight attempt as a card with Pause and Cancel', () => {
      renderDetail({ onCancel: jest.fn(), onPause: jest.fn() })

      const card = attempts().querySelector<HTMLElement>(
        '[data-job-id="job_1"]',
      )

      expect(card).toHaveAttribute('data-status', DownloadJobStatus.Downloading)
      expect(
        within(card as HTMLElement).getByRole('button', { name: 'Pause' }),
      ).toBeInTheDocument()
      expect(
        within(card as HTMLElement).getByRole('button', { name: 'Cancel' }),
      ).toBeInTheDocument()
    })

    it('offers no Retry or Download while an attempt is running', () => {
      renderDetail({ onRetry: jest.fn() })

      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument()
      expect(downloadButton()).not.toBeInTheDocument()
    })

    // A press beside a live attempt would race it — even when the media
    // frame saying so has not arrived yet and the chip still reads the old
    // state.
    it('offers no Download while an attempt is open over a deleted file', () => {
      renderDetail({
        jobs: [
          job({ id: 'job_2', status: DownloadJobStatus.Pending }),
          completedJob({ createdAt: '2026-09-14T12:00:00.000Z', id: 'job_1' }),
        ],
        media: video({ downloadUrls: [], state: 'absent' }),
        onRetry: jest.fn(),
      })

      expect(downloadButton()).not.toBeInTheDocument()
    })

    it('pauses and cancels by job id, never the video id', async () => {
      const onCancel = jest.fn()
      const onPause = jest.fn()
      renderDetail({ jobs: [job({ id: 'job_99' })], onCancel, onPause })

      await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onPause).toHaveBeenCalledWith('job_99')
      expect(onCancel).toHaveBeenCalledWith('job_99')
    })

    // Before yt-dlp's first tick there is nothing to prove — a 0% bar would
    // be a claim.
    it('draws no progress bar when the attempt carries no progress', () => {
      renderDetail()

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      expect(screen.queryByText(/MB\/s/)).not.toBeInTheDocument()
    })

    // `video-detail.pug`'s `fragment 4 of 9` over a 64% bar, drawn on the
    // attempt card rather than beside the media chip.
    it('draws the attempt’s progress when the wire carries it', () => {
      renderDetail({ jobs: [job({ progress: tick() })] })

      const bar = within(attempts()).getByRole('progressbar', {
        name: 'Download progress',
      })

      expect(bar).toHaveAttribute('aria-valuenow', '64')
      expect(within(attempts()).getByText(/MB\/s/)).toBeInTheDocument()
      expect(
        within(mediaPanel()).queryByRole('progressbar'),
      ).not.toBeInTheDocument()
    })

    // A re-download over a file that is still there: the media is
    // `downloading`, so the stop control is the attempt's Cancel, not Delete.
    it('shows no player, Save or Delete even with an old file behind it', () => {
      const { container } = renderDetail({
        media: video({ downloadUrls: [OBJECT_URL] }),
        onCancel: jest.fn(),
        onDelete: jest.fn(),
      })

      expect(container.querySelector('video')).toBeNull()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'Save to device' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Delete' }),
      ).not.toBeInTheDocument()
    })
  })

  it('reads "processing…" while yt-dlp converts, uploads or cleans up', () => {
    renderDetail({
      jobs: [job({ status: DownloadJobStatus.Converting })],
      media: video({ state: 'importing' }),
    })

    expect(within(mediaPanel()).getByText('processing…')).toBeInTheDocument()
    expect(mediaPanel().querySelector('.dot-live')).not.toBeNull()
    expect(within(attempts()).getByText('converting')).toBeInTheDocument()
  })

  describe('paused', () => {
    const props = {
      jobs: [job({ id: 'job_7', status: DownloadJobStatus.Paused })],
      media: video({ state: 'paused' }),
    }

    it('reads "paused", with no live dot', () => {
      renderDetail(props)

      expect(within(mediaPanel()).getByText('paused')).toBeInTheDocument()
      expect(mediaPanel().querySelector('.dot-live')).toBeNull()
    })

    it('offers Resume on the attempt, by job id', async () => {
      const onResume = jest.fn()
      renderDetail({ ...props, onResume })

      await userEvent.click(
        within(attempts()).getByRole('button', { name: 'Resume' }),
      )

      expect(onResume).toHaveBeenCalledWith('job_7')
    })
  })

  describe('a failed newest attempt', () => {
    const failed = job({
      error: 'ETIMEDOUT',
      id: 'job_5',
      status: DownloadJobStatus.Failed,
    })

    // The same Download a deleted video gets — never a Retry on the row as
    // well, which would be two buttons for one request.
    it('offers Download over a video with no file, by job id', async () => {
      const onRetry = jest.fn()
      renderDetail({
        jobs: [failed],
        media: video({ state: 'absent' }),
        onRetry,
      })

      expect(within(mediaPanel()).getByText('not downloaded')).toBeVisible()
      expect(within(attempts()).getByText('failed')).toBeInTheDocument()
      expect(within(attempts()).getByText('ETIMEDOUT')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument()

      await userEvent.click(
        screen.getByRole('button', { name: VIDEO_DOWNLOAD_LABEL }),
      )

      expect(onRetry).toHaveBeenCalledWith('job_5')
    })

    it('offers Download after a cancelled attempt too', () => {
      renderDetail({
        jobs: [job({ id: 'job_6', status: DownloadJobStatus.Cancelled })],
        media: video({ state: 'absent' }),
        onRetry: jest.fn(),
      })

      expect(downloadButton()).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument()
    })

    // *Cars*, for a video: the file is still here, so asking again would
    // re-fetch what is already on disk. The chip says so, and nothing is
    // offered.
    it('offers no Retry or Download over a downloaded video', () => {
      const { container } = renderDetail({
        jobs: [failed, completedJob()],
        media: downloaded(),
        onRetry: jest.fn(),
      })

      expect(within(mediaPanel()).getByText('downloaded')).toBeInTheDocument()
      expect(container.querySelector('video')).not.toBeNull()
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument()
      expect(downloadButton()).not.toBeInTheDocument()
    })

    it('attributes a downloaded video to the attempt that produced it', () => {
      renderDetail({
        jobs: [
          job({
            ...failed,
            createdAt: '2026-09-15T11:58:00.000Z',
            requester: null,
          }),
          completedJob(),
        ],
        media: downloaded(),
      })

      expect(
        screen.getByText('downloaded by jeremy.asuncion · 12m ago'),
      ).toBeInTheDocument()
    })
  })

  describe('the link yt-dlp did not recognise', () => {
    const unrecognized = [
      job({
        error: 'ERROR: Unsupported URL: https://example.com/not-a-video',
        status: DownloadJobStatus.Failed,
      }),
    ]
    const absent = video({ state: 'absent' })

    it('explains what happened and points at the nav bar', () => {
      renderDetail({ jobs: unrecognized, media: absent })

      expect(
        within(mediaPanel()).getByText(VIDEO_UNRECOGNIZED_EXPLAIN),
      ).toBeInTheDocument()
      expect(screen.getByText(VIDEO_UNRECOGNIZED_GUIDANCE)).toBeInTheDocument()
      expect(
        within(attempts()).getByText(
          'ERROR: Unsupported URL: https://example.com/not-a-video',
        ),
      ).toBeInTheDocument()
    })

    // The point of the state: asking again would fail identically, so the
    // control is withheld rather than rendered and disabled.
    it('offers no Retry or Download', () => {
      renderDetail({ jobs: unrecognized, media: absent, onRetry: jest.fn() })

      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument()
      expect(downloadButton()).not.toBeInTheDocument()
    })

    it('leaves an ordinary failure to the attempt row', () => {
      renderDetail({
        jobs: [job({ error: 'ETIMEDOUT', status: DownloadJobStatus.Failed })],
        media: absent,
      })

      expect(
        screen.queryByText(VIDEO_UNRECOGNIZED_GUIDANCE),
      ).not.toBeInTheDocument()
    })
  })

  it('attributes the download to the requester the server let through', () => {
    renderDetail()

    expect(
      screen.getByText('downloaded by jeremy.asuncion · 12m ago'),
    ).toBeInTheDocument()
  })

  // Masking is applied server-side; `null` means "not allowed this identity".
  it('renders a masked requester as hidden rather than re-deriving the rule', () => {
    renderDetail({ jobs: [job({ requester: null })] })

    expect(
      screen.getByText('downloaded by hidden · 12m ago'),
    ).toBeInTheDocument()
  })

  it('lists earlier attempts under the in-flight one', () => {
    renderDetail({
      jobs: [
        job({ id: 'job_2' }),
        job({
          createdAt: '2026-09-14T12:00:00.000Z',
          error: 'ETIMEDOUT',
          id: 'job_1',
          status: DownloadJobStatus.Failed,
        }),
      ],
    })

    const list = attempts()

    expect(
      Array.from(list.querySelectorAll('[data-job-id]')).map(el =>
        el.getAttribute('data-job-id'),
      ),
    ).toEqual(['job_2', 'job_1'])
    expect(within(list).getByText('failed')).toBeInTheDocument()
  })

  it('renders only the chip when nothing has ever been fetched', () => {
    renderDetail({
      jobs: [],
      media: video({ state: 'absent' }),
      onRetry: jest.fn(),
    })

    expect(within(mediaPanel()).getByText('not downloaded')).toBeVisible()
    expect(within(mediaPanel()).getByText(VIDEO_EMPTY_NOTE)).toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'Attempts' }),
    ).not.toBeInTheDocument()
    // No attempt to name the source by, so nothing to ask again through.
    expect(downloadButton()).not.toBeInTheDocument()
  })

  // A video with no `state` on the wire reads through `mediaState()`.
  it('reads a missing state as not downloaded', () => {
    renderDetail({ jobs: [], media: video({ state: undefined }) })

    expect(mediaPanel()).toHaveAttribute('data-state', 'absent')
  })

  it('keeps the media chip intrinsic rather than stretching it', () => {
    renderDetail()

    const chip = within(mediaPanel()).getByText('downloading').closest('span')

    expect(chip?.getAttribute('class')).toContain('w-fit')
  })

  /**
   * ⚠️ `connected` means strictly "a socket is OPEN right now" — false through
   * the first connect and every backoff window — so `stale` alone is not
   * enough to warn anybody. The marker is about *missing an update*, which is
   * only possible while there is an update to miss.
   */
  describe('the stale marker', () => {
    it('warns while a download’s feed is disconnected', () => {
      renderDetail({ stale: true })

      expect(screen.getByText(VIDEO_STALE_LABEL)).toBeInTheDocument()
    })

    it('says nothing while the feed is connected', () => {
      renderDetail()

      expect(screen.queryByText(VIDEO_STALE_LABEL)).not.toBeInTheDocument()
    })

    // A downloaded page is final. Raising a doubt about a panel that cannot
    // change is telling the reader something untrue.
    it('says nothing about a video that is done', () => {
      renderDetail({
        jobs: [completedJob()],
        media: downloaded(),
        stale: true,
      })

      expect(screen.queryByText(VIDEO_STALE_LABEL)).not.toBeInTheDocument()
    })

    it('says nothing when nothing was ever downloaded', () => {
      renderDetail({
        jobs: [],
        media: video({ state: 'absent' }),
        stale: true,
      })

      expect(screen.queryByText(VIDEO_STALE_LABEL)).not.toBeInTheDocument()
    })

    // Paused is still open work whose resume this tab would otherwise fail
    // to hear about.
    it('warns for a paused video too', () => {
      renderDetail({
        jobs: [job({ status: DownloadJobStatus.Paused })],
        media: video({ state: 'paused' }),
        stale: true,
      })

      expect(screen.getByText(VIDEO_STALE_LABEL)).toBeInTheDocument()
    })

    // An attempt the media has not caught up with yet is still something to
    // hear about.
    it('warns for an open attempt the media has not reflected yet', () => {
      renderDetail({
        jobs: [job({ status: DownloadJobStatus.Pending })],
        media: video({ state: 'absent' }),
        stale: true,
      })

      expect(screen.getByText(VIDEO_STALE_LABEL)).toBeInTheDocument()
    })

    it('renders intrinsic rather than spanning the status column', () => {
      renderDetail({ stale: true })

      expect(
        screen.getByText(VIDEO_STALE_LABEL).getAttribute('class'),
      ).toContain('w-fit')
    })
  })
})

/**
 * The live half of `/videos/<videoId>`: the same body, re-rendered off the
 * gateway rather than off a reload.
 *
 * Every test here drives a fake socket — jsdom has no usable `WebSocket`, and
 * driving the real one would make these tests about the network. `emitOpen`
 * and `emitMessage` are exactly what the browser calls.
 */
describe('VideoDetailLive', () => {
  function renderLive(overrides: Partial<VideoDetailLiveProps> = {}) {
    const recorder = createSocketRecorder()
    const props: VideoDetailLiveProps = {
      jobs: [job()],
      media: video(),
      now: NOW,
      ...overrides,
    }

    const view = render(
      <JobEventsProvider
        createSocket={recorder.createSocket}
        getLocation={() => TEST_LOCATION}
        random={NO_JITTER}
      >
        <VideoDetailLive {...props} />
      </JobEventsProvider>,
    )

    act(() => recorder.latest().emitOpen())

    return { ...view, props, recorder }
  }

  function emitJob(
    recorder: ReturnType<typeof createSocketRecorder>,
    next: DownloadJob,
  ): void {
    act(() => recorder.latest().emitMessage(buildJobFrame(next)))
  }

  function emitMedia(
    recorder: ReturnType<typeof createSocketRecorder>,
    next: Video,
  ): void {
    act(() => recorder.latest().emitMessage(buildMediaFrame(next)))
  }

  it('renders the server’s video and attempts before any frame arrives', () => {
    renderLive()

    expect(within(mediaPanel()).getByText('downloading')).toBeInTheDocument()
    expect(
      attempts().querySelector('[data-job-id="job_1"]'),
    ).toBeInTheDocument()
  })

  /**
   * The structural requirement, pinned. `useJobEvents` throws without a
   * provider by design — the provider owns the socket, so a silent fallback
   * would let every call site quietly open another connection.
   */
  it('refuses to render outside a <JobEventsProvider>', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      render(<VideoDetailLive jobs={[job()]} media={video()} now={NOW} />),
    ).toThrow(/JobEventsProvider/)
  })

  it('flips the chip when a media frame says the video moved', () => {
    const { recorder } = renderLive()

    emitMedia(recorder, video({ state: 'importing' }))

    expect(within(mediaPanel()).getByText('processing…')).toBeInTheDocument()
  })

  // The whole point: the page follows the media frame that lands with the
  // job event — no reload, no server re-render.
  it('swaps the poster for the player once the video is downloaded', () => {
    const { container, recorder } = renderLive()

    expect(container.querySelector('video')).toBeNull()

    emitJob(recorder, completedJob())
    emitMedia(recorder, downloaded())

    expect(within(mediaPanel()).getByText('downloaded')).toBeInTheDocument()
    expect(container.querySelector('video')).toHaveAttribute('src', OBJECT_URL)
  })

  // A job frame alone never decides the chip — the media frame does.
  it('keeps the chip on the media while only a job frame has landed', () => {
    const { container, recorder } = renderLive()

    emitJob(recorder, completedJob())

    expect(within(mediaPanel()).getByText('downloading')).toBeInTheDocument()
    expect(within(attempts()).getByText('completed')).toBeInTheDocument()
    expect(container.querySelector('video')).toBeNull()
  })

  it('ignores a media frame for another video', () => {
    const { recorder } = renderLive()

    emitMedia(recorder, video({ id: 'video:other', state: 'available' }))

    expect(within(mediaPanel()).getByText('downloading')).toBeInTheDocument()
  })

  /**
   * Subscribed by media id, so a re-paste of the same link from Discord or
   * another tab — a job this page was never rendered with — shows up live.
   */
  it('adds an attempt at this video that the server did not render', () => {
    const { recorder } = renderLive({
      jobs: [
        job({
          error: 'ETIMEDOUT',
          status: DownloadJobStatus.Failed,
        }),
      ],
      media: video({ state: 'absent' }),
      onPause: jest.fn(),
    })

    emitJob(
      recorder,
      job({ createdAt: '2026-09-15T11:59:30.000Z', id: 'job_new' }),
    )

    const ids = Array.from(attempts().querySelectorAll('[data-job-id]')).map(
      el => el.getAttribute('data-job-id'),
    )

    expect(ids).toEqual(['job_new', 'job_1'])
    expect(
      within(attempts()).getByRole('button', { name: 'Pause' }),
    ).toBeInTheDocument()
  })

  it('ignores a job frame for another video', () => {
    const { recorder } = renderLive()

    emitJob(
      recorder,
      job({
        id: 'job_someone_else',
        media: video({ id: 'video:other' }),
        status: DownloadJobStatus.Completed,
      }),
    )

    expect(
      attempts().querySelector('[data-job-id="job_someone_else"]'),
    ).toBeNull()
  })

  // The attempt card's controls are a function of the live job status: Pause
  // is legal only while `downloading`.
  it('withdraws Pause once the attempt is no longer downloading', () => {
    const { recorder } = renderLive({ onCancel: jest.fn(), onPause: jest.fn() })

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()

    emitJob(recorder, job({ status: DownloadJobStatus.Converting }))

    expect(
      screen.queryByRole('button', { name: 'Pause' }),
    ).not.toBeInTheDocument()
  })

  // yt-dlp's ticks ride the `download-job` frame — the bar moves off the
  // socket alone, with no server re-render in between.
  it('moves the attempt’s bar as progress frames arrive', () => {
    const { recorder } = renderLive()

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    emitJob(recorder, job({ progress: tick({ percent: 12 }) }))

    const bar = within(attempts()).getByRole('progressbar', {
      name: 'Download progress',
    })
    expect(bar).toHaveAttribute('aria-valuenow', '12')

    emitJob(recorder, job({ progress: tick() }))

    expect(bar).toHaveAttribute('aria-valuenow', '64')
    expect(within(attempts()).getByText('64%')).toBeInTheDocument()
    expect(
      within(attempts()).getByText('412 MB / 640 MB · 3.1 MB/s · ~2m left'),
    ).toBeInTheDocument()
  })

  it('opens exactly one socket no matter how many frames arrive', () => {
    const { recorder } = renderLive()

    emitJob(recorder, job({ status: DownloadJobStatus.Converting }))
    emitMedia(recorder, video({ state: 'importing' }))
    emitJob(recorder, job({ status: DownloadJobStatus.Uploading }))

    expect(recorder.sockets).toHaveLength(1)
  })

  describe('when the feed drops', () => {
    it('shows reconnecting', () => {
      const { recorder } = renderLive()

      expect(screen.queryByText(VIDEO_STALE_LABEL)).not.toBeInTheDocument()

      act(() => recorder.latest().emitClose())

      expect(screen.getByText(VIDEO_STALE_LABEL)).toBeInTheDocument()
    })

    // The state is a server fact that does not stop being true because this
    // tab stopped hearing about it — one marker, not a blanked-out panel.
    it('keeps showing the last state it heard', () => {
      const { recorder } = renderLive()

      emitMedia(recorder, video({ state: 'importing' }))
      act(() => recorder.latest().emitClose())

      expect(within(mediaPanel()).getByText('processing…')).toBeInTheDocument()
    })

    it('clears the marker once a socket is open again', () => {
      const { recorder } = renderLive()

      act(() => recorder.latest().emitClose())
      expect(screen.getByText(VIDEO_STALE_LABEL)).toBeInTheDocument()

      act(() => recorder.latest().emitOpen())

      expect(screen.queryByText(VIDEO_STALE_LABEL)).not.toBeInTheDocument()
    })
  })
})
