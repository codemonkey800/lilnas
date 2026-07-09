import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'

import { ClientSideConnection } from '@agentclientprotocol/sdk'
import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { createAcpClient } from 'src/agent/acp-client'
import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import type { AcpEventHandlers } from 'src/agent/agent.types'
import { globalGitWriteLock } from 'src/agent/git-write-lock'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { BASE_SYSTEM_PROMPT } from 'src/agent/system-prompt.constants'
import { DB } from 'src/db/database.module'
import * as eventsRepo from 'src/db/events.repo'
import type { SessionRow } from 'src/db/schema'
import * as sessionsRepo from 'src/db/sessions.repo'
import { NotifyEmitterService } from 'src/discord/notify-emitter.service'
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
    onResumeFailed: jest.fn(),
    onUsageUpdate: jest.fn(),
    onGitOperationBlocked: jest.fn(),
  }
}

const MOCK_CONFIG_ROW = {
  id: 1,
  cwd: '/tmp',
  claudeCommand: 'claude',
  claudeArgs: ['--dangerously-skip-permissions'],
  idleTimeoutSec: 300,
  maxConcurrentSessions: 5,
  customSystemPrompt: '',
  updatedAt: new Date(),
}

function makeDbMock(
  runChanges = 0,
  configOverrides?: Partial<typeof MOCK_CONFIG_ROW>,
) {
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
    get: jest.fn().mockReturnValue({ ...MOCK_CONFIG_ROW, ...configOverrides }),
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
  new (
    h: AcpEventHandlers,
    db: unknown,
    logger: PinoLogger,
    notifyEmitter: Pick<NotifyEmitterService, 'notify'>,
  ): SessionManagerService
}

function makeLogger(): PinoLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

function makeNotifyEmitterMock(): jest.Mocked<
  Pick<NotifyEmitterService, 'notify'>
> {
  return { notify: jest.fn() }
}

// Builds a controllable mock child process (real EventEmitter, so proc.on
// wiring in createSession/reactivateSession's shared spawnAndConnect behaves
// like production) and wires spawn() / ClientSideConnection to it.
// `initialize`/`newSession`/`loadSession` resolution is controlled by the
// caller via the returned deferred-style resolvers, so tests can create a
// genuine concurrency window (U8) or control replay-completion timing
// relative to other assertions (U4) before any of them settles. Module-scope
// (not nested in a single describe block) so both the U8 in-flight-guard
// tests and the U4 reactivation tests can share it.
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

  // U4: controllable loadSession mock, deferred-resolver style matching
  // initialize's pattern above, so tests can control exactly when replay
  // "completes" relative to other assertions (e.g. the isReplaying
  // predicate's value, or a /clear landing mid-replay).
  let resolveLoadSession!: () => void
  let rejectLoadSession!: (err: unknown) => void
  const loadSession = jest.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        resolveLoadSession = resolve
        rejectLoadSession = reject
      }),
  )

  const prompt = jest.fn().mockResolvedValue({ stopReason: 'end_turn' })
  ;(ClientSideConnection as jest.Mock).mockImplementationOnce(() => ({
    initialize,
    newSession,
    loadSession,
    prompt,
  }))

  return {
    mockProc,
    initialize,
    newSession,
    loadSession,
    prompt,
    resolveInitialize: (
      v: {
        agentCapabilities?: Record<string, unknown>
      } = {},
    ) => resolveInitialize({ agentCapabilities: v.agentCapabilities ?? {} }),
    rejectInitialize: (err: unknown) => rejectInitialize(err),
    resolveLoadSession: () => resolveLoadSession(),
    rejectLoadSession: (err: unknown) => rejectLoadSession(err),
  }
}

// U4: builds a realistic SessionRow-shaped object for
// getLatestSessionForChannel mocks — the generic makeDbMock()'s chained
// .get() always returns a fixed config row, so tests must spy on the repo
// function directly (see sessionsRepo import) rather than rely on the DB
// mock's chain to produce session-shaped rows.
function makeSessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 1,
    channelId: 'ch1',
    generationId: 1,
    triggeringUserId: 'user-1',
    acpSessionId: 'prior-acp-session',
    cwd: '/tmp',
    createdAt: new Date(),
    endedAt: null,
    endReason: null,
    ...overrides,
  }
}

// U5: makeDbMock()'s chain object is shared across every db.insert() call in
// a test (insertSession, insertEvent, etc. all resolve to the same chain), so
// chain.values.mock.calls accumulates one [payload] tuple per .values(...)
// invocation across the whole test in call order. This reads that shared
// chain off the mocked db (via db.insert's return value) and returns every
// inserted row payload — callers filter for the shape they care about
// (e.g. an events-table insert with type: 'session_created').
function insertedRowPayloads(
  db: ReturnType<typeof makeDbMock>,
): Record<string, unknown>[] {
  const chain = (db.insert as jest.Mock).mock.results[0]?.value as {
    values: jest.Mock
  }
  return chain.values.mock.calls.map(call => call[0] as Record<string, unknown>)
}

// U4: waits by polling the microtask queue (capped) until `predicate()`
// becomes true, rather than hardcoding an exact await-hop count through the
// multi-layer spawnAndConnect/reactivateSession/createOrReactivateSession/
// getOrCreate async chain — the exact hop count is an implementation detail
// this test suite shouldn't need to track precisely. 50 ticks is generous
// for a handful of nested async calls.
async function waitFor(predicate: () => boolean, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve()
  }
}

