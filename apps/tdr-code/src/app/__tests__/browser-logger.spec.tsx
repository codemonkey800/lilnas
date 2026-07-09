import {
  capMessage,
  capStack,
  logEvent,
  logToServer,
} from 'src/app/lib/browser-logger'
import { LOG_EVENTS, type LogEvent } from 'src/logging/log-events'

// .tsx (not .ts) so this lands in jest.config.js's frontend/jsdom project —
// logToServer reads window.location/navigator, which the backend/node
// project's environment doesn't provide at all. No component is rendered
// here; the extension alone is what routes this file correctly.

// logToServer only ever calls .catch() on fetch's return value, never
// inspects a resolved Response — resolving with an arbitrary value is
// enough, and avoids needing the real Response/Fetch API classes jsdom
// doesn't provide (see jest.config.js's own header comment on this).
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
  window.history.pushState({}, '', '/sessions/1?foo=bar')
})

describe('logToServer', () => {
  it('POSTs to /api/logs/browser with level/event/message and keepalive set (AE4)', async () => {
    logToServer('error', LOG_EVENTS.unhandledError, 'boom')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]!
    expect(url).toBe('/api/logs/browser')
    expect(init?.method).toBe('POST')
    expect(init?.keepalive).toBe(true)
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })

    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('error')
    expect(body.event).toBe('unhandled-error')
    expect(body.message).toBe('boom')
  })

  it('sends path + query only, never the full origin-qualified href', async () => {
    logToServer('warn', LOG_EVENTS.queryError, 'heads up')

    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    // Regression guard for the exact bug browser-logs.service.spec.ts's
    // redaction tests caught: a full href here would silently skip
    // redactionCensor's /auth/* check server-side instead of failing loudly.
    expect(body.url).toBe('/sessions/1?foo=bar')
    expect(body.url).not.toContain('http')
  })

  it('includes optional context and userAgent', async () => {
    logToServer('info', LOG_EVENTS.errorBoundaryCaught, 'note', {
      componentStack: 'at <App>',
    })

    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.context).toEqual({ componentStack: 'at <App>' })
    expect(typeof body.userAgent).toBe('string')
  })

  it('never throws even if fetch rejects (fire-and-forget contract)', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    expect(() =>
      logToServer('error', LOG_EVENTS.unhandledError, 'boom'),
    ).not.toThrow()
  })

  it('rejects an unregistered event slug at compile time', () => {
    // @ts-expect-error — 'not-a-real-slug' is not a member of LOG_EVENTS,
    // proving the LogEvent type floor actually rejects a bad slug rather
    // than silently widening to `string`.
    const badEvent: LogEvent = 'not-a-real-slug'
    expect(badEvent).toBe('not-a-real-slug')
  })
})

describe('logEvent', () => {
  it('delegates to logToServer at info level, with msg defaulting to the slug', () => {
    logEvent(LOG_EVENTS.pageView, { path: '/sessions/1' })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('info')
    expect(body.event).toBe('page-view')
    expect(body.message).toBe('page-view')
    expect(body.context).toEqual({ path: '/sessions/1' })
  })

  it('works with no context', () => {
    logEvent(LOG_EVENTS.buttonClick)

    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('info')
    expect(body.event).toBe('button-click')
    expect(body.message).toBe('button-click')
    expect(body.context).toBeUndefined()
  })

  it.each([
    ['pageView', LOG_EVENTS.pageView, 'page-view'],
    ['buttonClick', LOG_EVENTS.buttonClick, 'button-click'],
    ['queryError', LOG_EVENTS.queryError, 'query-error'],
    ['mutationError', LOG_EVENTS.mutationError, 'mutation-error'],
    ['mutationSuccess', LOG_EVENTS.mutationSuccess, 'mutation-success'],
    ['reconcileResult', LOG_EVENTS.reconcileResult, 'reconcile-result'],
    ['reconcileMismatch', LOG_EVENTS.reconcileMismatch, 'reconcile-mismatch'],
  ])(
    'emits the kebab-case registry value for %s, not the old snake_case',
    (_name, event, expectedKebab) => {
      logEvent(event)

      const [, init] = mockFetch.mock.calls[0]!
      const body = JSON.parse(init?.body as string)
      expect(body.event).toBe(expectedKebab)
      expect(body.event).not.toMatch(/_/)
    },
  )
})

describe('capStack', () => {
  it('returns undefined unchanged', () => {
    expect(capStack(undefined)).toBeUndefined()
  })

  it('returns a short stack unchanged', () => {
    expect(capStack('Error: boom\n  at foo')).toBe('Error: boom\n  at foo')
  })

  it('truncates an oversized stack to the cap', () => {
    const oversized = 'x'.repeat(5000)
    const capped = capStack(oversized)
    expect(capped).toBeDefined()
    expect(capped!.length).toBeLessThanOrEqual(2000)
    expect(capped!.length).toBe(2000)
  })
})

describe('capMessage', () => {
  it('returns a short message unchanged', () => {
    expect(capMessage('boom')).toBe('boom')
  })

  it('truncates an oversized message to the cap', () => {
    const oversized = 'y'.repeat(1000)
    const capped = capMessage(oversized)
    expect(capped.length).toBeLessThanOrEqual(300)
    expect(capped.length).toBe(300)
  })
})
