import fs from 'node:fs'

import { logFilePath } from 'src/logging/log-paths'

import { BrowserLogsService } from './browser-logs.service'

// Exercises the real logFilePath('frontend-browser') path rather than
// mocking it — under this suite's NODE_ENV=test (src/__tests__/setup.ts),
// logEnvSuffix() resolves to 'dev', so this always lands at the same
// /tmp/tdr-code/frontend-browser.dev.log the real app would use in dev. No
// other spec touches that path, so there's no cross-file collision even
// though Jest runs test files in parallel workers.
const outputPath = logFilePath('frontend-browser')

function readLastLine(): Record<string, unknown> {
  const content = fs.readFileSync(outputPath, 'utf8').trim()
  const lines = content.split('\n')
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>
}

function readAllLines(): string[] {
  const content = fs.readFileSync(outputPath, 'utf8').trim()
  return content.split('\n')
}

describe('BrowserLogsService', () => {
  afterEach(() => {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
  })

  it('writes a single JSON line with the entry message under the correct pino level method', () => {
    const service = new BrowserLogsService()
    service.write({ level: 'error', message: 'boom' })

    const line = readLastLine()
    expect(line.msg).toBe('boom')
    expect(line.level).toBe(50) // pino's numeric level for 'error'
  })

  it('keeps context/url/userAgent as their own top-level fields (context stays nested, not flattened)', () => {
    const service = new BrowserLogsService()
    service.write({
      level: 'warn',
      message: 'heads up',
      context: { componentStack: 'at <App>' },
      url: '/sessions/1',
      userAgent: 'test-agent',
    })

    const line = readLastLine()
    expect(line.msg).toBe('heads up')
    expect(line.context).toEqual({ componentStack: 'at <App>' })
    expect(line.url).toBe('/sessions/1')
    expect(line.userAgent).toBe('test-agent')
  })

  it('strips OAuth code/state from url when the reported page is the auth callback', () => {
    const service = new BrowserLogsService()
    service.write({
      level: 'error',
      message: 'unexpected state',
      // Path + query only, matching what browser-logger.ts actually sends
      // (window.location.pathname + search, never the full href) — see
      // browser-logs.dto.ts's url field comment for why that distinction
      // is load-bearing for this exact check.
      url: '/auth/callback/discord?code=OAUTHCODE&state=STATEVAL',
    })

    const line = readLastLine()
    expect(line.url).toBe('/auth/callback/discord')
    expect(JSON.stringify(line)).not.toContain('OAUTHCODE')
    expect(JSON.stringify(line)).not.toContain('STATEVAL')
  })

  it('leaves a non-auth url untouched (redaction is scoped to /auth/*, not global)', () => {
    const service = new BrowserLogsService()
    service.write({
      level: 'error',
      message: 'unexpected state',
      url: '/sessions/1?foo=bar',
    })

    const line = readLastLine()
    expect(line.url).toBe('/sessions/1?foo=bar')
  })

  it("masks a privateKey field nested under context (mirrors REDACT_PATHS' *.privateKey, shifted for the context wrapper)", () => {
    const service = new BrowserLogsService()
    service.write({
      level: 'error',
      message: 'unexpected state',
      context: { privateKey: 'FAKE-SSH-PRIVATE-KEY-CONTENT' },
    })

    const line = readLastLine()
    const context = line.context as Record<string, unknown>
    expect(context.privateKey).toBe('[Redacted]')
    expect(JSON.stringify(line)).not.toContain('FAKE-SSH-PRIVATE-KEY-CONTENT')
  })

  it('writes event as its own top-level field, not nested under context', () => {
    const service = new BrowserLogsService()
    service.write({
      level: 'info',
      message: 'clicked',
      event: 'button-click',
      context: { componentStack: 'at <App>' },
    })

    const line = readLastLine()
    expect(line.event).toBe('button-click')
    expect(line.context).toEqual({ componentStack: 'at <App>' })
  })

  it('writes successfully with no event field at all (legacy/older client bundle)', () => {
    const service = new BrowserLogsService()
    service.write({ level: 'info', message: 'no event sent' })

    const line = readLastLine()
    expect(line.msg).toBe('no event sent')
    expect(line.event).toBeUndefined()
    expect('event' in line).toBe(false)
  })

  it('strips the privateKey redaction and OAuth url redaction exactly as before when event is also present', () => {
    const service = new BrowserLogsService()
    service.write({
      level: 'error',
      message: 'unexpected state',
      event: 'auth-error',
      url: '/auth/callback/discord?code=OAUTHCODE&state=STATEVAL',
      context: { privateKey: 'FAKE-SSH-PRIVATE-KEY-CONTENT' },
    })

    const line = readLastLine()
    expect(line.event).toBe('auth-error')
    expect(line.url).toBe('/auth/callback/discord')
    const context = line.context as Record<string, unknown>
    expect(context.privateKey).toBe('[Redacted]')
    expect(JSON.stringify(line)).not.toContain('FAKE-SSH-PRIVATE-KEY-CONTENT')
    expect(JSON.stringify(line)).not.toContain('OAUTHCODE')
    expect(JSON.stringify(line)).not.toContain('STATEVAL')
  })

  // BrowserLogEntrySchema's kebab-case regex would reject this value before
  // it ever reaches write() in production (newline isn't in
  // /^[a-z0-9]+(-[a-z0-9]+)*$/'s charset — see browser-logs.controller.spec's
  // matching DTO-rejection test). This test goes around that gate on
  // purpose, calling write() directly with an unvalidated value, to prove
  // the *sink* itself — not just the input gate — can't be forged into
  // emitting a second line. pino JSON-encodes string field values, so an
  // embedded '\n' is escaped to the two characters '\' + 'n' in the output
  // rather than becoming a raw newline byte.
  it('an embedded newline in event cannot manufacture a second log line (defense-in-depth below the DTO gate)', () => {
    const service = new BrowserLogsService()
    // BrowserLogEntryDto's `event` is typed as a plain string — the kebab
    // pattern is a runtime-only (Zod) constraint, not a type-level one — so
    // this compiles cleanly even though BrowserLogEntrySchema.safeParse()
    // would reject it. That's the point: calling write() directly, as this
    // test does, skips the controller's safeParse() step entirely.
    service.write({
      level: 'info',
      message: 'forged?',
      event: 'x\nfake-line',
    })

    const lines = readAllLines()
    expect(lines).toHaveLength(1)
    const line = JSON.parse(lines[0]) as Record<string, unknown>
    expect(line.event).toBe('x\nfake-line')
  })
})
