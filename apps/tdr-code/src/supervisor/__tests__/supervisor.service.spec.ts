import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import {
  generationById,
  insertGeneration,
  liveGenerations,
  markRunning,
} from 'src/db/bot-generation.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { createTestDb } from 'src/db/test-db'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import {
  SUPERVISOR_CLOCK,
  SUPERVISOR_SPAWN,
  SupervisorService,
} from 'src/supervisor/supervisor.service'

// ── Fake clock ──────────────────────────────────────────────────────────────

class FakeClock {
  private timers: Map<NodeJS.Timeout, { fn: () => void; fireAt: number }> =
    new Map()
  private _now = 0
  private idCounter = 0

  now() {
    return this._now
  }

  setTimeout(fn: () => void, ms: number): NodeJS.Timeout {
    // Use an object brand so any `.ref()`/`.unref()` calls fail loudly.
    const id = { id: ++this.idCounter } as unknown as NodeJS.Timeout
    this.timers.set(id, { fn, fireAt: this._now + ms })
    return id
  }

  clearTimeout(t: NodeJS.Timeout): void {
    this.timers.delete(t)
  }

  advance(ms: number): void {
    const target = this._now + ms
    while (true) {
      const due = [...this.timers.entries()].filter(
        ([, { fireAt }]) => fireAt <= target,
      )
      if (due.length === 0) break
      due.sort((a, b) => a[1].fireAt - b[1].fireAt)
      const [id, { fn, fireAt }] = due[0]!
      this._now = fireAt
      this.timers.delete(id)
      fn()
    }
    this._now = target
  }
}

// ── Fake process (child) ─────────────────────────────────────────────────────

class FakeChild extends EventEmitter {
  pid: number
  exitCode: number | null = null
  killed = false
  connected = true
  send = jest.fn()

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  kill(signal?: string): boolean {
    this.killed = true
    // Simulate synchronous exit for testing.
    setImmediate(() => {
      this.exitCode = signal === 'SIGKILL' ? null : 0
      this.connected = false
      this.emit('exit', this.exitCode)
    })
    return true
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    assign: jest.fn(),
  } as unknown as PinoLogger
}

// A standalone Test.createTestingModule never imports SseModule, so @Global
// does not make NotifyBusService resolvable here — every test must supply
// this fake explicitly (U4/doc-review A4) or SupervisorService's constructor
// injection fails .compile().
function makeFakeNotifyBus() {
  return { publish: jest.fn() }
}