describe('SessionManagerService — teardown abort signal (U1, R4)', () => {
  it('fires onPromptComplete("aborted") when tearing down a prompting session', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )

    injectPromptingSession(service, 'ch1')
    service.teardown('ch1')

    expect(handlers.onPromptComplete).toHaveBeenCalledWith('ch1', 'aborted')
    expect(sessions(service).has('ch1')).toBe(false)
  })

  it('fires onPromptComplete("aborted") unconditionally when tearing down a non-prompting session', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )

    const session = injectPromptingSession(service, 'ch1')
    session.prompting = false

    service.teardown('ch1')

    // teardown always signals onPromptComplete so the handler can stop any lingering
    // typing indicator — both DiscordHandlerService and SqliteWriterService guard on
    // active state and return early when no turn is open, so this is a safe no-op.
    expect(handlers.onPromptComplete).toHaveBeenCalledWith('ch1', 'aborted')
  })

  it('fires the abort signal exactly once (executePrompt error path sets prompting=false before teardown)', async () => {
    const handlers = createMockHandlers()

    const module = await Test.createTestingModule({
      providers: [
        SessionManagerService,
        { provide: ACP_EVENT_HANDLERS, useValue: handlers },
        { provide: DB, useValue: makeDbMock() },
        { provide: PinoLogger, useValue: makeLogger() },
        { provide: NotifyEmitterService, useValue: makeNotifyEmitterMock() },
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

    // Two calls: 'error' from executePrompt's catch block (with session.prompting=false),
    // then 'aborted' from teardown (unconditional). Real handlers guard on active state
    // and make the second call a safe no-op.
    expect(handlers.onPromptComplete).toHaveBeenCalledTimes(2)
    expect(handlers.onPromptComplete).toHaveBeenNthCalledWith(1, 'ch1', 'error')
    expect(handlers.onPromptComplete).toHaveBeenNthCalledWith(2, 'ch1', 'aborted')
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
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    injectSessionWithRowId(service, 'ch1', 42)

    service.teardown('ch1', 'evicted')

    expect(db.update).toHaveBeenCalled() // closeSession
    expect(db.insert).toHaveBeenCalled() // insertEvent(session_evicted)
    expect(db.delete).toHaveBeenCalled() // removeLiveStatus
    expect(sessions(service).has('ch1')).toBe(false)
  })

  it('U3: teardown notifies session:<id> (closeSession) and live (removeLiveStatus)', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const notifyEmitter = makeNotifyEmitterMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      notifyEmitter,
    )
    injectSessionWithRowId(service, 'ch1', 42)

    service.teardown('ch1', 'evicted')

    expect(notifyEmitter.notify).toHaveBeenCalledWith(['session:42'])
    expect(notifyEmitter.notify).toHaveBeenCalledWith(['live'])
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
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    injectSessionWithRowId(service, 'ch1', 42)

    expect(() => service.teardown('ch1', 'evicted')).not.toThrow()
    expect(sessions(service).has('ch1')).toBe(false)
  })

  it('U3: teardown does not notify when the write throws before it (notify is conditioned on write success)', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    db.update.mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })
    const notifyEmitter = makeNotifyEmitterMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      notifyEmitter,
    )
    injectSessionWithRowId(service, 'ch1', 42)

    service.teardown('ch1', 'evicted')

    // closeSession threw before either notify call in the try block ran —
    // the whole try/catch bails out, so neither session:<id> nor live fires.
    expect(notifyEmitter.notify).not.toHaveBeenCalled()
  })

  it('teardown skips DB writes when sessionRowId is null', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    // sessionRowId null → U2 block skipped, U5 (removeLiveStatus) still runs
    injectPromptingSession(service, 'ch1')
    sessions(service).get('ch1')!.prompting = false

    service.teardown('ch1', 'evicted')

    expect(db.update).not.toHaveBeenCalled() // closeSession skipped
    expect(db.insert).not.toHaveBeenCalled() // insertEvent skipped
    expect(db.delete).toHaveBeenCalled() // removeLiveStatus still fires
  })

  it('U3: teardown with a null sessionRowId still notifies live (session:<id> skipped)', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const notifyEmitter = makeNotifyEmitterMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      notifyEmitter,
    )
    injectPromptingSession(service, 'ch1')
    sessions(service).get('ch1')!.prompting = false

    service.teardown('ch1', 'evicted')

    expect(notifyEmitter.notify).toHaveBeenCalledWith(['live'])
    expect(notifyEmitter.notify).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringMatching(/^session:/)]),
    )
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const internals = service as unknown as ServiceInternals

    internals.ensureLiveStatusHeartbeat()
    const firstTimer = internals.liveStatusTimer

    internals.ensureLiveStatusHeartbeat()
    expect(internals.liveStatusTimer).toBe(firstTimer)
  })

  it('U3: syncLiveStatus notifies live after upsertLiveStatus succeeds', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock() // default run().changes=0 — upsert path uses .get(), not .run()
    const notifyEmitter = makeNotifyEmitterMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      notifyEmitter,
    )
    const session = injectSessionWithRowId(service, 'ch1', 42)
    const internals = service as unknown as {
      syncLiveStatus(s: typeof session): void
    }

    internals.syncLiveStatus(session)

    expect(db.insert).toHaveBeenCalled() // upsertLiveStatus (onConflictDoUpdate)
    expect(notifyEmitter.notify).toHaveBeenCalledWith(['live'])
  })

  it('U3: syncLiveStatus does not notify when the upsert throws', () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    db.insert.mockImplementation(() => {
      throw new Error('SQLITE_BUSY')
    })
    const notifyEmitter = makeNotifyEmitterMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      notifyEmitter,
    )
    const session = injectSessionWithRowId(service, 'ch1', 42)
    const internals = service as unknown as {
      syncLiveStatus(s: typeof session): void
    }

    expect(() => internals.syncLiveStatus(session)).not.toThrow()
    expect(notifyEmitter.notify).not.toHaveBeenCalled()
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const serviceB = new (SessionManagerService as unknown as CtorWith2)(
      handlersB,
      dbB,
      makeLogger(),
      makeNotifyEmitterMock(),
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
  // mockSpawnAndConnection is now module-scoped (shared with the U4
  // reactivation describe block below) — see its definition above.
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
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
      makeLogger(),
      makeNotifyEmitterMock(),
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

  it('AE1: a throwing insertSession during fresh create logs the failure with event: session-insert-failed', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const logger = makeLogger()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      logger,
      makeNotifyEmitterMock(),
    )
    const { resolveInitialize } = mockSpawnAndConnection()
    insertSessionSpy.mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY: database is locked')
    })

    const outcome = service.prompt('ch-insert-fail', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize()

    const result = await outcome
    expect(result.kind).not.toBe('shutting_down')

    // The session still comes up (sessionRowId=null, in-memory only) — the
    // insert failure is logged, not thrown.
    expect(sessions(service).has('ch-insert-fail')).toBe(true)
    expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'session-insert-failed',
        channelId: 'ch-insert-fail',
      }),
      'Session-row insert failed',
    )
  })

  it('U3: fresh create notifies session:<id> once insertSession succeeds', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const notifyEmitter = makeNotifyEmitterMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      notifyEmitter,
    )
    const { resolveInitialize } = mockSpawnAndConnection()

    const outcome = service.prompt('ch-insert-ok', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize()
    await outcome

    // makeDbMock()'s chain.get() defaults to { id: 1 } — the inserted row id.
    expect(insertSessionSpy).toHaveBeenCalledTimes(1)
    expect(notifyEmitter.notify).toHaveBeenCalledWith(['session:1'])
  })

  it('U3: a throwing insertSession during fresh create does not notify session:<id>', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const notifyEmitter = makeNotifyEmitterMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      notifyEmitter,
    )
    const { resolveInitialize } = mockSpawnAndConnection()
    insertSessionSpy.mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY: database is locked')
    })

    const outcome = service.prompt('ch-insert-fail-2', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize()
    await outcome

    expect(notifyEmitter.notify).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringMatching(/^session:/)]),
    )
  })

  describe('cancelPending', () => {
    it('is a no-op when nothing is pending for the channel (no throw)', () => {
      const handlers = createMockHandlers()
      const db = makeDbMock()
      const service = new (SessionManagerService as unknown as CtorWith2)(
        handlers,
        db,
        makeLogger(),
        makeNotifyEmitterMock(),
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
        makeLogger(),
        makeNotifyEmitterMock(),
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

describe('SessionManagerService — loadSession reactivation (U4)', () => {
  let insertSessionSpy: jest.SpyInstance
  let closeSessionSpy: jest.SpyInstance
  let getLatestSessionForChannelSpy: jest.SpyInstance

  beforeEach(() => {
    process.env[EnvKeys.BOT_GENERATION_ID] = '1'
    // See U8's beforeEach comment — jest.clearAllMocks() (global afterEach)
    // clears call history but not queued once-values.
    jest.mocked(spawn).mockReset()
    jest.mocked(ClientSideConnection).mockReset()
    jest.mocked(createAcpClient).mockReset()
    insertSessionSpy = jest.spyOn(sessionsRepo, 'insertSession')
    closeSessionSpy = jest.spyOn(sessionsRepo, 'closeSession')
    // The generic makeDbMock()'s chained .get() always returns a fixed
    // config row, so it cannot produce realistic session rows — spy on the
    // repo function directly, same pattern as insertSessionSpy above.
    getLatestSessionForChannelSpy = jest.spyOn(
      sessionsRepo,
      'getLatestSessionForChannel',
    )
  })
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
    insertSessionSpy.mockRestore()
    closeSessionSpy.mockRestore()
    getLatestSessionForChannelSpy.mockRestore()
  })

  it('happy path: reactivates a dormant channel via loadSession and runs the mention as the next turn (AE3, R8)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      id: 42,
      channelId: 'ch-dormant',
      acpSessionId: 'prior-acp-session',
      cwd: '/tmp/dormant-cwd',
      endedAt: new Date(),
      endReason: 'evicted',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)

    const { resolveInitialize, loadSession, resolveLoadSession } =
      mockSpawnAndConnection()

    const outcome = service.prompt('ch-dormant', 'hello again', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize({ agentCapabilities: { loadSession: true } })

    await waitFor(() => loadSession.mock.calls.length > 0)
    expect(loadSession).toHaveBeenCalledWith({
      sessionId: 'prior-acp-session',
      cwd: '/tmp/dormant-cwd',
      mcpServers: [],
      _meta: { systemPrompt: { append: BASE_SYSTEM_PROMPT } },
    })
    resolveLoadSession()

    const result = await outcome
    expect(result.kind).not.toBe('shutting_down')

    expect(insertSessionSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channelId: 'ch-dormant',
        acpSessionId: 'prior-acp-session',
        cwd: '/tmp/dormant-cwd',
      }),
    )
    expect(sessions(service).has('ch-dormant')).toBe(true)
  })

  it('AE1: a throwing insertSession during reactivation logs the failure with event: reactivation-insert-failed, session still comes up in-memory', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const logger = makeLogger()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      logger,
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      id: 42,
      channelId: 'ch-dormant-insert-fail',
      acpSessionId: 'prior-acp-session',
      cwd: '/tmp/dormant-cwd',
      endedAt: new Date(),
      endReason: 'evicted',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)
    insertSessionSpy.mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY: database is locked')
    })

    const { resolveInitialize, loadSession, resolveLoadSession } =
      mockSpawnAndConnection()

    const outcome = service.prompt(
      'ch-dormant-insert-fail',
      'hello again',
      'user-1',
    )
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize({ agentCapabilities: { loadSession: true } })

    await waitFor(() => loadSession.mock.calls.length > 0)
    resolveLoadSession()

    const result = await outcome
    expect(result.kind).not.toBe('shutting_down')

    // Reactivation still succeeds in-memory (sessionRowId=null) despite the
    // insert failure — mirrors createSession's own insert-failure tolerance.
    expect(sessions(service).has('ch-dormant-insert-fail')).toBe(true)
    expect(jest.mocked(logger.error)).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reactivation-insert-failed',
        channelId: 'ch-dormant-insert-fail',
      }),
      'Reactivation session-row insert failed',
    )
  })

  it('suppression timing: the isReplaying predicate is true before/through initialize+loadSession and flips false only once the live turn starts (R10)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      channelId: 'ch-suppress',
      acpSessionId: 'prior-acp-session',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)

    const { resolveInitialize, loadSession, resolveLoadSession } =
      mockSpawnAndConnection()

    const outcome = service.prompt('ch-suppress', 'hello', 'user-1')

    // ClientSideConnection is already constructed synchronously by the time
    // prompt() returns — spawnAndConnect calls createAcpClient (capturing
    // the predicate as its 3rd arg) immediately before constructing the
    // connection, both before the first await (connection.initialize).
    await Promise.resolve()
    expect(jest.mocked(createAcpClient)).toHaveBeenCalledTimes(1)
    const isReplaying = jest.mocked(createAcpClient).mock.calls[0]![2] as
      | (() => boolean)
      | undefined
    expect(isReplaying).toBeDefined()
    expect(isReplaying!()).toBe(true)

    resolveInitialize({ agentCapabilities: { loadSession: true } })
    await waitFor(() => loadSession.mock.calls.length > 0)
    // Still true across initialize and into the in-flight loadSession call.
    expect(isReplaying!()).toBe(true)

    resolveLoadSession()
    // Immediately after resolving — the re-check/close/insert continuation
    // that flips the box hasn't run yet (requires at least one microtask
    // hop), so the predicate is still true here.
    expect(isReplaying!()).toBe(true)

    await waitFor(() => handlers.onPromptStart.mock.calls.length > 0)
    // Flipped false by the time the live turn opens.
    expect(isReplaying!()).toBe(false)

    await outcome
  })

  it('cleared session: acpSessionId null on the latest row falls through to fresh newSession, never calling loadSession (R14)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const clearedRow = makeSessionRow({
      channelId: 'ch-cleared',
      acpSessionId: null,
    })
    getLatestSessionForChannelSpy.mockReturnValue(clearedRow)

    const { resolveInitialize, newSession, loadSession } =
      mockSpawnAndConnection()

    const outcome = service.prompt('ch-cleared', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize({ agentCapabilities: {} })

    const result = await outcome
    expect(result.kind).not.toBe('shutting_down')
    expect(loadSession).not.toHaveBeenCalled()
    expect(newSession).toHaveBeenCalled()
    expect(sessions(service).has('ch-cleared')).toBe(true)
  })

  it('live session bypass: a channel already in the sessions map never consults getLatestSessionForChannel or spawns, even with a reactivation-eligible-looking DB row', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    // Reactivation-eligible-looking row present in "the DB" — must be
    // ignored because the live sessions map fast path wins first.
    getLatestSessionForChannelSpy.mockReturnValue(
      makeSessionRow({
        channelId: 'ch-live',
        acpSessionId: 'some-acp-session',
      }),
    )
    const session = injectSessionWithRowId(service, 'ch-live', 7)
    const connSpy = session.connection as unknown as { prompt: jest.Mock }
    connSpy.prompt.mockResolvedValue({ stopReason: 'end_turn' })

    await service.prompt('ch-live', 'hello', 'user-1')

    expect(getLatestSessionForChannelSpy).not.toHaveBeenCalled()
    expect(jest.mocked(spawn)).not.toHaveBeenCalled()
  })

  it('no prior row: getLatestSessionForChannel returning undefined falls through to fresh create, never calling loadSession', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    getLatestSessionForChannelSpy.mockReturnValue(undefined)

    const { resolveInitialize, newSession, loadSession } =
      mockSpawnAndConnection()

    const outcome = service.prompt('ch-never-seen', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize({ agentCapabilities: {} })

    await outcome
    expect(loadSession).not.toHaveBeenCalled()
    expect(newSession).toHaveBeenCalled()
  })

  it('capability absent: falls through to fresh create — spawn is called twice (aborted reactivation attempt + fresh fallback); onResumeFailed fires + resumeFailed event recorded (U5, R9)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      channelId: 'ch-nocap',
      acpSessionId: 'prior-acp-session',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)

    // Queue BOTH attempts' spawn/connection mocks upfront — the aborted
    // reactivation consumes the first pair, the fresh fallback consumes the
    // second, regardless of the exact microtask interleaving between them.
    const reactivationAttempt = mockSpawnAndConnection()
    const freshAttempt = mockSpawnAndConnection()

    const outcome = service.prompt('ch-nocap', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()

    // No loadSession capability advertised for the reactivation attempt.
    reactivationAttempt.resolveInitialize({ agentCapabilities: {} })
    await waitFor(() => freshAttempt.initialize.mock.calls.length > 0)
    freshAttempt.resolveInitialize({ agentCapabilities: {} })

    const result = await outcome
    expect(result.kind).not.toBe('shutting_down')
    expect(jest.mocked(spawn)).toHaveBeenCalledTimes(2)
    expect(reactivationAttempt.loadSession).not.toHaveBeenCalled()
    expect(freshAttempt.newSession).toHaveBeenCalled()
    expect(reactivationAttempt.mockProc.kill).toHaveBeenCalled()
    expect(sessions(service).has('ch-nocap')).toBe(true)

    // U5: capability-absent is a genuine failure — notify once, and never
    // call loadSession (no capability to attempt it with).
    expect(handlers.onResumeFailed).toHaveBeenCalledTimes(1)
    expect(handlers.onResumeFailed).toHaveBeenCalledWith('ch-nocap')
    const resumeFailedEvent = insertedRowPayloads(db).find(
      row => (row.context as { resumeFailed?: boolean })?.resumeFailed,
    )
    expect(resumeFailedEvent).toMatchObject({
      type: 'session_created',
      level: 'warn',
      channelId: 'ch-nocap',
      context: { resumeFailed: true, reason: 'capability_absent' },
    })
  })

  it('loadSession rejects: falls through to fresh create; onResumeFailed fires once + resumeFailed event recorded with a scrubbed reason, half-spawned process fully cleaned up (happy path, AE4/R9, F8)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      channelId: 'ch-loadfail',
      acpSessionId: 'prior-acp-session',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)

    const reactivationAttempt = mockSpawnAndConnection()
    const freshAttempt = mockSpawnAndConnection()

    const outcome = service.prompt('ch-loadfail', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    reactivationAttempt.resolveInitialize({
      agentCapabilities: { loadSession: true },
    })

    await waitFor(() => reactivationAttempt.loadSession.mock.calls.length > 0)
    const loadSessionError = new Error(
      'transcript missing: sensitive detail that must not be persisted',
    )
    loadSessionError.name = 'TranscriptMissingError'
    reactivationAttempt.rejectLoadSession(loadSessionError)

    await waitFor(() => freshAttempt.initialize.mock.calls.length > 0)
    freshAttempt.resolveInitialize({ agentCapabilities: {} })

    const result = await outcome
    expect(result.kind).not.toBe('shutting_down')
    expect(jest.mocked(spawn)).toHaveBeenCalledTimes(2)
    expect(freshAttempt.newSession).toHaveBeenCalled()
    // F8: the half-spawned reactivation process is fully cleaned up.
    expect(reactivationAttempt.mockProc.kill).toHaveBeenCalled()
    expect(sessions(service).has('ch-loadfail')).toBe(true)

    // U5: a genuine reactivation failure notifies exactly once and records a
    // resumeFailed event whose reason is derived safely from the error (its
    // name/code, never the raw message — matches composite-acp-handler.ts's
    // handleWriterError scrub convention).
    expect(handlers.onResumeFailed).toHaveBeenCalledTimes(1)
    expect(handlers.onResumeFailed).toHaveBeenCalledWith('ch-loadfail')
    const resumeFailedEvent = insertedRowPayloads(db).find(
      row => (row.context as { resumeFailed?: boolean })?.resumeFailed,
    )
    expect(resumeFailedEvent).toMatchObject({
      type: 'session_created',
      level: 'warn',
      channelId: 'ch-loadfail',
      context: { resumeFailed: true, reason: 'TranscriptMissingError' },
    })
    const eventStr = JSON.stringify(resumeFailedEvent)
    expect(eventStr).not.toContain('sensitive detail')
  })

  it('emitResumeFailed insert-fault guard: a transient insertEvent throw during the resume-failure notice does not skip killProcessTree (F8)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      channelId: 'ch-insertfault',
      acpSessionId: 'prior-acp-session',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)

    const reactivationAttempt = mockSpawnAndConnection()
    const freshAttempt = mockSpawnAndConnection()

    // Faults ONLY the first insertEvent call — the one inside
    // emitResumeFailed's own try/catch — so the fresh fallback's later
    // legitimate session_created insert still succeeds normally.
    const insertEventSpy = jest
      .spyOn(eventsRepo, 'insertEvent')
      .mockImplementationOnce(() => {
        throw new Error('SQLITE_BUSY: database is locked')
      })

    try {
      const outcome = service.prompt('ch-insertfault', 'hello', 'user-1')
      await Promise.resolve()
      await Promise.resolve()
      reactivationAttempt.resolveInitialize({
        agentCapabilities: { loadSession: true },
      })

      await waitFor(() => reactivationAttempt.loadSession.mock.calls.length > 0)
      reactivationAttempt.rejectLoadSession(new Error('transcript missing'))

      await waitFor(() => freshAttempt.initialize.mock.calls.length > 0)
      freshAttempt.resolveInitialize({ agentCapabilities: {} })

      const result = await outcome
      expect(result.kind).not.toBe('shutting_down')

      // The guard: even though recording the resumeFailed event faulted,
      // the notice still fired and the half-spawned process was still
      // killed — neither is skipped by the DB write failing.
      expect(handlers.onResumeFailed).toHaveBeenCalledTimes(1)
      expect(handlers.onResumeFailed).toHaveBeenCalledWith('ch-insertfault')
      expect(reactivationAttempt.mockProc.kill).toHaveBeenCalled()
      expect(freshAttempt.newSession).toHaveBeenCalled()
      expect(sessions(service).has('ch-insertfault')).toBe(true)
    } finally {
      insertEventSpy.mockRestore()
    }
  })

  describe('reactivateSession loadSession timeout (F8 — channel-wedge fix coverage)', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('a loadSession call that never settles is bounded by LOAD_SESSION_TIMEOUT_MS and falls through to a fresh session', async () => {
      const handlers = createMockHandlers()
      const db = makeDbMock()
      const service = new (SessionManagerService as unknown as CtorWith2)(
        handlers,
        db,
        makeLogger(),
        makeNotifyEmitterMock(),
      )
      const priorRow = makeSessionRow({
        channelId: 'ch-loadtimeout',
        acpSessionId: 'prior-acp-session',
      })
      getLatestSessionForChannelSpy.mockReturnValue(priorRow)

      const reactivationAttempt = mockSpawnAndConnection()
      const freshAttempt = mockSpawnAndConnection()

      const outcome = service.prompt('ch-loadtimeout', 'hello', 'user-1')
      await Promise.resolve()
      await Promise.resolve()
      reactivationAttempt.resolveInitialize({
        agentCapabilities: { loadSession: true },
      })

      await waitFor(() => reactivationAttempt.loadSession.mock.calls.length > 0)
      // Never resolve/reject reactivationAttempt's loadSession — simulates
      // a silently-hung ACP call. Advancing past LOAD_SESSION_TIMEOUT_MS
      // (30s) is what must unwedge this channel instead of hanging forever.
      await jest.advanceTimersByTimeAsync(30_000)

      await waitFor(() => freshAttempt.initialize.mock.calls.length > 0)
      freshAttempt.resolveInitialize({ agentCapabilities: {} })

      const result = await outcome
      expect(result.kind).not.toBe('shutting_down')
      expect(jest.mocked(spawn)).toHaveBeenCalledTimes(2)
      expect(freshAttempt.newSession).toHaveBeenCalled()
      // The wedged reactivation process is fully cleaned up, not leaked.
      expect(reactivationAttempt.mockProc.kill).toHaveBeenCalled()
      expect(sessions(service).has('ch-loadtimeout')).toBe(true)

      // Same genuine-failure notify contract as the loadSession-rejects case.
      expect(handlers.onResumeFailed).toHaveBeenCalledTimes(1)
      expect(handlers.onResumeFailed).toHaveBeenCalledWith('ch-loadtimeout')
      const resumeFailedEvent = insertedRowPayloads(db).find(
        row => (row.context as { resumeFailed?: boolean })?.resumeFailed,
      )
      expect(resumeFailedEvent).toMatchObject({
        type: 'session_created',
        level: 'warn',
        channelId: 'ch-loadtimeout',
        context: { resumeFailed: true, reason: 'Error' },
      })
    })
  })

  it('closes the dangling prior row with endReason interrupted before inserting the new row', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      id: 99,
      channelId: 'ch-close',
      acpSessionId: 'prior-acp-session',
      cwd: '/tmp/close-cwd',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)

    const { resolveInitialize, loadSession, resolveLoadSession } =
      mockSpawnAndConnection()

    const outcome = service.prompt('ch-close', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize({ agentCapabilities: { loadSession: true } })
    await waitFor(() => loadSession.mock.calls.length > 0)
    resolveLoadSession()

    await outcome

    expect(closeSessionSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 99, endReason: 'interrupted' }),
    )
    expect(insertSessionSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channelId: 'ch-close',
        acpSessionId: 'prior-acp-session',
      }),
    )
    // Close-first ordering: the close call must precede the insert call.
    // invocationCallOrder is a single global counter shared across all jest
    // mocks, so comparing it across two different spies is valid.
    const closeOrder = closeSessionSpy.mock.invocationCallOrder[0]!
    const insertOrder = insertSessionSpy.mock.invocationCallOrder[0]!
    expect(closeOrder).toBeLessThan(insertOrder)
  })

  it('/clear mid-replay race: the re-check aborts before inserting a new row, kills the half-spawned process, does not re-link the nulled acpSessionId, and stays silent — no onResumeFailed, no resumeFailed event (R14, U5)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      id: 55,
      channelId: 'ch-clear-race',
      acpSessionId: 'prior-acp-session',
      cwd: '/tmp/clear-race-cwd',
    })
    const clearedRow = makeSessionRow({
      id: 55,
      channelId: 'ch-clear-race',
      acpSessionId: null,
    })
    // First call (resumability check in createOrReactivateSession):
    // resumable. Second call (the re-check in reactivateSession, run after
    // loadSession resolves): /clear landed mid-replay, nulling acpSessionId.
    getLatestSessionForChannelSpy
      .mockReturnValueOnce(priorRow)
      .mockReturnValueOnce(clearedRow)

    const reactivationAttempt = mockSpawnAndConnection()
    const freshAttempt = mockSpawnAndConnection()

    const outcome = service.prompt('ch-clear-race', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    reactivationAttempt.resolveInitialize({
      agentCapabilities: { loadSession: true },
    })
    await waitFor(() => reactivationAttempt.loadSession.mock.calls.length > 0)
    reactivationAttempt.resolveLoadSession()

    await waitFor(() => freshAttempt.initialize.mock.calls.length > 0)
    freshAttempt.resolveInitialize({ agentCapabilities: {} })

    await outcome

    // No new sessions row was inserted re-linking the old (now-nulled)
    // acpSessionId.
    expect(insertSessionSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ acpSessionId: 'prior-acp-session' }),
    )
    expect(reactivationAttempt.mockProc.kill).toHaveBeenCalled()
    expect(freshAttempt.newSession).toHaveBeenCalled()
    expect(sessions(service).has('ch-clear-race')).toBe(true)

    // U5: this is the expected/silent fresh-start reason — a /clear landing
    // mid-replay is the user's own action, not a genuine failure, so it must
    // NOT trigger the resume-failure notice or event (that's reserved for
    // the capability-absent / loadSession-rejects branches tested above).
    expect(handlers.onResumeFailed).not.toHaveBeenCalled()
    const resumeFailedEvent = insertedRowPayloads(db).find(
      row => (row.context as { resumeFailed?: boolean })?.resumeFailed,
    )
    expect(resumeFailedEvent).toBeUndefined()
  })

  it('integration: a resume-failure fresh start does not poison future attempts — the pending entry clears and the next mention for the same channel reactivates normally (U5)', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const staleRow = makeSessionRow({
      id: 1,
      channelId: 'ch-poison-check',
      acpSessionId: 'stale-acp-session',
    })
    getLatestSessionForChannelSpy.mockReturnValue(staleRow)

    const failedReactivation = mockSpawnAndConnection()
    const freshFallback = mockSpawnAndConnection()

    const firstOutcome = service.prompt('ch-poison-check', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    failedReactivation.resolveInitialize({
      agentCapabilities: { loadSession: true },
    })
    await waitFor(() => failedReactivation.loadSession.mock.calls.length > 0)
    failedReactivation.rejectLoadSession(new Error('transcript missing'))
    await waitFor(() => freshFallback.initialize.mock.calls.length > 0)
    freshFallback.resolveInitialize({ agentCapabilities: {} })

    await firstOutcome

    // The first attempt's failure is visible (sanity-check on this test's
    // own setup) but must not leave the channel's pending-guard stuck.
    expect(handlers.onResumeFailed).toHaveBeenCalledTimes(1)
    expect(pendingSessions(service).has('ch-poison-check')).toBe(false)

    // Simulate the fresh session eventually going dormant (idle-evicted),
    // same as any other session — this is what makes the channel
    // reactivation-eligible again on the next mention.
    service.teardown('ch-poison-check', 'evicted')
    expect(sessions(service).has('ch-poison-check')).toBe(false)

    // Next mention: the fresh session's own row is now the resumable one.
    // A brand-new resumable row (representing the fresh session that just
    // went dormant) is what the next getLatestSessionForChannel call sees.
    const newRow = makeSessionRow({
      id: 2,
      channelId: 'ch-poison-check',
      acpSessionId: 'fresh-acp-session',
    })
    getLatestSessionForChannelSpy.mockReturnValue(newRow)

    const secondReactivation = mockSpawnAndConnection()
    const secondOutcome = service.prompt(
      'ch-poison-check',
      'hello again',
      'user-1',
    )
    await Promise.resolve()
    await Promise.resolve()
    secondReactivation.resolveInitialize({
      agentCapabilities: { loadSession: true },
    })
    await waitFor(() => secondReactivation.loadSession.mock.calls.length > 0)
    secondReactivation.resolveLoadSession()

    await secondOutcome

    // One failure did not permanently disable resume for this channel: the
    // second attempt reactivates via loadSession normally (no second
    // fallback spawn needed, no additional onResumeFailed call).
    expect(secondReactivation.loadSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'fresh-acp-session' }),
    )
    expect(handlers.onResumeFailed).toHaveBeenCalledTimes(1)
    expect(sessions(service).has('ch-poison-check')).toBe(true)
  })

  it('turn-index reseed integration: the first live turn after reactivation is handed a sessionRowId different from the prior (closed) row', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      id: 42,
      channelId: 'ch-reseed',
      acpSessionId: 'prior-acp-session',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)

    const { resolveInitialize, loadSession, resolveLoadSession } =
      mockSpawnAndConnection()

    const outcome = service.prompt('ch-reseed', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize({ agentCapabilities: { loadSession: true } })
    await waitFor(() => loadSession.mock.calls.length > 0)
    resolveLoadSession()

    await outcome

    expect(handlers.onPromptStart).toHaveBeenCalledTimes(1)
    const [, , context] = handlers.onPromptStart.mock.calls[0]!
    expect((context as { sessionRowId: number | null }).sessionRowId).not.toBe(
      42,
    )
  })

  it('stale Stop button / turn counter: reactivation does not reset the service-global turn counter', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock()
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )

    // Mint a turn id on an unrelated LIVE session first.
    const liveSession = injectSessionWithRowId(service, 'ch-other', 1)
    const liveConn = liveSession.connection as unknown as { prompt: jest.Mock }
    liveConn.prompt.mockResolvedValue({ stopReason: 'end_turn' })
    await service.prompt('ch-other', 'first turn', 'user-1')
    const priorTurnId = handlers.onPromptStart.mock.calls[0]![1] as number

    // Now reactivate a different, dormant channel.
    const priorRow = makeSessionRow({
      channelId: 'ch-reactivated',
      acpSessionId: 'prior-acp-session',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)
    const { resolveInitialize, loadSession, resolveLoadSession } =
      mockSpawnAndConnection()

    const outcome = service.prompt('ch-reactivated', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize({ agentCapabilities: { loadSession: true } })
    await waitFor(() => loadSession.mock.calls.length > 0)
    resolveLoadSession()
    await outcome

    const reactivatedTurnId = handlers.onPromptStart.mock.calls[1]![1] as number
    expect(reactivatedTurnId).toBeGreaterThan(priorTurnId)

    // A stale Stop click for the unrelated live session's old turn id must
    // not cancel the reactivated turn.
    expect(service.cancel('ch-reactivated', priorTurnId)).toBe(false)
  })
})

