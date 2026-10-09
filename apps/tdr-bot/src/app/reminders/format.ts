import type { ReminderView } from 'src/api/api.types'

export type StatusTone = 'ok' | 'muted' | 'warn' | 'bad'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const EMPTY = '—'

/** "in 2 h" / "5 min ago"; an em dash when there is no time. */
export function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return EMPTY

  const diff = new Date(iso).getTime() - now.getTime()
  const abs = Math.abs(diff)
  if (abs < MINUTE) return 'now'

  const [value, unit] =
    abs < HOUR
      ? [Math.round(abs / MINUTE), 'min']
      : abs < DAY
        ? [Math.round(abs / HOUR), 'h']
        : [Math.floor(abs / DAY), 'd']

  return diff > 0 ? `in ${value} ${unit}` : `${value} ${unit} ago`
}

/** "Oct 8, 9:00 AM"; an em dash when there is no time. */
export function formatWhen(iso: string | null): string {
  if (!iso) return EMPTY
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function whoLabel(view: ReminderView): string {
  if (view.source === 'admin') return 'admin'
  if (view.targetUserNames.length) {
    const targets = view.targetUserNames.map(name => `@${name}`).join(', ')
    return `${view.userName} → ${targets}`
  }

  return view.userName
}

/** Description, then the cron expression and end date when they apply. */
export function scheduleLines(view: ReminderView): string[] {
  const lines = [view.scheduleDescription]
  if (view.isRecurring && view.cronExpression) lines.push(view.cronExpression)
  if (view.endsAt) {
    const ends = new Date(view.endsAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    lines.push(`Ends ${ends}`)
  }

  return lines
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` for a date in the viewer's local time zone. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The local `date` (`YYYY-MM-DD`) at `timeOfDay`'s local wall-clock time. */
export function atTimeOfDay(date: string, timeOfDay: Date): Date {
  return new Date(
    `${date}T${pad(timeOfDay.getHours())}:${pad(timeOfDay.getMinutes())}:00`,
  )
}

/**
 * Pickable local dates (`YYYY-MM-DD`, inclusive) for a test send: only
 * dates whose run time is still ahead of `now`, and none after the
 * reminder's end date. `max` is null when the reminder has no end date.
 */
export function testDateBounds(
  timeOfDay: Date,
  endsAt: string | null,
  now: Date,
): { min: string; max: string | null } {
  const today = toDateInput(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return {
    min: atTimeOfDay(today, timeOfDay) > now ? today : toDateInput(tomorrow),
    max: endsAt ? toDateInput(new Date(endsAt)) : null,
  }
}

export function statusTone(status: ReminderView['status']): StatusTone {
  switch (status) {
    case 'active':
      return 'ok'
    case 'completed':
      return 'muted'
    case 'missed':
      return 'warn'
    case 'cancelled':
      return 'bad'
  }
}

export const ACTION_LABELS: Record<ReminderView['actionType'], string> = {
  default: 'text',
  search: 'search',
  math: 'math',
}
