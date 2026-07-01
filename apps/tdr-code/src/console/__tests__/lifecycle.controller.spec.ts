import { BadRequestException, ConflictException } from '@nestjs/common'

import { LifecycleController } from 'src/console/lifecycle.controller'
import {
  finalize,
  insertGeneration,
  markRunning,
} from 'src/db/bot-generation.repo'
import type { Db } from 'src/db/database.module'
import { createTestDb } from 'src/db/test-db'
import type { SupervisorService } from 'src/supervisor/supervisor.service'

// Minimal SupervisorService stub.
function makeStubSupervisor(
  opts: {
    supervise?: boolean
    phase?: string
  } = {},
): Pick<SupervisorService, 'requestRestart'> {
  const phase = opts.phase ?? 'Running'
  const supervise = opts.supervise ?? true
  return {
    requestRestart: jest
      .fn()
      .mockReturnValue(
        !supervise
          ? { error: 'not-supervised' }
          : phase === 'Stopping'
            ? { error: 'transition-in-progress' }
            : { phase: 'Stopping' },
      ),
  }
}

const ALLOWED =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

describe('LifecycleController.restart', () => {
  it('returns 202 with phase on success', () => {
    const sup = makeStubSupervisor()
    const ctrl = new LifecycleController({} as Db, sup as SupervisorService)
    const result = ctrl.restart(ALLOWED)
    expect(result.phase).toBe('Stopping')
  })

  it('throws ForbiddenException for wrong origin', () => {
    const sup = makeStubSupervisor()
    const ctrl = new LifecycleController({} as Db, sup as SupervisorService)
    const { ForbiddenException } = jest.requireActual(
      '@nestjs/common',
    ) as typeof import('@nestjs/common')
    expect(() => ctrl.restart('https://evil.lilnas.io')).toThrow(
      ForbiddenException,
    )
  })

  it('throws ForbiddenException when origin is absent', () => {
    const sup = makeStubSupervisor()
    const ctrl = new LifecycleController({} as Db, sup as SupervisorService)
    const { ForbiddenException } = jest.requireActual(
      '@nestjs/common',
    ) as typeof import('@nestjs/common')
    expect(() => ctrl.restart(undefined)).toThrow(ForbiddenException)
  })

  it('throws ConflictException when not-supervised', () => {
    const sup = makeStubSupervisor({ supervise: false })
    const ctrl = new LifecycleController({} as Db, sup as SupervisorService)
    expect(() => ctrl.restart(ALLOWED)).toThrow(ConflictException)
  })

  it('throws ConflictException when transition-in-progress', () => {
    const sup = makeStubSupervisor({ phase: 'Stopping' })
    const ctrl = new LifecycleController({} as Db, sup as SupervisorService)
    expect(() => ctrl.restart(ALLOWED)).toThrow(ConflictException)
  })
})

describe('LifecycleController.teardown', () => {
  let testDb: ReturnType<typeof createTestDb>

  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it('invalid snowflake → 400', () => {
    const sup = makeStubSupervisor()
    const ctrl = new LifecycleController(testDb.db, sup as SupervisorService)
    expect(() => ctrl.teardown(ALLOWED, 'not-a-snowflake')).toThrow(
      BadRequestException,
    )
  })

  it('no generation → 409 bot-offline', () => {
    const sup = makeStubSupervisor()
    const ctrl = new LifecycleController(testDb.db, sup as SupervisorService)
    expect(() => ctrl.teardown(ALLOWED, '123456789012345678')).toThrow(
      ConflictException,
    )
  })

  it('generation in Starting state → 409 bot-starting', () => {
    insertGeneration(testDb.db, { startedAt: new Date() })
    const sup = makeStubSupervisor()
    const ctrl = new LifecycleController(testDb.db, sup as SupervisorService)
    let err: ConflictException | null = null
    try {
      ctrl.teardown(ALLOWED, '123456789012345678')
    } catch (e) {
      err = e as ConflictException
    }
    expect(err).toBeInstanceOf(ConflictException)
    expect(err!.message).toBe('bot-starting')
  })

  it('running generation + valid snowflake → 202, enqueues command row', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    markRunning(testDb.db, gen.id, 1234, new Date())
    const sup = makeStubSupervisor()
    const ctrl = new LifecycleController(testDb.db, sup as SupervisorService)
    const result = ctrl.teardown(ALLOWED, '123456789012345678')
    expect(result.accepted).toBe(true)
  })

  it('ended generation → 409 bot-offline', () => {
    const gen = insertGeneration(testDb.db, { startedAt: new Date() })
    finalize(testDb.db, gen.id, 'stopped', 0, new Date())
    const sup = makeStubSupervisor()
    const ctrl = new LifecycleController(testDb.db, sup as SupervisorService)
    let err: ConflictException | null = null
    try {
      ctrl.teardown(ALLOWED, '123456789012345678')
    } catch (e) {
      err = e as ConflictException
    }
    expect(err).toBeInstanceOf(ConflictException)
    expect(err!.message).toContain('offline')
  })
})
