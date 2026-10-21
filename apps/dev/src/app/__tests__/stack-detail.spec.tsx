import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import StackDetailPage from 'src/app/stacks/[id]/page'
import type { StackView } from 'src/lib/api'
import { POLL_MS } from 'src/lib/use-overview'

import { FakeEventSource } from './helpers/fake-event-source'
import {
  ago,
  container,
  exempt,
  fromNow,
  operation,
  route,
  runningService,
  service,
  stack,
} from './helpers/fixtures'

const STACK_ID = 'dev:fitness-pwa:docker-compose.yml'
const MINUTE = 60_000
const HOUR = 60 * MINUTE

let mockId = encodeURIComponent(STACK_ID)
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: mockId }),
}))

/** The mockup's fitness-pwa: an api failing its healthcheck, a migrate that exited 0. */
function fitnessPwa(overrides: Partial<StackView> = {}): StackView {
  return stack(
    STACK_ID,
    'fitness-pwa',
    'partial',
    [
      runningService('web', 'fitness-pwa-web-1', {
        routes: [route('flexecute.dev.lilnas.io')],
        loopbackPorts: ['127.0.0.1:8090:8080'],
        container: container('fitness-pwa-web-1', 'running', {
          health: 'healthy',
          image: 'node:24-alpine',
          startedAt: ago(2 * HOUR + 41 * MINUTE),
        }),
        stats: {
          cpuPercent: 0.6,
          memoryBytes: 142 * 1024 ** 2,
          memoryLimitBytes: 0,
        },
        reap: {
          enabled: true,
          maxIdleHours: 2,
          basis: 'auth',
          lastActiveAt: ago(12 * MINUTE),
          activeUsers: 2,
        },
      }),
      runningService('api', 'fitness-pwa-api-1', {
        routes: [route('api-flexecute.dev.lilnas.io', false)],
        loopbackPorts: ['127.0.0.1:8091:8081'],
        container: container('fitness-pwa-api-1', 'running', {
          health: 'unhealthy',
          image: 'node:24-alpine',
          startedAt: ago(2 * HOUR + 41 * MINUTE),
        }),
        stats: {
          cpuPercent: 31.4,
          memoryBytes: 468 * 1024 ** 2,
          memoryLimitBytes: 0,
        },
        reap: {
          enabled: true,
          maxIdleHours: 2,
          basis: 'auth',
          lastActiveAt: ago(12 * MINUTE),
          activeUsers: 0,
          reapsAt: fromNow(HOUR + 48 * MINUTE),
        },
      }),
      service('migrate', 'fitness-pwa-migrate-1', {
        container: container('fitness-pwa-migrate-1', 'exited', {
          image: 'node:24-alpine',
          exitCode: 0,
          startedAt: ago(2 * HOUR + 41 * MINUTE),
          finishedAt: ago(2 * HOUR),
        }),
      }),
      service('crash', 'fitness-pwa-crash-1', {
        container: container('fitness-pwa-crash-1', 'exited', {
          image: 'busybox',
          exitCode: 137,
          finishedAt: ago(5 * MINUTE),
        }),
      }),
    ],
    {
      envFiles: [
        {
          path: '/home/jeremy/dev/fitness-pwa/.env',
          required: true,
          exists: true,
        },
        {
          path: '/home/jeremy/dev/fitness-pwa/.env.local',
          required: false,
          exists: false,
        },
      ],
      ...overrides,
    },
  )
}

type Reply = { status: number; body: unknown }
const json = ({ status, body }: Reply) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response

let current: Reply
let actionReply: Reply
const fetchMock = jest.fn()

beforeEach(() => {
  mockId = encodeURIComponent(STACK_ID)
  FakeEventSource.reset()
  current = { status: 200, body: fitnessPwa() }
  actionReply = { status: 202, body: { operation: operation({ id: 'op-9' }) } }
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? json(actionReply) : json(current),
  )
  global.fetch = fetchMock as unknown as typeof fetch
  global.EventSource = FakeEventSource as unknown as typeof EventSource
})

const gets = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method !== 'POST')

const panel = (name: string) => within(screen.getByRole('region', { name }))

async function renderPage() {
  render(<StackDetailPage />)
  await screen.findByRole('heading', { level: 1, name: 'fitness-pwa' })
}

