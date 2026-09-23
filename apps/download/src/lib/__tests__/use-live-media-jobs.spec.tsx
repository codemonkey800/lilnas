import type { DownloadJob } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { act, renderHook } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { JobEventsProvider } from 'src/components/live/job-events'
import {
  buildJobFrame,
  createSocketRecorder,
  NO_JITTER,
  TEST_LOCATION,
} from 'src/lib/__tests__/helpers/job-events'
import { useLiveMediaJobs } from 'src/lib/use-live-media-jobs'

jest.mock('next/navigation', () => ({ useRouter: jest.fn() }))

function movieJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:40:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-movie',
    linkedDiscord: null,
    media: {
      id: 'tmdb:920',
      title: 'Cars',
      tmdbId: 920,
      type: DownloadType.Movie,
    },
    requester: null,
    status: DownloadJobStatus.Searching,
    updatedAt: '2026-09-15T11:40:00.000Z',
    ...overrides,
  }
}

function setup(initial: readonly DownloadJob[]) {
  const refresh = jest.fn()
  jest.mocked(useRouter).mockReturnValue({
    refresh,
  } as unknown as ReturnType<typeof useRouter>)

  const recorder = createSocketRecorder()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <JobEventsProvider
      createSocket={recorder.createSocket}
      getLocation={() => TEST_LOCATION}
      random={NO_JITTER}
    >
      {children}
    </JobEventsProvider>
  )

  const view = renderHook(
    ({ jobs }: { jobs: readonly DownloadJob[] }) => useLiveMediaJobs(jobs),
    { initialProps: { jobs: initial }, wrapper },
  )

  const emit = (job: DownloadJob) =>
    act(() => recorder.latest().emitMessage(buildJobFrame(job)))

  return { ...view, emit, refresh }
}

describe('useLiveMediaJobs', () => {
  it('moves a job forward as frames arrive, without a refresh', () => {
    const { emit, refresh, result } = setup([movieJob()])

    emit(movieJob({ status: DownloadJobStatus.Downloading }))

    expect(result.current[0]?.status).toBe(DownloadJobStatus.Downloading)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes once when a job lands, holding it at importing meanwhile', () => {
    const { emit, refresh, rerender, result } = setup([movieJob()])
    const done = movieJob({ status: DownloadJobStatus.Completed })

    emit(done)

    expect(result.current[0]?.status).toBe(DownloadJobStatus.Importing)
    expect(refresh).toHaveBeenCalledTimes(1)

    // The refreshed server render now agrees, so nothing is held back.
    rerender({ jobs: [done] })

    expect(result.current[0]?.status).toBe(DownloadJobStatus.Completed)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