async function buildService(
  db: Db,
  clock: FakeClock,
  spawnFn: (env: NodeJS.ProcessEnv) => ChildProcess,
  supervise = true,
  notifyBus: { publish: jest.Mock } = makeFakeNotifyBus(),
) {
  process.env.SUPERVISE_BOT = supervise ? 'true' : 'false'
  const module = await Test.createTestingModule({
    providers: [
      SupervisorService,
      { provide: DB, useValue: db },
      { provide: PinoLogger, useValue: makeLogger() },
      { provide: SUPERVISOR_CLOCK, useValue: clock },
      { provide: SUPERVISOR_SPAWN, useValue: { spawnBot: spawnFn } },
      { provide: NotifyBusService, useValue: notifyBus },
    ],
  }).compile()
  return module.get(SupervisorService)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('SupervisorService', () => {
  let testDb: ReturnType<typeof createTestDb>
  let db: Db
  let clock: FakeClock

  beforeEach(() => {
    testDb = createTestDb()
    db = testDb.db
    clock = new FakeClock()
    process.env.SUPERVISOR_START_TIMEOUT_MS = '5000'
    process.env.SUPERVISOR_SIGKILL_GRACE_MS = '2000'
    process.env.SUPERVISOR_STABLE_WINDOW_MS = '10000'
    process.env.SUPERVISOR_LIVENESS_POLL_MS = '100'
    process.env.SUPERVISOR_CRASH_LOOP_THRESHOLD = '3'
    process.env.SUPERVISOR_CRASH_LOOP_WINDOW_MS = '60000'
  })

  afterEach(() => {
    testDb.close()
    delete process.env.SUPERVISE_BOT
  })

  it('start() with no prior rows → inserts generation and spawns', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(100 + children.length)
      children.push(c)
      return c as unknown as ChildProcess
    })

    await svc.start()

    const gen = await waitForCondition(() => {
      const rows = liveGenerations(db)
      return rows.length === 1 ? rows[0] : null
    })
    expect(gen).toBeTruthy()
    expect(gen!.status).toBe('starting')
    expect(children).toHaveLength(1)
    expect(svc.getPhase()).toBe('Starting')
  })

  it('does not spawn until start() is called (gated behind app.listen in bootstrap)', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(100 + children.length)
      children.push(c)
      return c as unknown as ChildProcess
    })

    // Constructing the provider must NOT spawn — the bot is only spawned by an
    // explicit start(), which bootstrap.ts calls after app.listen() wins the
    // HTTP port. This is the invariant that stops two overlapping main-server
    // processes from each spawning a bot before the port conflict resolves.
    expect(children).toHaveLength(0)
    expect(liveGenerations(db)).toHaveLength(0)
    expect(svc.getPhase()).toBe('Stopped')

    await svc.start()
    expect(children).toHaveLength(1)
    expect(svc.getPhase()).toBe('Starting')
  })

  it('start() is idempotent — a second call does not spawn a second bot', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(100 + children.length)
      children.push(c)
      return c as unknown as ChildProcess
    })

    await svc.start()
    await svc.start()
    await flushPromises()

    expect(children).toHaveLength(1)
    expect(liveGenerations(db)).toHaveLength(1)
  })

  it('liveness poll detects heartbeat → dispatches Ready → Running', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(200)
      children.push(c)
      return c as unknown as ChildProcess
    })

    await svc.start()
    const gen = liveGenerations(db)[0]!
    // Simulate bot writing markRunning.
    markRunning(db, gen.id, 200, new Date())

    // Advance clock past liveness poll interval.
    clock.advance(200)
    await flushPromises()

    expect(svc.getPhase()).toBe('Running')
  })

  it('unexpected child exit → Backoff phase', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(300 + children.length)
      children.push(c)
      return c as unknown as ChildProcess
    })

    await svc.start()
    await flushPromises()

    // Simulate unexpected exit.
    const child = children[0]!
    child.exitCode = 1
    child.emit('exit', 1)
    await flushPromises()

    expect(svc.getPhase()).toBe('Backoff')
    // Generation should be finalized.
    const gen = liveGenerations(db)
    expect(gen).toHaveLength(0)
  })

  it('start timeout → SIGTERM sent and killed flag set', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(400)
      children.push(c)
      return c as unknown as ChildProcess
    })

    await svc.start()
    await flushPromises()

    // Advance past start timeout — StartTimeout fires, SIGTERM sent.
    clock.advance(6000)
    // Do NOT flushPromises here so the setImmediate exit hasn't fired yet.

    // The child should have been killed.
    expect(children[0]!.killed).toBe(true)
    // After flushing (exit fires), we should be in Backoff or Stopped.
    await flushPromises()
    expect(['Backoff', 'Stopped']).toContain(svc.getPhase())
  })

  it('env allowlist: spawned env does not include parent secrets', async () => {
    process.env.MAIN_SERVER_SECRET = 'DO_NOT_LEAK'
    const capturedEnv: NodeJS.ProcessEnv[] = []

    // Use the spawnFn directly to capture the env — no private-field cast needed.
    const svc = await buildService(db, clock, (env: NodeJS.ProcessEnv) => {
      capturedEnv.push(env)
      return {
        pid: 500,
        on: jest.fn(),
        once: jest.fn(),
        kill: jest.fn(),
        exitCode: null,
      } as unknown as ChildProcess
    })

    await svc.start()
    await flushPromises()

    expect(capturedEnv.length).toBeGreaterThan(0)
    expect(capturedEnv[0]!.MAIN_SERVER_SECRET).toBeUndefined()
    delete process.env.MAIN_SERVER_SECRET
  })

  it('onModuleDestroy sends SIGTERM to child (no direct finalize)', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(600)
      children.push(c)
      return c as unknown as ChildProcess
    })

    await svc.start()
    await flushPromises()
    const gen = liveGenerations(db)[0]!

    svc.onModuleDestroy()
    // SIGTERM is sent but finalize is NOT called directly from onModuleDestroy.
    expect(children[0]!.killed).toBe(true)

    // The generation row is NOT yet finalized (ExitObserved handles that).
    const row = generationById(db, gen.id)!
    expect(row.endedAt).toBeNull()

    // When the child exits, ExitObserved finalizes with the real exit code.
    await flushPromises()
    const rowAfterExit = generationById(db, gen.id)!
    expect(rowAfterExit.endedAt).not.toBeNull()
  })

  it('SUPERVISE_BOT=false: does not spawn', async () => {
    const spawned: number[] = []
    const svc = await buildService(
      db,
      clock,
      () => {
        spawned.push(1)
        return {
          pid: 1,
          once: jest.fn(),
          kill: jest.fn(),
        } as unknown as ChildProcess
      },
      false,
    )

    await svc.start()
    expect(spawned).toHaveLength(0)
    expect(svc.getPhase()).toBe('Stopped')
  })

  describe('requestRestart', () => {
    it('supervise=false → requestRestart → error not-supervised regardless of phase', async () => {
      const svc = await buildService(
        db,
        clock,
        () =>
          ({
            pid: 800,
            once: jest.fn(),
            kill: jest.fn(),
            exitCode: null,
          }) as unknown as ChildProcess,
        false,
      )
      await svc.start()
      expect(svc.getPhase()).toBe('Stopped')
      const result = svc.requestRestart()
      expect(result).toEqual({ error: 'not-supervised' })
    })

    it('Starting → requestRestart → dispatches RestartRequested → phase becomes Stopping', async () => {
      const children: FakeChild[] = []
      const svc = await buildService(db, clock, () => {
        const c = new FakeChild(900 + children.length)
        children.push(c)
        return c as unknown as ChildProcess
      })
      await svc.start()
      expect(svc.getPhase()).toBe('Starting')

      const result = svc.requestRestart()
      expect('phase' in result).toBe(true)
      if ('phase' in result) expect(result.phase).toBe('Stopping')
      expect(svc.getPhase()).toBe('Stopping')
      // Flush the SIGTERM-triggered setImmediate exit before afterEach closes the DB.
      await flushPromises()
    })

    it('Running → requestRestart → dispatches RestartRequested → phase becomes Stopping', async () => {
      const children: FakeChild[] = []
      const svc = await buildService(db, clock, () => {
        const c = new FakeChild(950 + children.length)
        children.push(c)
        return c as unknown as ChildProcess
      })
      await svc.start()
      const gen = liveGenerations(db)[0]!
      markRunning(db, gen.id, 950, new Date())
      clock.advance(200)
      await flushPromises()
      expect(svc.getPhase()).toBe('Running')

      const result = svc.requestRestart()
      expect('phase' in result).toBe(true)
      if ('phase' in result) expect(result.phase).toBe('Stopping')
      expect(svc.getPhase()).toBe('Stopping')
      // Flush the SIGTERM-triggered setImmediate exit before afterEach closes the DB.
      await flushPromises()
    })

    it('Backoff → requestRestart → dispatches RestartRequested → phase becomes Starting', async () => {
      const children: FakeChild[] = []
      const svc = await buildService(db, clock, () => {
        const c = new FakeChild(980 + children.length)
        children.push(c)
        return c as unknown as ChildProcess
      })
      await svc.start()
      await flushPromises()
      // Trigger unexpected exit → Backoff
      children[0]!.exitCode = 1
      children[0]!.emit('exit', 1)
      await flushPromises()
      expect(svc.getPhase()).toBe('Backoff')

      const result = svc.requestRestart()
      expect('phase' in result).toBe(true)
      if ('phase' in result) expect(result.phase).toBe('Starting')
      expect(svc.getPhase()).toBe('Starting')
    })

    it('Stopping → requestRestart → error transition-in-progress', async () => {
      const children: FakeChild[] = []
      const svc = await buildService(db, clock, () => {
        const c = new FakeChild(990 + children.length)
        children.push(c)
        return c as unknown as ChildProcess
      })
      await svc.start()
      const gen = liveGenerations(db)[0]!
      markRunning(db, gen.id, 990, new Date())
      clock.advance(200)
      await flushPromises()
      // Move to Stopping first.
      svc.requestRestart()
      expect(svc.getPhase()).toBe('Stopping')

      // Second requestRestart while already Stopping.
      const result = svc.requestRestart()
      expect(result).toEqual({ error: 'transition-in-progress' })
      // Flush the SIGTERM-triggered setImmediate exit before afterEach closes the DB.
      await flushPromises()
    })
  })

  it('liveness-aware reconciliation: prior running generation with dead pid → finalize crashed', async () => {
    // Insert a "live" generation with a pid that does not exist.
    const gen = insertGeneration(db, { startedAt: new Date() })
    markRunning(db, gen.id, 999_999, new Date())

    const svc = await buildService(db, clock, () => {
      return {
        pid: 700,
        once: jest.fn(),
        kill: jest.fn(),
        exitCode: null,
      } as unknown as ChildProcess
    })

    await svc.start()
    await flushPromises()

    const row = generationById(db, gen.id)!
    expect(row.status).toBe('crashed')
    expect(row.endedAt).not.toBeNull()
  })

  describe('notify bridge (U4)', () => {
    it('happy path: a notify message from the bot child publishes its topic', async () => {
      const children: FakeChild[] = []
      const notifyBus = makeFakeNotifyBus()
      const svc = await buildService(
        db,
        clock,
        () => {
          const c = new FakeChild(1000 + children.length)
          children.push(c)
          return c as unknown as ChildProcess
        },
        true,
        notifyBus,
      )

      await svc.start()
      notifyBus.publish.mockClear() // drop the insertGeneration in-process publish

      children[0]!.emit('message', { type: 'notify', topics: ['live'] })

      expect(notifyBus.publish).toHaveBeenCalledTimes(1)
      expect(notifyBus.publish).toHaveBeenCalledWith('live')
    })

    it('multi-topic message: publish is called once per topic', async () => {
      const children: FakeChild[] = []
      const notifyBus = makeFakeNotifyBus()
      const svc = await buildService(
        db,
        clock,
        () => {
          const c = new FakeChild(1010 + children.length)
          children.push(c)
          return c as unknown as ChildProcess
        },
        true,
        notifyBus,
      )

      await svc.start()
      notifyBus.publish.mockClear()

      children[0]!.emit('message', {
        type: 'notify',
        topics: ['live', 'session:1'],
      })

      expect(notifyBus.publish).toHaveBeenCalledTimes(2)
      expect(notifyBus.publish).toHaveBeenCalledWith('live')
      expect(notifyBus.publish).toHaveBeenCalledWith('session:1')
    })

    it('listener leak guard: the message listener is removed on every exit across N restarts', async () => {
      const children: FakeChild[] = []
      const notifyBus = makeFakeNotifyBus()
      const svc = await buildService(
        db,
        clock,
        () => {
          const c = new FakeChild(1020 + children.length)
          children.push(c)
          return c as unknown as ChildProcess
        },
        true,
        notifyBus,
      )

      await svc.start()
      await flushPromises()
      expect(children[0]!.listenerCount('message')).toBe(1)

      // Simulate an unexpected exit → Backoff → BackoffElapsed → restart, N
      // times. Kept below SUPERVISOR_CRASH_LOOP_THRESHOLD (3, set in
      // beforeEach) so the FSM keeps restarting instead of tripping to
      // Failed after the window's 3rd unexpected exit.
      const restarts = 2
      for (let i = 0; i < restarts; i++) {
        const dying = children[children.length - 1]!
        dying.exitCode = 1
        dying.emit('exit', 1)
        await flushPromises()
        // The listener is removed unconditionally on exit.
        expect(dying.listenerCount('message')).toBe(0)
        // Advance past the backoff delay (exponential from backoffBaseMs=
        // 1000) to trigger the next spawn — deliberately NOT a huge jump:
        // SUPERVISOR_START_TIMEOUT_MS=5000 means overshooting would also
        // fire the new child's own start deadline mid-loop and route it to
        // Stopped instead of leaving it in Starting for the next iteration.
        clock.advance(3_000)
        await flushPromises()
      }

      expect(children).toHaveLength(restarts + 1)
      // Each live child carries exactly one message listener — the count
      // never grows across restarts.
      for (const child of children.slice(0, -1)) {
        expect(child.listenerCount('message')).toBe(0)
      }
      expect(children[children.length - 1]!.listenerCount('message')).toBe(1)
      void svc
    })

    it("late/stale message: a message emitted after the child's listeners were removed does not publish", async () => {
      const children: FakeChild[] = []
      const notifyBus = makeFakeNotifyBus()
      const svc = await buildService(
        db,
        clock,
        () => {
          const c = new FakeChild(1030 + children.length)
          children.push(c)
          return c as unknown as ChildProcess
        },
        true,
        notifyBus,
      )

      await svc.start()
      await flushPromises()
      const child = children[0]!

      child.exitCode = 1
      child.emit('exit', 1)
      await flushPromises()
      notifyBus.publish.mockClear()

      // The listener is gone post-exit, so this is structurally a no-op —
      // asserting it rather than assuming it. (By contrast, a message from a
      // superseded-but-not-yet-exited child — listener still attached — is
      // NOT specially rejected: it is harmless by design under idempotent
      // snapshot-refetch, so no generation-matching is implemented here.)
      child.emit('message', { type: 'notify', topics: ['live'] })

      expect(notifyBus.publish).not.toHaveBeenCalled()
      void svc
    })

    it.each([
      ['empty object', {}],
      ['wrong type', { type: 'wrong' }],
      ['non-array topics', { type: 'notify', topics: 'not-an-array' }],
      ['mixed valid/invalid topics', { type: 'notify', topics: ['live', 123] }],
    ])(
      'malformed message (%s) is dropped without throwing and never publishes',
      async (_label, payload) => {
        const children: FakeChild[] = []
        const notifyBus = makeFakeNotifyBus()
        const logger = makeLogger()
        process.env.SUPERVISE_BOT = 'true'
        const module = await Test.createTestingModule({
          providers: [
            SupervisorService,
            { provide: DB, useValue: db },
            { provide: PinoLogger, useValue: logger },
            { provide: SUPERVISOR_CLOCK, useValue: clock },
            {
              provide: SUPERVISOR_SPAWN,
              useValue: {
                spawnBot: () => {
                  const c = new FakeChild(1040 + children.length)
                  children.push(c)
                  return c as unknown as ChildProcess
                },
              },
            },
            { provide: NotifyBusService, useValue: notifyBus },
          ],
        }).compile()
        const svc = module.get(SupervisorService)

        await svc.start()
        notifyBus.publish.mockClear()

        expect(() => {
          children[0]!.emit('message', payload)
        }).not.toThrow()

        expect(notifyBus.publish).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ event: 'notify-received-malformed' }),
          expect.any(String),
        )
      },
    )

    it('in-process publish: insertGeneration publishes bot-status synchronously on start()', async () => {
      const children: FakeChild[] = []
      const notifyBus = makeFakeNotifyBus()
      const svc = await buildService(
        db,
        clock,
        () => {
          const c = new FakeChild(1050 + children.length)
          children.push(c)
          return c as unknown as ChildProcess
        },
        true,
        notifyBus,
      )

      await svc.start()

      expect(notifyBus.publish).toHaveBeenCalledWith('bot-status')
    })

    it('in-process publish: markStopping and finalize publish bot-status', async () => {
      const children: FakeChild[] = []
      const notifyBus = makeFakeNotifyBus()
      const svc = await buildService(
        db,
        clock,
        () => {
          const c = new FakeChild(1060 + children.length)
          children.push(c)
          return c as unknown as ChildProcess
        },
        true,
        notifyBus,
      )

      await svc.start()
      const gen = liveGenerations(db)[0]!
      markRunning(db, gen.id, 1060, new Date())
      clock.advance(200)
      await flushPromises()
      expect(svc.getPhase()).toBe('Running')

      notifyBus.publish.mockClear()
      svc.requestRestart()
      expect(svc.getPhase()).toBe('Stopping')
      // markStopping effect publishes synchronously as part of the dispatch.
      expect(notifyBus.publish).toHaveBeenCalledWith('bot-status')

      notifyBus.publish.mockClear()
      // Flush the SIGTERM-triggered setImmediate exit → ExitObserved → finalize.
      await flushPromises()
      expect(notifyBus.publish).toHaveBeenCalledWith('bot-status')
    })

    it('R14: defaultSpawn requests an ipc stdio slot', async () => {
      // Re-import lazily to avoid polluting the top-of-file imports with a
      // module under test that every other test in this file fakes out via
      // SUPERVISOR_SPAWN.
      const { defaultSpawn } = await import('src/supervisor/supervisor.service')
      const childProcess = await import('node:child_process')
      const spawnSpy = jest
        .spyOn(childProcess, 'spawn')
        .mockReturnValue({ pid: 1 } as unknown as ChildProcess)

      try {
        defaultSpawn().spawnBot({} as NodeJS.ProcessEnv)
        expect(spawnSpy).toHaveBeenCalledTimes(1)
        const [, , options] = spawnSpy.mock.calls[0]!
        expect((options as { stdio?: unknown[] }).stdio).toContain('ipc')
      } finally {
        spawnSpy.mockRestore()
      }
    })
  })
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function flushPromises(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

async function waitForCondition<T>(
  fn: () => T | null,
  timeout = 100,
): Promise<T | null> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = fn()
    if (result != null) return result
    await new Promise(r => setTimeout(r, 5))
  }
  return null
}
