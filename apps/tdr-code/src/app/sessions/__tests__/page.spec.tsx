import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from 'src/app/lib/api'
import SessionsPage from 'src/app/sessions/page'
import type {
  SessionListItemDto,
  SessionListResponseDto,
} from 'src/console/sessions.dto'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

function session(patch: Partial<SessionListItemDto> = {}): SessionListItemDto {
  return {
    id: 4826,
    channelId: '1184726493302157312',
    channelName: '#ops-agent',
    triggeringUserId: '111111111111111111',
    triggeringUserDisplayName: 'Jeremy',
    createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    endedAt: null,
    endReason: null,
    ...patch,
  }
}

const PAGE_ONE: SessionListResponseDto = {
  items: [
    session(),
    session({
      id: 4825,
      channelName: '#homelab',
      triggeringUserDisplayName: 'Sam',
      endedAt: new Date(Date.now() - 38 * 60_000).toISOString(),
      endReason: 'evicted',
    }),
  ],
  nextCursor: 4825,
}

const PAGE_TWO: SessionListResponseDto = {
  items: [session({ id: 4824, channelName: '#scratch' })],
  nextCursor: null,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionsPage />
    </QueryClientProvider>,
  )
}

let listSessions: jest.SpiedFunction<typeof api.listSessions>

beforeEach(() => {
  mockPush.mockReset()
  listSessions = jest.spyOn(api, 'listSessions').mockResolvedValue(PAGE_ONE)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('SessionsPage — rows', () => {
  it('lists sessions with mono #id links, an Active badge and the end reason', async () => {
    renderPage()

    const [link] = await screen.findAllByRole('link', { name: '#4826' })
    expect(link).toHaveAttribute('href', '/sessions/4826')
    expect(link).toHaveClass('text-accent-hi')
    expect(screen.getAllByText('Active')).not.toHaveLength(0)
    expect(screen.getAllByText('evicted')).not.toHaveLength(0)
    expect(listSessions).toHaveBeenCalledWith({
      channel: undefined,
      cursor: undefined,
      limit: 25,
    })
  })

  it('opens the session when a row is clicked', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click((await screen.findAllByText('Sam'))[0])

    expect(mockPush).toHaveBeenCalledWith('/sessions/4825')
  })
})

describe('SessionsPage — channel filter', () => {
  it('queries by the trimmed channel and offers Clear only once something is typed', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByRole('link', { name: '#4826' })
    expect(
      screen.queryByRole('button', { name: 'Clear' }),
    ).not.toBeInTheDocument()

    await user.type(
      screen.getByRole('textbox', { name: 'Filter by channel ID' }),
      ' 1184726493302157312 ',
    )

    await waitFor(() =>
      expect(listSessions).toHaveBeenLastCalledWith({
        channel: '1184726493302157312',
        cursor: undefined,
        limit: 25,
      }),
    )
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('Clear empties the filter and goes back to every session', async () => {
    const user = userEvent.setup()
    renderPage()

    const input = screen.getByRole('textbox', { name: 'Filter by channel ID' })
    await user.type(input, '1184726493302157312')
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(input).toHaveValue('')
    await waitFor(() =>
      expect(listSessions).toHaveBeenLastCalledWith({
        channel: undefined,
        cursor: undefined,
        limit: 25,
      }),
    )
  })

  it('says nothing ran in that channel, with a Clear filter action', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    await screen.findByText('No sessions yet')
    await user.type(
      screen.getByRole('textbox', { name: 'Filter by channel ID' }),
      '1184726493302157399',
    )

    expect(
      await screen.findByText('No sessions in that channel'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(
      screen.getByRole('textbox', { name: 'Filter by channel ID' }),
    ).toHaveValue('')
  })
})

describe('SessionsPage — load more and states', () => {
  it('fetches the next page with the cursor and drops the button on the last one', async () => {
    const user = userEvent.setup()
    listSessions.mockImplementation(async params =>
      params?.cursor === 4825 ? PAGE_TWO : PAGE_ONE,
    )
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(listSessions).toHaveBeenLastCalledWith({
        channel: undefined,
        cursor: 4825,
        limit: 25,
      }),
    )
    expect(
      (await screen.findAllByRole('link', { name: '#4824' })).length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument()
  })

  it('shows the empty state when no session has run', async () => {
    listSessions.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    expect(await screen.findByText('No sessions yet')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument()
  })

  it('shows the error when the list fails to load', async () => {
    listSessions.mockRejectedValue(new Error('HTTP 502'))
    renderPage()

    expect(
      await screen.findByText("Couldn't load sessions."),
    ).toBeInTheDocument()
  })
})
