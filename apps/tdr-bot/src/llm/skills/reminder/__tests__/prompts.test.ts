import { SystemMessage } from '@langchain/core/messages'

import {
  buildExtractReminderPrompt,
  REMINDER_ASK_MISSING_PROMPT,
  REMINDER_CANCEL_RESOLUTION_PROMPT,
  REMINDER_CONFIRM_PROMPT,
  REMINDER_TOPIC_SWITCH_PROMPT,
} from 'src/llm/skills/reminder/prompts'
import { ReminderIntentSchema } from 'src/llm/skills/reminder/schemas'

describe('buildExtractReminderPrompt', () => {
  const nowIso = '2026-03-17T14:30:00'
  const content = (...args: Parameters<typeof buildExtractReminderPrompt>) =>
    buildExtractReminderPrompt(...args).content as string

  it('returns a SystemMessage embedding the time, weekday and timezone', () => {
    const prompt = buildExtractReminderPrompt(nowIso, 'Tuesday')

    expect(prompt).toBeInstanceOf(SystemMessage)
    expect(prompt.content).toContain(nowIso)
    expect(prompt.content).toContain('Tuesday')
    expect(prompt.content).toContain('America/Los_Angeles')
  })

  it('works without a weekday', () => {
    expect(content(nowIso)).toContain(nowIso)
  })

  it('lists every action and field', () => {
    const text = content(nowIso, 'Tuesday')

    for (const word of [
      '"create"',
      '"list"',
      '"cancel"',
      '"cancel_all"',
      'scheduleDescription',
      'scheduledAt',
      'cronExpression',
      'endsAt',
      'targetUserId',
    ]) {
      expect(text).toContain(word)
    }
    expect(text).toContain('valid JSON')
  })

  it('keeps the day-rule patterns', () => {
    const text = content(nowIso, 'Tuesday')

    expect(text).toContain('starting today')
    expect(text).toContain('starting next week')
  })

  it('has examples for cancel_all, endsAt and scheduleDescription', () => {
    const text = content(nowIso, 'Tuesday')

    expect(text).toContain('nuke all my reminders')
    expect(text).toContain('until Nov 1')
    expect(text).toContain('"endsAt":"2026-11-01T23:59:00"')
  })

  it('only contains example JSON that satisfies the schema', () => {
    const lines = content(nowIso, 'Tuesday')
      .split('\n')
      .filter(line => line.startsWith('- "') && line.includes(' → {'))

    expect(lines.length).toBeGreaterThan(20)
    for (const line of lines) {
      const json = line.slice(line.indexOf(' → ') + 3)
      expect(() => ReminderIntentSchema.parse(JSON.parse(json))).not.toThrow()
    }
  })

  it('includes the existing partial for merging', () => {
    const text = content(nowIso, 'Tuesday', { what: 'pay rent' })

    expect(text).toContain('Previously extracted fields')
    expect(text).toContain('pay rent')
  })

  it('omits the merge block without a partial', () => {
    expect(content(nowIso, 'Tuesday')).not.toContain('Previously extracted')
  })

  it('generates different prompts for different timestamps', () => {
    expect(content('2026-01-01T00:00:00')).not.toBe(
      content('2026-12-31T23:59:59'),
    )
  })
})

describe('static prompts', () => {
  it('topic switch asks for a continuing flag', () => {
    expect(REMINDER_TOPIC_SWITCH_PROMPT.content).toContain('"continuing"')
  })

  it('cancel resolution asks for matchIds and confident', () => {
    const text = REMINDER_CANCEL_RESOLUTION_PROMPT.content as string

    expect(text).toContain('matchIds')
    expect(text).toContain('confident')
  })

  it('ask-missing is concise', () => {
    expect(REMINDER_ASK_MISSING_PROMPT.content).toContain('one sentence')
  })

  it('confirm is brief', () => {
    expect(REMINDER_CONFIRM_PROMPT.content).toContain('150 characters')
  })
})
