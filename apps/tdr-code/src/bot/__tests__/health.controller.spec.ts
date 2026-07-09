import { Test } from '@nestjs/testing'

import { HealthController } from 'src/bot/health.controller'
import { DB } from 'src/db/database.module'

describe('HealthController', () => {
  it('returns { ok: true } when DB responds', () => {
    const mockDb = {
      get: jest.fn().mockReturnValue({ 1: 1 }),
    }

    const controller = new HealthController(mockDb as never)
    const result = controller.health()

    expect(result).toEqual({ ok: true })
    expect(mockDb.get).toHaveBeenCalled()
  })

  it('propagates DB error (SQLite locked or corrupt → 500)', () => {
    const mockDb = {
      get: jest.fn().mockImplementation(() => {
        throw new Error('SQLITE_BUSY: database is locked')
      }),
    }

    const controller = new HealthController(mockDb as never)
    expect(() => controller.health()).toThrow('SQLITE_BUSY')
  })

  it('can be resolved via NestJS DI', async () => {
    const mockDb = { get: jest.fn().mockReturnValue({}) }

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DB, useValue: mockDb }],
    }).compile()

    const controller = module.get(HealthController)
    expect(controller.health()).toEqual({ ok: true })
  })
})
