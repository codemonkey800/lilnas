import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api, queryKeys } from 'src/app/lib/api'
import DashboardPage from 'src/app/page'
import type { LiveChannelItemDto, LiveResponseDto } from 'src/console/live.dto'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockUseLiveStream = jest.fn()
jest.mock('src/app/lib/use-live-stream', () => ({
  useLiveStream: (...args: unknown[]) => mockUseLiveStream(...args),
}))

function item(patch: Partial<LiveChannelItemDto> = {}): LiveChannelItemDto {
  return {
    channelId: '1184726493302157312',
    channelName: '#ops-agent',
    triggeringUserId: '111111111111111111',
    triggeringUserDisplayName: 'Jeremy',
    state: 'working',
    queueDepth: 2,
    lastActivityAt: new Date(Date.now() - 12_000).toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    ...patch,
  }
}

const TWO_CHANNELS: LiveResponseDto = {
  botOffline: false,
  globalStatus: 'online',
  items: [
    item(),
    item({
      channelId: '1184726493302157399',
      channelName: '#homelab',
      triggeringUserDisplayName: 'Sam',
      state: 'stale',
      queueDepth: 0,
    }),
  ],
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <DashboardPage />
      </QueryClientProvider>,
    ),
  }
}

// DataList draws both a table and a card list (CSS shows one), so each row's
// controls appear twice in the DOM; the first is the table's.
function first(role: 'button' | 'link', name: string): HTMLElement {
  return screen.getAllByRole(role, { name })[0]
}

beforeEach(() => {
  mockPush.mockReset()
  mockUseLiveStream.mockReset()
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ status: 'online' }),
  })
  jest.spyOn(api, 'getLive').mockResolvedValue(TWO_CHANNELS)
  jest.spyOn(api, 'restart').mockResolvedValue({ ok: true } as never)
  jest.spyOn(api, 'teardown').mockResolvedValue({ ok: true } as never)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('DashboardPage — rows', () => {
  it('subscribes to the live topic and lists one row per channel with a state badge', async () => {
    renderPage()

    expect(await screen.findAllByText('#ops-agent')).not.toHaveLength(0)
    expect(mockUseLiveStream).toHaveBeenCalledWith(['live'])
    expect(screen.getAllByText('#homelab')).not.toHaveLength(0)
    expect(screen.getAllByText('Working')).not.toHaveLength(0)
    expect(screen.getAllByText('Stale')).not.toHaveLength(0)
    expect(screen.getAllByText('Jeremy')).not.toHaveLength(0)
    expect(screen.getAllByText('Sam')).not.toHaveLength(0)
  })

  it('opens the channel in the sessions list when a row is clicked', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('#ops-agent')
    await user.click(screen.getAllByText('Jeremy')[0])

    expect(mockPush).toHaveBeenCalledWith(
      '/sessions?channel=1184726493302157312',
    )
  })

  it('does not navigate the row when Tear down is pressed', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('#ops-agent')
    await user.click(first('button', 'Tear down'))

    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('DashboardPage — bot offline and empties', () => {
  it('shows the offline note above the last-known rows', async () => {
    jest.spyOn(api, 'getLive').mockResolvedValue({
      ...TWO_CHANNELS,
      botOffline: true,
      globalStatus: 'offline',
      items: [item({ state: 'last-known' })],
    })
    renderPage()

    expect(await screen.findByText('Bot is offline.')).toBeInTheDocument()
    expect(screen.getByText(/Showing the last-known state/)).toBeInTheDocument()
    expect(screen.getAllByText('Last known')).not.toHaveLength(0)
  })

  it('says the bot has never run', async () => {
    jest.spyOn(api, 'getLive').mockResolvedValue({
      botOffline: false,
      globalStatus: 'never-seen',
      items: [],
    })
    renderPage()

    expect(await screen.findByText('Bot has never run')).toBeInTheDocument()
  })

  it('says there are no active sessions while the bot is up', async () => {
    jest.spyOn(api, 'getLive').mockResolvedValue({
      botOffline: false,
      globalStatus: 'online',
      items: [],
    })
    renderPage()

    expect(await screen.findByText('No active sessions')).toBeInTheDocument()
    expect(screen.queryByText('Bot is offline.')).not.toBeInTheDocument()
  })

  it('says there is no last-known activity when offline and empty', async () => {
    jest.spyOn(api, 'getLive').mockResolvedValue({
      botOffline: true,
      globalStatus: 'offline',
      items: [],
    })
    renderPage()

    expect(
      await screen.findByText('No last-known activity'),
    ).toBeInTheDocument()
    expect(screen.getByText('Bot is offline.')).toBeInTheDocument()
  })

  it('shows an error when the live list fails to load', async () => {
    jest.spyOn(api, 'getLive').mockRejectedValue(new Error('HTTP 502'))
    renderPage()

    expect(
      await screen.findByText("Couldn't load active sessions."),
    ).toBeInTheDocument()
    expect(screen.getByText(/HTTP 502/)).toBeInTheDocument()
  })
})

describe('DashboardPage — restart bot', () => {
  it('confirms in place, then restarts once and refreshes the live data', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderPage()
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries')

    await screen.findAllByText('#ops-agent')
    await user.click(screen.getByRole('button', { name: 'Restart bot' }))

    expect(screen.getByText('Restarts all channels')).toBeInTheDocument()
    expect(api.restart).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm restart' }))

    await waitFor(() => expect(api.restart).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.live }),
    )
    expect(
      await screen.findByRole('button', { name: 'Restart bot' }),
    ).toBeInTheDocument()
  })

  it('cancels without restarting', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('#ops-agent')
    await user.click(screen.getByRole('button', { name: 'Restart bot' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(api.restart).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Restart bot' }),
    ).toBeInTheDocument()
  })

  it('shows the error under the button when the restart fails', async () => {
    const user = userEvent.setup()
    jest.spyOn(api, 'restart').mockRejectedValue(new Error('supervisor down'))
    renderPage()

    await screen.findAllByText('#ops-agent')
    await user.click(screen.getByRole('button', { name: 'Restart bot' }))
    await user.click(screen.getByRole('button', { name: 'Confirm restart' }))

    expect(await screen.findByText('supervisor down')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Restart bot' }),
    ).toBeInTheDocument()
  })
})

describe('DashboardPage — tear down', () => {
  it('asks "Kill active session?" and tears the channel down on Confirm', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('#ops-agent')
    await user.click(first('button', 'Tear down'))

    expect(screen.getAllByText('Kill active session?')).toHaveLength(1)
    expect(api.teardown).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() =>
      expect(api.teardown).toHaveBeenCalledWith('1184726493302157312'),
    )
  })

  it('cancels without tearing down', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('#ops-agent')
    await user.click(first('button', 'Tear down'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(api.teardown).not.toHaveBeenCalled()
  })

  it('brings the row back with the failure message when the teardown fails', async () => {
    const user = userEvent.setup()
    jest.spyOn(api, 'teardown').mockRejectedValue(new Error('bot unreachable'))
    renderPage()

    await screen.findAllByText('#ops-agent')
    await user.click(first('button', 'Tear down'))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    const messages = await screen.findAllByText('bot unreachable')
    expect(messages.length).toBeGreaterThan(0)
    const row = messages[0].closest('tr')!
    expect(within(row).getByText('#ops-agent')).toBeInTheDocument()
    expect(api.getLive).toHaveBeenCalledTimes(2)
  })
})
