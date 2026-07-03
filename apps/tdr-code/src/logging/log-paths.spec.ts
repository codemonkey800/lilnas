import { LOG_DIR, logEnvSuffix, logFilePath } from 'src/logging/log-paths'

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
