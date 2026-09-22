import {
  DownloadJobStatus,
  isInProgressDownloadJobStatus,
} from '@lilnas/utils/download/types'

/**
 * What every formatter here renders when it has nothing to render - an
 * unknown runtime, an unparseable timestamp. Exported so a caller can
 * compare against it (`value === UNKNOWN_VALUE`) instead of hard-coding the
 * dash, and so the whole UI uses one glyph.
 */
export const UNKNOWN_VALUE = '—'

/**
 * Which of the two runtime shapes to render.
 *
 * - `'hours'` - `2h 04m`, for movies and shows, where a runtime is a
 *   coarse "how much of my evening" figure.
 * - `'clock'` - `2:58` / `14:02` / `1:02:03`, for videos, where the runtime
 *   is the player's own duration readout and seconds matter.
 *
 * A mode argument rather than two functions because the input is identical:
 * `MediaBase.runtime` is **seconds** for all three types (the Radarr/Sonarr
 * mappers already multiplied minutes by 60), so only the presentation
 * differs.
 */
export type RuntimeFormat = 'clock' | 'hours'

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Renders a runtime given in **seconds**.
 *
 * `formatRuntime(7440, 'hours')` -> `'2h 04m'`;
 * `formatRuntime(178, 'clock')` -> `'2:58'`.
 *
 * A missing, zero, negative, or non-finite runtime yields
 * {@link UNKNOWN_VALUE}: upstream reports `0` for a title whose runtime it
 * simply does not know, and `0m` reads as a fact rather than as a gap.
 */
export function formatRuntime(
  seconds: number | null | undefined,
  mode: RuntimeFormat,
): string {
  if (
    seconds === null ||
    seconds === undefined ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return UNKNOWN_VALUE
  }

  const total = Math.round(seconds)
  const hours = Math.floor(total / SECONDS_PER_HOUR)
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)

  if (mode === 'hours') {
    // Sub-hour titles drop the `0h` rather than padding it, so a 42-minute
    // episode reads `42m` and not `0h 42m`.
    return hours > 0 ? `${hours}h ${pad2(minutes)}m` : `${minutes}m`
  }

  const remainingSeconds = total % SECONDS_PER_MINUTE

  // Only the *leading* unit is unpadded, exactly like a video player's
  // readout: `2:58`, `14:02`, `1:02:03`.
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(remainingSeconds)}`
    : `${minutes}:${pad2(remainingSeconds)}`
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const WEEK_MS = 604_800_000
/** 30 days - the "month" this only ever renders approximately. */
const MONTH_MS = 2_592_000_000
/** 365 days, for the same reason. */
const YEAR_MS = 31_536_000_000

/**
 * A compact "how long ago" label - `'12m ago'`, `'1h ago'`, `'6d ago'`.
 *
 * `now` is injectable so a list can pin one instant across every row (rather
 * than drifting mid-render) and so tests need no fake timers. It defaults to
 * `Date.now()`, which makes this function impure at its call site: rendering
 * it during SSR and again on hydration can disagree by a minute and trip a
 * hydration warning, so render it in a client component or pass an explicit
 * `now` down from the server.
 *
 * A timestamp in the future - clock skew between this box and a client -
 * clamps to `'just now'` rather than rendering a negative age.
 */
export function formatRelative(
  iso: string,
  now: Date | number = Date.now(),
): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) {
    return UNKNOWN_VALUE
  }

  const nowMs = now instanceof Date ? now.getTime() : now
  const elapsed = nowMs - then

  if (elapsed < MINUTE_MS) {
    return 'just now'
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m ago`
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h ago`
  }
  if (elapsed < WEEK_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d ago`
  }
  if (elapsed < MONTH_MS) {
    return `${Math.floor(elapsed / WEEK_MS)}w ago`
  }
  if (elapsed < YEAR_MS) {
    return `${Math.floor(elapsed / MONTH_MS)}mo ago`
  }

  return `${Math.floor(elapsed / YEAR_MS)}y ago`
}

/** `.`, `_`, `-`, `+` - the separators a work email's local part uses. */
const LOCAL_PART_SEPARATORS = /[._+-]+/

/**
 * Two upper-case characters for an avatar chip.
 *
 * `'jeremy.asuncion@lilnas.io'` -> `'JA'` (one per word);
 * `'jeremy@lilnas.io'` -> `'JE'` (no separator, so the first two letters of
 * the single word - never one lonely `J`).
 *
 * A one-character local part (`'j@lilnas.io'`) yields the one character
 * there is, and anything with no usable characters at all yields `'?'`.
 */
