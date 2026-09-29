/**
 * Pure reducer that turns successive SABnzbd reads (`mode=queue`, plus
 * `mode=history` when fetched) into one reading per `nzo_id` and the phase
 * transitions between ticks. `nzo_id` is Radarr/Sonarr's `downloadId`; each
 * transition is meant to trigger exactly one `RefreshMonitoredDownloads`.
 *
 * Semantics come from SABnzbd 5.1.3's source:
 *
 * - `constants.py` `Status` - the status strings.
 * - `api.py` `build_queue` - slot status and `timeleft`. While the downloader
 *   runs, every slot not paused on its own reads "Downloading"; a slot's own
 *   "Queued" only shows through while the whole queue is paused.
 * - `constants.py` `MEBI` - queue `mb` / `mbleft` are MiB (2^20 bytes).
 * - `constants.py` `FORCE_PRIORITY` / `INTERFACE_PRIORITIES` - Force is the
 *   int 2, sent as the label "Force"; a Force job downloads through a global
 *   pause.
 */

/** One `mode=queue` slot, already parsed (numbers are numbers). */
export interface SabQueueSlotRead {
  readonly nzo_id: string
  /** Queue order, 0 = next in line. */
  readonly index: number
  readonly status: string
  /** The label ("Force", "High", ...) or a bare int for unmapped priorities. */
  readonly priority: string | number
  /** Total size in MiB. */
  readonly mb: number
  /** MiB still to download. */
  readonly mbleft: number
  /** Seconds, cumulative over the queue ahead of and including this slot. */
  readonly timeleft: number | null
}

/** `mode=queue`, already parsed. */
export interface SabQueueRead {
  /** SAB's global pause. */
  readonly paused: boolean
  /** GB free on the download disk. */
  readonly diskspace1: number | null
  readonly slots: readonly SabQueueSlotRead[]
}

/** One `mode=history` row, already parsed. */
export interface SabHistorySlotRead {
  readonly nzo_id: string
  readonly status: string
  readonly action_line: string | null
  readonly fail_message: string | null
}

/** `mode=history`, already parsed. */
export interface SabHistoryRead {
  readonly slots: readonly SabHistorySlotRead[]
}

export type SabPhase =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'post_processing'
  | 'completed'
  | 'failed'
  | 'gone'

export interface SabReading {
  nzoId: string
  phase: SabPhase
  totalBytes: number
  downloadedBytes: number
  /**
   * EWMA of the download rate between consecutive `downloading` reads, in
   * bytes per second. Null until two samples in the current phase, and in
   * every phase other than `downloading`.
   */
  speedBps: number | null
  /** The slot's own `timeleft`; null when paused, post-processing or gone. */
  etaSeconds: number | null
  /** Post-processing status, e.g. "Repairing". */
  stage: string | null
  /** `action_line` as plain text, e.g. "Repairing: 45% - 1:23 left". */
  stageDetail: string | null
  globallyPaused: boolean
  diskFreeGb: number | null
  failMessage: string | null
  /** The `now` of the last tick a view refreshed this reading. */
  seenAt: number
}

export interface SabTransition {
  nzoId: string
  from: SabPhase | null
  to: SabPhase
}

export interface SabReadInput {
  queue: SabQueueRead
  /** Null = not fetched this tick, or unchanged since the last read. */
  history: SabHistoryRead | null
  /** Epoch milliseconds. */
  now: number
  /** Consecutive ticks each id has been missing from both views. */
  missingTicks: ReadonlyMap<string, number>
}

export interface SabReadResult {
  readings: Map<string, SabReading>
  transitions: SabTransition[]
  missingTicks: Map<string, number>
}

/**
 * Ticks an id may be missing from both views before it is `gone`. At the
 * download -> post-processing handoff a job can briefly be in neither.
 */
export const SAB_GONE_GRACE_TICKS = 2

/** Weight of the newest sample in the speed EWMA. */
export const SAB_SPEED_EWMA_ALPHA = 0.3

const MIB = 1024 * 1024

const FORCE_PRIORITY_LABEL = 'Force'
const FORCE_PRIORITY_VALUE = 2

const PAUSED_STATUS = 'Paused'
const DELETED_STATUS = 'Deleted'
// - "Fetching" = downloading extra par2 blocks; still a transfer.
const DOWNLOADING_STATUSES: ReadonlySet<string> = new Set([
  'Downloading',
  'Fetching',
])

