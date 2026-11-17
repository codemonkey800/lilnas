import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { TranscriptChannel, TranscriptResponse } from 'src/api/api.types'
import TranscriptPage from 'src/app/transcript/page'
import type { LlmCallRow } from 'src/db/schema'

const mockGetChannels = jest.fn()
const mockGetTranscript = jest.fn()
const mockGetEmojis = jest.fn()

// The ApiClient is the boundary: the react-query hooks are real, the network
// is not. The delegating arrows keep the mocks out of the module-eval TDZ.
jest.mock('src/api/api.client', () => ({
  ...jest.requireActual('src/api/api.client'),
  ApiClient: class {
    getTranscriptChannels = () => mockGetChannels()
    getTranscript = (channelId: string, page: unknown) =>
      mockGetTranscript(channelId, page)
    getEmojis = () => mockGetEmojis()
  },
}))

const CHANNELS: TranscriptChannel[] = [
  {
    channelId: 'c1',
    name: 'general',
    lastAt: '2026-10-24T09:12:00.000Z',
    calls: 1204,
  },
  {
    channelId: 'c2',
    name: 'bot-testing',
    lastAt: '2026-10-23T18:40:00.000Z',
    calls: 38,
  },
]

const call = (id: string, over: Partial<LlmCallRow> = {}): LlmCallRow => ({
  id,
  requestId: 'r1',
  channelId: 'c1',
  userId: null,
  skill: null,
  operation: 'chat',
  model: 'gpt-4.1-mini',
  role: null,
  status: 'ok',
  inputTokens: 1842,
  outputTokens: 96,
  cachedTokens: 1536,
  costUsd: '0.000880',
  durationMs: 1120,
  retries: 0,
  finishReason: 'stop',
  promptHash: null,
  prompt: null,
  output: null,
  createdAt: new Date('2026-10-24T09:12:00.000Z'),
  ...over,
})

const PAGE: TranscriptResponse = {
  messages: [
    { type: 'human', name: 'Mika', content: 'What’s the weather in Lisbon?' },
    {
      type: 'ai',
      content: 'Looks sunny: highs around 24°C.',
      requestId: 'r1',
      toolCalls: [{ name: 'web_search', args: { query: 'weather Lisbon' } }],
    },
  ],
  calls: [call('k1'), call('k2', { costUsd: '0.001310' })],
  totals: { costUsd: 0.4231, inputTokens: 1_240_000, outputTokens: 86_500 },
  nextCursor: null,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TranscriptPage />
    </QueryClientProvider>,
  )
}

const dateRange = () => {
  const now = Date.now()
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { from: day(now - 6 * 86_400_000), to: day(now) }
}

describe('TranscriptPage', () => {
  beforeEach(() => {
    mockGetChannels.mockResolvedValue(CHANNELS)
    mockGetTranscript.mockResolvedValue(PAGE)
    mockGetEmojis.mockResolvedValue({
      emojis: [],
      reconcile: { running: false },
    })
  })

  it('shows skeletons while the channels load', () => {
    mockGetChannels.mockReturnValue(new Promise(() => undefined))
    renderPage()

    expect(screen.getByTestId('transcript-loading')).toBeInTheDocument()
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument()
  })

  it('lists the channels and opens the first thread', async () => {
    renderPage()

    expect(
      await screen.findByText('Looks sunny: highs around 24°C.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('What’s the weather in Lisbon?'),
    ).toBeInTheDocument()
    expect(screen.getByText('Mika')).toBeInTheDocument()
    expect(screen.getByText('web_search')).toBeInTheDocument()
    expect(mockGetTranscript).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining(dateRange()),
    )

    // Phone scroller and desktop sidebar both list the channels.
    const pills = within(screen.getByRole('navigation', { name: 'Channels' }))
    expect(pills.getByRole('button', { name: /# general/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      pills.getByRole('button', { name: /# bot-testing/ }),
    ).toHaveAttribute('aria-pressed', 'false')
    const sidebar = within(
      screen.getByRole('complementary', { name: 'Channels' }),
    )
    expect(sidebar.getByText('1,204 calls')).toBeInTheDocument()
  })

  it('switches channel from either list', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Looks sunny: highs around 24°C.')

    const sidebar = within(
      screen.getByRole('complementary', { name: 'Channels' }),
    )
    await user.click(sidebar.getByRole('button', { name: /# bot-testing/ }))

    await waitFor(() =>
      expect(mockGetTranscript).toHaveBeenCalledWith(
        'c2',
        expect.objectContaining(dateRange()),
      ),
    )
    expect(
      sidebar.getByRole('button', { name: /# bot-testing/ }),
    ).toHaveAttribute('aria-current', 'true')
    const pills = within(screen.getByRole('navigation', { name: 'Channels' }))
    expect(
      pills.getByRole('button', { name: /# bot-testing/ }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('refetches with the date range the fields hold', async () => {
    renderPage()
    await screen.findByText('Looks sunny: highs around 24°C.')

    const from = screen.getByLabelText('From')
    const to = screen.getByLabelText('To')
    expect(from).toHaveAttribute('type', 'date')
    expect(from).toHaveValue(dateRange().from)
    expect(to).toHaveValue(dateRange().to)

    // `fireEvent` would do, but a typed value goes through the same handler.
    const user = userEvent.setup()
    await user.clear(from)
    await user.type(from, '2026-10-18')

    await waitFor(() =>
      expect(mockGetTranscript).toHaveBeenLastCalledWith('c1', {
        from: '2026-10-18',
        to: dateRange().to,
        before: undefined,
      }),
    )
  })

  it('shows the cost, input and output totals', async () => {
    renderPage()

    expect(await screen.findByText('$0.4231')).toBeInTheDocument()
    expect(screen.getByText('1.24M')).toBeInTheDocument()
    expect(screen.getByText('86.5K')).toBeInTheDocument()
    expect(screen.getByText('Total cost')).toBeInTheDocument()
    expect(screen.getByText('Input tokens')).toBeInTheDocument()
    expect(screen.getByText('Output tokens')).toBeInTheDocument()
  })

  it('lists the LLM calls behind a reply in one DataList', async () => {
    renderPage()
    await screen.findByText('Looks sunny: highs around 24°C.')

    expect(screen.getByText(/2 LLM calls/)).toBeInTheDocument()
    // Table and card list are both rendered; CSS picks one.
    const table = screen.getByRole('table', { name: 'LLM calls' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getAllByText('stop')).toHaveLength(2)
    expect(screen.getByRole('list', { name: 'LLM calls' })).toBeInTheDocument()
  })

  it('shows the empty state when the range has no messages', async () => {
    mockGetTranscript.mockResolvedValue({
      messages: [],
      calls: [],
      totals: { costUsd: 0, inputTokens: 0, outputTokens: 0 },
      nextCursor: null,
    })
    renderPage()

    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
    expect(screen.queryByTestId('transcript-loading')).not.toBeInTheDocument()
  })

  it('shows an error note when the thread fails to load', async () => {
    mockGetTranscript.mockRejectedValue(new Error('GET /api/transcript 502'))
    renderPage()

    const note = await screen.findByRole('alert')
    expect(note).toHaveTextContent('Couldn’t load this channel.')
    expect(note).toHaveTextContent('GET /api/transcript 502')
  })

  it('shows an error note in the channel list when channels fail', async () => {
    mockGetChannels.mockRejectedValue(new Error('boom'))
    renderPage()

    const notes = await screen.findAllByText('Couldn’t load channels.')
    expect(notes.length).toBeGreaterThan(0)
  })
})
