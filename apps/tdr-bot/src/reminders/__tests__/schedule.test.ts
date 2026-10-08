import { Reminder } from 'src/db/schema'
import { createTestReminder } from 'src/reminders/__tests__/factories/reminder'
import {
  describeSchedule,
  nextCronRun,
  nextRunFor,
  previewRuns,
  scheduleOf,
  validateCron,
} from 'src/reminders/schedule'

describe('validateCron', () => {
  it('rejects expressions firing every minute-or-faster', () => {
    expect(validateCron('*/1 * * * *')).toEqual({
      ok: false,
      reason: 'too_frequent',
    })
    expect(validateCron('* * * * * *')).toEqual({
      ok: false,
      reason: 'too_frequent',
    })
  })

  it('accepts a daily expression', () => {
    expect(validateCron('0 9 * * *')).toEqual({ ok: true })
  })

  it('rejects garbage as invalid', () => {
    expect(validateCron('not a cron')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('nextCronRun', () => {
  it('returns the next run strictly after from', () => {
    const from = new Date('2026-10-07T16:00:00Z') // 9:00 AM PDT
    expect(nextCronRun('0 9 * * *', from)?.toISOString()).toBe(
      '2026-10-08T16:00:00.000Z',
    )
  })

  it('is null once the next run is past endsAt', () => {
    const from = new Date('2026-10-07T16:00:00Z')
    expect(
      nextCronRun('0 9 * * *', from, new Date('2026-10-08T00:00:00Z')),
    ).toBeNull()
    expect(
      nextCronRun('0 9 * * *', from, new Date('2026-10-08T16:00:00Z')),
    ).not.toBeNull()
  })

  it('follows the Los Angeles timezone across the DST boundary', () => {
    // DST ends 2026-11-01 02:00 PDT; 9:00 AM moves from UTC-7 to UTC-8.
    const before = new Date('2026-10-31T16:00:00Z')
    expect(nextCronRun('0 9 * * *', before)?.toISOString()).toBe(
      '2026-11-01T17:00:00.000Z',
    )
  })

  it('is null for an invalid expression', () => {
    expect(nextCronRun('garbage', new Date())).toBeNull()
  })
})

describe('nextRunFor', () => {
  const from = new Date('2026-10-07T12:00:00Z')

  it('returns a future one-time scheduledAt', () => {
    const at = new Date('2026-10-08T12:00:00Z')
    expect(nextRunFor({ ...base(), scheduledAt: at }, from)).toEqual(at)
  })

  it('is null for a one-time reminder in the past', () => {
    const at = new Date('2026-10-06T12:00:00Z')
    expect(nextRunFor({ ...base(), scheduledAt: at }, from)).toBeNull()
  })

  it('uses the cron for recurring reminders', () => {
    const r = { ...base(), isRecurring: true, cronExpression: '0 9 * * *' }
    expect(nextRunFor(r, from)?.toISOString()).toBe('2026-10-07T16:00:00.000Z')
  })

  function base() {
    return {
      isRecurring: false,
      cronExpression: null,
      scheduledAt: null,
      endsAt: null,
    } satisfies Pick<
      Reminder,
      'isRecurring' | 'cronExpression' | 'scheduledAt' | 'endsAt'
    >
  }
})

describe('previewRuns', () => {
  const from = new Date('2026-10-07T12:00:00Z')

  it('lists count ascending runs for a recurring schedule', () => {
    const runs = previewRuns({ kind: 'recurring', cron: '0 9 * * *' }, from, 3)
    expect(runs.map(d => d.toISOString())).toEqual([
      '2026-10-07T16:00:00.000Z',
      '2026-10-08T16:00:00.000Z',
      '2026-10-09T16:00:00.000Z',
    ])
  })

  it('stops at endsAt', () => {
    const runs = previewRuns(
      {
        kind: 'recurring',
        cron: '0 9 * * *',
        endsAt: new Date('2026-10-08T20:00:00Z'),
      },
      from,
      5,
    )
    expect(runs).toHaveLength(2)
  })

  it('returns the single future run for a one-time schedule', () => {
    const at = new Date('2026-10-09T12:00:00Z')
    expect(previewRuns({ kind: 'once', at }, from, 3)).toEqual([at])
    expect(
      previewRuns(
        { kind: 'once', at: new Date('2026-10-01T00:00:00Z') },
        from,
        3,
      ),
    ).toEqual([])
  })
})

describe('scheduleOf and describeSchedule', () => {
  it('maps rows to schedules', () => {
    const at = new Date('2026-10-08T16:00:00Z')
    expect(scheduleOf(createTestReminder({ scheduledAt: at }))).toEqual({
      kind: 'once',
      at,
    })
    const endsAt = new Date('2026-10-31T00:00:00Z')
    expect(
      scheduleOf(
        createTestReminder({
          isRecurring: true,
          cronExpression: '0 9 * * *',
          endsAt,
        }),
      ),
    ).toEqual({ kind: 'recurring', cron: '0 9 * * *', endsAt })
  })

  it('describes one-time and recurring schedules', () => {
    expect(
      describeSchedule({
        kind: 'once',
        at: new Date('2026-10-08T16:00:00Z'),
      }),
    ).toBe('Oct 8, 2026 at 9:00 AM')
    expect(
      describeSchedule({
        kind: 'recurring',
        cron: '0 9 * * *',
        endsAt: new Date('2026-10-31T19:00:00Z'),
      }),
    ).toBe('cron 0 9 * * * until Oct 31, 2026')
    expect(describeSchedule({ kind: 'recurring', cron: '0 9 * * *' })).toBe(
      'cron 0 9 * * *',
    )
  })
})