const COMPLETED_STATUS = 'Completed'
const FAILED_STATUS = 'Failed'

const TERMINAL_PHASES: ReadonlySet<SabPhase> = new Set([
  'completed',
  'failed',
  'gone',
])
const HISTORY_PHASES: ReadonlySet<SabPhase> = new Set([
  'post_processing',
  'completed',
  'failed',
])

function isForcePriority(priority: string | number): boolean {
  return priority === FORCE_PRIORITY_LABEL || priority === FORCE_PRIORITY_VALUE
}

/**
 * Classifies the queue's slots. Only the first transferring slot in queue
 * order is `downloading`; SAB labels every other runnable slot
 * "Downloading" too, and those are really waiting their turn. "Deleted"
 * slots are skipped, as Radarr does. Unknown statuses fall back to `queued`.
 */
function classifyQueue(
  queue: SabQueueRead,
): Map<string, { slot: SabQueueSlotRead; phase: SabPhase }> {
  const slots = queue.slots
    .filter(slot => slot.status !== DELETED_STATUS)
    .sort((a, b) => a.index - b.index)

  const classified = new Map<
    string,
    { slot: SabQueueSlotRead; phase: SabPhase }
  >()
  let downloadingTaken = false

  for (const slot of slots) {
    if (classified.has(slot.nzo_id)) continue

    let phase: SabPhase
    if (slot.status === PAUSED_STATUS) {
      phase = 'paused'
    } else if (queue.paused && !isForcePriority(slot.priority)) {
      phase = 'paused'
    } else if (DOWNLOADING_STATUSES.has(slot.status) && !downloadingTaken) {
      phase = 'downloading'
      downloadingTaken = true
    } else {
      // - Queued / Grabbing / Propagating / Checking, and later
      //   "Downloading" slots.
      phase = 'queued'
    }
    classified.set(slot.nzo_id, { slot, phase })
  }

  return classified
}

/**
 * Every history row that isn't Completed or Failed is a job SAB is still
 * post-processing (Queued, QuickCheck, Verifying, Repairing, Fetching,
 * Extracting, Moving, Running) - `add_active_history` only adds those.
 */
function historyPhase(status: string): SabPhase {
  if (status === COMPLETED_STATUS) return 'completed'
  if (status === FAILED_STATUS) return 'failed'
  return 'post_processing'
}

/**
 * Strips HTML tags (a `<br>` becomes a space, so lines don't run together)
 * and collapses whitespace; empty -> null.
 */
function toPlainText(value: string | null): string | null {
  if (value === null) return null
  const text = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? null : text
}

function nonEmpty(value: string | null): string | null {
  return value === null || value.trim() === '' ? null : value
}

/**
 * One EWMA step. `last` is the previous reading only when it was in the
 * same (`downloading`) phase. A falling byte count (par2 blocks added while
 * Fetching) or a non-positive interval keeps the last speed.
 */
function nextSpeed(
  last: SabReading | undefined,
  downloadedBytes: number,
  now: number,
): number | null {
  if (!last) return null

  const seconds = (now - last.seenAt) / 1000
  const bytes = downloadedBytes - last.downloadedBytes
  if (seconds <= 0 || bytes < 0) return last.speedBps

  const rate = bytes / seconds
  if (last.speedBps === null) return rate
  return (
    SAB_SPEED_EWMA_ALPHA * rate + (1 - SAB_SPEED_EWMA_ALPHA) * last.speedBps
  )
}

function fromQueueSlot(
  last: SabReading | undefined,
  slot: SabQueueSlotRead,
  phase: SabPhase,
  queue: SabQueueRead,
  now: number,
): SabReading {
  const totalBytes = Math.round(slot.mb * MIB)
  const downloadedBytes = Math.max(0, Math.round((slot.mb - slot.mbleft) * MIB))
  const sameDownloadingPhase =
    phase === 'downloading' && last?.phase === 'downloading'

  return {
    nzoId: slot.nzo_id,
    phase,
    totalBytes,
    downloadedBytes,
    speedBps:
      phase === 'downloading'
        ? nextSpeed(
            sameDownloadingPhase ? last : undefined,
            downloadedBytes,
            now,
          )
        : null,
    etaSeconds: phase === 'paused' ? null : slot.timeleft,
    stage: null,
    stageDetail: null,
    globallyPaused: queue.paused,
    diskFreeGb: queue.diskspace1,
    failMessage: null,
    seenAt: now,
  }
}

