import { CronTime } from 'cron'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

import type { Reminder } from 'src/db/schema'

import { MIN_CRON_INTERVAL_MS, REMINDER_TIMEZONE } from './reminder.constants'

dayjs.extend(utc)
dayjs.extend(timezone)

export type ReminderSchedule =
  | { kind: 'once'; at: Date }
  | { kind: 'recurring'; cron: string; endsAt?: Date | null }

export type CronCheck =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'too_frequent' }

type ScheduleFields = Pick<
  Reminder,
  'isRecurring' | 'cronExpression' | 'scheduledAt' | 'endsAt'
>

/** How many consecutive runs {@link validateCron} compares. */
const CRON_PROBE_RUNS = 10

/**
 * Rejects unparseable expressions and ones that run every minute or more
 * often: two consecutive runs must be more than {@link MIN_CRON_INTERVAL_MS}
 * apart, so an every-minute expression is too frequent.
 */
export function validateCron(expr: string): CronCheck {
  try {
    const time = new CronTime(expr, REMINDER_TIMEZONE)
    let previous = time.getNextDateFrom(new Date()).toMillis()
    for (let i = 1; i < CRON_PROBE_RUNS; i++) {
      const next = time.getNextDateFrom(new Date(previous)).toMillis()
      if (next - previous <= MIN_CRON_INTERVAL_MS) {
        return { ok: false, reason: 'too_frequent' }
      }
      previous = next
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

/**
 * First cron run strictly after `from`, or `null` when the expression is
 * invalid or the run would fall after `endsAt`.
 */
export function nextCronRun(
  expr: string,
  from: Date,
  endsAt?: Date | null,
): Date | null {
  try {
    const next = new CronTime(expr, REMINDER_TIMEZONE)
      .getNextDateFrom(from)
      .toJSDate()
    if (next.getTime() <= from.getTime()) return null
    if (endsAt && next.getTime() > endsAt.getTime()) return null
    return next
  } catch {
    return null
  }
}

/** Next run of a stored reminder strictly after `from`, or `null` if none. */
export function nextRunFor(r: ScheduleFields, from: Date): Date | null {
  if (r.isRecurring) {
    return r.cronExpression
      ? nextCronRun(r.cronExpression, from, r.endsAt)
      : null
  }
  return r.scheduledAt && r.scheduledAt.getTime() > from.getTime()
    ? r.scheduledAt
    : null
}

/** Up to `count` upcoming runs after `from`, in ascending order. */
export function previewRuns(
  schedule: ReminderSchedule,
  from: Date,
  count: number,
): Date[] {
  if (count <= 0) return []
  if (schedule.kind === 'once') {
    return schedule.at.getTime() > from.getTime() ? [schedule.at] : []
  }
  const runs: Date[] = []
  let cursor = from
  while (runs.length < count) {
    const next = nextCronRun(schedule.cron, cursor, schedule.endsAt)
    if (!next) break
    runs.push(next)
    cursor = next
  }
  return runs
}

/** Converts a stored reminder row into a {@link ReminderSchedule}. */
export function scheduleOf(r: Reminder): ReminderSchedule {
  if (r.isRecurring) {
    return {
      kind: 'recurring',
      cron: r.cronExpression ?? '',
      endsAt: r.endsAt,
    }
  }
  return { kind: 'once', at: r.scheduledAt ?? r.createdAt }
}

const formatDate = (d: Date, pattern: string) =>
  dayjs(d).tz(REMINDER_TIMEZONE).format(pattern)

/** "Friday, October 9, 2026 at 9:00 AM" in the reminder timezone. */
export function formatFireTime(d: Date): string {
  return formatDate(d, 'dddd, MMMM D, YYYY [at] h:mm A')
}

/** Fallback human-readable text for a schedule. */
export function describeSchedule(schedule: ReminderSchedule): string {
  if (schedule.kind === 'once') {
    return formatDate(schedule.at, 'MMM D, YYYY [at] h:mm A')
  }
  const base = `cron ${schedule.cron}`
  return schedule.endsAt
    ? `${base} until ${formatDate(schedule.endsAt, 'MMM D, YYYY')}`
    : base
}
