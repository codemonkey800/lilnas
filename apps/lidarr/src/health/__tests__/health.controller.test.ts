import { Test, TestingModule } from '@nestjs/testing'

import { HealthController } from 'src/health/health.controller'

describe('HealthController', () => {
  let controller: HealthController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile()

    controller = module.get(HealthController)
  })

  describe('health', () => {
    it('returns status ok', () => {
      const result = controller.health()
      expect(result.status).toBe('ok')
    })

    it('returns a valid ISO timestamp', () => {
      const result = controller.health()
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp)
    })

    it('returns both status and timestamp fields', () => {
      const result = controller.health()
      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('timestamp')
    })
  })
})
