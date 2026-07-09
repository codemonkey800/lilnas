import { env } from '@lilnas/utils/env'
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import type BetterSqlite3 from 'better-sqlite3'
import { PinoLogger } from 'nestjs-pino'
import {
  asyncScheduler,
  debounceTime,
  groupBy,
  mergeMap,
  Observable,
  throttleTime,
} from 'rxjs'

import type { BotStatusDto } from 'src/bot/bot-status.dto'
import { isBotOffline, staleThresholdMs } from 'src/bot/staleness'
import { latestGeneration } from 'src/db/bot-generation.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { listLive } from 'src/db/live-status.repo'
import { isEndedGeneration, isRunningGeneration } from 'src/db/schema'
import { EnvKeys } from 'src/env'
import { LOG_EVENTS } from 'src/logging/log-events'

import { NotifyBusService } from './notify-bus.service'
import {
  isSessionTopic,
  type NotifySignal,
  parseSessionTopic,
  sessionTopic,
  type Topic,
} from './sse.types'

// Local widening of the Drizzle $client escape hatch to the real
// better-sqlite3 Database shape — mirrors auth-schema.spec.ts's own local
// WithSqliteClient rather than importing database.module.ts's narrower
// exported type (that one only types `pragma` as a `void`-returning
// single-string call, which doesn't fit the `{ simple: true }` form used
// below). Kept local to this file rather than widening the shared export,
// since no other production call site needs the fuller shape.
type WithSqliteClient = { $client: InstanceType<typeof BetterSqlite3> }

// Per-topic fixed-window throttle window (R7): a fresh 50ms window opens on
// the first signal for a topic and one more is guaranteed just before it
// closes if further signals arrived, then the window resets. This is what
// keeps a continuous sub-50ms stream (a token burst) emitting at a bounded,
// steady cadence instead of the connection going silent until the agent
// pauses.
const THROTTLE_WINDOW_MS = 50

// A derived bot-status string, computed the same way BotStatusService.
// getStatus() derives BotStatusDto.status — duplicated here (not imported)
// because SseModule must never depend on ConsoleModule's provider graph
// (the process-scoping invariant: SseModule is @Global and reachable from
// anywhere, so pulling in a ConsoleModule-only service here would be an
// accidental cross-module coupling with no compile-time guard against it
// reaching BotModule). Both call sites are thin wrappers over the same
// primitives (latestGeneration/isRunningGeneration/isEndedGeneration/
// staleThresholdMs) so they cannot silently drift on the underlying rule,
// only on presentation shape (which this fallback detector doesn't need —
// it only ever compares the string for equality across ticks).
function computeBotStatusDigest(db: Db, now: Date): BotStatusDto['status'] {
  const row = latestGeneration(db)
  if (!row) return 'never-seen'
  if (isEndedGeneration(row)) {
    return row.status === 'failed' ? 'offline-failed' : 'offline'
  }
  if (row.status === 'failed') return 'offline-failed'
  if (isRunningGeneration(row)) {
    const ageSinceHeartbeat = now.getTime() - row.lastHeartbeatAt.getTime()
    return ageSinceHeartbeat > staleThresholdMs() ? 'offline' : 'online'
  }
  return 'starting'
}

// A digest of the derived live-status DTO's per-row `state` (see
// live.service.ts's getLive()) — cheap enough to recompute every tick
// without building the full LiveResponseDto (which would need
// BotStatusService, again out of reach per the process-scoping note above).
// Covers the same time-derived transitions getLive() computes
// (working/idle/stale/last-known) so a live-page flip with zero DB writes
// (e.g. a channel's heartbeat going stale) still changes this string. Uses
// the same shared isBotOffline() as getLive() so the two derivations of
// this rule cannot drift on what 'starting' means.
function computeLiveDigest(db: Db, now: Date): string {
  const botOffline = isBotOffline(computeBotStatusDigest(db, now))
  const row = latestGeneration(db)
  if (!row) return 'never-seen'
  const threshold = staleThresholdMs()
  const rows = listLive(db, row.id)
  const parts = rows
    .map(r => {
      const stale = now.getTime() - r.lastHeartbeatAt.getTime() > threshold
      const state = botOffline
        ? 'last-known'
        : stale
          ? 'stale'
          : r.prompting
            ? 'working'
            : 'idle'
      return `${r.channelId}:${state}`
    })
    .sort()
  return `${botOffline ? 'offline' : 'online'}|${parts.join(',')}`
}

