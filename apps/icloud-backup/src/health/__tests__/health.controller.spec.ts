import { Controller, Get, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AuthModule } from 'src/auth/auth.module'
import { HealthModule } from 'src/health/health.module'

@Controller('guarded')
class GuardedController {
  @Get()
  get() {
    return { ok: true }
  }
}

describe('GET /health', () => {
  let app: INestApplication
  let base: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule, AuthModule],
      controllers: [GuardedController],
    }).compile()
    app = moduleRef.createNestApplication()
    await app.listen(0, '127.0.0.1')
    base = await app.getUrl()
  })

  afterAll(async () => {
    await app.close()
  })

  it('answers { status: "ok" } without any identity headers', async () => {
    const res = await fetch(`${base}/health`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('is the only unguarded route: any other route is a 401 without headers', async () => {
    const res = await fetch(`${base}/guarded`)

    expect(res.status).toBe(401)
  })

  it('serves a guarded route when both identity headers are present', async () => {
    const res = await fetch(`${base}/guarded`, {
      headers: {
        'x-forwarded-user': 'alice@example.com',
        'x-forwarded-user-id': 'user_1',
      },
    })

    expect(res.status).toBe(200)
  })
})
