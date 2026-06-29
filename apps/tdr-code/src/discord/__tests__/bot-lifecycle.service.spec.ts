import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import {
  finalize,
  insertGeneration,
  markRunning,
} from 'src/db/bot-generation.repo'
import { DB } from 'src/db/database.module'
import { createTestDb } from 'src/db/test-db'
import { BotLifecycleService } from 'src/discord/bot-lifecycle.service'
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

async function buildService(db: ReturnType<typeof createTestDb>['db']) {
  const module = await Test.createTestingModule({
    providers: [
      BotLifecycleService,
      { provide: DB, useValue: db },
      { provide: PinoLogger, useValue: makeLogger() },
    ],
  }).compile()
  return module.get(BotLifecycleService)
}

describe('BotLifecycleService', () => {
  let testDb: ReturnType<typeof createTestDb>

  beforeEach(() => {
    testDb = createTestDb()
    delete process.env[EnvKeys.BOT_GENERATION_ID]
  })

  afterEach(() => {
    testDb.close()
    delete process.env[EnvKeys.BOT_GENERATION_ID]
  })

  it('no BOT_GENERATION_ID → inactive (no crash)', async () => {
    const svc = await buildService(testDb.db)
    await expect(svc.onModuleInit()).resolves.not.toThrow()
  })

  it('onReady marks generation running and arms heartbeat', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)
    process.env[EnvKeys.BOT_HEARTBEAT_MS] = '50'

    const svc = await buildService(testDb.db)
    await svc.onModuleInit()

    // Simulate Discord ready event
    svc.onReady()

    // Give heartbeat time to fire.
    await new Promise(r => setTimeout(r, 100))

    const { generationById } = await import('src/db/bot-generation.repo')
    const row = generationById(testDb.db, gen.id)!
    expect(row.status).toBe('running')
    expect(row.lastHeartbeatAt).not.toBeNull()

    svc.onModuleDestroy()
  })

  it('onReady after shutdown flag is set → no markRunning', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)

    const svc = await buildService(testDb.db)
    await svc.onModuleInit()
    svc.markShutdownRequested()
    svc.onReady()

    const { generationById } = await import('src/db/bot-generation.repo')
    const row = generationById(testDb.db, gen.id)!
    // Should still be 'starting' — markRunning was not called.
    expect(row.status).toBe('starting')
  })

  it('heartbeat stops when supervisor finalizes generation (0 changes)', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)
    process.env[EnvKeys.BOT_HEARTBEAT_MS] = '30'

    const svc = await buildService(testDb.db)
    await svc.onModuleInit()
    svc.onReady()

    // Wait for markRunning to propagate.
    await new Promise(r => setTimeout(r, 40))

    // Finalize the generation externally (simulating supervisor).
    finalize(testDb.db, gen.id, 'stopped', 0, new Date())

    // Wait for next heartbeat tick — it should stop.
    await new Promise(r => setTimeout(r, 80))

    const { generationById } = await import('src/db/bot-generation.repo')
    const row = generationById(testDb.db, gen.id)!
    expect(row.status).toBe('stopped')
    // No more heartbeat updates after finalize.
    svc.onModuleDestroy()
  })

  it('finalizeGeneration marks the generation stopped', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)

    const svc = await buildService(testDb.db)
    await svc.onModuleInit()
    svc.finalizeGeneration(0)

    const { generationById } = await import('src/db/bot-generation.repo')
    const row = generationById(testDb.db, gen.id)!
    expect(row.status).toBe('stopped')
    expect(row.endedAt).not.toBeNull()
  })

  it('boot guard: terminal generation → process.exit(1)', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    finalize(testDb.db, gen.id, 'crashed', 1, new Date())
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)

    const svc = await buildService(testDb.db)
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(svc.onModuleInit()).rejects.toThrow('process.exit called')
    mockExit.mockRestore()
  })

  it('boot guard: running with different pid → process.exit(1)', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    markRunning(testDb.db, gen.id, process.pid + 1, new Date())
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)

    const svc = await buildService(testDb.db)
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(svc.onModuleInit()).rejects.toThrow('process.exit called')
    mockExit.mockRestore()
  })
})
