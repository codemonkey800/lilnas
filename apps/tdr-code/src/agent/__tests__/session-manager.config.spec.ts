import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'

import { ClientSideConnection } from '@agentclientprotocol/sdk'
import { PinoLogger } from 'nestjs-pino'

import type { AcpEventHandlers } from 'src/agent/agent.types'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { BASE_SYSTEM_PROMPT } from 'src/agent/system-prompt.constants'
import { EnvKeys } from 'src/env'

jest.mock('node:child_process', () => ({
  execFileSync: jest.fn().mockReturnValue('/usr/bin/git'),
  spawn: jest.fn(),
}))

jest.mock('@agentclientprotocol/sdk', () => ({
  ndJsonStream: jest.fn().mockReturnValue({}),
  PROTOCOL_VERSION: '1.0',
  ClientSideConnection: jest.fn(),
}))

jest.mock('src/agent/acp-client', () => ({
  createAcpClient: jest.fn(),
}))

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
  }
}

function makeConfigRow(
  overrides?: Partial<{
    cwd: string
    claudeCommand: string
    claudeArgs: string[]
    idleTimeoutSec: number
    maxConcurrentSessions: number
    customSystemPrompt: string
  }>,
) {
  return {
    id: 1,
    cwd: overrides?.cwd ?? '/tmp',
    claudeCommand: overrides?.claudeCommand ?? 'claude',
    claudeArgs: overrides?.claudeArgs ?? ['--dangerously-skip-permissions'],
    idleTimeoutSec: overrides?.idleTimeoutSec ?? 300,
    maxConcurrentSessions: overrides?.maxConcurrentSessions ?? 5,
    customSystemPrompt: overrides?.customSystemPrompt ?? '',
    updatedAt: new Date(),
  }
}

function makeDbMockWithConfig(configRow: ReturnType<typeof makeConfigRow>) {
  const chain: Record<string, jest.Mock> = {
    values: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    from: jest.fn(),
    get: jest.fn().mockReturnValue(configRow),
    all: jest.fn().mockReturnValue([]),
    run: jest.fn().mockReturnValue({ changes: 0 }),
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
    _chain: chain,
  }
}

