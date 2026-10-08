import { Reminder } from 'src/db/schema'

/** Builds a complete {@link Reminder} row with every column defaulted. */
export function createTestReminder(
  overrides: Partial<Reminder> = {},
): Reminder {
  const scheduledAt = new Date(Date.now() + 60_000)
  return {
    id: 'reminder-1',
    userId: 'user-1',
    userName: 'tester',
    guildId: 'guild-1',
    what: 'test reminder',
    isRecurring: false,
    cronExpression: null,
    scheduledAt,
    endsAt: null,
    scheduleDescription: 'tomorrow 9:00 AM',
    channelId: null,
    targetUserId: null,
    actionType: 'default',
    status: 'active',
    source: 'discord',
    nextRunAt: scheduledAt,
    lastRunAt: null,
    runCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    cancelledAt: null,
    ...overrides,
  }
}
