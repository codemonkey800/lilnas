import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ConfigPage from 'src/app/config/page'
import * as apiLib from 'src/app/lib/api'
import { api } from 'src/app/lib/api'
import type { ConfigResponseDto } from 'src/console/config.dto'

const CONFIG: ConfigResponseDto = {
  cwd: '/tmp',
  claudeCommand: 'claude',
  claudeArgs: ['--dangerously-skip-permissions'],
  idleTimeoutSec: 300,
  maxConcurrentSessions: 5,
  customSystemPrompt: 'Always respond in haiku.',
  autoPostDiffs: false,
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
        <ConfigPage />
      </QueryClientProvider>,
    ),
  }
}

// U6: ConfigPage now calls useLiveStream(['bot-status']) (see src/app/lib/
// use-live-stream.ts), which constructs a real `new EventSource(...)` on
// mount. jsdom (this project's frontend testEnvironment) does not implement
// EventSource — the same gap use-live-stream.spec.tsx's own header comment
// documents — so without a stand-in, every test in this file would now
// throw `ReferenceError: EventSource is not defined` the instant ConfigPage
// mounts. This file only needs the constructor + close() (the hook's mount/
// unmount lifecycle) to not throw; it never needs to simulate a topic
// signal arriving (that behavior is use-live-stream.spec.tsx's job — see
// its "shared bot-status key across multiple mounts (U6)" describe block),
// so this stub is deliberately minimal rather than importing that file's
// fuller MockEventSource.
class StubEventSource {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

// ConfigPage now emits browser-log beacons (logEvent/logToServer -> a bare
// global fetch): config-saved on a successful save, client-validation-rejected
// on a bad claudeArgs submit. jsdom provides no fetch, so install the same
// stand-in the other frontend specs use — otherwise the existing save tests
// would throw "fetch is not defined" from inside onSuccess.
const mockFetch = jest.fn()

beforeEach(() => {
  // .mockReset() before re-arming: jest.config.js's top-level clearMocks/
  // restoreMocks have no effect once a `projects` array is used (Jest only
  // applies those settings from each PROJECT's own config, not the parent) —
  // confirmed empirically, since this file is the first to spy on a
  // module-level singleton (api.*) that persists across tests. Without an
  // explicit reset, jest.spyOn on an already-mocked method returns the same
  // mock instance, so call history silently accumulates across tests in
  // this file (e.g. a later test would see an earlier test's submitted body
  // still sitting in .mock.calls[0]).
  jest.spyOn(api, 'getConfig').mockReset().mockResolvedValue(CONFIG)
  jest.spyOn(api, 'updateConfig').mockReset().mockResolvedValue(CONFIG)
  // Page also reads bot status directly via fetchJson — stub it so that
  // query settles without touching the network.
  jest
    .spyOn(apiLib, 'fetchJson')
    .mockReset()
    .mockResolvedValue({ status: 'never-seen' } as never)
  global.EventSource = StubEventSource as unknown as typeof EventSource
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
})

describe('ConfigPage — custom system prompt field', () => {
  it('seeds the textarea with the value returned by the config query', async () => {
    renderPage()

    expect(
      await screen.findByDisplayValue(CONFIG.customSystemPrompt),
    ).toBeInTheDocument()
  })

  it('the character counter reflects the current textarea length as the operator types', async () => {
    const user = userEvent.setup()
    renderPage()

    const textarea = await screen.findByDisplayValue(CONFIG.customSystemPrompt)
    expect(
      screen.getByText(`${CONFIG.customSystemPrompt.length} / 20000`),
    ).toBeInTheDocument()

    await user.type(textarea, '!')

    expect(
      screen.getByText(`${CONFIG.customSystemPrompt.length + 1} / 20000`),
    ).toBeInTheDocument()
  })

  it('typing into the textarea and submitting includes the new value in the PUT /config payload alongside the unchanged existing fields', async () => {
    const updateSpy = jest.spyOn(api, 'updateConfig').mockResolvedValue({
      ...CONFIG,
      customSystemPrompt: 'Always respond in haiku. Be terse.',
    })
    const user = userEvent.setup()
    renderPage()

    const textarea = await screen.findByDisplayValue(CONFIG.customSystemPrompt)
    await user.type(textarea, ' Be terse.')
    await user.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0]?.[0]).toMatchObject({
      cwd: CONFIG.cwd,
      claudeCommand: CONFIG.claudeCommand,
      claudeArgs: CONFIG.claudeArgs,
      idleTimeoutSec: CONFIG.idleTimeoutSec,
      maxConcurrentSessions: CONFIG.maxConcurrentSessions,
      customSystemPrompt: 'Always respond in haiku. Be terse.',
    })
    // Wait for the full onSuccess cycle (including the "Saved" dismiss
    // timer being armed) to settle before the test ends — otherwise a
    // real setTimeout from this test's onSuccess can fire mid-test in a
    // later test in this file, since Jest doesn't reset real timers
    // between tests the way it resets mocks.
    await screen.findByText('Saved')
  })

