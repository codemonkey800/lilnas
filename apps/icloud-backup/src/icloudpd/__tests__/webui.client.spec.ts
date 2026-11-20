import { readFileSync } from 'node:fs'
import { createServer, IncomingMessage, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { join } from 'node:path'

import { Logger } from '@nestjs/common'

import { FormStep, parseFragment, WebuiClient } from 'src/icloudpd/webui.client'

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', `${name}.html`), 'utf8')
}

describe('parseFragment', () => {
  it.each<[string, FormStep]>([
    ['password', { step: 'need_password', error: null }],
    ['password-error', { step: 'need_password', error: 'Invalid password' }],
    ['checking-password', { step: 'checking_password' }],
    ['code', { step: 'need_code', error: null }],
    [
      'code-error',
      {
        step: 'need_code',
        error: 'Failed to verify two-factor authentication code',
      },
    ],
    ['checking-mfa', { step: 'checking_code' }],
    ['no-input', { step: 'no_input' }],
    ['no-input-error', { step: 'no_input' }],
  ])('reads the %s fragment', (name, step) => {
    expect(parseFragment(fixture(name))).toEqual(step)
  })

  it('decodes HTML entities in an error', () => {
    const html = fixture('code-error').replace(
      'Failed to verify two-factor authentication code',
      'Can&#39;t verify &lt;code&gt; &amp; retry',
    )
    expect(parseFragment(html)).toEqual({
      step: 'need_code',
      error: "Can't verify <code> & retry",
    })
  })

  it('treats garbage as unknown, with a snippet that has no <input> tag', () => {
    const step = parseFragment(fixture('garbage'))
    expect(step.step).toBe('unknown')
    if (step.step !== 'unknown') throw new Error('unreachable')
    expect(step.snippet).toContain('502 Bad Gateway')
    expect(step.snippet).not.toMatch(/<input/i)
    expect(step.snippet).not.toContain('hunter2')
  })

  it.each([
    ['', ''],
    ['plain text', 'plain text'],
  ])('treats %j as unknown', (html, snippet) => {
    expect(parseFragment(html)).toEqual({ step: 'unknown', snippet })
  })

  it('caps the snippet at 200 characters, after removing inputs', () => {
    const html = `<input type="password" value="a>b">${'x'.repeat(500)}`
    const step = parseFragment(html)
    if (step.step !== 'unknown') throw new Error('expected unknown')
    expect(step.snippet).toBe('x'.repeat(200))
  })

  it('drops an <input> tag that is never closed', () => {
    const step = parseFragment('<p>hi</p><input value="hunter2')
    if (step.step !== 'unknown') throw new Error('expected unknown')
    expect(step.snippet).toBe('<p>hi</p>')
  })
})

