import type { Instrumentation } from 'next'

// frontendServerLogger constructs a real pino instance (with a pino-pretty
// worker-thread transport in dev) at module-load time — mock it so these
// tests exercise instrumentation.ts's OWN logic (the boot marker + the
// onRequestError coarsening/redaction) rather than spinning up a real logger
// and writing to the frontend-server.<env>.log file. instrumentation.ts
// dynamic-imports this module by the relative specifier
// './logging/frontend-server-logger', which resolves to the SAME absolute
// path this mock targets, so the mock applies to that dynamic import.
jest.mock('src/logging/frontend-server-logger', () => ({
  frontendServerLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { onRequestError, register } from 'src/instrumentation'
import { frontendServerLogger } from 'src/logging/frontend-server-logger'

const infoMock = frontendServerLogger.info as jest.Mock
const errorMock = frontendServerLogger.error as jest.Mock

// register() branches on this Next-injected magic env var (nodejs vs the edge
// runtime middleware.ts runs in) — save/restore around each test so setting
// it here never leaks into the rest of the backend suite.
const ORIGINAL_NEXT_RUNTIME = process.env.NEXT_RUNTIME

afterEach(() => {
  if (ORIGINAL_NEXT_RUNTIME === undefined) {
    delete process.env.NEXT_RUNTIME
  } else {
    process.env.NEXT_RUNTIME = ORIGINAL_NEXT_RUNTIME
  }
})

// Full request/context stand-ins matching Next's Instrumentation.onRequestError
// parameter shapes (see next's file-conventions/instrumentation docs) — only
// the fields instrumentation.ts actually reads (path/method, routePath/
// routeType) carry meaningful values; the rest satisfy the type.
function makeRequest(
  path: string,
): Parameters<Instrumentation.onRequestError>[1] {
  return { path, method: 'GET', headers: {} }
}

function makeContext(): Parameters<Instrumentation.onRequestError>[2] {
  return {
    routerKind: 'App Router',
    routePath: '/sessions/[id]',
    routeType: 'render',
    renderSource: 'server-rendering',
    revalidateReason: undefined,
  }
}

describe('register()', () => {
  it('writes a frontend-server-booted marker in the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'

    await register()

    expect(infoMock).toHaveBeenCalledTimes(1)
    const [fields, message] = infoMock.mock.calls[0]!
    expect(fields).toMatchObject({
      event: 'frontend-server-booted',
      nodeVersion: process.version,
    })
    expect(message).toBe('frontend server booted')
  })

  it('does nothing in the edge runtime (no filesystem — the pino/file logger must never initialize there)', async () => {
    process.env.NEXT_RUNTIME = 'edge'

    await register()

    expect(infoMock).not.toHaveBeenCalled()
  })
})

describe('onRequestError()', () => {
  // onRequestError has no top-level runtime branch of its own (unlike
  // register() above) — Next still compiles it into the edge bundle (it's a
  // general hook, not one this app scopes by env var), so its dynamic import
  // of frontend-server-logger repeats the same NEXT_RUNTIME guard. Every test
  // in this block needs it set, mirroring register()'s "nodejs" case.
  beforeEach(() => {
    process.env.NEXT_RUNTIME = 'nodejs'
  })

  it('logs server-request-error, coarsening err to name + a length-capped message with no raw stack', async () => {
    const err = new Error('y'.repeat(500))

    await onRequestError(err, makeRequest('/sessions/1'), makeContext())

    expect(errorMock).toHaveBeenCalledTimes(1)
    const [fields, message] = errorMock.mock.calls[0]!
    expect(fields).toMatchObject({
      event: 'server-request-error',
      errName: 'Error',
      method: 'GET',
      path: '/sessions/1',
      routePath: '/sessions/[id]',
      routeType: 'render',
    })
    // No raw stack, and the free-text message is not logged as a `msg` FIELD
    // (it rides as the pino message arg, capped) — so the coarsening can't be
    // bypassed by a future edit adding err.stack to the fields object.
    expect(fields).not.toHaveProperty('stack')
    expect(fields).not.toHaveProperty('msg')
    expect(message).toBe('y'.repeat(300))
    expect((message as string).length).toBeLessThanOrEqual(300)
  })

  it('strips the query string from the request path (an OAuth code/state on an /auth callback render must never reach the log)', async () => {
    const err = new Error('render failed')

    await onRequestError(
      err,
      makeRequest('/auth/callback/discord?code=supersecret&state=xyz'),
      makeContext(),
    )

    const [fields, message] = errorMock.mock.calls[0]!
    expect(fields.path).toBe('/auth/callback/discord')
    // Defense-in-depth: the secret must not appear anywhere in the logged
    // payload (fields or message).
    expect(JSON.stringify(fields)).not.toContain('supersecret')
    expect(message).not.toContain('supersecret')
  })

  it('coarsens a non-Error throwable to its typeof, stringifying the value as the message', async () => {
    await onRequestError('boom', makeRequest('/live'), makeContext())

    const [fields, message] = errorMock.mock.calls[0]!
    expect(fields.errName).toBe('string')
    expect(message).toBe('boom')
  })

  it('does nothing in the edge runtime (no filesystem — the pino/file logger must never initialize there)', async () => {
    process.env.NEXT_RUNTIME = 'edge'

    await onRequestError(new Error('boom'), makeRequest('/live'), makeContext())

    expect(errorMock).not.toHaveBeenCalled()
  })
})
