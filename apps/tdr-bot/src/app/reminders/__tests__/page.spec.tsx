import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ReminderFilter, ReminderView } from 'src/api/api.types'
import RemindersPage from 'src/app/reminders/page'
import { ReminderActionType } from 'src/reminders/reminder.types'

const mockGetReminders = jest.fn()
const mockCancelReminder = jest.fn()
const mockGetMembers = jest.fn()
const mockGetChannels = jest.fn()

// The ApiClient is the boundary: the react-query hooks are real, the network
// is not. The delegating arrows keep the mocks out of the module-eval TDZ.
jest.mock('src/api/api.client', () => ({
  ...jest.requireActual('src/api/api.client'),
  ApiClient: class {
    getReminders = (filter: unknown) => mockGetReminders(filter)
    cancelReminder = (id: string) => mockCancelReminder(id)
    getMembers = () => mockGetMembers()
    getChannels = () => mockGetChannels()
  },
}))

function reminder(
  id: string,
  what: string,
  status: ReminderView['status'],
  overrides: Partial<ReminderView> = {},
): ReminderView {
  return {
    id,
    status,
    source: 'discord',
    what,
    userId: `u-${id}`,
    userName: 'sam',
    targetUserIds: [],
    targetUserNames: [],
    guildId: 'g1',
    channelId: null,
    channelName: null,
    isRecurring: false,
    cronExpression: null,
    scheduledAt: '2026-10-26T09:00:00.000Z',
    endsAt: null,
    scheduleDescription: 'Once, Mon Oct 26 at 9:00 AM',
    nextRunAt: status === 'active' ? '2099-01-01T09:00:00.000Z' : null,
    lastRunAt: null,
    runCount: 0,
    actionType: ReminderActionType.Default,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    cancelledAt: null,
    ...overrides,
  }
}

const REMINDERS: ReminderView[] = [
  reminder('1', 'Take out the trash', 'active', {
    isRecurring: true,
    cronExpression: '0 10 * * 2',
    scheduleDescription: 'Every Tuesday at 10:00 AM',
    channelName: 'chores',
  }),
  reminder('2', 'Check the weather in Lisbon', 'active', {
    userName: 'mika',
    targetUserNames: ['zed'],
  }),
  reminder('3', 'Renew the domain', 'completed', {
    lastRunAt: '2026-10-01T09:00:00.000Z',
    runCount: 1,
  }),
  reminder('4', 'Drink water', 'cancelled'),
  reminder('5', 'Pay rent', 'missed'),
]

function mockReminders(all: ReminderView[]) {
  mockGetReminders.mockImplementation(async (filter: ReminderFilter) =>
    filter.status === 'all' ? all : all.filter(r => r.status === filter.status),
  )
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <RemindersPage />
    </QueryClientProvider>,
  )
}

const tab = (name: string) =>
  screen.getByRole('tab', { name: new RegExp(name) })

describe('RemindersPage', () => {
  beforeEach(() => {
    mockReminders(REMINDERS)
    mockGetMembers.mockResolvedValue([])
    mockGetChannels.mockResolvedValue([])
  })

  it('shows skeleton rows while reminders load', () => {
    mockGetReminders.mockReturnValue(new Promise(() => undefined))
    renderPage()

    expect(
      screen.getByRole('heading', { name: 'Reminders' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Loading reminders' }),
    ).toBeInTheDocument()
  })

  it('lists the active reminders first, with a status badge on each', async () => {
    renderPage()

    expect(
      (await screen.findAllByText('Take out the trash')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText('Check the weather in Lisbon').length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Renew the domain')).not.toBeInTheDocument()
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(tab('Active')).toHaveAttribute('aria-selected', 'true')
    expect(mockGetReminders).toHaveBeenCalledWith({ status: 'active' })
  })

  it('counts every status on its tab', async () => {
    renderPage()
    await screen.findAllByText('Take out the trash')

    await waitFor(() =>
      expect(within(tab('Active')).getByText('2')).toBeInTheDocument(),
    )
    expect(within(tab('Completed')).getByText('1')).toBeInTheDocument()
    expect(within(tab('Cancelled')).getByText('1')).toBeInTheDocument()
    expect(within(tab('Missed')).getByText('1')).toBeInTheDocument()
    expect(within(tab('All')).getByText('5')).toBeInTheDocument()
  })

  it('switches the list when another status tab is picked', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Take out the trash')

    await user.click(tab('Missed'))

    expect((await screen.findAllByText('Pay rent')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Take out the trash')).not.toBeInTheDocument()
    expect(mockGetReminders).toHaveBeenCalledWith({ status: 'missed' })
    expect(screen.getAllByText('Missed').length).toBeGreaterThan(0)

    await user.click(tab('All'))

    expect(
      (await screen.findAllByText('Renew the domain')).length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Take out the trash').length).toBeGreaterThan(0)
    for (const label of ['Active', 'Completed', 'Cancelled', 'Missed']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('filters by who or what as you type', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Take out the trash')

    await user.type(
      screen.getByRole('textbox', { name: 'Filter reminders' }),
      'LISBON',
    )
    expect(screen.queryByText('Take out the trash')).not.toBeInTheDocument()
    expect(
      screen.getAllByText('Check the weather in Lisbon').length,
    ).toBeGreaterThan(0)

    // The target's name counts too.
    await user.clear(screen.getByRole('textbox', { name: 'Filter reminders' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Filter reminders' }),
      'zed',
    )
    expect(
      screen.getAllByText('Check the weather in Lisbon').length,
    ).toBeGreaterThan(0)
    expect(screen.queryByText('Take out the trash')).not.toBeInTheDocument()
  })

  it('names the search when nothing matches, and Clear search brings the list back', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Take out the trash')

    await user.type(
      screen.getByRole('textbox', { name: 'Filter reminders' }),
      'nope',
    )

    expect(
      screen.getByRole('heading', { name: 'No matching reminders' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Nothing matches “nope”/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(screen.getAllByText('Take out the trash').length).toBeGreaterThan(0)
    expect(
      screen.getByRole('textbox', { name: 'Filter reminders' }),
    ).toHaveValue('')
  })

  it('shows one New reminder action when the status has nothing', async () => {
    mockReminders(REMINDERS.filter(r => r.status !== 'active'))
    const user = userEvent.setup()
    renderPage()

    const empty = await screen.findByRole('heading', {
      name: 'No active reminders',
    })
    expect(
      screen.getByText('Create one here, or ask tdr-bot in Discord.'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(within(tab('Active')).getByText('0')).toBeInTheDocument(),
    )

    const panel = empty.parentElement as HTMLElement
    await user.click(
      within(panel).getByRole('button', { name: 'New reminder' }),
    )

    expect(
      await screen.findByRole('heading', { name: 'New reminder' }),
    ).toBeInTheDocument()
  })

  it('shows an error note when reminders fail to load', async () => {
    mockGetReminders.mockRejectedValue(new Error('down'))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t load reminders.')
    expect(alert).toHaveTextContent('Reload the page to try again.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('confirms by name before cancelling a reminder', async () => {
    mockCancelReminder.mockResolvedValue(REMINDERS[0])
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Take out the trash')

    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])

    const dialog = await screen.findByRole('dialog', {
      name: 'Cancel “Take out the trash”?',
    })
    expect(dialog).toHaveTextContent('cancelling stops every future run')

    await user.click(
      within(dialog).getByRole('button', { name: 'Cancel reminder' }),
    )

    await waitFor(() => expect(mockCancelReminder).toHaveBeenCalledWith('1'))
  })
})
