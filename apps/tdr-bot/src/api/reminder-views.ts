import type { Reminder } from 'src/db/schema'
import type { ReminderActionType } from 'src/reminders/reminder.types'

import type { ReminderView } from './api.types'

export interface ReminderResolver {
  userName(id: string): string | null
  channelName(id: string): string | null
}

const iso = (date: Date | null): string | null => date?.toISOString() ?? null

/** Maps a row to its API shape, resolving Discord names with id fallbacks. */
export function toReminderView(
  row: Reminder,
  resolve: ReminderResolver,
): ReminderView {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    what: row.what,
    userId: row.userId,
    userName: resolve.userName(row.userId) ?? (row.userName || row.userId),
    targetUserIds: row.targetUserIds,
    targetUserNames: row.targetUserIds.map(id => resolve.userName(id) ?? id),
    guildId: row.guildId,
    channelId: row.channelId,
    channelName: row.channelId
      ? (resolve.channelName(row.channelId) ?? row.channelId)
      : null,
    isRecurring: row.isRecurring,
    cronExpression: row.cronExpression,
    scheduledAt: iso(row.scheduledAt),
    endsAt: iso(row.endsAt),
    scheduleDescription: row.scheduleDescription,
    nextRunAt: iso(row.nextRunAt),
    lastRunAt: iso(row.lastRunAt),
    runCount: row.runCount,
    actionType: row.actionType as ReminderActionType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAt: iso(row.cancelledAt),
  }
}
