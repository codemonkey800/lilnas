import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import {
  finalize,
  generationById,
  insertGeneration,
  markRunning,
  markStopping,
} from 'src/db/bot-generation.repo'
import { DB } from 'src/db/database.module'
import { createTestDb } from 'src/db/test-db'
import { BotLifecycleService } from 'src/discord/bot-lifecycle.service'
import { NotifyEmitterService } from 'src/discord/notify-emitter.service'
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

function makeNotifyEmitterMock(): jest.Mocked<
  Pick<NotifyEmitterService, 'notify'>
> {
  return { notify: jest.fn() }
}

async function buildService(
  db: ReturnType<typeof createTestDb>['db'],
  notifyEmitter: Pick<NotifyEmitterService, 'notify'> = makeNotifyEmitterMock(),
) {
  const module = await Test.createTestingModule({
    providers: [
      BotLifecycleService,
      { provide: DB, useValue: db },
      { provide: PinoLogger, useValue: makeLogger() },
      { provide: NotifyEmitterService, useValue: notifyEmitter },
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

  it('BOT_GENERATION_ID is not a valid integer → process.exit(1)', async () => {
    process.env[EnvKeys.BOT_GENERATION_ID] = 'abc'

    const svc = await buildService(testDb.db)
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    await expect(svc.onModuleInit()).rejects.toThrow('process.exit called')
    mockExit.mockRestore()
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

    const { generationById: getById } = await import(
      'src/db/bot-generation.repo'
    )
    const row = getById(testDb.db, gen.id)!
    expect(row.status).toBe('running')
    expect(row.lastHeartbeatAt).not.toBeNull()

    svc.onModuleDestroy()
  })

  it('U3: onReady notifies bot-status after markRunning succeeds, and each heartbeat notifies again', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)
    process.env[EnvKeys.BOT_HEARTBEAT_MS] = '30'

    const notifyEmitter = makeNotifyEmitterMock()
    const svc = await buildService(testDb.db, notifyEmitter)
    await svc.onModuleInit()

    svc.onReady()
    expect(notifyEmitter.notify).toHaveBeenCalledWith(['bot-status'])
    const callsAfterReady = notifyEmitter.notify.mock.calls.length

    // Give at least one heartbeat tick time to fire.
    await new Promise(r => setTimeout(r, 80))
    expect(notifyEmitter.notify.mock.calls.length).toBeGreaterThan(
      callsAfterReady,
    )
    // Every call so far was for the bot-status topic — heartbeat never
    // notifies any other topic.
    for (const call of notifyEmitter.notify.mock.calls) {
      expect(call[0]).toEqual(['bot-status'])
    }

    svc.onModuleDestroy()
  })

  it('U3: heartbeat affecting 0 rows (generation finalized) does not notify again', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)
    process.env[EnvKeys.BOT_HEARTBEAT_MS] = '30'

    const notifyEmitter = makeNotifyEmitterMock()
    const svc = await buildService(testDb.db, notifyEmitter)
    await svc.onModuleInit()
    svc.onReady()

    // Wait for markRunning to land, then finalize the generation externally
    // (simulating the supervisor) before the next heartbeat tick.
    await new Promise(r => setTimeout(r, 10))
    finalize(testDb.db, gen.id, 'stopped', 0, new Date())
    notifyEmitter.notify.mockClear()

    // Wait past the next heartbeat tick — it should stop, no more notifies.
    await new Promise(r => setTimeout(r, 80))
    expect(notifyEmitter.notify).not.toHaveBeenCalled()

    svc.onModuleDestroy()
  })

  it('onReady after shutdown flag is set → no markRunning', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)

    const svc = await buildService(testDb.db)
    await svc.onModuleInit()
    svc.markShutdownRequested()
    svc.onReady()

    const { generationById: getById } = await import(
      'src/db/bot-generation.repo'
    )
    const row = getById(testDb.db, gen.id)!
    // Should still be 'starting' — markRunning was not called.
    expect(row.status).toBe('starting')
  })

  it('onReady when generation is in stopping state → sends self SIGTERM (markRunning returns 0)', async () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    // Transition to stopping — markRunning will return 0 since status != 'starting'.
    markStopping(testDb.db, gen.id)
    process.env[EnvKeys.BOT_GENERATION_ID] = String(gen.id)

    const svc = await buildService(testDb.db)
    await svc.onModuleInit()

    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true)
    svc.onReady()

    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    killSpy.mockRestore()

    // Row should still be stopping — markRunning was a no-op.
    const row = generationById(testDb.db, gen.id)!
    expect(row.status).toBe('stopping')
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

    const { generationById: getById } = await import(
      'src/db/bot-generation.repo'
    )
    const row = getById(testDb.db, gen.id)!
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

    const { generationById: getById } = await import(
      'src/db/bot-generation.repo'
    )
    const row = getById(testDb.db, gen.id)!
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
