import { logEvent, logToServer } from 'src/app/lib/browser-logger'

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
  it('POSTs to /api/logs/browser with level/message and keepalive set', async () => {
    logToServer('error', 'boom')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]!
    expect(url).toBe('/api/logs/browser')
    expect(init?.method).toBe('POST')
    expect(init?.keepalive).toBe(true)
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })

    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('error')
    expect(body.message).toBe('boom')
  })

  it('sends path + query only, never the full origin-qualified href', async () => {
    logToServer('warn', 'heads up')

    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    // Regression guard for the exact bug browser-logs.service.spec.ts's
    // redaction tests caught: a full href here would silently skip
    // redactionCensor's /auth/* check server-side instead of failing loudly.
    expect(body.url).toBe('/sessions/1?foo=bar')
    expect(body.url).not.toContain('http')
  })

  it('includes optional context and userAgent', async () => {
    logToServer('info', 'note', { componentStack: 'at <App>' })

    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.context).toEqual({ componentStack: 'at <App>' })
    expect(typeof body.userAgent).toBe('string')
  })

  it('never throws even if fetch rejects', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))
    expect(() => logToServer('error', 'boom')).not.toThrow()
  })
})

describe('logEvent', () => {
  it('delegates to logToServer at info level with the given name and context', () => {
    logEvent('page_view', { path: '/sessions/1' })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('info')
    expect(body.message).toBe('page_view')
    expect(body.context).toEqual({ path: '/sessions/1' })
  })

  it('works with no context', () => {
    logEvent('button_click')

    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('info')
    expect(body.message).toBe('button_click')
    expect(body.context).toBeUndefined()
  })
})
