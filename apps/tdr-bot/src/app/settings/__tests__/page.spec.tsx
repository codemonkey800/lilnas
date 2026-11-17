import { ToastProvider } from '@lilnas/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ApiRequestError } from 'src/api/api.client'
import type { SettingsResponse } from 'src/api/api.types'
import SettingsPage from 'src/app/settings/page'
import type { ModelSpec } from 'src/llm/models/catalog'

const mockGetSettings = jest.fn()
const mockUpdateSettings = jest.fn()
const mockResetSettings = jest.fn()
const mockGetModels = jest.fn()

// The ApiClient is the boundary: the react-query hooks are real, the network
// is not. The delegating arrows keep the mocks out of the module-eval TDZ.
jest.mock('src/api/api.client', () => ({
  ...jest.requireActual('src/api/api.client'),
  ApiClient: class {
    getSettings = () => mockGetSettings()
    updateSettings = (patch: unknown) => mockUpdateSettings(patch)
    resetSettings = () => mockResetSettings()
    getModels = (role: string) => mockGetModels(role)
  },
}))

const spec = (
  id: string,
  label: string,
  temperature: boolean,
  pricing: ModelSpec['pricing'] = { inputPer1M: 1, outputPer1M: 4 },
): ModelSpec => ({
  id,
  provider: 'openai',
  label,
  description: `${label} description.`,
  roles: ['chat', 'reasoning'],
  capabilities: {
    tools: true,
    structuredOutput: true,
    temperature,
    reasoningEffort: !temperature,
    vision: false,
    image: false,
  },
  pricing,
})

const MODELS: Record<string, ModelSpec[]> = {
  chat: [
    spec('gpt-4.1', 'GPT-4.1', true),
    spec('gpt-5-mini', 'GPT-5 mini', false),
  ],
  reasoning: [spec('gpt-5', 'GPT-5', false)],
  image: [spec('gpt-image-1', 'GPT Image 1', false, null)],
}

const SAVED: SettingsResponse = {
  models: { chat: 'gpt-4.1', reasoning: 'gpt-5', image: 'gpt-image-1' },
  temperature: 0.7,
  reasoningEffort: 'medium',
  systemPrompt: 'You are tdr-bot.',
  updatedAt: '2026-10-22T21:14:00.000Z',
}

// Toasts are `role="dialog"` too, so the confirm dialog is found by its title.
const RESET_TITLE = 'Reset settings to the defaults?'

const savedAt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

/** The save-row status line (the loading skeleton is also a `status`). */
const statusLine = (text: RegExp | string) =>
  screen.findByText(text, { selector: '[role="status"]' })

