// ---------------------------------------------------------------------------
// Playback duration/position formatters. Lifted out of `IpadBrowserView.tsx`
// (where they were module-private) once the full-page player needed the same
// two labels — the app's convention for a helper two surfaces share, and the
// only way to get them under test at all: `jest.config.js` uses
// `testEnvironment: 'node'` and a `testMatch` that only picks up `.ts`, so
// logic living in a `.tsx` file is unreachable from a test.
// ---------------------------------------------------------------------------

const TICKS_PER_MINUTE = 10_000_000 * 60 // Emby ticks (100ns units) per minute

/**
 * Formats an Emby `runTimeTicks` value as a coarse human runtime
 * (`"2h 14m"` / `"42m"`). Returns `null` for a `null` input so callers can
 * omit the field entirely rather than rendering a placeholder.
 */
export function formatRuntime(ticks: number | null): string | null {
  if (ticks === null) {
    return null
  }
  const totalMinutes = Math.round(ticks / TICKS_PER_MINUTE)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/**
 * Formats a playhead/duration in **seconds** as a timecode (`"1:05"`,
 * `"1:01:01"`), omitting the hours field below an hour. A different unit than
 * `formatRuntime`'s Emby ticks, hence the separate function — `playhead` and
 * `duration` come off `usePlaybackStore` as plain seconds.
 *
 * Non-finite and negative inputs collapse to `"0:00"`: a scrub bar reads
 * `duration` before `load()` resolves it, and `0 / 0` style arithmetic
 * upstream would otherwise surface as `"NaN:NaN"`.
 */
export function formatTimecode(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds)
    ? Math.max(totalSeconds, 0)
    : 0
  const wholeSeconds = Math.floor(safeSeconds)
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const seconds = wholeSeconds % 60
  const paddedSeconds = String(seconds).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`
}
