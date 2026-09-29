import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'

import type { SabClientHealth } from 'src/media/media-state.service'
import { MediaStateService } from 'src/media/media-state.service'

import type { SabPhase, SabReading } from './sab-readings.util'
import { reduceSabReads, SAB_GONE_GRACE_TICKS } from './sab-readings.util'
import type { SabHistory, SabHistorySlot } from './sabnzbd.schema'
import { SabnzbdAuthError, SabnzbdService } from './sabnzbd.service'

/** How often SAB is read while Radarr/Sonarr track something. */
export const SAB_POLL_MS = 1_000

/** Consecutive failed ticks before the readings are dropped as `unhealthy`. */
export const SAB_UNHEALTHY_AFTER = 3

/**
 * Head-room on the history `limit`: SAB applies it after the `nzo_ids`
 * filter, so it only has to cover the ids asked for - a few spare rows
 * cover a duplicate row per id.
 */
const HISTORY_LIMIT_SLACK = 5

// - The reducer skips "Deleted" queue slots, so an id whose only slot is
//   one counts as out of the queue here too.
const DELETED_STATUS = 'Deleted'

const TERMINAL_PHASES: ReadonlySet<SabPhase> = new Set([
  'completed',
  'failed',
  'gone',
])

const AUTH_REJECTED_MESSAGE =
  'SABNZBD_API_KEY rejected - needs the full API key, not the NZB key'

/**
 * Reads SABnzbd once a second **while Radarr/Sonarr track something**,
 * reduces the reads to one reading per `nzo_id` (== Radarr/Sonarr's
 * `downloadId`) with `reduceSabReads`, and pushes the readings, their
 * health and the phase transitions into `MediaStateService`. Nothing
 * injects this service: consumers read the store.
 *
 * Active set - the ids worth reading - is every `downloadId` in the stored
 * Radarr and Sonarr queues plus every id this monitor still holds a
 * non-terminal reading for (so a job the *arr stopped tracking is followed
 * to its end). Empty set: no request, and the readings are cleared.
 * Readings are kept for active ids only: SAB's queue also holds jobs
 * nobody here tracks (manual NZBs), and those must not reach the store or
 * trigger refreshes. The whole queue still goes into the reducer, since a
 * slot's phase depends on the slots ahead of it.
 *
 * Per tick:
 * 1. `mode=queue`, unfiltered.
 * 2. `mode=history` for the active ids not in the queue, with the
 *    `last_history_update` cursor so an unchanged history costs nothing -
 *    skipped when every active id is in the queue.
 * 3. An id about to go `gone` (already missing `SAB_GONE_GRACE_TICKS`
 *    ticks) gets one archive lookup, to tell a job Radarr/Sonarr already
 *    imported (and SAB archived) from one that really vanished. The
 *    reducer treats a non-null history as the full picture, so on such a
 *    tick step 2 goes out without the cursor (it can't answer "unchanged")
 *    and the archive rows are merged into it.
 * 4. Reduce, store the readings as `ok`, queue the transitions.
 *
 * Health: `SAB_UNHEALTHY_AFTER` failed ticks in a row -> `unhealthy`, the
 * readings cleared (so snapshots fall back to Radarr/Sonarr's own numbers
 * instead of freezing a stale speed) and the reducer state dropped, so a
 * recovery starts clean. Failed ticks before that keep the last readings.
 * One success -> `ok`. Logged on each change, not on each failure.
 *
 * Optional: with SAB unconfigured every tick returns at once and the store
 * keeps its default `off`.
 */
@Injectable()
export class SabnzbdMonitorService {
  private readonly logger = new Logger(SabnzbdMonitorService.name)

  private readings: ReadonlyMap<string, SabReading> = new Map()
  private missingTicks: ReadonlyMap<string, number> = new Map()
  /** `last_history_update` from the last non-null history answer. */
  private historyCursor: number | undefined
  /**
   * The ids that answer was for. The cursor only means "unchanged" for the
   * same query - a different id set must not be answered `null`.
   */
  private historyCursorKey: string | undefined
  /** Ids already given their one archive lookup. */
  private readonly archiveLookedUp = new Set<string>()

  private health: SabClientHealth = 'off'
  private consecutiveFailures = 0
  /** The auth hint is logged once per failing stretch. */
  private authErrorLogged = false
  private inFlight = false

  constructor(
    private readonly sabnzbdService: SabnzbdService,
    private readonly mediaStateService: MediaStateService,
  ) {}

  /**
   * One poll. Never throws. A tick that fires while the previous one is
   * still waiting on SAB is skipped rather than stacked.
   */
  @Interval(SAB_POLL_MS)
  async tick(): Promise<void> {
    if (!this.sabnzbdService.enabled || this.inFlight) return

    this.inFlight = true
    try {
      // - A tick with nothing to read asked SAB nothing, so it proves
      //   nothing about SAB's health either way.
      if (await this.poll()) this.onSuccess()
    } catch (err) {
      this.onFailure(err)
    } finally {
      this.inFlight = false
    }
  }

