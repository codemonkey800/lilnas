import { ToastProvider } from '@lilnas/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type {
  PlaygroundChatResponse,
  SettingsResponse,
} from 'src/api/api.types'
import PlaygroundPage from 'src/app/playground/page'
import type { ModelSpec } from 'src/llm/models/catalog'

const mockGetSettings = jest.fn()
const mockGetModels = jest.fn()
const mockGetEmojis = jest.fn()
const mockPlaygroundChat = jest.fn()

// The ApiClient is the boundary: the react-query hooks are real, the network
// is not. The delegating arrows keep the mocks out of the module-eval TDZ.
jest.mock('src/api/api.client', () => ({
  ...jest.requireActual('src/api/api.client'),
  ApiClient: class {
    getSettings = () => mockGetSettings()
    getModels = (role: string) => mockGetModels(role)
    getEmojis = () => mockGetEmojis()
    playgroundChat = (body: unknown) => mockPlaygroundChat(body)
  },
}))

const spec = (id: string, label: string): ModelSpec => ({
  id,
  provider: 'openai',
  label,
  description: `${label} description.`,
  roles: ['chat'],
  capabilities: {
    tools: true,
    structuredOutput: true,
    temperature: true,
    reasoningEffort: false,
    vision: false,
    image: false,
  },
  pricing: { inputPer1M: 1, outputPer1M: 4 },
})

const MODELS = [spec('gpt-4.1', 'GPT-4.1'), spec('gpt-5-mini', 'GPT-5 mini')]

const SAVED: SettingsResponse = {
  models: { chat: 'gpt-4.1', reasoning: 'gpt-5', image: 'gpt-image-1' },
  temperature: 0.7,
  reasoningEffort: 'medium',
  systemPrompt: 'You are tdr-bot.',
  updatedAt: '2026-10-22T21:14:00.000Z',
}

const reply = (text: string): PlaygroundChatResponse => ({
  raw: text,
  reply: text,
  model: 'gpt-4.1',
  usage: { input: 1000, output: 20, cached: 0, costUsd: 0.0042 },
  durationMs: 1800,
  emojis: {
    counts: { dictionary: 2, repaired: 0, hallucinated: 1, unicode: 0 },
    dictionary: [],
    repaired: [],
    hallucinated: [{ raw: '<:PogU:564310072822333499>' }],
    unicode: [],
  } as unknown as PlaygroundChatResponse['emojis'],
  dictionarySize: 40,
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PlaygroundPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function loaded() {
  await screen.findByRole('textbox', { name: 'Message' })
  // The model catalog feeds the Model select and the eval checkboxes.
  await screen.findByRole('checkbox', { name: 'gpt-5-mini' })
}

const send = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByRole('textbox', { name: 'Message' }), text)
  await user.click(screen.getByRole('button', { name: 'Send' }))
}

