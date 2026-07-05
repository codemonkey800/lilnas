import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
  // Page also polls bot status directly via fetchJson — stub it so that
  // query settles without touching the network.
  jest
    .spyOn(apiLib, 'fetchJson')
    .mockReset()
    .mockResolvedValue({ status: 'never-seen' } as never)
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
