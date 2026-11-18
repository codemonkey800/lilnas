import http from 'node:http'

import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { AppModule } from 'src/app.module'
import * as stripModule from 'src/verify/strip-auth-cookies'
import { StripCookieController } from 'src/verify/strip-cookie.controller'

// Drives the controller through a real Nest app over real HTTP, like the
// "VerifyController integration" block in verify.service.spec.ts. The module
// provides ONLY a logger: the controller must work with no session lookup,
// database, GatedHostsService or HostActivityService.

jest.mock('src/verify/strip-auth-cookies', () => {
  const actual = jest.requireActual<
    typeof import('src/verify/strip-auth-cookies')
  >('src/verify/strip-auth-cookies')
  return { ...actual, stripAuthCookies: jest.fn(actual.stripAuthCookies) }
})

const SECRET = 'super-secret-cookie-value'

const strip = jest.mocked(stripModule.stripAuthCookies)
const realStrip = jest.requireActual<typeof stripModule>(
  'src/verify/strip-auth-cookies',
).stripAuthCookies

beforeEach(() => {
  strip.mockReset()
  strip.mockImplementation(realStrip)
})

type HttpResult = {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

function httpRequest(
  port: number,
  method: string,
  headers: Record<string, string>,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: '/strip-cookie', headers },
      res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (body += chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('StripCookieController (real NestJS app, real HTTP)', () => {
  const logger = { warn: jest.fn() }
  let app: Awaited<ReturnType<typeof startApp>>['app']
  let port: number

  async function startApp() {
    const moduleRef = await Test.createTestingModule({
      controllers: [StripCookieController],
      providers: [{ provide: PinoLogger, useValue: logger }],
    }).compile()
    const nestApp = moduleRef.createNestApplication({ bodyParser: false })
    await nestApp.init()
    await nestApp.listen(0, '127.0.0.1')
    const address = nestApp.getHttpServer().address()
    if (address === null || typeof address === 'string') {
      throw new Error('expected app to listen on a resolved TCP address')
    }
    return { app: nestApp, port: address.port }
  }

  beforeAll(async () => {
    ;({ app, port } = await startApp())
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    logger.warn.mockReset()
  })

  it('answers 200 with an empty body and no Cookie header when the request has no cookie', async () => {
    const res = await httpRequest(port, 'GET', {})

    expect(res.status).toBe(200)
    expect(res.body).toBe('')
    expect(res.headers).not.toHaveProperty('cookie')
  })

  it('returns the other cookies when a lilnas-auth session cookie is sent with them', async () => {
    const res = await httpRequest(port, 'GET', {
      cookie: 'a=1; lilnas-auth.session_token=tok; b=2',
    })

    expect(res.status).toBe(200)
    expect(res.body).toBe('')
    expect(res.headers.cookie).toBe('a=1; b=2')
  })

  it('strips the https-prefixed lilnas-auth session cookie too', async () => {
    const res = await httpRequest(port, 'GET', {
      cookie: '__Secure-lilnas-auth.session_token=tok; a=1',
    })

    expect(res.status).toBe(200)
    expect(res.headers.cookie).toBe('a=1')
  })

  it('sends no Cookie header when only the lilnas-auth session cookie was sent', async () => {
    const res = await httpRequest(port, 'GET', {
      cookie: 'lilnas-auth.session_token=tok',
    })

    expect(res.status).toBe(200)
    expect(res.headers).not.toHaveProperty('cookie')
  })

  it("preserves another app's __Secure-better-auth.session_token cookie", async () => {
    const res = await httpRequest(port, 'GET', {
      cookie:
        '__Secure-better-auth.session_token=x; lilnas-auth.session_token=tok',
    })

    expect(res.status).toBe(200)
    expect(res.headers.cookie).toBe('__Secure-better-auth.session_token=x')
  })

  it.each(['GET', 'POST'])('answers 200 to %s', async method => {
    const res = await httpRequest(port, method, { cookie: 'a=1' })

    expect(res.status).toBe(200)
    expect(res.headers.cookie).toBe('a=1')
  })

  it('answers 200 with no Cookie header and a content-free warning when sanitizing throws', async () => {
    strip.mockImplementation(() => {
      throw new Error(`boom ${SECRET}`)
    })

    const res = await httpRequest(port, 'GET', { cookie: `a=${SECRET}` })

    expect(res.status).toBe(200)
    expect(res.headers).not.toHaveProperty('cookie')
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(SECRET)
  })
})

describe('StripCookieController wiring', () => {
  it('is registered on the real AppModule', () => {
    const controllers: unknown[] =
      Reflect.getMetadata('controllers', AppModule) ?? []

    expect(controllers).toContain(StripCookieController)
  })

  it('injects only the logger: no gated-hosts or host-activity service', () => {
    const paramTypes: unknown[] =
      Reflect.getMetadata('design:paramtypes', StripCookieController) ?? []

    expect(paramTypes).toEqual([PinoLogger])
  })

  it('is mounted at /strip-cookie', () => {
    expect(Reflect.getMetadata('path', StripCookieController)).toBe(
      'strip-cookie',
    )
  })
})