export function initials(email: string): string {
  const localPart = email.trim().split('@')[0] ?? ''
  const words = localPart.split(LOCAL_PART_SEPARATORS).filter(Boolean)

  const [first, second] = words
  if (first === undefined) {
    return '?'
  }

  // `slice` rather than `[0]` throughout: under `noUncheckedIndexedAccess` an
  // index read is `string | undefined`, and `slice` on a known-non-empty
  // string is the same character without the assertion.
  const letters =
    second === undefined
      ? first.slice(0, 2)
      : `${first.slice(0, 1)}${second.slice(0, 1)}`

  return letters.toUpperCase()
}

/** The `poster-v1` … `poster-v5` gradient utilities the design system ships. */
export type PosterVariant = 1 | 2 | 3 | 4 | 5

const POSTER_VARIANT_COUNT = 5

/**
 * Picks one of the five placeholder poster gradients from a seed - pass the
 * media id.
 *
 * Deterministic by construction (FNV-1a over the seed's code units): no
 * `Math.random`, no `Date.now`. A random pick would hand the server and the
 * client different gradients for the same card and blow up hydration, and
 * even client-side it would reshuffle the whole grid on every re-render,
 * which reads as a rendering bug rather than as decoration.
 */
export function posterVariant(seed: string): PosterVariant {
  // FNV-1a, 32-bit. `Math.imul` keeps the multiply in int32 instead of
  // silently losing precision through a float, which is what makes this
  // reproducible across engines.
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  // `>>> 0` before the modulo: `hash` is a signed int32 at this point, and a
  // negative remainder would land outside the variant range. The result is
  // therefore always 1-5, which `PosterVariant` states but arithmetic can't
  // prove - hence the one assertion in this file.
  return (((hash >>> 0) % POSTER_VARIANT_COUNT) + 1) as PosterVariant
}

/**
 * The design system's status tones: `uv` is the accent (work in flight),
 * `mute` is the recessive grey.
 */
export type StatusTone = 'bad' | 'mute' | 'ok' | 'uv' | 'warn'

/**
 * Every {@link DownloadJobStatus} to the tone it renders in. A
 * `Record<DownloadJobStatus, StatusTone>` rather than a `switch` with a
 * fallback, so adding a status to the enum fails type-check here instead of
 * quietly defaulting to grey.
 *
 * The grouping: `mute` for a job that is inert (queued and not yet started,
 * or cancelled), `uv` for one the machine is actively working, `warn` for
 * one a person has to act on, `ok` for done, `bad` for broken.
 *
 * `warn` covers both halves of "a person has to act": an intervention a user
 * already made (`pausing`/`paused`/`cancelling`) and a decision upstream is
 * waiting on (`needs_attention`, where Radarr/Sonarr grabbed the file but
 * will not import it until somebody picks it by hand). Both are *stopped*
 * rather than busy, which is precisely why the second one cannot be `uv` -
 * an accent and a breathing dot would read as "the machine is working on it"
 * for a job that will sit there forever.
 */
const STATUS_TONES: Record<DownloadJobStatus, StatusTone> = {
  [DownloadJobStatus.Cancelled]: 'mute',
  [DownloadJobStatus.Cancelling]: 'warn',
  [DownloadJobStatus.Cleaning]: 'uv',
  [DownloadJobStatus.Completed]: 'ok',
  [DownloadJobStatus.Converting]: 'uv',
  [DownloadJobStatus.Downloading]: 'uv',
  [DownloadJobStatus.Failed]: 'bad',
  [DownloadJobStatus.Importing]: 'uv',
  [DownloadJobStatus.NeedsAttention]: 'warn',
  [DownloadJobStatus.Paused]: 'warn',
  [DownloadJobStatus.Pausing]: 'warn',
  [DownloadJobStatus.Pending]: 'mute',
  [DownloadJobStatus.Requested]: 'mute',
  [DownloadJobStatus.Searching]: 'uv',
  [DownloadJobStatus.Uploading]: 'uv',
}

/** The design-system tone a job status renders in. See {@link STATUS_TONES}. */
export function statusTone(status: DownloadJobStatus): StatusTone {
  return STATUS_TONES[status]
}

/**
 * Whether a job is still open work - the complement of
 * `TERMINAL_DOWNLOAD_JOB_STATUSES`.
 *
 * Delegates to `@lilnas/utils`'s `isInProgressDownloadJobStatus`, which
 * derives the set by filtering the enum rather than hand-listing it, so a
 * new status lands on the Activity feed automatically unless it is
 * explicitly declared terminal. Re-exported under a shorter name purely
 * because this is called once per row in several lists.
 */
export function isInProgress(status: DownloadJobStatus): boolean {
  return isInProgressDownloadJobStatus(status)
}