  /** True when SAB was read; false when there was nothing to read. */
  private async poll(): Promise<boolean> {
    const active = this.activeIds()

    if (active.size === 0) {
      this.resetReducerState()
      this.mediaStateService.setClientReadings(new Map(), this.health)
      return false
    }

    const queue = await this.sabnzbdService.getQueue()
    const inQueue = new Set(
      queue.slots
        .filter(slot => slot.status !== DELETED_STATUS)
        .map(slot => slot.nzo_id),
    )
    const outOfQueue = [...active].filter(id => !inQueue.has(id))

    // - Everything is read at once and committed below only if every read
    //   succeeded, so a failed tick leaves the cursor and lookups untouched.
    const { history, cursor, cursorKey, archived } =
      await this.readHistory(outOfQueue)

    const prev = filterMap(this.readings, active)
    const result = reduceSabReads(prev, {
      queue,
      history,
      now: Date.now(),
      missingTicks: filterMap(this.missingTicks, active),
    })

    const readings = filterMap(result.readings, active)
    const transitions = result.transitions.filter(t => active.has(t.nzoId))

    this.readings = readings
    this.missingTicks = filterMap(result.missingTicks, active)
    this.historyCursor = cursor
    this.historyCursorKey = cursorKey
    for (const id of archived) this.archiveLookedUp.add(id)
    for (const id of this.archiveLookedUp) {
      if (!active.has(id)) this.archiveLookedUp.delete(id)
    }

    this.mediaStateService.setClientReadings(readings, 'ok')
    if (transitions.length > 0) {
      this.mediaStateService.pushClientTransitions(transitions)
    }
    return true
  }

  /**
   * Steps 2 and 3: the history for the ids out of the queue, with the
   * archive rows of the ids about to go `gone` merged in. `null` when
   * nothing was fetched or SAB says the history is unchanged.
   */
  private async readHistory(outOfQueue: string[]): Promise<{
    history: Pick<SabHistory, 'slots'> | null
    cursor: number | undefined
    cursorKey: string | undefined
    archived: string[]
  }> {
    if (outOfQueue.length === 0) {
      return {
        history: null,
        cursor: this.historyCursor,
        cursorKey: this.historyCursorKey,
        archived: [],
      }
    }

    const archiveIds = outOfQueue.filter(
      id =>
        (this.missingTicks.get(id) ?? 0) >= SAB_GONE_GRACE_TICKS &&
        !this.archiveLookedUp.has(id),
    )
    const key = [...outOfQueue].sort().join(',')
    const useCursor =
      archiveIds.length === 0 &&
      this.historyCursor !== undefined &&
      this.historyCursorKey === key

    const history = await this.sabnzbdService.getHistory({
      nzoIds: outOfQueue,
      limit: outOfQueue.length + HISTORY_LIMIT_SLACK,
      lastUpdate: useCursor ? this.historyCursor : undefined,
    })

    const cursor = history?.last_history_update ?? this.historyCursor
    const cursorKey = history ? key : this.historyCursorKey

    // - An id the history just listed isn't missing - no lookup needed.
    const listed = new Set(history?.slots.map(slot => slot.nzo_id))
    const lookups = archiveIds.filter(id => !listed.has(id))
    if (lookups.length === 0) {
      return { history, cursor, cursorKey, archived: [] }
    }

    const archiveRows = await Promise.all(
      lookups.map(async id => {
        const archive = await this.sabnzbdService.getHistory({
          nzoIds: [id],
          limit: 1,
          archive: true,
        })
        return archive?.slots ?? []
      }),
    )

    // - Sent without a cursor, so `history` is never null here; `?? []` is
    //   only for the type.
    const slots: SabHistorySlot[] = [
      ...(history?.slots ?? []),
      ...archiveRows.flat(),
    ]
    return { history: { slots }, cursor, cursorKey, archived: lookups }
  }

  /**
   * Every `downloadId` Radarr/Sonarr track, plus every id still held in a
   * non-terminal reading.
   */
  private activeIds(): Set<string> {
    const ids = new Set<string>()

    for (const source of ['radarr', 'sonarr'] as const) {
      for (const item of this.mediaStateService.getQueue(source)) {
        if (item.downloadId) ids.add(item.downloadId)
      }
    }

    for (const [id, reading] of this.readings) {
      if (!TERMINAL_PHASES.has(reading.phase)) ids.add(id)
    }

    return ids
  }

  private resetReducerState(): void {
    this.readings = new Map()
    this.missingTicks = new Map()
    this.archiveLookedUp.clear()
    this.historyCursor = undefined
    this.historyCursorKey = undefined
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0
    this.authErrorLogged = false

    if (this.health === 'ok') return

    const from = this.health
    this.health = 'ok'
    this.logger.log(
      { action: 'tick', from, to: 'ok' },
      from === 'unhealthy'
        ? 'SABnzbd reachable again, live download readings resumed'
        : 'SABnzbd reachable, live download readings on',
    )
  }

  private onFailure(err: unknown): void {
    this.consecutiveFailures += 1

    if (err instanceof SabnzbdAuthError && !this.authErrorLogged) {
      this.authErrorLogged = true
      this.logger.error({ action: 'tick' }, AUTH_REJECTED_MESSAGE)
    }

    if (
      this.consecutiveFailures < SAB_UNHEALTHY_AFTER ||
      this.health === 'unhealthy'
    ) {
      return
    }

    const from = this.health
    this.health = 'unhealthy'
    this.resetReducerState()
    this.mediaStateService.setClientReadings(new Map(), 'unhealthy')
    // - B1's errors never carry the URL or key, so the message is safe.
    this.logger.warn(
      {
        action: 'tick',
        error: getErrorMessage(err),
        failures: this.consecutiveFailures,
        from,
        to: 'unhealthy',
      },
      'SABnzbd unreachable, falling back to Radarr/Sonarr progress',
    )
  }
}

/** The entries of `map` whose key is in `keys`, as a new map. */
function filterMap<V>(
  map: ReadonlyMap<string, V>,
  keys: ReadonlySet<string>,
): Map<string, V> {
  const out = new Map<string, V>()
  for (const [key, value] of map) {
    if (keys.has(key)) out.set(key, value)
  }
  return out
}
