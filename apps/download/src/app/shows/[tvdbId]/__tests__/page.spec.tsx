import '@testing-library/jest-dom'

import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { notFound } from 'next/navigation'

import { cancelShowJob, retryShowJob } from 'src/app/actions/media-job'
import ShowPage from 'src/app/shows/[tvdbId]/page'
import {
  episode,
  scopedJob,
  season,
  show,
  SHOW_ID,
  specials,
} from 'src/components/detail/__tests__/fixtures/show'
import { SEASONS_EMPTY_NOTE } from 'src/components/detail/show-seasons'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

// The page's whole job is which calls it makes and what it renders with the
// answers; the client itself is covered by `packages/utils`.
jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

// ⚠️ The action module's graph reaches `next/headers`, which is unavailable
// outside a request scope. Mocked as plain references - the page only passes
// them down, and every one of them is a LIVE library mutation that must never
// fire from a test.
jest.mock('src/app/actions/media-files', () => ({
  deleteMediaFiles: jest.fn(),
  flagBadFile: jest.fn(),
  grabRelease: jest.fn(),
  replaceRelease: jest.fn(),
  searchReleases: jest.fn(),
  unflagBadFile: jest.fn(),
}))

// The same, for the job lifecycle: each is a LIVE `PATCH` or request.
jest.mock('src/app/actions/media-job', () => ({
  cancelShowJob: jest.fn(),
  retryShowJob: jest.fn(),
}))

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  // The live wrapper refreshes the page when a download lands.
  useRouter: () => ({ refresh: jest.fn() }),
}))

const S1 = season({
  episodeCount: 2,
  episodeFileCount: 1,
  episodes: [
    episode({ episodeNumber: 1, hasFile: true, id: 2430, seasonNumber: 1 }),
    episode({ episodeNumber: 2, id: 2431, seasonNumber: 1 }),
  ],
  seasonNumber: 1,
})

type Client = {
  getMedia: jest.Mock
  listBadFiles: jest.Mock
  listSeasons: jest.Mock
}

function client(overrides: Partial<Client> = {}): Client {
  const stub: Client = {
    getMedia: jest.fn().mockResolvedValue({ jobs: [], media: show() }),
    listBadFiles: jest.fn().mockResolvedValue({ badFiles: [] }),
    listSeasons: jest.fn().mockResolvedValue({ seasons: [specials(), S1] }),
    ...overrides,
  }

  jest
    .mocked(getIdentifiedDownloadClient)
    .mockResolvedValue(
      stub as unknown as Awaited<
        ReturnType<typeof getIdentifiedDownloadClient>
      >,
    )

  return stub
}

async function renderPage(tvdbId = '277165') {
  return render(await ShowPage({ params: Promise.resolve({ tvdbId }) }))
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('⚠️ the route segment becomes a media key, and only a media key', () => {
  it('reattaches the `tvdb:` prefix the route dropped', async () => {
    const stub = client()

    await renderPage('277165')

    expect(stub.getMedia).toHaveBeenCalledWith(SHOW_ID)
    expect(stub.listSeasons).toHaveBeenCalledWith(SHOW_ID)
    expect(stub.listBadFiles).toHaveBeenCalledWith(SHOW_ID)
  })

  it.each([
    ['a smuggled key', 'tvdb:277165'],
    ['a leading zero', '0277165'],
    ['a negative id', '-1'],
    ['a path traversal', '../movies/11660'],
    ['nothing at all', ''],
  ])(
    '404s on %s, which is the one genuine 404 here',
    async (_name, segment) => {
      client()

      await expect(renderPage(segment)).rejects.toThrow('NEXT_NOT_FOUND')
      expect(notFound).toHaveBeenCalled()
    },
  )
})

describe('⚠️ the release search is never fired by loading the page', () => {
  it('asks for media, seasons and flags — and nothing else', async () => {
    const stub = client()

    await renderPage()

    // `GET /media/:id/releases` is a 30s+ indexer sweep that *writes upstream*.
    // It reaches exactly one caller, `ReleasePicker`'s own trigger press.
    expect(stub).not.toHaveProperty('listReleases.mock')
    expect(Object.keys(stub)).toEqual([
      'getMedia',
      'listBadFiles',
      'listSeasons',
    ])
  })
})

describe('a show that is not in the library yet', () => {
  it('⚠️ absorbs the seasons 404 instead of showing an error page', async () => {
    // `listSeasons` answers 404 for a series Sonarr has never seen, which is an
    // ordinary state for a show reached from /discover or /search.
    client({
      listSeasons: jest.fn().mockRejectedValue(new Error('404 Not Found')),
    })

    await renderPage()

    expect(screen.getByText(SEASONS_EMPTY_NOTE)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Download series' }),
    ).toBeInTheDocument()
  })

  it('degrades rather than fails when the flags cannot be read', async () => {
    client({
      listBadFiles: jest.fn().mockRejectedValue(new Error('boom')),
    })

    await renderPage()

    expect(screen.getByRole('tablist', { name: 'Season' })).toBeInTheDocument()
  })
})

describe('what genuinely reaches the error boundary', () => {
  it('lets a failing getMedia through', async () => {
    client({ getMedia: jest.fn().mockRejectedValue(new Error('backend down')) })

    await expect(renderPage()).rejects.toThrow('backend down')
  })

  it('⚠️ re-throws a framework signal out of the seasons fallback', async () => {
    // `redirect()`/`notFound()`/the static-generation bailout all throw a value
    // carrying a string `digest`. Swallowing one would break `next build`.
    const signal = Object.assign(new Error('BAILOUT'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    })

    client({ listSeasons: jest.fn().mockRejectedValue(signal) })

    await expect(renderPage()).rejects.toThrow('BAILOUT')
  })
})

describe('the rendered page', () => {
  it('lists season 0 alongside the rest', async () => {
    client()

    await renderPage()

    expect(screen.getByRole('tab', { name: /Specials/ })).toBeInTheDocument()
  })

  it('404s a key that somehow resolved to the wrong media type', async () => {
    client({
      getMedia: jest.fn().mockResolvedValue({
        jobs: [],
        media: {
          id: SHOW_ID,
          sourceUrl: 'https://example.test/v',
          title: 'Not a show',
          type: DownloadType.Video,
        },
      }),
    })

    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

describe('the lifecycle actions it wires', () => {
  it('wires an episode row’s Cancel to the show cancel action', async () => {
    client({
      getMedia: jest.fn().mockResolvedValue({
        jobs: [
          scopedJob(
            { episodeId: 2431, seasonNumber: 1 },
            { id: 'job_e2', status: DownloadJobStatus.Downloading },
          ),
        ],
        media: show(),
      }),
    })
    await renderPage()

    const row = document.querySelector('[data-episode-id="2431"]')
    expect(row).toBeInstanceOf(HTMLElement)
    await userEvent.click(
      within(row as HTMLElement).getByRole('button', { name: 'Cancel' }),
    )

    expect(cancelShowJob).toHaveBeenCalledWith('job_e2')
  })

  it('wires Retry on a failed newest attempt to the show retry action', async () => {
    client({
      getMedia: jest.fn().mockResolvedValue({
        jobs: [
          scopedJob(undefined, {
            id: 'job_s',
            status: DownloadJobStatus.Failed,
          }),
        ],
        media: show({ state: 'wanted' }),
      }),
      listSeasons: jest.fn().mockResolvedValue({ seasons: [] }),
    })
    await renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(retryShowJob).toHaveBeenCalledWith('job_s')
  })
})
