import type { Reminder } from 'src/db/schema'

import { MAX_REMINDER_WHAT_LENGTH } from './reminder.constants'

/**
 * Strips prompt-injection patterns from user-supplied reminder content before
 * interpolating it into LLM prompts. Applies MAX_REMINDER_WHAT_LENGTH limit.
 */
export function sanitizeReminderForPrompt(input: string): string {
  return input
    .replace(/<\/?reminder_topic>/gi, '')
    .replace(/<<[^>]*>>/g, '')
    .replace(/\[INST\]|\[\/INST\]/gi, '')
    .slice(0, MAX_REMINDER_WHAT_LENGTH)
}

/** Discord mentions for everyone a reminder tags; the creator when none. */
export function mentionsFor(
  reminder: Pick<Reminder, 'userId' | 'targetUserIds'>,
): string {
  const ids = reminder.targetUserIds.length
    ? reminder.targetUserIds
    : [reminder.userId]
  return ids.map(id => `<@${id}>`).join(' ')
}
