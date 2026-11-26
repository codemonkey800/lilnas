// Matrix client for the hardening rig. rig.sh runs it in client containers
// on the rig network. Plain Node, no dependencies.
//
//   node client.mjs ready <auth|echo>    wait until the route answers 200
//   node client.mjs headers              case 1 and 2
//   node client.mjs sse                  case 4
//   node client.mjs cookies              case 5
//   node client.mjs signin               case 6
//   node client.mjs hold <run>           case 3, client A: hold 3 streams,
//                                        send a 4th, write hold-<run>.json,
//                                        keep holding until release-<run>
//   node client.mjs inflight <run> <status>
//                                        case 3, client B: one /login while A
//                                        holds; <status> is what B expects
//
// Each case prints markdown rows `| case | expected | observed | result |`
// and the process exits 1 when any row fails. Session cookies come from the
// --json output of mint-session.mjs in $RIG_WORK (mint-<name>.json); their
// values never appear in output (only cookie names are printed).

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import net from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import tls from 'node:tls'

import { requestHttp1 } from '../cookie-rig/http1.mjs'

const DOMAIN = process.env.RIG_DOMAIN ?? 'rig.test'
const WORK = process.env.RIG_WORK ?? '/work'
const FRONTEND_DIRECT = process.env.RIG_FRONTEND ?? 'http://frontend:8080'
const AUTH = `https://auth.${DOMAIN}`
const TIMEOUT_MS = 15000

const masked = []
function mask(text) {
  let out = String(text)
  for (const secret of masked) out = out.split(secret).join('<masked>')
  return out.replace(/\|/g, '\\|')
}

function loadMint(name) {
  const mint = JSON.parse(readFileSync(`${WORK}/mint-${name}.json`, 'utf8'))
  masked.push(mint.value)
  return mint
}

// ── results ──────────────────────────────────────────────────────────────────

let failures = 0
function row(id, expected, ok, observed) {
  if (!ok) failures += 1
  console.log(
    `| ${id} | ${mask(expected)} | ${mask(observed)} | ${ok ? 'PASS' : 'FAIL'} |`,
  )
}

async function guard(id, expected, fn) {
  try {
    await fn()
  } catch (err) {
    row(id, expected, false, `error: ${err.message}`)
  }
}

// ── HTTP/1.1 over node:http(s), one connection per request ──────────────────

// Resolves when the response head arrives; the body is left on `res`.
function open(url, { method = 'GET', headers = {}, body } = {}) {
  const target = new URL(url)
  const transport = target.protocol === 'https:' ? https : http
  const started = performance.now()
  return new Promise((resolve, reject) => {
    const req = transport.request(
      target,
      {
        method,
        headers,
        agent: false,
        rejectUnauthorized: false,
        servername: target.hostname,
      },
      res => {
        res.on('error', () => {})
        resolve({
          status: res.statusCode,
          headers: res.headers,
          res,
          req,
          started,
          headMs: performance.now() - started,
        })
      },
    )
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timed out')))
    req.on('error', reject)
    req.end(body)
  })
}

async function readAll(opened, limitMs = TIMEOUT_MS) {
  const chunks = []
  const timer = setTimeout(() => opened.req.destroy(), limitMs)
  try {
    for await (const chunk of opened.res) chunks.push(chunk)
  } catch {
    // destroyed by the timer: `ended` below says so
  } finally {
    clearTimeout(timer)
  }
  return {
    ...opened,
    text: Buffer.concat(chunks).toString('utf8'),
    ended: opened.res.complete,
    totalMs: performance.now() - opened.started,
  }
}

async function fetchAll(url, options, limitMs) {
  return readAll(await open(url, options), limitMs)
}

// Reads a stream until `needle` shows up or `limitMs` passes. Leaves it open.
function waitFor(res, needle, limitMs) {
  const started = performance.now()
  return new Promise(resolve => {
    let text = ''
    const finish = found => {
      clearTimeout(timer)
      res.off('data', onData)
      resolve({ found, ms: Math.round(performance.now() - started) })
    }
    const onData = chunk => {
      text += chunk.toString('utf8')
      if (text.includes(needle)) finish(true)
    }
    const timer = setTimeout(() => finish(false), limitMs)
    res.on('data', onData)
  })
}

function close(opened) {
  opened.req.destroy()
  opened.res.destroy()
}

