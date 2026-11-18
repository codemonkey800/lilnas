// The rig's HTTP/1.1 transport must put split cookies on the wire as separate
// `Cookie:` lines. Node's http.request joins a `cookie: [a, b]` array into one
// '; '-separated header, which made case 8 of the matrix a no-op on h1.
import net from 'node:net'

import { requestHttp1 } from '../http1.mjs'

const RESPONSE_BODY = '{"ok":true}'

// Raw TCP server: records the bytes of the request head, then answers with
// the given response and closes.
function captureServer(response) {
  const state = { head: '' }
  const server = net.createServer(socket => {
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk.toString('latin1')
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) return
      state.head = buffer.slice(0, end)
      socket.end(response)
    })
  })
  const listening = new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
  return { state, server, listening }
}

const OK_RESPONSE = [
  'HTTP/1.1 200 OK',
  'Content-Type: application/json',
  `Content-Length: ${RESPONSE_BODY.length}`,
  'Connection: close',
  '',
  RESPONSE_BODY,
].join('\r\n')

// Header names are case-insensitive on the wire; normalise the name only.
function cookieLines(head) {
  return head
    .split('\r\n')
    .filter(line => line.toLowerCase().startsWith('cookie:'))
    .map(line => `Cookie:${line.slice('cookie:'.length)}`)
}

describe('requestHttp1', () => {
  let capture

  afterEach(() => {
    capture?.server.close()
  })

  it('writes an array-valued cookie header as separate Cookie lines', async () => {
    capture = captureServer(OK_RESPONSE)
    const port = await capture.listening

    const res = await requestHttp1(
      false,
      'gated.rig.test',
      { headers: { cookie: ['theme=dark; a=b', 'lang=en'] } },
      { port, connectHost: '127.0.0.1' },
    )

    expect(res.status).toBe(200)
    expect(res.text).toBe(RESPONSE_BODY)
    expect(cookieLines(capture.state.head)).toEqual([
      'Cookie: theme=dark; a=b',
      'Cookie: lang=en',
    ])
    expect(res.cookieLinesSent).toBe(2)
  })

  it('still sends a string cookie header as one line', async () => {
    capture = captureServer(OK_RESPONSE)
    const port = await capture.listening

    const res = await requestHttp1(
      false,
      'gated.rig.test',
      { headers: { cookie: 'theme=dark; a=b' } },
      { port, connectHost: '127.0.0.1' },
    )

    expect(cookieLines(capture.state.head)).toEqual(['Cookie: theme=dark; a=b'])
    expect(res.cookieLinesSent).toBe(1)
  })

  it('sends the Host header and decodes a chunked response', async () => {
    capture = captureServer(
      [
        'HTTP/1.1 200 OK',
        'Transfer-Encoding: chunked',
        'Connection: close',
        '',
        '4',
        RESPONSE_BODY.slice(0, 4),
        `${RESPONSE_BODY.length - 4}`,
        RESPONSE_BODY.slice(4),
        '0',
        '',
        '',
      ].join('\r\n'),
    )
    const port = await capture.listening

    const res = await requestHttp1(
      false,
      'gated.rig.test',
      { headers: { cookie: ['a=1', 'b=2'] } },
      { port, connectHost: '127.0.0.1' },
    )

    expect(capture.state.head.toLowerCase()).toContain('host: gated.rig.test')
    expect(res.status).toBe(200)
    expect(res.text).toBe(RESPONSE_BODY)
  })
})
