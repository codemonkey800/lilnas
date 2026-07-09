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