const contentType = headers => String(headers['content-type'] ?? '(none)')
const isEventStream = headers =>
  contentType(headers).startsWith('text/event-stream')

// ── security headers ─────────────────────────────────────────────────────────

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "frame-ancestors 'none'",
}

function securityIssues(headers) {
  return Object.entries(SECURITY_HEADERS)
    .filter(([name, want]) => headers[name] !== want)
    .map(([name]) => `${name}=${headers[name] ?? '(absent)'}`)
}

function securitySummary(headers) {
  const issues = securityIssues(headers)
  return issues.length === 0
    ? 'all 4 security headers exact'
    : issues.join(', ')
}

// ── ready ────────────────────────────────────────────────────────────────────

async function ready(which) {
  const urls =
    which === 'echo'
      ? [`http://keep.${DOMAIN}/json`, `https://drop.${DOMAIN}/json`]
      : [`${AUTH}/login`, `${FRONTEND_DIRECT}/login`]
  const deadline = Date.now() + 90000
  for (const url of urls) {
    for (;;) {
      try {
        const res = await fetchAll(url, {}, 5000)
        if (res.status === 200) break
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        console.error(`ready: ${url} never answered 200`)
        process.exit(2)
      }
      await sleep(500)
    }
  }
  console.error(`ready: ${urls.join(', ')}`)
}

// ── case 1 and 2: headers, x-powered-by ──────────────────────────────────────

async function headers() {
  await guard(
    '1a',
    '/login over TLS via Traefik: 200 + 4 security headers',
    async () => {
      const res = await fetchAll(`${AUTH}/login`)
      const issues = securityIssues(res.headers)
      row(
        '1a',
        `/login over TLS via Traefik: 200; ${Object.entries(SECURITY_HEADERS)
          .map(([name, value]) => `${name}: ${value}`)
          .join('; ')}`,
        res.status === 200 && issues.length === 0,
        `${res.status}; ${securitySummary(res.headers)}`,
      )
      const hsts = String(res.headers['strict-transport-security'] ?? '')
      row(
        '1b',
        'HSTS has no includeSubDomains and no preload',
        hsts !== '' && !/includesubdomains|preload/i.test(hsts),
        `strict-transport-security: ${hsts || '(absent)'}`,
      )
    },
  )
  await guard('1c', '404 via Traefik carries the same headers', async () => {
    const res = await fetchAll(`${AUTH}/rig-no-such-page`)
    row(
      '1c',
      '404 via Traefik: 404 + the same 4 security headers',
      res.status === 404 && securityIssues(res.headers).length === 0,
      `${res.status}; ${securitySummary(res.headers)}`,
    )
  })
  await guard(
    '2a',
    'x-powered-by absent straight from the frontend',
    async () => {
      const res = await fetchAll(`${FRONTEND_DIRECT}/login`)
      row(
        '2a',
        `${FRONTEND_DIRECT}/login (no Traefik): 200, no x-powered-by`,
        res.status === 200 && !('x-powered-by' in res.headers),
        `${res.status}; x-powered-by ${res.headers['x-powered-by'] ?? '(absent)'}; security headers set by Next itself: ${
          Object.keys(SECURITY_HEADERS)
            .filter(name => name in res.headers)
            .join(', ') || 'none (Traefik adds them)'
        }`,
      )
    },
  )
  await guard('2b', 'x-powered-by absent via Traefik', async () => {
    const res = await fetchAll(`${AUTH}/login`)
    row(
      '2b',
      '/login via Traefik: 200, no x-powered-by',
      res.status === 200 && !('x-powered-by' in res.headers),
      `${res.status}; x-powered-by ${res.headers['x-powered-by'] ?? '(absent)'}`,
    )
  })
}

// ── case 3: in-flight limit ──────────────────────────────────────────────────

function holdFile(run) {
  return `${WORK}/hold-${run}.json`
}

async function hold(run) {
  const mint = loadMint('hold')
  const url = `${AUTH}/api/sse/pending?host=hold.${DOMAIN}`
  const streams = []
  for (let i = 0; i < 3; i += 1) {
    streams.push(
      await open(url, {
        headers: { cookie: mint.pair, accept: 'text/event-stream' },
      }),
    )
  }
  await sleep(500)
  const fourth = await fetchAll(`${AUTH}/login`)
  writeFileSync(
    holdFile(run),
    JSON.stringify({
      holds: streams.map(s => ({
        status: s.status,
        eventStream: isEventStream(s.headers),
      })),
      fourth: { status: fourth.status, headers: fourth.headers },
    }),
  )
  const deadline = Date.now() + 60000
  while (!existsSync(`${WORK}/release-${run}`) && Date.now() < deadline) {
    await sleep(200)
  }
  streams.forEach(close)
}

