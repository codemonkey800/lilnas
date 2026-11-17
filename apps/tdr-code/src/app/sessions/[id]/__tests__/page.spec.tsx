import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from 'src/app/lib/api'
import SessionDetailPage from 'src/app/sessions/[id]/page'
import type { ReconcileResponseDto } from 'src/console/reconcile.dto'
import type {
  SessionDetailResponseDto,
  TurnContentBlockDto,
  TurnDetailDto,
} from 'src/console/sessions.dto'

let mockParams = { id: '4826' }
const mockNotFound = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
jest.mock('next/navigation', () => ({
  useParams: () => mockParams,
  notFound: () => mockNotFound(),
}))

const mockUseLiveStream = jest.fn()
jest.mock('src/app/lib/use-live-stream', () => ({
  useLiveStream: (...args: unknown[]) => mockUseLiveStream(...args),
}))

const mockLogReconcile = jest.fn()
jest.mock('src/app/lib/reconcile-logging', () => ({
  logReconcileResult: (...args: unknown[]) => mockLogReconcile(...args),
}))

const SESSION: SessionDetailResponseDto['session'] = {
  id: 4826,
  channelId: '1184726493302157312',
  channelName: '#ops-agent',
  triggeringUserId: '111111111111111111',
  triggeringUserDisplayName: 'Jeremy',
  createdAt: new Date(Date.now() - 14 * 60_000).toISOString(),
  endedAt: null,
  endReason: null,
}

function turn(
  content: TurnContentBlockDto[],
  patch: Partial<TurnDetailDto> = {},
): TurnDetailDto {
  return {
    id: 1,
    turnIndex: 1,
    userId: null,
    status: 'completed',
    startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    endedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    stopReason: null,
    content,
    ...patch,
  }
}

function detail(
  patch: Partial<SessionDetailResponseDto> = {},
): SessionDetailResponseDto {
  return { session: SESSION, turns: [], droppedBlocks: 0, ...patch }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionDetailPage />
    </QueryClientProvider>,
  )
}

let getSession: jest.SpiedFunction<typeof api.getSession>
let reconcile: jest.SpiedFunction<typeof api.reconcile>

beforeEach(() => {
  mockParams = { id: '4826' }
  mockNotFound.mockClear()
  mockUseLiveStream.mockReset()
  mockLogReconcile.mockReset()
  getSession = jest.spyOn(api, 'getSession').mockResolvedValue(detail())
  reconcile = jest.spyOn(api, 'reconcile')
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('SessionDetailPage — header and meta', () => {
  it('shows an Active badge for a live session and subscribes with the 300ms throttle', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Session #4826' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sessions' })).toHaveAttribute(
      'href',
      '/sessions',
    )
    expect(mockUseLiveStream).toHaveBeenCalledWith(['session:4826'], {
      throttleMs: 300,
    })
    // Channel / User / Created, no Ended while live
    expect(screen.getByText('Channel')).toBeInTheDocument()
    expect(screen.getByText('#ops-agent')).toBeInTheDocument()
    expect(screen.getByText('Jeremy')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.queryByText('Ended')).not.toBeInTheDocument()
  })

  it('shows the end reason and an Ended time for a finished session', async () => {
    getSession.mockResolvedValue(
      detail({
        session: {
          ...SESSION,
          endedAt: new Date(Date.now() - 3_600_000).toISOString(),
          endReason: 'teardown',
        },
      }),
    )
    renderPage()

    expect(await screen.findByText('teardown')).toBeInTheDocument()
    expect(screen.getByText('Ended')).toBeInTheDocument()
    expect(screen.queryByText('Active')).not.toBeInTheDocument()
  })

  it('notes dropped blocks, and not when none were dropped', async () => {
    getSession.mockResolvedValue(detail({ droppedBlocks: 3 }))
    const { unmount } = renderPage()

    expect(
      await screen.findByText('3 malformed blocks dropped from view.'),
    ).toBeInTheDocument()
    unmount()

    getSession.mockResolvedValue(detail())
    renderPage()
    await screen.findByText('0 turns')
    expect(screen.queryByText(/dropped from view/)).not.toBeInTheDocument()
  })
})