  it('submitting with the textarea cleared to empty sends customSystemPrompt: "" (not omitted)', async () => {
    const updateSpy = jest
      .spyOn(api, 'updateConfig')
      .mockResolvedValue({ ...CONFIG, customSystemPrompt: '' })
    const user = userEvent.setup()
    renderPage()

    const textarea = await screen.findByDisplayValue(CONFIG.customSystemPrompt)
    await user.clear(textarea)
    await user.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    // toMatchObject requires the key to be present and equal '' — an
    // omitted key (undefined) would fail this assertion.
    expect(updateSpy.mock.calls[0]?.[0]).toMatchObject({
      customSystemPrompt: '',
    })
    // See the previous test's comment on why this matters for test isolation.
    await screen.findByText('Saved')
  })
})

// U6: this page's bot-status query used to carry `refetchInterval: 5_000`
// (and BotStatusWidget's own query, exercised by use-live-stream.spec.tsx's
// own U6 describe block, had the same). Both are now fed by
// useLiveStream(['bot-status']) instead. React Query does not expose
// `refetchInterval` as an inspectable property on a rendered observer from
// outside (there is no public "what interval is this query configured
// with" accessor), so this proves the removal BEHAVIORALLY rather than by
// reading source text: advance fake timers well past the old 5s interval
// (and past a couple of would-be ticks, to rule out a timer that fires but
// coalesces) and assert neither query's fetcher was called again beyond its
// one initial mount-time call. Structural confirmation of the literal
// `refetchInterval: 5_000` removal from both call sites is also visible
// directly in this unit's diff (src/app/components/bot-status-widget.tsx
// and src/app/config/page.tsx) — this test is the runtime complement to
// that, not a replacement for eyeballing the diff.
describe('ConfigPage — bot-status query no longer polls (U6)', () => {
  it('neither the config query nor the bot-status query refetches on a timer after mount, even well past the old 5s refetchInterval', async () => {
    jest.useFakeTimers()
    try {
      const getConfigSpy = jest.spyOn(api, 'getConfig')
      const fetchJsonSpy = jest.spyOn(apiLib, 'fetchJson')
      renderPage()

      // Let the initial mount-time fetches resolve (React Query's own
      // internal promise-then scheduling still needs real microtask
      // flushes even under fake timers).
      await waitFor(() => expect(getConfigSpy).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(fetchJsonSpy).toHaveBeenCalledTimes(1))

      // Advance well past three would-be 5s poll ticks. If either
      // `refetchInterval: 5_000` were still present, this would produce
      // additional calls; with both removed and no other timer-driven
      // refetch source on this page, the call counts must stay at 1.
      jest.advanceTimersByTime(20_000)

      expect(getConfigSpy).toHaveBeenCalledTimes(1)
      expect(fetchJsonSpy).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('ConfigPage — save + validation telemetry', () => {
  function beaconBodies() {
    return mockFetch.mock.calls
      .filter(call => call[0] === '/api/logs/browser')
      .map(
        call =>
          JSON.parse(call[1]?.body as string) as {
            level: string
            event: string
            context?: {
              botOffline?: boolean
              changedFields?: string[]
              field?: string
              reason?: string
            }
          },
      )
  }

  it('logs config-saved (info) with the CHANGED FIELD NAMES and botOffline, leaking no values', async () => {
    jest.spyOn(api, 'updateConfig').mockResolvedValue({
      ...CONFIG,
      customSystemPrompt: 'Always respond in haiku. Be terse.',
    })
    const user = userEvent.setup()
    renderPage()

    const textarea = await screen.findByDisplayValue(CONFIG.customSystemPrompt)
    await user.type(textarea, ' Be terse.')
    await user.click(screen.getByRole('button', { name: /Save/ }))
    await screen.findByText('Saved')

    const saved = beaconBodies().filter(b => b.event === 'config-saved')
    expect(saved).toHaveLength(1)
    expect(saved[0]!.level).toBe('info')
    // Only the one field the operator actually changed, by NAME.
    expect(saved[0]!.context?.changedFields).toEqual(['customSystemPrompt'])
    // never-seen bot status => offline (a deferred-effect save).
    expect(saved[0]!.context?.botOffline).toBe(true)
    // No config VALUES ever leave the browser — not the prompt text, not cwd.
    const serialized = JSON.stringify(saved[0])
    expect(serialized).not.toContain('haiku')
    expect(serialized).not.toContain('/tmp')
  })

  it('logs client-validation-rejected (warn, invalid-json) and does NOT call updateConfig on unparseable claudeArgs', async () => {
    const updateSpy = jest.spyOn(api, 'updateConfig')
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue(CONFIG.customSystemPrompt)

    // fireEvent.change (not userEvent.type) for the args field: user-event
    // treats '[' / '{' as special key-descriptor syntax, so typing raw JSON
    // array text through it is unreliable — a direct value set is exact.
    const argsField = screen.getByDisplayValue(
      JSON.stringify(CONFIG.claudeArgs),
    )
    fireEvent.change(argsField, { target: { value: 'not json' } })
    await user.click(screen.getByRole('button', { name: /Save/ }))

    const rejected = beaconBodies().filter(
      b => b.event === 'client-validation-rejected',
    )
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.level).toBe('warn')
    expect(rejected[0]!.context).toEqual({
      field: 'claudeArgs',
      reason: 'invalid-json',
    })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('logs client-validation-rejected with reason not-string-array for a JSON array of non-strings', async () => {
    const updateSpy = jest.spyOn(api, 'updateConfig')
    const user = userEvent.setup()
    renderPage()
    await screen.findByDisplayValue(CONFIG.customSystemPrompt)

    const argsField = screen.getByDisplayValue(
      JSON.stringify(CONFIG.claudeArgs),
    )
    fireEvent.change(argsField, { target: { value: '[1, 2, 3]' } })
    await user.click(screen.getByRole('button', { name: /Save/ }))

    const rejected = beaconBodies().filter(
      b => b.event === 'client-validation-rejected',
    )
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.context).toEqual({
      field: 'claudeArgs',
      reason: 'not-string-array',
    })
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

describe('ConfigPage — loaded values and states', () => {
  it('seeds every field from the config query', async () => {
    renderPage()

    expect(await screen.findByLabelText(/Working directory/)).toHaveValue(
      '/tmp',
    )
    expect(screen.getByLabelText(/Claude command/)).toHaveValue('claude')
    expect(screen.getByLabelText(/Claude args/)).toHaveValue(
      JSON.stringify(CONFIG.claudeArgs),
    )
    expect(screen.getByLabelText(/Idle timeout/)).toHaveValue(300)
    expect(screen.getByLabelText(/Max concurrent sessions/)).toHaveValue(5)
    expect(screen.getByLabelText(/Custom system prompt/)).toHaveValue(
      CONFIG.customSystemPrompt,
    )
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('says on each label line how far a change reaches', async () => {
    renderPage()

    await screen.findByLabelText(/Working directory/)
    expect(screen.getAllByText('Takes effect: new sessions only')).toHaveLength(
      4,
    )
    expect(
      screen.getByText('Takes effect: next idle-timer reset'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Takes effect: next create (no eviction)'),
    ).toBeInTheDocument()
    expect(screen.getByText('Takes effect: next tool call')).toBeInTheDocument()
  })

  it('shows a skeleton that says what is being fetched while the config loads', () => {
    jest.spyOn(api, 'getConfig').mockImplementation(() => new Promise(() => {}))
    renderPage()

    expect(screen.getByText('Fetching config…')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Global config' })).toBeVisible()
  })

  it('shows a bad Note with the server message when the config fails to load', async () => {
    jest.spyOn(api, 'getConfig').mockRejectedValue(new Error('config boom'))
    renderPage()

    expect(
      await screen.findByText("Couldn't load the config."),
    ).toBeInTheDocument()
    expect(screen.getByText('config boom')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Save/ }),
    ).not.toBeInTheDocument()
  })
})

describe('ConfigPage — character limit warning', () => {
  it('stays quiet below 90% of the 20,000 limit', async () => {
    renderPage()

    await screen.findByLabelText(/Custom system prompt/)
    expect(screen.queryByText('Close to the limit.')).not.toBeInTheDocument()
  })

  it('shows a warn Note and an amber count from 90% of the limit', async () => {
    jest
      .spyOn(api, 'getConfig')
      .mockResolvedValue({ ...CONFIG, customSystemPrompt: 'x'.repeat(18_000) })
    renderPage()

    const note = await screen.findByText('Close to the limit.')
    expect(note.closest('[role="status"]')).toHaveTextContent(
      'The prompt can be at most 20,000 characters.',
    )
    expect(screen.getByText('18000 / 20000')).toHaveClass('text-warn')
  })
})

describe('ConfigPage — bot offline note', () => {
  it('shows a warn Note saying when the save applies when the bot is offline', async () => {
    renderPage()

    const note = await screen.findByText('Bot is offline.')
    expect(note.closest('[role="status"]')).toHaveTextContent(
      'Changes are saved now and apply at the next bot start.',
    )
  })

  it('hides it when the bot is online', async () => {
    jest
      .spyOn(apiLib, 'fetchJson')
      .mockResolvedValue({ status: 'online' } as never)
    renderPage()

    await screen.findByLabelText(/Working directory/)
    await waitFor(() =>
      expect(apiLib.fetchJson).toHaveBeenCalledWith('/bot/status'),
    )
    expect(screen.queryByText('Bot is offline.')).not.toBeInTheDocument()
  })
})

describe('ConfigPage — submit', () => {
  it('sends every field, including the toggled checkbox, and shows Saved', async () => {
    const updateSpy = jest
      .spyOn(api, 'updateConfig')
      .mockResolvedValue({ ...CONFIG, cwd: '/srv', autoPostDiffs: true })
    const user = userEvent.setup()
    renderPage()

    const cwd = await screen.findByLabelText(/Working directory/)
    await user.clear(cwd)
    await user.type(cwd, '/srv')
    await user.click(screen.getByText(/Post a diff message/))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0]?.[0]).toEqual({
      cwd: '/srv',
      claudeCommand: CONFIG.claudeCommand,
      claudeArgs: CONFIG.claudeArgs,
      idleTimeoutSec: CONFIG.idleTimeoutSec,
      maxConcurrentSessions: CONFIG.maxConcurrentSessions,
      customSystemPrompt: CONFIG.customSystemPrompt,
      autoPostDiffs: true,
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('disables Save and relabels it Saving… while the request runs', async () => {
    let resolveSave: (() => void) | undefined
    jest.spyOn(api, 'updateConfig').mockImplementation(
      () =>
        new Promise(resolve => {
          resolveSave = () => resolve(CONFIG)
        }),
    )
    const user = userEvent.setup()
    renderPage()

    await screen.findByLabelText(/Working directory/)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByRole('button', { name: 'Saving…' }),
    ).toBeDisabled()

    resolveSave?.()
    await screen.findByText('Saved')
  })

  it('shows the server message in a bad Note when the save fails, and keeps the form', async () => {
    jest.spyOn(api, 'updateConfig').mockRejectedValue(new Error('PUT 502'))
    const user = userEvent.setup()
    renderPage()

    await screen.findByLabelText(/Working directory/)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText("Couldn't save the config.")).toBeVisible()
    expect(screen.getByText('PUT 502')).toBeInTheDocument()
    expect(screen.getByLabelText(/Working directory/)).toHaveValue('/tmp')
  })

  it('puts the args validation error under the textarea and sends nothing', async () => {
    const updateSpy = jest.spyOn(api, 'updateConfig').mockReset()
    const user = userEvent.setup()
    renderPage()

    const args = await screen.findByLabelText(/Claude args/)
    fireEvent.change(args, { target: { value: '{"model":"opus"}' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      screen.getByText('Must be a JSON array of strings, like ["--flag"].'),
    ).toBeInTheDocument()
    expect(args).toBeInvalid()
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
