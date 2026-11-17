import { ToastProvider } from '@lilnas/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { EmojiListResponse, EmojiView } from 'src/api/api.types'
import EmojisPage from 'src/app/emojis/page'

const mockGetEmojis = jest.fn()
const mockUpdateEmoji = jest.fn()
const mockRedescribeEmoji = jest.fn()
const mockReconcileEmojis = jest.fn()
const mockRedescribeAllEmojis = jest.fn()

// The ApiClient is the boundary: the react-query hooks are real, the network
// is not. The delegating arrows keep the mocks out of the module-eval TDZ.
jest.mock('src/api/api.client', () => ({
  ...jest.requireActual('src/api/api.client'),
  ApiClient: class {
    getEmojis = () => mockGetEmojis()
    updateEmoji = (id: string, body: unknown) => mockUpdateEmoji(id, body)
    redescribeEmoji = (id: string) => mockRedescribeEmoji(id)
    reconcileEmojis = () => mockReconcileEmojis()
    redescribeAllEmojis = () => mockRedescribeAllEmojis()
  },
}))

const emoji = (over: Partial<EmojiView> & { name: string }): EmojiView => ({
  id: `id-${over.name}`,
  guildId: 'g1',
  animated: false,
  key: `<:${over.name}:1>`,
  imageUrl: `https://cdn.example/${over.name}.png`,
  description: null,
  source: null,
  model: null,
  describedAt: null,
  deletedAt: null,
  updatedAt: '2026-10-22T00:00:00.000Z',
  ...over,
})

const EMOJIS: EmojiView[] = [
  emoji({
    name: 'pepe',
    description: 'A smug green frog.',
    source: 'ai',
    model: 'gpt-5-mini',
    describedAt: '2026-10-20T10:00:00.000Z',
  }),
  emoji({
    name: 'hypers',
    description: 'A frog shaking with excitement.',
    source: 'manual',
    describedAt: '2026-10-21T10:00:00.000Z',
  }),
  emoji({ name: 'blank' }),
  emoji({
    name: 'gone',
    description: 'An old one.',
    source: 'ai',
    model: 'gpt-5-mini',
    describedAt: '2026-10-01T10:00:00.000Z',
    deletedAt: '2026-10-02T10:00:00.000Z',
  }),
]

const IDLE = { running: false, last: null }

const response = (
  emojis: EmojiView[],
  reconcile: EmojiListResponse['reconcile'] = IDLE,
): EmojiListResponse => ({ emojis, reconcile })

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <EmojisPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function loaded() {
  await screen.findByText(':pepe:')
}

const tab = (name: RegExp | string) => screen.getByRole('tab', { name })
const cards = () => screen.getAllByRole('listitem')

