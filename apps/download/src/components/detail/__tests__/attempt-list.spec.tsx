import '@testing-library/jest-dom'

import type {
  DownloadJob,
  Movie,
  Show,
  Video,
  VideoProgress,
} from '@lilnas/utils/download/types'
import {
  DownloadJobStatus,
  DownloadType,
  isTerminalDownloadJobStatus,
} from '@lilnas/utils/download/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AttemptListProps } from 'src/components/detail/attempt-list'
import {
  AttemptList,
  attemptScopeLabel,
} from 'src/components/detail/attempt-list'
import type { ImportDialogActions } from 'src/components/detail/import-dialog'
import { IMPORT_TRIGGER_LABEL } from 'src/components/detail/import-dialog'
import { jobStatusLabel } from 'src/components/detail/job-state'

/** The one instant every stamp on the page is measured against. */
const NOW = new Date('2026-09-15T12:00:00.000Z')

const EVERY_STATUS = Object.values(DownloadJobStatus)

const MOVIE: Movie = {
  id: 'tmdb:920',
  title: 'Cars',
  tmdbId: 920,
  type: DownloadType.Movie,
}

const SHOW: Show = {
  id: 'tvdb:79126',
  title: 'The Wire',
  tvdbId: 79126,
  type: DownloadType.Show,
}

const VIDEO: Video = {
  id: 'video:V1StGXR8_Z5',
  sourceUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  state: 'downloading',
  title: 'Sourdough starter, day one to seven',
  type: DownloadType.Video,
}

const MB = 1024 * 1024

/** yt-dlp's tick two files into a merge: 64% of 640 MB at 3.1 MB/s. */
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

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:48:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job_1',
    linkedDiscord: null,
    media: MOVIE,
    requester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_1' },
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:50:00.000Z',
    ...overrides,
  }
}

/**
 * Typed as the thing a page passes — never a bare `jest.fn()`, which would
 * type-check against the `<section>` media-event collision `AttemptListProps`
 * omits. An untyped mock is `(...args: any[]) => any`, assignable even to a
 * type nothing can inhabit, so the collision would come back unnoticed.
 */
function jobAction(): jest.Mock<Promise<void>, [string]> {
  return jest.fn<Promise<void>, [string]>()
}

function importActions(): ImportDialogActions & { list: jest.Mock } {
  return {
    commit: jest.fn().mockResolvedValue({ importedCount: 1 }),
    discard: jest.fn().mockResolvedValue({ discardedCount: 1 }),
    list: jest.fn().mockResolvedValue({ candidates: [] }),
  }
}

type Handlers = Required<
  Pick<AttemptListProps, 'onCancel' | 'onPause' | 'onResume' | 'onRetry'>
>

function handlers(): Handlers {
  return {
    onCancel: jobAction(),
    onPause: jobAction(),
    onResume: jobAction(),
    onRetry: jobAction(),
  }
}

/** Every control wired at once, so a status's set is what it truly offers. */
function renderList(jobs: DownloadJob[], wired: Handlers = handlers()) {
  return render(
    <AttemptList imports={importActions()} jobs={jobs} now={NOW} {...wired} />,
  )
}

/** The labels of every control on screen, in DOM order. */
function controlLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button, a')).map(
    element => element.textContent ?? '',
  )
}

function inertLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[aria-disabled="true"]')).map(
    element => element.textContent ?? '',
  )
}