async function inflight(run, expectB) {
  const deadline = Date.now() + 30000
  while (!existsSync(holdFile(run))) {
    if (Date.now() > deadline) {
      row(`3-${run}`, 'client A holds 3 streams', false, 'no hold file from A')
      return
    }
    await sleep(200)
  }
  try {
    const held = JSON.parse(readFileSync(holdFile(run), 'utf8'))
    const b = await fetchAll(`${AUTH}/login`)
    row(
      `3-${run}a`,
      'client A: 3 streams open (200, text/event-stream)',
      held.holds.length === 3 &&
        held.holds.every(h => h.status === 200 && h.eventStream),
      held.holds
        .map(h => `${h.status}${h.eventStream ? ' sse' : ''}`)
        .join(', '),
    )
    row(
      `3-${run}b`,
      "client A's 4th (/login): 429 with the 4 security headers",
      held.fourth.status === 429 &&
        securityIssues(held.fourth.headers).length === 0,
      `${held.fourth.status}; ${securitySummary(held.fourth.headers)}`,
    )
    row(
      `3-${run}c`,
      `client B (other address) /login at the same moment: ${expectB}`,
      b.status === Number(expectB),
      `${b.status}`,
    )
  } finally {
    writeFileSync(`${WORK}/release-${run}`, '')
  }
}

// ── case 4: SSE through Traefik, the Next rewrite and the backend ────────────

async function sse() {
  const user = loadMint('sse')
  const admin = loadMint('admin')
  const pending = `${AUTH}/api/sse/pending?host=x.${DOMAIN}`
  const withUser = {
    headers: { cookie: user.pair, accept: 'text/event-stream' },
  }
  const openStreams = []

  await guard('4a', 'no cookie: 401 within 1 s, not a stream', async () => {
    const res = await fetchAll(pending, {}, 2000)
    row(
      '4a',
      '/api/sse/pending?host=x.rig.test, no cookie: 401 within 1 s, not text/event-stream, body ends',
      res.status === 401 &&
        !isEventStream(res.headers) &&
        res.ended &&
        res.totalMs < 1000,
      `${res.status}; ${contentType(res.headers)}; ended=${res.ended}; ${Math.round(res.totalMs)} ms`,
    )
  })

  await guard('4b', 'minted session: 200 stream with a keepalive', async () => {
    const first = await open(pending, withUser)
    openStreams.push(first)
    const keepalive =
      first.status === 200
        ? await waitFor(first.res, 'event: keepalive', 5000)
        : { found: false, ms: 0 }
    row(
      '4b',
      'minted session + host: 200, text/event-stream, keepalive arrives (SSE_KEEPALIVE_MS=1000)',
      first.status === 200 && isEventStream(first.headers) && keepalive.found,
      `${first.status}; ${contentType(first.headers)}; keepalive ${keepalive.found ? `after ${keepalive.ms} ms` : 'not seen in 5 s'}`,
    )
  })

  await guard('4c', 'six open, the seventh is 429', async () => {
    while (openStreams.length < 6)
      openStreams.push(await open(pending, withUser))
    const statuses = openStreams.map(s => s.status)
    const seventh = await fetchAll(pending, withUser, 3000)
    row(
      '4c',
      'six streams open for the minted user (all 200); the seventh is 429',
      statuses.every(s => s === 200) && seventh.status === 429,
      `six: ${statuses.join(',')}; seventh: ${seventh.status} ${contentType(seventh.headers)}`,
    )
  })

  await guard('4d', 'close one: a new request is 200 within 5 s', async () => {
    close(openStreams.shift())
    const started = performance.now()
    const seen = []
    let replacement
    while (performance.now() - started < 5000) {
      const attempt = await open(pending, withUser)
      seen.push(attempt.status)
      if (attempt.status === 200) {
        replacement = attempt
        break
      }
      await readAll(attempt, 2000)
      await sleep(250)
    }
    if (replacement) openStreams.push(replacement)
    const elapsed = Math.round(performance.now() - started)
    row(
      '4d',
      'close one client: within 5 s a new request is 200 (slot released through the Next proxy)',
      replacement !== undefined,
      `${replacement ? `200 after ${elapsed} ms` : `no 200 in ${elapsed} ms`}; attempts: ${seen.join(',')}`,
    )
  })

  await guard('4e', 'close all: six fresh streams open again', async () => {
    openStreams.splice(0).forEach(close)
    const started = performance.now()
    const fresh = []
    let last = 0
    while (fresh.length < 6 && performance.now() - started < 5000) {
      const attempt = await open(pending, withUser)
      last = attempt.status
      if (attempt.status === 200) fresh.push(attempt)
      else {
        await readAll(attempt, 2000)
        await sleep(250)
      }
    }
    fresh.forEach(close)
    row(
      '4e',
      'all six closed: six fresh streams are 200 again within 5 s (no slot leaked)',
      fresh.length === 6,
      `${fresh.length} of 6 reopened in ${Math.round(performance.now() - started)} ms${fresh.length < 6 ? `; last status ${last}` : ''}`,
    )
  })

  await guard('4f', '/api/sse/admin with an admin session: 200', async () => {
    const res = await open(`${AUTH}/api/sse/admin`, {
      headers: { cookie: admin.pair, accept: 'text/event-stream' },
    })
    const keepalive =
      res.status === 200
        ? await waitFor(res.res, 'event: keepalive', 5000)
        : { found: false }
    close(res)
    row(
      '4f',
      '/api/sse/admin, minted admin session: 200 text/event-stream',
      res.status === 200 && isEventStream(res.headers),
      `${res.status}; ${contentType(res.headers)}; keepalive ${keepalive.found ? 'seen' : 'not seen'}`,
    )
  })

  await guard('4g', '/api/sse/admin with no cookie: 401', async () => {
    const res = await fetchAll(`${AUTH}/api/sse/admin`, {}, 2000)
    row(
      '4g',
      '/api/sse/admin, no cookie: 401, not a stream',
      res.status === 401 && !isEventStream(res.headers) && res.ended,
      `${res.status}; ${contentType(res.headers)}; ended=${res.ended}`,
    )
  })
}

