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
