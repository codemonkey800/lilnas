import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'

import { ClientSideConnection } from '@agentclientprotocol/sdk'
import { Test } from '@nestjs/testing'

import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import type { AcpEventHandlers } from 'src/agent/agent.types'
import { globalGitWriteLock } from 'src/agent/git-write-lock'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { DB } from 'src/db/database.module'
import * as sessionsRepo from 'src/db/sessions.repo'
import { EnvKeys } from 'src/env'

// Mock git-turn-context so executePrompt tests don't hit real crypto/master-key.
jest.mock('src/agent/git-turn-context', () => {
  const MockGitTurnContext = jest.fn().mockImplementation(() => ({
    begin: jest.fn().mockResolvedValue(undefined),
    end: jest.fn(),
    abort: jest.fn(),
  }))
  Object.assign(MockGitTurnContext, { sweep: jest.fn() })
  return { GitTurnContext: MockGitTurnContext }
})

jest.mock('src/agent/git-write-lock', () => ({
  globalGitWriteLock: {
    acquire: jest.fn().mockResolvedValue(jest.fn()),
    releaseIfHeldBy: jest.fn(),
    cancelWaiter: jest.fn(),
    currentHolder: null,
  },
}))

function createMockHandlers(): jest.Mocked<AcpEventHandlers> {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
    onSessionInfoUpdate: jest.fn(),
  }
}

const MOCK_CONFIG_ROW = {
  id: 1,
  cwd: '/tmp',
  claudeCommand: 'claude',
  claudeArgs: ['--dangerously-skip-permissions'],
  idleTimeoutSec: 300,
  maxConcurrentSessions: 5,
  updatedAt: new Date(),
}

function makeDbMock(runChanges = 0) {
  const chain: Record<string, jest.Mock> = {
    values: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    from: jest.fn(),
    // Return a config row by default — getConfig() in the constructor reads this.
    get: jest.fn().mockReturnValue(MOCK_CONFIG_ROW),
    all: jest.fn().mockReturnValue([]),
    run: jest.fn().mockReturnValue({ changes: runChanges }),
  }
  for (const k of [
    'values',
    'set',
    'where',
    'returning',
    'orderBy',
    'limit',
    'onConflictDoUpdate',
    'from',
  ]) {
    chain[k]!.mockReturnValue(chain)
  }
  return {
    insert: jest.fn().mockReturnValue(chain),
    update: jest.fn().mockReturnValue(chain),
    select: jest.fn().mockReturnValue(chain),
    delete: jest.fn().mockReturnValue(chain),
    transaction: jest.fn().mockImplementation((cb: () => unknown) => cb()),
  }
}

type ServiceSessions = Map<
  string,
  { prompting: boolean; idleTimer: NodeJS.Timeout; process: unknown }
>

function sessions(service: SessionManagerService): ServiceSessions {
  return (
    service as unknown as {
      sessions: ServiceSessions
    }
  ).sessions
}

// U8: private-state accessor for the pending create/reactivate guard, in the
// same cast-through-unknown style as sessions() above.
type ServicePendingSessions = Map<
  string,
  { promise: Promise<unknown>; cancelled: boolean }
>

function pendingSessions(
  service: SessionManagerService,
): ServicePendingSessions {
  return (
    service as unknown as {
      pendingSessions: ServicePendingSessions
    }
  ).pendingSessions
}

function injectPromptingSession(
  service: SessionManagerService,
  channelId: string,
) {
  const mockProc = { pid: 1234, kill: jest.fn(), on: jest.fn() }
  const session = {
    channelId,
    process: mockProc,
    connection: {
      prompt: jest.fn(),
      cancel: jest.fn(),
      initialize: jest.fn(),
      newSession: jest.fn(),
    },
    sessionId: 'session-x',
    sessionRowId: null,
    lastActivity: Date.now(),
    idleTimer: setTimeout(() => {}, 99999),
    prompting: true,
    imageCapable: false,
    currentTurnId: 1,
    queue: [],
    activeUserId: 'user-1',
  }
  sessions(service).set(channelId, session)
  return session
}

