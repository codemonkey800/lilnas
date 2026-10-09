import type { ReminderView } from 'src/api/api.types'
import {
  relativeTime,
  scheduleLines,
  statusTone,
  whoLabel,
} from 'src/app/reminders/format'
import { ReminderActionType } from 'src/reminders/reminder.types'

const now = new Date('2026-10-07T12:00:00.000Z')

function view(overrides: Partial<ReminderView> = {}): ReminderView {
  return {
    id: 'r1',
    status: 'active',
    source: 'discord',
    what: 'Take out the trash',
    userId: 'u1',
    userName: 'jeremy',
    targetUserIds: [],
    targetUserNames: [],
    guildId: 'g1',
    channelId: null,
    channelName: null,
    isRecurring: false,
    cronExpression: null,
    scheduledAt: '2026-10-08T12:00:00.000Z',
    endsAt: null,
    scheduleDescription: 'once',
    nextRunAt: '2026-10-08T12:00:00.000Z',
    lastRunAt: null,
    runCount: 0,
    actionType: ReminderActionType.Default,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    cancelledAt: null,
    ...overrides,
  }
}

describe('relativeTime', () => {
  it('returns an em dash for null', () => {
    expect(relativeTime(null, now)).toBe('—')
  })

  it('formats the future', () => {
    expect(relativeTime('2026-10-07T12:38:00.000Z', now)).toBe('in 38 min')
    expect(relativeTime('2026-10-07T14:00:00.000Z', now)).toBe('in 2 h')
    expect(relativeTime('2026-10-13T12:00:00.000Z', now)).toBe('in 6 d')
  })

  it('formats the past', () => {
    expect(relativeTime('2026-10-07T11:15:00.000Z', now)).toBe('45 min ago')
    expect(relativeTime('2026-10-07T09:00:00.000Z', now)).toBe('3 h ago')
    expect(relativeTime('2026-10-04T12:00:00.000Z', now)).toBe('3 d ago')
  })

  it('says now within a minute', () => {
    expect(relativeTime('2026-10-07T12:00:30.000Z', now)).toBe('now')
  })
})

describe('whoLabel', () => {
  it('shows only the creator for a self reminder', () => {
    expect(whoLabel(view())).toBe('jeremy')
  })

  it('shows creator and target', () => {
    expect(
      whoLabel(view({ userName: 'jeremy', targetUserNames: ['sam'] })),
    ).toBe('jeremy → @sam')
  })

  it('lists every target', () => {
    expect(whoLabel(view({ targetUserNames: ['sam', 'mika'] }))).toBe(
      'jeremy → @sam, @mika',
    )
  })

  it('shows admin for admin-created reminders', () => {
    expect(
      whoLabel(view({ source: 'admin', targetUserNames: ['jeremy'] })),
    ).toBe('admin')
  })
})

describe('scheduleLines', () => {
  it('has only the description for a one-time reminder', () => {
    expect(scheduleLines(view())).toEqual(['once'])
  })

  it('adds the cron for a recurring reminder', () => {
    expect(
      scheduleLines(
        view({
          isRecurring: true,
          cronExpression: '0 10 * * 2',
          scheduleDescription: 'every Tuesday at 10:00 AM',
        }),
      ),
    ).toEqual(['every Tuesday at 10:00 AM', '0 10 * * 2'])
  })

  it('adds the end date when there is one', () => {
    const lines = scheduleLines(
      view({
        isRecurring: true,
        cronExpression: '30 7 * * *',
        scheduleDescription: 'every day at 7:30 AM',
        endsAt: '2026-10-31T12:00:00.000Z',
      }),
    )
    expect(lines).toHaveLength(3)
    expect(lines[2]).toMatch(/^Ends .*31/)
  })
})

describe('statusTone', () => {
  it('maps every status', () => {
    expect(statusTone('active')).toBe('ok')
    expect(statusTone('completed')).toBe('muted')
    expect(statusTone('missed')).toBe('warn')
    expect(statusTone('cancelled')).toBe('bad')
  })
})
