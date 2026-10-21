const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** `16:02:11` in the viewer's time zone; unparseable input is returned as is. */
export function formatClock(iso: string | null | undefined): string {
  const at = iso ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return iso || '—'
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
}

/** `16:09:02.114` — a log line's timestamp, to the millisecond. */
export function formatLogTime(iso: string | undefined): string {
  const at = iso ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return iso ?? ''
  return `${formatClock(iso)}.${pad(at.getMilliseconds(), 3)}`
}

/** How long an operation took: `4.1s` under a minute, `2m 5s` after. */
export function formatTook(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}
