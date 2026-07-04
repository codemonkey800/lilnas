import { LOG_EVENT_VALUES, LogEvent } from 'src/logging/log-events'

describe('LOG_EVENT_VALUES', () => {
  it('every slug is kebab-case', () => {
    const kebabPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/
    for (const value of LOG_EVENT_VALUES) {
      expect(value).toMatch(kebabPattern)
    }
  })

  it('has no duplicate slugs across domain groups', () => {
    expect(new Set(LOG_EVENT_VALUES).size).toBe(LOG_EVENT_VALUES.length)
  })

  it('contains every already-known seeded slug (R8 fold-in)', () => {
    const seeded = [
      // auth.guard.ts
      'auth-denied',
      'auth-check-error',
      // auth.ts guild-gate outcomes
      'guild-denied',
      'guild-check-error',
      'guild-sweep',
      // guild-gate.ts
      'guild-lookup-complete',
      // session-manager.service.ts (AE1)
      'session-insert-failed',
      'reactivation-insert-failed',
      // composite-acp-handler.ts
      'writer-fault',
      // frontend kebab conversions
      'page-view',
      'button-click',
      'query-error',
      'mutation-error',
      'mutation-success',
      'reconcile-result',
      'reconcile-mismatch',
    ]

    for (const slug of seeded) {
      expect(LOG_EVENT_VALUES).toContain(slug)
    }
  })
})

describe('LogEvent (compile-time)', () => {
  it('accepts a known registered slug', () => {
    const event: LogEvent = 'auth-denied'
    expect(LOG_EVENT_VALUES).toContain(event)
  })

  it('rejects an unregistered slug at compile time', () => {
    // @ts-expect-error - 'totally-bogus-event' is not a registered LogEvent
    const event: LogEvent = 'totally-bogus-event'
    // Referenced only so the unused-var lint rule doesn't also flag this
    // deliberately-invalid assignment.
    expect(typeof event).toBe('string')
  })
})
