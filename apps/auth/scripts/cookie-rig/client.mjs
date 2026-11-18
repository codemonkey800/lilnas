// Test client for the cookie rig (rig.sh runs it in a container on the rig
// network). Plain Node, no dependencies.
//
//   node client.mjs ready   wait until the backend, echo and Traefik answer
//   node client.mjs matrix  run the matrix, print a markdown table, exit 1
//                           on any mismatch
//   node client.mjs down    with the echo backend stopped: record the status
//                           Traefik returns on the `open` route
//
// Reads the minted session from MINT_FILE (default /work/mint.json, the
// --json output of mint-session.mjs). The session value is masked in all
// output. Routes resolve as <route>.<RIG_DOMAIN> via network aliases on the
// Traefik container; the backend is reachable directly as http://auth:8081.

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

const DOMAIN = process.env.RIG_DOMAIN ?? 'rig.test'
const BACKEND = process.env.RIG_BACKEND ?? 'http://auth:8081'
const MINT_FILE = process.env.MINT_FILE ?? '/work/mint.json'
const TIMEOUT_MS = 15000

const mint = JSON.parse(readFileSync(MINT_FILE, 'utf8'))
const SESSION = mint.pair
const OLD_NAME_SESSION = `__Secure-better-auth.session_token=${mint.value}`

function mask(text) {
  return String(text).split(mint.value).join('<session>')
}

// ── transports ────────────────────────────────────────────────────────────────

function hostFor(route) {
  return `${route}.${DOMAIN}`
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', chunk => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}

function requestHttp1(secure, route, { method = 'GET', headers = {}, body }) {
  const host = hostFor(route)
  const options = {
    host,
    port: secure ? 443 : 80,
    method,
    path: '/json',
    headers: { host, ...headers },
    agent: false,
    timeout: TIMEOUT_MS,
    ...(secure
      ? {
          servername: host,
          rejectUnauthorized: false,
          ALPNProtocols: ['http/1.1'],
        }
      : {}),
  }
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request(options, async res => {
      try {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: await collect(res),
          protocol: secure
            ? res.socket.alpnProtocol || 'none'
            : 'http/1.1 (cleartext)',
        })
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('request timed out')))
    req.end(body)
  })
}

function requestHttp2(route, { method = 'GET', headers = {}, body }) {
  const host = hostFor(route)
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://${host}`, {
      rejectUnauthorized: false,
    })
    const timer = setTimeout(() => {
      session.destroy(new Error('request timed out'))
    }, TIMEOUT_MS)
    const finish = fn => value => {
      clearTimeout(timer)
      session.close()
      fn(value)
    }
    session.on('error', finish(reject))
    session.on('connect', () => {
      const protocol = session.alpnProtocol
      const lowered = Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      )
      const req = session.request({
        ':method': method,
        ':path': '/json',
        ':authority': host,
        ...lowered,
      })
      let status = 0
      let responseHeaders = {}
      req.on('response', received => {
        status = received[':status']
        responseHeaders = received
      })
      collect(req).then(
        text =>
          finish(resolve)({ status, headers: responseHeaders, text, protocol }),
        finish(reject),
      )
      req.on('error', finish(reject))
      req.end(body)
    })
  })
}

const TRANSPORTS = [
  {
    id: 'h1',
    label: 'HTTP/1.1 cleartext',
    expectedProtocol: 'http/1.1 (cleartext)',
    send: (route, req) => requestHttp1(false, route, req),
  },
  {
    id: 'h1tls',
    label: 'HTTP/1.1 TLS',
    expectedProtocol: 'http/1.1',
    send: (route, req) => requestHttp1(true, route, req),
  },
  {
    id: 'h2',
    label: 'HTTP/2 TLS',
    expectedProtocol: 'h2',
    send: (route, req) => requestHttp2(route, req),
  },
]

