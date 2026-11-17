import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import EventsPage from 'src/app/events/page'
import { api } from 'src/app/lib/api'
import type { EventItemDto, EventListResponseDto } from 'src/console/events.dto'

function event(patch: Partial<EventItemDto> = {}): EventItemDto {
  return {
    id: 1,
    type: 'turn_started',
    level: 'info',
    channelId: '1184726493302157312',
    channelName: '#ops-agent',
    sessionId: 4826,
    context: {},
    createdAt: new Date(Date.now() - 12_000).toISOString(),
    ...patch,
  }
}

const FEED: EventListResponseDto = {
  items: [
    event(),
    event({ id: 2, type: 'turn_errored', level: 'error', sessionId: 4824 }),
    event({
      id: 3,
      type: 'bot_restart',
      level: 'warn',
      channelId: null,
      channelName: null,
      sessionId: null,
    }),
  ],
  nextCursor: 3,
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <EventsPage />
    </QueryClientProvider>,
  )
}

let listEvents: jest.SpiedFunction<typeof api.listEvents>

beforeEach(() => {
  listEvents = jest.spyOn(api, 'listEvents').mockResolvedValue(FEED)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('EventsPage — rows', () => {
  it('lists events with level badges, mono type and session links, and dashes for a bot-wide event', async () => {
    renderPage()

    expect((await screen.findAllByText('turn_started')).length).toBeGreaterThan(
      0,
    )
    expect(screen.getAllByText('Info')).not.toHaveLength(0)
    expect(screen.getAllByText('Warn')).not.toHaveLength(0)
    expect(screen.getAllByText('Error')).not.toHaveLength(0)
    expect(screen.getAllByRole('link', { name: '#4824' })[0]).toHaveAttribute(
      'href',
      '/sessions/4824',
    )
    // bot_restart has no channel or session: both cells are a dash
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(listEvents).toHaveBeenCalledWith({
      type: undefined,
      level: undefined,
      channel: undefined,
      cursor: undefined,
      limit: 50,
    })
  })
})

describe('EventsPage — filters', () => {
  it('filters by type from the select and offers Clear filters', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('turn_started')
    expect(
      screen.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Event type' }))
    await user.click(
      await screen.findByRole('option', { name: 'turn_errored' }),
    )

    await waitFor(() =>
      expect(listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'turn_errored' }),
      ),
    )
    expect(
      screen.getByRole('button', { name: 'Clear filters' }),
    ).toBeInTheDocument()
  })

  it('filters by level from the select', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('turn_started')
    await user.click(screen.getByRole('combobox', { name: 'Event level' }))
    await user.click(await screen.findByRole('option', { name: 'warn' }))

    await waitFor(() =>
      expect(listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: 'warn' }),
      ),
    )
  })

  it('filters by the trimmed channel ID', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('turn_started')
    await user.type(
      screen.getByRole('textbox', { name: 'Channel ID' }),
      ' 1184726493302157312 ',
    )

    await waitFor(() =>
      expect(listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ channel: '1184726493302157312' }),
      ),
    )
  })

  it('Clear filters resets all three', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('turn_started')
    await user.click(screen.getByRole('combobox', { name: 'Event level' }))
    await user.click(await screen.findByRole('option', { name: 'error' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Channel ID' }),
      '1184726493302157312',
    )
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(screen.getByRole('textbox', { name: 'Channel ID' })).toHaveValue('')
    expect(
      screen.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(listEvents).toHaveBeenLastCalledWith({
        type: undefined,
        level: undefined,
        channel: undefined,
        cursor: undefined,
        limit: 50,
      }),
    )
  })
})

describe('EventsPage — empty, load more and error', () => {
  it('says no events yet when the feed is empty and unfiltered', async () => {
    listEvents.mockResolvedValue({ items: [], nextCursor: null })
    renderPage()

    expect(await screen.findByText('No events yet')).toBeInTheDocument()
  })

  it('says no events match when a filter hides everything, and Clear filters recovers', async () => {
    const user = userEvent.setup()
    listEvents.mockImplementation(async params =>
      params?.level ? { items: [], nextCursor: null } : FEED,
    )
    renderPage()

    await screen.findAllByText('turn_started')
    await user.click(screen.getByRole('combobox', { name: 'Event level' }))
    await user.click(await screen.findByRole('option', { name: 'error' }))

    expect(await screen.findByText('No events match')).toBeInTheDocument()
    await user.click(
      screen.getAllByRole('button', { name: 'Clear filters' })[1],
    )
    expect((await screen.findAllByText('turn_started')).length).toBeGreaterThan(
      0,
    )
  })

  it('loads the next page with the cursor', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(listEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 3 }),
      ),
    )
  })

  it('shows the error when the feed fails to load', async () => {
    listEvents.mockRejectedValue(new Error('HTTP 502'))
    renderPage()

    expect(await screen.findByText("Couldn't load events.")).toBeInTheDocument()
  })
})
