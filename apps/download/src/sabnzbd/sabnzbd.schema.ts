import { z } from 'zod'

/**
 * zod schemas for the three SABnzbd 5.1.3 API modes this app reads
 * (`version`, `queue`, `history`), plus SAB's HTTP-200 error envelope.
 *
 * Field names stay SAB's snake_case so a parsed value diffs cleanly against
 * a raw capture. Objects are `z.looseObject`: SAB sends many more fields
 * than we read, and unknown ones pass through untouched, so a SAB upgrade
 * that adds fields is a non-event while one that drops or retypes a field
 * we depend on fails loudly at the parse site.
 *
 * SAB serialises most numbers as strings (`"%.2f"` / `"%s"` in `api.py`);
 * the schemas coerce those so callers only ever see numbers.
 *
 * Source references are to SAB 5.1.3: `sabnzbd/api.py` `build_header` /
 * `build_queue` / `_api_history_default` / `build_history` /
 * `add_active_history`, and `sabnzbd/database.py` `unpack_history_info`.
 */

/**
 * Parses SAB's `timeleft` strings into seconds.
 *
 * SAB's `format_time_left` (`misc.py`) produces `H:MM:SS`, or `D:HH:MM:SS`
 * once the estimate rolls past a day. Anything else - wrong part count,
 * non-digits, minutes/seconds (or, in the 4-part form, hours) out of range -
 * is junk and yields `null` rather than a made-up number.
 */
export function parseSabDuration(value: string): number | null {
  const parts = value.trim().split(':')

  if (parts.length !== 3 && parts.length !== 4) return null
  if (!parts.every(part => /^\d+$/.test(part))) return null

  const numbers = parts.map(Number)
  // - Length is 3 or 4 here, so the defaults never apply; they only satisfy
  //   noUncheckedIndexedAccess.
  const [days = 0, hours = 0, minutes = 0, seconds = 0] =
    numbers.length === 4 ? numbers : [0, ...numbers]

  if (minutes >= 60 || seconds >= 60) return null
  if (numbers.length === 4 && hours >= 24) return null

  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds
}

/** A SAB duration string, parsed to seconds (`null` on junk). */
const sabDuration = z.string().transform(parseSabDuration)

/**
 * A number SAB sends as a string (`"%.2f"`). Fails loudly on junk: these
 * are fields the progress math depends on, so a garbage value should
 * surface as a parse error, not as NaN three layers away.
 */
const sabNumber = z.coerce.number()

/**
 * A number SAB sends as a string, where junk is survivable and better read
 * as "unknown" (`null`) than as a failed poll. Used for `diskspace1`, which
 * is informational only.
 */
const sabLenientNumber = z
  .union([z.string(), z.number(), z.null()])
  .transform((value): number | null => {
    if (value === null) return null
    if (typeof value === 'string' && value.trim() === '') return null

    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
  })

/**
 * A string SAB may leave null (nullable DB columns on old history rows);
 * normalised to `''` so callers never branch on it.
 */
const sabTextOrEmpty = z
  .string()
  .nullish()
  .transform(value => value ?? '')

/** `mode=version` - `{"version": "5.1.3"}`. Needs no API key. */
export const SabVersionResponseSchema = z.looseObject({
  version: z.string(),
})
export type SabVersionResponse = z.infer<typeof SabVersionResponseSchema>

/**
 * One job in `mode=queue` (`build_queue`, `api.py:1690-1745`).
 *
 * - `cat` is the string `"None"` when the job has no category; normalised
 *   to `null`.
 * - `status` is kept as a plain string: SAB reports every job that isn't
 *   individually paused as "Downloading" while the downloader runs, and the
 *   set of values is SAB's to extend.
 * - `priority` is a name ("Normal", "High", ...) from
 *   `INTERFACE_PRIORITIES`, or the bare int `0` for priorities outside that
 *   map (a job added at Paused -2 or Stop -4).
 * - `percentage` is floored and can go backwards (par2 held back, Fetching);
 *   compute progress from `mb`/`mbleft` instead of showing it.
 * - `timeleft` is cumulative (queue bytes ahead of and including this job,
 *   divided by the GLOBAL speed), and `"0:00:00"` while paused.
 */
