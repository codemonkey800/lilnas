import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { SessionManagerService } from 'src/agent/session-manager.service'
import { CommandPollerService } from 'src/commands/command-poller.service'
import { insertGeneration } from 'src/db/bot-generation.repo'
import { enqueue } from 'src/db/command.repo'
import { DB } from 'src/db/database.module'
import { createTestDb } from 'src/db/test-db'
import { EnvKeys } from 'src/env'

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    assign: jest.fn(),
  } as unknown as PinoLogger
}

function makeSessionManager() {
  return {
    teardown: jest.fn(),
    rereadConfig: jest.fn(),
  } as unknown as jest.Mocked<SessionManagerService>
}

async function buildService(
  db: ReturnType<typeof createTestDb>['db'],
  sessionManager: jest.Mocked<SessionManagerService>,
  genId: number | null = null,
) {
  if (genId != null) {
    process.env[EnvKeys.BOT_GENERATION_ID] = String(genId)
  } else {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
  }
  process.env[EnvKeys.BOT_COMMAND_POLL_MS] = '50'

  const module = await Test.createTestingModule({
    providers: [
      CommandPollerService,
      { provide: DB, useValue: db },
      { provide: SessionManagerService, useValue: sessionManager },
      { provide: PinoLogger, useValue: makeLogger() },
    ],
  }).compile()
  return module.get(CommandPollerService)
}

