import '@testing-library/jest-dom'

import type { DownloadJob, Movie } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { JobLifecycleProps } from 'src/components/detail/job-lifecycle'
import { JobHistory, JobLifecycle } from 'src/components/detail/job-lifecycle'
import { jobStatusLabel } from 'src/components/detail/job-state'
import { Button } from 'src/components/ui/button'

/** The one instant every stamp on the page is measured against. */
const NOW = Date.parse('2026-09-15T12:00:00.000Z')

const EVERY_STATUS = Object.values(DownloadJobStatus)

const MOVIE: Movie = {
  id: 'tmdb:11660',
  title: 'Following',
  tmdbId: 11660,
  type: DownloadType.Movie,
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
 * A spy that is actually typed as the thing the page passes.
 *
 * ⚠️ **Never a bare `jest.fn()` for these four props.** An untyped mock is
 * `(...args: any[]) => any`, which is assignable to literally any function
 * type — including `ReactEventHandler<HTMLDivElement> & JobAction`, which is
 * what `onCancel` and `onPause` silently became when `JobLifecycleProps` first
 * spread `ComponentPropsWithoutRef<'div'>` without omitting them. React's
 * `DOMAttributes` puts the media events on every element, so the intersection
 * was real and no server action could satisfy it — and every spec here passed,
 * because `any` type-checks against a type nothing can inhabit.
 *
 * `jest.fn<Promise<void>, [string]>()` is the shape a page genuinely has, so
 * the collision is a compile error in this file if it ever comes back.
 */
function jobAction(): jest.Mock<Promise<void>, [string]> {
  return jest.fn<Promise<void>, [string]>()
}

/**
 * Every lifecycle control wired at once, so a status's action set is whatever
 * it genuinely offers rather than whatever this render happened to supply.
 */
function renderPanel(status: DownloadJobStatus, jobs?: DownloadJob[]) {
  return render(
    <JobLifecycle
      jobs={jobs ?? [job({ status })]}
      onCancel={jobAction()}
      onPause={jobAction()}
      onResume={jobAction()}
      onRetry={jobAction()}
      save={{ href: 'https://minio.lilnas.io/following.mkv' }}
      watch={{ external: true, href: 'https://emby.lilnas.io/web/item' }}
    />,
  )
}

/**
 * The labels of every control the panel put on screen, in DOM order.
 * `button, a` rather than a role query: an `aria-disabled` `ButtonLink` drops
 * its `href` and stops being a `link`, and an action that disabled itself is
 * exactly what these tests are about.
 */
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
  [DownloadJobStatus.Cancelled]: ['Retry'],
  [DownloadJobStatus.Cancelling]: ['Cancel'],
  [DownloadJobStatus.Cleaning]: ['Cancel'],
  [DownloadJobStatus.Completed]: ['Watch', 'Save to device'],
  [DownloadJobStatus.Converting]: ['Cancel'],
  [DownloadJobStatus.Downloading]: ['Pause', 'Cancel'],
  [DownloadJobStatus.Failed]: ['Retry'],
  [DownloadJobStatus.Importing]: ['Cancel'],
  // The Import control lands in a later task; until then the only way out of
  // a stuck import from this panel is to cancel it.
  [DownloadJobStatus.NeedsAttention]: ['Cancel'],
  [DownloadJobStatus.Paused]: ['Resume', 'Cancel'],
  [DownloadJobStatus.Pausing]: ['Pause', 'Cancel'],
  [DownloadJobStatus.Pending]: ['Cancel'],
  [DownloadJobStatus.Requested]: ['Cancel'],
  [DownloadJobStatus.Searching]: ['Cancel'],
  [DownloadJobStatus.Uploading]: ['Cancel'],
}

