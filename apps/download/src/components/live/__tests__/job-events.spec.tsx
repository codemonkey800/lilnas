import {
  DownloadJobEventType,
  DownloadJobStatus,
} from '@lilnas/utils/download/types'
import { act, render, screen } from '@testing-library/react'
import type { JSX } from 'react'

import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildJobFrame,
  buildVideoJob,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'
import {
  DEFAULT_RECONNECT_DELAYS_MS,
  useJobEvents,
} from 'src/lib/use-job-events'

/** Renders the hook's output flat enough to assert on with plain queries. */
function JobList({ jobIds }: { jobIds?: string[] }): JSX.Element {
  const { connected, jobs } = useJobEvents(jobIds ? { jobIds } : undefined)

  return (
    <ul data-testid={connected ? 'connected' : 'disconnected'}>
      {[...jobs.values()].map(job => (
        <li key={job.id}>{`${job.id}:${job.status}`}</li>
      ))}
    </ul>
  )
}

describe('JobEventsProvider', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function renderProvider(ui: JSX.Element) {
    const recorder = createSocketRecorder()
    const view = render(
      <JobEventsProvider
        createSocket={recorder.createSocket}
        getLocation={() => TEST_LOCATION}
        random={NO_JITTER}
      >
        {ui}
      </JobEventsProvider>,
    )
    return { recorder, ...view }
  }

  it('opens exactly one socket for the whole subtree', () => {
    const { recorder } = renderProvider(
      <>
        <JobList />
        <JobList jobIds={['video-1']} />
      </>,
    )

    expect(recorder.sockets).toHaveLength(1)
    expect(recorder.latest().url).toBe('wss://download.lilnas.io/ws')
  })

  it('renders no wrapper element of its own', () => {
    const { container } = renderProvider(<span>only child</span>)

    expect(container.firstChild).toBe(screen.getByText('only child'))
  })

  it('upserts a created frame and then an updated one by job id', () => {
    const { recorder } = renderProvider(<JobList />)

    act(() =>
      recorder
        .latest()
        .emitMessage(
          buildJobFrame(
            buildVideoJob({ status: DownloadJobStatus.Pending }),
            DownloadJobEventType.Created,
          ),
        ),
    )
    expect(screen.getByText('video-1:pending')).toBeInTheDocument()

    act(() =>
      recorder
        .latest()
        .emitMessage(
          buildJobFrame(
            buildVideoJob({ status: DownloadJobStatus.Downloading }),
            DownloadJobEventType.Updated,
          ),
        ),
    )

    expect(screen.getByText('video-1:downloading')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  // A degraded placeholder video must still render — a bad frame cannot be
  // allowed to take the subtree down.
  it('drops a malformed frame without throwing or disturbing the render', () => {
    const { recorder } = renderProvider(<JobList />)

    act(() => recorder.latest().emitMessage(buildJobFrame(buildVideoJob())))

    expect(() =>
      act(() => {
        recorder.latest().emitMessage('{not json')
        recorder.latest().emitMessage(JSON.stringify({ data: {}, type: 'x' }))
      }),
    ).not.toThrow()

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('surfaces connected: false while the socket is down, and true again after', () => {
    const { recorder } = renderProvider(<JobList />)

    expect(screen.getByTestId('disconnected')).toBeInTheDocument()

    act(() => recorder.latest().emitOpen())
    expect(screen.getByTestId('connected')).toBeInTheDocument()

    act(() => recorder.latest().emitClose())
    expect(screen.getByTestId('disconnected')).toBeInTheDocument()

    act(() => jest.advanceTimersByTime(DEFAULT_RECONNECT_DELAYS_MS[0]))
    expect(recorder.sockets).toHaveLength(2)

    act(() => recorder.latest().emitOpen())
    expect(screen.getByTestId('connected')).toBeInTheDocument()
  })

  it('reconnects after the socket closes', () => {
    const { recorder } = renderProvider(<JobList />)

    act(() => recorder.latest().emitClose())
    expect(recorder.sockets).toHaveLength(1)

    act(() => jest.advanceTimersByTime(DEFAULT_RECONNECT_DELAYS_MS[0]))
    expect(recorder.sockets).toHaveLength(2)
  })

  it('closes the socket on unmount and does not reconnect', () => {
    const { recorder, unmount } = renderProvider(<JobList />)
    const socket = recorder.latest()

    unmount()

    expect(socket.closeCount).toBe(1)

    act(() => jest.advanceTimersByTime(60_000))
    expect(recorder.sockets).toHaveLength(1)
  })

  it('ignores a job outside a filtered consumer of the page', () => {
    const { recorder } = renderProvider(<JobList jobIds={['video-1']} />)

    act(() => {
      recorder.latest().emitMessage(buildJobFrame(buildVideoJob()))
      recorder
        .latest()
        .emitMessage(buildJobFrame(buildVideoJob({ id: 'unrelated' })))
    })

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('video-1:pending')).toBeInTheDocument()
  })
})