function injectSessionWithRowId(
  service: SessionManagerService,
  channelId: string,
  sessionRowId: number,
) {
  const mockProc = { pid: 1234, kill: jest.fn(), on: jest.fn() }
  const session = {
    channelId,
    process: mockProc,
    connection: {
      prompt: jest.fn(),
      cancel: jest.fn(),
      initialize: jest.fn(),
      newSession: jest.fn(),
    },
    sessionId: 'session-x',
    sessionRowId,
    lastActivity: Date.now(),
    idleTimer: setTimeout(() => {}, 99999),
    prompting: false,
    imageCapable: false,
    currentTurnId: 1,
    queue: [],
    activeUserId: 'user-1',
  }
  sessions(service).set(channelId, session)
  return session
}

type CtorWith2 = {
  new (h: AcpEventHandlers, db: unknown): SessionManagerService
}

describe('SessionManagerService — teardown abort signal (U1, R4)', () => {
  it('fires onPromptComplete("aborted") when tearing down a prompting session', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )

    injectPromptingSession(service, 'ch1')
    service.teardown('ch1')

    expect(handlers.onPromptComplete).toHaveBeenCalledWith('ch1', 'aborted')
    expect(sessions(service).has('ch1')).toBe(false)
  })

  it('does NOT fire onPromptComplete when tearing down a non-prompting session', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )

    const session = injectPromptingSession(service, 'ch1')
    session.prompting = false

    service.teardown('ch1')

    expect(handlers.onPromptComplete).not.toHaveBeenCalled()
  })

  it('fires the abort signal exactly once (executePrompt error path sets prompting=false before teardown)', async () => {
    const handlers = createMockHandlers()

    const module = await Test.createTestingModule({
      providers: [
        SessionManagerService,
        { provide: ACP_EVENT_HANDLERS, useValue: handlers },
        { provide: DB, useValue: makeDbMock() },
      ],
    }).compile()
    const service = module.get(SessionManagerService)

    const session = injectPromptingSession(service, 'ch1')
    session.prompting = true

    const mockConn = session.connection as { prompt: jest.Mock }
    mockConn.prompt.mockRejectedValueOnce(new Error('crash'))

    const internals = service as unknown as {
      executePrompt: (
        s: typeof session,
        text: string,
        userId: string,
      ) => Promise<string>
    }

    await expect(
      internals.executePrompt(session, 'hello', 'user-1'),
    ).rejects.toThrow('crash')

    // 'error' from the catch block — NOT 'aborted' from teardown
    expect(handlers.onPromptComplete).toHaveBeenCalledTimes(1)
    expect(handlers.onPromptComplete).toHaveBeenCalledWith('ch1', 'error')
  })
})

describe('SessionManagerService — session-lifecycle DB writes (U2, U5)', () => {
  beforeEach(() => {
    process.env[EnvKeys.BOT_GENERATION_ID] = '1'
  })
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
  })

  it('teardown("evicted") closes sessions row, emits event, and removes live_status', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    injectSessionWithRowId(service, 'ch1', 42)

    service.teardown('ch1', 'evicted')

    expect(db.update).toHaveBeenCalled() // closeSession
    expect(db.insert).toHaveBeenCalled() // insertEvent(session_evicted)
    expect(db.delete).toHaveBeenCalled() // removeLiveStatus
    expect(sessions(service).has('ch1')).toBe(false)
  })

  it('teardown DB writes are best-effort — a throw does not propagate', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    db.update.mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    injectSessionWithRowId(service, 'ch1', 42)

    expect(() => service.teardown('ch1', 'evicted')).not.toThrow()
    expect(sessions(service).has('ch1')).toBe(false)
  })

  it('teardown skips DB writes when sessionRowId is null', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    // sessionRowId null → U2 block skipped, U5 (removeLiveStatus) still runs
    injectPromptingSession(service, 'ch1')
    sessions(service).get('ch1')!.prompting = false

    service.teardown('ch1', 'evicted')

    expect(db.update).not.toHaveBeenCalled() // closeSession skipped
    expect(db.insert).not.toHaveBeenCalled() // insertEvent skipped
    expect(db.delete).toHaveBeenCalled() // removeLiveStatus still fires
  })
})

