import type { AcpEventHandlers } from 'src/agent/agent.types'
import { SessionManagerService } from 'src/agent/session-manager.service'
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

function makeConfigRow(
  overrides?: Partial<{
    cwd: string
    claudeCommand: string
    claudeArgs: string[]
    idleTimeoutSec: number
    maxConcurrentSessions: number
  }>,
) {
  return {
    id: 1,
    cwd: overrides?.cwd ?? '/tmp',
    claudeCommand: overrides?.claudeCommand ?? 'claude',
    claudeArgs: overrides?.claudeArgs ?? ['--dangerously-skip-permissions'],
    idleTimeoutSec: overrides?.idleTimeoutSec ?? 300,
    maxConcurrentSessions: overrides?.maxConcurrentSessions ?? 5,
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
  new (h: AcpEventHandlers, db: unknown): SessionManagerService
}

type ServiceInternals = {
  claudeCommand: string
  claudeCwd: string
  claudeArgs: string[]
  idleTimeoutSec: number
  maxConcurrentSessions: number
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
    })
    const db = makeDbMockWithConfig(cfg)

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
    )
    const internals = service as unknown as ServiceInternals

    expect(internals.claudeCommand).toBe('my-claude')
    expect(internals.claudeCwd).toBe('/custom/cwd')
    expect(internals.claudeArgs).toEqual(['--flag', '--other'])
    expect(internals.idleTimeoutSec).toBe(120)
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
      () => new (SessionManagerService as unknown as CtorWith2)(handlers, db),
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

  it('rereadConfig is a no-op when config row is missing', () => {
    const handlers = createMockHandlers()
    const initial = makeConfigRow({ idleTimeoutSec: 300 })
    const db = makeDbMockWithConfig(initial)

    const service = new (SessionManagerService as unknown as CtorWith2)(
      handlers,
      db,
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
    )
    expect((service as unknown as ServiceInternals).claudeArgs).toEqual([
      '--dangerously-skip-permissions',
    ])
  })
})
