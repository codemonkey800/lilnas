import { IncomingMessage, ServerResponse } from 'http'
import { Socket } from 'net'
import { pinoHttp } from 'pino-http'
import { Writable } from 'stream'

import { pinoHttpOptions } from 'src/logger.config'

const SECRETS = ['hunter2', '654321', 'key-abc', 'cookie-value', 'bearer-tok']

describe('pinoHttpOptions redaction', () => {
  it('keeps passwords, codes, API keys, cookies and bodies out of every log line', () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk))
        done()
      },
    })
    const http = pinoHttp({ ...pinoHttpOptions, level: 'info', stream })

    const req = new IncomingMessage(new Socket())
    req.url = '/api/backup/password'
    req.method = 'POST'
    req.headers = {
      cookie: 'session=cookie-value',
      authorization: 'Bearer bearer-tok',
    }
    ;(req as IncomingMessage & { body: unknown }).body = {
      password: 'hunter2',
    }
    const res = new ServerResponse(req)

    http(req, res)
    req.log.info(
      {
        password: 'hunter2',
        body: { code: '654321' },
        nested: { deep: { apiKey: 'key-abc' } },
      },
      'handling request',
    )
    res.end()

    const output = lines.join('\n')
    expect(output).toContain('handling request')
    expect(output).toContain('[Redacted]')
    for (const secret of SECRETS) {
      expect(output).not.toContain(secret)
    }
  })
})
