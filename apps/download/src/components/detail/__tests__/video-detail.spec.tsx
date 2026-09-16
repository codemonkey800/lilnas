import '@testing-library/jest-dom'

import type { DownloadJob, Video } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { VideoDetailProps } from 'src/components/detail/video-detail'
import {
  isUnrecognizedLink,
  sourcePostHref,
  VIDEO_EMPTY_NOTE,
  VIDEO_SOURCE_LABEL,
  VIDEO_UNRECOGNIZED_EXPLAIN,
  VIDEO_UNRECOGNIZED_GUIDANCE,
  VideoDetail,
  videoMetaLabel,
  videoPlayerSrc,
} from 'src/components/detail/video-detail'
import { VIDEO_PLAYER_LABEL } from 'src/components/detail/video-player'
import { UNKNOWN_VALUE } from 'src/lib/format'

const MEDIA_ID = 'video:V1StGXR8_Z5'
const SOURCE_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
const OBJECT_URL = 'https://storage.lilnas.io/videos/V1StGXR8_Z5/part-0.mp4'

/** 2026-09-15T12:00:00Z, the instant every relative stamp below is read at. */
const NOW = Date.parse('2026-09-15T12:00:00.000Z')

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: MEDIA_ID,
    runtime: 842,
    sourceUrl: SOURCE_URL,
    title: 'Sourdough starter, day one to seven',
    type: DownloadType.Video,
    ...overrides,
  }
}

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:48:00.000Z',
    hiddenAttribution: false,
    id: 'job_1',
    media: video(),
    requester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_jeremy' },
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:59:00.000Z',
    ...overrides,
  }
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
   * ⚠️ The headline reconciliation. `video-detail.pug` draws `fragment 4 of 9`
   * over a 64% bar with `412 MB / 640 MB · 3.1 MB/s` under it; a video job
   * carries no progress field anywhere on the wire, so `jobProgress()` answers
   * `null` and nothing is drawn. A 0% bar would be a claim.
   */
  it('draws no progress bar for a downloading video', () => {
    renderDetail()

    expect(screen.getByText('downloading')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/MB\/s/)).not.toBeInTheDocument()
  })

  it('offers Pause and Cancel while downloading, and no Retry', () => {
    renderDetail({
      onCancel: jest.fn(),
      onPause: jest.fn(),
      onRetry: jest.fn(),
    })

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument()
  })

  it('calls the cancel action with the job id, never the video id', async () => {
    const onCancel = jest.fn()
    renderDetail({ jobs: [job({ id: 'job_99' })], onCancel })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledWith('job_99')
  })

  describe('the link yt-dlp did not recognise', () => {
    const unrecognized = [
      job({
        error: 'ERROR: Unsupported URL: https://example.com/not-a-video',
        status: DownloadJobStatus.Failed,
      }),
    ]

    it('explains what happened and points at the nav bar', () => {
      renderDetail({ jobs: unrecognized })

      expect(screen.getByText(VIDEO_UNRECOGNIZED_EXPLAIN)).toBeInTheDocument()
      expect(screen.getByText(VIDEO_UNRECOGNIZED_GUIDANCE)).toBeInTheDocument()
      expect(
        screen.getByText(
          'ERROR: Unsupported URL: https://example.com/not-a-video',
        ),
      ).toBeInTheDocument()
    })

    // The point of the state: retrying would fail identically, so the control
    // is withheld rather than rendered and disabled.
    it('offers no Retry', () => {
      renderDetail({ jobs: unrecognized, onRetry: jest.fn() })

      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument()
    })

    it('still offers Retry for an ordinary failure', () => {
      renderDetail({
        jobs: [job({ error: 'ETIMEDOUT', status: DownloadJobStatus.Failed })],
        onRetry: jest.fn(),
      })

      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
      expect(screen.getByText('ETIMEDOUT')).toBeInTheDocument()
      expect(
        screen.queryByText(VIDEO_UNRECOGNIZED_GUIDANCE),
      ).not.toBeInTheDocument()
    })
  })

  describe('once the download has completed', () => {
    const completed = [
      job({
        completedAt: '2026-09-15T11:59:00.000Z',
        status: DownloadJobStatus.Completed,
      }),
    ]
    const withFile = video({ downloadUrls: [OBJECT_URL] })

    it('plays in app, from the object this job produced', () => {
      const { container } = renderDetail({ jobs: completed, media: withFile })

      expect(
        screen.getByRole('region', {
          name: `${withFile.title} — ${VIDEO_PLAYER_LABEL}`,
        }),
      ).toBeInTheDocument()
      expect(container.querySelector('video')).toHaveAttribute(
        'src',
        OBJECT_URL,
      )
    })

    it('names the player region generically when the title is missing', () => {
      renderDetail({
        jobs: completed,
        media: video({ downloadUrls: [OBJECT_URL], title: '' }),
      })

      expect(
        screen.getByRole('region', { name: VIDEO_PLAYER_LABEL }),
      ).toBeInTheDocument()
    })

    it('offers Save to device as a real link to the media-file route', () => {
      renderDetail({ jobs: completed, media: withFile })

      expect(
        screen.getByRole('link', { name: 'Save to device' }),
      ).toHaveAttribute(
        'href',
        `/api/download/media/${encodeURIComponent(MEDIA_ID)}/file`,
      )
    })

    // `canSaveLocal` is the guard: a completed job whose objects were deleted
    // has no file, and a link that 404s is worse than no link.
    it('withholds Save to device when there is no file', () => {
      renderDetail({ jobs: completed, media: video({ downloadUrls: [] }) })

      expect(
        screen.queryByRole('link', { name: 'Save to device' }),
      ).not.toBeInTheDocument()
    })

    it('offers no Watch — the player is on this page, not in Emby', () => {
      renderDetail({ jobs: completed, media: withFile })

      expect(
        screen.queryByRole('link', { name: 'Watch' }),
      ).not.toBeInTheDocument()
    })
  })

  it('shows no player while the video is still downloading', () => {
    const { container } = renderDetail({
      media: video({ downloadUrls: [OBJECT_URL] }),
    })

    expect(container.querySelector('video')).toBeNull()
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

  it('lists earlier attempts beneath the current one', () => {
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

    expect(screen.getByText('Earlier attempts')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  it('renders the empty panel when nothing has ever been fetched', () => {
    renderDetail({ jobs: [] })

    expect(screen.getByText('not downloaded')).toBeInTheDocument()
    expect(screen.getByText(VIDEO_EMPTY_NOTE)).toBeInTheDocument()
    expect(screen.queryByText('Earlier attempts')).not.toBeInTheDocument()
  })

  /**
   * The designs README lists the mockup's full-width `downloading` chip as an
   * unreconciled quirk — it stretches only because it is a flex child in a
   * stretch container. The port renders it intrinsic, which is `w-fit` on the
   * rendered class attribute rather than on the string handed to `cns()`.
   */
  it('keeps the status chip intrinsic rather than stretching it', () => {
    renderDetail()

    const chip = screen.getByText('downloading').closest('span')

    expect(chip?.getAttribute('class')).toContain('w-fit')
  })
})
