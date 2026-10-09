import {
  formatCancelAllPrompt,
  formatCancelled,
  formatCancelledAll,
  formatReminderList,
  NO_REMINDERS_TEXT,
  REMINDER_ERROR_MESSAGES,
} from 'src/llm/skills/reminder/format'
import { createTestReminder } from 'src/reminders/__tests__/factories/reminder'

const NEXT = new Date('2026-03-18T17:00:00Z') // 10:00 AM in Los Angeles

describe('formatReminderList', () => {
  it('says so when there are no reminders', () => {
    expect(formatReminderList([], 'u1')).toBe(NO_REMINDERS_TEXT)
    expect(NO_REMINDERS_TEXT).toBe("You don't have any reminders right now.")
  })

  it('numbers one line per reminder', () => {
    const text = formatReminderList(
      [
        createTestReminder({
          what: 'pay rent',
          scheduleDescription: 'tomorrow at 10:00 AM',
          nextRunAt: NEXT,
          userId: 'u1',
        }),
        createTestReminder({
          what: 'water plants',
          scheduleDescription: 'every Tuesday at 10:00 AM',
          nextRunAt: NEXT,
          isRecurring: true,
          userId: 'u1',
        }),
      ],
      'u1',
    )

    expect(text).toBe(
      [
        'You have 2 reminders:',
        '1. **pay rent** — tomorrow at 10:00 AM · next Mar 18, 10:00 AM',
        '2. **water plants** — every Tuesday at 10:00 AM · next Mar 18, 10:00 AM (recurring)',
      ].join('\n'),
    )
  })

  it('uses the singular for one reminder', () => {
    const text = formatReminderList(
      [createTestReminder({ userId: 'u1' })],
      'u1',
    )

    expect(text.startsWith('You have 1 reminder:\n1. ')).toBe(true)
  })

  it('marks the target when the viewer created it', () => {
    const [line] = formatReminderList(
      [createTestReminder({ userId: 'u1', targetUserIds: ['u2', 'u3'] })],
      'u1',
    )
      .split('\n')
      .slice(1)

    expect(line).toContain('(for <@u2> <@u3>)')
  })

  it('marks the creator when the viewer is the target', () => {
    const [line] = formatReminderList(
      [
        createTestReminder({
          userId: 'u1',
          userName: 'sam',
          targetUserIds: ['u2'],
        }),
      ],
      'u2',
    )
      .split('\n')
      .slice(1)

    expect(line).toContain('(from @sam)')
    expect(line).not.toContain('(for ')
  })

  it('shows the channel and end date', () => {
    const text = formatReminderList(
      [
        createTestReminder({
          isRecurring: true,
          channelId: 'c9',
          endsAt: new Date('2026-11-01T20:00:00Z'),
        }),
      ],
      'u1',
    )

    expect(text).toContain('in <#c9>')
    expect(text).toContain('until Nov 1')
  })

  it('omits the next run when there is none', () => {
    const text = formatReminderList(
      [createTestReminder({ nextRunAt: null })],
      'u1',
    )

    expect(text).not.toContain('next')
  })
})

describe('other formatters', () => {
  it('formatCancelled', () => {
    expect(
      formatCancelled(
        createTestReminder({
          what: 'dentist',
          scheduleDescription: 'Friday at 2:00 PM',
        }),
      ),
    ).toBe('Cancelled: **dentist** — Friday at 2:00 PM')
  })

  it('formatCancelledAll and the prompt', () => {
    expect(formatCancelledAll(2)).toBe('Cancelled 2 reminders.')
    expect(formatCancelledAll(1)).toBe('Cancelled 1 reminder.')
    expect(formatCancelAllPrompt(3)).toBe('Reply **yes** to cancel all 3.')
  })

  it('maps limit_reached to a friendly message', () => {
    expect(REMINDER_ERROR_MESSAGES.limit_reached).toMatch(
      /25 active reminders — cancel one first/,
    )
  })

  it('has text for every error code', () => {
    for (const text of Object.values(REMINDER_ERROR_MESSAGES)) {
      expect(text.length).toBeGreaterThan(0)
    }
  })
})