describe('SessionManagerService — live_status heartbeat lifecycle (U5)', () => {
  beforeEach(() => {
    process.env[EnvKeys.BOT_GENERATION_ID] = '1'
    process.env[EnvKeys.BOT_HEARTBEAT_MS] = '100'
    jest.useFakeTimers()
  })
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
    delete process.env[EnvKeys.BOT_HEARTBEAT_MS]
    jest.useRealTimers()
  })

  type ServiceInternals = {
    ensureLiveStatusHeartbeat(): void
    stopLiveStatusHeartbeat(): void
    liveStatusTimer: NodeJS.Timeout | null
    shutdownRequested: boolean
  }

  it('ensureLiveStatusHeartbeat arms a timer that re-arms while rows change', () => {
    const handlers = createMockHandlers()
    // runChanges=1 → heartbeat finds active rows and re-arms
    const db = makeDbMock(1)
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const internals = service as unknown as ServiceInternals

    internals.ensureLiveStatusHeartbeat()
    expect(internals.liveStatusTimer).not.toBeNull()

    // Advance past one interval — beat fires, re-arms.
    jest.advanceTimersByTime(150)
    expect(db.update).toHaveBeenCalled() // heartbeatLiveStatus
    expect(internals.liveStatusTimer).not.toBeNull() // re-armed
  })

  it('heartbeat stops (liveStatusTimer=null) when no active rows', () => {
    const handlers = createMockHandlers()
    // runChanges=0 → heartbeat finds no rows, clears timer
    const db = makeDbMock(0)
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const internals = service as unknown as ServiceInternals

    internals.ensureLiveStatusHeartbeat()
    jest.advanceTimersByTime(150)
    expect(internals.liveStatusTimer).toBeNull()
  })

  it('stopLiveStatusHeartbeat clears a pending timer and sets shutdownRequested', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock(1)
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const internals = service as unknown as ServiceInternals

    internals.ensureLiveStatusHeartbeat()
    expect(internals.liveStatusTimer).not.toBeNull()

    service.stopLiveStatusHeartbeat()
    expect(internals.liveStatusTimer).toBeNull()
    expect(internals.shutdownRequested).toBe(true)

    // Re-arming after shutdown must be a no-op.
    internals.ensureLiveStatusHeartbeat()
    expect(internals.liveStatusTimer).toBeNull()
  })

  it('ensureLiveStatusHeartbeat is idempotent — calling twice creates exactly one timer', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock(1)
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const internals = service as unknown as ServiceInternals

    internals.ensureLiveStatusHeartbeat()
    const firstTimer = internals.liveStatusTimer

    internals.ensureLiveStatusHeartbeat()
    expect(internals.liveStatusTimer).toBe(firstTimer)
  })
})