type CtorWith2 = {
  new (
    h: AcpEventHandlers,
    db: unknown,
    logger: PinoLogger,
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

type ServiceInternals = {
  claudeCommand: string
  claudeCwd: string
  claudeArgs: string[]
  idleTimeoutSec: number
  maxConcurrentSessions: number
  customSystemPrompt: string
}

describe('SessionManagerService — DB-backed config (U2)', () => {
  beforeEach(() => {
    process.env[EnvKeys.BOT_GENERATION_ID] = '99'
  })
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
  })

  it('constructor reads config fields from DB row', () => {
    const handlers = createMockHandlers()
    const cfg = makeConfigRow({
      cwd: '/custom/cwd',
      claudeCommand: 'my-claude',
      claudeArgs: ['--flag', '--other'],
      idleTimeoutSec: 120,
      maxConcurrentSessions: 3,
      customSystemPrompt: 'Always respond in haiku.',
    })
    const db = makeDbMockWithConfig(cfg)

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
    )
    const internals = service as unknown as ServiceInternals

    expect(internals.claudeCommand).toBe('my-claude')
    expect(internals.claudeCwd).toBe('/custom/cwd')
    expect(internals.claudeArgs).toEqual(['--flag', '--other'])
    expect(internals.idleTimeoutSec).toBe(120)
    expect(internals.customSystemPrompt).toBe('Always respond in haiku.')
    expect(internals.maxConcurrentSessions).toBe(3)
  })

  it('constructor throws when config row is missing (bot booted before main seeded)', () => {
    const handlers = createMockHandlers()
    const chain: Record<string, jest.Mock> = {
      values: jest.fn(),
      set: jest.fn(),
      where: jest.fn(),
      returning: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
      onConflictDoUpdate: jest.fn(),
      from: jest.fn(),
      get: jest.fn().mockReturnValue(undefined),
      all: jest.fn().mockReturnValue([]),
      run: jest.fn().mockReturnValue({ changes: 0 }),
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
    const db = {
      insert: jest.fn().mockReturnValue(chain),
      update: jest.fn().mockReturnValue(chain),
      select: jest.fn().mockReturnValue(chain),
      delete: jest.fn().mockReturnValue(chain),
      transaction: jest.fn().mockImplementation((cb: () => unknown) => cb()),
    }

    expect(
      () =>
        new (SessionManagerService as unknown as CtorWith2)(
          handlers,
          db,
          makeLogger(),
        ),
    ).toThrow(/config row missing/)
  })

  it('rereadConfig updates all four mutable fields from DB', () => {
    const handlers = createMockHandlers()
    const initial = makeConfigRow({
      idleTimeoutSec: 300,
      maxConcurrentSessions: 5,
    })
    const db = makeDbMockWithConfig(initial)

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
    )
    const internals = service as unknown as ServiceInternals
    expect(internals.idleTimeoutSec).toBe(300)

    // Swap the config row returned by getConfig
    const updated = makeConfigRow({
      idleTimeoutSec: 600,
      maxConcurrentSessions: 10,
    })
    db._chain.get.mockReturnValue(updated)

    service.rereadConfig()

    expect(internals.idleTimeoutSec).toBe(600)
    expect(internals.maxConcurrentSessions).toBe(10)
  })

  it('rereadConfig reassigns customSystemPrompt from a fresh DB read', () => {
    const handlers = createMockHandlers()
    const initial = makeConfigRow({ customSystemPrompt: '' })
    const db = makeDbMockWithConfig(initial)

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
    )
    const internals = service as unknown as ServiceInternals
    expect(internals.customSystemPrompt).toBe('')

    const updated = makeConfigRow({
      customSystemPrompt: 'Be extra concise.',
    })
    db._chain.get.mockReturnValue(updated)

    service.rereadConfig()

    expect(internals.customSystemPrompt).toBe('Be extra concise.')
  })

  it('rereadConfig is a no-op when config row is missing', () => {
    const handlers = createMockHandlers()
    const initial = makeConfigRow({ idleTimeoutSec: 300 })
    const db = makeDbMockWithConfig(initial)

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
    )
    const internals = service as unknown as ServiceInternals

    // Row disappears
    db._chain.get.mockReturnValue(undefined)

    expect(() => service.rereadConfig()).not.toThrow()
    // Fields unchanged
    expect(internals.idleTimeoutSec).toBe(300)
  })

  it('claudeArgs default is ["--dangerously-skip-permissions"]', () => {
    const handlers = createMockHandlers()
    const db = makeDbMockWithConfig(makeConfigRow())

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
    )
    expect((service as unknown as ServiceInternals).claudeArgs).toEqual([
      '--dangerously-skip-permissions',
    ])
  })
})