// ── case 5: the cookie-drop middleware ───────────────────────────────────────

const AUTHORIZATION = 'Bearer rig-test-authorization'
const EMBY_TOKEN = 'rig-test-emby-token'
const COOKIE_PAIRS = ['rig_a=1', 'rig_b=2']

function requestHttp2(host, headers) {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://${host}`, {
      rejectUnauthorized: false,
    })
    const timer = setTimeout(
      () => session.destroy(new Error('timed out')),
      TIMEOUT_MS,
    )
    const finish = fn => value => {
      clearTimeout(timer)
      session.close()
      fn(value)
    }
    session.on('error', finish(reject))
    session.on('connect', () => {
      const lowered = Object.fromEntries(
        Object.entries(headers).map(([n, v]) => [n.toLowerCase(), v]),
      )
      const req = session.request({
        ':method': 'GET',
        ':path': '/json',
        ':authority': host,
        ...lowered,
      })
      let status = 0
      req.on('response', received => {
        status = received[':status']
      })
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () =>
        finish(resolve)({
          status,
          text: Buffer.concat(chunks).toString('utf8'),
          protocol: session.alpnProtocol,
        }),
      )
      req.on('error', finish(reject))
      req.end()
    })
  })
}

const TRANSPORTS = [
  {
    id: 'h1',
    protocol: 'http/1.1 (cleartext)',
    send: (host, headers) => requestHttp1(false, host, { headers }),
  },
  {
    id: 'h1tls',
    protocol: 'http/1.1',
    send: (host, headers) => requestHttp1(true, host, { headers }),
  },
  { id: 'h2', protocol: 'h2', send: requestHttp2 },
]

// WebSocket upgrade over HTTP/1.1; reads echo.mjs's one text frame.
function websocket(secure, host, headers) {
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
      for (const [name, value] of Object.entries(headers)) {
        lines.push(`${name}: ${value}`)
      }
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
      }
      if (buffer.length < offset + length) return
      const text = buffer.subarray(offset, offset + length).toString('utf8')
      done(resolve, { status, json: JSON.parse(text) })
    })
  })
}

