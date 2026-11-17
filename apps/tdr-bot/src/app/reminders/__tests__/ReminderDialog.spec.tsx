import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ApiRequestError } from 'src/api/api.client'
import type { ReminderView } from 'src/api/api.types'
import { ReminderDialog } from 'src/app/reminders/ReminderDialog'
import { ReminderActionType } from 'src/reminders/reminder.types'

const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockPreview = jest.fn()
const mockGetMembers = jest.fn()
const mockGetChannels = jest.fn()

// The ApiClient is the boundary: the react-query hooks are real, the network
// is not. The delegating arrows keep the mocks out of the module-eval TDZ.
jest.mock('src/api/api.client', () => ({
  ...jest.requireActual('src/api/api.client'),
  ApiClient: class {
    createReminder = (body: unknown) => mockCreate(body)
    updateReminder = (id: string, body: unknown) => mockUpdate(id, body)
    previewReminder = (schedule: unknown) => mockPreview(schedule)
    getMembers = () => mockGetMembers()
    getChannels = () => mockGetChannels()
  },
}))

const MEMBERS = [
  { id: 'm1', username: 'sam', displayName: 'Sam R.', avatarUrl: null },
  { id: 'm2', username: 'sasha', displayName: 'Sasha K.', avatarUrl: null },
  { id: 'm3', username: 'rosa', displayName: 'Rosa M.', avatarUrl: null },
]

const RUNS = [
  '2099-01-05T09:00:00.000Z',
  '2099-01-06T09:00:00.000Z',
  '2099-01-07T09:00:00.000Z',
]

function renderDialog(reminder: ReminderView | null = null) {
  const onClose = jest.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ReminderDialog open reminder={reminder} onClose={onClose} />
    </QueryClientProvider>,
  )

  return { onClose }
}

async function pickMember(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByRole('combobox', { name: 'For' })
  await user.click(input)
  await user.type(input, 'sa')
  await user.click(await screen.findByRole('option', { name: /sam · Sam R\./ }))
}

const createButton = () =>
  screen.getByRole('button', { name: 'Create reminder' })

