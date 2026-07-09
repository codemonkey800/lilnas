import {
  LOG_DIR,
  LOG_STREAMS,
  logEnvSuffix,
  logFilePath,
  resolveLogPath,
} from 'src/logging/log-paths'

// Plain assignment to process.env.NODE_ENV is a TS error in this app
// (@types/node's ProcessEnv.NODE_ENV is typed readonly via Next.js's global
// augmentation) — matches the workaround already established in
// src/auth/__tests__/auth-mount.spec.ts and src/__tests__/setup.ts.
function setNodeEnv(value: string) {
  Object.defineProperty(process.env, 'NODE_ENV', { value, writable: true })
}

describe('logEnvSuffix', () => {
  afterEach(() => {
    setNodeEnv('test')
  })

  it("returns 'prod' only for exactly NODE_ENV=production", () => {
    setNodeEnv('production')
    expect(logEnvSuffix()).toBe('prod')
  })

  it.each(['development', 'test', 'staging', ''])(
    "returns 'dev' for NODE_ENV=%s",
    value => {
      setNodeEnv(value)
      expect(logEnvSuffix()).toBe('dev')
    },
  )
})

describe('logFilePath', () => {
  afterEach(() => {
    setNodeEnv('test')
  })

  it('produces the expected dev path for each stream', () => {
    setNodeEnv('development')
    expect(logFilePath('backend')).toBe(`${LOG_DIR}/backend.dev.log`)
    expect(logFilePath('frontend-server')).toBe(
      `${LOG_DIR}/frontend-server.dev.log`,
    )
    expect(logFilePath('frontend-browser')).toBe(
      `${LOG_DIR}/frontend-browser.dev.log`,
    )
  })

  it('produces the expected prod path for each stream', () => {
    setNodeEnv('production')
    expect(logFilePath('backend')).toBe(`${LOG_DIR}/backend.prod.log`)
    expect(logFilePath('frontend-server')).toBe(
      `${LOG_DIR}/frontend-server.prod.log`,
    )
    expect(logFilePath('frontend-browser')).toBe(
      `${LOG_DIR}/frontend-browser.prod.log`,
    )
  })

  it('every path stays under LOG_DIR', () => {
    for (const stream of [
      'backend',
      'frontend-server',
      'frontend-browser',
    ] as const) {
      expect(logFilePath(stream).startsWith(`${LOG_DIR}/`)).toBe(true)
    }
  })
})

// REVIEW.md #11: LOG_STREAMS is the single source of truth the LogStream
// type, logs.dto.ts's query-schema allowlists, and log-sources.service.ts's
// tab order all derive from — this pins its exact contents/order so a
// future edit here can't silently drift what those other modules accept.
describe('LOG_STREAMS', () => {
  it('is exactly the three known streams, in the fixed order every consumer relies on', () => {
    expect(LOG_STREAMS).toEqual([
      'backend',
      'frontend-server',
      'frontend-browser',
    ])
  })
})

// REVIEW.md #10: the one shared rewrite rule every logging/*.service.ts
// file's own test-only resolvePath delegates to — pinning its behavior here
// means the rule only needs proving correct in one place, not four.
describe('resolveLogPath', () => {
  afterEach(() => {
    setNodeEnv('test')
  })

  it('given the real LOG_DIR, returns exactly what logFilePath returns (production behavior: never rewritten)', () => {
    setNodeEnv('development')
    for (const stream of LOG_STREAMS) {
      expect(resolveLogPath(stream, LOG_DIR)).toBe(logFilePath(stream))
    }
  })

  it('given a different directory, rewrites the LOG_DIR prefix to it (the test seam every service.setLogDirForTests relies on)', () => {
    setNodeEnv('development')
    const testDir = '/tmp/some-test-dir'
    for (const stream of LOG_STREAMS) {
      expect(resolveLogPath(stream, testDir)).toBe(
        logFilePath(stream).replace(LOG_DIR, testDir),
      )
      expect(resolveLogPath(stream, testDir).startsWith(testDir)).toBe(true)
    }
  })
})