describe('stack detail page', () => {
  it('fetches the stack by its encoded id', async () => {
    await renderPage()

    expect(gets()[0]?.[0]).toBe(
      '/api/stacks/dev%3Afitness-pwa%3Adocker-compose.yml',
    )
  })

  it('renders the header: name, state, source, routes and the actions', async () => {
    await renderPage()

    const title = screen.getByRole('heading', { level: 1 }).parentElement!
    expect(within(title).getByText('unhealthy')).toBeInTheDocument()
    expect(
      screen.getByText('~/dev/fitness-pwa/docker-compose.yml'),
    ).toBeInTheDocument()
    expect(screen.getByText('project fitness-pwa')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /^flexecute\.dev\.lilnas\.io$/ }),
    ).toHaveAttribute('href', 'https://flexecute.dev.lilnas.io')
    expect(screen.getByText('open')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All stacks' })).toHaveAttribute(
      'href',
      '/',
    )
    for (const name of ['Up', 'Stop', 'Restart', 'Recreate', 'Down']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('renders the services table with every column', async () => {
    await renderPage()
    const table = within(screen.getByRole('table'))

    expect(table.getAllByRole('columnheader').map(h => h.textContent)).toEqual([
      'Container',
      'Image',
      'State',
      'Health',
      'Started',
      'Exit',
      'CPU',
      'Mem',
      'Published',
    ])

    const api = within(table.getByText('fitness-pwa-api-1').closest('tr')!)
    expect(api.getByText('node:24-alpine')).toBeInTheDocument()
    expect(api.getByText('running')).toBeInTheDocument()
    expect(api.getByText('unhealthy')).toBeInTheDocument()
    expect(api.getByText('2h 41m ago')).toBeInTheDocument()
    expect(api.getByText('31.4%')).toBeInTheDocument()
    expect(api.getByText('468 MB')).toBeInTheDocument()
    expect(api.getByText('127.0.0.1:8091:8081')).toBeInTheDocument()

    const migrate = within(
      table.getByText('fitness-pwa-migrate-1').closest('tr')!,
    )
    expect(migrate.getByText('exited')).toBeInTheDocument()
    expect(migrate.getByText('0')).toBeInTheDocument()

    const crash = within(table.getByText('fitness-pwa-crash-1').closest('tr')!)
    expect(crash.getByText('137')).toHaveClass('text-bad')
  })

  it('renders the env files with present and missing marks', async () => {
    await renderPage()
    const env = panel('Env files')

    const required = env.getByText('~/dev/fitness-pwa/.env').closest('li')!
    expect(within(required).getByText('required')).toBeInTheDocument()
    expect(within(required).getByText('present')).toBeInTheDocument()

    const optional = env
      .getByText('~/dev/fitness-pwa/.env.local')
      .closest('li')!
    expect(within(optional).getByText('optional')).toBeInTheDocument()
    expect(within(optional).getByText('missing')).toBeInTheDocument()
    expect(env.getByText('pnpm lilnas secrets decrypt')).toBeInTheDocument()
  })

  it('renders the idle reaper: last active, users, max idle, reaps at, basis', async () => {
    await renderPage()
    const reaper = panel('Idle reaper')

    expect(
      reaper.getByText('stops after 2h without a visit'),
    ).toBeInTheDocument()
    expect(reaper.getByText('12m ago')).toBeInTheDocument()
    expect(
      reaper.getByText('Active users').nextElementSibling,
    ).toHaveTextContent('2 in 2h')
    expect(reaper.getByText('Max idle').nextElementSibling).toHaveTextContent(
      '2h auto-detected',
    )
    // Two users are active, so there is no clock running out.
    expect(reaper.getByText('Reaps at').nextElementSibling).toHaveTextContent(
      'not while users are active',
    )
    expect(
      reaper.getByText(/Latest visit across the stack’s 2 routes/),
    ).toBeInTheDocument()
    expect(
      reaper.getByRole('img', { name: 'Idle for 12m of 2h' }),
    ).toBeInTheDocument()
  })

  it('shows when the reaper will come once nobody is active', async () => {
    const view = fitnessPwa()
    view.services.forEach(s => {
      if (s.reap.activeUsers)
        s.reap = {
          ...s.reap,
          activeUsers: 0,
          reapsAt: fromNow(HOUR + 48 * MINUTE),
        }
    })
    current = { status: 200, body: view }
    await renderPage()

    expect(
      panel('Idle reaper').getByText('Reaps at').nextElementSibling,
    ).toHaveTextContent(/\d\d:\d\d:\d\d in 1h 48m/)
  })

  it('says the reaper is off for an exempt stack', async () => {
    current = {
      status: 200,
      body: stack(STACK_ID, 'hop-road', 'running', [
        runningService('web', 'hop-road-web-1', {
          reap: exempt,
          idleReap: { enabled: false, maxIdleHours: 2, reason: 'label' },
        }),
      ]),
    }
    render(<StackDetailPage />)
    await screen.findByRole('heading', { level: 1, name: 'hop-road' })

    expect(panel('Idle reaper').getByText('off')).toBeInTheDocument()
    expect(
      panel('Idle reaper').getByText(/lilnas\.idle-reap\.enabled=false/),
    ).toBeInTheDocument()
  })

  it('renders the container log viewer for the containers that exist', async () => {
    await renderPage()
    const logs = panel('Container logs')

    const select = logs.getByRole('combobox', { name: 'Container' })
    expect(
      within(select)
        .getAllByRole('option')
        .map(o => o.textContent),
    ).toEqual([
      // Running containers first, then the ones that exited.
      'fitness-pwa-web-1',
      'fitness-pwa-api-1',
      'fitness-pwa-migrate-1',
      'fitness-pwa-crash-1',
    ])
    expect(
      FakeEventSource.latest('/api/containers/fitness-pwa-web-1/logs').url,
    ).toContain('tail=500')
  })

  it('has no operation log until an operation has run', async () => {
    await renderPage()

    expect(
      screen.queryByRole('region', { name: 'Operation log' }),
    ).not.toBeInTheDocument()
  })

  it('follows the operation the stack reports as running', async () => {
    current = {
      status: 200,
      body: fitnessPwa({
        state: 'busy',
        operation: operation({
          id: 'op-3',
          stackId: STACK_ID,
          action: 'restart',
        }),
      }),
    }
    await renderPage()

    expect(
      screen.getByRole('region', { name: 'Operation log' }),
    ).toBeInTheDocument()
    const stream = FakeEventSource.latest('/api/operations/op-3/stream')
    act(() => {
      stream.emit({
        type: 'line',
        line: { stream: 'stderr', text: 'Container x  Restarting', ts: '' },
      })
    })
    expect(
      panel('Operation log').getByText('Container x Restarting'),
    ).toBeInTheDocument()
  })

  it('opens the stream of an operation it just started, even if it ends before the refetch', async () => {
    const user = userEvent.setup()
    await renderPage()

    await user.click(screen.getByRole('button', { name: 'Restart' }))

    await waitFor(() =>
      expect(
        FakeEventSource.matching('/api/operations/op-9/stream'),
      ).toHaveLength(1),
    )
    expect(
      screen.getByRole('region', { name: 'Operation log' }),
    ).toBeInTheDocument()

    // The stack never reported it, and the log is still there when it's done.
    act(() => {
      FakeEventSource.latest('/operations/op-9/stream').emit({
        type: 'done',
        operation: operation({ id: 'op-9', status: 'succeeded', exitCode: 0 }),
      })
    })
    expect(
      panel('Operation log').getByText('exit 0', { selector: 'span' }),
    ).toBeInTheDocument()
  })

  describe('not found', () => {
    it('shows the not-found state linking back to the overview', async () => {
      current = { status: 404, body: { message: 'Unknown stack: x' } }
      render(<StackDetailPage />)

      expect(await screen.findByText('No such stack')).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Back to all stacks' }),
      ).toHaveAttribute('href', '/')
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })
  })

  describe('failures', () => {
    it('shows an error panel with a retry when the first load fails', async () => {
      const user = userEvent.setup()
      current = { status: 500, body: { message: 'docker socket down' } }
      render(<StackDetailPage />)

      expect(
        await screen.findByText('Couldn’t load this stack.'),
      ).toBeInTheDocument()
      expect(screen.getByText('docker socket down')).toBeInTheDocument()

      current = { status: 200, body: fitnessPwa() }
      await user.click(screen.getByRole('button', { name: 'Retry now' }))
      expect(
        await screen.findByRole('heading', { level: 1, name: 'fitness-pwa' }),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('Couldn’t load this stack.'),
      ).not.toBeInTheDocument()
    })

    it('keeps the stale page on screen when a refetch fails', async () => {
      await renderPage()
      const events = FakeEventSource.latest('/api/events')

      current = { status: 500, body: {} }
      act(() => events.emit({ type: 'stacks-changed', stackIds: [STACK_ID] }))

      expect(
        await screen.findByText(/so what’s below may be stale/),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { level: 1, name: 'fitness-pwa' }),
      ).toBeInTheDocument()
    })
  })

  describe('refetching', () => {
    it('refetches on stacks-changed', async () => {
      await renderPage()
      const before = gets().length

      current = { status: 200, body: fitnessPwa({ name: 'renamed' }) }
      act(() => {
        FakeEventSource.latest('/api/events').emit({
          type: 'stacks-changed',
          stackIds: [STACK_ID],
        })
      })

      await screen.findByRole('heading', { level: 1, name: 'renamed' })
      expect(gets().length).toBe(before + 1)
    })

    it('ignores keepalives', async () => {
      await renderPage()
      const before = gets().length

      act(() =>
        FakeEventSource.latest('/api/events').emit({ type: 'keepalive' }),
      )
      await act(async () => {})

      expect(gets()).toHaveLength(before)
    })

    it('refetches every 10 s while the tab is visible', async () => {
      jest.useFakeTimers()
      try {
        render(<StackDetailPage />)
        await act(async () => {})
        expect(gets()).toHaveLength(1)

        await act(async () => {
          jest.advanceTimersByTime(POLL_MS)
        })
        expect(gets()).toHaveLength(2)
      } finally {
        jest.useRealTimers()
      }
    })
  })
})
