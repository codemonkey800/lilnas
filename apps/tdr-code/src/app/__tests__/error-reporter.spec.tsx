import { render } from '@testing-library/react'

import { capStack } from 'src/app/lib/browser-logger'
import { ErrorReporter } from 'src/app/lib/error-reporter'

// No spec file previously existed for this component (U7 adds it) — covers
// the two window-level listeners (`error` / `unhandledrejection`) that
// error-reporter.tsx mounts, mirroring error.spec.tsx's
// render-then-inspect-fetch pattern for the sibling error-boundary path.
// logToServer only ever calls .catch() on fetch's return value — see
// browser-logger.spec.tsx's identical mock/rationale.
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
})

function loggedBody() {
  const [, init] = mockFetch.mock.calls[0]!
  return JSON.parse(init?.body as string)
}

// jsdom does not implement the real PromiseRejectionEvent constructor (no
// `promise`/`reason` support — confirmed empirically: `new
// PromiseRejectionEvent(...)` throws ReferenceError under jest's jsdom
// environment). error-reporter.tsx's handleRejection only ever reads
// `event.reason`, so a plain Event with `reason` attached is sufficient to
// exercise it without needing jsdom to support the full real event type.
function dispatchFakeRejection(reason: unknown): void {
  const event = new Event('unhandledrejection') as PromiseRejectionEvent
  Object.defineProperty(event, 'reason', { value: reason })
  window.dispatchEvent(event)
}

describe('ErrorReporter', () => {
  it('logs an unhandled-error event on a window error, preserving the original message as msg (AE4)', () => {
    render(<ErrorReporter />)

    const error = new Error('boom')
    const event = new ErrorEvent('error', {
      message: 'boom',
      filename: 'app.js',
      lineno: 12,
      colno: 3,
      error,
    })
    window.dispatchEvent(event)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]!
    expect(init?.keepalive).toBe(true)
    const body = loggedBody()
    expect(body.level).toBe('error')
    expect(body.event).toBe('unhandled-error')
    expect(body.message).toBe('boom')
    // capStack (2000 chars) may truncate error.stack in this environment —
    // see error.spec.tsx's identical comment.
    expect(body.context).toEqual({
      filename: 'app.js',
      lineno: 12,
      colno: 3,
      stack: capStack(error.stack),
    })
  })

  it('size-caps an oversized error stack before sending it', () => {
    render(<ErrorReporter />)

    const error = new Error('boom')
    error.stack = 'x'.repeat(5000)
    const event = new ErrorEvent('error', {
      message: 'boom',
      filename: 'app.js',
      lineno: 1,
      colno: 1,
      error,
    })
    window.dispatchEvent(event)

    const body = loggedBody()
    expect(body.context.stack.length).toBeLessThanOrEqual(2000)
    expect(body.context.stack.length).toBeLessThan(5000)
  })

  it('logs an unhandled-rejection event on an unhandled promise rejection', () => {
    render(<ErrorReporter />)

    const reason = new Error('rejected boom')
    dispatchFakeRejection(reason)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = loggedBody()
    expect(body.level).toBe('error')
    expect(body.event).toBe('unhandled-rejection')
    expect(body.message).toBe('rejected boom')
    expect(body.context).toEqual({ stack: capStack(reason.stack) })
  })

  it('stringifies a non-Error rejection reason', () => {
    render(<ErrorReporter />)

    dispatchFakeRejection('plain string reason')

    const body = loggedBody()
    expect(body.message).toBe('plain string reason')
    expect(body.context).toEqual({ stack: undefined })
  })

  it('removes both window listeners on unmount', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener')
    const { unmount } = render(<ErrorReporter />)

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('error', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith(
      'unhandledrejection',
      expect.any(Function),
    )
    removeSpy.mockRestore()
  })
})