describe('SessionManagerService — R3 apply-timing behavioral tests (U2)', () => {
  beforeEach(() => {
    process.env[EnvKeys.BOT_GENERATION_ID] = '99'
  })
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
  })

  function mockProcess() {
    const mockProc = new EventEmitter() as EventEmitter & {
      pid: number
      stdin: unknown
      stdout: EventEmitter
      kill: jest.Mock
    }
    mockProc.pid = 1234
    mockProc.stdin = new Writable({ write: (_c, _e, cb) => cb() })
    mockProc.stdout = new Readable({ read: () => {} })
    mockProc.kill = jest.fn()
    return mockProc
  }

  it('rereadConfig: new session uses updated cwd and claudeArgs', async () => {
    const handlers = createMockHandlers()
    const initial = makeConfigRow({
      cwd: '/old/cwd',
      claudeCommand: 'claude',
      claudeArgs: ['--old-flag'],
    })
    const db = makeDbMockWithConfig(initial)

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
    )

    const mockProc = mockProcess()
    jest.mocked(spawn).mockReturnValue(mockProc as never)
    ;(ClientSideConnection as jest.Mock).mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue({ agentCapabilities: {} }),
      newSession: jest.fn().mockResolvedValue({ sessionId: 'sess-1' }),
      prompt: jest.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    }))

    // Update config: new cwd and args
    const updated = makeConfigRow({
      cwd: '/new/cwd',
      claudeCommand: 'claude',
      claudeArgs: ['--new-flag'],
    })
    db._chain.get.mockReturnValue(updated)
    service.rereadConfig()

    // Trigger session creation
    await service.prompt('ch1', 'hello', 'user-1')

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      ['--new-flag'],
      expect.objectContaining({ cwd: '/new/cwd' }),
    )
  })

  it('rereadConfig: a session created after the reread uses the new customSystemPrompt; an already-open session is left untouched', async () => {
    const handlers = createMockHandlers()
    const initial = makeConfigRow({ customSystemPrompt: 'old instructions' })
    const db = makeDbMockWithConfig(initial)

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
    )

    // An already-open session on another channel, injected directly — proves
    // rereadConfig() never touches this.sessions (no reconnect/re-prompt).
    const existingConnection = { newSession: jest.fn(), prompt: jest.fn() }
    const sessionsMap = (
      service as unknown as { sessions: Map<string, unknown> }
    ).sessions
    sessionsMap.set('ch-existing', {
      prompting: false,
      idleTimer: setTimeout(() => {}, 99999),
      process: { kill: jest.fn(), on: jest.fn() },
      connection: existingConnection,
    })

    const mockProc = mockProcess()
    jest.mocked(spawn).mockReturnValue(mockProc as never)
    const newSessionMock = jest.fn().mockResolvedValue({ sessionId: 'sess-1' })
    ;(ClientSideConnection as jest.Mock).mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue({ agentCapabilities: {} }),
      newSession: newSessionMock,
      prompt: jest.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    }))

    // Update config: new custom prompt
    const updated = makeConfigRow({ customSystemPrompt: 'new instructions' })
    db._chain.get.mockReturnValue(updated)
    service.rereadConfig()

    // Trigger session creation on a DIFFERENT channel
    await service.prompt('ch-new', 'hello', 'user-1')

    expect(newSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        _meta: {
          systemPrompt: {
            append: `${BASE_SYSTEM_PROMPT}\n\nnew instructions`,
          },
        },
      }),
    )

    // The pre-existing session's connection was never touched.
    expect(existingConnection.newSession).not.toHaveBeenCalled()
    expect(existingConnection.prompt).not.toHaveBeenCalled()
    expect(
      (sessionsMap.get('ch-existing') as { connection: unknown }).connection,
    ).toBe(existingConnection)
  })

  it('rereadConfig: maxConcurrentSessions is NOT applied retroactively (no eviction)', () => {
    const handlers = createMockHandlers()
    const initial = makeConfigRow({ maxConcurrentSessions: 5 })
    const db = makeDbMockWithConfig(initial)

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
      makeLogger(),
    )
    const sessions = (service as unknown as { sessions: Map<string, unknown> })
      .sessions

    // Inject two active sessions
    sessions.set('ch1', {
      prompting: false,
      idleTimer: setTimeout(() => {}, 99999),
      process: { kill: jest.fn(), on: jest.fn() },
    })
    sessions.set('ch2', {
      prompting: false,
      idleTimer: setTimeout(() => {}, 99999),
      process: { kill: jest.fn(), on: jest.fn() },
    })

    // Lower max below active count
    const updated = makeConfigRow({ maxConcurrentSessions: 1 })
    db._chain.get.mockReturnValue(updated)
    service.rereadConfig()

    // Both sessions must still be active — no retroactive eviction
    expect(sessions.size).toBe(2)
  })
})