// Minimal WebSocket client: upgrade, read one unmasked server frame.
function websocket(secure, route, cookieHeader) {
  const host = hostFor(route)
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({
          host,
          port: 443,
          servername: host,
          rejectUnauthorized: false,
          ALPNProtocols: ['http/1.1'],
        })
      : net.connect(80, host)
    const timer = setTimeout(
      () => socket.destroy(new Error('websocket timed out')),
      TIMEOUT_MS,
    )
    let buffer = Buffer.alloc(0)
    let status = 0
    let headerEnd = -1
    const done = (fn, value) => {
      clearTimeout(timer)
      socket.destroy()
      fn(value)
    }
    socket.on('error', err => done(reject, err))
    socket.on(secure ? 'secureConnect' : 'connect', () => {
      const lines = [
        'GET /ws HTTP/1.1',
        `Host: ${host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
        'Sec-WebSocket-Version: 13',
        `Origin: https://${host}`,
      ]
      if (cookieHeader) lines.push(`Cookie: ${cookieHeader}`)
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
    })
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      if (headerEnd === -1) {
        headerEnd = buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return
        status = Number(
          buffer.subarray(0, headerEnd).toString('latin1').split(' ')[1],
        )
        buffer = buffer.subarray(headerEnd + 4)
        if (status !== 101) return done(resolve, { status, json: null })
      }
      if (buffer.length < 2) return
      let length = buffer[1] & 0x7f
      let offset = 2
      if (length === 126) {
        if (buffer.length < 4) return
        length = buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (buffer.length < 10) return
        length = Number(buffer.readBigUInt64BE(2))
        offset = 10
      }
      if (buffer.length < offset + length) return
      const text = buffer.subarray(offset, offset + length).toString('utf8')
      done(resolve, { status, json: JSON.parse(text) })
    })
  })
}

// ── matrix ────────────────────────────────────────────────────────────────────

const OTHER_A = 'theme=dark'
const OTHER_B = 'lang=en'
const ECHO_BODY = Buffer.alloc(1 << 20, 'x')
const ECHO_BODY_SHA = createHash('sha256').update(ECHO_BODY).digest('hex')

function parse(res) {
  try {
    return JSON.parse(res.text)
  } catch {
    return null
  }
}

function joined(json) {
  return (json?.cookies ?? []).join('; ')
}

