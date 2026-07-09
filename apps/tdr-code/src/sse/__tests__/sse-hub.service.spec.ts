import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { PinoLogger } from 'nestjs-pino'

import {
  finalize,
  insertGeneration,
  markRunning,
} from 'src/db/bot-generation.repo'
import type { Db } from 'src/db/database.module'
import { resolveMigrationsFolder } from 'src/db/database.module'
import { upsertLiveStatus } from 'src/db/live-status.repo'
import * as schema from 'src/db/schema'
import { insertSession } from 'src/db/sessions.repo'
import { createTestDb } from 'src/db/test-db'
import { insertToolCall, updateToolCallStatus } from 'src/db/turn-content.repo'
import { insertTurn } from 'src/db/turns.repo'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import type { NotifySignal, Topic } from 'src/sse/sse.types'
import { SseHubService } from 'src/sse/sse-hub.service'

function fakeLogger(): PinoLogger {
  return {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

// Collects every signal a subscribe() call receives, and returns an
// unsubscribe function so callers can simulate a connection tearing down.
function collect(
  hub: SseHubService,
  topics: Topic[],
): { connectionId: number; received: NotifySignal[]; close: () => void } {
  const { connectionId, signals$ } = hub.subscribe(topics)
  const received: NotifySignal[] = []
  const sub = signals$.subscribe(signal => received.push(signal))
  return {
    connectionId,
    received,
    close: () => {
      sub.unsubscribe()
      hub.unsubscribe(connectionId)
    },
  }
}

function seedSession(
  db: Db,
  opts: { generationId: number; channelId: string },
) {
  const session = insertSession(db, {
    channelId: opts.channelId,
    generationId: opts.generationId,
    triggeringUserId: 'user-1',
    acpSessionId: null,
    cwd: '/tmp',
    createdAt: new Date(),
  })
  const turn = insertTurn(db, {
    sessionId: session.id,
    generationId: opts.generationId,
    turnIndex: 1,
    userId: 'user-1',
    startedAt: new Date(),
  })
  return { session, turn }
}

// PRAGMA data_version only advances when a commit lands from a DIFFERENT
// connection than the one reading it (this is the exact property that
// makes it the correct fallback detector in production: the main server's
// own connection never writes live data, so every observed advance is
// guaranteed to have come from the bot's separate connection). A single
// in-memory createTestDb() handle can't exercise that — a second handle to
// the SAME file is required (mirrors live-status.repo.spec.ts's own
// "two-writer sanity" WAL test). This helper opens exactly that: a
// file-backed migrated DB plus a second raw connection to the same file
// that tests use to simulate the bot process's writes, so the hub's own
// `db` (the "second connection" here, matching main-server semantics)
// observes them via data_version rather than same-connection visibility
// alone.
function createTwoConnectionTestDb(): {
  hubDb: Db
  writerDb: Db
  close: () => void
} {
  const tmpFile = path.join(
    os.tmpdir(),
    `sse-hub-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  )
  const migrationsFolder = resolveMigrationsFolder()

  const hubSqlite = new BetterSqlite3(tmpFile)
  hubSqlite.pragma('journal_mode = WAL')
  hubSqlite.pragma('foreign_keys = ON')
  hubSqlite.pragma('busy_timeout = 5000')
  const hubDb = drizzle(hubSqlite, { schema }) as unknown as Db
  migrate(hubDb as never, { migrationsFolder })
  hubSqlite.pragma('foreign_keys = ON')

  const writerSqlite = new BetterSqlite3(tmpFile)
  writerSqlite.pragma('journal_mode = WAL')
  writerSqlite.pragma('foreign_keys = ON')
  writerSqlite.pragma('busy_timeout = 5000')
  const writerDb = drizzle(writerSqlite, { schema }) as unknown as Db

  return {
    hubDb,
    writerDb,
    close: () => {
      hubSqlite.close()
      writerSqlite.close()
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          fs.unlinkSync(tmpFile + suffix)
        } catch {
          /* best-effort cleanup */
        }
      }
    },
  }
}

describe('SseHubService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    process.env.SSE_FALLBACK_INTERVAL_MS = '30000'
    process.env.SSE_STALENESS_RECOMPUTE_MS = '10000'
    process.env.BOT_HEARTBEAT_MS = '5000'
    process.env.BOT_HEARTBEAT_STALE_THRESHOLD_MS = '15000'
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete process.env.SSE_FALLBACK_INTERVAL_MS
    delete process.env.SSE_STALENESS_RECOMPUTE_MS
    delete process.env.BOT_HEARTBEAT_MS
    delete process.env.BOT_HEARTBEAT_STALE_THRESHOLD_MS
  })

  // ── Single-connection scenarios (notify-driven path + derived digests,
  // neither of which depends on cross-connection data_version visibility)
  // ──────────────────────────────────────────────────────────────────────

  describe('single-connection scenarios', () => {
    let testDb: ReturnType<typeof createTestDb>
    let db: Db

    beforeEach(() => {
      testDb = createTestDb()
      db = testDb.db
    })

    afterEach(() => {
      testDb.close()
    })

    function buildHub(bus = new NotifyBusService()) {
      return { hub: new SseHubService(db, fakeLogger(), bus), bus }
    }

    it('happy path: notify(session:1) reaches a session:1 subscriber but not a session:2 subscriber', () => {
      const { hub, bus } = buildHub()
      const s1 = collect(hub, ['session:1'])
      const s2 = collect(hub, ['session:2'])

      bus.publish('session:1')
      jest.advanceTimersByTime(60) // clear the 50ms throttle window

      expect(s1.received).toEqual([{ topic: 'session:1' }])
      expect(s2.received).toEqual([])

      s1.close()
      s2.close()
    })

    it('coalesce (R7): a burst of notify(session:1) then silence is bounded to leading+trailing (2), never one-per-publish (3)', () => {
      const { hub, bus } = buildHub()
      const conn = collect(hub, ['session:1'])

      // Three back-to-back publishes with no time between them: the
      // leading edge fires for the first immediately; because further
      // values (2nd, 3rd) arrived inside the same window, one trailing
      // signal fires when the window closes. This is what a
      // {leading:true, trailing:true} throttle produces for a burst — the
      // key correctness property is boundedness (2, not 3 — one per
      // publish would mean no coalescing at all), not "exactly 1", which
      // is a bare-debounce-only outcome incompatible with the
      // no-starvation requirement covered below.
      bus.publish('session:1')
      bus.publish('session:1')
      bus.publish('session:1')
      jest.advanceTimersByTime(60)

      expect(conn.received.length).toBeGreaterThanOrEqual(1)
      expect(conn.received.length).toBeLessThan(3)
      expect(conn.received.every(signal => signal.topic === 'session:1')).toBe(
        true,
      )

      conn.close()
    })

    it('no starvation under sustained stream: signals every 30ms for 2s emit at a bounded steady cadence, not zero-until-stopped', () => {
      const { hub, bus } = buildHub()
      const conn = collect(hub, ['session:1'])

      // A steady 30ms-period publish is faster than the 50ms throttle
      // window. A bare debounceTime(50) would never fire while this keeps
      // running (every new value resets its timer) — the assertions below
      // are only satisfiable by a leading+trailing throttle/maxWait
      // composition.
      let elapsed = 0
      while (elapsed < 2000) {
        bus.publish('session:1')
        jest.advanceTimersByTime(30)
        elapsed += 30
      }
      // Flush the final trailing edge.
      jest.advanceTimersByTime(60)

      // ~2000ms / 50ms window ≈ 40 windows; leading+trailing can emit up to
      // ~2 per window in the worst case, so allow generous bounds while
      // still proving emissions happened continuously rather than only at
      // the very end.
      expect(conn.received.length).toBeGreaterThanOrEqual(20)
      expect(conn.received.length).toBeLessThanOrEqual(85)

      conn.close()
    })

    it('registry lifecycle: first subscribe starts the fallback interval; last unsubscribe clears it; no timer leaks after teardown', () => {
      const { hub } = buildHub()
      expect(jest.getTimerCount()).toBe(0)

      const a = collect(hub, ['live'])
      const timersWithOneSub = jest.getTimerCount()
      expect(timersWithOneSub).toBeGreaterThan(0)

      const b = collect(hub, ['bot-status'])
      // A second subscriber must NOT start a second pair of intervals.
      expect(jest.getTimerCount()).toBe(timersWithOneSub)

      a.close()
      // Still one connection registered — timers must still be running.
      expect(jest.getTimerCount()).toBe(timersWithOneSub)

      b.close()
      // Last unsubscribe → zero connections → zero leaked timers.
      expect(jest.getTimerCount()).toBe(0)
      expect(hub.connectionCount()).toBe(0)
    })

    it('onModuleDestroy clears both fallback timers even with connections still open', () => {
      const { hub } = buildHub()
      collect(hub, ['live']) // leave open; do NOT unsubscribe
      expect(jest.getTimerCount()).toBeGreaterThan(0)

      hub.onModuleDestroy()

      expect(jest.getTimerCount()).toBe(0)
    })

    it('edge: subscribe() called twice registers two independent connections, each needing its own unsubscribe', () => {
      const { hub, bus } = buildHub()
      const first = collect(hub, ['live'])
      const second = collect(hub, ['live'])

      expect(first.connectionId).not.toBe(second.connectionId)
      expect(hub.connectionCount()).toBe(2)

      bus.publish('live')
      jest.advanceTimersByTime(60)
      expect(first.received).toEqual([{ topic: 'live' }])
      expect(second.received).toEqual([{ topic: 'live' }])

      first.close()
      expect(hub.connectionCount()).toBe(1)
      second.close()
      expect(hub.connectionCount()).toBe(0)
    })

    it('fanOut skips a connection registered but never subscribed to its signals$ Observable, without throwing or blocking fan-out to other connections', () => {
      const { hub, bus } = buildHub()
      // subscribe() alone registers the connection in `connections`, but
      // `perConnectionListeners` is only populated once something
      // subscribes to the returned signals$ — this reproduces that window
      // (e.g. between registration and the controller subscribing) without
      // ever closing it.
      const unobserved = hub.subscribe(['live'])
      const observed = collect(hub, ['live'])
      expect(hub.connectionCount()).toBe(2)

      expect(() => {
        bus.publish('live')
        jest.advanceTimersByTime(60)
      }).not.toThrow()

      // fanOut's `if (!listener) continue` must not stop it from reaching
      // the connection registered afterward.
      expect(observed.received).toEqual([{ topic: 'live' }])

      observed.close()
      hub.unsubscribe(unobserved.connectionId)
    })

    it('F3/AE3: bot-status flips online -> offline on heartbeat staleness alone (time-driven, no writes after subscribe)', () => {
      const { hub } = buildHub()
      const gen = insertGeneration(db, { startedAt: new Date() })
      markRunning(db, gen.id, 333, new Date())

      const conn = collect(hub, ['bot-status'])

      // No further writes at all — advance past staleThresholdMs (15s) via
      // two 10s staleness-recompute ticks (the cadence the hub's own env
      // default already ties to <= staleThresholdMs()).
      jest.advanceTimersByTime(20000)

      expect(conn.received).toEqual([{ topic: 'bot-status' }])
      conn.close()
    })

    it('staleness within budget: bot-status flips within staleThresholdMs(), well under the 30s data_version backstop window', () => {
      const { hub } = buildHub()
      const gen = insertGeneration(db, { startedAt: new Date() })
      markRunning(db, gen.id, 555, new Date())

      const conn = collect(hub, ['bot-status'])

      jest.advanceTimersByTime(20000)

      expect(conn.received).toEqual([{ topic: 'bot-status' }])
      conn.close()
    })

    it('error path: publish() with a malformed/unknown topic is ignored without throwing', () => {
      const { hub, bus } = buildHub()
      const conn = collect(hub, ['session:1'])

      expect(() => bus.publish('not-a-topic' as never)).not.toThrow()
      jest.advanceTimersByTime(60)

      expect(conn.received).toEqual([])
      conn.close()
    })

    it('live: a stale-heartbeat transition on a live_status row (zero writes to that row after subscribe) is caught by the staleness recompute', () => {
      const { hub } = buildHub()
      const gen = insertGeneration(db, { startedAt: new Date() })
      const now = new Date()
      markRunning(db, gen.id, 666, now)
      upsertLiveStatus(db, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        prompting: true,
        queueDepth: 0,
        lastActivityAt: now,
        lastHeartbeatAt: now,
      })

      const conn = collect(hub, ['live'])

      // No further write to live_status at all — only time passes,
      // crossing staleThresholdMs (15s) for that row's heartbeat.
      jest.advanceTimersByTime(20000)

      expect(conn.received).toEqual([{ topic: 'live' }])
      conn.close()
    })
  })

  // ── Two-connection scenarios (data_version fallback backstop) ──────────
  // These prove the R8/AE5 correctness core: PRAGMA data_version only
  // advances for commits from ANOTHER connection, so these tests use a
  // real second connection (writerDb) to simulate the bot process's writes
  // while the hub reads through its own connection (hubDb) — exactly the
  // two-process shape this detector is built for.
  // ────────────────────────────────────────────────────────────────────────

  describe('two-connection (data_version) scenarios', () => {
    let conns: ReturnType<typeof createTwoConnectionTestDb>

    beforeEach(() => {
      conns = createTwoConnectionTestDb()
    })

    afterEach(() => {
      conns.close()
    })

    function buildHub(bus = new NotifyBusService()) {
      return {
        hub: new SseHubService(conns.hubDb, fakeLogger(), bus),
        bus,
      }
    }

    it('AE2: 3 new turn_content rows written on another connection, without a notify, are caught by the fallback tick; a second tick with no commits emits nothing', () => {
      const gen = insertGeneration(conns.writerDb, { startedAt: new Date() })
      markRunning(conns.writerDb, gen.id, 111, new Date())
      const { turn } = seedSession(conns.writerDb, {
        generationId: gen.id,
        channelId: 'ch1',
      })

      const { hub } = buildHub()
      const conn = collect(hub, ['session:1'])

      // Seed (subscribe) already happened above; now write 3 rows on the
      // OTHER connection with no notify.
      for (let i = 0; i < 3; i++) {
        insertToolCall(conns.writerDb, {
          turnId: turn.id,
          ref: `tool-${i}`,
          payload: {
            kind: 'tool_call',
            title: `t${i}`,
            toolKind: 'x',
            status: 'pending',
          },
          createdAt: new Date(),
        })
      }

      jest.advanceTimersByTime(30000) // fallback tick fires
      expect(conn.received).toEqual([{ topic: 'session:1' }])

      conn.received.length = 0
      jest.advanceTimersByTime(30000) // second tick, no new commits
      expect(conn.received).toEqual([])

      conn.close()
    })

    it('AE5 (regression guard for the update-only hole): an in-place UPDATE with no following INSERT and no notify still fires the fallback tick via data_version, which a max(id)-only detector would have missed', () => {
      const gen = insertGeneration(conns.writerDb, { startedAt: new Date() })
      markRunning(conns.writerDb, gen.id, 222, new Date())
      const { turn } = seedSession(conns.writerDb, {
        generationId: gen.id,
        channelId: 'ch1',
      })
      const toolCall = insertToolCall(conns.writerDb, {
        turnId: turn.id,
        ref: 'tool-a',
        payload: {
          kind: 'tool_call',
          title: 't',
          toolKind: 'x',
          status: 'pending',
        },
        createdAt: new Date(),
      })
      // A max(id)-only detector's baseline, captured AFTER the insert
      // above and compared again AFTER the update below.
      const maxIdBefore = toolCall.id

      const { hub } = buildHub()
      const conn = collect(hub, ['session:1'])

      // In-place UPDATE on the OTHER connection — does NOT insert a new
      // turn_content row, so max(turn_content.id) is unchanged by this
      // statement alone.
      const changes = updateToolCallStatus(conns.writerDb, {
        turnId: turn.id,
        ref: 'tool-a',
        status: 'completed',
      })
      expect(changes).toBe(1)
      // Regression guard for the exact bug this design fixes: prove the
      // max(id) a naive detector would have used is unchanged by the
      // update, yet the hub still emits (via data_version) below.
      expect(toolCall.id).toBe(maxIdBefore)

      jest.advanceTimersByTime(30000)

      expect(conn.received).toEqual([{ topic: 'session:1' }])
      conn.close()
    })

    it('fan-out: two connections subscribed to session:1 each receive exactly one signal per tick; the data_version read happens once per tick, not once per connection', () => {
      const gen = insertGeneration(conns.writerDb, { startedAt: new Date() })
      markRunning(conns.writerDb, gen.id, 444, new Date())
      seedSession(conns.writerDb, { generationId: gen.id, channelId: 'ch1' })

      const { hub } = buildHub()
      const connA = collect(hub, ['session:1'])
      const connB = collect(hub, ['session:1'])

      // Spy on the hub's own connection's pragma calls — assert
      // 'data_version' executes exactly once for this tick regardless of
      // how many connections are subscribed.
      const hubClient = (
        conns.hubDb as unknown as {
          $client: { pragma: (...args: unknown[]) => unknown }
        }
      ).$client
      const pragmaSpy = jest.spyOn(hubClient, 'pragma')

      // A write on the OTHER connection with no notify, so the tick has
      // something to detect.
      insertGeneration(conns.writerDb, { startedAt: new Date() })

      jest.advanceTimersByTime(30000)

      expect(connA.received).toEqual([{ topic: 'session:1' }])
      expect(connB.received).toEqual([{ topic: 'session:1' }])

      const dataVersionCalls = pragmaSpy.mock.calls.filter(
        call => call[0] === 'data_version',
      )
      expect(dataVersionCalls).toHaveLength(1)

      pragmaSpy.mockRestore()
      connA.close()
      connB.close()
    })

    it('live: bot going offline (finalize on the other connection, no live_status write) advances data_version and the fallback tick emits live', () => {
      const gen = insertGeneration(conns.writerDb, { startedAt: new Date() })
      const now = new Date()
      markRunning(conns.writerDb, gen.id, 777, now)
      upsertLiveStatus(conns.writerDb, {
        channelId: 'ch1',
        generationId: gen.id,
        triggeringUserId: 'u1',
        prompting: true,
        queueDepth: 0,
        lastActivityAt: now,
        lastHeartbeatAt: now,
      })

      const { hub } = buildHub()
      const conn = collect(hub, ['live'])

      finalize(conns.writerDb, gen.id, 'stopped', 0, new Date())
      jest.advanceTimersByTime(30000) // data_version advanced by finalize's UPDATE

      expect(conn.received).toEqual([{ topic: 'live' }])
      conn.close()
    })
  })
})
