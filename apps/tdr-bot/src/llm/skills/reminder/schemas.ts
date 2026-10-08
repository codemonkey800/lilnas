import { z } from 'zod'

import { ReminderActionType } from 'src/reminders/reminder.types'

/**
 * What the LLM extracts from a reminder message. Strict-output safe: every
 * field is required and nullable rather than optional.
 */
export const ReminderIntentSchema = z.object({
  action: z.enum(['create', 'list', 'cancel', 'cancel_all']),
  what: z.string().max(500).nullable(),
  isRecurring: z.boolean().nullable(),
  day: z.string().nullable(),
  time: z.string().nullable(),
  /** "tomorrow at 9:00 AM", "every Tuesday at 10:00 AM until Nov 1" */
  scheduleDescription: z.string().nullable(),
  /** ISO local datetime, one-time reminders only. */
  scheduledAt: z.string().nullable(),
  /** Recurring reminders only. */
  cronExpression: z.string().nullable(),
  /** ISO local datetime, recurring reminders only ("until Friday"). */
  endsAt: z.string().nullable(),
  channelId: z.string().nullable(),
  targetUserId: z.string().nullable(),
  actionType: z.enum(ReminderActionType),
})

export type ReminderIntent = z.infer<typeof ReminderIntentSchema>

/** Which of the user's reminders a cancel request refers to. */
export const CancelResolutionSchema = z.object({
  matchIds: z.array(z.string()),
  confident: z.boolean(),
})

export type CancelResolution = z.infer<typeof CancelResolutionSchema>

/** Whether a message still belongs to the in-progress reminder flow. */
export const ContinuationSchema = z.object({ continuing: z.boolean() })

/** Follow-up payload carried between turns of a reminder conversation. */
export type ReminderFollowUp =
  | { stage: 'create'; partial: Partial<ReminderIntent> }
  | { stage: 'cancel'; candidateIds: string[]; rounds: number }
  | { stage: 'cancelAll'; ids: string[] }