interface Connection {
  id: number
  topics: Set<Topic>
}

// The in-process subscriber registry + fallback tick. Injects the global DB
// provider directly (not a ConsoleModule/BotModule service) so SseModule
// never depends on either — see the header comment on computeBotStatusDigest
// for why that boundary matters.
//
// Read discipline (load-bearing): every detector read below is either a bare
// autocommit call ($client.pragma('data_version', ...)) or goes through the
// injected Db directly with no wrapping transaction held open across ticks.
// No BEGIN IMMEDIATE anywhere on this path — the Phase B writers plan's WAL
// ruling applies here too: an IMMEDIATE would stall the one shared event
// loop under the two-process topology.
@Injectable()
export class SseHubService implements OnModuleDestroy {
  private readonly connections = new Map<number, Connection>()
  private readonly perConnectionListeners = new Map<
    number,
    (signal: NotifySignal) => void
  >()
  private nextConnectionId = 0

  private fallbackInterval: NodeJS.Timeout | null = null
  private stalenessInterval: NodeJS.Timeout | null = null

  // Seeded (never left null) the moment the fallback timers start — see
  // startFallbackTimersIfNeeded — so the first tick of each timer compares
  // against a real baseline instead of unconditionally emitting on its own
  // first run. Reset to null on the 1->0 teardown so a later 0->1 restart
  // seeds fresh rather than comparing against a stale prior-lifetime value.
  private lastDataVersion: number | null = null
  private lastBotStatusDigest: string | null = null
  private lastLiveDigest: string | null = null

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
    private readonly notifyBus: NotifyBusService,
  ) {
    // groupBy(topic) + per-group throttleTime(leading+trailing) + mergeMap
    // identity is the composition that satisfies R7 without starving a
    // sustained stream: groupBy fans the single stream$ into one sub-stream
    // per topic so a burst on 'session:1' can never delay a signal on
    // 'session:2' waiting behind it, and {leading:true, trailing:true} on
    // each sub-stream is what makes it a steady-cadence throttle rather
    // than a bare debounceTime — trailing alone would mean a continuous
    // sub-50ms stream keeps resetting the timer forever (never firing until
    // the source goes quiet), which is exactly the starvation failure mode
    // the plan calls out. Explicitly NOT `debounceTime(50)`.
    this.notifyBus.stream$
      .pipe(
        // duration closes (and discards) a topic's group once it's been
        // idle for 4 throttle windows — without it, groupBy's internal
        // per-key Subject is retained for the life of the process, and
        // session topics carry a never-repeating id per session, so the
        // group map would grow forever. 4x keeps the window well clear of
        // an active burst's own trailing emit; a re-created group's fresh
        // leading edge on the next signal is at most one harmless
        // redundant fanOut under snapshot-refetch idempotency.
        groupBy((signal: NotifySignal) => signal.topic, {
          duration: group$ => group$.pipe(debounceTime(THROTTLE_WINDOW_MS * 4)),
        }),
        mergeMap(group$ =>
          group$.pipe(
            throttleTime(THROTTLE_WINDOW_MS, asyncScheduler, {
              leading: true,
              trailing: true,
            }),
          ),
        ),
      )
      .subscribe(signal => {
        this.logger.debug(
          { event: LOG_EVENTS.notifyReceived, topic: signal.topic },
          'Notify received',
        )
        this.fanOut(signal.topic)
      })
  }

  onModuleDestroy(): void {
    this.stopFallbackTimers()
  }

  // Returns a fresh connection id and an Observable of NotifySignal scoped
  // to `topics`. Caller (the U2 SSE controller) is responsible for calling
  // unsubscribe(id) when the connection tears down — the returned
  // Observable itself carries no teardown hook, since the hub's fan-out is
  // push-based (fanOut() reads `this.connections`), not per-subscriber pull.
  subscribe(topics: Topic[]): {
    connectionId: number
    signals$: Observable<NotifySignal>
  } {
    const connectionId = this.nextConnectionId++
    this.connections.set(connectionId, {
      id: connectionId,
      topics: new Set(topics),
    })
    this.startFallbackTimersIfNeeded()

    const signals$ = new Observable<NotifySignal>(subscriber => {
      const listener = (signal: NotifySignal): void => subscriber.next(signal)
      this.perConnectionListeners.set(connectionId, listener)
      return () => {
        this.perConnectionListeners.delete(connectionId)
      }
    })

    return { connectionId, signals$ }
  }

  unsubscribe(connectionId: number): void {
    this.connections.delete(connectionId)
    this.perConnectionListeners.delete(connectionId)
    this.stopFallbackTimersIfIdle()
  }

  // Exposed for tests only — real callers never need the raw registry size.
  connectionCount(): number {
    return this.connections.size
  }

  // Fan a topic out to every connection subscribed to it — called at most
  // once per notify-driven signal and at most once per fallback-detected
  // change, never once per connection (the detector reads above already ran
  // exactly once for this tick/signal before this is invoked).
  private fanOut(topic: Topic): void {
    let emitted = 0
    for (const connection of this.connections.values()) {
      if (!connection.topics.has(topic)) continue
      const listener = this.perConnectionListeners.get(connection.id)
      if (!listener) continue
      listener({ topic })
      emitted++
    }
    if (emitted > 0) {
      this.logger.debug(
        { event: LOG_EVENTS.sseSignalEmitted, topic, emitted },
        'SSE signal emitted',
      )
    }
  }

  private startFallbackTimersIfNeeded(): void {
    if (this.connections.size !== 1) return
    // Seed the watermarks from a real read BEFORE either timer's first tick
    // can fire, so "has it changed since baseline" is meaningful from tick
    // one instead of every fallback service unconditionally emitting once
    // on its own first run (which would be a spurious signal — harmless
    // under snapshot-refetch idempotency, but it would make "nothing
    // changed -> nothing emitted" untestable as a first-tick property).
    const now = new Date()
    this.lastDataVersion = this.readDataVersion()
    this.lastBotStatusDigest = computeBotStatusDigest(this.db, now)
    this.lastLiveDigest = computeLiveDigest(this.db, now)

    // one-handle-per-key: both timers are created exactly once, on the 0->1
    // transition, and cleared exactly once, on the 1->0 transition (see
    // stopFallbackTimersIfIdle). Never recreated while already running.
    if (this.fallbackInterval === null) {
      const intervalMs = parseInt(
        env(EnvKeys.SSE_FALLBACK_INTERVAL_MS, '30000'),
        10,
      )
      this.fallbackInterval = setInterval(
        () => this.runFallbackTick(),
        intervalMs,
      )
      this.logger.debug(
        {
          event: LOG_EVENTS.sseFallbackIntervalStarted,
          intervalMs,
          kind: 'data-version',
        },
        'SSE fallback interval started',
      )
    }
    if (this.stalenessInterval === null) {
      const recomputeMs = parseInt(
        env(EnvKeys.SSE_STALENESS_RECOMPUTE_MS, '10000'),
        10,
      )
      this.stalenessInterval = setInterval(
        () => this.runStalenessRecompute(),
        recomputeMs,
      )
      this.logger.debug(
        {
          event: LOG_EVENTS.sseFallbackIntervalStarted,
          intervalMs: recomputeMs,
          kind: 'staleness-recompute',
        },
        'SSE fallback interval started',
      )
    }
  }

  private stopFallbackTimersIfIdle(): void {
    if (this.connections.size > 0) return
    this.stopFallbackTimers()
  }

  private stopFallbackTimers(): void {
    if (this.fallbackInterval !== null) {
      clearInterval(this.fallbackInterval)
      this.fallbackInterval = null
      this.logger.debug(
        { event: LOG_EVENTS.sseFallbackIntervalStopped, kind: 'data-version' },
        'SSE fallback interval stopped',
      )
    }
    if (this.stalenessInterval !== null) {
      clearInterval(this.stalenessInterval)
      this.stalenessInterval = null
      this.logger.debug(
        {
          event: LOG_EVENTS.sseFallbackIntervalStopped,
          kind: 'staleness-recompute',
        },
        'SSE fallback interval stopped',
      )
    }
    // Reset watermarks so a fresh 0->1 transition starts from a clean
    // baseline rather than comparing against a stale reading from a
    // previous connection's lifetime.
    this.lastDataVersion = null
    this.lastBotStatusDigest = null
    this.lastLiveDigest = null
  }

  // The ~30s data_version backstop (R8/R10): catches any change a dropped
  // notify missed, INSERT or in-place UPDATE alike, because data_version is
  // a whole-DB commit counter that advances on both — unlike max(id), which
  // is blind to UPDATEs (the AE5 hole this design closes). Runs the derived
  // recomputes too on the same tick as a courtesy (they also have their own
  // faster stalenessInterval — see runStalenessRecompute), so a slow client
  // that only holds the 30s cadence still eventually catches up.
  private runFallbackTick(): void {
    const version = this.readDataVersion()
    const advanced = version !== this.lastDataVersion
    this.lastDataVersion = version
    this.logger.debug(
      { event: LOG_EVENTS.sseFallbackTick, version, advanced },
      'SSE fallback tick',
    )
    if (!advanced) return

    this.emitAdvancedSessionTopics()
    this.recomputeAndEmitBotStatus()
    this.recomputeAndEmitLive()
  }

  // The faster (<= staleThresholdMs()) derived-status recompute (R2's
  // carve-out + R12/F3): bot-status and live can flip purely from the
  // passage of time (heartbeat staleness), with zero intervening commits,
  // so this path recomputes and compares the digest unconditionally on
  // every tick rather than gating on data_version first.
  private runStalenessRecompute(): void {
    this.recomputeAndEmitBotStatus()
    this.recomputeAndEmitLive()
  }

  private recomputeAndEmitBotStatus(): void {
    const digest = computeBotStatusDigest(this.db, new Date())
    const changed = digest !== this.lastBotStatusDigest
    this.lastBotStatusDigest = digest
    if (changed) this.fanOut('bot-status')
  }

  private recomputeAndEmitLive(): void {
    const digest = computeLiveDigest(this.db, new Date())
    const changed = digest !== this.lastLiveDigest
    this.lastLiveDigest = digest
    if (changed) this.fanOut('live')
  }

  // Scoped to currently-subscribed session ids only (never a full table
  // scan) — data_version having advanced doesn't tell us WHICH session
  // changed, so every subscribed session topic is treated as potentially
  // affected. This is intentionally coarse (a false-positive refetch for an
  // untouched session costs one redundant snapshot read); the alternative
  // (a per-session max(id)/max(updated_at) probe) would miss in-place
  // UPDATEs for the exact reason data_version was chosen as the primary
  // detector in the first place.
  private emitAdvancedSessionTopics(): void {
    const sessionIds = new Set<string>()
    for (const connection of this.connections.values()) {
      for (const topic of connection.topics) {
        if (isSessionTopic(topic)) {
          const id = parseSessionTopic(topic)
          if (id !== null) sessionIds.add(id)
        }
      }
    }
    for (const id of sessionIds) {
      this.fanOut(sessionTopic(id))
    }
  }

  // PRAGMA data_version — a whole-DB commit counter that increments once
  // per commit made by ANY OTHER connection to this database file (it does
  // NOT advance for commits made through this same connection handle,
  // which is exactly right: the main server never writes live data, so
  // every advance here is guaranteed to originate from the bot process).
  // Read via the raw $client escape hatch (same pattern database.module.ts
  // uses for its own post-migrate PRAGMA reassertion) because Drizzle has
  // no query-builder surface for a bare PRAGMA. `{ simple: true }` returns
  // the plain integer instead of a [{ data_version: N }] row array.
  private readDataVersion(): number {
    const client = (this.db as unknown as WithSqliteClient).$client
    return client.pragma('data_version', { simple: true }) as number
  }
}
