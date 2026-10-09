import { z } from 'zod'

import { ReminderActionType } from 'src/reminders/reminder.types'

const isoDate = z.iso.datetime({ offset: true })

export const scheduleBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('once'), at: isoDate }),
  z.strictObject({
    kind: z.literal('recurring'),
    cron: z.string().trim().min(1),
    endsAt: isoDate.nullish(),
  }),
])

export const previewReminderBodySchema = z
  .object({ schedule: scheduleBodySchema })
  .strict()

export const testReminderBodySchema = z.strictObject({ at: isoDate })

const reminderFields = {
  what: z.string().trim().min(1).max(500),
  schedule: scheduleBodySchema,
  scheduleDescription: z.string().optional(),
  channelId: z.string().nullish(),
  targetUserIds: z.array(z.string().min(1)).max(25).optional(),
  actionType: z.enum(ReminderActionType).optional(),
}

export const createReminderBodySchema = z
  .object({ userId: z.string().min(1), ...reminderFields })
  .strict()

export const updateReminderBodySchema = z
  .object(reminderFields)
  .partial()
  .strict()
