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
    const id = ++this.idCounter as unknown as NodeJS.Timeout
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

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  kill(signal?: string): boolean {
    this.killed = true
    // Simulate synchronous exit for testing.
    setImmediate(() => {
      this.exitCode = signal === 'SIGKILL' ? null : 0
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

async function buildService(
  db: Db,
  clock: FakeClock,
  spawnFn: () => ChildProcess,
  supervise = true,
) {
  process.env.SUPERVISE_BOT = supervise ? 'true' : 'false'
  const module = await Test.createTestingModule({
    providers: [
      SupervisorService,
      { provide: DB, useValue: db },
      { provide: PinoLogger, useValue: makeLogger() },
      { provide: SUPERVISOR_CLOCK, useValue: clock },
      { provide: SUPERVISOR_SPAWN, useValue: { spawnBot: spawnFn } },
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

  it('onModuleInit with no prior rows → inserts generation and spawns', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(100 + children.length)
      children.push(c)
      return c as unknown as ChildProcess
    })

    await svc.onModuleInit()

    const gen = await waitForCondition(() => {
      const rows = liveGenerations(db)
      return rows.length === 1 ? rows[0] : null
    })
    expect(gen).toBeTruthy()
    expect(gen!.status).toBe('starting')
    expect(children).toHaveLength(1)
    expect(svc.getPhase()).toBe('Starting')
  })

  it('liveness poll detects heartbeat → dispatches Ready → Running', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(200)
      children.push(c)
      return c as unknown as ChildProcess
    })

    await svc.onModuleInit()
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

    await svc.onModuleInit()
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

    await svc.onModuleInit()
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
    const svc = await buildService(db, clock, () => {
      return {
        pid: 500,
        on: jest.fn(),
        once: jest.fn(),
        kill: jest.fn(),
        exitCode: null,
      } as unknown as ChildProcess
    })

    // Intercept spawn to capture env.
    const origSpawn = (
      svc as unknown as {
        spawnFactory: { spawnBot: (e: NodeJS.ProcessEnv) => ChildProcess }
      }
    ).spawnFactory.spawnBot
    ;(
      svc as unknown as {
        spawnFactory: { spawnBot: (e: NodeJS.ProcessEnv) => ChildProcess }
      }
    ).spawnFactory.spawnBot = e => {
      capturedEnv.push(e)
      return origSpawn(e)
    }

    await svc.onModuleInit()
    await flushPromises()

    expect(capturedEnv.length).toBeGreaterThan(0)
    expect(capturedEnv[0]!.MAIN_SERVER_SECRET).toBeUndefined()
    delete process.env.MAIN_SERVER_SECRET
  })

  it('onModuleDestroy sends SIGTERM to child and finalizes generation', async () => {
    const children: FakeChild[] = []
    const svc = await buildService(db, clock, () => {
      const c = new FakeChild(600)
      children.push(c)
      return c as unknown as ChildProcess
    })

    await svc.onModuleInit()
    await flushPromises()
    const gen = liveGenerations(db)[0]!

    svc.onModuleDestroy()
    await flushPromises()

    expect(children[0]!.killed).toBe(true)
    const row = generationById(db, gen.id)!
    expect(row.endedAt).not.toBeNull()
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

    await svc.onModuleInit()
    expect(spawned).toHaveLength(0)
    expect(svc.getPhase()).toBe('Stopped')
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

    await svc.onModuleInit()
    await flushPromises()

    const row = generationById(db, gen.id)!
    expect(row.status).toBe('crashed')
    expect(row.endedAt).not.toBeNull()
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
