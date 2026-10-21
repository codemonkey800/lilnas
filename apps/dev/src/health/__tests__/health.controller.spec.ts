import { HealthController } from 'src/health/health.controller'

describe('HealthController', () => {
  it('reports ok', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' })
  })
})
