import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import HomePage from 'src/app/page'
import type { Overview } from 'src/lib/api'
import { POLL_MS } from 'src/lib/use-overview'

import {
  container,
  IDS,
  operation,
  overview,
  runningService,
  sampleOverview,
  service,
  stack,
} from './helpers/fixtures'

/** Just enough of EventSource for the page: the tests drive it by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = []

  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  close = jest.fn()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

type Reply = { status: number; body: unknown }

const json = ({ status, body }: Reply) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response

let current: Overview
let actionReply: Reply
const fetchMock = jest.fn()

beforeEach(() => {
  FakeEventSource.instances = []
  current = sampleOverview()
  actionReply = { status: 202, body: { operation: operation() } }
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? json(actionReply)
      : json({ status: 200, body: current }),
  )
  global.fetch = fetchMock as unknown as typeof fetch
  global.EventSource = FakeEventSource as unknown as typeof EventSource
})

/** The page's one event stream. */
function stream(): FakeEventSource {
  const [first] = FakeEventSource.instances
  if (!first) throw new Error('the page never opened an event stream')
  return first
}

const gets = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST')
const posts = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')

async function renderPage() {
  render(<HomePage />)
  await screen.findByRole('heading', { name: 'download' })
}

const cardOf = (name: string) => {
  const card = screen.getByRole('heading', { name }).closest('article')
  if (!card) throw new Error(`no card for ${name}`)
  return within(card)
}

