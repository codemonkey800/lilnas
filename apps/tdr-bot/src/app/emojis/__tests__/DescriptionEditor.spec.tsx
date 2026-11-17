import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { EmojiView } from 'src/api/api.types'
import { DescriptionEditor } from 'src/app/emojis/DescriptionEditor'
import { DESCRIPTION_MAX } from 'src/app/emojis/format'

const mockUpdateEmoji = jest.fn()

jest.mock('src/api/api.client', () => ({
  ...jest.requireActual('src/api/api.client'),
  ApiClient: class {
    updateEmoji = (id: string, body: unknown) => mockUpdateEmoji(id, body)
  },
}))

const EMOJI: EmojiView = {
  id: 'id-pepe',
  guildId: 'g1',
  name: 'pepe',
  animated: false,
  key: '<:pepe:1>',
  imageUrl: 'https://cdn.example/pepe.png',
  description: 'A smug green frog.',
  source: 'ai',
  model: 'gpt-5-mini',
  describedAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
  updatedAt: '2026-10-22T00:00:00.000Z',
}

function renderEditor(onClose = jest.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <DescriptionEditor emoji={EMOJI} onClose={onClose} />
    </QueryClientProvider>,
  )
  return { onClose }
}

const box = () => screen.getByRole('textbox', { name: 'Description of :pepe:' })
const save = () => screen.getByRole('button', { name: 'Save' })

describe('DescriptionEditor', () => {
  it('starts on the current description with Save off and the counter set', () => {
    renderEditor()

    expect(box()).toHaveValue('A smug green frog.')
    expect(box()).toHaveFocus()
    expect(save()).toBeDisabled()
    expect(screen.getByText(`18 / ${DESCRIPTION_MAX}`)).toBeInTheDocument()
    expect(
      screen.getByText('Saving marks this description as manual.'),
    ).toBeInTheDocument()
  })

  it('saves the trimmed edit through PATCH and closes', async () => {
    mockUpdateEmoji.mockResolvedValue({ ...EMOJI, source: 'manual' })
    const { onClose } = renderEditor()

    await userEvent.clear(box())
    await userEvent.type(box(), '  A very sad frog.  ')
    expect(save()).toBeEnabled()
    await userEvent.click(save())

    expect(mockUpdateEmoji).toHaveBeenCalledWith('id-pepe', {
      description: 'A very sad frog.',
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('keeps Save off for a blank draft', async () => {
    renderEditor()

    await userEvent.clear(box())

    expect(save()).toBeDisabled()
  })

  it('restores the description and closes on cancel', async () => {
    const { onClose } = renderEditor()

    await userEvent.type(box(), ' edited')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockUpdateEmoji).not.toHaveBeenCalled()
  })

  it('shows the error and stays open when the save fails', async () => {
    mockUpdateEmoji.mockRejectedValue(new Error('too long'))
    const { onClose } = renderEditor()

    await userEvent.type(box(), '!')
    await userEvent.click(save())

    expect(await screen.findByRole('alert')).toHaveTextContent('too long')
    expect(onClose).not.toHaveBeenCalled()
  })
})
