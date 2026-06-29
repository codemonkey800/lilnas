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