describe('SessionDetailPage — turns and block types', () => {
  it('renders a prompt block with its image count', async () => {
    getSession.mockResolvedValue(
      detail({
        turns: [
          turn([
            {
              id: 1,
              kind: 'prompt',
              text: 'Fix the dot.',
              images: [{ mimeType: 'image/png' }],
            },
          ]),
        ],
      }),
    )
    renderPage()

    expect(await screen.findByText('Fix the dot.')).toBeInTheDocument()
    expect(screen.getByText('Prompt')).toBeInTheDocument()
    expect(screen.getByText('1 image attached')).toBeInTheDocument()
  })

  it('renders agent text', async () => {
    getSession.mockResolvedValue(
      detail({
        turns: [turn([{ id: 1, kind: 'agent_text', text: 'On it.' }])],
      }),
    )
    renderPage()

    expect(await screen.findByText('On it.')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
  })

  it('renders a tool call with kind, status, plan outcome and plan text', async () => {
    getSession.mockResolvedValue(
      detail({
        turns: [
          turn([
            {
              id: 1,
              kind: 'tool_call',
              title: 'ExitPlanMode',
              toolKind: 'switch_mode',
              status: 'completed',
              planOutcome: 'accepted',
              planText: '1. Swap the dots.',
            },
            {
              id: 2,
              kind: 'tool_call',
              title: 'git push',
              toolKind: 'execute',
              status: 'failed',
            },
          ]),
        ],
      }),
    )
    renderPage()

    expect(await screen.findByText('ExitPlanMode')).toBeInTheDocument()
    expect(screen.getByText(/switch_mode/)).toHaveTextContent(
      'switch_mode · completed · Plan approved',
    )
    expect(screen.getByText('1. Swap the dots.')).toBeInTheDocument()
    expect(screen.getByText('failed')).toHaveClass('text-bad')
  })

  it('renders a diff block with its path in a sunk mono well', async () => {
    getSession.mockResolvedValue(
      detail({
        turns: [
          turn([
            {
              id: 1,
              kind: 'diff',
              path: 'apps/tdr-code/src/status-dot.tsx',
              newText: 'export const a = 1',
              truncated: false,
            },
          ]),
        ],
      }),
    )
    renderPage()

    const code = await screen.findByText('export const a = 1')
    expect(code.tagName).toBe('PRE')
    expect(code).toHaveClass('font-mono')
    expect(code.parentElement).toHaveClass('bg-bg-sunk')
    expect(screen.getByText('apps/tdr-code/src/status-dot.tsx')).toBeVisible()
    expect(screen.getByText('Diff')).toBeInTheDocument()
  })

  it.each([
    ['completed', 'Completed'],
    ['running', 'Running'],
    ['errored', 'Errored'],
    ['cancelled', 'Cancelled'],
    ['interrupted', 'Interrupted'],
  ] as const)('shows a %s turn as a "%s" badge', async (status, label) => {
    getSession.mockResolvedValue(
      detail({ turns: [turn([], { status, endedAt: null })] }),
    )
    renderPage()

    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('says a turn with no blocks has no content, and counts turns', async () => {
    getSession.mockResolvedValue(
      detail({
        turns: [turn([]), turn([], { id: 2, turnIndex: 2 })],
      }),
    )
    renderPage()

    expect(await screen.findByText('2 turns')).toBeInTheDocument()
    expect(screen.getAllByText('No content blocks')).toHaveLength(2)
    expect(screen.getByText('Turn 1')).toBeInTheDocument()
    expect(screen.getByText('Turn 2')).toBeInTheDocument()
  })

  it('shows the empty state when the session has no turns', async () => {
    renderPage()

    expect(await screen.findByText('No turns recorded')).toBeInTheDocument()
  })
})

describe('SessionDetailPage — load states', () => {
  it('renders not-found for an id that is not a positive integer', () => {
    mockParams = { id: 'abc' }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderPage()).toThrow('NEXT_NOT_FOUND')
    expect(mockNotFound).toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('shows the error when the session fails to load', async () => {
    getSession.mockRejectedValue(new Error('HTTP 502'))
    renderPage()

    expect(
      await screen.findByText("Couldn't load session #4826."),
    ).toBeInTheDocument()
  })
})

describe('SessionDetailPage — reconcile', () => {
  async function runReconcile(result: ReconcileResponseDto) {
    const user = userEvent.setup()
    reconcile.mockResolvedValue(result)
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Run reconcile' }),
    )
  }

  function count(label: string): HTMLElement {
    return screen.getByText(label).previousElementSibling as HTMLElement
  }

  it('waits for the button, then compares once and hides the button', async () => {
    await runReconcile({
      verdict: 'reconciled',
      matched: 41,
      missingInDb: [],
      extraInDb: [],
      mismatched: [],
      skippedJsonlLines: 0,
    })

    expect(await screen.findByText('41')).toBeInTheDocument()
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledWith(4826)
    expect(
      screen.queryByRole('button', { name: 'Run reconcile' }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(mockLogReconcile).toHaveBeenCalledTimes(1))
  })

  it('shows the four counts, coloured only when non-zero', async () => {
    await runReconcile({
      verdict: 'reconciled',
      matched: 38,
      missingInDb: [{ kind: 'prompt' }, { kind: 'diff' }],
      extraInDb: [{ kind: 'agent_text' }],
      mismatched: [],
      skippedJsonlLines: 3,
      cappedAt: 5242880,
    })

    await screen.findByText('Matched')
    expect(count('Matched')).toHaveTextContent('38')
    expect(count('Matched')).toHaveClass('text-ok')
    expect(count('Missing in DB')).toHaveTextContent('2')
    expect(count('Missing in DB')).toHaveClass('text-bad')
    expect(count('Extra in DB')).toHaveTextContent('1')
    expect(count('Extra in DB')).toHaveClass('text-warn')
    expect(count('Mismatched')).toHaveTextContent('0')
    expect(count('Mismatched')).toHaveClass('text-ink-3')
    expect(
      screen.getByText('Skipped 3 malformed JSONL lines'),
    ).toBeInTheDocument()
    expect(screen.getByText('JSONL truncated.')).toBeInTheDocument()
    expect(screen.getByText('5242880 bytes')).toBeInTheDocument()
  })

  it('leaves a clean run with no warnings', async () => {
    await runReconcile({
      verdict: 'reconciled',
      matched: 41,
      missingInDb: [],
      extraInDb: [],
      mismatched: [],
      skippedJsonlLines: 0,
    })

    await screen.findByText('Matched')
    expect(count('Missing in DB')).toHaveClass('text-ink-3')
    expect(screen.queryByText(/Skipped/)).not.toBeInTheDocument()
    expect(screen.queryByText('JSONL truncated.')).not.toBeInTheDocument()
  })

  it('explains when there is nothing to compare against', async () => {
    await runReconcile({ verdict: 'cannot-reconcile', reason: 'file-missing' })

    expect(
      await screen.findByText('Nothing to compare against.'),
    ).toBeInTheDocument()
    expect(screen.getByText('file-missing')).toBeInTheDocument()
  })

  it('shows the error when the comparison fails', async () => {
    const user = userEvent.setup()
    reconcile.mockRejectedValue(new Error('HTTP 502'))
    renderPage()
    await user.click(
      await screen.findByRole('button', { name: 'Run reconcile' }),
    )

    const note = await screen.findByText("Couldn't compare the transcript.")
    expect(within(note.parentElement!).getByText(/HTTP 502/)).toBeVisible()
  })
})