describe('PlaygroundPage', () => {
  beforeEach(() => {
    mockGetSettings.mockResolvedValue(SAVED)
    mockGetModels.mockResolvedValue(MODELS)
    mockGetEmojis.mockResolvedValue({
      emojis: [],
      reconcile: { running: false },
    })
  })

  it('starts with an empty thread and Send disabled', async () => {
    renderPage()
    await loaded()

    expect(screen.getByText('No messages yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Reset conversation' }),
    ).toBeDisabled()
  })

  it('shows a pending bubble, then the assistant reply with its meta and score', async () => {
    const user = userEvent.setup()
    const chat = deferred<PlaygroundChatResponse>()
    mockPlaygroundChat.mockReturnValue(chat.promise)
    renderPage()
    await loaded()

    await send(user, 'hype everyone up')

    expect(screen.getByText('hype everyone up')).toBeInTheDocument()
    expect(screen.getByTestId('playground-pending')).toHaveTextContent(
      'gpt-4.1 is thinking…',
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(mockPlaygroundChat).toHaveBeenCalledWith({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hype everyone up' }],
      systemPromptDraft: undefined,
    })

    chat.resolve(reply('LET’S GO'))

    expect(await screen.findByText('LET’S GO')).toBeInTheDocument()
    expect(screen.queryByTestId('playground-pending')).not.toBeInTheDocument()
    expect(screen.getByText('gpt-4.1 · $0.0042 · 1.8 s')).toBeInTheDocument()
    expect(screen.getByText('2 dictionary')).toBeInTheDocument()
    expect(screen.getByText('1 hallucinated')).toBeInTheDocument()
    expect(screen.getByText('0 unicode')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reset conversation' }),
    ).toBeEnabled()
  })

  it('shows a failed reply with Retry, and Retry sends the same history again', async () => {
    const user = userEvent.setup()
    mockPlaygroundChat
      .mockRejectedValueOnce(new Error('gpt-4.1 didn’t answer'))
      .mockResolvedValueOnce(reply('second time lucky'))
    renderPage()
    await loaded()

    await send(user, 'hello')

    expect(await screen.findByText('tdr-bot · failed')).toBeInTheDocument()
    expect(screen.getByText('gpt-4.1 didn’t answer')).toBeInTheDocument()
    // The composer gets the text back on failure.
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
      'hello',
    )

    await user.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('second time lucky')).toBeInTheDocument()
    expect(screen.queryByText('tdr-bot · failed')).not.toBeInTheDocument()
    expect(mockPlaygroundChat).toHaveBeenCalledTimes(2)
    expect(mockPlaygroundChat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'hello' }],
      }),
    )
  })

  it('disables Retry while an eval runs and re-enables it afterwards', async () => {
    const user = userEvent.setup()
    const evalCalls: ReturnType<typeof deferred<PlaygroundChatResponse>>[] = []
    mockPlaygroundChat.mockRejectedValueOnce(new Error('busy'))
    mockPlaygroundChat.mockImplementation(() => {
      const call = deferred<PlaygroundChatResponse>()
      evalCalls.push(call)
      return call.promise
    })
    renderPage()
    await loaded()

    await send(user, 'hello')
    const retry = await screen.findByRole('button', { name: 'Retry' })
    expect(retry).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Run eval' }))

    expect(
      await screen.findByRole('progressbar', { name: 'Eval progress' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    // Cancel stops new calls; the in-flight ones finish, then the run ends.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(evalCalls).toHaveLength(2)
    for (const call of evalCalls) call.resolve(reply('hi'))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled(),
    )
    expect(
      screen.getByRole('group', { name: 'Eval results' }),
    ).toBeInTheDocument()
  })

  it('tabulates the eval per model and expands a row to its replies', async () => {
    const user = userEvent.setup()
    mockPlaygroundChat.mockResolvedValue(reply('eval reply'))
    renderPage()
    await loaded()

    expect(screen.getByText('~$0.07 for 10 calls')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run eval' }))

    const results = await screen.findByRole('group', { name: 'Eval results' })
    expect(within(results).getByText('gpt-4.1')).toBeInTheDocument()
    expect(within(results).queryByText('eval reply')).not.toBeInTheDocument()

    await user.click(within(results).getByText('gpt-4.1'))

    expect(within(results).getByText(/^1\. yo whats up/)).toBeInTheDocument()
    expect(within(results).getAllByText('eval reply')).toHaveLength(10)
  })

  it('flags a modified system prompt draft and resets it to the saved one', async () => {
    const user = userEvent.setup()
    mockPlaygroundChat.mockResolvedValue(reply('ok'))
    renderPage()
    await loaded()

    expect(screen.queryByText('modified')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reset to saved' }),
    ).toBeDisabled()

    await user.click(screen.getByText('System prompt draft'))
    const draft = screen.getByRole('textbox', { name: 'System prompt draft' })
    expect(draft).toHaveValue('You are tdr-bot.')
    expect(screen.getByText('16 / 20000')).toBeInTheDocument()

    await user.type(draft, ' Use emojis.')

    expect(screen.getByText('modified')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset to saved' })).toBeEnabled()

    await send(user, 'hi')
    expect(mockPlaygroundChat).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPromptDraft: 'You are tdr-bot. Use emojis.',
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Reset to saved' }))
    expect(screen.queryByText('modified')).not.toBeInTheDocument()
    expect(draft).toHaveValue('You are tdr-bot.')
  })

  it('clears the thread after the reset confirmation', async () => {
    const user = userEvent.setup()
    mockPlaygroundChat.mockResolvedValue(reply('a reply'))
    renderPage()
    await loaded()
    await send(user, 'hello')
    await screen.findByText('a reply')

    await user.click(screen.getByRole('button', { name: 'Reset conversation' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Reset the conversation?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Reset the conversation?' }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.getByText('a reply')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reset conversation' }))
    const again = await screen.findByRole('dialog', {
      name: 'Reset the conversation?',
    })
    await user.click(
      within(again).getByRole('button', { name: 'Reset conversation' }),
    )

    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
    expect(screen.queryByText('a reply')).not.toBeInTheDocument()
  })

  it('shows an error note when settings fail to load', async () => {
    mockGetSettings.mockRejectedValue(new Error('nope'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t load settings.',
    )
  })
})