/**
 * History carries no byte counts in our input, so a history reading keeps
 * the last queue total (0 when the id was never seen in the queue). Once
 * post-processing starts the download is whole, so downloaded = total; a
 * failure keeps the last downloaded count, since a job can fail mid-download.
 */
function fromHistoryRow(
  last: SabReading | undefined,
  row: SabHistorySlotRead,
  queue: SabQueueRead,
  now: number,
): SabReading {
  const phase = historyPhase(row.status)
  const totalBytes = last?.totalBytes ?? 0
  const processing = phase === 'post_processing'

  return {
    nzoId: row.nzo_id,
    phase,
    totalBytes,
    downloadedBytes:
      phase === 'failed' ? (last?.downloadedBytes ?? 0) : totalBytes,
    speedBps: null,
    etaSeconds: null,
    stage: processing ? row.status : null,
    stageDetail: processing ? toPlainText(row.action_line) : null,
    globallyPaused: queue.paused,
    diskFreeGb: queue.diskspace1,
    failMessage: phase === 'failed' ? nonEmpty(row.fail_message) : null,
    seenAt: now,
  }
}

/**
 * Reduces one tick's SAB reads against the previous readings.
 *
 * - An id in the queue is read from the queue, even if history also has it.
 * - An id in neither view keeps its last reading and counts a missing tick;
 *   after more than `SAB_GONE_GRACE_TICKS` in a row it becomes `gone`.
 *   Seen again, its count resets.
 * - With `history` null, an id whose last reading came from history
 *   (post_processing / completed / failed) keeps it without counting a miss.
 *   An id that left the queue still counts, so the caller should fetch
 *   history on the tick an id leaves the queue.
 * - A non-null `history` is authoritative for every id: a post-processing id
 *   it doesn't list counts a miss, like any other.
 * - Terminal readings (completed / failed / gone) stay in the output while a
 *   view still lists them (or `history` is null, for completed / failed), so
 *   the caller sees each one at least once. The first tick a terminal id is
 *   absent, it is dropped without a transition - the map never accumulates
 *   finished jobs. If it later reappears it is new again (`null -> X`).
 * - A transition is emitted only when an id's phase changes, including
 *   `null -> X` for a newly seen id and `X -> gone`.
 */
export function reduceSabReads(
  prev: ReadonlyMap<string, SabReading>,
  read: SabReadInput,
): SabReadResult {
  const { queue, history, now } = read
  const readings = new Map<string, SabReading>()
  const transitions: SabTransition[] = []
  const missingTicks = new Map<string, number>()

  const emit = (next: SabReading): void => {
    const from = prev.get(next.nzoId)?.phase ?? null
    if (from !== next.phase) {
      transitions.push({ nzoId: next.nzoId, from, to: next.phase })
    }
    readings.set(next.nzoId, next)
  }

  for (const [nzoId, { slot, phase }] of classifyQueue(queue)) {
    emit(fromQueueSlot(prev.get(nzoId), slot, phase, queue, now))
  }

  for (const row of history?.slots ?? []) {
    // - The queue wins; the first row wins over duplicates.
    if (readings.has(row.nzo_id)) continue
    emit(fromHistoryRow(prev.get(row.nzo_id), row, queue, now))
  }

  for (const [nzoId, last] of prev) {
    if (readings.has(nzoId)) continue

    // - History unchanged: a history-derived reading is still there.
    if (history === null && HISTORY_PHASES.has(last.phase)) {
      readings.set(nzoId, last)
      const count = read.missingTicks.get(nzoId)
      if (count !== undefined) missingTicks.set(nzoId, count)
      continue
    }

    // - Terminal and absent: already reported, drop it.
    if (TERMINAL_PHASES.has(last.phase)) continue

    const missed = (read.missingTicks.get(nzoId) ?? 0) + 1
    if (missed > SAB_GONE_GRACE_TICKS) {
      emit({
        ...last,
        phase: 'gone',
        speedBps: null,
        etaSeconds: null,
        stage: null,
        stageDetail: null,
      })
      continue
    }

    missingTicks.set(nzoId, missed)
    readings.set(nzoId, last)
  }

  return { readings, transitions, missingTicks }
}