function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// What the backend saw, judged for the drop route or the keep (control) route.
function judge(route, status, okStatus, json) {
  const passthrough =
    json?.authorization === AUTHORIZATION && json?.embyToken === EMBY_TOKEN
  const cookies = (json?.cookies ?? []).join('; ')
  const ok =
    status === okStatus &&
    passthrough &&
    (route === 'drop'
      ? json.cookieHeaderCount === 0 && json.cookieNames.length === 0
      : cookies === COOKIE_PAIRS.join('; '))
  const observed = `${status}; Cookie headers=${json?.cookieHeaderCount ?? '?'}; names=${json?.cookieNames?.join(',') || '(none)'}; Authorization ${json?.authorization === AUTHORIZATION ? 'unchanged' : json?.authorizationPresent ? 'CHANGED' : 'MISSING'}; X-Emby-Token ${json?.embyToken === EMBY_TOKEN ? 'unchanged' : json?.embyTokenPresent ? 'CHANGED' : 'MISSING'}`
  return [ok, observed]
}

const EXPECT = {
  drop: 'no Cookie header at all; Authorization and X-Emby-Token unchanged',
  keep: `cookies "${COOKIE_PAIRS.join('; ')}" arrive (control); Authorization and X-Emby-Token unchanged`,
}

async function cookies() {
  for (const route of ['drop', 'keep']) {
    const host = `${route}.${DOMAIN}`
    for (const shape of ['one header', 'two headers']) {
      for (const transport of TRANSPORTS) {
        const id = `5-${route}-${transport.id}-${shape === 'one header' ? '1' : '2'}`
        const expected = `${route} router, ${transport.protocol}, cookies in ${shape}: ${EXPECT[route]}`
        await guard(id, expected, async () => {
          const res = await transport.send(host, {
            Authorization: AUTHORIZATION,
            'X-Emby-Token': EMBY_TOKEN,
            Cookie:
              shape === 'one header' ? COOKIE_PAIRS.join('; ') : COOKIE_PAIRS,
          })
          const [ok, observed] = judge(route, res.status, 200, parse(res.text))
          const protocolOk = res.protocol === transport.protocol
          const twoSent =
            shape === 'one header' ||
            transport.id === 'h2' ||
            res.cookieLinesSent === 2
          row(
            id,
            expected,
            ok && protocolOk && twoSent,
            `${observed}; protocol ${res.protocol}`,
          )
        })
      }
    }
    for (const secure of [false, true]) {
      const id = `5-${route}-${secure ? 'wss' : 'ws'}`
      const expected = `${route} router, WebSocket upgrade (${secure ? 'wss' : 'ws'}): 101; ${EXPECT[route]}`
      await guard(id, expected, async () => {
        const res = await websocket(secure, host, {
          Cookie: COOKIE_PAIRS.join('; '),
          Authorization: AUTHORIZATION,
          'X-Emby-Token': EMBY_TOKEN,
        })
        const [ok, observed] = judge(route, res.status, 101, res.json)
        row(id, expected, ok, observed)
      })
    }
  }
}

// ── case 6: sign-in still starts ─────────────────────────────────────────────

async function signin() {
  await guard(
    '6',
    'POST /api/auth/sign-in/social returns a Google URL',
    async () => {
      const res = await fetchAll(`${AUTH}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: AUTH },
        body: JSON.stringify({ provider: 'google', callbackURL: '/' }),
      })
      const json = parse(res.text)
      const url = typeof json?.url === 'string' ? new URL(json.url) : null
      const setCookie = res.headers['set-cookie'] ?? []
      const names = setCookie.map(cookie => cookie.split('=')[0])
      row(
        '6',
        `POST /api/auth/sign-in/social {"provider":"google","callbackURL":"/"}, Origin ${AUTH}: 200 with a Google URL`,
        res.status === 200 && url?.hostname === 'accounts.google.com',
        `${res.status}; url ${url ? `${url.origin}${url.pathname}` : '(none)'}; set-cookie names: ${names.join(', ') || '(none)'}`,
      )
    },
  )
}

// ── main ─────────────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2)
const commands = {
  ready: () => ready(args[0]),
  headers,
  sse,
  cookies,
  signin,
  hold: () => hold(args[0]),
  inflight: () => inflight(args[0], args[1]),
}
if (!commands[command]) {
  console.error(`usage: client.mjs ${Object.keys(commands).join('|')}`)
  process.exit(2)
}
await commands[command]()
process.exit(failures === 0 ? 0 : 1)
