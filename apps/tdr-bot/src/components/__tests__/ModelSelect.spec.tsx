import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ModelSelect } from 'src/components/ModelSelect'
import type { ModelSpec } from 'src/llm/models/catalog'

const mockGetModels = jest.fn()

// The ApiClient is the boundary: the hook under test is real, the network is
// not. The delegating arrows keep `mockGetModels` out of the module-eval TDZ.
jest.mock('src/api/api.client', () => ({
  ...jest.requireActual('src/api/api.client'),
  ApiClient: class {
    getModels = (role: string) => mockGetModels(role)
  },
}))

const caps = {
  tools: true,
  structuredOutput: true,
  temperature: true,
  reasoningEffort: false,
  vision: false,
  image: false,
}

const CHAT: ModelSpec[] = [
  {
    id: 'gpt-4.1',
    provider: 'openai',
    label: 'GPT-4.1',
    description: 'Strong non-reasoning model.',
    roles: ['chat'],
    capabilities: caps,
    pricing: { inputPer1M: 2, outputPer1M: 8 },
  },
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    label: 'GPT-4.1 mini',
    description: 'Balanced speed and cost.',
    roles: ['chat'],
    capabilities: caps,
    pricing: { inputPer1M: 0.4, outputPer1M: 1.6 },
  },
  {
    id: 'image-1',
    provider: 'openai',
    label: 'Image 1',
    description: 'Draws pictures.',
    roles: ['chat'],
    capabilities: caps,
    pricing: null,
  },
]

function renderSelect(
  props: Partial<React.ComponentProps<typeof ModelSelect>> = {},
) {
  const onChange = jest.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ModelSelect
        label="Chat"
        role="chat"
        value="gpt-4.1"
        onChange={onChange}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onChange }
}

describe('ModelSelect', () => {
  beforeEach(() => {
    mockGetModels.mockResolvedValue(CHAT)
  })

  it('shows the chosen model with its description and per-1M price', async () => {
    renderSelect()

    const trigger = await screen.findByRole('combobox', { name: 'Chat' })

    await within(trigger).findByText('GPT-4.1')
    expect(trigger).toHaveTextContent('Strong non-reasoning model.')
    expect(trigger).toHaveTextContent('$2.00 in · $8.00 out')
    expect(mockGetModels).toHaveBeenCalledWith('chat')
  })

  it('is disabled while the catalog loads', () => {
    mockGetModels.mockReturnValue(new Promise(() => undefined))
    renderSelect()

    expect(screen.getByRole('combobox', { name: 'Chat' })).toBeDisabled()
  })

  it('lists every model with label, description and price, and reports a pick', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelect()

    await user.click(await screen.findByRole('combobox', { name: 'Chat' }))
    const options = await screen.findAllByRole('option')

    expect(options).toHaveLength(3)
    expect(options[1]).toHaveTextContent('GPT-4.1 mini')
    expect(options[1]).toHaveTextContent('Balanced speed and cost.')
    expect(options[1]).toHaveTextContent('$0.40 in · $1.60 out')
    expect(options[2]).toHaveTextContent('per image')

    await user.click(options[1])

    expect(onChange).toHaveBeenCalledWith('gpt-4.1-mini')
  })

  it('keeps a value that is no longer in the catalog visible but not pickable', async () => {
    const user = userEvent.setup()
    renderSelect({ value: 'gpt-retired' })

    const trigger = await screen.findByRole('combobox', { name: 'Chat' })
    expect(trigger).toHaveTextContent('gpt-retired')

    await user.click(trigger)
    const retired = (await screen.findAllByRole('option')).find(o =>
      o.textContent?.includes('gpt-retired'),
    )

    expect(retired).toHaveAttribute('aria-disabled', 'true')
  })

  it('shows the error under the control and flags it invalid', async () => {
    renderSelect({ error: 'gpt-4.5-turbo isn’t on the allow-list.' })

    const trigger = await screen.findByRole('combobox', { name: 'Chat' })

    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAccessibleDescription(
      'gpt-4.5-turbo isn’t on the allow-list.',
    )
  })

  it('respects disabled', async () => {
    renderSelect({ disabled: true })

    expect(await screen.findByRole('combobox', { name: 'Chat' })).toBeDisabled()
  })
})
