import { Test } from '@nestjs/testing'

import { ACP_EVENT_HANDLERS } from 'src/agent/agent.module'
import type { AcpEventHandlers } from 'src/agent/agent.types'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { DB } from 'src/db/database.module'
import { EnvKeys } from 'src/env'

function createMockHandlers(): jest.Mocked<AcpEventHandlers> {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
    onGitPushBlocked: jest.fn(),
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

type CtorWith1 = { new (h: AcpEventHandlers): SessionManagerService }
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
