import { z } from 'zod'

/**
 * Determines the side-effect performed when a reminder fires.
 *
 * - `Default` — plain text reminder
 * - `Search`  — run a Tavily web search and summarise results
 * - `Math`    — render a LaTeX equation via the equations service
 */
export enum ReminderActionType {
  Default = 'default',
  Search = 'search',
  Math = 'math',
}

/**
 * Zod schema that validates the JSON blob returned by the LLM
 * when extracting reminder intent from a user message.
 */
export const ReminderExtractionSchema = z.object({
  action: z.enum(['create', 'list', 'cancel']),
  what: z.string().max(500).nullable(),
  isRecurring: z.boolean().nullable(),
  day: z.string().nullable(),
  time: z.string().nullable(),
  recurringPattern: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  cronExpression: z.string().nullable(),
  reminderIdToCancel: z.string().nullable(),
  channelId: z.string().nullable(),
  targetUserId: z.string().nullable().default(null),
  actionType: z.enum(ReminderActionType).default(ReminderActionType.Default),
})

/** Parsed reminder extraction output from the LLM. */
export type ReminderExtraction = z.infer<typeof ReminderExtractionSchema>
