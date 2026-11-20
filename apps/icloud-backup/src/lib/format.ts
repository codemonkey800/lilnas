const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** Decimal units, as a disk or iCloud shows them: 12.4 GB, 512 B. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'

  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }

  if (unit === 0) return `${Math.round(value)} B`

  // 999.96 KB rounds to 1000.0: carry it into the next unit.
  if (value.toFixed(1) === '1000.0' && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }

  return `${value.toFixed(1)} ${UNITS[unit]}`
}

const COUNT = new Intl.NumberFormat('en-US')

/** 18532 -> "18,532". */
export function formatCount(count: number): string {
  return COUNT.format(count)
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

/**
 * "just now", "5 minutes ago", "yesterday", "in 2 hours". Empty for a string
 * that is not a date.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''

  const seconds = Math.round((time - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return seconds > 0 ? 'in a few seconds' : 'just now'

  for (const [unit, size] of RELATIVE_UNITS) {
    if (abs >= size || unit === 'minute') {
      const amount = Math.round(seconds / size)
      return RELATIVE.format(amount, unit)
    }
  }

  return ''
}