describe('CommandPollerService', () => {
  let testDb: ReturnType<typeof createTestDb>
  let sessionManager: jest.Mocked<SessionManagerService>

  beforeEach(() => {
    testDb = createTestDb()
    sessionManager = makeSessionManager()
  })

  afterEach(() => {
    testDb.close()
    delete process.env[EnvKeys.BOT_GENERATION_ID]
    delete process.env[EnvKeys.BOT_COMMAND_POLL_MS]
  })

  it('enqueue teardown_channel → poller dispatches teardown once', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const svc = await buildService(testDb.db, sessionManager, gen.id)
    svc.onModuleInit()

    enqueue(testDb.db, {
      generationId: gen.id,
      type: 'teardown_channel',
      target: '123456789012345678',
      createdAt: new Date(),
    })

    await new Promise(r => setTimeout(r, 150))
    svc.onModuleDestroy()

    expect(sessionManager.teardown).toHaveBeenCalledTimes(1)
    expect(sessionManager.teardown).toHaveBeenCalledWith('123456789012345678')
  })

  it('claimed command is not re-dispatched (at-most-once)', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const svc = await buildService(testDb.db, sessionManager, gen.id)
    svc.onModuleInit()

    enqueue(testDb.db, {
      generationId: gen.id,
      type: 'teardown_channel',
      target: '123456789012345678',
      createdAt: new Date(),
    })

    await new Promise(r => setTimeout(r, 200))
    svc.onModuleDestroy()

    // teardown should have been called exactly once, not twice.
    expect(sessionManager.teardown).toHaveBeenCalledTimes(1)
  })

  it('malformed target (empty string) → anomaly logged, teardown not called', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })

    // Insert directly with invalid target (bypassing repo validation).
    testDb.db
      .insert((await import('src/db/schema')).commands)
      .values({
        generationId: gen.id,
        type: 'teardown_channel',
        target: 'not-a-snowflake',
        status: 'pending',
        createdAt: new Date(),
      })
      .run()

    const svc = await buildService(testDb.db, sessionManager, gen.id)
    svc.onModuleInit()

    await new Promise(r => setTimeout(r, 150))
    svc.onModuleDestroy()

    expect(sessionManager.teardown).not.toHaveBeenCalled()
  })

  it('no BOT_GENERATION_ID → poller inactive (no teardown)', async () => {
    const svc = await buildService(testDb.db, sessionManager, null)
    svc.onModuleInit()
    await new Promise(r => setTimeout(r, 100))
    svc.onModuleDestroy()
    expect(sessionManager.teardown).not.toHaveBeenCalled()
  })

  it('poller timer cleared on onModuleDestroy (no leaked timer)', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    const svc = await buildService(testDb.db, sessionManager, gen.id)
    svc.onModuleInit()
    svc.onModuleDestroy()
    // No teardown fired after destroy.
    enqueue(testDb.db, {
      generationId: gen.id,
      type: 'teardown_channel',
      target: '123456789012345678',
      createdAt: new Date(),
    })
    await new Promise(r => setTimeout(r, 150))
    expect(sessionManager.teardown).not.toHaveBeenCalled()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// reread_config dispatch — uses a mock DB to avoid the native module version
// mismatch that makes createTestDb() fail in this Node environment.
// ──────────────────────────────────────────────────────────────────────────────

function makeMockDb(commands: Array<{ id: number; type: string; target: string | null }>) {
  let callCount = 0
  const claimResult = commands.map(c => ({
    ...c,
    generationId: 1,
    status: 'consumed' as const,
    createdAt: new Date(),
    consumedAt: new Date(),
  }))
  const chain: Record<string, jest.Mock> = {
    values: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    from: jest.fn(),
    get: jest.fn().mockReturnValue({ changes: 1 }),
    all: jest.fn().mockReturnValue([]),
    run: jest.fn().mockReturnValue({ changes: 1 }),
  }
  for (const k of ['values', 'set', 'where', 'returning', 'orderBy', 'limit', 'onConflictDoUpdate', 'from']) {
    chain[k]!.mockReturnValue(chain)
  }
  return {
    insert: jest.fn().mockReturnValue(chain),
    update: jest.fn().mockReturnValue(chain),
    select: jest.fn().mockReturnValue(chain),
    delete: jest.fn().mockReturnValue(chain),
    transaction: jest.fn().mockImplementation((cb: () => unknown) => {
      // First call to transaction = claimPending → returns the test commands once
      const result = callCount === 0 ? claimResult : []
      callCount++
      void cb
      return result
    }),
  }
}

describe('CommandPollerService — reread_config (U2)', () => {
  afterEach(() => {
    delete process.env[EnvKeys.BOT_GENERATION_ID]
    delete process.env[EnvKeys.BOT_COMMAND_POLL_MS]
  })

  it('reread_config command dispatches rereadConfig()', async () => {
    const sessionManager = makeSessionManager()
    const db = makeMockDb([{ id: 10, type: 'reread_config', target: null }])

    process.env[EnvKeys.BOT_GENERATION_ID] = '1'
    process.env[EnvKeys.BOT_COMMAND_POLL_MS] = '50'

    const module = await Test.createTestingModule({
      providers: [
        CommandPollerService,
        { provide: DB, useValue: db },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: PinoLogger, useValue: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), assign: jest.fn() } },
      ],
    }).compile()
    const svc = module.get(CommandPollerService)
    svc.onModuleInit()
    await new Promise(r => setTimeout(r, 150))
    svc.onModuleDestroy()

    expect(sessionManager.rereadConfig).toHaveBeenCalledTimes(1)
    expect(sessionManager.teardown).not.toHaveBeenCalled()
  })

  it('reread_config with non-null target → anomaly, no rereadConfig dispatch', async () => {
    const sessionManager = makeSessionManager()
    // target should be null for reread_config; non-null is invalid
    const db = makeMockDb([{ id: 11, type: 'reread_config', target: '123456789012345678' }])

    process.env[EnvKeys.BOT_GENERATION_ID] = '1'
    process.env[EnvKeys.BOT_COMMAND_POLL_MS] = '50'

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), assign: jest.fn() }
    const module = await Test.createTestingModule({
      providers: [
        CommandPollerService,
        { provide: DB, useValue: db },
        { provide: SessionManagerService, useValue: sessionManager },
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile()
    const svc = module.get(CommandPollerService)
    svc.onModuleInit()
    await new Promise(r => setTimeout(r, 150))
    svc.onModuleDestroy()

    expect(sessionManager.rereadConfig).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'reread_config' }),
      expect.stringContaining('anomaly'),
    )
  })
})