describe('SessionManagerService — idle timer safety while parked on the git lock (U7)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
    // U8: the global `afterEach` in setup.ts only calls jest.clearAllMocks(),
    // which clears call history but NOT a `.mockImplementation()` installed
    // with jest.mocked(...).mockImplementation(...). Several tests in this
    // block (notably the real-GitWriteLock INTEGRATION test below) rewire
    // globalGitWriteLock.acquire/cancelWaiter to delegate to a test-local
    // lock instance that goes out of scope at the end of the test — without
    // this restore, that dangling delegation leaks into every later test in
    // the file (including U8's), where `.acquire()` then resolves against a
    // lock nobody can ever release, hanging on a 30s Jest timeout.
    const mockedLock = jest.mocked(globalGitWriteLock)
    mockedLock.acquire.mockResolvedValue(jest.fn())
    mockedLock.cancelWaiter.mockReset()
    mockedLock.releaseIfHeldBy.mockReset()
  })

  type ServiceInternals = {
    executePrompt(
      session: unknown,
      text: string,
      userId: string,
    ): Promise<unknown>
    startIdleTimer(channelId: string): NodeJS.Timeout
  }

  // Session B "parks" on globalGitWriteLock.acquire: prompting=true is set and
  // onPromptStart fires, but the acquire promise never settles in this test —
  // simulating channel A holding the lock for a long-running turn.
  function injectIdleSession(
    service: SessionManagerService,
    channelId: string,
  ) {
    const mockProc = { pid: 5678, kill: jest.fn(), on: jest.fn() }
    const session = {
      channelId,
      process: mockProc,
      connection: {
        prompt: jest.fn(),
        cancel: jest.fn(),
        initialize: jest.fn(),
        newSession: jest.fn(),
      },
      sessionId: 'session-b',
      sessionRowId: null,
      lastActivity: Date.now(),
      idleTimer: (service as unknown as ServiceInternals).startIdleTimer(
        channelId,
      ),
      prompting: false,
      imageCapable: false,
      currentTurnId: 0,
      queue: [],
      activeUserId: 'user-b',
    }
    sessions(service).set(channelId, session)
    return session
  }

  it('does not idle-teardown a session parked on acquire() (fixes the pre-existing hazard where prompting=true was ignored by the idle timer)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const session = injectIdleSession(service, 'ch-b')

    // Channel A holds the lock — B's acquire() never resolves in this test,
    // simulating B parked behind A's long-running turn.
    let acquireSettled = false
    const mockedLock = jest.mocked(globalGitWriteLock)
    mockedLock.acquire.mockImplementation(
      () => new Promise<() => void>(() => {}),
    )

    const internals = service as unknown as ServiceInternals
    const executePromise = internals
      .executePrompt(session, 'hello from B', 'user-b')
      .then(() => {
        acquireSettled = true
      })
      .catch(() => {
        acquireSettled = true
      })
    void executePromise

    // Let the synchronous prologue + microtask queue for acquire() run.
    await Promise.resolve()
    await Promise.resolve()

    // B is now "parked": prompting is true and its idle timer has been
    // cleared by executePrompt's prologue (U7 primary fix) — NOT the stale
    // timer that was armed when the session was injected.
    expect(sessions(service).get('ch-b')?.prompting).toBe(true)
    expect(mockedLock.acquire).toHaveBeenCalledWith('ch-b')

    // Fire what would have been B's idle timeout while still parked.
    jest.advanceTimersByTime(10 * 60 * 1000)

    // Fixed: the idle timer never fires against a prompting/parked session —
    // B is still alive, still parked, no ghost teardown.
    expect(sessions(service).has('ch-b')).toBe(true)
    expect(handlers.onPromptComplete).not.toHaveBeenCalledWith(
      'ch-b',
      'aborted',
    )
    expect(acquireSettled).toBe(false) // still genuinely parked, not resolved

    // Cleanup: let channel A "release" so B's acquire resolves and the turn
    // can drain, keeping fake timers/pending promises from leaking cross-test.
    mockedLock.acquire.mockResolvedValue(jest.fn())
  })

  it('re-arms the idle timer once a parked turn drains after the lock is granted', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const session = injectIdleSession(service, 'ch-b')

    let releaseAcquire: (release: () => void) => void
    const mockedLock = jest.mocked(globalGitWriteLock)
    mockedLock.acquire.mockImplementation(
      () =>
        new Promise<() => void>(resolve => {
          releaseAcquire = resolve
        }),
    )

    const mockConn = session.connection as { prompt: jest.Mock }
    mockConn.prompt.mockResolvedValue({ stopReason: 'end_turn' })

    const internals = service as unknown as ServiceInternals
    const executePromise = internals.executePrompt(
      session,
      'hello from B',
      'user-b',
    )

    await Promise.resolve()
    await Promise.resolve()
    expect(sessions(service).get('ch-b')?.prompting).toBe(true)

    // Channel A releases — B's acquire() resolves and the turn proceeds
    // to connection.prompt and completes.
    releaseAcquire!(jest.fn())
    await executePromise

    const drained = sessions(service).get('ch-b')
    expect(drained?.prompting).toBe(false)

    // The idle timer is re-armed post-drain — advancing past the idle
    // timeout now correctly tears the session down (normal idle eviction
    // still works after a previously-parked turn completes).
    jest.advanceTimersByTime(10 * 60 * 1000)
    expect(sessions(service).has('ch-b')).toBe(false)
  })

  it('uncontended turn still acquires/releases and re-arms the idle timer exactly as before (no regression)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const session = injectIdleSession(service, 'ch-solo')

    // Uncontended: acquire() resolves immediately (default mock behavior).
    const mockedLock = jest.mocked(globalGitWriteLock)
    mockedLock.acquire.mockResolvedValue(jest.fn())

    const mockConn = session.connection as { prompt: jest.Mock }
    mockConn.prompt.mockResolvedValue({ stopReason: 'end_turn' })

    const internals = service as unknown as ServiceInternals
    const outcome = await internals.executePrompt(session, 'hello', 'user-solo')

    expect(outcome).toEqual({ kind: 'completed', stopReason: 'end_turn' })
    expect(mockedLock.acquire).toHaveBeenCalledWith('ch-solo')
    const drained = sessions(service).get('ch-solo')
    expect(drained?.prompting).toBe(false)

    // Idle timer is armed post-drain — normal idle eviction still works.
    jest.advanceTimersByTime(10 * 60 * 1000)
    expect(sessions(service).has('ch-solo')).toBe(false)
  })

  it('teardown calls cancelWaiter as defense-in-depth for a session that might be parked on acquire', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    injectIdleSession(service, 'ch-parked')
    // Simulate "parked": prompting=true, as executePrompt's prologue would
    // have set before awaiting acquire().
    sessions(service).get('ch-parked')!.prompting = true

    service.teardown('ch-parked', 'evicted')

    const mockedLock = jest.mocked(globalGitWriteLock)
    expect(mockedLock.cancelWaiter).toHaveBeenCalledWith('ch-parked')
    expect(sessions(service).has('ch-parked')).toBe(false)
  })

  it('INTEGRATION (core race): channel A holds the lock, channel B parks, B idle-times-out and is cleanly removed from the queue — the lock never transiently passes to dead B', async () => {
    // This test exercises the REAL GitWriteLock (not the module-level mock)
    // wired directly into two SessionManagerService instances' teardown/
    // executePrompt calls, to prove the end-to-end guarantee: a session torn
    // down while parked on acquire() must not receive a ghost grant.
    const { GitWriteLock: RealGitWriteLock } = jest.requireActual<
      typeof import('src/agent/git-write-lock')
    >('src/agent/git-write-lock')
    const realLock: InstanceType<typeof RealGitWriteLock> =
      new RealGitWriteLock()

    const handlersA = createMockHandlers()
    const handlersB = createMockHandlers()
    const dbA = makeDbMock()
    const dbB = makeDbMock()
    const serviceA = new (SessionManagerService as unknown as CtorWith2)(
      handlersA,
      dbA,
    )
    const serviceB = new (SessionManagerService as unknown as CtorWith2)(
      handlersB,
      dbB,
    )

    const sessionA = injectIdleSession(serviceA, 'ch-a')
    const sessionB = injectIdleSession(serviceB, 'ch-b')

    const mockConnA = sessionA.connection as { prompt: jest.Mock }
    let resolveAPrompt: (v: { stopReason: string }) => void
    mockConnA.prompt.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveAPrompt = resolve
        }),
    )

    const internalsA = serviceA as unknown as ServiceInternals
    const internalsB = serviceB as unknown as ServiceInternals

    // Wire executePrompt's globalGitWriteLock.acquire calls to the REAL lock
    // for this test only, bypassing the module mock's default resolved value.
    const mockedLock = jest.mocked(globalGitWriteLock)
    mockedLock.acquire.mockImplementation((channelId: string) =>
      realLock.acquire(channelId),
    )
    mockedLock.cancelWaiter.mockImplementation((channelId: string) =>
      realLock.cancelWaiter(channelId),
    )

    // git-turn-context is mocked module-wide (begin/end are no-ops that never
    // touch the release fn executePrompt passes through). Rewire serviceA's
    // private gitTurnContext instance so begin() captures the real gitRelease
    // and end() actually invokes it — otherwise the real lock would never see
    // A's release when its turn completes, and this test couldn't observe the
    // end-to-end guarantee. serviceB never reaches begin()/end() in this
    // scenario (it's torn down while still parked on acquire()).
    let capturedARelease: (() => void) | null = null
    ;(
      serviceA as unknown as {
        gitTurnContext: { begin: jest.Mock; end: jest.Mock }
      }
    ).gitTurnContext = {
      begin: jest.fn((_channelId: string, _userId: string, release) => {
        capturedARelease = release as () => void
        return Promise.resolve()
      }),
      end: jest.fn(() => {
        capturedARelease?.()
        capturedARelease = null
      }),
    }

    // A acquires and starts a long-running connection.prompt (lock held).
    const aPromise = internalsA.executePrompt(sessionA, 'a turn', 'user-a')
    await Promise.resolve()
    await Promise.resolve()
    expect(realLock.currentHolder).toBe('ch-a')

    // B starts a turn and parks in the queue behind A.
    const bPromise = internalsB
      .executePrompt(sessionB, 'b turn', 'user-b')
      .catch(() => {
        /* expected: B's session is torn down mid-flight in this scenario */
      })
    await Promise.resolve()
    await Promise.resolve()
    expect(realLock.currentHolder).toBe('ch-a') // still A; B is queued, not granted

    // B idle-times-out while parked — teardown removes it from the queue via
    // cancelWaiter (defense-in-depth; the primary fix would normally prevent
    // the idle timer from firing here at all, but this proves the secondary
    // fix holds even if invoked directly).
    serviceB.teardown('ch-b', 'evicted')
    expect(sessions(serviceB).has('ch-b')).toBe(false)

    // A completes and releases the lock.
    resolveAPrompt!({ stopReason: 'end_turn' })
    await aPromise

    // The lock must now be fully idle — NOT transiently granted to dead B.
    expect(realLock.currentHolder).toBeNull()

    void bPromise
  })
})

