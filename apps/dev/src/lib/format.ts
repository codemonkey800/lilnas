/** What every formatter renders when it has nothing to render. */
export const UNKNOWN_VALUE = '—'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * Binary units, one decimal from GB up (`1.4 GB`) and none below (`612 MB`),
 * which is how the mockup reads. Negative or non-finite input is unknown.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    return UNKNOWN_VALUE
  }

  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }

  const digits = unit >= 3 ? 1 : 0
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`
}

/**
 * A span of milliseconds, using at most its two largest units:
 * `14s`, `58m`, `2h 14m`, `6d 4h`. A zero lower unit is dropped (`2h`).
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return UNKNOWN_VALUE

  const total = Math.max(0, ms)
  if (total < MINUTE_MS) return `${Math.floor(total / SECOND_MS)}s`
  if (total < HOUR_MS) return `${Math.floor(total / MINUTE_MS)}m`

  const [majorMs, majorUnit, minorMs, minorUnit] =
    total < DAY_MS
      ? ([HOUR_MS, 'h', MINUTE_MS, 'm'] as const)
      : ([DAY_MS, 'd', HOUR_MS, 'h'] as const)
  const major = Math.floor(total / majorMs)
  const minor = Math.floor((total % majorMs) / minorMs)

  return minor > 0
    ? `${major}${majorUnit} ${minor}${minorUnit}`
    : `${major}${majorUnit}`
}

function parse(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : NaN
}

/** Time since `iso`, as `14m ago`. Unparseable input is unknown. */
export function formatAgo(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  const at = parse(iso)
  if (Number.isNaN(at)) return UNKNOWN_VALUE
  return `${formatDuration(now - at)} ago`
}

/** How long `iso` has been in the past, as `3h 12m`. */
export function formatSince(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  const at = parse(iso)
  if (Number.isNaN(at)) return UNKNOWN_VALUE
  return formatDuration(now - at)
}

/** Time until `iso`, as `1h 20m`; zero once it has passed. */
export function formatUntil(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  const at = parse(iso)
  if (Number.isNaN(at)) return UNKNOWN_VALUE
  return formatDuration(at - now)
}
