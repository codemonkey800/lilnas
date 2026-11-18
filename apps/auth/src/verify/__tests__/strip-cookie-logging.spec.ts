import http from 'node:http'
import { Writable } from 'node:stream'

import { All, Controller, Res } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Response } from 'express'
import { LoggerModule } from 'nestjs-pino'

import { pinoHttpOptions } from 'src/logger.config'
import { StripCookieController } from 'src/verify/strip-cookie.controller'

// Runs the app's real pino-http config (src/logger.config.ts) around the real
// StripCookieController. /strip-cookie answers with the KEPT cookies in a
// `cookie` response header, and pino-http's default res serializer logs
// res.getHeaders(), so without redaction that header would reach Loki.

const KEPT_COOKIE = 'kept-cookie-value-4f2a'
const STRIPPED_COOKIE = 'stripped-session-value-9c1d'

// Stand-in for any route that is NOT ignored by autoLogging, to show the
// redact path itself covers a `cookie` response header.
@Controller('echo-cookie')
class EchoCookieController {
  @All()
  echo(@Res() res: Response): void {
    res.setHeader('cookie', `a=${KEPT_COOKIE}`)
    res.status(200).end()
  }
}

function get(port: number, path: string, cookie: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path, headers: { cookie } },
      res => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('/strip-cookie logging (real LoggerModule config)', () => {
  const lines: string[] = []
  let app: Awaited<ReturnType<typeof startApp>>['app']
  let port: number

  async function startApp() {
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString('utf8'))
        cb()
      },
    })
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: [pinoHttpOptions, stream] })],
      controllers: [StripCookieController, EchoCookieController],
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
    lines.length = 0
  })

  it('never writes a cookie value to the log for a /strip-cookie request', async () => {
    const status = await get(
      port,
      '/strip-cookie',
      `__Secure-better-auth.session_token=${KEPT_COOKIE}; lilnas-auth.session_token=${STRIPPED_COOKIE}`,
    )

    expect(status).toBe(200)
    const output = lines.join('')
    expect(output).not.toContain(KEPT_COOKIE)
    expect(output).not.toContain(STRIPPED_COOKIE)
  })

  it('emits no completion line for /strip-cookie, like /verify and /health', async () => {
    await get(port, '/strip-cookie', 'a=1')

    expect(lines.join('')).not.toContain('request completed')
  })

  it('redacts a cookie response header on a route that is logged', async () => {
    await get(port, '/echo-cookie', `a=${STRIPPED_COOKIE}`)

    const output = lines.join('')
    expect(output).toContain('request completed')
    expect(output).not.toContain(KEPT_COOKIE)
    expect(output).not.toContain(STRIPPED_COOKIE)
    expect(output).toContain('[Redacted]')
  })
})