describe('SessionManagerService — per-channel create in-flight guard (U8)', () => {
  // Builds a controllable mock child process (real EventEmitter, so proc.on
  // wiring in createSession behaves like production) and wires spawn() /
  // ClientSideConnection to it. `initialize`/`newSession` resolution is
  // controlled by the caller via the returned deferred-style resolvers, so
  // tests can create a genuine concurrency window across two getOrCreate
  // attempts before either one settles.
  function mockSpawnAndConnection() {
    const mockProc = new EventEmitter() as EventEmitter & {
      pid: number
      stdin: unknown
      stdout: EventEmitter
      kill: jest.Mock
    }
    mockProc.pid = Math.floor(Math.random() * 100000)
    mockProc.stdin = new Writable({ write: (_c, _e, cb) => cb() })
    mockProc.stdout = new Readable({ read: () => {} })
    mockProc.kill = jest.fn()
    jest.mocked(spawn).mockReturnValueOnce(mockProc as never)

    let resolveInitialize!: (v: {
      agentCapabilities: Record<string, unknown>
    }) => void
    let rejectInitialize!: (err: unknown) => void
    const initialize = jest.fn(
      () =>
        new Promise((resolve, reject) => {
          resolveInitialize = resolve
          rejectInitialize = reject
        }),
    )
    const newSession = jest.fn().mockResolvedValue({ sessionId: 'session-x' })
    ;(ClientSideConnection as jest.Mock).mockImplementationOnce(() => ({
      initialize,
      newSession,
      prompt: jest.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    }))

    return {
      mockProc,
      initialize,
      newSession,
      resolveInitialize: (
        v: {
          agentCapabilities?: Record<string, unknown>
        } = {},
      ) => resolveInitialize({ agentCapabilities: v.agentCapabilities ?? {} }),
      rejectInitialize: (err: unknown) => rejectInitialize(err),
    }
  }

  let insertSessionSpy: jest.SpyInstance

  beforeEach(() => {
    process.env[EnvKeys.BOT_GENERATION_ID] = '1'
    // jest.clearAllMocks() (global afterEach in setup.ts) clears call/results
    // history but NOT queued mockReturnValueOnce/mockImplementationOnce
    // values — reset explicitly so a test that (correctly) leaves a once-value
    // unconsumed can never leak into the next test's spawn()/ClientSideConnection
    // call.
    jest.mocked(spawn).mockReset()
    jest.mocked(ClientSideConnection).mockReset()
    // Spy on insertSession directly (rather than counting raw db.insert calls,
    // which also fire for recordSpawn/insertEvent/the frequent live_status
    // upserts) so "one session row inserted" is asserted precisely — same
    // spy-on-the-repo-function style as session-manager.service.test.ts's
    // recordSpawn/markExited assertions.
    insertSessionSpy = jest.spyOn(sessionsRepo, 'insertSession')
  })
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
    insertSessionSpy.mockRestore()
  })

  it('two concurrent mentions on a never-seen channel spawn exactly one agent and resolve to the SAME session', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const { resolveInitialize } = mockSpawnAndConnection()

    // Two "mentions" in the same tick, before either has resolved.
    const first = service.prompt('ch-fresh', 'hello', 'user-1')
    const second = service.prompt('ch-fresh', 'hi again', 'user-2')

    // Let the pending guard register and createSession reach the initialize()
    // await (still unresolved) before letting it proceed.
    await Promise.resolve()
    await Promise.resolve()

    // Only one spawn/connection attempt should exist — the second mention
    // joined the first's pending promise instead of starting its own.
    expect(jest.mocked(spawn)).toHaveBeenCalledTimes(1)
    expect(jest.mocked(ClientSideConnection)).toHaveBeenCalledTimes(1)

    resolveInitialize()

    const [firstOutcome, secondOutcome] = await Promise.all([first, second])

    // Both prompt() calls resolve (one runs the turn directly, the other is
    // queued behind it — either way, no second createSession happened).
    expect(firstOutcome.kind).not.toBe('shutting_down')
    expect(secondOutcome.kind).not.toBe('shutting_down')
    expect(jest.mocked(spawn)).toHaveBeenCalledTimes(1)

    // Exactly one open sessions row was inserted.
    expect(insertSessionSpy).toHaveBeenCalledTimes(1)

    // The single live session in the map is shared — there is only one entry
    // for the channel, proving both callers converged on the same session.
    expect(sessions(service).size).toBe(1)
    expect(sessions(service).has('ch-fresh')).toBe(true)
  })

  it('clears the pending entry after a successful create so it is not consulted for a later, separate attempt', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const { resolveInitialize } = mockSpawnAndConnection()

    const firstAttempt = service.prompt('ch-settle', 'hello', 'user-1')
    // Let getOrCreate register the pending entry and createSession reach the
    // still-unresolved initialize() await before resolving it — otherwise
    // awaiting firstAttempt below would deadlock on its own unresolved promise.
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize()
    await firstAttempt

    // Pending entry is gone once the attempt (and the live session it
    // produced) has settled — the channel is now served by the fast
    // (sessions map) path instead.
    expect(pendingSessions(service).has('ch-settle')).toBe(false)
    expect(sessions(service).has('ch-settle')).toBe(true)

    // A later, separate call for the same channel hits the now-live session
    // (fast path) rather than starting a fresh pending attempt or reusing a
    // stale one — no second spawn.
    await service.prompt('ch-settle', 'hello again', 'user-1')
    expect(jest.mocked(spawn)).toHaveBeenCalledTimes(1)
  })

  it('clears the pending entry after a failed create so a retry is not permanently blocked', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const failing = mockSpawnAndConnection()

    const failedAttempt = service.prompt('ch-retry', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    failing.rejectInitialize(new Error('agent init failed'))

    await expect(failedAttempt).rejects.toThrow('agent init failed')

    // The failed attempt's pending entry must not linger.
    expect(pendingSessions(service).has('ch-retry')).toBe(false)
    expect(sessions(service).has('ch-retry')).toBe(false)

    // A retry for the same channel is not blocked by the stale entry — it
    // starts a brand-new attempt (second spawn call).
    const retry = mockSpawnAndConnection()
    const retryAttempt = service.prompt('ch-retry', 'hello again', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    retry.resolveInitialize()
    await expect(retryAttempt).resolves.toEqual(
      expect.objectContaining({ kind: expect.any(String) }),
    )
    expect(jest.mocked(spawn)).toHaveBeenCalledTimes(2)
    expect(sessions(service).has('ch-retry')).toBe(true)
  })

  it('a mention for a live (already-registered) session bypasses the pending guard entirely', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    // Live session already registered — no spawn/connection mock configured
    // at all, so any attempt to go through createSession would throw/hang.
    const session = injectSessionWithRowId(service, 'ch-live', 7)
    const connSpy = session.connection as unknown as { prompt: jest.Mock }
    connSpy.prompt.mockResolvedValue({ stopReason: 'end_turn' })

    await service.prompt('ch-live', 'hello', 'user-1')

    // pendingSessions was never touched for this channel.
    expect(pendingSessions(service).has('ch-live')).toBe(false)
    expect(jest.mocked(spawn)).not.toHaveBeenCalled()
  })

  describe('cancelPending', () => {
    it('is a no-op when nothing is pending for the channel (no throw)', () => {
      const handlers = createMockHandlers()
      const db = makeDbMock()
      const service = new (SessionManagerService as unknown as CtorWith2)(
        handlers,
        db,
      )

      expect(() => service.cancelPending('ch-nothing-pending')).not.toThrow()
      expect(pendingSessions(service).has('ch-nothing-pending')).toBe(false)
    })

    it('sets the cancelled flag on the pending entry when something IS pending', async () => {
      const handlers = createMockHandlers()
      const db = makeDbMock()
      const service = new (SessionManagerService as unknown as CtorWith2)(
        handlers,
        db,
      )
      const { resolveInitialize } = mockSpawnAndConnection()

      const attempt = service.prompt('ch-cancel', 'hello', 'user-1')
      await Promise.resolve()
      await Promise.resolve()

      expect(pendingSessions(service).has('ch-cancel')).toBe(true)
      service.cancelPending('ch-cancel')
      expect(pendingSessions(service).get('ch-cancel')?.cancelled).toBe(true)

      // cancelPending does not interfere with the in-flight attempt itself —
      // there is no consumer yet (that lands in a future unit), so the
      // create still completes normally.
      resolveInitialize()
      await expect(attempt).resolves.toBeDefined()
      expect(sessions(service).has('ch-cancel')).toBe(true)
    })
  })
})
