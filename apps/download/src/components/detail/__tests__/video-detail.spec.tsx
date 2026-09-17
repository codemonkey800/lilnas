import '@testing-library/jest-dom'

import type { DownloadJob, Video } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { VideoDetailProps } from 'src/components/detail/video-detail'
import {
  isUnrecognizedLink,
  mergeVideoJobs,
  sourcePostHref,
  VIDEO_EMPTY_NOTE,
  VIDEO_SOURCE_LABEL,
  VIDEO_STALE_LABEL,
  VIDEO_UNRECOGNIZED_EXPLAIN,
  VIDEO_UNRECOGNIZED_GUIDANCE,
  VideoDetail,
  videoMetaLabel,
  videoPlayerSrc,
} from 'src/components/detail/video-detail'
import type { VideoDetailLiveProps } from 'src/components/detail/video-detail-live'
import { VideoDetailLive } from 'src/components/detail/video-detail-live'
import { VIDEO_PLAYER_LABEL } from 'src/components/detail/video-player'
import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildJobFrame,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'
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

describe('mergeVideoJobs', () => {
  const current = job({ id: 'job_2' })
  const earlier = job({
    createdAt: '2026-09-14T12:00:00.000Z',
    id: 'job_1',
    status: DownloadJobStatus.Failed,
  })

  it('lets the live copy win for a job the page already knows', () => {
    const live = new Map([
      ['job_2', job({ id: 'job_2', status: DownloadJobStatus.Converting })],
    ])

    expect(mergeVideoJobs([current, earlier], live)).toEqual([
      job({ id: 'job_2', status: DownloadJobStatus.Converting }),
      earlier,
    ])
  })

  it('keeps the server’s newest-first order rather than re-deriving one', () => {
    const live = new Map([
      ['job_1', job({ ...earlier, status: DownloadJobStatus.Completed })],
    ])

    expect(mergeVideoJobs([current, earlier], live).map(j => j.id)).toEqual([
      'job_2',
      'job_1',
    ])
  })

  /**
   * The subscription only ever asks about the ids already on the page, so a
   * stray id in the map is a contract violation rather than a new attempt to
   * display — and this page has no idea where it would belong.
   */
  it('never inserts a job the page was not rendered with', () => {
    const live = new Map([['job_99', job({ id: 'job_99' })]])

    expect(mergeVideoJobs([current], live)).toEqual([current])
  })

  /**
   * The opposite of `/activity`, deliberately. `useJobEvents` upserts and
   * never evicts, and a video's permalink shows its attempts whatever their
   * status — a finished download must not vanish off its own page.
   */
  it('keeps a job that has gone terminal', () => {
    const done = job({ id: 'job_2', status: DownloadJobStatus.Completed })

    expect(mergeVideoJobs([current], new Map([['job_2', done]]))).toEqual([
      done,
    ])
  })

  it('is the server’s list untouched before any frame has landed', () => {
    expect(mergeVideoJobs([current, earlier], new Map())).toEqual([
      current,
      earlier,
    ])
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

    describe('Delete', () => {
      it('sits in the action row beside Save to device', () => {
        renderDetail({
          jobs: completed,
          media: withFile,
          onDelete: jest.fn(),
        })

        // `video-detail.pug:158-159` — the two controls, in that order, in one
        // row. The row is `JobLifecycle`'s own `ActionRow` and Delete reaches
        // it through `extraActions`, which is why `Save to device`'s parent is
        // the right element to look inside rather than the whole page.
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
        renderDetail({ jobs: completed, media: withFile, onDelete: jest.fn() })

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      it('names the video and says the link survives', async () => {
        renderDetail({ jobs: completed, media: withFile, onDelete: jest.fn() })

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

        const dialog = screen.getByRole('dialog')

        expect(dialog).toHaveAccessibleName(`Delete "${withFile.title}"?`)
        // ⚠️ The copy is the `video` scope's own. A video's file was never in
        // the media library and no arr ever knew about it, so the movie
        // sentence would be a claim about something that never happened.
        expect(dialog).toHaveAccessibleDescription(
          expect.stringContaining("this video's downloaded file"),
        )
        expect(dialog).toHaveAccessibleDescription(
          expect.not.stringMatching(/library|radarr/i),
        )
      })

      // ⚠️ The job id, not `video:V1StGXR8_Z5` — `deleteVideoJob` is
      // `DELETE /download/videos/:jobId`, exactly like the four lifecycle
      // actions beside it.
      it('deletes the job it is rendering, never the video key', async () => {
        const onDelete = jest.fn().mockResolvedValue({ job: { id: 'job_42' } })
        renderDetail({
          jobs: [
            job({
              id: 'job_42',
              status: DownloadJobStatus.Completed,
            }),
          ],
          media: withFile,
          onDelete,
        })

        await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
        await userEvent.click(
          screen.getByRole('button', { name: 'Delete', hidden: false }),
        )

        expect(onDelete).toHaveBeenCalledWith('job_42')
      })

      // The same guard `Save to device` gets, and for the same reason: a
      // completed job whose objects are already gone has nothing to delete,
      // and offering to remove nothing is the same lie as a link that 404s.
      it('is withheld once there is no file left to delete', () => {
        renderDetail({
          jobs: completed,
          media: video({ downloadUrls: [] }),
          onDelete: jest.fn(),
        })

        expect(
          screen.queryByRole('button', { name: 'Delete' }),
        ).not.toBeInTheDocument()
      })

      // Cancel is the control that means "stop this", and it is in the same
      // row saying so. Two buttons for one verb is how the wrong one gets
      // pressed.
      it('is not offered while the download is still running', () => {
        renderDetail({
          media: withFile,
          onCancel: jest.fn(),
          onDelete: jest.fn(),
        })

        expect(
          screen.getByRole('button', { name: 'Cancel' }),
        ).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Delete' }),
        ).not.toBeInTheDocument()
      })

      it('is not offered when the page wired no delete action', () => {
        renderDetail({ jobs: completed, media: withFile })

        expect(
          screen.getByRole('link', { name: 'Save to device' }),
        ).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'Delete' }),
        ).not.toBeInTheDocument()
      })
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

  /**
   * ⚠️ `connected` from `useJobEvents` means strictly "a socket is OPEN right
   * now" — false through the first connect and every backoff window — so
   * `stale` alone is not enough to warn anybody. The marker is about *missing
   * an update*, which is only possible while there is an update to miss.
   */
  describe('the stale marker', () => {
    it('warns while a running job’s feed is disconnected', () => {
      renderDetail({ stale: true })

      expect(screen.getByText(VIDEO_STALE_LABEL)).toBeInTheDocument()
    })

    it('says nothing while the feed is connected', () => {
      renderDetail()

      expect(screen.queryByText(VIDEO_STALE_LABEL)).not.toBeInTheDocument()
    })

    // A completed page is final. Raising a doubt about a panel that cannot
    // change is telling the reader something untrue.
    it('says nothing about a job that has already finished', () => {
      renderDetail({
        jobs: [
          job({
            completedAt: '2026-09-15T11:59:00.000Z',
            status: DownloadJobStatus.Completed,
          }),
        ],
        stale: true,
      })

      expect(screen.queryByText(VIDEO_STALE_LABEL)).not.toBeInTheDocument()
    })

    it('says nothing when nothing was ever downloaded', () => {
      renderDetail({ jobs: [], stale: true })

      expect(screen.queryByText(VIDEO_STALE_LABEL)).not.toBeInTheDocument()
    })

    /**
     * `paused` is **not** terminal — `isInProgress` is the complement of
     * `TERMINAL_DOWNLOAD_JOB_STATUSES` — and a paused download is still open
     * work whose resume this tab would otherwise fail to hear about.
     */
    it('warns for a paused job too, which is still open work', () => {
      renderDetail({
        jobs: [job({ status: DownloadJobStatus.Paused })],
        stale: true,
      })

      expect(screen.getByText(VIDEO_STALE_LABEL)).toBeInTheDocument()
    })

    // A badge in a flex column, not a banner: `inline-flex` is still stretched
    // by the column's default `align-items: stretch`.
    it('renders intrinsic rather than spanning the lifecycle column', () => {
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

  function emit(
    recorder: ReturnType<typeof createSocketRecorder>,
    next: DownloadJob,
  ): void {
    act(() => recorder.latest().emitMessage(buildJobFrame(next)))
  }

  it('renders the server’s jobs before a single frame arrives', () => {
    renderLive()

    expect(screen.getByText('downloading')).toBeInTheDocument()
  })

  /**
   * The structural requirement, pinned. `useJobEvents` throws without a
   * provider by design — the provider owns the socket, so a silent fallback
   * would let every call site quietly open another connection. This test is
   * what makes "mount the provider on the page" a failure rather than a
   * regression nobody notices until the gateway's client count doubles.
   */
  it('refuses to render outside a <JobEventsProvider>', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      render(<VideoDetailLive jobs={[job()]} media={video()} now={NOW} />),
    ).toThrow(/JobEventsProvider/)
  })

  /**
   * The whole point of the task. The user pastes a link, is redirected here,
   * and the status moves on its own — no reload, no router refresh, nothing
   * re-fetched.
   */
  it('advances the status chip when the gateway says the job moved', () => {
    const { recorder } = renderLive()

    emit(recorder, job({ status: DownloadJobStatus.Converting }))

    expect(screen.getByText('converting')).toBeInTheDocument()
    expect(screen.queryByText('downloading')).not.toBeInTheDocument()
  })

  // The controls are a function of the live status too, not just the chip:
  // Pause is legal only while `downloading`, so it has to go when that does.
  it('withdraws Pause once the job is no longer downloading', () => {
    const { recorder } = renderLive({ onCancel: jest.fn(), onPause: jest.fn() })

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()

    emit(recorder, job({ status: DownloadJobStatus.Converting }))

    expect(
      screen.queryByRole('button', { name: 'Pause' }),
    ).not.toBeInTheDocument()
  })

  it('swaps the poster for the player when the download completes', () => {
    const { container, recorder } = renderLive()

    expect(container.querySelector('video')).toBeNull()

    emit(
      recorder,
      job({
        completedAt: '2026-09-15T11:59:00.000Z',
        status: DownloadJobStatus.Completed,
      }),
    )

    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      `/api/download/media/${encodeURIComponent(MEDIA_ID)}/file`,
    )
  })

  it('shows the failure the gateway reports, and offers a Retry', () => {
    const { recorder } = renderLive({ onRetry: jest.fn() })

    emit(
      recorder,
      job({ error: 'ETIMEDOUT', status: DownloadJobStatus.Failed }),
    )

    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('ETIMEDOUT')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  /**
   * The filter is the reason this page can share the gateway's firehose
   * without displaying it. Another user's download is broadcast to this tab
   * and must never reach the panel.
   */
  it('ignores a frame for a job that is not on this page', () => {
    const { recorder } = renderLive()

    emit(
      recorder,
      job({ id: 'job_someone_else', status: DownloadJobStatus.Completed }),
    )

    expect(screen.getByText('downloading')).toBeInTheDocument()
    expect(screen.queryByText('completed')).not.toBeInTheDocument()
  })

  it('leaves an earlier attempt alone while the current one advances', () => {
    const { recorder } = renderLive({
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

    emit(recorder, job({ id: 'job_2', status: DownloadJobStatus.Uploading }))

    expect(screen.getByText('uploading')).toBeInTheDocument()
    expect(screen.getByText('Earlier attempts')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
  })

  /**
   * ⚠️ `useJobEvents({ jobIds: [...] })` is called with a **fresh array every
   * render**, which is the documented call shape: the interest is keyed on the
   * array's sorted contents, not its identity. If that ever regressed, this
   * call site would re-subscribe on every frame — and, were the socket ever
   * moved out of the provider, reconnect on every frame too.
   */
  it('opens exactly one socket no matter how many frames arrive', () => {
    const { recorder } = renderLive()

    emit(recorder, job({ status: DownloadJobStatus.Converting }))
    emit(recorder, job({ status: DownloadJobStatus.Uploading }))

    expect(recorder.sockets).toHaveLength(1)
  })

  describe('when the feed drops', () => {
    it('marks the running panel stale', () => {
      const { recorder } = renderLive()

      expect(screen.queryByText(VIDEO_STALE_LABEL)).not.toBeInTheDocument()

      act(() => recorder.latest().emitClose())

      expect(screen.getByText(VIDEO_STALE_LABEL)).toBeInTheDocument()
    })

    // The status is a server fact that does not stop being true because this
    // tab stopped hearing about it — one marker, not a blanked-out panel.
    it('keeps showing the last status it heard', () => {
      const { recorder } = renderLive()

      emit(recorder, job({ status: DownloadJobStatus.Converting }))
      act(() => recorder.latest().emitClose())

      expect(screen.getByText('converting')).toBeInTheDocument()
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