async function loaded() {
  await screen.findByRole('textbox', { name: 'System prompt' })
  // Wait for the model catalogs so the chat model's capability is known.
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Chat' })).toBeEnabled(),
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    mockGetSettings.mockResolvedValue(SAVED)
    mockGetModels.mockImplementation(async (role: string) => MODELS[role])
  })

  it('shows skeleton cards while settings load', () => {
    mockGetSettings.mockReturnValue(new Promise(() => undefined))
    renderPage()

    expect(
      screen.getByRole('heading', { name: 'Settings' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Loading settings' }),
    ).toBeInTheDocument()
    for (const title of ['Models', 'Generation', 'System prompt']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()
  })

  it('shows an error note when settings fail to load', async () => {
    mockGetSettings.mockRejectedValue(new Error('down'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t load settings.',
    )
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument()
  })

  it('renders the loaded form in three cards', async () => {
    renderPage()
    await loaded()

    for (const title of ['Models', 'Generation', 'System prompt']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(screen.getByRole('combobox', { name: 'Chat' })).toHaveTextContent(
      'GPT-4.1',
    )
    expect(
      screen.getByRole('combobox', { name: 'Reasoning' }),
    ).toHaveTextContent('GPT-5')
    expect(screen.getByRole('combobox', { name: 'Image' })).toHaveTextContent(
      'per image',
    )
    expect(screen.getByRole('textbox', { name: 'System prompt' })).toHaveValue(
      'You are tdr-bot.',
    )
    expect(screen.getByText('16 / 20000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled()
    expect(
      await statusLine(`Saved ${savedAt(SAVED.updatedAt)}`),
    ).toBeInTheDocument()
  })

  describe('generation control follows the chat model', () => {
    it('shows a temperature slider for a model that takes temperature', async () => {
      renderPage()
      await loaded()

      const slider = screen.getByRole('slider', { name: 'Temperature' })

      expect(slider).toHaveAttribute('min', '0')
      expect(slider).toHaveAttribute('max', '2')
      expect(slider).toHaveAttribute('step', '0.1')
      expect(slider).toHaveValue('0.7')
      expect(screen.getByText('0.7')).toBeInTheDocument()
      expect(
        screen.getByText('Temperature applies to this chat model.'),
      ).toBeInTheDocument()
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    })

    it('shows reasoning-effort radios for a reasoning model', async () => {
      mockGetSettings.mockResolvedValue({
        ...SAVED,
        models: { ...SAVED.models, chat: 'gpt-5-mini' },
        reasoningEffort: 'high',
      })
      renderPage()
      await loaded()

      const group = await screen.findByRole('radiogroup', {
        name: 'Reasoning effort',
      })

      expect(screen.queryByRole('slider')).not.toBeInTheDocument()
      expect(
        within(group)
          .getAllByRole('radio')
          .map(r => r.getAttribute('aria-checked')),
      ).toEqual(['false', 'false', 'true'])
      expect(
        screen.getByText(
          'GPT-5 mini is a reasoning model and has no temperature.',
        ),
      ).toBeInTheDocument()
    })

    it('swaps the control when the chat model is changed', async () => {
      const user = userEvent.setup()
      renderPage()
      await loaded()

      await user.click(screen.getByRole('combobox', { name: 'Chat' }))
      await user.click(
        await screen.findByRole('option', { name: /GPT-5 mini/ }),
      )

      expect(
        await screen.findByRole('radiogroup', { name: 'Reasoning effort' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    })
  })

  describe('save states', () => {
    it('goes unsaved → saving → saved and toasts', async () => {
      const user = userEvent.setup()
      const next = {
        ...SAVED,
        systemPrompt: 'Be brief.',
        updatedAt: '2026-10-24T09:41:00.000Z',
      }
      let finish: (value: SettingsResponse) => void = () => undefined
      mockUpdateSettings.mockReturnValue(
        new Promise<SettingsResponse>(resolve => {
          finish = resolve
        }),
      )
      renderPage()
      await loaded()

      const prompt = screen.getByRole('textbox', { name: 'System prompt' })
      await user.clear(prompt)
      await user.type(prompt, 'Be brief.')

      expect(await statusLine('Unsaved changes')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.getByText('9 / 20000')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(mockUpdateSettings).toHaveBeenCalledWith({
        models: SAVED.models,
        temperature: 0.7,
        reasoningEffort: 'medium',
        systemPrompt: 'Be brief.',
      })
      expect(await statusLine('Saving…')).toBeInTheDocument()
      const saving = screen.getByRole('button', { name: 'Saving…' })
      expect(saving).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
      expect(
        screen.getByRole('textbox', { name: 'System prompt' }),
      ).toBeDisabled()

      mockGetSettings.mockResolvedValue(next)
      finish(next)

      expect(
        await statusLine(`Saved ${savedAt(next.updatedAt)}`),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: 'System prompt' }),
      ).toHaveValue('Be brief.')
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(await screen.findByText('Settings saved')).toBeInTheDocument()
    })

    it('clears the saved mark on the next edit', async () => {
      const user = userEvent.setup()
      mockUpdateSettings.mockResolvedValue(SAVED)
      renderPage()
      await loaded()

      const prompt = screen.getByRole('textbox', { name: 'System prompt' })
      await user.type(prompt, '!')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      await screen.findByText('Settings saved')

      await user.type(prompt, '?')

      expect(await statusLine('Unsaved changes')).toBeInTheDocument()
    })
  })

  describe('field errors', () => {
    it('puts a rejected model under its select and says why saving failed', async () => {
      const user = userEvent.setup()
      mockUpdateSettings.mockRejectedValue(
        new ApiRequestError('Invalid', 400, [
          { path: 'models.chat', message: 'gpt-4.1 isn’t on the allow-list.' },
        ]),
      )
      renderPage()
      await loaded()

      await user.type(
        screen.getByRole('textbox', { name: 'System prompt' }),
        '!',
      )
      await user.click(screen.getByRole('button', { name: 'Save' }))

      const chat = screen.getByRole('combobox', { name: 'Chat' })
      await waitFor(() => expect(chat).toHaveAttribute('aria-invalid', 'true'))
      expect(chat).toHaveAccessibleDescription(
        'gpt-4.1 isn’t on the allow-list.',
      )
      expect(
        await statusLine('Can’t save — fix the highlighted field'),
      ).toBeInTheDocument()
      // A field issue is not a global failure.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('puts a prompt issue on the textarea through Field', async () => {
      const user = userEvent.setup()
      mockUpdateSettings.mockRejectedValue(
        new ApiRequestError('Invalid', 400, [
          {
            path: 'systemPrompt',
            message: 'The prompt is 312 characters over.',
          },
        ]),
      )
      renderPage()
      await loaded()

      await user.type(
        screen.getByRole('textbox', { name: 'System prompt' }),
        '!',
      )
      await user.click(screen.getByRole('button', { name: 'Save' }))

      const prompt = screen.getByRole('textbox', { name: 'System prompt' })
      await waitFor(() =>
        expect(prompt).toHaveAttribute('aria-invalid', 'true'),
      )
      expect(prompt).toHaveAccessibleDescription(
        'The prompt is 312 characters over.',
      )
    })

    it('shows a non-field failure in a note', async () => {
      const user = userEvent.setup()
      mockUpdateSettings.mockRejectedValue(new Error('Gateway timeout'))
      renderPage()
      await loaded()

      await user.type(
        screen.getByRole('textbox', { name: 'System prompt' }),
        '!',
      )
      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Gateway timeout',
      )
    })
  })

  describe('reset', () => {
    it('asks first and leaves the settings alone when kept', async () => {
      const user = userEvent.setup()
      renderPage()
      await loaded()

      await user.click(screen.getByRole('button', { name: 'Reset' }))

      const dialog = await screen.findByRole('dialog', { name: RESET_TITLE })
      expect(dialog).toHaveTextContent('Reset settings to the defaults?')
      expect(dialog).toHaveTextContent('Your current ones are lost.')
      expect(mockResetSettings).not.toHaveBeenCalled()

      await user.click(
        within(dialog).getByRole('button', { name: 'Keep my settings' }),
      )

      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: RESET_TITLE }),
        ).not.toBeInTheDocument(),
      )
      expect(mockResetSettings).not.toHaveBeenCalled()
    })

    it('resets on confirm, then closes and toasts', async () => {
      const user = userEvent.setup()
      const defaults = {
        ...SAVED,
        systemPrompt: 'Default prompt.',
        updatedAt: '2026-10-25T10:00:00.000Z',
      }
      mockResetSettings.mockImplementation(async () => {
        mockGetSettings.mockResolvedValue(defaults)
        return defaults
      })
      renderPage()
      await loaded()

      await user.click(screen.getByRole('button', { name: 'Reset' }))
      const dialog = await screen.findByRole('dialog', { name: RESET_TITLE })
      await user.click(
        within(dialog).getByRole('button', { name: 'Reset settings' }),
      )

      expect(mockResetSettings).toHaveBeenCalledTimes(1)
      await waitFor(() =>
        expect(
          screen.getByRole('textbox', { name: 'System prompt' }),
        ).toHaveValue('Default prompt.'),
      )
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: RESET_TITLE }),
        ).not.toBeInTheDocument(),
      )
      expect(
        await screen.findByText('Settings reset to the defaults'),
      ).toBeInTheDocument()
    })
  })
})