describe('SessionManagerService — system prompt composition (U2, R4/R5/R6/R7)', () => {
  let getLatestSessionForChannelSpy: jest.SpyInstance

  beforeEach(() => {
    process.env[EnvKeys.BOT_GENERATION_ID] = '1'
    jest.mocked(spawn).mockReset()
    jest.mocked(ClientSideConnection).mockReset()
    // Defaults to undefined (no prior row) so fresh-session tests fall
    // through to createSession, matching the U8 describe block's setup.
    getLatestSessionForChannelSpy = jest.spyOn(
      sessionsRepo,
      'getLatestSessionForChannel',
    )
  })
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
    getLatestSessionForChannelSpy.mockRestore()
  })

  it('createSession sends _meta.systemPrompt.append combining the base prompt and a configured custom prompt', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock(0, {
      customSystemPrompt: 'Always respond in haiku.',
    })
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const { resolveInitialize, newSession } = mockSpawnAndConnection()

    const outcome = service.prompt('ch-custom-prompt', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize()
    await outcome

    expect(newSession).toHaveBeenCalledWith({
      cwd: '/tmp',
      mcpServers: [],
      _meta: {
        systemPrompt: {
          append: `${BASE_SYSTEM_PROMPT}\n\nAlways respond in haiku.`,
        },
      },
    })
  })

  it('createSession sends exactly BASE_SYSTEM_PROMPT with no trailing separator when customSystemPrompt is whitespace-only', async () => {
    const handlers = createMockHandlers()
    const db = makeDbMock(0, { customSystemPrompt: '   \n  ' })
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const { resolveInitialize, newSession } = mockSpawnAndConnection()

    const outcome = service.prompt('ch-blank-prompt', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize()
    await outcome

    expect(newSession).toHaveBeenCalledWith(
      expect.objectContaining({
        _meta: { systemPrompt: { append: BASE_SYSTEM_PROMPT } },
      }),
    )
  })

  it('records promptAppendLength/hasCustom on the session_created event for a fresh session', async () => {
    const handlers = createMockHandlers()
    const custom = 'Be extra concise.'
    const db = makeDbMock(0, { customSystemPrompt: custom })
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const { resolveInitialize } = mockSpawnAndConnection()

    const outcome = service.prompt('ch-event-check', 'hello', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize()
    await outcome

    const expectedAppend = `${BASE_SYSTEM_PROMPT}\n\n${custom}`
    const events = insertedRowPayloads(db).filter(
      row => row.type === 'session_created',
    )
    expect(events).toHaveLength(1)
    const context = events[0]!.context as Record<string, unknown>
    expect(context.promptAppendLength).toBe(expectedAppend.length)
    expect(context.hasCustom).toBe(true)
  })

  it('reactivateSession sends the identical _meta.systemPrompt.append that newSession would for the same live config, and records the same event pair', async () => {
    const handlers = createMockHandlers()
    const custom = 'Prefer terse answers.'
    const db = makeDbMock(0, { customSystemPrompt: custom })
    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
      makeNotifyEmitterMock(),
    )
    const priorRow = makeSessionRow({
      channelId: 'ch-dormant-prompt',
      acpSessionId: 'prior-acp-session',
      cwd: '/tmp/dormant-cwd',
      endedAt: new Date(),
      endReason: 'evicted',
    })
    getLatestSessionForChannelSpy.mockReturnValue(priorRow)

    const { resolveInitialize, loadSession, resolveLoadSession } =
      mockSpawnAndConnection()

    const outcome = service.prompt('ch-dormant-prompt', 'hello again', 'user-1')
    await Promise.resolve()
    await Promise.resolve()
    resolveInitialize({ agentCapabilities: { loadSession: true } })
    await waitFor(() => loadSession.mock.calls.length > 0)

    const expectedAppend = `${BASE_SYSTEM_PROMPT}\n\n${custom}`
    expect(loadSession).toHaveBeenCalledWith({
      sessionId: 'prior-acp-session',
      cwd: '/tmp/dormant-cwd',
      mcpServers: [],
      _meta: { systemPrompt: { append: expectedAppend } },
    })
    resolveLoadSession()
    await outcome

    const events = insertedRowPayloads(db).filter(
      row =>
        row.type === 'session_created' &&
        (row.context as Record<string, unknown> | undefined)?.resumed === true,
    )
    expect(events).toHaveLength(1)
    const context = events[0]!.context as Record<string, unknown>
    expect(context.promptAppendLength).toBe(expectedAppend.length)
    expect(context.hasCustom).toBe(true)
  })
})