describe('EmojisPage', () => {
  beforeEach(() => {
    mockGetEmojis.mockResolvedValue(response(EMOJIS))
  })

  it('shows skeleton cards while the emojis load', () => {
    mockGetEmojis.mockReturnValue(new Promise(() => undefined))
    renderPage()

    expect(screen.getByRole('heading', { name: 'Emojis' })).toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Loading emojis' }),
    ).toBeInTheDocument()
  })

  it('shows an error note when the list fails to load', async () => {
    mockGetEmojis.mockRejectedValue(new Error('down'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t load the emojis.',
    )
  })

  it('renders a card per emoji with its source badge', async () => {
    renderPage()
    await loaded()

    expect(cards()).toHaveLength(4)
    expect(within(cards()[0]).getByText('AI')).toBeInTheDocument()
    expect(within(cards()[1]).getByText('Manual')).toBeInTheDocument()
    expect(within(cards()[2]).getByText('Pending')).toBeInTheDocument()
    expect(
      within(cards()[2]).getByText('Waiting for a description'),
    ).toBeVisible()
    expect(within(cards()[3]).getByText('Deleted')).toBeInTheDocument()
    // Deleted cards are read-only.
    expect(
      within(cards()[3]).queryByRole('button', { name: /Edit/ }),
    ).not.toBeInTheDocument()
  })

  it('shows a count on every filter tab', async () => {
    renderPage()
    await loaded()

    expect(tab('All 4')).toBeInTheDocument()
    expect(tab('Needs description 1')).toBeInTheDocument()
    expect(tab('AI 2')).toBeInTheDocument()
    expect(tab('Manual 1')).toBeInTheDocument()
    expect(tab('Deleted 1')).toBeInTheDocument()
  })

  it.each([
    ['Needs description 1', [':blank:']],
    ['AI 2', [':pepe:', ':gone:']],
    ['Manual 1', [':hypers:']],
    ['Deleted 1', [':gone:']],
  ])('filters by the %s tab', async (name, names) => {
    renderPage()
    await loaded()

    await userEvent.click(tab(name))

    expect(cards().map(c => within(c).getByText(/^:.+:$/).textContent)).toEqual(
      names,
    )
    expect(tab(name)).toHaveAttribute('aria-selected', 'true')
  })

  it('searches the name and the description', async () => {
    renderPage()
    await loaded()
    const search = screen.getByRole('searchbox', { name: 'Search emojis' })

    await userEvent.type(search, 'excite')
    expect(cards()).toHaveLength(1)
    expect(screen.getByText(':hypers:')).toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'PEPE')
    expect(cards()).toHaveLength(1)
    expect(screen.getByText(':pepe:')).toBeInTheDocument()
  })

  it('says nothing matches, and clears the search from the empty state', async () => {
    renderPage()
    await loaded()

    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Search emojis' }),
      'zzz',
    )

    expect(
      screen.getByRole('heading', { name: 'No matching emojis' }),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(cards()).toHaveLength(4)
    expect(
      screen.getByRole('searchbox', { name: 'Search emojis' }),
    ).toHaveValue('')
  })

  it('edits in place and restores the description on cancel', async () => {
    renderPage()
    await loaded()

    await userEvent.click(screen.getByRole('button', { name: 'Edit :pepe:' }))
    const box = screen.getByRole('textbox', { name: 'Description of :pepe:' })
    await userEvent.type(box, ' edited')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(
      screen.queryByRole('textbox', { name: 'Description of :pepe:' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('A smug green frog.')).toBeInTheDocument()
    expect(mockUpdateEmoji).not.toHaveBeenCalled()
  })

  it('saves an edit through PATCH and returns to the card', async () => {
    mockUpdateEmoji.mockResolvedValue({ ...EMOJIS[0], source: 'manual' })
    renderPage()
    await loaded()

    await userEvent.click(screen.getByRole('button', { name: 'Edit :pepe:' }))
    const box = screen.getByRole('textbox', { name: 'Description of :pepe:' })
    await userEvent.clear(box)
    await userEvent.type(box, 'Sad.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockUpdateEmoji).toHaveBeenCalledWith('id-pepe', {
      description: 'Sad.',
    })
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Description of :pepe:' }),
      ).not.toBeInTheDocument(),
    )
  })

  describe('reconcile', () => {
    it('shows the last run and no running badge when idle', async () => {
      mockGetEmojis.mockResolvedValue(
        response(EMOJIS, {
          running: false,
          last: {
            trigger: 'boot',
            finishedAt: '2026-10-22T09:01:00.000Z',
            synced: 140,
            softDeleted: 0,
            durationMs: 60_000,
            described: 2,
            failed: 0,
          },
        }),
      )
      renderPage()
      await loaded()

      expect(screen.getByText(/Last reconcile .*\(boot\)/)).toBeInTheDocument()
      expect(screen.queryByText('Reconciling')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Run reconcile now' }),
      ).toBeEnabled()
    })

    it('shows the live badge, busy buttons and describing rows while running', async () => {
      mockGetEmojis.mockResolvedValue(
        response(EMOJIS, { running: true, last: null }),
      )
      renderPage()
      await loaded()

      expect(await screen.findByText('Reconciling')).toBeInTheDocument()
      expect(screen.getByText('Run in progress…')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Reconciling…' }),
      ).toHaveAttribute('aria-disabled', 'true')
      expect(
        screen.getByRole('button', { name: 'Re-describe all' }),
      ).toBeDisabled()
      expect(screen.getByText('Describing…')).toBeInTheDocument()
    })

    it('starts a reconcile and keeps the buttons busy until the poll lands', async () => {
      mockReconcileEmojis.mockResolvedValue({ started: true })
      renderPage()
      await loaded()

      mockGetEmojis.mockResolvedValue(
        response(EMOJIS, { running: true, last: null }),
      )
      await userEvent.click(
        screen.getByRole('button', { name: 'Run reconcile now' }),
      )

      expect(mockReconcileEmojis).toHaveBeenCalledTimes(1)
      expect(await screen.findByText('Reconciling')).toBeInTheDocument()
    })

    it('shows a dismissible error when the reconcile cannot start', async () => {
      mockReconcileEmojis.mockRejectedValue(new Error('bot is restarting'))
      renderPage()
      await loaded()

      await userEvent.click(
        screen.getByRole('button', { name: 'Run reconcile now' }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Couldn’t start a reconcile.')
      expect(alert).toHaveTextContent('bot is restarting')

      await userEvent.click(
        within(alert).getByRole('button', { name: 'Dismiss' }),
      )

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('re-describe', () => {
    it('re-describes an AI emoji straight away', async () => {
      mockRedescribeEmoji.mockResolvedValue(EMOJIS[0])
      renderPage()
      await loaded()

      await userEvent.click(
        screen.getByRole('button', { name: 'Re-describe :pepe:' }),
      )

      expect(mockRedescribeEmoji).toHaveBeenCalledWith('id-pepe')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('asks first for a manual emoji, then replaces it', async () => {
      mockRedescribeEmoji.mockResolvedValue(EMOJIS[1])
      renderPage()
      await loaded()

      await userEvent.click(
        screen.getByRole('button', { name: 'Re-describe :hypers:' }),
      )

      const dialog = await screen.findByRole('dialog', {
        name: 'Re-describe :hypers:?',
      })
      expect(dialog).toHaveTextContent('The old text isn’t kept.')
      expect(dialog).toHaveTextContent('A frog shaking with excitement.')
      expect(mockRedescribeEmoji).not.toHaveBeenCalled()

      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Re-describe' }),
      )

      expect(mockRedescribeEmoji).toHaveBeenCalledWith('id-hypers')
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      )
    })

    it('keeps a manual description when the dialog is cancelled', async () => {
      renderPage()
      await loaded()

      await userEvent.click(
        screen.getByRole('button', { name: 'Re-describe :hypers:' }),
      )
      const dialog = await screen.findByRole('dialog', {
        name: 'Re-describe :hypers:?',
      })
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Keep it' }),
      )

      expect(mockRedescribeEmoji).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      )
    })

    it('shows a dismissible error when a re-describe fails', async () => {
      mockRedescribeEmoji.mockRejectedValue(new Error('model timed out'))
      renderPage()
      await loaded()

      await userEvent.click(
        screen.getByRole('button', { name: 'Re-describe :pepe:' }),
      )

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Couldn’t re-describe :pepe:.')
      expect(alert).toHaveTextContent('model timed out')

      await userEvent.click(
        within(alert).getByRole('button', { name: 'Dismiss' }),
      )

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('re-describe all', () => {
    it('confirms with the live count and the manual warning', async () => {
      mockRedescribeAllEmojis.mockResolvedValue({ started: true })
      renderPage()
      await loaded()

      await userEvent.click(
        screen.getByRole('button', { name: 'Re-describe all' }),
      )

      // Three live emojis; the deleted one is out of scope.
      const dialog = await screen.findByRole('dialog', {
        name: 'Re-describe all 3 emojis?',
      })
      expect(dialog).toHaveTextContent('1 manual description')
      expect(dialog).toHaveTextContent('will be replaced')

      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Re-describe all' }),
      )

      expect(mockRedescribeAllEmojis).toHaveBeenCalledTimes(1)
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      )
    })

    it('does nothing when cancelled', async () => {
      renderPage()
      await loaded()

      await userEvent.click(
        screen.getByRole('button', { name: 'Re-describe all' }),
      )
      const dialog = await screen.findByRole('dialog', {
        name: 'Re-describe all 3 emojis?',
      })
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      )

      expect(mockRedescribeAllEmojis).not.toHaveBeenCalled()
    })
  })

  describe('empty state', () => {
    beforeEach(() => {
      mockGetEmojis.mockResolvedValue(response([]))
    })

    it('says nothing is synced, with a reconcile action', async () => {
      mockReconcileEmojis.mockResolvedValue({ started: true })
      renderPage()

      expect(
        await screen.findByRole('heading', { name: 'No emojis synced yet' }),
      ).toBeInTheDocument()
      expect(tab('All 0')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Re-describe all' }),
      ).toBeDisabled()

      const empty = screen.getByRole('heading', {
        name: 'No emojis synced yet',
      }).parentElement as HTMLElement
      await userEvent.click(
        within(empty).getByRole('button', { name: 'Run reconcile now' }),
      )

      expect(mockReconcileEmojis).toHaveBeenCalledTimes(1)
    })
  })
})