// A check returns [ok, observed]; `expected` is printed beside it.
const cases = [
  {
    id: '1',
    route: 'baseline',
    expected: '200; session cookie reaches the backend (control)',
    request: () => ({
      headers: { cookie: `${OTHER_A}; ${SESSION}; ${OTHER_B}` },
    }),
    check: (res, json) => {
      const ok =
        res.status === 200 &&
        json?.authCookiePresent === true &&
        joined(json) === `${OTHER_A}; ${SESSION}; ${OTHER_B}`
      return [ok, `${res.status}; authCookiePresent=${json?.authCookiePresent}`]
    },
  },
  {
    id: '2',
    route: 'gated',
    expected: `200; cookies "${OTHER_A}; ${OTHER_B}" in order; X-Forwarded-User = minted email`,
    request: () => ({
      headers: { cookie: `${OTHER_A}; ${SESSION}; ${OTHER_B}` },
    }),
    check: (res, json) => {
      const ok =
        res.status === 200 &&
        joined(json) === `${OTHER_A}; ${OTHER_B}` &&
        json.authCookiePresent === false &&
        json.forwardedUser === mint.email
      return [
        ok,
        `${res.status}; "${mask(joined(json))}"; user ${json?.forwardedUser}`,
      ]
    },
  },
  {
    id: '3',
    route: 'gated',
    expected: '200; no Cookie header at the backend',
    request: () => ({ headers: { cookie: SESSION } }),
    check: (res, json) => [
      res.status === 200 &&
        json.cookieHeaderCount === 0 &&
        json.cookieNames.length === 0,
      `${res.status}; cookieHeaderCount=${json?.cookieHeaderCount}`,
    ],
  },
  {
    id: '4',
    route: 'gated',
    expected: '302 to the login page',
    request: () => ({ headers: {} }),
    check: res => [
      res.status === 302 &&
        String(res.headers.location).startsWith(`https://auth.${DOMAIN}/login`),
      `${res.status} ${String(res.headers.location).split('?')[0]}`,
    ],
  },
  {
    id: '5',
    route: 'gated',
    expected:
      '302 for the session value under the old name __Secure-better-auth.session_token',
    request: () => ({ headers: { cookie: OLD_NAME_SESSION } }),
    check: res => [
      res.status === 302 &&
        String(res.headers.location).startsWith(`https://auth.${DOMAIN}/login`),
      `${res.status} ${String(res.headers.location).split('?')[0]}`,
    ],
  },
  {
    id: '6',
    route: 'gated',
    expected: `200; only "${OTHER_A}; ${OTHER_B}" (session, lilnas-auth.session_data and __Secure-lilnas-auth.dont_remember stripped)`,
    request: () => ({
      headers: {
        cookie: `${OTHER_A}; ${SESSION}; lilnas-auth.session_data=x; __Secure-lilnas-auth.dont_remember=1; ${OTHER_B}`,
      },
    }),
    check: (res, json) => [
      res.status === 200 &&
        joined(json) === `${OTHER_A}; ${OTHER_B}` &&
        json.authCookiePresent === false,
      `${res.status}; "${mask(joined(json))}"`,
    ],
  },
  {
    id: '7',
    route: 'gated',
    expected:
      'forged X-Forwarded-User and X-Forwarded-User-Id overwritten by the minted identity',
    request: () => ({
      headers: {
        cookie: SESSION,
        'X-Forwarded-User': 'attacker@evil.test',
        'X-Forwarded-User-Id': 'forged-id',
      },
    }),
    check: (res, json) => [
      res.status === 200 &&
        json.forwardedUser === mint.email &&
        json.forwardedUserId === mint.userId,
      `${res.status}; user ${json?.forwardedUser}; id ${json?.forwardedUserId === mint.userId ? '= minted id' : json?.forwardedUserId}`,
    ],
  },
  {
    id: '8',
    route: 'gated',
    expected: `200; split cookie headers merged and stripped to "${OTHER_A}; ${OTHER_B}", one Cookie header`,
    request: transport => ({
      headers: {
        cookie:
          transport.id === 'h2'
            ? [OTHER_A, SESSION, OTHER_B]
            : [`${OTHER_A}; ${SESSION}`, OTHER_B],
      },
    }),
    check: (res, json) => [
      res.status === 200 &&
        joined(json) === `${OTHER_A}; ${OTHER_B}` &&
        json.cookieHeaderCount === 1,
      `${res.status}; "${mask(joined(json))}"; cookieHeaderCount=${json?.cookieHeaderCount}`,
    ],
  },
  {
    id: '9',
    route: 'gated',
    expected: '200; 1 MB POST body arrives intact (size and sha256)',
    request: () => ({
      method: 'POST',
      headers: {
        cookie: `${OTHER_A}; ${SESSION}`,
        'content-type': 'application/octet-stream',
      },
      body: ECHO_BODY,
    }),
    check: (res, json) => [
      res.status === 200 &&
        json.bodyBytes === ECHO_BODY.length &&
        json.bodySha256 === ECHO_BODY_SHA &&
        joined(json) === OTHER_A,
      `${res.status}; ${json?.bodyBytes} bytes; sha ${json?.bodySha256 === ECHO_BODY_SHA ? 'match' : 'MISMATCH'}`,
    ],
  },
  {
    id: '10',
    route: 'open',
    expected: '200; no Cookie header',
    request: () => ({ headers: {} }),
    check: (res, json) => [
      res.status === 200 && json.cookieHeaderCount === 0,
      `${res.status}; cookieHeaderCount=${json?.cookieHeaderCount}`,
    ],
  },
  {
    id: '11',
    route: 'open',
    expected: `200; only "${OTHER_A}"`,
    request: () => ({ headers: { cookie: `${OTHER_A}; ${SESSION}` } }),
    check: (res, json) => [
      res.status === 200 &&
        joined(json) === OTHER_A &&
        json.authCookiePresent === false,
      `${res.status}; "${mask(joined(json))}"`,
    ],
  },
  {
    id: '12',
    route: 'open',
    expected: '200; no Cookie header',
    request: () => ({ headers: { cookie: SESSION } }),
    check: (res, json) => [
      res.status === 200 && json.cookieHeaderCount === 0,
      `${res.status}; cookieHeaderCount=${json?.cookieHeaderCount}`,
    ],
  },
  {
    id: '13',
    route: 'open',
    expected:
      "200; another app's __Secure-better-auth.session_token=keep unchanged",
    request: () => ({
      headers: { cookie: '__Secure-better-auth.session_token=keep' },
    }),
    check: (res, json) => [
      res.status === 200 &&
        joined(json) === '__Secure-better-auth.session_token=keep',
      `${res.status}; "${mask(joined(json))}"`,
    ],
  },
]

const rows = []

function record(id, transport, route, expected, ok, observed) {
  rows.push({ id, transport, route, expected, ok, observed: mask(observed) })
}

async function runCase(testCase, transport) {
  const spec = testCase.request(transport)
  try {
    const res = await transport.send(testCase.route, spec)
    if (res.protocol !== transport.expectedProtocol) {
      record(
        testCase.id,
        transport.label,
        testCase.route,
        `negotiated ${transport.expectedProtocol}`,
        false,
        `negotiated ${res.protocol}`,
      )
      return
    }
    const json = parse(res)
    if (res.status === 200 && json === null) {
      record(
        testCase.id,
        transport.label,
        testCase.route,
        testCase.expected,
        false,
        `${res.status}; body is not JSON`,
      )
      return
    }
    const [ok, observed] = testCase.check(res, json ?? {})
    record(
      testCase.id,
      transport.label,
      testCase.route,
      testCase.expected,
      ok,
      observed,
    )
  } catch (err) {
    record(
      testCase.id,
      transport.label,
      testCase.route,
      testCase.expected,
      false,
      `error: ${err.message}`,
    )
  }
}