function attempt(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-job-id="${id}"]`)
  if (!element) {
    throw new Error(`no attempt rendered for ${id}`)
  }
  return element
}

/**
 * `jobActionState`'s table, minus what an attempt does not carry: a
 * terminal job is a history row with no controls by default (Retry is
 * opt-in through `retryable` — see its own block below — and Watch/Save are
 * media actions), so `retry`, `watch` and `save` never appear here.
 */
/** The one class in each tone's table that is unique to it. */
const TONE_MARKERS: Record<DownloadJobStatus, string> = {
  [DownloadJobStatus.Cancelled]: 'text-ink-3',
  [DownloadJobStatus.Cancelling]: 'text-warn',
  [DownloadJobStatus.Cleaning]: 'text-uv-hi',
  [DownloadJobStatus.Completed]: 'text-ok',
  [DownloadJobStatus.Converting]: 'text-uv-hi',
  [DownloadJobStatus.Downloading]: 'text-uv-hi',
  [DownloadJobStatus.Failed]: 'text-bad',
  [DownloadJobStatus.Importing]: 'text-uv-hi',
  [DownloadJobStatus.NeedsAttention]: 'text-warn',
  [DownloadJobStatus.Paused]: 'text-warn',
  [DownloadJobStatus.Pausing]: 'text-warn',
  [DownloadJobStatus.Pending]: 'text-ink-3',
  [DownloadJobStatus.Requested]: 'text-ink-3',
  [DownloadJobStatus.Searching]: 'text-uv-hi',
  [DownloadJobStatus.Uploading]: 'text-uv-hi',
}

const EXPECTED_ACTIONS: Record<DownloadJobStatus, string[]> = {
  [DownloadJobStatus.Cancelled]: [],
  [DownloadJobStatus.Cancelling]: ['Cancel'],
  [DownloadJobStatus.Cleaning]: ['Cancel'],
  [DownloadJobStatus.Completed]: [],
  [DownloadJobStatus.Converting]: ['Cancel'],
  [DownloadJobStatus.Downloading]: ['Pause', 'Cancel'],
  [DownloadJobStatus.Failed]: [],
  [DownloadJobStatus.Importing]: ['Cancel'],
  [DownloadJobStatus.NeedsAttention]: [IMPORT_TRIGGER_LABEL, 'Cancel'],
  [DownloadJobStatus.Paused]: ['Resume', 'Cancel'],
  [DownloadJobStatus.Pausing]: ['Pause', 'Cancel'],
  [DownloadJobStatus.Pending]: ['Cancel'],
  [DownloadJobStatus.Requested]: ['Cancel'],
  [DownloadJobStatus.Searching]: ['Cancel'],
  [DownloadJobStatus.Uploading]: ['Cancel'],
}

describe('attemptScopeLabel', () => {
  it('names a season', () => {
    expect(attemptScopeLabel({ seasonNumber: 3 })).toBe('Season 3')
  })

  it('names an episode', () => {
    expect(
      attemptScopeLabel({ episodeId: 9, episodeNumber: 6, seasonNumber: 3 }),
    ).toBe('Season 3, episode 6')
  })

  it('names specials as season 0 rather than dropping them', () => {
    expect(attemptScopeLabel({ seasonNumber: 0 })).toBe('Season 0')
  })

  it('says nothing for a series-wide or unscoped job', () => {
    expect(attemptScopeLabel(undefined)).toBeNull()
    expect(attemptScopeLabel({})).toBeNull()
  })
})

describe('AttemptList', () => {
  it('renders nothing for an empty list', () => {
    const { container } = renderList([])

    expect(container).toBeEmptyDOMElement()
  })

  it('heads the list "Attempts" by default', () => {
    renderList([job()])

    expect(screen.getByRole('region', { name: 'Attempts' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Attempts' }),
    ).toBeInTheDocument()
  })

  it('takes a heading override', () => {
    render(<AttemptList jobs={[job()]} label="Season 3 attempts" now={NOW} />)

    expect(
      screen.getByRole('heading', { name: 'Season 3 attempts' }),
    ).toBeInTheDocument()
  })

  describe('ordering', () => {
    it('lists in-flight attempts first, then history, each newest first', () => {
      const { container } = renderList([
        job({
          createdAt: '2026-09-14T10:00:00.000Z',
          id: 'old_failed',
          status: DownloadJobStatus.Failed,
        }),
        job({
          createdAt: '2026-09-15T09:00:00.000Z',
          id: 'old_live',
          status: DownloadJobStatus.Downloading,
        }),
        job({
          createdAt: '2026-09-15T11:00:00.000Z',
          id: 'new_cancelled',
          status: DownloadJobStatus.Cancelled,
        }),
        job({
          createdAt: '2026-09-15T11:30:00.000Z',
          id: 'new_live',
          status: DownloadJobStatus.Paused,
        }),
      ])

      const ids = Array.from(container.querySelectorAll('[data-job-id]')).map(
        element => element.getAttribute('data-job-id'),
      )

      expect(ids).toEqual([
        'new_live',
        'old_live',
        'new_cancelled',
        'old_failed',
      ])
    })

    it('does not reorder the page’s own array', () => {
      const jobs = [
        job({ createdAt: '2026-09-14T10:00:00.000Z', id: 'older' }),
        job({ createdAt: '2026-09-15T10:00:00.000Z', id: 'newer' }),
      ]

      renderList(jobs)

      expect(jobs.map(entry => entry.id)).toEqual(['older', 'newer'])
    })
  })

  it.each(EVERY_STATUS)('tints the %s chip with its own tone', status => {
    const { container } = renderList([job({ status })])

    // The rendered `class` attribute, not the string handed to `cns` —
    // twMerge reshapes the list afterwards, and it is the reshaped list that
    // decides what a reader actually sees.
    const chip = within(attempt(container, 'job_1')).getByText(
      jobStatusLabel(status),
    )

    expect(chip.getAttribute('class')).toContain(TONE_MARKERS[status])
  })

  describe('in-flight attempts', () => {
    it.each(EVERY_STATUS)('offers %s exactly its own action set', status => {
      const { container } = renderList([job({ status })])

      expect(controlLabels(container)).toEqual(EXPECTED_ACTIONS[status])
    })

    it.each(EVERY_STATUS)(
      'draws %s as a card only while it is in flight',
      status => {
        const { container } = renderList([job({ status })])
        const element = attempt(container, 'job_1')

        expect(element.getAttribute('class')?.includes('border-uv/35')).toBe(
          !isTerminalDownloadJobStatus(status),
        )
      },
    )

    it('chips the attempt with its job status and a live dot', () => {
      const { container } = renderList([job()])
      const card = attempt(container, 'job_1')

      expect(
        within(card).getByText(jobStatusLabel(DownloadJobStatus.Downloading)),
      ).toBeInTheDocument()
      expect(card.querySelector('.dot-live')).toBeInTheDocument()
    })

    it('leaves a paused attempt undotted', () => {
      const { container } = renderList([
        job({ status: DownloadJobStatus.Paused }),
      ])

      expect(container.querySelector('.dot-live')).not.toBeInTheDocument()
    })

    it('draws the attempt’s own progress from its media snapshot', () => {
      renderList([
        job({
          media: {
            ...MOVIE,
            queueSnapshot: { progress: 47, timeLeft: '00:12:00' },
          },
        }),
      ])

      expect(
        screen.getByRole('progressbar', { name: 'Download progress' }),
      ).toHaveAttribute('aria-valuenow', '47')
      expect(screen.getByText('47%')).toBeInTheDocument()
      expect(screen.getByText('~00:12:00 left')).toBeInTheDocument()
    })

    it('settles a downloading attempt with nothing left to download', () => {
      const { container } = renderList([
        job({
          media: {
            ...MOVIE,
            queueSnapshot: {
              progress: 100,
              status: 'downloading',
              timeLeft: '00:00:00',
            },
          },
        }),
      ])
      const card = attempt(container, 'job_1')
      const bar = within(card).getByRole('progressbar', {
        name: 'Download progress',
      })

      expect(within(card).getByText('finishing up')).toBeInTheDocument()
      expect(
        within(card).getByText('All downloaded. Radarr imports it next.'),
      ).toBeInTheDocument()
      expect(within(card).queryByText('~00:00:00 left')).not.toBeInTheDocument()
      expect(bar).toHaveAttribute('aria-valuetext', '100%, finishing up')
      expect(bar.querySelector('[data-settling]')).toBeInTheDocument()
    })

    it('says who is importing, with or without a bar', () => {
      const { container } = renderList([
        job({ status: DownloadJobStatus.Importing }),
      ])
      const card = attempt(container, 'job_1')

      expect(
        within(card).getByText('Radarr is moving it into the library.'),
      ).toBeInTheDocument()
    })

    it('draws no bar when the attempt has no progress to prove', () => {
      renderList([job()])

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    describe('a video', () => {
      function videoJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
        return job({ media: VIDEO, progress: tick(), ...overrides })
      }

      it('draws no bar when the video carries no progress', () => {
        const { container } = renderList([videoJob({ progress: undefined })])
        const card = attempt(container, 'job_1')

        expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument()
        expect(within(card).queryByText(/%$/)).not.toBeInTheDocument()
        expect(within(card).queryByText(/MB\/s/)).not.toBeInTheDocument()
      })

      it('draws yt-dlp’s tick: bar, percentage, counter and transfer line', () => {
        const { container } = renderList([videoJob()])
        const card = attempt(container, 'job_1')

        expect(
          within(card).getByRole('progressbar', { name: 'Download progress' }),
        ).toHaveAttribute('aria-valuenow', '64')
        expect(within(card).getByText('64%')).toBeInTheDocument()
        expect(within(card).getByText('file 1 of 2')).toBeInTheDocument()
        expect(
          within(card).getByText('412 MB / 640 MB · 3.1 MB/s · ~2m left'),
        ).toBeInTheDocument()
      })

      // `formatEta` already phrased the estimate, so the movie's
      // `~${timeLeft} left` wrapping would stutter.
      it('does not wrap an estimate that is already phrased', () => {
        const { container } = renderList([videoJob()])
        const card = attempt(container, 'job_1')

        expect(card.textContent).not.toContain('~~')
        expect(card.textContent).not.toContain('left left')
      })

      it('sits the counter between the chip and the percentage', () => {
        const { container } = renderList([videoJob()])
        const card = attempt(container, 'job_1')
        const row = within(card).getByText('file 1 of 2').parentElement

        expect(
          Array.from(row?.children ?? []).map(child => child.textContent),
        ).toEqual(['downloading', 'file 1 of 2', '64%'])
      })

      it('counts fragments on an HLS download', () => {
        const { container } = renderList([
          videoJob({
            progress: tick({ fragmentCount: 123, fragmentIndex: 4 }),
          }),
        ])

        expect(
          within(attempt(container, 'job_1')).getByText(
            'file 1 of 2 · fragment 4 of 123',
          ),
        ).toBeInTheDocument()
      })

      it('draws the transfer alone when yt-dlp does not know the total', () => {
        const { container } = renderList([
          videoJob({
            progress: tick({
              etaSeconds: undefined,
              percent: undefined,
              totalBytes: undefined,
            }),
          }),
        ])
        const card = attempt(container, 'job_1')

        expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument()
        expect(within(card).queryByText(/%$/)).not.toBeInTheDocument()
        expect(within(card).getByText('412 MB · 3.1 MB/s')).toBeInTheDocument()
      })

      it('keeps a paused video’s bar and last line, undotted', () => {
        const { container } = renderList([
          videoJob({ status: DownloadJobStatus.Paused }),
        ])
        const card = attempt(container, 'job_1')

        expect(within(card).getByRole('progressbar')).toHaveAttribute(
          'aria-valuenow',
          '64',
        )
        expect(within(card).getByText('paused')).toBeInTheDocument()
        expect(card.querySelector('.dot-live')).not.toBeInTheDocument()
        expect(
          within(card).getByText('412 MB / 640 MB · 3.1 MB/s · ~2m left'),
        ).toBeInTheDocument()
      })

      it('settles once the bytes are down and the file is converting', () => {
        const { container } = renderList([
          videoJob({
            progress: tick({
              downloadedBytes: 640 * MB,
              etaSeconds: undefined,
              percent: 100,
            }),
            status: DownloadJobStatus.Converting,
          }),
        ])
        const card = attempt(container, 'job_1')
        const bar = within(card).getByRole('progressbar', {
          name: 'Download progress',
        })

        expect(bar).toHaveAttribute('aria-valuenow', '100')
        expect(bar).toHaveAttribute('aria-valuetext', '100%, converting')
        expect(bar.querySelector('[data-settling]')).toBeInTheDocument()
        expect(within(card).getByText('converting')).toBeInTheDocument()
        expect(within(card).queryByText(/MB\/s/)).not.toBeInTheDocument()
      })
    })

    it('never draws a movie’s queue status word as a counter', () => {
      const { container } = renderList([
        job({
          media: {
            ...MOVIE,
            queueSnapshot: {
              progress: 47,
              status: 'warning',
              timeLeft: '00:12:00',
            },
          },
        }),
      ])
      const card = attempt(container, 'job_1')

      expect(within(card).queryByText('warning')).not.toBeInTheDocument()
      expect(within(card).getByText('~00:12:00 left')).toBeInTheDocument()
    })

    it('leaves a stuck import undotted, because nothing is happening to it', () => {
      // The dot is derived from the tone, so `warn` is what stops a job nobody
      // will ever import from breathing away like a 30-second one.
      const { container } = renderList([
        job({ status: DownloadJobStatus.NeedsAttention }),
      ])

      expect(container.querySelector('.dot-live')).not.toBeInTheDocument()
    })

    it.each([
      [DownloadJobStatus.Pausing, 'Pause'],
      [DownloadJobStatus.Cancelling, 'Cancel'],
    ])('keeps %s’s acknowledged %s on screen but inert', (status, label) => {
      const { container } = renderList([job({ status })])

      expect(inertLabels(container)).toEqual([label])
    })

    it('uses aria-disabled rather than the real attribute, so focus is not stranded', () => {
      renderList([job({ status: DownloadJobStatus.Pausing })])

      const pause = screen.getByRole('button', { name: 'Pause' })

      // A real `disabled` would drop the button out of the tab order under the
      // cursor of the person who just pressed it.
      expect(pause).toHaveAttribute('aria-disabled', 'true')
      expect(pause).not.toBeDisabled()
    })

    it('swallows a second press on an acknowledged action', async () => {
      const user = userEvent.setup()
      const wired = handlers()

      renderList([job({ status: DownloadJobStatus.Pausing })], wired)
      await user.click(screen.getByRole('button', { name: 'Pause' }))

      expect(wired.onPause).not.toHaveBeenCalled()
    })

    it('renders nothing for an action the page did not wire', () => {
      const { container } = render(
        <AttemptList jobs={[job()]} now={NOW} onCancel={jobAction()} />,
      )

      expect(controlLabels(container)).toEqual(['Cancel'])
    })

    it('hands each handler the id of the attempt it was pressed on', async () => {
      const user = userEvent.setup()
      const wired = handlers()

      renderList(
        [
          job({ id: 'job_dl', status: DownloadJobStatus.Downloading }),
          job({
            createdAt: '2026-09-15T11:00:00.000Z',
            id: 'job_paused',
            status: DownloadJobStatus.Paused,
          }),
        ],
        wired,
      )

      const downloading = screen
        .getByText(jobStatusLabel(DownloadJobStatus.Downloading))
        .closest<HTMLElement>('[data-job-id]')
      const paused = screen
        .getByText(jobStatusLabel(DownloadJobStatus.Paused))
        .closest<HTMLElement>('[data-job-id]')

      if (!downloading || !paused) {
        throw new Error('expected two attempt cards')
      }

      await user.click(
        within(downloading).getByRole('button', { name: 'Pause' }),
      )
      await user.click(within(paused).getByRole('button', { name: 'Resume' }))
      await user.click(within(paused).getByRole('button', { name: 'Cancel' }))

      expect(wired.onPause).toHaveBeenCalledWith('job_dl')
      expect(wired.onResume).toHaveBeenCalledWith('job_paused')
      expect(wired.onCancel).toHaveBeenCalledWith('job_paused')
      expect(wired.onCancel).toHaveBeenCalledTimes(1)
    })

    it('takes an unbound server action on every handler prop', async () => {
      const calls: string[] = []
      const serverAction = async (jobId: string): Promise<void> => {
        calls.push(jobId)
      }
      const wired: Handlers = {
        onCancel: serverAction,
        onPause: serverAction,
        onResume: serverAction,
        onRetry: serverAction,
      }

      render(<AttemptList jobs={[job({ id: 'job_7' })]} now={NOW} {...wired} />)
      await userEvent.click(screen.getByRole('button', { name: 'Pause' }))

      expect(calls).toEqual(['job_7'])
    })
  })

  describe('two attempts in flight at one show', () => {
    const season = job({
      createdAt: '2026-09-15T11:00:00.000Z',
      id: 'job_season',
      media: SHOW,
      scope: { seasonNumber: 3 },
      status: DownloadJobStatus.Downloading,
    })
    const episode = job({
      createdAt: '2026-09-15T11:30:00.000Z',
      id: 'job_episode',
      media: SHOW,
      scope: { episodeId: 41, episodeNumber: 6, seasonNumber: 3 },
      status: DownloadJobStatus.Importing,
    })

    it('gives each its own card, scope and actions', () => {
      const { container } = renderList([season, episode])
      const seasonCard = attempt(container, 'job_season')
      const episodeCard = attempt(container, 'job_episode')

      expect(within(seasonCard).getByText('Season 3')).toBeInTheDocument()
      expect(controlLabels(seasonCard)).toEqual(['Pause', 'Cancel'])
      expect(
        within(episodeCard).getByText('Season 3, episode 6'),
      ).toBeInTheDocument()
      expect(controlLabels(episodeCard)).toEqual(['Cancel'])
    })

    it('cancels only the attempt that was pressed', async () => {
      const user = userEvent.setup()
      const wired = handlers()
      const { container } = renderList([season, episode], wired)

      await user.click(
        within(attempt(container, 'job_season')).getByRole('button', {
          name: 'Cancel',
        }),
      )

      expect(wired.onCancel).toHaveBeenCalledTimes(1)
      expect(wired.onCancel).toHaveBeenCalledWith('job_season')
    })
  })

  describe('a stuck import', () => {
    it('puts Import on the needs_attention attempt, not anywhere else', () => {
      const { container } = renderList([
        job({ id: 'job_stuck', status: DownloadJobStatus.NeedsAttention }),
        job({
          createdAt: '2026-09-15T11:00:00.000Z',
          id: 'job_live',
          media: SHOW,
          status: DownloadJobStatus.Downloading,
        }),
      ])

      expect(
        within(attempt(container, 'job_stuck')).getByRole('button', {
          name: IMPORT_TRIGGER_LABEL,
        }),
      ).toBeInTheDocument()
      expect(
        within(attempt(container, 'job_live')).queryByRole('button', {
          name: IMPORT_TRIGGER_LABEL,
        }),
      ).not.toBeInTheDocument()
    })

    it('asks for the candidates of the attempt it sits on, scope and all', async () => {
      const user = userEvent.setup()
      const imports = importActions()

      render(
        <AttemptList
          imports={imports}
          jobs={[
            job({
              media: SHOW,
              scope: { seasonNumber: 2 },
              status: DownloadJobStatus.NeedsAttention,
            }),
          ]}
          now={NOW}
        />,
      )
      await user.click(
        screen.getByRole('button', { name: IMPORT_TRIGGER_LABEL }),
      )

      // ⚠️ The media key and the scope both come off the job, so a season pack
      // stuck inside a series asks about that season and not the whole show.
      await waitFor(() =>
        expect(imports.list).toHaveBeenCalledWith(SHOW.id, {
          episodeId: undefined,
          seasonNumber: 2,
        }),
      )
    })

    it('names the dialog after the media the attempt carries', async () => {
      const user = userEvent.setup()

      renderList([job({ status: DownloadJobStatus.NeedsAttention })])
      await user.click(
        screen.getByRole('button', { name: IMPORT_TRIGGER_LABEL }),
      )

      expect(await screen.findByText('Import "Cars"')).toBeInTheDocument()
    })

    it('offers no Import without the importer actions', () => {
      const { container } = render(
        <AttemptList
          jobs={[job({ status: DownloadJobStatus.NeedsAttention })]}
          now={NOW}
          onCancel={jobAction()}
        />,
      )

      expect(controlLabels(container)).toEqual(['Cancel'])
    })

    it('says why beside the attempt', () => {
      renderList([
        job({
          error: 'Radarr could not match the file',
          status: DownloadJobStatus.NeedsAttention,
        }),
      ])

      expect(
        screen.getByText('Radarr could not match the file'),
      ).toBeInTheDocument()
    })
  })

  describe('retry', () => {
    const failed = job({
      completedAt: '2026-09-15T11:00:00.000Z',
      createdAt: '2026-09-15T10:00:00.000Z',
      id: 'job_new_failed',
      status: DownloadJobStatus.Failed,
    })
    const olderFailed = job({
      completedAt: '2026-09-14T11:00:00.000Z',
      createdAt: '2026-09-14T10:00:00.000Z',
      id: 'job_old_failed',
      status: DownloadJobStatus.Failed,
    })

    function renderRetryable(
      jobs: DownloadJob[],
      retryable: boolean,
      wired: Handlers = handlers(),
    ) {
      return render(
        <AttemptList jobs={jobs} now={NOW} retryable={retryable} {...wired} />,
      )
    }

    it('offers none by default, even on a failed newest attempt', () => {
      const { container } = renderList([failed])

      expect(controlLabels(container)).toEqual([])
    })

    it('offers none when the page says the title is not retryable', () => {
      const { container } = renderRetryable([failed], false)

      expect(controlLabels(container)).toEqual([])
    })

    it.each([DownloadJobStatus.Failed, DownloadJobStatus.Cancelled])(
      'offers Retry on a %s newest attempt',
      status => {
        const { container } = renderRetryable([job({ status })], true)

        expect(controlLabels(attempt(container, 'job_1'))).toEqual(['Retry'])
      },
    )

    it('offers it on the newest row only, never an older failure', () => {
      const { container } = renderRetryable([olderFailed, failed], true)

      expect(controlLabels(attempt(container, 'job_new_failed'))).toEqual([
        'Retry',
      ])
      expect(controlLabels(attempt(container, 'job_old_failed'))).toEqual([])
    })

    it('offers none when the newest attempt completed', () => {
      const { container } = renderRetryable(
        [
          olderFailed,
          job({
            createdAt: '2026-09-15T11:00:00.000Z',
            id: 'job_done',
            status: DownloadJobStatus.Completed,
          }),
        ],
        true,
      )

      expect(controlLabels(container)).toEqual([])
    })

    it('offers none on history while a newer attempt is in flight', () => {
      const { container } = renderRetryable(
        [
          failed,
          job({
            createdAt: '2026-09-15T11:30:00.000Z',
            id: 'job_live',
            status: DownloadJobStatus.Downloading,
          }),
        ],
        true,
      )

      expect(controlLabels(attempt(container, 'job_new_failed'))).toEqual([])
    })

    it('offers none without a retry handler', () => {
      const { container } = render(
        <AttemptList jobs={[failed]} now={NOW} retryable />,
      )

      expect(controlLabels(container)).toEqual([])
    })

    it('hands onRetry the newest attempt’s id', async () => {
      const user = userEvent.setup()
      const wired = handlers()

      renderRetryable([olderFailed, failed], true, wired)
      await user.click(screen.getByRole('button', { name: 'Retry' }))

      expect(wired.onRetry).toHaveBeenCalledTimes(1)
      expect(wired.onRetry).toHaveBeenCalledWith('job_new_failed')
    })
  })

  describe('finished attempts', () => {
    it('shows the status, when it ended, who asked and what went wrong', () => {
      const { container } = renderList([
        job({
          completedAt: '2026-09-15T10:00:00.000Z',
          error: 'Connection reset by peer',
          status: DownloadJobStatus.Failed,
        }),
      ])
      const line = attempt(container, 'job_1')

      expect(within(line).getByText('failed').getAttribute('class')).toContain(
        'text-bad',
      )
      expect(within(line).getByText('2h ago')).toBeInTheDocument()
      expect(within(line).getByText('jeremy.asuncion')).toBeInTheDocument()
      expect(
        within(line).getByTitle('jeremy.asuncion@lilnas.io'),
      ).toHaveTextContent('JA')
      expect(
        within(line)
          .getByText('Connection reset by peer')
          .getAttribute('class'),
      ).toContain('text-bad')
    })

    it('falls back to when the attempt started', () => {
      const { container } = renderList([
        job({
          completedAt: null,
          createdAt: '2026-09-14T12:00:00.000Z',
          status: DownloadJobStatus.Cancelled,
        }),
      ])

      expect(
        within(attempt(container, 'job_1')).getByText('1d ago'),
      ).toBeInTheDocument()
    })

    it('renders a masked requester as hidden, with nothing behind the mask', () => {
      const { container } = renderList([
        job({
          discordRequester: null,
          linkedDiscord: null,
          requester: null,
          status: DownloadJobStatus.Completed,
        }),
      ])
      const line = attempt(container, 'job_1')

      expect(within(line).getByText('hidden')).toBeInTheDocument()
      expect(within(line).getByTitle('Attribution hidden')).toHaveTextContent(
        '–',
      )
      expect(line.querySelector('a')).not.toBeInTheDocument()
    })

    // Plan 022: an attempt adopted from Radarr's/Sonarr's own UI has the same
    // nulls as a masked one, and is credited to the service instead.
    it.each([
      ['Radarr', MOVIE],
      ['Sonarr', SHOW],
    ] as const)(
      'credits an adopted attempt to %s — no avatar, no link, never hidden',
      (source, media) => {
        const { container } = renderList([
          job({
            media,
            requester: null,
            startedUpstream: true,
            status: DownloadJobStatus.Cancelled,
          }),
        ])
        const line = attempt(container, 'job_1')

        expect(within(line).getByText(source)).toBeInTheDocument()
        expect(within(line).queryByText('hidden')).not.toBeInTheDocument()
        expect(
          within(line).queryByTitle('Attribution hidden'),
        ).not.toBeInTheDocument()
        expect(line.querySelector('a')).not.toBeInTheDocument()
      },
    )

    it('renders an unlinked Discord requester by handle', () => {
      const { container } = renderList([
        job({
          discordRequester: {
            discordUserId: '123456789012345678',
            discordUsername: 'sam.pham',
          },
          requester: null,
          status: DownloadJobStatus.Completed,
        }),
      ])

      expect(
        within(attempt(container, 'job_1')).getByText('sam.pham'),
      ).toBeInTheDocument()
    })

    it('renders a linked Discord handle beside the requester', () => {
      const { container } = renderList([
        job({
          linkedDiscord: {
            discordUserId: '123456789012345678',
            discordUsername: 'jeremy',
          },
          status: DownloadJobStatus.Completed,
        }),
      ])

      expect(
        within(attempt(container, 'job_1')).getByText('@jeremy'),
      ).toBeInTheDocument()
    })

    it('draws no progress bar for a finished attempt', () => {
      renderList([
        job({
          media: { ...MOVIE, queueSnapshot: { progress: 100 } },
          status: DownloadJobStatus.Completed,
        }),
      ])

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })
  })
})