export const SabQueueSlotSchema = z.looseObject({
  nzo_id: z.string(),
  index: z.number().int(),
  filename: z.string(),
  cat: z
    .string()
    .nullable()
    .transform(value => (value === null || value === 'None' ? null : value)),
  status: z.string(),
  priority: z.union([z.string(), z.number()]),
  mb: sabNumber,
  mbleft: sabNumber,
  percentage: sabNumber,
  timeleft: sabDuration,
  labels: z.array(z.string()),
})
export type SabQueueSlot = z.infer<typeof SabQueueSlotSchema>

/**
 * The `queue` object of `mode=queue` (`build_header` + `build_queue`).
 *
 * - `status` is "Idle", "Downloading" or "Paused" (paused also covers
 *   SAB's pause-for-post-processing).
 * - `kbpersec` is the GLOBAL speed; SAB has no per-job speed.
 * - `diskspace1` is GB free on the download (incomplete) dir.
 * - `noofslots` is the number of jobs matching the request's filters;
 *   `noofslots_total` (passed through) is the unfiltered count.
 */
export const SabQueueSchema = z.looseObject({
  status: z.string(),
  paused: z.boolean(),
  kbpersec: sabNumber,
  diskspace1: sabLenientNumber,
  timeleft: sabDuration,
  noofslots: z.number().int(),
  slots: z.array(SabQueueSlotSchema),
})
export type SabQueue = z.infer<typeof SabQueueSchema>

export const SabQueueResponseSchema = z.looseObject({
  queue: SabQueueSchema,
})
export type SabQueueResponse = z.infer<typeof SabQueueResponseSchema>

/**
 * One row of `mode=history`. Two sources share this shape:
 *
 * - Jobs still post-processing (`add_active_history`) come first, with a
 *   `status` of Queued / QuickCheck / Verifying / Repairing / Extracting /
 *   Moving / Running, live text in `action_line` (e.g. "Repairing: 45%"),
 *   and `completed` always "now".
 * - Finished jobs are DB rows (`unpack_history_info`), with status
 *   Completed or Failed and an empty `action_line`.
 *
 * `category` is the raw job category and can be null. `fail_message` and
 * `action_line` tolerate null (normalised to `''`) because the underlying
 * DB columns are nullable; `bytes` tolerates null (normalised to `0`) for
 * the same reason. SAB 5.1.3 always writes them, so this only guards old
 * or hand-edited history rows.
 */
export const SabHistorySlotSchema = z.looseObject({
  nzo_id: z.string(),
  name: z.string(),
  status: z.string(),
  category: z.string().nullable(),
  action_line: sabTextOrEmpty,
  fail_message: sabTextOrEmpty,
  bytes: z
    .number()
    .nullish()
    .transform(value => value ?? 0),
  completed: z.number().int(),
})
export type SabHistorySlot = z.infer<typeof SabHistorySlotSchema>

/**
 * The `history` object of `mode=history` (`_api_history_default`).
 *
 * `last_history_update` is SAB's in-memory change COUNTER (starts at 1,
 * bumped on every history change, wraps back to 1) - not a timestamp. Pass
 * it back as `last_history_update` and SAB answers `{"history": false}`
 * without touching its DB when nothing changed.
 */
export const SabHistorySchema = z.looseObject({
  last_history_update: z.number().int(),
  ppslots: z.number().int(),
  noofslots: z.number().int(),
  slots: z.array(SabHistorySlotSchema),
})
export type SabHistory = z.infer<typeof SabHistorySchema>

/** `mode=history` - `{"history": false}` when unchanged since the counter. */
export const SabHistoryResponseSchema = z.looseObject({
  history: z.union([z.literal(false), SabHistorySchema]),
})
export type SabHistoryResponse = z.infer<typeof SabHistoryResponseSchema>

/**
 * SAB's HTTP-200 error envelope (`report(error)`, `api.py:1187-1221`), e.g.
 * `{"status": false, "error": "not implemented"}` for an unknown mode. Key
 * and host rejections are NOT this shape - they are HTTP 403s.
 */
export const SabApiErrorSchema = z.looseObject({
  status: z.literal(false),
  error: z.string(),
})
export type SabApiError = z.infer<typeof SabApiErrorSchema>