describe('ReminderDialog', () => {
  beforeEach(() => {
    mockGetMembers.mockResolvedValue(MEMBERS)
    mockGetChannels.mockResolvedValue([
      { id: 'c1', name: 'tdr-bot-chat', type: 'text' },
    ])
    mockPreview.mockResolvedValue({ runs: RUNS })
    mockCreate.mockResolvedValue({})
    mockUpdate.mockResolvedValue({})
  })

  it('starts one-time, and Recurring swaps the date for a cron schedule', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(
      screen.getByRole('heading', { name: 'New reminder' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('When')).toHaveAttribute(
      'type',
      'datetime-local',
    )
    expect(screen.queryByLabelText('Cron expression')).not.toBeInTheDocument()
    expect(screen.queryByText('Next 3 runs')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Recurring' }))

    expect(screen.getByLabelText('Cron expression')).toHaveValue('0 9 * * *')
    expect(screen.getByLabelText('Ends on (optional)')).toHaveAttribute(
      'type',
      'date',
    )
    expect(screen.getByText('Next 3 runs')).toBeInTheDocument()
    expect(screen.queryByLabelText('When')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'One-time' }))

    expect(screen.getByLabelText('When')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cron expression')).not.toBeInTheDocument()
  })

  it('fills the cron from a preset, and typing your own switches to Custom', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('radio', { name: 'Recurring' }))

    const pressed = (name: string) =>
      screen.getByRole('button', { name }).getAttribute('aria-pressed')
    expect(pressed('Every day 9 AM')).toBe('true')
    expect(pressed('Custom')).toBe('false')

    await user.click(screen.getByRole('button', { name: 'Weekdays 9 AM' }))

    expect(screen.getByLabelText('Cron expression')).toHaveValue('0 9 * * 1-5')
    expect(pressed('Weekdays 9 AM')).toBe('true')
    expect(pressed('Every day 9 AM')).toBe('false')

    const cron = screen.getByLabelText('Cron expression')
    await user.clear(cron)
    await user.type(cron, '30 7 * * 1')

    expect(pressed('Custom')).toBe('true')
    expect(pressed('Weekdays 9 AM')).toBe('false')

    // Picking Custom keeps what is typed.
    await user.click(screen.getByRole('button', { name: 'Custom' }))
    expect(cron).toHaveValue('30 7 * * 1')
  })

  it('lists the next three runs of a recurring schedule', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('radio', { name: 'Recurring' }))

    const list = screen.getByRole('list', { name: 'Next 3 runs' })
    await waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(3))
    expect(mockPreview).toHaveBeenCalledWith({
      kind: 'recurring',
      cron: '0 9 * * *',
      endsAt: null,
    })
  })

  it('shows a cron the server rejects under the field and disables Create', async () => {
    mockPreview.mockRejectedValue(
      new Error('That isn’t a cron expression. It needs 5 fields.'),
    )
    const user = userEvent.setup()
    renderDialog()
    await pickMember(user)
    await user.type(screen.getByLabelText('What'), 'Drink water')
    await user.click(screen.getByRole('radio', { name: 'Recurring' }))
    const cron = screen.getByLabelText('Cron expression')
    await user.clear(cron)
    await user.type(cron, '0 9 * *')

    const error = await screen.findByText(/That isn’t a cron expression/)
    expect(error).toHaveClass('text-bad')
    expect(cron).toHaveAttribute('aria-invalid', 'true')
    expect(cron).toHaveAccessibleDescription(error.textContent as string)
    expect(createButton()).toBeDisabled()
  })

  it('puts server validation issues on their own fields', async () => {
    mockCreate.mockRejectedValue(
      new ApiRequestError('Invalid', 400, [
        { path: 'what', message: 'Say what to remind about.' },
        { path: 'userId', message: 'That member is not in the server.' },
      ]),
    )
    const user = userEvent.setup()
    renderDialog()
    await pickMember(user)
    await user.type(screen.getByLabelText('What'), 'x')
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2099-01-05T08:00' },
    })
    await waitFor(() => expect(createButton()).toBeEnabled())
    await user.click(createButton())

    expect(await screen.findByText('Say what to remind about.')).toHaveClass(
      'text-bad',
    )
    expect(screen.getByLabelText('What')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByText('That member is not in the server.')).toBeVisible()
    // Field errors stay on their fields, not in a banner.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Editing a field clears the error.
    await user.type(screen.getByLabelText('What'), 'y')
    await waitFor(() =>
      expect(
        screen.queryByText('Say what to remind about.'),
      ).not.toBeInTheDocument(),
    )
  })

  it('shows an error that belongs to no field in a note', async () => {
    mockCreate.mockRejectedValue(
      new ApiRequestError('The bot is offline.', 503),
    )
    const user = userEvent.setup()
    renderDialog()
    await pickMember(user)
    await user.type(screen.getByLabelText('What'), 'Stretch')
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2099-01-05T08:00' },
    })
    await waitFor(() => expect(createButton()).toBeEnabled())
    await user.click(createButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The bot is offline.',
    )
  })

  it('keeps Create disabled until a member, a message and a schedule are set', async () => {
    const user = userEvent.setup()
    renderDialog()
    expect(createButton()).toBeDisabled()

    await pickMember(user)
    await user.type(screen.getByLabelText('What'), 'Stretch')
    expect(createButton()).toBeDisabled()

    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2099-01-05T08:00' },
    })
    await waitFor(() => expect(createButton()).toBeEnabled())
    expect(screen.getByText('7 / 500')).toBeInTheDocument()
  })

  it('submits a one-time reminder', async () => {
    const user = userEvent.setup()
    const { onClose } = renderDialog()
    await pickMember(user)
    await user.type(screen.getByLabelText('What'), '  Stretch  ')
    fireEvent.change(screen.getByLabelText('When'), {
      target: { value: '2099-01-05T08:00' },
    })
    await waitFor(() => expect(createButton()).toBeEnabled())
    await user.click(createButton())

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      userId: 'm1',
      what: 'Stretch',
      schedule: {
        kind: 'once',
        at: new Date('2099-01-05T08:00').toISOString(),
      },
      channelId: null,
      targetUserIds: [],
      actionType: ReminderActionType.Default,
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('submits a recurring reminder from a preset, with an end date and recipients', async () => {
    const user = userEvent.setup()
    renderDialog()
    await pickMember(user)
    await user.type(screen.getByLabelText('What'), 'Stand-up notes')
    await user.click(screen.getByRole('radio', { name: 'Recurring' }))
    await user.click(screen.getByRole('button', { name: 'Weekdays 9 AM' }))
    fireEvent.change(screen.getByLabelText('Ends on (optional)'), {
      target: { value: '2099-02-01' },
    })

    const remind = screen.getByRole('combobox', { name: 'Remind' })
    await user.click(remind)
    await user.type(remind, 'rosa')
    await user.click(
      await screen.findByRole('option', { name: /rosa · Rosa M\./ }),
    )
    expect(
      await screen.findByRole('button', { name: 'Remove rosa' }),
    ).toBeInTheDocument()

    await waitFor(() => expect(createButton()).toBeEnabled())
    await user.click(createButton())

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      userId: 'm1',
      what: 'Stand-up notes',
      schedule: {
        kind: 'recurring',
        cron: '0 9 * * 1-5',
        endsAt: new Date('2099-02-01T23:59:59').toISOString(),
      },
      channelId: null,
      targetUserIds: ['m3'],
      actionType: ReminderActionType.Default,
    })
  })

  it('saves an edit to the same reminder without a new owner', async () => {
    const existing = {
      id: 'r1',
      status: 'active',
      source: 'discord',
      what: 'Take out the trash',
      userId: 'm1',
      userName: 'sam',
      targetUserIds: ['m2'],
      targetUserNames: ['sasha'],
      guildId: 'g1',
      channelId: 'c1',
      channelName: 'tdr-bot-chat',
      isRecurring: true,
      cronExpression: '0 10 * * 2',
      scheduledAt: null,
      endsAt: null,
      scheduleDescription: 'Every Tuesday at 10:00 AM',
      nextRunAt: null,
      lastRunAt: null,
      runCount: 0,
      actionType: ReminderActionType.Default,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      cancelledAt: null,
    } satisfies ReminderView
    const user = userEvent.setup()
    renderDialog(existing)

    expect(
      screen.getByRole('heading', { name: 'Edit reminder' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'For' })).toBeDisabled()
    expect(screen.getByLabelText('Cron expression')).toHaveValue('0 10 * * 2')
    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const what = screen.getByLabelText('What')
    await user.clear(what)
    await user.type(what, 'Take out the recycling')
    const save = screen.getByRole('button', { name: 'Save reminder' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith('r1', {
      what: 'Take out the recycling',
      schedule: { kind: 'recurring', cron: '0 10 * * 2', endsAt: null },
      channelId: 'c1',
      targetUserIds: ['m2'],
      actionType: ReminderActionType.Default,
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