describe('WebuiClient', () => {
  interface Post {
    path: string
    contentType: string | undefined
    body: string
  }

  const PASSWORD = 'p@ss w0rd&=secret'
  const CODE = '123456'

  let server: Server
  let url: string
  let statusHtml: string
  let postStatus: number
  let posts: Post[]
  const client = new WebuiClient()
  const originalEnv = { ...process.env }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise(resolve => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(statusHtml)
        return
      }
      void readBody(req).then(body => {
        posts.push({
          path: req.url ?? '',
          contentType: req.headers['content-type'],
          body,
        })
        res.writeHead(postStatus).end('<div>submitted</div>')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  beforeEach(() => {
    statusHtml = fixture('password')
    postStatus = 200
    posts = []
    process.env.ICLOUDPD_WEBUI_URL = url
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('getStep', () => {
    it('reads the live /status fragment', async () => {
      expect(await client.getStep()).toEqual({
        step: 'need_password',
        error: null,
      })

      statusHtml = fixture('code-error')
      expect(await client.getStep()).toEqual({
        step: 'need_code',
        error: 'Failed to verify two-factor authentication code',
      })
    })

    it('reports a refused connection as unreachable', async () => {
      const closed = createServer()
      await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve))
      const port = (closed.address() as AddressInfo).port
      await new Promise<void>(resolve => closed.close(() => resolve()))
      process.env.ICLOUDPD_WEBUI_URL = `http://127.0.0.1:${port}`

      await expect(client.getStep()).resolves.toEqual({ step: 'unreachable' })
    })

    it('tolerates a trailing slash in the base URL', async () => {
      process.env.ICLOUDPD_WEBUI_URL = `${url}/`
      expect((await client.getStep()).step).toBe('need_password')
    })
  })

  describe('submitPassword', () => {
    it('posts a form-encoded password field during the password step', async () => {
      await expect(client.submitPassword(PASSWORD)).resolves.toBe('accepted')

      expect(posts).toHaveLength(1)
      expect(posts[0]?.path).toBe('/password')
      expect(posts[0]?.contentType).toBe('application/x-www-form-urlencoded')
      const form = new URLSearchParams(posts[0]?.body ?? '')
      expect([...form.keys()]).toEqual(['password'])
      expect(form.get('password')).toBe(PASSWORD)
    })

    it.each([
      'code',
      'checking-password',
      'checking-mfa',
      'no-input',
      'garbage',
    ])('posts nothing during the %s step', async name => {
      statusHtml = fixture(name)
      await expect(client.submitPassword(PASSWORD)).resolves.toBe('wrong_step')
      expect(posts).toEqual([])
    })

    it('reports a server error as rejected', async () => {
      postStatus = 500
      await expect(client.submitPassword(PASSWORD)).resolves.toBe('rejected')
    })
  })

  describe('submitCode', () => {
    it('posts a form-encoded code field during the code step', async () => {
      statusHtml = fixture('code')
      await expect(client.submitCode(CODE)).resolves.toBe('accepted')

      expect(posts).toHaveLength(1)
      expect(posts[0]?.path).toBe('/code')
      expect(posts[0]?.contentType).toBe('application/x-www-form-urlencoded')
      expect(new URLSearchParams(posts[0]?.body ?? '').get('code')).toBe(CODE)
    })

    it('posts nothing during the password step', async () => {
      statusHtml = fixture('password')
      await expect(client.submitCode(CODE)).resolves.toBe('wrong_step')
      expect(posts).toEqual([])
    })

    it('can answer again after a wrong code shows the form once more', async () => {
      statusHtml = fixture('code-error')
      await expect(client.submitCode(CODE)).resolves.toBe('accepted')
    })
  })

  it('does not post when the server is unreachable', async () => {
    process.env.ICLOUDPD_WEBUI_URL = 'http://127.0.0.1:1'
    await expect(client.submitPassword(PASSWORD)).resolves.toBe('wrong_step')
    await expect(client.submitCode(CODE)).resolves.toBe('wrong_step')
    expect(posts).toEqual([])
  })

  describe('cancel', () => {
    it('posts to /cancel', async () => {
      await client.cancel()
      expect(posts.map(p => p.path)).toEqual(['/cancel'])
    })

    it('does not throw when the server is gone', async () => {
      process.env.ICLOUDPD_WEBUI_URL = 'http://127.0.0.1:1'
      await expect(client.cancel()).resolves.toBeUndefined()
    })
  })

  describe('secrets', () => {
    it('never reaches a logger, whatever the outcome', async () => {
      const calls: unknown[][] = []
      const record =
        () =>
        (...args: unknown[]): void => {
          calls.push(args)
        }
      for (const method of [
        'log',
        'error',
        'warn',
        'debug',
        'verbose',
        'fatal',
      ] as const) {
        jest.spyOn(Logger.prototype, method).mockImplementation(record())
        jest.spyOn(Logger, method).mockImplementation(record())
      }
      for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        jest.spyOn(console, method).mockImplementation(record())
      }

      // accepted
      await client.submitPassword(PASSWORD)
      statusHtml = fixture('code')
      await client.submitCode(CODE)
      // wrong step
      await client.submitPassword(PASSWORD)
      // rejected
      postStatus = 500
      await client.submitCode(CODE)
      // unreachable
      process.env.ICLOUDPD_WEBUI_URL = 'http://127.0.0.1:1'
      await client.submitPassword(PASSWORD)
      await client.submitCode(CODE)

      expect(posts.length).toBeGreaterThan(0)
      const logged = JSON.stringify(calls)
      expect(logged).not.toContain(PASSWORD)
      expect(logged).not.toContain(encodeURIComponent(PASSWORD))
      expect(logged).not.toContain(CODE)
    })

    it('keeps the secret out of the unknown snippet when a page echoes it', async () => {
      statusHtml = `<p>oops</p><input name="password" value="${PASSWORD}">`
      const step = await client.getStep()
      expect(JSON.stringify(step)).not.toContain(PASSWORD)
      expect(step.step).toBe('unknown')
    })
  })
})