describe('JobLifecycle', () => {
  describe('the status table', () => {
    it.each(EVERY_STATUS)('tints %s chip with its own tone', status => {
      renderPanel(status)

      // The rendered `class` attribute, not the string handed to `cns` —
      // twMerge reshapes the list afterwards, and it is the reshaped list
      // that decides what a reader actually sees.
      const chip = screen.getByText(jobStatusLabel(status))

      expect(chip.getAttribute('class')).toContain(TONE_MARKERS[status])
    })

    it.each(EVERY_STATUS)('offers %s exactly its own action set', status => {
      const { container } = renderPanel(status)

      expect(controlLabels(container)).toEqual(EXPECTED_ACTIONS[status])
    })

    it.each(EVERY_STATUS)(
      'offers pause on %s only while it is legal',
      status => {
        const { container } = renderPanel(status)
        const labels = controlLabels(container)

        const legal =
          status === DownloadJobStatus.Downloading ||
          status === DownloadJobStatus.Pausing

        // A pause on anything but `downloading` is a 409 from the API, and
        // `pausing` only keeps the control on screen to acknowledge the press
        // that already happened.
        expect(labels.includes('Pause')).toBe(legal)
      },
    )

    it('marks the work the machine is actively doing with a live dot', () => {
      const { container } = renderPanel(DownloadJobStatus.Downloading)

      expect(container.querySelector('.dot-live')).toBeInTheDocument()
    })

    it('leaves a resting state undotted', () => {
      const { container } = renderPanel(DownloadJobStatus.Paused)

      expect(container.querySelector('.dot-live')).not.toBeInTheDocument()
    })

    it('⚠️ leaves a stuck import undotted, because nothing is happening to it', () => {
      // The bug this status exists to fix: folded into `importing`, a job
      // nobody will ever import breathed away like a 30-second one. The dot
      // is derived from the tone, so `warn` is what stops it.
      const { container } = renderPanel(DownloadJobStatus.NeedsAttention)

      expect(container.querySelector('.dot-live')).not.toBeInTheDocument()
      expect(screen.getByText('needs your decision')).toBeInTheDocument()
    })
  })

  describe('acknowledgement states', () => {
    it('keeps Pause on screen but inert while the pause is in flight', () => {
      const { container } = renderPanel(DownloadJobStatus.Pausing)

      expect(inertLabels(container)).toEqual(['Pause'])
    })

    it('keeps Cancel on screen but inert while the cancel is in flight', () => {
      const { container } = renderPanel(DownloadJobStatus.Cancelling)

      expect(inertLabels(container)).toEqual(['Cancel'])
    })

    it('uses aria-disabled rather than the real attribute, so focus is not stranded', () => {
      renderPanel(DownloadJobStatus.Pausing)

      const pause = screen.getByRole('button', { name: 'Pause' })

      // A real `disabled` would drop the button out of the tab order under the
      // cursor of the person who just pressed it.
      expect(pause).toHaveAttribute('aria-disabled', 'true')
      expect(pause).not.toBeDisabled()
    })

    it('swallows a second press on an acknowledged action', async () => {
      const user = userEvent.setup()
      const onPause = jobAction()

      render(
        <JobLifecycle
          jobs={[job({ status: DownloadJobStatus.Pausing })]}
          onPause={onPause}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Pause' }))

      expect(onPause).not.toHaveBeenCalled()
    })
  })

  describe('actions', () => {
    it('hands the callback the id of the job it is rendering', async () => {
      const user = userEvent.setup()
      const onPause = jobAction()

      render(
        <JobLifecycle
          jobs={[job({ id: 'job_99', status: DownloadJobStatus.Downloading })]}
          onPause={onPause}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Pause' }))

      expect(onPause).toHaveBeenCalledWith('job_99')
    })

    // ⚠️ The regression this file exists to prevent, and it is a *compile*
    // assertion wearing a test's clothes: `serverAction` is exactly the shape
    // `src/app/actions/video-job.ts` exports, and `JobLifecycleProps` has to
    // keep accepting it on all four props. Before the `Omit`, `onCancel` and
    // `onPause` intersected React's own `<div>` media events and this file
    // would not have compiled — which is the whole point, since it type-checked
    // happily while every handler was a bare `jest.fn()`.
    it('takes an unbound server action on every lifecycle prop', async () => {
      const calls: string[] = []
      const serverAction = async (jobId: string): Promise<void> => {
        calls.push(jobId)
      }
      const wired: Pick<
        JobLifecycleProps,
        'onCancel' | 'onPause' | 'onResume' | 'onRetry'
      > = {
        onCancel: serverAction,
        onPause: serverAction,
        onResume: serverAction,
        onRetry: serverAction,
      }

      render(
        <JobLifecycle
          {...wired}
          jobs={[job({ id: 'job_7', status: DownloadJobStatus.Downloading })]}
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Pause' }))

      expect(calls).toEqual(['job_7'])
    })

    it('renders nothing for an action the page did not wire', () => {
      const { container } = render(
        <JobLifecycle
          jobs={[job({ status: DownloadJobStatus.Downloading })]}
          onCancel={jobAction()}
        />,
      )

      expect(controlLabels(container)).toEqual(['Cancel'])
    })

    it('opens an external watch link in a new tab without a referrer', () => {
      renderPanel(DownloadJobStatus.Completed)

      const watch = screen.getByRole('link', { name: 'Watch' })

      expect(watch).toHaveAttribute('href', 'https://emby.lilnas.io/web/item')
      expect(watch).toHaveAttribute('rel', 'noreferrer')
      expect(watch).toHaveAttribute('target', '_blank')
    })

    it('leaves an in-app link in the same tab', () => {
      render(
        <JobLifecycle
          jobs={[job({ status: DownloadJobStatus.Completed })]}
          watch={{ href: '/videos/abc123' }}
        />,
      )

      const watch = screen.getByRole('link', { name: 'Watch' })

      expect(watch).not.toHaveAttribute('target')
      expect(watch).not.toHaveAttribute('rel')
    })

    it('appends the page-specific controls after the lifecycle ones', () => {
      const { container } = render(
        <JobLifecycle
          extraActions={<Button variant="bad">Delete</Button>}
          jobs={[job({ status: DownloadJobStatus.Completed })]}
          watch={{ href: '/videos/abc123' }}
        />,
      )

      expect(controlLabels(container)).toEqual(['Watch', 'Delete'])
    })
  })

  describe('which job it renders', () => {
    it('renders the newest of several attempts', () => {
      const { container } = renderPanel(DownloadJobStatus.Failed, [
        job({ id: 'job_3', status: DownloadJobStatus.Failed }),
        job({ id: 'job_2', status: DownloadJobStatus.Cancelled }),
        job({ id: 'job_1', status: DownloadJobStatus.Completed }),
      ])

      expect(screen.getByText('failed')).toBeInTheDocument()
      expect(screen.queryByText('completed')).not.toBeInTheDocument()
      expect(controlLabels(container)).toEqual(['Retry'])
    })

    it('binds the action to the newest job, not the first one ever run', async () => {
      const user = userEvent.setup()
      const onRetry = jobAction()

      render(
        <JobLifecycle
          jobs={[
            job({ id: 'job_3', status: DownloadJobStatus.Failed }),
            job({ id: 'job_1', status: DownloadJobStatus.Failed }),
          ]}
          onRetry={onRetry}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Retry' }))

      expect(onRetry).toHaveBeenCalledWith('job_3')
    })
  })

  describe('a title this app never fetched', () => {
    it('reads as not downloaded rather than as a status', () => {
      render(<JobLifecycle jobs={[]} />)

      expect(screen.getByText('not downloaded')).toBeInTheDocument()
    })

    it('offers only what the page supplies for the empty state', () => {
      const { container } = render(
        <JobLifecycle
          emptyActions={<Button variant="outline">Download</Button>}
          jobs={[]}
          onCancel={jobAction()}
          onRetry={jobAction()}
        />,
      )

      // None of the status-table actions apply: there is no status.
      expect(controlLabels(container)).toEqual(['Download'])
    })

    it('says what the page tells it to say', () => {
      render(<JobLifecycle emptyNote="Ready to grab whenever." jobs={[]} />)

      expect(screen.getByText('Ready to grab whenever.')).toBeInTheDocument()
    })
  })

  describe('progress', () => {
    it('draws the bar from the queue snapshot', () => {
      renderPanel(DownloadJobStatus.Downloading, [
        job({
          media: {
            ...MOVIE,
            queueSnapshot: {
              progress: 47.25,
              status: 'downloading',
              timeLeft: '00:12:34',
            },
          },
          status: DownloadJobStatus.Downloading,
        }),
      ])

      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '47.25',
      )
      expect(screen.getByText('47%')).toBeInTheDocument()
      expect(screen.getByText('~00:12:34 left')).toBeInTheDocument()
    })

    it('draws no bar at all when nothing reported a percentage', () => {
      renderPanel(DownloadJobStatus.Downloading)

      // A 0% bar is a claim; an absent one is the truth.
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    })

    it('lets a page supply its own percentage and lines', () => {
      render(
        <JobLifecycle
          jobs={[job({ status: DownloadJobStatus.Downloading })]}
          progressDetail="14 of 24 episodes"
          progressNote="season 3"
          progressPct={58}
        />,
      )

      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '58',
      )
      expect(screen.getByText('season 3')).toBeInTheDocument()
      expect(screen.getByText('14 of 24 episodes')).toBeInTheDocument()
    })

    it('names the bar and hides the percentage that repeats it', () => {
      render(
        <JobLifecycle
          jobs={[job({ status: DownloadJobStatus.Downloading })]}
          progressPct={58}
        />,
      )

      expect(screen.getByRole('progressbar')).toHaveAccessibleName(
        'Download progress',
      )
      expect(screen.getByText('58%')).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('the line beside the chip', () => {
    it('shows a failed job its own error', () => {
      render(
        <JobLifecycle
          jobs={[job({ error: 'ETIMEDOUT', status: DownloadJobStatus.Failed })]}
        />,
      )

      expect(screen.getByText('ETIMEDOUT')).toBeInTheDocument()
    })

    it('lets the page override it', () => {
      render(
        <JobLifecycle
          explain="Waiting for a slot — usually seconds."
          jobs={[job({ status: DownloadJobStatus.Pending })]}
        />,
      )

      expect(
        screen.getByText('Waiting for a slot — usually seconds.'),
      ).toBeInTheDocument()
    })
  })
})

describe('JobHistory', () => {
  it('drops the newest job, which the panel above is already rendering', () => {
    render(
      <JobHistory
        jobs={[
          job({ id: 'job_3', status: DownloadJobStatus.Failed }),
          job({ id: 'job_2', status: DownloadJobStatus.Cancelled }),
        ]}
        now={NOW}
      />,
    )

    expect(screen.getByText('cancelled')).toBeInTheDocument()
    expect(screen.queryByText('failed')).not.toBeInTheDocument()
  })

  it('renders nothing when there has only ever been one attempt', () => {
    const { container } = render(<JobHistory jobs={[job()]} now={NOW} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a title never fetched', () => {
    const { container } = render(<JobHistory jobs={[]} now={NOW} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('measures each stamp against the instant it is given, never the clock', () => {
    render(
      <JobHistory
        jobs={[
          job({ id: 'job_2' }),
          job({ createdAt: '2026-09-15T11:48:00.000Z', id: 'job_1' }),
        ]}
        now={NOW}
      />,
    )

    expect(screen.getByText('12m ago')).toBeInTheDocument()
  })

  it('carries a failed attempt its error', () => {
    render(
      <JobHistory
        jobs={[
          job({ id: 'job_2' }),
          job({
            error: 'ETIMEDOUT',
            id: 'job_1',
            status: DownloadJobStatus.Failed,
          }),
        ]}
        now={NOW}
      />,
    )

    expect(screen.getByText('ETIMEDOUT')).toBeInTheDocument()
  })
})
