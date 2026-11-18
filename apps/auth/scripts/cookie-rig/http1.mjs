// HTTP/1.1 transport for the cookie rig client. Plain Node, no dependencies.
// Kept apart from client.mjs (which reads the mint file and runs the matrix on
// import) so it can be tested on its own: __tests__/http1.spec.mjs.
//
// The request is written by hand over net/tls. Node's http.request joins an
// array-valued `cookie` header into one '; '-separated header, so it cannot
// send the two `Cookie:` lines a split-cookie case needs. Here every element
// of an array value becomes its own header line.

import net from 'node:net'
import tls from 'node:tls'

const TIMEOUT_MS = 15000

function buildHead(method, host, headers, body) {
  const lines = [`${method} /json HTTP/1.1`, `Host: ${host}`]
  let cookieLines = 0
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      lines.push(`${name}: ${item}`)
      if (name.toLowerCase() === 'cookie') cookieLines += 1
    }
  }
  if (body !== undefined) lines.push(`Content-Length: ${body.length}`)
  lines.push('Connection: close')
  return { head: `${lines.join('\r\n')}\r\n\r\n`, cookieLines }
}

function decodeChunked(buffer) {
  const parts = []
  let offset = 0
  for (;;) {
    const lineEnd = buffer.indexOf('\r\n', offset)
    if (lineEnd === -1) throw new Error('truncated chunked body')
    const size = parseInt(buffer.toString('latin1', offset, lineEnd), 16)
    if (Number.isNaN(size)) throw new Error('bad chunk size')
    if (size === 0) return Buffer.concat(parts)
    const start = lineEnd + 2
    if (buffer.length < start + size) throw new Error('truncated chunked body')
    parts.push(buffer.subarray(start, start + size))
    offset = start + size + 2
  }
}

function parseResponse(raw) {
  const headerEnd = raw.indexOf('\r\n\r\n')
  if (headerEnd === -1) throw new Error('no response head')
  const [statusLine, ...headerLines] = raw
    .subarray(0, headerEnd)
    .toString('latin1')
    .split('\r\n')
  const headers = {}
  for (const line of headerLines) {
    const colon = line.indexOf(':')
    const name = line.slice(0, colon).toLowerCase()
    const value = line.slice(colon + 1).trim()
    headers[name] = name in headers ? `${headers[name]}, ${value}` : value
  }
  const rest = raw.subarray(headerEnd + 4)
  const body = /chunked/i.test(headers['transfer-encoding'] ?? '')
    ? decodeChunked(rest)
    : rest
  return {
    status: Number(statusLine.split(' ')[1]),
    headers,
    text: body.toString('utf8'),
  }
}

export function requestHttp1(
  secure,
  host,
  { method = 'GET', headers = {}, body },
  { port = secure ? 443 : 80, connectHost = host } = {},
) {
  const { head, cookieLines } = buildHead(method, host, headers, body)
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({
          host: connectHost,
          port,
          servername: host,
          rejectUnauthorized: false,
          ALPNProtocols: ['http/1.1'],
        })
      : net.connect(port, connectHost)
    const chunks = []
    const timer = setTimeout(
      () => socket.destroy(new Error('request timed out')),
      TIMEOUT_MS,
    )
    const settle = (fn, value) => {
      clearTimeout(timer)
      fn(value)
    }
    socket.on('error', err => settle(reject, err))
    socket.on(secure ? 'secureConnect' : 'connect', () => {
      socket.write(head)
      if (body !== undefined) socket.write(body)
    })
    socket.on('data', chunk => chunks.push(chunk))
    socket.on('close', () => {
      try {
        settle(resolve, {
          ...parseResponse(Buffer.concat(chunks)),
          protocol: secure
            ? socket.alpnProtocol || 'none'
            : 'http/1.1 (cleartext)',
          cookieLinesSent: cookieLines,
        })
      } catch (err) {
        settle(reject, err)
      }
    })
  })
}