describe('overview page', () => {
  it('loads /api/stacks and opens the event stream', async () => {
    await renderPage()

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/stacks')
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(stream().url).toBe('/api/events')
  })

  it('groups the cards into lilnas apps and ~/dev projects', async () => {
    await renderPage()

    const apps = within(screen.getByRole('region', { name: 'lilnas apps' }))
    const projects = within(
      screen.getByRole('region', { name: '~/dev projects' }),
    )
    expect(apps.getAllByRole('heading', { level: 3 })).toHaveLength(2)
    expect(projects.getAllByRole('heading', { level: 3 })).toHaveLength(6)
    expect(apps.getByText('apps/download/deploy.dev.yml')).toBeInTheDocument()
    expect(
      projects.getByText('~/dev/fitness-pwa/docker-compose.yml'),
    ).toBeInTheDocument()
  })

  it('shows the host strip', async () => {
    await renderPage()

    expect(screen.getByText('running containers')).toBeInTheDocument()
    expect(screen.getByText('2.4 GB')).toBeInTheDocument()
    expect(screen.getByText('2h idle')).toBeInTheDocument()
    expect(screen.getByText(/updated \d+s ago/)).toBeInTheDocument()
  })

  describe('states', () => {
    it('running: a live chip, the container numbers and the reap time', async () => {
      await renderPage()

      const card = cardOf('download')
      expect(
        card.getByText('running', { selector: 'span' }),
      ).toBeInTheDocument()
      expect(card.getByText('lilnas-download-dev')).toBeInTheDocument()
      expect(card.getByText('healthy')).toBeInTheDocument()
      expect(card.getByText('up 3h 12m')).toBeInTheDocument()
      expect(card.getByText('cpu 4.2%')).toBeInTheDocument()
      expect(card.getByText('mem 612 MB')).toBeInTheDocument()
      expect(card.getByText('reaps in 1h 20m')).toBeInTheDocument()
      expect(card.getByRole('button', { name: 'Up' })).toBeDisabled()
      expect(card.getByRole('button', { name: 'Stop' })).toBeEnabled()
      expect(card.getByRole('button', { name: 'Down' })).toBeEnabled()
    })

    it('unhealthy: the failing container is called out, a clean exit is not', async () => {
      await renderPage()

      const card = cardOf('fitness-pwa')
      // Once on the chip, once as the container's verdict.
      expect(card.getAllByText('unhealthy')).toHaveLength(2)
      expect(
        card.getByText('fitness-pwa-api-1 is failing its healthcheck.'),
      ).toBeInTheDocument()
      expect(card.getByText('exited (0)')).toBeInTheDocument()
      expect(card.getByRole('button', { name: 'Stop' })).toBeEnabled()
    })

    it('exited: the exit code and when, with Up enabled and Stop not', async () => {
      await renderPage()

      const card = cardOf('test-landing-page')
      expect(card.getByText('exited', { selector: 'span' })).toBeInTheDocument()
      expect(card.getByText('exited (1)')).toBeInTheDocument()
      expect(
        card.getByText(/test-landing-page-web-1 exited with code 1, 14m ago\./),
      ).toBeInTheDocument()
      expect(card.getByRole('button', { name: 'Up' })).toBeEnabled()
      expect(card.getByRole('button', { name: 'Stop' })).toBeDisabled()
    })

    it('absent: only Up is available', async () => {
      await renderPage()

      const card = cardOf('GoonCut')
      expect(card.getByText('absent')).toBeInTheDocument()
      expect(card.getByText('no container')).toBeInTheDocument()
      expect(card.getByText('No containers.')).toBeInTheDocument()
      expect(card.getByRole('button', { name: 'Up' })).toBeEnabled()
      for (const name of ['Stop', 'Restart', 'Recreate', 'Down']) {
        expect(card.getByRole('button', { name })).toBeDisabled()
      }
    })

    it('busy: the operation and its last line, with every action off', async () => {
      await renderPage()

      const card = cardOf('blabla')
      expect(card.getByText('busy')).toBeInTheDocument()
      expect(card.getByText(/^up · \d+s$/)).toBeInTheDocument()
      expect(
        card.getByText(/Container blabla-web-1\s+Starting/),
      ).toBeInTheDocument()
      for (const button of card.getAllByRole('button')) {
        expect(button).toBeDisabled()
      }
    })

    it('env missing: names the file and the decrypt hint, with every action off', async () => {
      await renderPage()

      const card = cardOf('tdr-bot')
      expect(card.getByText('env missing')).toBeInTheDocument()
      expect(
        card.getByText('apps/tdr-bot/.env.prod.decrypted'),
      ).toBeInTheDocument()
      expect(card.getByText(/can’t start/)).toBeInTheDocument()
      expect(card.getByText('pnpm lilnas secrets decrypt')).toBeInTheDocument()
      for (const button of card.getAllByRole('button')) {
        expect(button).toBeDisabled()
      }
    })

    it('env missing on a partial stack: Stop and Down still work, Up does not', async () => {
      current = overview([
        stack(
          IDS.envMissing,
          'tdr-bot',
          'partial',
          [
            runningService('tdr-bot-dev', 'lilnas-tdr-bot-dev'),
            service('worker', 'lilnas-tdr-bot-worker', {
              container: container('lilnas-tdr-bot-worker', 'exited', {
                exitCode: 1,
              }),
            }),
          ],
          {
            envFiles: [
              {
                path: '/home/jeremy/lilnas/apps/tdr-bot/.env.prod.decrypted',
                required: true,
                exists: false,
              },
            ],
          },
        ),
      ])
      render(<HomePage />)
      await screen.findByRole('heading', { name: 'tdr-bot' })

      const card = cardOf('tdr-bot')
      expect(card.getByText('env missing')).toBeInTheDocument()
      expect(card.getByRole('button', { name: 'Stop' })).toBeEnabled()
      expect(card.getByRole('button', { name: 'Down' })).toBeEnabled()
      for (const name of ['Up', 'Restart', 'Recreate']) {
        expect(card.getByRole('button', { name })).toBeDisabled()
      }
    })

    it('two routes: both are links, a gated one with a lock and an open one with a warning', async () => {
      await renderPage()

      const card = cardOf('fitness-pwa')
      expect(
        card.getByRole('link', { name: 'flexecute.dev.lilnas.io' }),
      ).toHaveAttribute('href', 'https://flexecute.dev.lilnas.io')
      expect(
        card.getByRole('link', { name: 'api-flexecute.dev.lilnas.io' }),
      ).toHaveAttribute('href', 'https://api-flexecute.dev.lilnas.io')
      expect(card.getByText('Gated by lilnas-auth')).toBeInTheDocument()
      expect(card.getByText('open')).toBeInTheDocument()
    })

    it('reap text: exempt, kept by users and unknown', async () => {
      await renderPage()

      expect(cardOf('hop-road').getByText('exempt')).toBeInTheDocument()
      expect(
        cardOf('url-shortener').getByText('kept: 1 active user'),
      ).toBeInTheDocument()
      expect(cardOf('fitness-pwa').getByText('unknown')).toBeInTheDocument()
    })
  })

  describe('actions', () => {
    it('Up posts to the stack’s action URL and reloads', async () => {
      const user = userEvent.setup()
      await renderPage()
      const before = gets().length

      await user.click(cardOf('GoonCut').getByRole('button', { name: 'Up' }))

      await waitFor(() => expect(posts()).toHaveLength(1))
      expect(posts()[0][0]).toBe(
        `/api/stacks/${encodeURIComponent(IDS.absent)}/actions/up`,
      )
      expect(posts()[0][1]).toEqual({ method: 'POST' })
      await waitFor(() => expect(gets().length).toBeGreaterThan(before))
    })

    it('Stop and Restart post straight away', async () => {
      const user = userEvent.setup()
      await renderPage()

      await user.click(cardOf('download').getByRole('button', { name: 'Stop' }))
      await user.click(
        cardOf('download').getByRole('button', { name: 'Restart' }),
      )

      await waitFor(() => expect(posts()).toHaveLength(2))
      expect(posts().map(([url]) => url)).toEqual([
        '/api/stacks/lilnas%3Adownload/actions/stop',
        '/api/stacks/lilnas%3Adownload/actions/restart',
      ])
    })

    it('Down asks first, and Keep it posts nothing', async () => {
      const user = userEvent.setup()
      await renderPage()
      const card = cardOf('download')

      await user.click(card.getByRole('button', { name: 'Down' }))
      expect(
        card.getByText(/Down removes the containers and networks of download/),
      ).toBeInTheDocument()
      expect(posts()).toHaveLength(0)

      await user.click(card.getByRole('button', { name: 'Keep it' }))
      expect(card.queryByRole('button', { name: 'Keep it' })).toBeNull()
      expect(posts()).toHaveLength(0)
    })

    it('Down posts once confirmed', async () => {
      const user = userEvent.setup()
      await renderPage()
      const card = cardOf('download')

      await user.click(card.getByRole('button', { name: 'Down' }))
      await user.click(card.getByRole('button', { name: 'Down download' }))

      await waitFor(() => expect(posts()).toHaveLength(1))
      expect(posts()[0][0]).toBe('/api/stacks/lilnas%3Adownload/actions/down')
    })

    it('Recreate asks first too', async () => {
      const user = userEvent.setup()
      await renderPage()
      const card = cardOf('download')

      await user.click(card.getByRole('button', { name: 'Recreate' }))
      expect(posts()).toHaveLength(0)
      await user.click(card.getByRole('button', { name: 'Recreate download' }))

      await waitFor(() => expect(posts()).toHaveLength(1))
      expect(posts()[0][0]).toBe(
        '/api/stacks/lilnas%3Adownload/actions/recreate',
      )
    })

    it('a 412 lists the missing files and the decrypt hint', async () => {
      actionReply = {
        status: 412,
        body: {
          missing: [
            '/home/jeremy/lilnas/apps/tdr-bot/.env.prod.decrypted',
            '/home/jeremy/dev/gooncut/.env',
          ],
        },
      }
      const user = userEvent.setup()
      await renderPage()
      const card = cardOf('GoonCut')

      await user.click(card.getByRole('button', { name: 'Up' }))

      expect(
        await card.findByText(/Up can’t start GoonCut/),
      ).toBeInTheDocument()
      expect(
        card.getByText('apps/tdr-bot/.env.prod.decrypted'),
      ).toBeInTheDocument()
      expect(card.getByText('~/dev/gooncut/.env')).toBeInTheDocument()
      expect(card.getByText('pnpm lilnas secrets decrypt')).toBeInTheDocument()
      expect(card.getByText(/then press Up again/)).toBeInTheDocument()
    })

    it('a 409 says which operation owns the stack', async () => {
      actionReply = {
        status: 409,
        body: { operation: operation({ action: 'restart' }) },
      }
      const user = userEvent.setup()
      await renderPage()
      const card = cardOf('GoonCut')

      await user.click(card.getByRole('button', { name: 'Up' }))

      expect(
        await card.findByText('Restart is still running on GoonCut.'),
      ).toBeInTheDocument()
    })

    it('any other failure shows the status and message', async () => {
      actionReply = {
        status: 500,
        body: { statusCode: 500, message: 'compose exploded' },
      }
      const user = userEvent.setup()
      await renderPage()
      const card = cardOf('GoonCut')

      await user.click(card.getByRole('button', { name: 'Up' }))

      expect(
        await card.findByText('Up didn’t start on GoonCut.'),
      ).toBeInTheDocument()
      expect(card.getByText('500 compose exploded')).toBeInTheDocument()
    })
  })

  describe('live updates', () => {
    it('refetches on stacks-changed and shows the new state', async () => {
      await renderPage()
      expect(gets()).toHaveLength(1)

      current = overview([
        stack(IDS.absent, 'GoonCut', 'absent', [], {
          source: 'dev',
        }),
      ])
      act(() => {
        stream().emit({
          type: 'stacks-changed',
          stackIds: [IDS.absent],
        })
      })

      await waitFor(() => expect(gets()).toHaveLength(2))
      await waitFor(() =>
        expect(
          screen.queryByRole('heading', { name: 'download' }),
        ).not.toBeInTheDocument(),
      )
      expect(
        screen.getByRole('heading', { name: 'GoonCut' }),
      ).toBeInTheDocument()
    })

    it('ignores keepalives', async () => {
      await renderPage()

      act(() => stream().emit({ type: 'keepalive' }))
      act(() => {
        stream().onmessage?.({ data: 'not json' })
      })

      expect(gets()).toHaveLength(1)
    })

    it('closes the event stream on unmount', async () => {
      const { unmount } = render(<HomePage />)
      await screen.findByRole('heading', { name: 'download' })

      unmount()

      expect(stream().close).toHaveBeenCalled()
    })

    it('polls every 10 s while visible, and not while hidden', async () => {
      jest.useFakeTimers()
      try {
        render(<HomePage />)
        await act(async () => {})
        expect(gets()).toHaveLength(1)

        await act(async () => {
          jest.advanceTimersByTime(POLL_MS)
        })
        expect(gets()).toHaveLength(2)

        const visibility = jest
          .spyOn(document, 'visibilityState', 'get')
          .mockReturnValue('hidden')
        await act(async () => {
          jest.advanceTimersByTime(POLL_MS * 2)
        })
        expect(gets()).toHaveLength(2)

        visibility.mockReturnValue('visible')
        await act(async () => {
          document.dispatchEvent(new Event('visibilitychange'))
        })
        expect(gets()).toHaveLength(3)
      } finally {
        jest.useRealTimers()
      }
    })
  })

  describe('empty and error', () => {
    it('shows an empty state when nothing is discovered', async () => {
      current = overview([])
      render(<HomePage />)

      expect(await screen.findByText('No dev stacks yet')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Refresh' }),
      ).toBeInTheDocument()
    })

    it('shows the failure and retries on request', async () => {
      const user = userEvent.setup()
      fetchMock.mockImplementationOnce(async () =>
        json({
          status: 502,
          body: { message: 'ECONNREFUSED /var/run/docker.sock' },
        }),
      )
      render(<HomePage />)

      expect(
        await screen.findByText('Couldn’t load the stack list.'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('ECONNREFUSED /var/run/docker.sock'),
      ).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Retry now' }))

      expect(
        await screen.findByRole('heading', { name: 'download' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('Couldn’t load the stack list.'),
      ).not.toBeInTheDocument()
    })
  })
})
