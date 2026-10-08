import { toReminderView } from 'src/api/reminder-views'
import type { Reminder } from 'src/db/schema'

function row(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r1',
    userId: 'u1',
    userName: 'stored',
    guildId: 'g1',
    what: 'stretch',
    isRecurring: false,
    cronExpression: null,
    scheduledAt: new Date('2026-10-08T12:00:00Z'),
    endsAt: null,
    scheduleDescription: 'Oct 8',
    channelId: null,
    targetUserId: null,
    actionType: 'default',
    status: 'active',
    source: 'discord',
    nextRunAt: new Date('2026-10-08T12:00:00Z'),
    lastRunAt: null,
    runCount: 0,
    createdAt: new Date('2026-10-07T00:00:00Z'),
    updatedAt: new Date('2026-10-07T01:00:00Z'),
    cancelledAt: null,
    ...overrides,
  }
}

const none = { userName: () => null, channelName: () => null }

describe('toReminderView', () => {
  it('serialises dates as ISO strings and keeps nulls', () => {
    const view = toReminderView(row(), none)

    expect(view).toMatchObject({
      scheduledAt: '2026-10-08T12:00:00.000Z',
      nextRunAt: '2026-10-08T12:00:00.000Z',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T01:00:00.000Z',
      endsAt: null,
      lastRunAt: null,
      cancelledAt: null,
      channelId: null,
      channelName: null,
      targetUserId: null,
      targetUserName: null,
    })
  })

  it('prefers the resolved user name, then the stored one, then the id', () => {
    expect(
      toReminderView(row(), { ...none, userName: () => 'Mika' }).userName,
    ).toBe('Mika')
    expect(toReminderView(row(), none).userName).toBe('stored')
    expect(toReminderView(row({ userName: '' }), none).userName).toBe('u1')
  })

  it('falls back to ids for unresolved target and channel', () => {
    const view = toReminderView(
      row({ targetUserId: 'u2', channelId: 'c1' }),
      none,
    )

    expect(view.targetUserName).toBe('u2')
    expect(view.channelName).toBe('c1')
  })

  it('resolves target and channel names', () => {
    const view = toReminderView(row({ targetUserId: 'u2', channelId: 'c1' }), {
      userName: id => `name-${id}`,
      channelName: id => `#${id}`,
    })

    expect(view.targetUserName).toBe('name-u2')
    expect(view.channelName).toBe('#c1')
  })
})
