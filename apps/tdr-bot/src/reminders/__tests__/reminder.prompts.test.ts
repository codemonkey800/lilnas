import { SystemMessage } from '@langchain/core/messages'

import {
  buildExtractReminderPrompt,
  REMINDER_ASK_MISSING_PROMPT,
  REMINDER_CANCEL_PROMPT,
  REMINDER_CONFIRM_PROMPT,
  REMINDER_DELIVERY_PROMPT,
  REMINDER_LIST_PROMPT,
  REMINDER_TOPIC_SWITCH_PROMPT,
} from 'src/reminders/reminder.prompts'

describe('buildExtractReminderPrompt', () => {
  const nowIso = '2026-03-17T14:30:00'
  const dayOfWeek = 'Tuesday'

  it('returns a SystemMessage', () => {
    const result = buildExtractReminderPrompt(nowIso, dayOfWeek)

    expect(result).toBeInstanceOf(SystemMessage)
  })

  it('embeds the provided ISO timestamp in the prompt', () => {
    const result = buildExtractReminderPrompt(nowIso, dayOfWeek)

    expect(result.content).toContain(nowIso)
  })

  it('embeds the day of week in the prompt', () => {
    const result = buildExtractReminderPrompt(nowIso, dayOfWeek)

    expect(result.content).toContain('Tuesday')
  })

  it('works without dayOfWeek provided', () => {
    const result = buildExtractReminderPrompt(nowIso)

    expect(result).toBeInstanceOf(SystemMessage)
    expect(result.content).toContain(nowIso)
  })

  it('includes all three action types in the prompt', () => {
    const result = buildExtractReminderPrompt(nowIso, dayOfWeek)
    const content = result.content as string

    expect(content).toContain('"create"')
    expect(content).toContain('"list"')
    expect(content).toContain('"cancel"')
  })

  it('includes all required extraction fields in the prompt', () => {
    const result = buildExtractReminderPrompt(nowIso, dayOfWeek)
    const content = result.content as string

    expect(content).toContain('what')
    expect(content).toContain('isRecurring')
    expect(content).toContain('day')
    expect(content).toContain('time')
    expect(content).toContain('scheduledAt')
    expect(content).toContain('cronExpression')
  })

  it('instructs the model to return only valid JSON', () => {
    const result = buildExtractReminderPrompt(nowIso, dayOfWeek)

    expect(result.content).toContain('valid JSON')
  })

  it('includes the America/Los_Angeles timezone in the prompt', () => {
    const result = buildExtractReminderPrompt(nowIso, dayOfWeek)

    expect(result.content).toContain('America/Los_Angeles')
  })

  it('includes instructions for "starting today" pattern', () => {
    const result = buildExtractReminderPrompt(nowIso, dayOfWeek)

    expect(result.content).toContain('starting today')
  })

  it('includes instructions for "starting next week" pattern', () => {
    const result = buildExtractReminderPrompt(nowIso, dayOfWeek)

    expect(result.content).toContain('starting next week')
  })

  it('generates different prompts for different timestamps', () => {
    const prompt1 = buildExtractReminderPrompt('2026-01-01T00:00:00', dayOfWeek)
    const prompt2 = buildExtractReminderPrompt('2026-12-31T23:59:59', dayOfWeek)

    expect(prompt1.content).not.toBe(prompt2.content)
    expect(prompt1.content).toContain('2026-01-01T00:00:00')
    expect(prompt2.content).toContain('2026-12-31T23:59:59')
  })
})

describe('static prompt constants', () => {
  it('REMINDER_TOPIC_SWITCH_PROMPT instructs the model to respond CONTINUE or SWITCH', () => {
    const content = REMINDER_TOPIC_SWITCH_PROMPT.content as string

    expect(content).toContain('CONTINUE')
    expect(content).toContain('SWITCH')
    expect(content).toContain('Respond with only')
  })

  it('REMINDER_DELIVERY_PROMPT sets TDR Bot persona and character limit', () => {
    const content = REMINDER_DELIVERY_PROMPT.content as string

    expect(content).toContain('TDR Bot')
    expect(content).toContain('200 characters')
  })

  it('REMINDER_CONFIRM_PROMPT instructs brief confirmation with key details', () => {
    const content = REMINDER_CONFIRM_PROMPT.content as string

    expect(content).toContain('Confirm')
    expect(content).toContain('what')
    expect(content).toContain('when')
  })

  it('REMINDER_LIST_PROMPT instructs presenting reminders clearly', () => {
    const content = REMINDER_LIST_PROMPT.content as string

    expect(content).toContain('active reminders')
    expect(content).toContain('no reminders')
  })

  it('REMINDER_CANCEL_PROMPT instructs confirmation or not-found messaging', () => {
    const content = REMINDER_CANCEL_PROMPT.content as string

    expect(content).toContain('cancelled')
    expect(content).toContain('no matching')
  })

  it('REMINDER_ASK_MISSING_PROMPT asks for missing information concisely', () => {
    const content = REMINDER_ASK_MISSING_PROMPT.content as string

    expect(content).toContain('missing information')
    expect(content).toContain('one sentence')
  })
})
