import { Test } from '@nestjs/testing'

import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import type { AcpEventHandlers } from 'src/agent/agent.types'
import { globalGitWriteLock } from 'src/agent/git-write-lock'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { DB } from 'src/db/database.module'
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