async function runWebsocket(secure, route) {
  const label = secure ? 'HTTP/1.1 TLS (wss)' : 'HTTP/1.1 cleartext (ws)'
  const expected = `101; upgrade request carries only "${OTHER_A}"`
  try {
    const { status, json } = await websocket(
      secure,
      route,
      `${OTHER_A}; ${SESSION}`,
    )
    const ok =
      status === 101 &&
      json !== null &&
      joined(json) === OTHER_A &&
      json.authCookiePresent === false
    record(
      '14',
      label,
      route,
      expected,
      ok,
      status === 101 ? `101; "${mask(joined(json))}"` : String(status),
    )
  } catch (err) {
    record('14', label, route, expected, false, `error: ${err.message}`)
  }
}

async function direct(path, extra = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    headers: {
      cookie: `${SESSION}; ${OTHER_A}`,
      'x-forwarded-host': hostFor('direct'),
      'x-forwarded-proto': 'https',
      'x-forwarded-uri': '/',
      ...extra,
    },
    redirect: 'manual',
  })
  return res
}

async function checkDirect() {
  const verify = await direct('/verify')
  record(
    '0a',
    'direct to backend',
    '/verify',
    `200; X-Forwarded-User = minted email; Cookie response header "${OTHER_A}"`,
    verify.status === 200 &&
      verify.headers.get('x-forwarded-user') === mint.email &&
      verify.headers.get('cookie') === OTHER_A,
    `${verify.status}; user ${verify.headers.get('x-forwarded-user')}; cookie "${mask(verify.headers.get('cookie'))}"`,
  )
  const strip = await direct('/strip-cookie')
  record(
    '0b',
    'direct to backend',
    '/strip-cookie',
    `200; Cookie response header "${OTHER_A}"`,
    strip.status === 200 && strip.headers.get('cookie') === OTHER_A,
    `${strip.status}; cookie "${mask(strip.headers.get('cookie'))}"`,
  )
}

function printTable() {
  console.log('| # | transport | route | expected | observed | result |')
  console.log('|---|---|---|---|---|---|')
  for (const row of rows) {
    const cells = [
      row.id,
      row.transport,
      row.route,
      row.expected,
      row.observed,
      row.ok ? 'PASS' : 'FAIL',
    ]
    console.log(
      `| ${cells.map(cell => String(cell).replaceAll('|', '\\|')).join(' | ')} |`,
    )
  }
  const failed = rows.filter(row => !row.ok)
  console.log(`\n${rows.length - failed.length}/${rows.length} rows match`)
  return failed.length
}

async function matrix() {
  await checkDirect()
  for (const testCase of cases) {
    for (const transport of TRANSPORTS) await runCase(testCase, transport)
  }
  for (const route of ['gated', 'open']) {
    await runWebsocket(false, route)
    await runWebsocket(true, route)
  }
  process.exit(printTable() === 0 ? 0 : 1)
}

async function down() {
  for (const transport of TRANSPORTS) {
    try {
      const res = await transport.send('open', {
        headers: { cookie: `${OTHER_A}; ${SESSION}` },
      })
      record(
        '15',
        transport.label,
        'open',
        '5xx from Traefik (recorded)',
        res.status >= 500,
        String(res.status),
      )
    } catch (err) {
      record(
        '15',
        transport.label,
        'open',
        '5xx from Traefik (recorded)',
        false,
        `error: ${err.message}`,
      )
    }
  }
  process.exit(printTable() === 0 ? 0 : 1)
}

async function ready() {
  const deadline = Date.now() + 60000
  let last = 'not started'
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${BACKEND}/health`)
      const open = await requestHttp1(false, 'open', { headers: {} })
      if (health.status === 200 && open.status === 200) {
        console.log('ready')
        return
      }
      last = `health ${health.status}, open route ${open.status}`
    } catch (err) {
      last = err.message
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  console.error(`not ready: ${last}`)
  process.exit(1)
}

const mode = process.argv[2]
if (mode === 'matrix') await matrix()
else if (mode === 'down') await down()
else if (mode === 'ready') await ready()
else {
  console.error('usage: client.mjs ready|matrix|down')
  process.exit(2)
}
