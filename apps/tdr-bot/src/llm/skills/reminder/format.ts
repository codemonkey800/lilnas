import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

import type { Reminder } from 'src/db/schema'
import { REMINDER_TIMEZONE } from 'src/reminders/reminder.constants'
import type { ReminderErrorCode } from 'src/reminders/reminder.service'
import { mentionsFor } from 'src/reminders/reminder.utils'

dayjs.extend(utc)
dayjs.extend(timezone)

export const NO_REMINDERS_TEXT = "You don't have any reminders right now."

export const DM_REFUSAL_TEXT =
  "Sorry, reminders can only be set in a server channel, not in DMs. Please use this command in a server I'm in!"

export const PAST_TIME_TEXT =
  'That time has already passed, when should I remind you?'

export const INVALID_CRON_TEXT =
  "I couldn't work out that repeating schedule, how often should I remind you?"

export const TOO_FREQUENT_TEXT =
  "Reminders can't repeat more than once every couple of minutes, how often should I remind you?"

export const ALREADY_GONE_TEXT = 'That reminder is already gone.'

export const RESTART_CANCEL_TEXT =
  "Let's start over — tell me which reminder to cancel."

export const KEPT_TEXT = 'Okay, I kept them.'

/** User-facing text for each way the reminder service can refuse. */
export const REMINDER_ERROR_MESSAGES: Record<ReminderErrorCode, string> = {
  limit_reached: 'You already have 25 active reminders — cancel one first.',
  invalid_cron: INVALID_CRON_TEXT,
  cron_too_frequent: TOO_FREQUENT_TEXT,
  in_past: PAST_TIME_TEXT,
  ends_before_start: 'The end date has to be after the first reminder.',
  invalid_what: 'The reminder text has to be between 1 and 500 characters.',
  not_found: ALREADY_GONE_TEXT,
  forbidden: ALREADY_GONE_TEXT,
  not_active: ALREADY_GONE_TEXT,
}

const inZone = (date: Date) => dayjs(date).tz(REMINDER_TIMEZONE)

export const formatNextRun = (date: Date) =>
  inZone(date).format('MMM D, YYYY [at] h:mm A')

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`

/** `**what** — schedule · next <date> (recurring) …` for one reminder. */
export function formatReminderLine(reminder: Reminder, userId: string): string {
  const parts = [`**${reminder.what}** — ${reminder.scheduleDescription}`]
  if (reminder.nextRunAt) {
    parts[0] += ` · next ${inZone(reminder.nextRunAt).format('MMM D, h:mm A')}`
  }
  if (reminder.isRecurring) parts.push('(recurring)')
  if (reminder.targetUserIds.length && reminder.userId === userId) {
    parts.push(`(for ${mentionsFor(reminder)})`)
  } else if (reminder.userId !== userId) {
    parts.push(`(from @${reminder.userName})`)
  }
  if (reminder.channelId) parts.push(`in <#${reminder.channelId}>`)
  if (reminder.endsAt) {
    parts.push(`until ${inZone(reminder.endsAt).format('MMM D')}`)
  }
  return parts.join(' ')
}

/** Numbered lines for `reminders`, with no heading. */
export function formatNumbered(reminders: Reminder[], userId: string): string {
  return reminders
    .map((r, i) => `${i + 1}. ${formatReminderLine(r, userId)}`)
    .join('\n')
}

/** Deterministic "your reminders" reply; no LLM involved. */
export function formatReminderList(
  reminders: Reminder[],
  userId: string,
): string {
  if (reminders.length === 0) return NO_REMINDERS_TEXT
  return `You have ${plural(reminders.length, 'reminder')}:\n${formatNumbered(reminders, userId)}`
}

export function formatCancelled(reminder: Reminder): string {
  return `Cancelled: **${reminder.what}** — ${reminder.scheduleDescription}`
}

export const formatCancelledAll = (count: number) =>
  `Cancelled ${plural(count, 'reminder')}.`

export const formatCancelAllPrompt = (count: number) =>
  `Reply **yes** to cancel all ${count}.`
