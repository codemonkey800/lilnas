// HTTP + WebSocket echo server for checking what Cookie header (and which
// identity headers) a backend receives behind Traefik. Plain Node, no
// dependencies. See README.md.
//
//   GET|POST /json  the request as the backend saw it
//   GET /           a page that fetches /json, opens a WebSocket to /ws and
//                   shows one PASS/FAIL banner
//   /ws             a hand-rolled WebSocket upgrade: one text frame with the
//                   same JSON for the upgrade request, then a close frame
//
// It never logs a cookie and returns a cookie, Authorization or X-Emby-Token
// value only when ECHO_VALUES=1 (otherwise only whether the last two arrived).

import { createHash } from 'node:crypto'
import http from 'node:http'

const PORT = Number(process.env.PORT ?? 3000)
const ECHO_VALUES = process.env.ECHO_VALUES === '1'
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const AUTH_COOKIE_PREFIXES = ['lilnas-auth.', '__Secure-lilnas-auth.']

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value
}

function splitCookies(cookieHeader) {
  if (!cookieHeader) return []
  return cookieHeader
    .split(';')
    .map(pair => pair.trim())
    .filter(Boolean)
}

function cookieName(pair) {
  const separator = pair.indexOf('=')
  return (separator === -1 ? pair : pair.slice(0, separator)).trim()
}

// Counts Cookie header fields as received (Node joins repeated Cookie
// headers in req.headers, but rawHeaders keeps every one).
function countCookieHeaders(rawHeaders) {
  let count = 0
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === 'cookie') count += 1
  }
  return count
}

function describe(req) {
  const pairs = splitCookies(req.headers.cookie)
  const cookieNames = pairs.map(cookieName)
  const payload = {
    httpVersion: req.httpVersion,
    method: req.method,
    cookieNames,
    authCookiePresent: cookieNames.some(name =>
      AUTH_COOKIE_PREFIXES.some(prefix => name.startsWith(prefix)),
    ),
    forwardedUser: firstValue(req.headers['x-forwarded-user']) ?? null,
    forwardedUserId: firstValue(req.headers['x-forwarded-user-id']) ?? null,
    cookieHeaderCount: countCookieHeaders(req.rawHeaders),
    authorizationPresent: req.headers.authorization !== undefined,
    embyTokenPresent: req.headers['x-emby-token'] !== undefined,
  }
  if (ECHO_VALUES) {
    payload.cookies = pairs
    payload.authorization = req.headers.authorization ?? null
    payload.embyToken = firstValue(req.headers['x-emby-token']) ?? null
  }
  return payload
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    let bytes = 0
    req.on('data', chunk => {
      bytes += chunk.length
      hash.update(chunk)
    })
    req.on('end', () =>
      resolve({ bodyBytes: bytes, bodySha256: hash.digest('hex') }),
    )
    req.on('error', reject)
  })
}

function textFrame(text) {
  const payload = Buffer.from(text)
  const length = payload.length
  let header
  if (length < 126) {
    header = Buffer.from([0x81, length])
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  return Buffer.concat([header, payload])
}

// Close frame, status 1000.
const CLOSE_FRAME = Buffer.from([0x88, 0x02, 0x03, 0xe8])

// The page builds every node with textContent: cookie names are client
// controlled and must never be parsed as HTML.
const PAGE = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>cookie echo</title></head>
<body style="font-family: monospace">
<div id="banner" style="padding: 12px; font-size: 20px; background: #ccc">…</div>
<pre id="detail"></pre>
<script>
function show(id, text) {
  document.getElementById(id).textContent = text
}
function openSocket() {
  return new Promise(function (resolve, reject) {
    var scheme = location.protocol === 'https:' ? 'wss://' : 'ws://'
    var socket = new WebSocket(scheme + location.host + '/ws')
    var timer = setTimeout(function () {
      reject(new Error('websocket timed out'))
    }, 5000)
    socket.onmessage = function (event) {
      clearTimeout(timer)
      resolve(JSON.parse(event.data))
    }
    socket.onerror = function () {
      clearTimeout(timer)
      reject(new Error('websocket failed'))
    }
  })
}
async function run() {
  var navigation = performance.getEntriesByType('navigation')[0]
  var lines = ['nextHopProtocol: ' + (navigation ? navigation.nextHopProtocol : 'n/a')]
  var failed = false
  try {
    var http = await (await fetch('/json', { credentials: 'same-origin' })).json()
    failed = failed || http.authCookiePresent
    lines.push('http cookie names: ' + (http.cookieNames.join(', ') || '(none)'))
    lines.push('http X-Forwarded-User: ' + http.forwardedUser)
  } catch (err) {
    failed = true
    lines.push('http error: ' + err.message)
  }
  try {
    var ws = await openSocket()
    failed = failed || ws.authCookiePresent
    lines.push('ws cookie names: ' + (ws.cookieNames.join(', ') || '(none)'))
    lines.push('ws X-Forwarded-User: ' + ws.forwardedUser)
  } catch (err) {
    failed = true
    lines.push('ws error: ' + err.message)
  }
  var banner = document.getElementById('banner')
  banner.textContent = failed ? 'FAIL' : 'PASS'
  banner.style.background = failed ? '#f99' : '#9f9'
  show('detail', lines.join('\\n'))
}
run()
</script>
</body>
</html>
`

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://echo')
  if (pathname === '/json') {
    const body =
      req.method === 'GET' || req.method === 'HEAD' ? {} : await readBody(req)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ...describe(req), ...body }))
    return
  }
  if (pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.on('upgrade', (req, socket) => {
  const { pathname } = new URL(req.url ?? '/', 'http://echo')
  const key = firstValue(req.headers['sec-websocket-key'])
  if (pathname !== '/ws' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    return
  }
  const accept = createHash('sha1')
    .update(key + WS_GUID)
    .digest('base64')
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'),
  )
  socket.write(textFrame(JSON.stringify(describe(req))))
  socket.end(CLOSE_FRAME)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `echo listening on :${PORT} (values ${ECHO_VALUES ? 'on' : 'off'})`,
  )
})
