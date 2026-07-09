import { healthResponse, healthStatusCode } from 'src/health'

describe('healthResponse', () => {
  it('returns ok / 200 with no deps', async () => {
    const result = await healthResponse({ service: 'swole' })
    expect(result.status).toBe('ok')
    expect(result.service).toBe('swole')
    expect(result.deps).toBeUndefined()
    expect(healthStatusCode(result)).toBe(200)
  })

  it('returns ok / 200 when all dep probes pass', async () => {
    const result = await healthResponse({
      service: 'swole',
      deps: { db: async () => true },
    })
    expect(result.status).toBe('ok')
    expect(result.deps?.db).toBe('ok')
    expect(healthStatusCode(result)).toBe(200)
  })

  it('flips status to degraded / 503 when a probe throws', async () => {
    const result = await healthResponse({
      service: 'swole',
      deps: {
        sqlite: () => {
          throw new Error('db closed')
        },
      },
    })
    expect(result.status).toBe('degraded')
    expect(result.deps?.sqlite).toBe('degraded')
    expect(healthStatusCode(result)).toBe(503)
  })

  it('marks only the failing dep degraded when mixed probes', async () => {
    const result = await healthResponse({
      service: 'swole',
      deps: {
        healthy: async () => undefined,
        broken: () => {
          throw new Error('fail')
        },
      },
    })
    expect(result.status).toBe('degraded')
    expect(result.deps?.healthy).toBe('ok')
    expect(result.deps?.broken).toBe('degraded')
    expect(healthStatusCode(result)).toBe(503)
  })
})
