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
  if (view.targetUserName) {
    return `${view.userName} → @${view.targetUserName}`
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
